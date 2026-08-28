"""跨实验分析报告的 SQLite 仓储实现。替代 YamlAnalysisRepository。"""

import json
import sqlite3
from datetime import datetime
from typing import Any

from lib.repositories.base import AbstractAnalysisRepository
from lib.repositories.sqlite_common import UserScopeMixin
from lib.experiment_ids import new_device_code, normalize_device_code


class SqliteAnalysisRepository(AbstractAnalysisRepository, UserScopeMixin):
    def __init__(self, db: sqlite3.Connection, uid_provider=None, on_dirty=None,
                 device_code: str = "") -> None:
        """on_dirty: 写入/删除后同步标记回调 (entity_id, tombstone)。"""
        UserScopeMixin.__init__(self, uid_provider)
        self.db = db
        self._on_dirty = on_dirty
        self.device_code = normalize_device_code(device_code) or new_device_code()
        self.db.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS analyses (
                user_id      TEXT DEFAULT '',
                id           TEXT PRIMARY KEY,
                "timestamp"  TEXT DEFAULT '',
                question     TEXT DEFAULT '',
                selected_ids TEXT DEFAULT '[]',
                analysis     TEXT DEFAULT '',
                source_snapshot TEXT DEFAULT '{}',
                created_at   TEXT DEFAULT ''
            )
        """)
        try:
            self.db.execute("ALTER TABLE analyses ADD COLUMN user_id TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass
        try:
            self.db.execute("ALTER TABLE analyses ADD COLUMN source_snapshot TEXT DEFAULT '{}'")
        except sqlite3.OperationalError:
            pass
        self.db.execute("""CREATE TABLE IF NOT EXISTS analysis_id_counters (
            year TEXT NOT NULL, device_code TEXT NOT NULL, next_number INTEGER NOT NULL,
            PRIMARY KEY (year, device_code)
        )""")

    def next_id(self) -> str:
        year = datetime.now().strftime("%Y")
        row = self.db.execute(
            """INSERT INTO analysis_id_counters (year,device_code,next_number) VALUES (?,?,2)
               ON CONFLICT(year,device_code) DO UPDATE SET next_number=next_number+1
               RETURNING next_number-1 AS allocated""",
            (year, self.device_code),
        ).fetchone()
        return f"ANAL-{year}-{self.device_code}-{int(row['allocated']):03d}"

    def save(self, analysis: dict[str, Any], user_id: str | None = None) -> str:
        uid = user_id if user_id is not None else self._uid()
        aid = analysis.get("id") or self.next_id()
        analysis["id"] = aid
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.db.execute(
            'INSERT OR REPLACE INTO analyses ("user_id","id","timestamp","question","selected_ids","analysis","source_snapshot","created_at") '
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                uid,
                aid,
                analysis.get("timestamp", now),
                analysis.get("question", ""),
                json.dumps(analysis.get("selected_ids", []), ensure_ascii=False),
                analysis.get("analysis", ""),
                json.dumps(analysis.get("source_snapshot", {}), ensure_ascii=False),
                analysis.get("created_at", now),
            ),
        )
        if self._on_dirty is not None:
            self._on_dirty(aid, False)
        return aid

    def load(self, aid: str, user_id: str | None = None) -> dict[str, Any] | None:
        uid = user_id if user_id is not None else self._uid()
        row = self.db.execute(
            "SELECT * FROM analyses WHERE id = ? AND user_id = ?", (aid, uid)
        ).fetchone()
        if row is None:
            return None
        d = dict(row)
        try:
            d["selected_ids"] = json.loads(d.get("selected_ids", "[]"))
        except json.JSONDecodeError:
            d["selected_ids"] = []
        try:
            d["source_snapshot"] = json.loads(d.get("source_snapshot", "{}"))
        except json.JSONDecodeError:
            d["source_snapshot"] = {}
        return d

    def list_all(self) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT user_id,id,\"timestamp\",question,selected_ids,analysis,created_at "
            "FROM analyses WHERE user_id = ? ORDER BY created_at DESC, id DESC", (self._uid(),)
        ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            d = dict(row)
            try:
                d["selected_ids"] = json.loads(d.get("selected_ids", "[]"))
            except json.JSONDecodeError:
                d["selected_ids"] = []
            results.append(d)
        return results

    def delete(self, aid: str, user_id: str | None = None) -> bool:
        uid = user_id if user_id is not None else self._uid()
        cur = self.db.execute(
            "DELETE FROM analyses WHERE id = ? AND user_id = ?", (aid, uid)
        )
        if cur.rowcount > 0:
            if self._on_dirty is not None:
                self._on_dirty(aid, True)
        return cur.rowcount > 0
