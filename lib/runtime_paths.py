"""服务端应用根目录与运行数据目录解析。"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_DATA_DIR_ENV_KEYS = ("EXPERMATE_DATA_DIR", "EXDIARY_DATA_DIR")


def app_root() -> Path:
    """应用根目录的唯一定义。

    - 打包（sys.frozen）状态下：可执行文件所在目录（onedir/onefile 均成立）；
    - 源码运行时：项目根目录（本文件位于 lib/ 下，向上两级）。

    全项目“项目根/应用根”的推导必须统一走这里——PyInstaller 打包后
    `__file__` 会指向 `_internal`，任何用 `Path(__file__).parent` 推导的
    根目录都会在打包后落错位置。
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def resolve_data_dir(project_root: Path) -> Path:
    """返回运行数据目录；新变量优先，保留旧变量兼容。"""
    raw = next((os.environ.get(key, "").strip() for key in _DATA_DIR_ENV_KEYS
                if os.environ.get(key, "").strip()), "")
    if raw:
        candidate = Path(raw).expanduser()
        return candidate if candidate.is_absolute() else project_root / candidate
    return project_root / "data"
