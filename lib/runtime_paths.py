"""运行数据目录与根目录旧数据的一次性迁移。"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

_DATA_DIR_ENV_KEYS = ("EXPERMATE_DATA_DIR", "EXDIARY_DATA_DIR")
_SQLITE_FILES = ("data.db", "offline.db", "_e2ee_accounts.db")


def resolve_data_dir(project_root: Path) -> Path:
    """返回运行数据目录；新变量优先，保留旧变量兼容。"""
    raw = next((os.environ.get(key, "").strip() for key in _DATA_DIR_ENV_KEYS
                if os.environ.get(key, "").strip()), "")
    if raw:
        candidate = Path(raw).expanduser()
        return candidate if candidate.is_absolute() else project_root / candidate
    return project_root / "data"


def _move_path(source: Path, destination: Path) -> bool:
    if not source.exists() or destination.exists():
        return False
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(source), str(destination))
    return True


def _move_sqlite_bundle(source: Path, destination: Path) -> bool:
    """移动 SQLite 主文件及 WAL/SHM；目标存在时绝不混合或覆盖。"""
    if not source.exists() or destination.exists():
        return False
    companions = [(source, destination)]
    for suffix in ("-wal", "-shm"):
        src, dst = Path(f"{source}{suffix}"), Path(f"{destination}{suffix}")
        if dst.exists():
            return False
        if src.exists():
            companions.append((src, dst))
    moved: list[tuple[Path, Path]] = []
    try:
        # 先移动附属文件，最后移动主文件；失败时尽力恢复原位置。
        for src, dst in [*companions[1:], companions[0]]:
            _move_path(src, dst)
            moved.append((src, dst))
    except OSError:
        for src, dst in reversed(moved):
            if dst.exists() and not src.exists():
                try:
                    shutil.move(str(dst), str(src))
                except OSError:
                    pass
        raise
    return bool(moved)


def prepare_runtime_data(project_root: Path) -> Path:
    """创建数据目录，并迁移尚未使用新目录的根目录运行数据。

    该函数只在新位置完全不存在时迁移，绝不会覆盖目标文件。迁移 SQLite
    时主文件、WAL、SHM 作为一个整体处理，避免只移动主文件造成数据缺失。
    """
    data_dir = resolve_data_dir(project_root)
    data_dir.mkdir(parents=True, exist_ok=True)
    default_dir = project_root / "data"
    if data_dir.resolve() != default_dir.resolve():
        return data_dir

    for name in _SQLITE_FILES:
        # 显式覆盖路径仍由调用方负责，不应擅自搬迁根目录数据库。
        if name == "data.db" and os.environ.get("EXDIARY_DB"):
            continue
        if name == "_e2ee_accounts.db" and os.environ.get("EXDIARY_ACCOUNT_DB"):
            continue
        _move_sqlite_bundle(project_root / name, data_dir / name)

    if not os.environ.get("EXDIARY_KMS_KEY_FILE"):
        _move_path(project_root / "_e2ee_kms.key", data_dir / "_e2ee_kms.key")

    # 新附件在 SQLite 内；此处仅迁移旧上传接口仍会读取的兼容文件。
    _move_path(project_root / "uploads", data_dir / "uploads")
    _move_path(project_root / "_history", data_dir / "_history")
    _move_path(project_root / "experiments" / "_logs", data_dir / "_logs")
    return data_dir
