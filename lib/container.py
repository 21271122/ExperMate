"""服务端实例的数据库连接与关闭钩子。"""

from collections.abc import Callable


class AppContext:
    def __init__(self) -> None:
        self.connections: list = []              # 主 DB 连接（shutdown 时关闭）
        self._shutdown_hooks: list[Callable[[], None]] = []

    # -- 生命周期 --

    def add_shutdown_hook(self, fn: Callable[[], None]) -> None:
        self._shutdown_hooks.append(fn)

    def shutdown(self) -> None:
        """关闭主数据库连接及账号等服务资源。"""
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
