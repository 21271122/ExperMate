"""实验记录的 SQLite 仓储实现。替代 YamlExperimentRepository。"""

import json
import sqlite3
from datetime import datetime
from typing import Any

from lib.experiment_ids import new_device_code, normalize_device_code
from lib.repositories.base import AbstractExperimentRepository
from lib.repositories.sqlite_common import UserScopeMixin
from lib.repositories.sqlite_schema import (
    FIELD_DEFAULTS,
    SQL_CREATE_EXPERIMENTS,
    SQL_CREATE_FTS,
    SQL_CREATE_INDEXES,
)

_JSON_FIELDS: set[str] = {
    "tags", "materials", "equipment", "experimental_plan",
    "sop", "process_parameters", "characterization",
    "next_steps", "references", "analyzed_in", "attachments",
    "field_updated_at",
}

_SCHEMA_VERSION = 6


class SqliteExperimentRepository(AbstractExperimentRepository, UserScopeMixin):
    def __init__(self, db: sqlite3.Connection, uid_provider=None, device_code: str = "") -> None:
        """uid_provider: 请求上下文注入的用户 ID 解析。"""
        UserScopeMixin.__init__(self, uid_provider)
        self.db = db
        self.device_code = normalize_device_code(device_code) or new_device_code()
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self._create_tables()

    def _create_tables(self) -> None:
        self.db.execute(SQL_CREATE_EXPERIMENTS)
        self.db.execute(SQL_CREATE_FTS)
        self.db.execute("""CREATE TABLE IF NOT EXISTS experiment_id_counters (
            year TEXT NOT NULL, device_code TEXT NOT NULL, next_number INTEGER NOT NULL,
            PRIMARY KEY (year, device_code)
        )""")
        for stmt in SQL_CREATE_INDEXES:
            self.db.execute(stmt)
        cur = self.db.execute("PRAGMA user_version").fetchone()[0]
        if cur < 2:
            try:
                self.db.execute("ALTER TABLE experiments ADD COLUMN user_id TEXT DEFAULT ''")
            except sqlite3.OperationalError:
                pass
            self.db.execute("INSERT INTO experiments_fts(experiments_fts) VALUES('rebuild')")
        if cur < 3:
            try:
                self.db.execute("ALTER TABLE experiments ADD COLUMN field_updated_at TEXT DEFAULT '{}'")
            except sqlite3.OperationalError:
                pass
        if cur < 5:
            try:
                self.db.execute("ALTER TABLE experiments ADD COLUMN revision INTEGER NOT NULL DEFAULT 0")
            except sqlite3.OperationalError:
                pass
        if cur < 6:
            try:
                self.db.execute("ALTER TABLE experiments ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            except sqlite3.OperationalError:
                pass
            try:
                self.db.execute("ALTER TABLE experiments ADD COLUMN archived_at TEXT DEFAULT ''")
            except sqlite3.OperationalError:
                pass
            self.db.execute("CREATE INDEX IF NOT EXISTS idx_exp_archived ON experiments(user_id, archived)")
        if cur < _SCHEMA_VERSION:
            self.db.execute(f"PRAGMA user_version = {_SCHEMA_VERSION}")
        # FTS 触发器：INSERT OR REPLACE 后自动更新全文索引
        self.db.execute("""CREATE TRIGGER IF NOT EXISTS exp_fts_insert AFTER INSERT ON experiments BEGIN
            INSERT INTO experiments_fts(rowid, title, purpose, conclusion, original_notes)
            VALUES (new.rowid, new.title, new.purpose, new.conclusion, new.original_notes); END;""")
        self.db.execute("""CREATE TRIGGER IF NOT EXISTS exp_fts_delete AFTER DELETE ON experiments BEGIN
            INSERT INTO experiments_fts(experiments_fts, rowid, title, purpose, conclusion, original_notes)
            VALUES ('delete', old.rowid, old.title, old.purpose, old.conclusion, old.original_notes); END;""")
        self.db.execute("""CREATE TRIGGER IF NOT EXISTS exp_fts_update AFTER UPDATE ON experiments BEGIN
            INSERT INTO experiments_fts(experiments_fts, rowid, title, purpose, conclusion, original_notes)
            VALUES ('delete', old.rowid, old.title, old.purpose, old.conclusion, old.original_notes);
            INSERT INTO experiments_fts(rowid, title, purpose, conclusion, original_notes)
            VALUES (new.rowid, new.title, new.purpose, new.conclusion, new.original_notes); END;""")

    def next_id(self) -> str:
        year = datetime.now().strftime("%Y")
        row = self.db.execute(
            """INSERT INTO experiment_id_counters (year,device_code,next_number) VALUES (?,?,2)
               ON CONFLICT(year,device_code) DO UPDATE SET next_number=next_number+1
               RETURNING next_number-1 AS allocated""",
            (year, self.device_code),
        ).fetchone()
        return f"{year}-{self.device_code}-{int(row['allocated']):03d}"

    def save(self, experiment: dict[str, Any], user_id: str | None = None) -> str:
        exp_id = experiment.get("id") or self.next_id()
        experiment["id"] = exp_id
        uid = user_id if user_id is not None else self._uid()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        # 字段级 diff：加载旧记录，只给变化的字段打新时间戳
        old = self.load(exp_id, user_id=uid)
        fua = dict(old.get("field_updated_at", {}) if old else {})
        revision = int(old.get("revision", 0) or 0) + 1 if old else 1
        row: dict[str, Any] = {"user_id": uid, "id": exp_id, "updated_at": now,
                               "revision": revision}
        for key, default in FIELD_DEFAULTS.items():
            val = old.get(key, default) if old and key in ("archived", "archived_at") and key not in experiment else experiment.get(key, default)
            if key == "archived":
                row[key] = 1 if val else 0
            else:
                row[key] = json.dumps(val, ensure_ascii=False) if isinstance(val, (list, dict)) else str(val)
            old_val = old.get(key) if old else None
            if json.dumps(val, sort_keys=True) != json.dumps(old_val, sort_keys=True):
                fua[key] = now
        row["field_updated_at"] = json.dumps(fua, ensure_ascii=False)
        row["created_at"] = experiment.get("created_at") or now
        quoted_cols = ", ".join(f'"{c}"' for c in row)
        placeholders = ", ".join("?" * len(row))
        updates = ", ".join(f'"{key}"=excluded."{key}"' for key in row if key != "id")
        cursor = self.db.execute(
            f"INSERT INTO experiments ({quoted_cols}) VALUES ({placeholders}) "
            f"ON CONFLICT(id) DO UPDATE SET {updates} WHERE experiments.user_id=excluded.user_id",
            list(row.values()),
        )
        if not cursor.rowcount:
            raise ValueError("记录编号不可用，请重新创建记录")
        self.db.commit()
        experiment["revision"] = revision
        return exp_id

    def save_if_revision(self, experiment: dict[str, Any], expected_revision: int,
                         user_id: str | None = None) -> dict[str, Any]:
        """仅当记录仍处于 expected_revision 时保存，避免旧窗口覆盖新修改。"""
        exp_id = experiment.get("id")
        uid = user_id if user_id is not None else self._uid()
        if not exp_id:
            return {"ok": False, "error": "missing_id"}
        old = self.load(exp_id, user_id=uid)
        if old is None:
            return {"ok": False, "error": "not_found"}
        actual_revision = int(old.get("revision", 0) or 0)
        if expected_revision != actual_revision:
            return {"ok": False, "error": "revision_conflict", "revision": actual_revision}

        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        fua = dict(old.get("field_updated_at", {}))
        row: dict[str, Any] = {"updated_at": now, "revision": actual_revision + 1}
        for key, default in FIELD_DEFAULTS.items():
            val = old.get(key, default) if key in ("archived", "archived_at") and key not in experiment else experiment.get(key, default)
            if key == "archived":
                row[key] = 1 if val else 0
            else:
                row[key] = json.dumps(val, ensure_ascii=False) if isinstance(val, (list, dict)) else str(val)
            if json.dumps(val, sort_keys=True) != json.dumps(old.get(key), sort_keys=True):
                fua[key] = now
        row["field_updated_at"] = json.dumps(fua, ensure_ascii=False)
        row["created_at"] = experiment.get("created_at") or old.get("created_at") or now
        assignments = ", ".join(f'"{key}"=?' for key in row)
        values = list(row.values()) + [exp_id, uid, actual_revision]
        cursor = self.db.execute(
            f"UPDATE experiments SET {assignments} WHERE id=? AND user_id=? AND revision=?", values
        )
        if cursor.rowcount != 1:
            current = self.load(exp_id, user_id=uid) or {}
            return {"ok": False, "error": "revision_conflict",
                    "revision": int(current.get("revision", 0) or 0)}
        self.db.commit()
        experiment["revision"] = actual_revision + 1
        return {"ok": True, "revision": actual_revision + 1}


    def load(self, exp_id: str, user_id: str | None = None) -> dict[str, Any] | None:
        uid = user_id if user_id is not None else self._uid()
        row = self.db.execute(
            "SELECT * FROM experiments WHERE id = ? AND user_id = ?",
            (exp_id, uid),
        ).fetchone()
        if row is None:
            return None
        return _row_to_dict(row)

    def list_all(self, include_archived: bool = False) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT id, title, date, experimenter, status, tags, archived "
            "FROM experiments WHERE user_id = ? "
            + ("" if include_archived else "AND archived = 0 ") + "ORDER BY id DESC",
            (self._uid(),),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    def list_page(self, page: int = 1, page_size: int = 20, query: str = "",
                  status: str = "", include_archived: bool = False) -> dict[str, Any]:
        """服务端筛选与分页，仅返回列表摘要；完整内容按 ID 读取。"""
        clauses = ["user_id = ?"]
        params: list[Any] = [self._uid()]
        if not include_archived:
            clauses.append("archived = 0")
        if status:
            clauses.append("status = ?")
            params.append(status)
        if query:
            escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            fields = ("id", "title", "experimenter", "tags", "purpose", "conclusion")
            clauses.append("(" + " OR ".join(f"{field} LIKE ? ESCAPE '\\'" for field in fields) + ")")
            params.extend([f"%{escaped}%"] * len(fields))
        where = " AND ".join(clauses)
        total = self.db.execute(
            f"SELECT COUNT(*) FROM experiments WHERE {where}", params,
        ).fetchone()[0]
        rows = self.db.execute(
            "SELECT id, title, date, experimenter, status, tags, archived, revision, "
            f"substr(purpose, 1, 200) AS purpose FROM experiments WHERE {where} "
            "ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
            [*params, page_size, (page - 1) * page_size],
        ).fetchall()
        return {"items": [_row_to_dict(row) for row in rows], "total": total,
                "page": page, "page_size": page_size}

    def list_for_list_view(self, include_archived: bool = False) -> list[dict[str, Any]]:
        """实验列表首屏与本地筛选所需字段，避免传输完整实验正文。"""
        rows = self.db.execute(
            "SELECT id, title, date, experimenter, status, tags, purpose, conclusion, "
            "sop, materials, observations, archived, archived_at "
            "FROM experiments WHERE user_id = ? "
            + ("" if include_archived else "AND archived = 0 ") + "ORDER BY id DESC",
            (self._uid(),),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    def list_all_full(self, include_archived: bool = False) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT * FROM experiments WHERE user_id = ? "
            + ("" if include_archived else "AND archived = 0 ") + "ORDER BY id DESC",
            (self._uid(),),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]

    def set_archived(self, exp_id: str, archived: bool,
                     expected_revision: int | None = None) -> dict[str, Any]:
        """切换归档状态；与普通编辑一样使用 revision 防止静默覆盖。"""
        exp = self.load(exp_id)
        if exp is None:
            return {"ok": False, "error": "not_found"}
        revision = int(exp.get("revision", 0) or 0)
        if expected_revision is not None and expected_revision != revision:
            return {"ok": False, "error": "revision_conflict", "revision": revision}
        exp["archived"] = bool(archived)
        exp["archived_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S") if archived else ""
        return self.save_if_revision(exp, revision)

    def update(self, exp_id: str, experiment: dict[str, Any]) -> bool:
        row = self.db.execute(
            "SELECT id FROM experiments WHERE id = ? AND user_id = ?",
            (exp_id, self._uid()),
        ).fetchone()
        if row is None:
            return False
        experiment["id"] = exp_id
        self.save(experiment)
        return True

    def delete(self, exp_id: str, user_id: str | None = None) -> bool:
        uid = user_id if user_id is not None else self._uid()
        cur = self.db.execute(
            "DELETE FROM experiments WHERE id = ? AND user_id = ?",
            (exp_id, uid),
        )
        return cur.rowcount > 0


    def count(self, include_archived: bool = False) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM experiments WHERE user_id = ? "
            + ("" if include_archived else "AND archived = 0"),
            (self._uid(),),
        ).fetchone()[0]

    def search(self, query: str, include_archived: bool = False) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT e.*, f.rank as _fts_rank FROM experiments e "
            "JOIN experiments_fts f ON e.rowid = f.rowid "
            "WHERE experiments_fts MATCH ? AND e.user_id = ? "
            + ("" if include_archived else "AND e.archived = 0 ") + "ORDER BY rank LIMIT 20",
            (query, self._uid()),
        ).fetchall()
        results = []
        for r in rows:
            d = _row_to_dict(r)
            d["_score"] = _rank_to_score(-r["_fts_rank"])  # rank 越小=越相关
            results.append(d)
        return results

    def summarize_all(self, exp_ids: list[str] | None = None) -> str:
        uid = self._uid()
        if exp_ids:
            placeholders = ", ".join("?" * len(exp_ids))
            rows = self.db.execute(
                f"SELECT * FROM experiments WHERE id IN ({placeholders}) "
                "AND user_id = ? ORDER BY id DESC",
                exp_ids + [uid],
            ).fetchall()
        else:
            rows = self.db.execute(
                "SELECT * FROM experiments WHERE user_id = ? AND archived = 0 ORDER BY id DESC",
                (uid,),
            ).fetchall()
        if not rows:
            return "No experiments found."
        parts: list[str] = []
        for r in rows:
            d = _row_to_dict(r)
            results = d.get("results", {}) or {}
            obs = d.get("observations", {}) or {}
            obs_items = obs.get("items", []) if isinstance(obs, dict) else []
            parts.append(
                f"### {d['id']}: {d.get('title', '')}\n"
                f"Date: {d.get('date', '')} | Status: {d.get('status', '')} "
                f"| Tags: {', '.join(d.get('tags', []))}\n"
                f"Purpose: {str(d.get('purpose', ''))[:300]}\n"
                f"Conclusion: {str(d.get('conclusion', ''))[:300]}\n"
                f"Key Results: {str(results.get('qualitative', ''))[:200]}\n"
                f"Observations: {'; '.join(obs_items)[:200]}\n"
            )
        return "\n---\n".join(parts)


def _rank_to_score(rank: float) -> float:
    """FTS5 rank 映射到 [0, 1] 分数。rank 越小 = 越相关。"""
    if rank <= 0:
        return 0.99
    return round(max(0.1, 1.0 / (1.0 + rank / 10.0)), 2)


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    d = dict(row)
    for key in _JSON_FIELDS:
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except json.JSONDecodeError:
                pass
    for key in ("observations", "results"):
        if key in d and isinstance(d[key], str):
            try:
                d[key] = json.loads(d[key])
            except json.JSONDecodeError:
                pass
    if "archived" in d:
        d["archived"] = str(d["archived"]).lower() in ("1", "true", "yes")
    return d
