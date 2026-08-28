"""SQLite 仓储共享设施 — 用户作用域注入。

改造前各仓储 `_get_uid()` 隐式读 flask.g（仓储层依赖 Flask 上下文），
导致仓储无法脱离请求独立测试。现在通过构造注入 uid_provider 解析
当前用户 ID，依赖倒置到组装层（lib/container 或 app.py）。
"""

import threading
from typing import Callable, Optional

# 进程内所有 sqlite 连接共享的全局写锁：SQLite 单写者，跨连接串行化最干净，
# 从根上避免"多条连接并发写同一库 → database is locked"。
_DB_WRITE_LOCK = threading.RLock()


def _is_write(sql: str) -> bool:
    """自动提交模式下，只有会改变数据库的语句需要跨连接排队。"""
    keyword = sql.lstrip().split(None, 1)[0].upper() if sql.strip() else ""
    return keyword in {"ALTER", "CREATE", "DELETE", "DROP", "INSERT", "REINDEX", "REPLACE", "UPDATE", "VACUUM"}


class ThreadSafeConnection:
    """共享 sqlite 连接的线程安全薄代理。

    同一连接始终串行使用；不同连接的读取可并行。写入仍用全局锁串行化，
    避免后台同步的读取堵住页面读取，同时保留 SQLite 单写者保护。
    仓储只用到 row_factory/execute/executescript/commit，故代理覆盖这些就够。
    """

    def __init__(self, conn, lock: Optional[threading.RLock] = None) -> None:
        object.__setattr__(self, "_conn", conn)
        object.__setattr__(self, "_lock", lock or threading.RLock())
        # 自动提交模式：每条 DML 立即生效，杜绝"某仓储只写不 commit"留下开启的写事务，
        # 从而造成对该连接（乃至整个库）的永久写锁锁死。
        try:
            conn.isolation_level = None
        except Exception:
            pass

    @property
    def row_factory(self):
        return self._conn.row_factory

    @row_factory.setter
    def row_factory(self, value):
        with self._lock:
            self._conn.row_factory = value

    def execute(self, sql, parameters=()):
        if _is_write(sql):
            with _DB_WRITE_LOCK:
                with self._lock:
                    return self._conn.execute(sql, parameters)
        with self._lock:
            return self._conn.execute(sql, parameters)

    def executescript(self, sql):
        # 脚本内容无法可靠轻量地分类，按写操作保护。
        with _DB_WRITE_LOCK:
            with self._lock:
                return self._conn.executescript(sql)

    def commit(self):
        with _DB_WRITE_LOCK:
            with self._lock:
                return self._conn.commit()

    def __getattr__(self, name):
        return getattr(self._conn, name)


class UserScopeMixin:
    """提供 _uid() 用户作用域解析。

    容器在请求上下文中注入 `lambda: g.user_id`；无注入时返回 ""
    （离线模式 / 纯 Python 测试环境）。
    """

    def __init__(self, uid_provider: Callable[[], str] | None = None) -> None:
        self._uid_provider = uid_provider

    def _uid(self) -> str:
        return self._uid_provider() if self._uid_provider is not None else ""
