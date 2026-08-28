"""离线模式支持: 双数据库切换 + 数据导入迁移。"""

import json
import sqlite3
from pathlib import Path

from lib.repositories.sqlite_experiment import SqliteExperimentRepository
from lib.runtime_paths import app_root, resolve_data_dir


def offline_db_path() -> Path:
    data_dir = resolve_data_dir(app_root())
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "offline.db"


def init_offline_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(offline_db_path()), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    # 复用公共建表 SQL，避免两份维护
    from lib.repositories.sqlite_schema import SQL_CREATE_EXPERIMENTS
    conn.execute(SQL_CREATE_EXPERIMENTS)
    return conn


def has_offline_data() -> bool:
    if not offline_db_path().exists():
        return False
    conn = init_offline_db()
    count = conn.execute("SELECT COUNT(*) FROM experiments").fetchone()[0]
    conn.close()
    return count > 0


def offline_experiment_count() -> int:
    if not offline_db_path().exists():
        return 0
    conn = init_offline_db()
    count = conn.execute("SELECT COUNT(*) FROM experiments").fetchone()[0]
    conn.close()
    return count


def migrate_offline_to_user(db_conn: sqlite3.Connection, user_id: str) -> int:
    """将 offline.db 的实验迁移到线上 data.db。ID 冲突时重新分配。返回导入条数。"""
    if not offline_db_path().exists():
        return 0
    off_conn = init_offline_db()
    rows = off_conn.execute("SELECT * FROM experiments").fetchall()
    imported = 0
    for row in rows:
        d = dict(row)
        # 去掉 id——让 SqliteExperimentRepository 自动分配新 ID，避免与线上已有实验冲突
        d.pop("id", None)
        d.pop("created_at", None)
        d.pop("updated_at", None)
        d.pop("user_id", None)
        # JSON 字符串 → Python 对象（offline.db 存的是 JSON 文本）
        json_fields = {
            "tags", "materials", "equipment", "experimental_plan",
            "sop", "process_parameters", "characterization",
            "next_steps", "references", "analyzed_in", "attachments",
        }
        for key in json_fields:
            if isinstance(d.get(key), str):
                try:
                    d[key] = json.loads(d[key])
                except json.JSONDecodeError:
                    d[key] = []
        for key in ("observations", "results"):
            if isinstance(d.get(key), str):
                try:
                    d[key] = json.loads(d[key])
                except json.JSONDecodeError:
                    d[key] = {} if key == "results" else {"no_anomalies": True, "items": []}
        repo = SqliteExperimentRepository(db_conn)
        repo.save(d)
        imported += 1
    off_conn.close()
    return imported


def clear_offline_data() -> None:
    if not offline_db_path().exists():
        return
    conn = init_offline_db()
    conn.execute("DELETE FROM experiments")
    conn.close()
