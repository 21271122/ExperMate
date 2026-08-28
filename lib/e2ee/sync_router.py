"""Exdiary v2 — 同步网关：把「SQLite 仓储 ⇄ SyncEngine ⇄ 真实中继」接起来。

对应待同步实体：experiment / analysis / update_log / favorites / thread /
thread_index / user_profile / attachment / music_library。本模块：
- `build_codecs()`：集中注册各实体编解码（供 SyncEngine 加解密）。
- `SyncGateway`：写实体→加密推中继（push）；拉云端→解密→写回明文仓储（pull）。
- `connect_gateway()`：以账号/DEK/中继/本地连接组装一个网关。

注意：DEK 的**供给**（登录后从 e2ee keyring/系统凭据库解出该账号 DEK，见设计 §16）
是本层之外的接线；本模块只负责"拿到 DEK 之后"的读写桥。
"""

from __future__ import annotations

import threading
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

from lib.e2ee.syncengine import EntityCodec, SyncConflict, SyncEngine
from lib.e2ee.real_relay import RealRelay


# ---------------------------------------------------------------------------
# 实体编解码注册
# ---------------------------------------------------------------------------


def build_codecs(extra: dict[str, EntityCodec] | None = None) -> dict[str, EntityCodec]:
    codecs: dict[str, EntityCodec] = {
        "experiment": EntityCodec("experiment", schema_version=1),
        "analysis": EntityCodec("analysis", schema_version=1),
        "update_log": EntityCodec("update_log", schema_version=1),
        "favorites": EntityCodec("favorites", schema_version=1),
        "thread": EntityCodec("thread", schema_version=1),
        "thread_index": EntityCodec("thread_index", schema_version=1),
        "user_profile": EntityCodec("user_profile", schema_version=1),
        "attachment": EntityCodec("attachment", schema_version=1),
        "music_library": EntityCodec("music_library", schema_version=1),
    }
    if extra:
        codecs.update(extra)
    return codecs


# ---------------------------------------------------------------------------
# 网关
# ---------------------------------------------------------------------------


class SyncGateway:
    """把「加密同步引擎」桥到「明文 SQLite 仓储」。

    flush: entity_type -> fn(data)，负责把解密出的实体 data 写回对应明文仓储/存储。
    """

    def __init__(self, engine: SyncEngine, flush: dict[str, Callable[[dict], None]]) -> None:
        self.engine = engine
        self.flush = flush
        self.delete_flush: dict[str, Callable[[str], None]] = {}  # entity_type -> fn(entity_id) 删除明文
        self._lock = threading.Lock()  # 后台 watch 线程与请求线程共用同一 engine 时的串行化
        self._last_pull_status: dict[str, Any] = {
            "ok": False, "pulled_at": "", "changed": [], "error": "尚未同步",
        }

    def push(self, entity_type: str, data: dict) -> None:
        """本地写实体（自动加密存本地、标 dirty），随后推送。"""
        with self._lock:
            self.engine.write_entity(entity_type, data)
            try:
                self.engine.sync_push()
            except SyncConflict:
                self._pull_locked()
                raise

    def delete(self, entity_type: str, entity_id: str) -> None:
        """本地删除实体：写墓碑 blob 并推中继（对端拉取即删除）。"""
        with self._lock:
            self.engine.delete_entity(entity_type, entity_id)
            try:
                self.engine.sync_push()
            except SyncConflict:
                self._pull_locked()
                raise

    def push_dirty_now(self) -> int:
        with self._lock:
            try:
                return self.engine.sync_push()
            except SyncConflict:
                self._pull_locked()
                raise

    def _pull_locked(self) -> int:
        """持锁拉取并记录同步结果；失败时不把旧本地数据伪装成最新状态。"""
        pulled_at = datetime.now(timezone.utc).astimezone(
            ZoneInfo("Asia/Shanghai")
        ).isoformat(timespec="seconds")
        try:
            n = self.engine.sync_pull()
        except Exception as exc:
            self._last_pull_status = {
                "ok": False, "pulled_at": pulled_at, "changed": [], "error": str(exc)[:200],
            }
            return 0
        account = self.engine.account
        for row in self.engine.store.all(account):
            et = row["entity_type"]
            try:
                data = self.engine.read_entity(et, row["entity_id"])
            except Exception:
                continue  # 解不开/类型不符的跳过，不阻断其它实体
            if data is None or data.get("deleted"):
                continue  # 墓碑/已删本地行不当作活体 flush（防复活）
            fn = self.flush.get(et)
            if fn:
                try:
                    fn(data)
                except Exception:
                    continue
        # 应用拉取到的删除
        for et, eid in self.engine.take_deleted():
            dfn = self.delete_flush.get(et)
            if dfn:
                try:
                    dfn(eid)
                except Exception:
                    continue
        self._last_pull_status = {
            "ok": True, "pulled_at": pulled_at,
            "changed": list(self.engine.last_pull_changes), "error": "",
        }
        return n

    def pull(self) -> int:
        """从云端全量拉取 → 解密 → 写回明文仓储；返回新增/更新条数。"""
        with self._lock:
            return self._pull_locked()

    def last_pull_status(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._last_pull_status)

    def read(self, entity_type: str, entity_id: str) -> dict | None:
        return self.engine.read_entity(entity_type, entity_id)


# ---------------------------------------------------------------------------
# 组装
# ---------------------------------------------------------------------------


def connect_gateway(
    account_id: str,
    dek: bytes,
    relay: RealRelay,
    conn: Any,
    flush: dict[str, Callable[[dict], None]],
    codecs: dict[str, EntityCodec] | None = None,
    delete_flush: dict[str, Callable[[str], None]] | None = None,
) -> SyncGateway:
    """以账号/DEK/中继/本地连接组装 SyncGateway。conn 用于 engine 的本地加密镜像表。"""
    relay.ensure_account()
    engine = SyncEngine(account_id, dek, codecs or build_codecs(), relay, conn)
    gw = SyncGateway(engine, flush)
    if delete_flush:
        gw.delete_flush = delete_flush
    return gw


# ---------------------------------------------------------------------------
# 常用 flush 构造（把解密实体写回 sqlite 仓储）
# ---------------------------------------------------------------------------


def make_flush(
    exp_repo: Any,
    thread_repo: Any,
    analysis_repo: Any = None,
    favorites_repo: Any = None,
    update_log_repo: Any = None,
    attachment_store: Any = None,
) -> dict[str, Callable[[dict], None]]:
    """为可用仓储生成 flush 映射。attachment 实体 data 内 content_b64 为 base64 字节。"""
    import base64

    flush: dict[str, Callable[[dict], None]] = {}
    if exp_repo is not None:
        flush["experiment"] = lambda d: (
            exp_repo.import_synced(d) if hasattr(exp_repo, "import_synced") else exp_repo.save(d)
        )
    if thread_repo is not None:
        flush["thread"] = lambda d: thread_repo.save(d)
    if analysis_repo is not None:
        flush["analysis"] = lambda d: analysis_repo.save(d)
    if favorites_repo is not None:
        # user 作用域取仓储当前用户，而非 data 自带（避免 "" 落到离线作用域）
        flush["favorites"] = lambda d: favorites_repo.import_snapshot(
            d, favorites_repo._uid())
    if update_log_repo is not None:
        flush["update_log"] = lambda d: update_log_repo.import_entry(d)
    if thread_repo is not None:
        # thread_index 为整份索引（含 exp/anal 映射 + user_profile），写回 kv_store['index']
        flush["thread_index"] = lambda d: thread_repo.set_index(
            {k: v for k, v in d.items() if k != "id"})
    if attachment_store is not None:
        def _flush_attachment(d: dict) -> None:
            content = base64.b64decode(d.get("content_b64", ""))
            meta = attachment_store.put(content, name=d.get("name", ""), mime=d.get("mime", ""), mark_dirty=False)
            attachment_store.save_synced(meta["sha256"])
        flush["attachment"] = _flush_attachment
        flush["music_library"] = attachment_store.import_music_library
    # user_profile 随 thread_index（索引内含 user_profile）一起同步，避免 kv 键冲突
    return flush
