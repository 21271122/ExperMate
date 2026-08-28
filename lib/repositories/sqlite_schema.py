"""SQLite 建表 SQL 与字段默认值 — 公共常量。

原定义于 sqlite_experiment.py（下划线私有），被 offline.py / sync_service.py
跨模块引用，故提升为公共模块，成为 SQLite 模式的单一数据定义源。
"""

from typing import Any

SQL_CREATE_EXPERIMENTS = """
CREATE TABLE IF NOT EXISTS experiments (
    user_id       TEXT DEFAULT '',
    id            TEXT PRIMARY KEY,
    title         TEXT DEFAULT '',
    date          TEXT DEFAULT '',
    experimenter  TEXT DEFAULT '',
    status        TEXT DEFAULT 'planned',
    tags          TEXT DEFAULT '[]',
    purpose       TEXT DEFAULT '',
    materials     TEXT DEFAULT '[]',
    equipment     TEXT DEFAULT '[]',
    experimental_plan TEXT DEFAULT '[]',
    sop           TEXT DEFAULT '[]',
    process_parameters TEXT DEFAULT '[]',
    observations  TEXT DEFAULT '{"no_anomalies":true,"items":[]}',
    characterization TEXT DEFAULT '[]',
    results       TEXT DEFAULT '{"qualitative":"","key_data":[],"figures":[]}',
    conclusion    TEXT DEFAULT '',
    next_steps    TEXT DEFAULT '[]',
    original_notes TEXT DEFAULT '',
    "references"  TEXT DEFAULT '[]',
    analyzed_in   TEXT DEFAULT '[]',
    attachments   TEXT DEFAULT '[]',
    archived      INTEGER NOT NULL DEFAULT 0,
    archived_at   TEXT DEFAULT '',
    field_updated_at TEXT DEFAULT '{}',
    revision      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT DEFAULT '',
    updated_at    TEXT DEFAULT ''
)
"""

SQL_CREATE_FTS = """
CREATE VIRTUAL TABLE IF NOT EXISTS experiments_fts USING fts5(
    title, purpose, conclusion, original_notes,
    content='experiments', content_rowid='rowid'
)
"""

SQL_CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_exp_status ON experiments(status)",
    "CREATE INDEX IF NOT EXISTS idx_exp_date ON experiments(date)",
    "CREATE INDEX IF NOT EXISTS idx_exp_experimenter ON experiments(experimenter)",
]

FIELD_DEFAULTS: dict[str, Any] = {
    "title": "",
    "date": "",
    "experimenter": "",
    "status": "planned",
    "tags": [],
    "purpose": "",
    "materials": [],
    "equipment": [],
    "experimental_plan": [],
    "sop": [],
    "process_parameters": [],
    "observations": {"no_anomalies": True, "items": []},
    "characterization": [],
    "results": {"qualitative": "", "key_data": [], "figures": []},
    "conclusion": "",
    "next_steps": [],
    "original_notes": "",
    "references": [],
    "analyzed_in": [],
    "attachments": [],
    "archived": False,
    "archived_at": "",
}
