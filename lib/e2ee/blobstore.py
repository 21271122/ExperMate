"""Exdiary v2 — blob 同步：owner + current-key + revision 三条件原子写 + DELETE tombstone。

核心并发与删除语义：
- **PUT 是一个原子写条件**（不能"先查 current key 再单独更新"）：
    authenticated owner == blob.owner
    AND Account.current_key_version == header.key_version
    AND blob.current_revision == expected_revision
  同一 UPDATE WHERE 判定，任何不满足 → RevisionConflict / StaleKey，不写。
- **DELETE 写 tombstone**（不物理删）：revision 单调 +1、deleted=1，
  离线设备不会把已删除对象"复活"。
- 新 blob 创建同样原子：owner=当前 account、key_version=current、revision=initial。

密文由上层用 `lib.e2ee.crypto` 生成（带 AuthenticatedCleartextHeader + AAD）。
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from lib.e2ee.keystore import KeyringStore


class BlobConflict(RuntimeError):
    """原子写前提不满足：revision 冲突 / stale key / owner 不符。"""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class Incoming:
    """一次加密 blob 写入请求（owner/header/ciphertext/revision）。

    header 需携带 key_version 与 blob_revision（用于 current-key 与 revision CAS）。
    """

    def __init__(
        self,
        blob_uuid: str,
        key_version: int,
        ciphertext: bytes,
        expected_revision: Optional[int],
        new_revision: int,
    ) -> None:
        self.blob_uuid = blob_uuid
        self.key_version = key_version
        self.ciphertext = ciphertext
        self.expected_revision = expected_revision  # None = 新 blob（initial）
        self.new_revision = new_revision


class BlobStore:
    def __init__(self, conn: sqlite3.Connection, keyring: KeyringStore) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self.keyring = keyring
        self._create_schema()

    def _create_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS blob (
                account_id       TEXT NOT NULL,
                blob_uuid        TEXT NOT NULL,
                key_version      INTEGER NOT NULL,
                current_revision INTEGER NOT NULL,
                deleted          INTEGER NOT NULL DEFAULT 0,   -- tombstone
                ciphertext       BLOB,
                updated_at       TEXT DEFAULT '',
                PRIMARY KEY (account_id, blob_uuid)
            );
            """
        )
        self.conn.commit()

    def _current_key(self, account_id: str) -> int:
        acc = self.conn.execute(
            "SELECT current_key_version FROM account WHERE account_id=?", (account_id,)
        ).fetchone()
        if acc is None:
            raise KeyError(f"account 不存在: {account_id}")
        return int(acc["current_key_version"])

    def put(self, account_id: str, incoming: Incoming) -> int:
        """原子写：owner + current-key + revision CAS 同处一个条件写。返回新 revision。"""
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            current = self._current_key(account_id)
            if incoming.key_version != current:
                self.conn.rollback()
                raise BlobConflict(
                    f"STALE_KEY_VERSION: 客户端 key_version={incoming.key_version}, 当前={current}"
                )
            existing = self.conn.execute(
                "SELECT current_revision, deleted FROM blob WHERE account_id=? AND blob_uuid=?",
                (account_id, incoming.blob_uuid),
            ).fetchone()
            if existing is None:
                # 新 blob：owner=当前 account、key_version=current、revision=initial
                if incoming.expected_revision is not None:
                    self.conn.rollback()
                    raise BlobConflict("blob 不存在但传入 expected_revision（状态不一致）")
                self.conn.execute(
                    "INSERT INTO blob (account_id, blob_uuid, key_version, current_revision, deleted, ciphertext) "
                    "VALUES (?,?,?,?,0,?)",
                    (account_id, incoming.blob_uuid, current, incoming.new_revision, incoming.ciphertext),
                )
            else:
                # 更新：条件写（owner + revision CAS）在一个 UPDATE 里
                cur = self.conn.execute(
                    "UPDATE blob SET ciphertext=?, key_version=?, current_revision=?, deleted=0, updated_at=datetime('now') "
                    "WHERE account_id=? AND blob_uuid=? AND current_revision=?",
                    (incoming.ciphertext, current, incoming.new_revision,
                     account_id, incoming.blob_uuid, incoming.expected_revision),
                )
                if cur.rowcount == 0:
                    self.conn.rollback()
                    raise BlobConflict(
                        f"REVISION_CONFLICT: 期望 revision={incoming.expected_revision}, "
                        f"实际={existing['current_revision']}"
                    )
            self.conn.commit()
            return incoming.new_revision
        except BlobConflict:
            self.conn.rollback()
            raise
        except Exception:
            self.conn.rollback()
            raise

    def delete(self, account_id: str, blob_uuid: str, expected_revision: int) -> int:
        """写 tombstone（不物理删）：owner + revision CAS；revision +1、deleted=1。"""
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            row = self.conn.execute(
                "SELECT current_revision FROM blob WHERE account_id=? AND blob_uuid=?",
                (account_id, blob_uuid),
            ).fetchone()
            if row is None:
                self.conn.rollback()
                raise BlobConflict("blob 不存在")
            cur = self.conn.execute(
                "UPDATE blob SET deleted=1, current_revision=current_revision+1, ciphertext=NULL, "
                "updated_at=datetime('now') "
                "WHERE account_id=? AND blob_uuid=? AND current_revision=?",
                (account_id, blob_uuid, expected_revision),
            )
            if cur.rowcount == 0:
                self.conn.rollback()
                raise BlobConflict(
                    f"REVISION_CONFLICT: 期望删 revision={expected_revision}, 实际={row['current_revision']}"
                )
            new_rev = row["current_revision"] + 1
            self.conn.commit()
            return new_rev
        except BlobConflict:
            self.conn.rollback()
            raise
        except Exception:
            self.conn.rollback()
            raise

    def get(self, account_id: str, blob_uuid: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM blob WHERE account_id=? AND blob_uuid=?", (account_id, blob_uuid)
        ).fetchone()
        if row is None:
            return None
        d = dict(row)
        return d if not d.get("deleted") else None  # tombstone → 视为不存在
