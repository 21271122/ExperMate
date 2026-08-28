"""实验更新日志的 SQLite 仓储实现。"""

import json
import re
import sqlite3
from datetime import datetime
from typing import Any

from lib.repositories.base import AbstractUpdateLogRepository
from lib.repositories.sqlite_common import UserScopeMixin


class SqliteUpdateLogRepository(AbstractUpdateLogRepository, UserScopeMixin):
    def __init__(self, db: sqlite3.Connection, uid_provider=None, on_dirty=None) -> None:
        """on_dirty: 写入后同步标记回调（更新日志实体）。"""
        UserScopeMixin.__init__(self, uid_provider)
        self.db = db
        self._on_dirty = on_dirty
        self.db.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS update_logs (
                user_id    TEXT DEFAULT '',
                entry_id   TEXT NOT NULL,
                exp_id     TEXT NOT NULL,
                "timestamp" TEXT DEFAULT '',
                source     TEXT DEFAULT '',
                thread_id  TEXT DEFAULT '',
                context    TEXT DEFAULT '{}',
                changes    TEXT DEFAULT '[]',
                PRIMARY KEY (user_id, entry_id)
            )
        """)
        self.db.execute(
            "CREATE INDEX IF NOT EXISTS idx_logs_exp ON update_logs(user_id, exp_id, \"timestamp\" DESC)"
        )
        try:
            self.db.execute("ALTER TABLE update_logs ADD COLUMN user_id TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass

    def _mark_dirty(self, entry_id: str) -> None:
        if self._on_dirty is not None:
            self._on_dirty(entry_id, False)

    def _next_entry_id(self, exp_id: str) -> str:
        exp_key = re.sub(r"[^A-Z0-9]", "", exp_id.upper())[-12:] or "UNKNOWN"
        prefix = f"UPD-{exp_key}-"
        rows = self.db.execute(
            "SELECT entry_id FROM update_logs WHERE entry_id LIKE ? ORDER BY entry_id DESC LIMIT 1",
            (f"{prefix}%",),
        ).fetchall()
        max_n = 0
        if rows:
            try:
                max_n = int(rows[0]["entry_id"].split("-")[-1])
            except (ValueError, IndexError):
                pass
        return f"{prefix}{max_n + 1:03d}"

    def append(
        self,
        exp_id: str,
        source: str,
        changes: list[dict[str, Any]],
        context: dict[str, Any] | None = None,
        thread_id: str | None = None,
    ) -> str:
        entry_id = self._next_entry_id(exp_id)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.db.execute(
            "INSERT INTO update_logs (user_id,entry_id,exp_id,\"timestamp\",source,thread_id,context,changes) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                self._uid(), entry_id, exp_id, now, source, thread_id or "",
                json.dumps(context or {}, ensure_ascii=False),
                json.dumps(changes, ensure_ascii=False),
            ),
        )
        self._mark_dirty(entry_id)
        return entry_id

    def list_recent(self, exp_id: str, limit: int = 5) -> list[dict[str, Any]]:
        rows = self.db.execute(
            'SELECT * FROM update_logs WHERE exp_id = ? AND user_id = ? ORDER BY "timestamp" DESC LIMIT ?',
            (exp_id, self._uid(), limit),
        ).fetchall()
        return [_row_to_entry(r) for r in rows]

    def list_all(self, exp_id: str) -> list[dict[str, Any]]:
        rows = self.db.execute(
            'SELECT * FROM update_logs WHERE exp_id = ? AND user_id = ? ORDER BY "timestamp" DESC',
            (exp_id, self._uid()),
        ).fetchall()
        return [_row_to_entry(r) for r in rows]

    def get_entry(self, exp_id: str, entry_id: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "SELECT * FROM update_logs WHERE entry_id = ? AND exp_id = ? AND user_id = ?",
            (entry_id, exp_id, self._uid()),
        ).fetchone()
        return _row_to_entry(row) if row else None

    # ---- 同步接口 ----

    def get_entry_by_id(self, entry_id: str) -> dict | None:
        row = self.db.execute(
            "SELECT * FROM update_logs WHERE entry_id = ?", (entry_id,)
        ).fetchone()
        return _row_to_entry(row) if row else None

    def import_entry(self, entry: dict) -> None:
        self.db.execute(
            "INSERT OR REPLACE INTO update_logs "
            "(user_id, entry_id, exp_id, \"timestamp\", source, thread_id, context, changes) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (
                entry.get("user_id", ""), entry["entry_id"], entry["exp_id"],
                entry.get("timestamp", ""), entry.get("source", ""),
                entry.get("thread_id", ""),
                json.dumps(entry.get("context", {}), ensure_ascii=False),
                json.dumps(entry.get("changes", []), ensure_ascii=False),
            ),
        )


def _row_to_entry(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for key in ("context", "changes"):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except json.JSONDecodeError:
                pass
    return d
