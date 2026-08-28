"""Exdiary v2 — 多实体加密同步引擎（垂直切片）。

目标：任何设备登录同一账号后，所有实体数据全量一致（全量云同步）。

 本地写实体 → payload(JSON) → DEK 加密成 blob（密文）
   → packed = 明文 header || 密文（自包含，对端可解）
   → 存本地(标 dirty) → push 上传中继
 另一设备 → pull 从中继拉全部 packed → 解 header → DEK 解 payload → 落本地 → 全量一致

- 每 blob 用 crypto.encrypt_blob：AAD 绑 account+uuid+header 全字段，防替换/防挪位。
- packed = header.to_bytes() + ciphertext；中继只存 packed（data-blind，head 是明文但仅含元数据、无内容）。
- 实体 id 从解密后的 payload 的 data["id"] 提取；object_type 从 header 得。
- 每次更新带上其读取时的 revision；中继只接受精确的下一 revision，冲突显式返回。
长为垂直切片：experiment 一个实体，EntityCodec 注册可扩展。
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
from dataclasses import dataclass
from typing import Any

from lib.e2ee.crypto import BlobHeader, decrypt_blob, encrypt_blob

# ---------------------------------------------------------------------------
# 实体编解码
# ---------------------------------------------------------------------------


@dataclass
class EntityCodec:
    object_type: str
    schema_version: int = 1

    def code(self, data: dict) -> bytes:
        return json.dumps({"__type": self.object_type, "__schema": self.schema_version,
                           "data": data}, ensure_ascii=False).encode("utf-8")

    def decode(self, raw: str) -> dict:
        p = json.loads(raw)
        if p.get("__type") != self.object_type:
            raise ValueError(f"类型不符: {p.get('__type')} != {self.object_type}")
        return p["data"]


# ---------------------------------------------------------------------------
# 中继抽象 + 内存实现（云端公共储物柜）
# ---------------------------------------------------------------------------


class SyncConflict(RuntimeError):
    """远端实体已被其他设备更新；本地修改不能静默覆盖。"""

    def __init__(self, message: str, *, current_revision: int | None = None) -> None:
        super().__init__(message)
        self.current_revision = current_revision


class SyncRelay:
    def put(self, account_id: bytes, blob_uuid: str, packed: bytes,
            expected_revision: int | None = None) -> None: ...
    def all(self, account_id: bytes) -> dict[str, bytes]: ...


class MemoryRelay(SyncRelay):
    def __init__(self) -> None:
        self._store: dict[bytes, dict[str, bytes]] = {}

    def put(self, account_id: bytes, blob_uuid: str, packed: bytes,
            expected_revision: int | None = None) -> None:
        store = self._store.setdefault(account_id, {})
        existing = store.get(blob_uuid)
        incoming, _ = _unpack(packed)
        if existing is None:
            if expected_revision is not None or incoming.blob_revision != 1:
                raise SyncConflict("REVISION_CONFLICT", current_revision=None)
        else:
            current, _ = _unpack(existing)
            if (expected_revision != current.blob_revision
                    or incoming.blob_revision != current.blob_revision + 1):
                raise SyncConflict("REVISION_CONFLICT", current_revision=current.blob_revision)
        store[blob_uuid] = packed

    def all(self, account_id: bytes) -> dict[str, bytes]:
        return dict(self._store.get(account_id, {}))


# ---------------------------------------------------------------------------
# 本地加密实体存储
# ---------------------------------------------------------------------------

_LOCAL_SCHEMA = """
CREATE TABLE IF NOT EXISTS local_entity (
    account_id   TEXT NOT NULL,
    entity_type  TEXT NOT NULL,
    entity_id    TEXT NOT NULL,
    blob_uuid    TEXT NOT NULL,
    revision     INTEGER NOT NULL,
    base_revision INTEGER,
    dirty        INTEGER NOT NULL DEFAULT 1,
    packed       BLOB NOT NULL,        -- header||密文（自包含）
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (account_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_local_uuid ON local_entity(account_id, blob_uuid);
"""


def _pack(header: BlobHeader, ct: bytes) -> bytes:
    return header.to_bytes() + ct


def _unpack(data: bytes) -> tuple[BlobHeader, bytes]:
    header = BlobHeader.from_bytes(data)
    hlen = len(header.to_bytes())
    return header, data[hlen:]


class LocalEncryptedStore:
    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(_LOCAL_SCHEMA)
        columns = {row[1] for row in self.conn.execute("PRAGMA table_info(local_entity)")}
        if "base_revision" not in columns:
            self.conn.execute("ALTER TABLE local_entity ADD COLUMN base_revision INTEGER")
            self.conn.execute(
                "UPDATE local_entity SET base_revision="
                "CASE WHEN dirty=1 AND revision>0 THEN revision-1 ELSE revision END "
                "WHERE base_revision IS NULL"
            )
        self.conn.commit()

    def upsert(self, account: bytes, type_: str, eid: str, blob_uuid: str,
               revision: int, base_revision: int | None, packed: bytes, *, dirty: int) -> None:
        self.conn.execute(
            "INSERT INTO local_entity (account_id, entity_type, entity_id, blob_uuid, revision, base_revision, dirty, packed, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id, entity_type, entity_id) DO UPDATE SET "
            " blob_uuid=excluded.blob_uuid, revision=excluded.revision, base_revision=excluded.base_revision, dirty=excluded.dirty, "
            " packed=excluded.packed, updated_at=excluded.updated_at",
            (account.decode(), type_, eid, blob_uuid, revision, base_revision, dirty, packed, int(time.time())),
        )
        self.conn.commit()

    def dirty(self, account: bytes) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM local_entity WHERE account_id=? AND dirty=1", (account.decode(),)
        ).fetchall()

    def all(self, account: bytes) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT * FROM local_entity WHERE account_id=? ORDER BY entity_type, entity_id",
            (account.decode(),),
        ).fetchall()

    def by_uuid(self, account: bytes, uuid: str) -> sqlite3.Row | None:
        return self.conn.execute(
            "SELECT * FROM local_entity WHERE account_id=? AND blob_uuid=?", (account.decode(), uuid)
        ).fetchone()

    def has_uuid(self, account: bytes, uuid: str) -> bool:
        return self.by_uuid(account, uuid) is not None

    def remove(self, account: bytes, type_: str, eid: str) -> None:
        self.conn.execute(
            "DELETE FROM local_entity WHERE account_id=? AND entity_type=? AND entity_id=?",
            (account.decode(), type_, eid),
        )
        self.conn.commit()

    def mark_clean(self, account: bytes, type_: str, eid: str, revision: int) -> None:
        self.conn.execute(
            "UPDATE local_entity SET dirty=0, base_revision=? "
            "WHERE account_id=? AND entity_type=? AND entity_id=? AND revision=?",
            (revision, account.decode(), type_, eid, revision),
        )
        self.conn.commit()


# ---------------------------------------------------------------------------
# 同步引擎
# ---------------------------------------------------------------------------


class SyncEngine:
    """多设备全量同步：每个设备同一 account + 同一 data DEK（登录后从 envelope 解出）。"""

    def __init__(
        self,
        account_id: str,
        dek: bytes,
        codecs: dict[str, EntityCodec],
        relay: SyncRelay,
        conn: sqlite3.Connection,
    ) -> None:
        self.account = account_id.encode()
        self.dek = dek
        self.codecs = codecs
        self.relay = relay
        self.store = LocalEncryptedStore(conn)
        self._counter = int(time.time() * 1000)
        self._deleted: list[tuple[str, str]] = []  # 拉取时识别到的墓碑 (entity_type, entity_id)
        self._conflicted: set[tuple[str, str]] = set()
        self.last_pull_changes: list[dict[str, Any]] = []

    def _next_uuid(self) -> str:
        self._counter += 1
        return f"{self.account.decode()}-{self._counter}"

    def write_entity(self, entity_type: str, data: dict) -> None:
        """本地写实体：加密为自包含 packed blob、存本地、标 dirty。data 须含 'id'。

        同一实体多次写复用同一 blob_uuid；未上传的连续本地修改复用同一个
        远端基准 revision，并在推送时以 CAS 检查该基准，避免覆盖其它设备的新写入。
        """
        eid = data.get("id")
        if not eid:
            raise ValueError("实体 data 必须含 id")
        codec = self.codecs[entity_type]
        payload = codec.code(data)
        existing = _row_by_key(self.store, self.account, entity_type, eid)
        if existing:
            uuid = existing["blob_uuid"]
            base_revision = (existing["base_revision"] if existing["dirty"]
                             else existing["revision"])
            base_revision = int(base_revision) if base_revision is not None else None
            # 本地尚未推送时多次修改同一实体，仍基于同一个远端版本重写同一下一 revision。
            revision = (base_revision + 1) if base_revision is not None else 1
        else:
            uuid = self._next_uuid()
            base_revision = None
            revision = 1
        header = BlobHeader(crypto_format_version=1, object_type=entity_type,
                            schema_version=codec.schema_version, key_version=1,
                            blob_revision=revision, nonce=os.urandom(12))
        ct = encrypt_blob(self.dek, self.account, uuid.encode(), header, payload)
        self.store.upsert(self.account, entity_type, eid, uuid, revision=revision,
                          base_revision=base_revision, packed=_pack(header, ct), dirty=1)

    def delete_entity(self, entity_type: str, entity_id: str) -> None:
        """删除实体：把同一 blob_uuid 的 revision+1 写成*墓碑 blob*（payload.deleted=True），
        仍作为普通 blob 上传中继；对端拉取到即删除本地。墓碑同样受 CAS 保护。"""
        codec = self.codecs[entity_type]
        payload = codec.code({"id": entity_id, "deleted": True})
        existing = _row_by_key(self.store, self.account, entity_type, entity_id)
        if existing:
            uuid = existing["blob_uuid"]
            base_revision = (existing["base_revision"] if existing["dirty"]
                             else existing["revision"])
            base_revision = int(base_revision) if base_revision is not None else None
            revision = (base_revision + 1) if base_revision is not None else 1
        else:
            uuid = self._next_uuid()
            base_revision = None
            revision = 1
        header = BlobHeader(crypto_format_version=1, object_type=entity_type,
                            schema_version=codec.schema_version, key_version=1,
                            blob_revision=revision, nonce=os.urandom(12))
        ct = encrypt_blob(self.dek, self.account, uuid.encode(), header, payload)
        self.store.upsert(self.account, entity_type, entity_id, uuid, revision=revision,
                          base_revision=base_revision, packed=_pack(header, ct), dirty=1)

    def sync_push(self) -> int:
        """上传 dirty blob；只标记每一条确实被中继接受的实体为已同步。"""
        n = 0
        for row in self.store.dirty(self.account):
            try:
                self.relay.put(
                    self.account, row["blob_uuid"], bytes(row["packed"]),
                    expected_revision=(int(row["base_revision"])
                                       if row["base_revision"] is not None else None),
                )
            except SyncConflict:
                self._conflicted.add((row["entity_type"], row["entity_id"]))
                raise
            self.store.mark_clean(self.account, row["entity_type"], row["entity_id"],
                                  int(row["revision"]))
            n += 1
        return n

    def sync_pull(self) -> int:
        """从云端拉全部 packed；仅冲突实体允许用同 revision 的远端内容覆盖本地脏副本。"""
        n = 0
        self.last_pull_changes = []
        for uuid, packed in self.relay.all(self.account).items():
            header, ct = _unpack(bytes(packed))
            local = self.store.by_uuid(self.account, uuid)
            key = ((local["entity_type"], local["entity_id"]) if local is not None else None)
            is_conflicted = key in self._conflicted if key else False
            if (local is not None and int(local["revision"]) >= header.blob_revision
                    and not is_conflicted):
                continue  # 本地版本不旧，保留本地镜像
            payload = decrypt_blob(self.dek, self.account, uuid.encode(), header, bytes(ct))
            codec = self.codecs[header.object_type]
            data = codec.decode(payload.decode("utf-8"))
            eid = data["id"]
            if data.get("deleted"):
                # 墓碑：移除本地镜像，并交给网关删除明文
                self._deleted.append((header.object_type, eid))
                self.store.remove(self.account, header.object_type, eid)
                self._conflicted.discard((header.object_type, eid))
                self.last_pull_changes.append({"type": header.object_type, "id": eid,
                                               "revision": header.blob_revision, "action": "deleted"})
                n += 1
                continue
            self.store.upsert(self.account, header.object_type, eid, uuid,
                              revision=header.blob_revision, base_revision=header.blob_revision,
                              packed=bytes(packed), dirty=0)
            self._conflicted.discard((header.object_type, eid))
            self.last_pull_changes.append({"type": header.object_type, "id": eid,
                                           "revision": header.blob_revision, "action": "updated"})
            n += 1
        return n

    def take_deleted(self) -> list[tuple[str, str]]:
        """取出并清空本次拉取识别到的墓碑列表。"""
        d = list(self._deleted)
        self._deleted = []
        return d

    def read_entity(self, entity_type: str, entity_id: str) -> dict | None:
        """读本地实体：解包 → 解密 → 返回 data。"""
        row = _row_by_key(self.store, self.account, entity_type, entity_id)
        if row is None:
            return None
        header, ct = _unpack(bytes(row["packed"]))
        payload = decrypt_blob(self.dek, self.account, row["blob_uuid"].encode(), header, bytes(ct))
        return self.codecs[entity_type].decode(payload.decode("utf-8"))


def _row_by_key(store: LocalEncryptedStore, account: bytes, type_: str, eid: str):
    return store.conn.execute(
        "SELECT * FROM local_entity WHERE account_id=? AND entity_type=? AND entity_id=?",
        (account.decode(), type_, eid),
    ).fetchone()


# 垂直切片边界说明：
# - 同一实体的并发写以 revision CAS 拒绝；冲突方回拉远端内容，不做字段级自动合并。
# - "云端新增"能还原因为 packed 自包含 header(object_type)+payload(含 id)。
