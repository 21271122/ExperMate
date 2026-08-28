"""Exdiary v2 — 应用接线：把网关挂进 Flask 的连接/写路径。

把「路由保存 → 加密推中继 → 拉取落回明文仓储」接到应用。本模块不含 DEK 供给
（那是登录/密钥链层 §16 的职责）：`setup_gateway` 只负责"拿到 DEK 之后"的装配，
`forward_dirty` 负责把仓储的 on_dirty 写转发给网关加密推送。
"""

from __future__ import annotations

import sqlite3
from typing import Any, Callable

from lib.repositories.sqlite_experiment import SqliteExperimentRepository
from lib.repositories.sqlite_thread import SqliteThreadRepository
from lib.attachment_store import SqliteAttachmentStore
from lib.e2ee.real_relay import RealRelay
from lib.e2ee.sync_router import build_codecs, connect_gateway, make_flush


def setup_gateway(
    db_path: str,
    account_id: str,
    dek: bytes,
    relay_url: str,
    relay_key: str,
    uid_provider: Callable[[], str],
    timeout: float = 10.0,
) -> tuple[Any, sqlite3.Connection]:
    """装配网关并做一次启动拉取。返回 (gateway, 连接)。连接交由调用方管理。"""
    conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")  # 网关后台 flush 与请求线程写并存时等锁而非报错
    from lib.repositories.sqlite_common import ThreadSafeConnection
    conn = ThreadSafeConnection(conn)  # 网关连接被 watch 线程与请求线程并发用：串行化

    exp = SqliteExperimentRepository(conn, uid_provider=uid_provider)
    thr = SqliteThreadRepository(conn, uid_provider=uid_provider)
    att = SqliteAttachmentStore(conn, uid_provider=uid_provider)
    def flush_experiment(data: dict) -> None:
        exp.import_synced(data)
        from routes.api_agent import publish_resource_change_for_user
        publish_resource_change_for_user(account_id, data.get("id", ""), "synced")

    def delete_experiment(eid: str) -> None:
        exp.delete(eid)
        from routes.api_agent import publish_resource_change_for_user
        publish_resource_change_for_user(account_id, eid, "deleted")

    flush = make_flush(exp, thr, attachment_store=att)
    flush["experiment"] = flush_experiment
    delete_flush = {"experiment": delete_experiment}

    relay = RealRelay(relay_url, account_id, relay_key, timeout=timeout)
    gateway = connect_gateway(account_id, dek, relay, conn, flush,
                              codecs=build_codecs(), delete_flush=delete_flush)
    gateway.pull()  # 首登全量拉取，恢复到明文仓储
    return gateway, conn


def forward_dirty(
    gateway: Any,
    entity_type: str,
    entity_id: str,
    tombstone: bool,
    readers: dict[str, Callable[[str], dict | None]],
    attachment_store: Any = None,
) -> bool:
    """把仓储 on_dirty 写转发为网关推送（读回实体 → 加密 → push）。

    - tombstone=True：删除 → gateway.delete（写墓碑 blob 推中继，对端拉取即删）。
    - reader 缺失的实体类型：跳过（不阻断其它实体）。
    """
    if gateway is None:
        return False
    if tombstone:
        try:
            gateway.delete(entity_type, entity_id)
        except Exception:
            return False
        return True
    reader = readers.get(entity_type)
    if reader is None:
        return False
    try:
        data = reader(entity_id)
    except Exception:
        return False
    if data is None:
        return False
    try:
        gateway.push(entity_type, data)
    except Exception as exc:
        # 条件写冲突必须返回到保存调用方；吞掉会让本地界面误以为已同步成功。
        from lib.e2ee.syncengine import SyncConflict
        if isinstance(exc, SyncConflict):
            raise
        return False  # 网络等暂时失败保留本地 dirty，交给后续同步重试
    return True


def build_readers(
    exp_repo: Any, thread_repo: Any, analysis_repo: Any = None,
    favorites_repo: Any = None, update_log_repo: Any = None,
    attachment_store: Any = None,
) -> dict[str, Callable[[str], dict | None]]:
    """构造 entity_type → reader(entity_id)->data 的映射，供 forward_dirty 使用。

    attachment 的 reader 把原始字节编码为可 JSON 的 data（content_b64 + id=sha256）；
    music_library 为账号级曲库清单快照。
    """
    readers: dict[str, Callable[[str], dict | None]] = {}
    if exp_repo is not None:
        readers["experiment"] = lambda eid: exp_repo.load(eid)
    if thread_repo is not None:
        readers["thread"] = lambda tid: thread_repo.load(tid)
        # 索引（含 user_profile）整体作为 thread_index 实体推送
        readers["thread_index"] = lambda eid: {"id": "index", **thread_repo.get_index()}
    if favorites_repo is not None:
        readers["favorites"] = lambda eid: {
            "id": "favorites", **favorites_repo.export_snapshot(favorites_repo._uid())}
    if analysis_repo is not None:
        readers["analysis"] = lambda aid: analysis_repo.load(aid)
    if update_log_repo is not None:
        readers["update_log"] = lambda eid: update_log_repo.get_entry_by_id(eid)
    if attachment_store is not None:
        readers["attachment"] = attachment_store.for_sync
        readers["music_library"] = lambda eid: attachment_store.export_music_library()
    return readers
