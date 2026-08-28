"""Exdiary v2 — 新同步网关的实时后台拉取（SSE 即时 + 周期兜底）。

补上旧 SyncService._watch 对应能力在新网关上缺失的那一环，并做得更健壮：
- **SSE 线程**：订阅中继 /watch，收到 'sync' 事件立即 pull（即时推送）。
- **周期拉取线程**：每 poll_interval 秒 pull 一次作安全网 —— 设备没连上 /watch、
  通知被错过、或设备刚从离线回来时，也能在几秒内收敛，不会错过更新。

两线程都在请求上下文(设 g.user_id)里执行 gateway.pull()/push_dirty_now()，
用户作用域正确；engine 读写在 SyncGateway 内由 self._lock 串行化。
"""

from __future__ import annotations

import threading
import time
from typing import Any

import requests
from flask import g


class GatewayWatcher:
    """实时同步 watcher：SSE 即时 + 周期兜底，双向（pull + 回推 dirty）。"""

    def __init__(
        self,
        app: Any,
        account: str,
        gateway: Any,
        relay_url: str,
        account_key: str,
        timeout: tuple[float, float] = (5, 60),
        poll_interval: float = 3.0,
        reconnect_delay: float = 10.0,
    ) -> None:
        self._app = app
        self._account = account
        self._gw = gateway
        self._url = relay_url.rstrip("/")
        self._key = account_key
        self._timeout = timeout
        self._poll_interval = poll_interval
        self._reconnect_delay = reconnect_delay
        self._stop = threading.Event()
        self._sse_thread: threading.Thread | None = None
        self._poll_thread: threading.Thread | None = None

    # ---- 核心：一次拉取 + 回推（在请求上下文里保证用户作用域）----

    def _sync_once(self) -> None:
        with self._app.app_context():
            with self._app.test_request_context():
                g.user_id = self._account
                self._gw.pull()
                self._gw.push_dirty_now()

    # ---- SSE 线程（即时推送）----

    def _sse_loop(self) -> None:
        while not self._stop.is_set():
            try:
                r = requests.get(
                    f"{self._url}/api/relay/{self._account}/watch",
                    headers={"X-Account-Key": self._key},
                    stream=True, timeout=self._timeout,
                )
                if r.status_code != 200:
                    if self._stop.wait(self._reconnect_delay):
                        break
                    continue
                for line in r.iter_lines(decode_unicode=True):
                    if self._stop.is_set():
                        break
                    if line == "event: sync":
                        try:
                            self._sync_once()
                        except Exception:
                            pass  # 单次同步失败不崩线程；下个事件/周期再试
            except Exception:
                pass
            if not self._stop.is_set():
                if self._stop.wait(self._reconnect_delay):
                    break

    # ---- 周期拉取线程（兜底：收敛任何被错过的通知）----

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._sync_once()
            except Exception:
                pass
            if self._stop.wait(self._poll_interval):
                break

    def start(self) -> "GatewayWatcher":
        if self._sse_thread is None or not self._sse_thread.is_alive():
            self._sse_thread = threading.Thread(target=self._sse_loop, daemon=True)
            self._sse_thread.start()
        if self._poll_thread is None or not self._poll_thread.is_alive():
            self._poll_thread = threading.Thread(target=self._poll_loop, daemon=True)
            self._poll_thread.start()
        return self

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        for t in (self._sse_thread, self._poll_thread):
            if t is not None and t.is_alive():
                t.join(timeout=timeout)


# 进程级：account -> GatewayWatcher（避免同一账号重复起线程）
_watchers: dict[str, GatewayWatcher] = {}


def ensure_watcher(
    app: Any,
    container: Any,
    account: str,
    gateway: Any,
    relay_url: str,
    account_key: str,
) -> GatewayWatcher:
    """为一个已建立网关的账号启动后台 watcher（幂等；容器 shutdown 时停线程）。"""
    existing = _watchers.get(account)
    if existing is not None:
        return existing
    w = GatewayWatcher(app, account, gateway, relay_url, account_key)
    w.start()
    _watchers[account] = w
    container.add_shutdown_hook(w.stop)
    return w


def backfill_experiments(app: Any, container: Any, account: str, gateway: Any,
                         db_path: str, uid_provider: Any) -> None:
    """后台补推：把当前账号所有"还没同步过"的实验全量推送到中继。

    场景：某些实验是在网关激活前生成的（或某次上传失败、进程重启丢了内存态），
    只存在于本地明文库、local_entity 里没有 → 登录后补推，保证对端能看到。
    只推 local_entity 里还没有的（避免每次登录重复推已同步的）；失败由
    watcher 的 push_dirty_now() 兜底重试。后台线程执行，不阻塞登录/请求。
    """
    import sqlite3
    import threading
    from lib.repositories.sqlite_experiment import SqliteExperimentRepository

    def _work() -> None:
        conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        try:
            synced: set[str] = set()
            try:
                rows = conn.execute(
                    "SELECT entity_id FROM local_entity "
                    "WHERE account_id=? AND entity_type='experiment'",
                    (account,),
                ).fetchall()
                synced = {r["entity_id"] for r in rows}
            except Exception:
                synced = set()
            repo = SqliteExperimentRepository(conn, uid_provider=lambda: account)
            pushed = 0
            for exp in repo.list_all_full():
                eid = exp.get("id")
                if not eid or eid in synced:
                    continue
                try:
                    gateway.push("experiment", exp)  # 已存在则 bump revision；云端更新则 relay 409 不强盖
                    pushed += 1
                except Exception:
                    pass  # 失败交给 watcher 的 push_dirty_now 兜底
            if pushed:
                try:
                    gateway.push_dirty_now()
                except Exception:
                    pass
        finally:
            conn.close()

    threading.Thread(target=_work, daemon=True).start()


# 进程级去重：为每个账号只起一次补推线程（避免重复触发）
_backfilled: set[str] = set()


def ensure_backfill(app: Any, container: Any, account: str, gateway: Any,
                    db_path: str, uid_provider: Any) -> None:
    """幂等触发登录后台补推（每个账号每个进程一次）。"""
    if account in _backfilled:
        return
    _backfilled.add(account)
    backfill_experiments(app, container, account, gateway, db_path, uid_provider)


# 进程级：account -> 已启动的全量推送线程（登录后把本地全部实验后台推上中继）
_reconciled: dict[str, threading.Thread] = {}


def ensure_reconcile(
    app: Any,
    container: Any,
    account: str,
    gateway: Any,
    exp_repo: Any,
) -> None:
    """登录后**后台**把该账号当前的所有实验全量推上中继（幂等，每进程每账号一次）。

    用于补齐"网关激活前就存在 / 之前 push 失败漏掉"的本地实验：枚举明文仓储里该
    账号的全部实验，逐个经 gateway.push 加密写本地镜像并推送到中继；对端因此能拉到。
    全程在 daemon 线程 + 请求上下文里跑，不阻塞登录与正常使用。
    """
    if account in _reconciled:
        return

    def _run() -> None:
        try:
            with app.app_context():
                with app.test_request_context():
                    g.user_id = account
                    exps = list(exp_repo.list_all_full() or [])
                    for exp in exps:
                        try:
                            gateway.push("experiment", exp)
                        except Exception:
                            pass  # 单条失败不阻断；其余照常推
        except Exception:
            pass

    t = threading.Thread(target=_run, name=f"reconcile-{account}", daemon=True)
    t.start()
    _reconciled[account] = t
    container.add_shutdown_hook(lambda: t.join(timeout=5))  # 停机时最多等 5s（reconcile 是后台推送）
