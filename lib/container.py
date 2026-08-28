"""应用容器 — 进程级全局状态的唯一宿主。

改造前同步服务注册表与连接列表散落在 app 模块级（app._sync_services /
app._sync_connections），路由通过反向 `import app` 读取（循环依赖）。
现在容器实例挂在 Flask extensions 上，路由经 `current_app.extensions`
访问；数据库连接与关闭钩子也统一由容器管理。
"""

from typing import Any, Callable


class AppContext:
    def __init__(self) -> None:
        self.sync_services: dict[str, Any] = {}  # user_id → SyncService
        self.sync_connections: list = []         # SyncService 独立 DB 连接
        self.connections: list = []              # 主 DB 连接（shutdown 时关闭）
        self._shutdown_hooks: list[Callable[[], None]] = []

    # -- 同步服务注册表 --

    def register_sync_service(self, user_id: str, svc: Any) -> None:
        self.sync_services[user_id] = svc

    def get_sync_service(self, user_id: str) -> Any | None:
        return self.sync_services.get(user_id)

    # -- 生命周期 --

    def add_shutdown_hook(self, fn: Callable[[], None]) -> None:
        self._shutdown_hooks.append(fn)

    def shutdown(self, timeout: float = 5.0) -> None:
        """优雅关闭：先停同步线程，再关同步连接，最后关主连接与钩子。"""
        for svc in list(self.sync_services.values()):
            try:
                svc.stop(timeout=timeout)
            except Exception:
                pass
        for c in self.sync_connections:
            try:
                c.close()
            except Exception:
                pass
        for c in self.connections:
            try:
                c.close()
            except Exception:
                pass
        for fn in self._shutdown_hooks:
            try:
                fn()
            except Exception:
                pass
