"""线程的 SQLite 仓储实现（替代 YAML ThreadRepository）。

覆盖要同步的「线程 / 线程索引 / 用户画像」：线程本体 → `threads` 表；
索引/运行态/画像 → `kv_store` 表。接口与 `AbstractThreadRepository` 完全一致，
路由经 `g.thread_repo` 调用零改动。

表结构：
- threads(id, user_id, type, status, title, summary, exp/anal_generated,
          selected_exps, experiment_type, messages, branches, created, updated)
  （messages/branches/selected_exps 存 JSON）
- kv_store(user_id, key, value, updated_at)，PK(user_id,key) ——
  key ∈ {index, current_state, global_context, child_state:<tid>}

同步语义：线程本体/索引/画像为可同步"资产快照"；current_state / child_state /
global_context 为设备本地运行时状态（入库统一存储但不上传）——写钩子由上层区分。
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime
from typing import Any

from lib.repositories.base import (
    AbstractExperimentRepository,
    AbstractThreadRepository,
    AbstractUpdateLogRepository,
)
from lib.repositories.sqlite_common import UserScopeMixin
from lib.experiment_ids import is_experiment_id

_JSON_FIELDS = ("selected_exps", "messages", "branches")

_INDEX_DEFAULT_USER_PROFILE: dict[str, Any] = {
    "experimenter_counts": {},
    "default_experimenter": "",
    "tag_counts": {},
    "frequent_tags": [],
    "last_updated": "",
}


class SqliteThreadRepository(AbstractThreadRepository, UserScopeMixin):
    def __init__(self, db: sqlite3.Connection, uid_provider=None, on_dirty=None) -> None:
        UserScopeMixin.__init__(self, uid_provider)
        self.db = db
        self.db.row_factory = sqlite3.Row
        self._on_dirty = on_dirty
        self._index_cache: dict[str, Any] | None = None
        self._l0_generated_at: datetime | None = None
        self._l0_cache: str | None = None
        self._l0_cache_at: datetime | None = None
        self._create_tables()

    # ------------------------------------------------------------------ DDL

    def _migrate_threads_pk(self) -> None:
        """迁移: threads 表 PK 从 id → (user_id, id)，修复多用户数据互相覆盖。"""
        try:
            row = self.db.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='threads'"
            ).fetchone()
            if row and "PRIMARY KEY" in (row["sql"] or ""):
                sql = row["sql"]
                # 已是 (user_id, id) 复合 PK → 无需迁移
                if "PRIMARY KEY (user_id, id)" in sql or 'PRIMARY KEY("user_id", "id")' in sql:
                    return
                # 旧 schema: id TEXT PRIMARY KEY → 需迁移
                if "PRIMARY KEY (id)" in sql or 'PRIMARY KEY ("id")' in sql:
                    self.db.executescript("""
                        CREATE TABLE IF NOT EXISTS threads_new (
                            user_id       TEXT DEFAULT '',
                            id            TEXT NOT NULL,
                            "type"        TEXT DEFAULT '',
                            status        TEXT DEFAULT 'active',
                            title         TEXT DEFAULT '',
                            summary       TEXT DEFAULT '',
                            exp_generated TEXT DEFAULT '',
                            anal_generated TEXT DEFAULT '',
                            selected_exps TEXT DEFAULT '[]',
                            experiment_type TEXT DEFAULT 'other',
                            messages      TEXT DEFAULT '[]',
                            branches      TEXT DEFAULT '[]',
                            created       TEXT DEFAULT '',
                            updated       TEXT DEFAULT '',
                            PRIMARY KEY (user_id, id)
                        );
                        INSERT OR IGNORE INTO threads_new
                            SELECT * FROM threads;
                        DROP TABLE threads;
                        ALTER TABLE threads_new RENAME TO threads;
                        CREATE INDEX IF NOT EXISTS idx_threads_uid ON threads(user_id, updated DESC);
                    """)
                    print("[MIGRATE] threads PK migrated: id → (user_id, id)")
        except Exception as e:
            print(f"[MIGRATE] threads PK migration skipped: {e}")

    def _create_tables(self) -> None:
        self.db.execute("PRAGMA foreign_keys=ON")
        self._migrate_threads_pk()
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS threads (
                user_id       TEXT DEFAULT '',
                id            TEXT NOT NULL,
                "type"        TEXT DEFAULT '',
                status        TEXT DEFAULT 'active',
                title         TEXT DEFAULT '',
                summary       TEXT DEFAULT '',
                exp_generated TEXT DEFAULT '',
                anal_generated TEXT DEFAULT '',
                selected_exps TEXT DEFAULT '[]',
                experiment_type TEXT DEFAULT 'other',
                messages      TEXT DEFAULT '[]',
                branches      TEXT DEFAULT '[]',
                created       TEXT DEFAULT '',
                updated       TEXT DEFAULT '',
                PRIMARY KEY (user_id, id)
            );
            CREATE TABLE IF NOT EXISTS kv_store (
                user_id    TEXT DEFAULT '',
                key        TEXT NOT NULL,
                value      TEXT DEFAULT '{}',
                updated_at TEXT DEFAULT '',
                PRIMARY KEY (user_id, key)
            );
            CREATE TABLE IF NOT EXISTS compressed_history (
                user_id      TEXT DEFAULT '',
                session_id   TEXT NOT NULL,
                sequence     INTEGER NOT NULL,
                role         TEXT DEFAULT '',
                payload      TEXT NOT NULL,
                compressed_at TEXT DEFAULT '',
                PRIMARY KEY (user_id, session_id, sequence)
            );
            CREATE INDEX IF NOT EXISTS idx_threads_uid ON threads(user_id, updated DESC);
            CREATE INDEX IF NOT EXISTS idx_compressed_history_session
                ON compressed_history(user_id, session_id, sequence);
            """
        )
        has_fts = self.db.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_history_fts'"
        ).fetchone() is not None
        self.db.execute("""
            CREATE VIRTUAL TABLE IF NOT EXISTS chat_history_fts USING fts5(
                user_id UNINDEXED, session_id UNINDEXED, sequence UNINDEXED,
                role UNINDEXED, created_at UNINDEXED, content
            )
        """)
        if not has_fts:
            self._backfill_chat_history_fts()

    # ------------------------------------------------------------ 标记脏

    def _mark_dirty(self, entity_id: str, tombstone: bool = False) -> None:
        if self._on_dirty is not None:
            self._on_dirty(entity_id, tombstone)

    # ------------------------------------------------------------ KV 助手

    def _kv_get(self, key: str) -> dict[str, Any]:
        row = self.db.execute(
            "SELECT value FROM kv_store WHERE user_id=? AND key=?", (self._uid(), key)
        ).fetchone()
        if row is None or not row["value"]:
            return {}
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return {}

    def _kv_set(self, key: str, value: dict[str, Any]) -> None:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.db.execute(
            "INSERT OR REPLACE INTO kv_store (user_id, key, value, updated_at) VALUES (?,?,?,?)",
            (self._uid(), key, json.dumps(value, ensure_ascii=False), now),
        )
        self.db.commit()

    # ------------------------------------------------------------ 线程 CRUD

    def next_id(self) -> str:
        year = datetime.now().strftime("%Y")
        uid = self._uid()
        row = self.db.execute(
            "SELECT id FROM threads WHERE user_id=? AND id LIKE ? ORDER BY id DESC LIMIT 1",
            (uid, f"THR-{year}-%"),
        ).fetchone()
        if row:
            m = re.match(rf"^THR-{year}-(\d{{3}})$", row["id"])
            if m:
                return f"THR-{year}-{int(m.group(1)) + 1:03d}"
        return f"THR-{year}-001"

    def create(self, thread_type: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
        tid = self.next_id()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        thread: dict[str, Any] = {
            "id": tid,
            "type": thread_type,
            "status": "active",
            "created": now,
            "updated": now,
            "title": "",
            "summary": "",
            "messages": messages,
            "branches": [],
        }
        if thread_type == "record":
            thread["experiment_type"] = "other"
            thread["exp_generated"] = ""
        elif thread_type == "analyze":
            thread["anal_generated"] = ""
            thread["selected_exps"] = []
        self.save(thread)
        self._append_thread_entry(tid, thread_type, "active", "", "", now, now)
        return thread

    def save(self, thread_data: dict[str, Any]) -> None:
        tid = thread_data["id"]
        now = thread_data.get("updated") or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.db.execute(
            "INSERT OR REPLACE INTO threads "
            "(user_id,id,type,status,title,summary,exp_generated,anal_generated,"
            " selected_exps,experiment_type,messages,branches,created,updated) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                self._uid(), tid,
                thread_data.get("type", ""),
                thread_data.get("status", "active"),
                thread_data.get("title", ""),
                thread_data.get("summary", ""),
                thread_data.get("exp_generated", ""),
                thread_data.get("anal_generated", ""),
                json.dumps(thread_data.get("selected_exps", []), ensure_ascii=False),
                thread_data.get("experiment_type", "other"),
                json.dumps(thread_data.get("messages", []), ensure_ascii=False),
                json.dumps(thread_data.get("branches", []), ensure_ascii=False),
                thread_data.get("created", now),
                now,
            ),
        )
        self.db.commit()
        self.update_index(thread_data)
        self._index_cache = None
        self._mark_dirty(tid)

    def load(self, thread_id: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "SELECT * FROM threads WHERE user_id=? AND id=?", (self._uid(), thread_id)
        ).fetchone()
        return self._row_to_thread(row) if row else None

    def _row_to_thread(self, row: sqlite3.Row) -> dict[str, Any]:
        d = dict(row)
        for f in _JSON_FIELDS:
            if isinstance(d.get(f), str):
                try:
                    d[f] = json.loads(d[f])
                except json.JSONDecodeError:
                    d[f] = []
        return d

    # ------------------------------------------------------------ 索引

    def _load_index(self) -> dict[str, Any]:
        if self._index_cache is not None:
            return self._index_cache
        idx = self._kv_get("index") or {}
        idx.setdefault("active_thread", None)
        idx.setdefault("threads", [])
        idx.setdefault("exp_to_thread", {})
        idx.setdefault("anal_to_thread", {})
        idx.setdefault("user_profile", dict(_INDEX_DEFAULT_USER_PROFILE))
        self._index_cache = idx
        return idx

    def get_index(self) -> dict[str, Any]:
        return json.loads(json.dumps(self._load_index()))  # 深拷贝，防外部改动污染缓存

    def set_index(self, data: dict[str, Any]) -> None:
        """整体写回索引（供同步拉取落库）。入参含 user_profile 一并生效。"""
        idx = json.loads(json.dumps(data))
        idx.setdefault("active_thread", None)
        idx.setdefault("threads", [])
        idx.setdefault("exp_to_thread", {})
        idx.setdefault("anal_to_thread", {})
        idx.setdefault("user_profile", dict(_INDEX_DEFAULT_USER_PROFILE))
        self._index_cache = idx
        self._kv_set("index", idx)

    def update_index(self, thread_data: dict[str, Any]) -> None:
        idx = self._load_index()
        tid = thread_data["id"]
        entry = {
            "id": tid,
            "type": thread_data.get("type", "record"),
            "status": thread_data.get("status", "done"),
            "title": thread_data.get("title", ""),
            "summary": thread_data.get("summary", ""),
            "exp_generated": thread_data.get("exp_generated", ""),
            "created": thread_data.get("created", ""),
            "updated": thread_data.get("updated", ""),
        }
        replaced = False
        for i, t in enumerate(idx["threads"]):
            if t.get("id") == tid:
                idx["threads"][i] = entry
                replaced = True
                break
        if not replaced:
            idx["threads"].insert(0, entry)
        if entry["exp_generated"] and entry["exp_generated"] not in idx["exp_to_thread"]:
            idx["exp_to_thread"][entry["exp_generated"]] = tid
        if thread_data.get("anal_generated") and \
                thread_data["anal_generated"] not in idx["anal_to_thread"]:
            idx["anal_to_thread"][thread_data["anal_generated"]] = tid
        self._index_cache = idx
        self._kv_set("index", idx)

    def _append_thread_entry(self, tid, ttype, status, title, summary, created, updated) -> None:
        idx = self._load_index()
        idx["threads"].insert(0, {
            "id": tid, "type": ttype, "status": status, "title": title,
            "summary": summary, "created": created, "updated": updated,
        })
        self._index_cache = idx
        self._kv_set("index", idx)

    # ------------------------------------------------------------ 活跃线程

    def get_active_thread(self) -> dict[str, Any] | None:
        idx = self._load_index()
        active_id = idx.get("active_thread")
        return self.load(active_id) if active_id else None

    def set_active_thread(self, thread_id: str | None) -> None:
        idx = self._load_index()
        prev = idx.get("active_thread")
        if thread_id is None:
            if prev:
                t = self.load(prev)
                if t:
                    t["status"] = "done"
                    self.save(t)
            idx["active_thread"] = None
        else:
            if prev and prev != thread_id:
                t = self.load(prev)
                if t:
                    t["status"] = "done"
                    self.save(t)
            idx["active_thread"] = thread_id
        self._index_cache = idx
        self._kv_set("index", idx)

    def list_recent(self, n: int = 5) -> list[dict[str, Any]]:
        return list(self._load_index().get("threads", [])[:n])

    # ------------------------------------------------------------ 运行态(本地)

    def save_current_state(self, agent_state: dict[str, Any]) -> None:
        self._kv_set("current_state", agent_state)

    def load_current_state(self) -> dict[str, Any] | None:
        state = self._kv_get("current_state")
        return state if state else None

    def save_child_state(self, thread_id: str, agent_state: dict[str, Any]) -> None:
        self._kv_set(f"child_state:{thread_id}", agent_state)

    def load_child_state(self, thread_id: str) -> dict[str, Any] | None:
        state = self._kv_get(f"child_state:{thread_id}")
        return state if state else None

    def delete_child_state(self, thread_id: str) -> None:
        self.db.execute(
            "DELETE FROM kv_store WHERE user_id=? AND key=?",
            (self._uid(), f"child_state:{thread_id}"),
        )
        self.db.commit()

    # ------------------------------------------------------------ 压缩历史归档（本地）

    def archive_compressed_history(
        self, session_id: str, start_sequence: int, messages: list[dict[str, Any]],
    ) -> None:
        """逐条保存被裁剪的完整原始消息，供后续聊天检索使用。"""
        if not messages:
            return
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        rows = [
            (
                self._uid(), session_id, start_sequence + offset,
                message.get("role", ""), json.dumps(message, ensure_ascii=False), now,
            )
            for offset, message in enumerate(messages)
        ]
        self.db.executemany(
            "INSERT OR IGNORE INTO compressed_history "
            "(user_id,session_id,sequence,role,payload,compressed_at) VALUES (?,?,?,?,?,?)",
            rows,
        )
        for offset, message in enumerate(messages):
            if not self._is_visible_chat_message(message):
                continue
            sequence = start_sequence + offset
            self.db.execute(
                "DELETE FROM chat_history_fts WHERE user_id=? AND session_id=? AND sequence=?",
                (self._uid(), session_id, sequence),
            )
            self.db.execute(
                "INSERT INTO chat_history_fts "
                "(user_id,session_id,sequence,role,created_at,content) VALUES (?,?,?,?,?,?)",
                (self._uid(), session_id, sequence, message.get("role", ""),
                 str(message.get("created_at") or ""), self._chat_text(message)),
            )
        self.db.commit()

    def _backfill_chat_history_fts(self) -> None:
        """首次升级时只为可见的压缩消息建立索引，保留原始 payload 作为唯一真相。"""
        rows = self.db.execute(
            "SELECT user_id,session_id,sequence,payload FROM compressed_history"
        ).fetchall()
        for row in rows:
            try:
                message = json.loads(row["payload"])
            except (TypeError, json.JSONDecodeError):
                continue
            if not self._is_visible_chat_message(message):
                continue
            self.db.execute(
                "INSERT INTO chat_history_fts "
                "(user_id,session_id,sequence,role,created_at,content) VALUES (?,?,?,?,?,?)",
                (row["user_id"], row["session_id"], row["sequence"],
                 message.get("role", ""), str(message.get("created_at") or ""),
                 self._chat_text(message)),
            )
        self.db.commit()

    def list_compressed_history(self, session_id: str) -> list[dict[str, Any]]:
        """按原始顺序读取某个会话已压缩的完整消息。"""
        rows = self.db.execute(
            "SELECT payload FROM compressed_history WHERE user_id=? AND session_id=? "
            "ORDER BY sequence",
            (self._uid(), session_id),
        ).fetchall()
        messages = []
        for row in rows:
            try:
                messages.append(json.loads(row["payload"]))
            except (TypeError, json.JSONDecodeError):
                continue
        return messages

    @staticmethod
    def _is_visible_chat_message(message: dict[str, Any]) -> bool:
        """与聊天页保持一致：不把系统标记或无展示内容的工具结果当作聊天记录。"""
        role = message.get("role")
        if role == "system":
            return False
        if role == "assistant":
            return bool(str(message.get("content") or "").strip())
        if role != "tool":
            return bool(str(message.get("content") or "").strip())
        try:
            result = json.loads(message.get("content") or "{}")
        except (TypeError, json.JSONDecodeError):
            return False
        return bool(result.get("display"))

    @staticmethod
    def _chat_text(message: dict[str, Any]) -> str:
        """生成搜索用的可读正文，避免把 reasoning 或工具调用参数暴露给界面。"""
        content = message.get("content") or ""
        if message.get("role") != "tool":
            return str(content)
        try:
            result = json.loads(content) if isinstance(content, str) else content
        except (TypeError, json.JSONDecodeError):
            return ""
        if not isinstance(result, dict):
            return ""
        display = result.get("display")
        if isinstance(display, str):
            return display
        for key in ("message", "title", "summary"):
            if result.get(key):
                return str(result[key])
        return ""

    @staticmethod
    def _public_chat_message(message: dict[str, Any]) -> dict[str, Any]:
        """聊天检索只返回渲染需要的字段，原始 reasoning 仍留在本地归档。"""
        return {
            "role": message.get("role", ""),
            "content": message.get("content", ""),
            "created_at": message.get("created_at", ""),
            "tool_call_id": message.get("tool_call_id", ""),
            "tool_calls": message.get("tool_calls") or [],
        }

    def _chat_history_rows(
        self, session_id: str | None = None, current_state: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        """合并压缩归档和当前未压缩尾部，sequence 在整个会话内保持连续。"""
        sql = (
            "SELECT session_id,sequence,payload FROM compressed_history "
            "WHERE user_id=?"
        )
        params: list[Any] = [self._uid()]
        if session_id:
            sql += " AND session_id=?"
            params.append(session_id)
        sql += " ORDER BY session_id,sequence"
        rows: list[dict[str, Any]] = []
        for row in self.db.execute(sql, params).fetchall():
            try:
                message = json.loads(row["payload"])
            except (TypeError, json.JSONDecodeError):
                continue
            rows.append({"session_id": row["session_id"], "sequence": row["sequence"],
                         "message": message})

        state = current_state if current_state is not None else (self.load_current_state() or {})
        active_session = state.get("_session_id") or state.get("session_id")
        if active_session and (not session_id or session_id == active_session):
            try:
                offset = max(0, int(state.get("_compressed_history_count") or 0))
            except (TypeError, ValueError):
                offset = 0
            rows.extend({"session_id": active_session, "sequence": offset + index,
                         "message": message}
                        for index, message in enumerate(state.get("history") or []))

        # 当前状态和归档交界处即使异常重叠，也应优先采用当前状态的最新副本。
        merged = {(row["session_id"], row["sequence"]): row for row in rows}
        return sorted(merged.values(), key=lambda row: (row["session_id"], row["sequence"]))

    def page_chat_history(
        self, session_id: str, before_sequence: int | None = None, limit: int = 50,
        current_state: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """为主聊天页合并已压缩原文与当前尾部，按原始序号向前分页。"""
        limit = max(1, min(int(limit), 100))
        rows = self._chat_history_rows(session_id, current_state=current_state)
        total = (max((int(row["sequence"]) for row in rows), default=-1) + 1)
        end = total if before_sequence is None else max(0, min(int(before_sequence), total))
        start = max(0, end - limit)
        page = [row for row in rows if start <= int(row["sequence"]) < end]
        return {
            "history": [
                {**dict(row["message"]), "_sequence": int(row["sequence"])}
                for row in page
            ],
            "history_start": start,
            "history_total": total,
        }

    def search_chat_history(
        self, query: str, session_id: str | None = None, date_from: str | None = None,
        date_to: str | None = None, limit: int = 20,
    ) -> list[dict[str, Any]]:
        """按正文查找压缩归档和当前尾部；结果只返回简短摘要和稳定定位。"""
        needle = (query or "").strip().casefold()
        if not needle:
            return []
        limit = max(1, min(int(limit), 50))
        # 优先用 FTS 检索压缩归档；不能解析的查询或短语未命中时兼容回退到 LIKE。
        sql = (
            "SELECT c.session_id,c.sequence,c.payload FROM chat_history_fts f "
            "JOIN compressed_history c ON c.user_id=f.user_id AND c.session_id=f.session_id "
            "AND c.sequence=f.sequence WHERE f.user_id=? AND f.content MATCH ?"
        )
        params: list[Any] = [self._uid(), '"' + query.replace('"', '""') + '"']
        if session_id:
            sql += " AND f.session_id=?"
            params.append(session_id)
        try:
            archived_rows = self.db.execute(sql, params).fetchall()
        except sqlite3.OperationalError:
            archived_rows = []
        if not archived_rows:
            fallback_sql = (
                "SELECT session_id,sequence,payload FROM compressed_history "
                "WHERE user_id=? AND payload LIKE ? COLLATE NOCASE"
            )
            fallback_params: list[Any] = [self._uid(), f"%{query}%"]
            if session_id:
                fallback_sql += " AND session_id=?"
                fallback_params.append(session_id)
            archived_rows = self.db.execute(fallback_sql, fallback_params).fetchall()

        rows = []
        for row in archived_rows:
            try:
                message = json.loads(row["payload"])
            except (TypeError, json.JSONDecodeError):
                continue
            rows.append({"session_id": row["session_id"], "sequence": row["sequence"],
                         "message": message})

        # 当前尾部还没有被压缩，数量受到上下文上限控制，直接在内存中筛选即可。
        state = self.load_current_state() or {}
        active_session = state.get("_session_id") or state.get("session_id")
        if active_session and (not session_id or session_id == active_session):
            try:
                offset = max(0, int(state.get("_compressed_history_count") or 0))
            except (TypeError, ValueError):
                offset = 0
            rows.extend({"session_id": active_session, "sequence": offset + index,
                         "message": message}
                        for index, message in enumerate(state.get("history") or []))

        results = []
        for row in rows:
            message = row["message"]
            if not self._is_visible_chat_message(message):
                continue
            created_at = str(message.get("created_at") or "")
            if date_from and created_at[:10] < date_from:
                continue
            if date_to and created_at[:10] > date_to:
                continue
            text = self._chat_text(message)
            if needle not in text.casefold():
                continue
            at = text.casefold().find(needle)
            start = max(0, at - 80)
            end = min(len(text), at + len(needle) + 160)
            results.append({
                "session_id": row["session_id"], "sequence": row["sequence"],
                "role": message.get("role", ""), "created_at": created_at,
                "snippet": text[start:end],
            })
        results.sort(key=lambda item: (item["created_at"], item["session_id"], item["sequence"]),
                     reverse=True)
        return results[:limit]

    def read_chat_history_context(
        self, session_id: str, sequence: int, before: int = 3, after: int = 3,
    ) -> dict[str, Any] | None:
        """读取某条命中消息前后的少量可见记录，不会一次返回整个会话。"""
        before = max(0, min(int(before), 10))
        after = max(0, min(int(after), 10))
        rows = [row for row in self._chat_history_rows(session_id)
                if self._is_visible_chat_message(row["message"])]
        target = next((index for index, row in enumerate(rows)
                       if row["sequence"] == sequence), None)
        if target is None:
            return None
        start = max(0, target - before)
        end = min(len(rows), target + after + 1)
        return {
            "session_id": session_id,
            "target_sequence": sequence,
            "has_older": start > 0,
            "has_newer": end < len(rows),
            "messages": [{
                "sequence": row["sequence"],
                **self._public_chat_message(row["message"]),
            } for row in rows[start:end]],
        }

    def list_chat_sessions(self, limit: int = 20) -> list[dict[str, Any]]:
        """列出有可见消息的会话，供按时间翻阅而不是靠关键词猜测。"""
        limit = max(1, min(int(limit), 100))
        rows = self.db.execute(
            "SELECT session_id, MAX(created_at) AS latest_at, COUNT(*) AS message_count "
            "FROM chat_history_fts WHERE user_id=? GROUP BY session_id "
            "ORDER BY latest_at DESC, session_id DESC LIMIT ?",
            (self._uid(), limit),
        ).fetchall()
        result = [dict(row) for row in rows]
        state = self.load_current_state() or {}
        session_id = state.get("_session_id") or state.get("session_id")
        if session_id:
            messages = [m for m in state.get("history") or [] if self._is_visible_chat_message(m)]
            if messages:
                latest_at = str(messages[-1].get("created_at") or "")
                existing = next((item for item in result if item["session_id"] == session_id), None)
                if existing:
                    existing["latest_at"] = max(str(existing.get("latest_at") or ""), latest_at)
                    existing["message_count"] = int(existing.get("message_count") or 0) + len(messages)
                else:
                    result.append({"session_id": session_id, "latest_at": latest_at,
                                   "message_count": len(messages)})
        result.sort(key=lambda item: (str(item.get("latest_at") or ""), item["session_id"]), reverse=True)
        return result[:limit]

    def browse_chat_history(self, session_id: str, before_sequence: int | None = None,
                             limit: int = 20) -> dict[str, Any]:
        """按时间从新到旧分页读取一个会话的可见消息。"""
        limit = max(1, min(int(limit), 100))
        rows = [row for row in self._chat_history_rows(session_id)
                if self._is_visible_chat_message(row["message"])]
        if before_sequence is not None:
            rows = [row for row in rows if row["sequence"] < before_sequence]
        page = rows[-limit:]
        return {
            "session_id": session_id,
            "has_older": len(rows) > len(page),
            "next_before_sequence": page[0]["sequence"] if page else None,
            "messages": [{"sequence": row["sequence"], **self._public_chat_message(row["message"])}
                         for row in page],
        }

    # ------------------------------------------------------------ L0 摘要 / 全局上下文

    _L0_TTL_SECONDS = 300  # 5 分钟缓存

    def build_global_summary(
        self,
        exp_repo: AbstractExperimentRepository,
        update_log_repo: AbstractUpdateLogRepository | None,
    ) -> str:
        """SQL 聚合生成 L0 摘要，输出格式与 YAML 版保持一致。"""
        # 缓存命中：5 分钟内直接返回
        if (self._l0_cache is not None and self._l0_cache_at is not None
                and (datetime.now() - self._l0_cache_at).total_seconds() < self._L0_TTL_SECONDS):
            self._l0_generated_at = self._l0_cache_at
            return self._l0_cache

        uid = self._uid()
        lines: list[str] = []

        total = exp_repo.count() if exp_repo else 0
        if total > 0:
            rows = self.db.execute(
                "SELECT status, COUNT(*) AS c FROM experiments "
                "WHERE user_id=? GROUP BY status", (uid,),
            ).fetchall() if hasattr(self, "db") else []
            # 兜底：仓储若无先生成文件表，回退到 exp_repo 聚合
            statuses = {"done": 0, "running": 0, "failed": 0, "planned": 0}
            for r in rows:
                if r["status"] in statuses:
                    statuses[r["status"]] = r["c"]
            detail = []
            for st, label in [("done", "已完成"), ("running", "进行中"),
                              ("failed", "失败"), ("planned", "计划中")]:
                if statuses.get(st, 0) > 0:
                    detail.append(f"{label}: {statuses[st]}")
            parts = [f"当前实验库共 {total} 条实验"]
            if detail:
                parts.append("（" + ", ".join(detail) + "）")
            lines.append("".join(parts) + "。")

        done_threads = [t for t in self.list_recent(5) if t.get("status") == "done"]
        if done_threads:
            display = []
            for t in done_threads[:3]:
                exp = t.get("exp_generated", "")
                title = t.get("title", "")[:20]
                if exp:
                    display.append(f"{t['id']}→{exp} {title}".strip())
                else:
                    display.append(f"{t['id']} {title}".strip())
            lines.append(f"最近完成: {', '.join(display)}。")

        profile = self.get_user_profile()
        freq_tags = profile.get("frequent_tags", [])
        if freq_tags:
            tag_display = ", ".join(
                f"{t}({profile.get('tag_counts', {}).get(t, '?')})" for t in freq_tags[:6]
            )
            lines.append(f"你的常用标签: {tag_display}。")

        if update_log_repo:
            try:
                modified = []
                for t in done_threads[:5]:
                    exp_id = t.get("exp_generated", "")
                    if is_experiment_id(exp_id):
                        logs = update_log_repo.list_recent(exp_id, limit=1)
                        if logs and logs[0].get("source") != "system":
                            changed = [c.get("field", "") for c in logs[0].get("changes", [])]
                            if changed:
                                modified.append(f"{exp_id}（{', '.join(changed[:3])}）")
                if modified:
                    lines.append(f"近期被修改的实验: {', '.join(modified[:3])}。")
            except Exception:
                pass

        self._l0_generated_at = datetime.now()
        result = "\n".join(lines) if lines else "暂无实验记录。"
        self._l0_cache = result
        self._l0_cache_at = self._l0_generated_at
        return result

    def invalidate_l0_cache(self) -> None:
        """清除 L0 缓存，下次 build_global_summary 会重新查询。"""
        self._l0_cache = None
        self._l0_cache_at = None

    def get_l0_generated_at(self) -> datetime | None:
        return self._l0_generated_at

    def get_global_context(self) -> str:
        gc = self._kv_get("global_context")
        return str(gc.get("compressed", ""))

    def update_global_context(
        self,
        compressed_text: str,
        uncompressed_thread_ids: list[str] | None = None,
        recently_modified_exps: list[str] | None = None,
    ) -> None:
        self._kv_set("global_context", {
            "compressed": compressed_text,
            "uncompressed_thread_ids": uncompressed_thread_ids or [],
            "recently_modified_exps": recently_modified_exps or [],
            "last_compressed_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        })

    # ------------------------------------------------------------ 用户画像

    def get_user_profile(self) -> dict[str, Any]:
        return dict(self._load_index().get("user_profile", {}))

    def update_user_profile(self, exp_data: dict[str, Any]) -> None:
        idx = self._load_index()
        profile = idx.setdefault("user_profile", {})
        for k, v in _INDEX_DEFAULT_USER_PROFILE.items():
            profile.setdefault(k, v)
        experimenter = (exp_data.get("experimenter") or "").strip()
        if experimenter:
            counts = profile.setdefault("experimenter_counts", {})
            counts[experimenter] = counts.get(experimenter, 0) + 1
            if counts.get(experimenter, 0) >= counts.get(profile.get("default_experimenter", ""), 0):
                profile["default_experimenter"] = experimenter
        profile["last_updated"] = datetime.now().strftime("%Y-%m-%d")
        self._index_cache = idx
        self._kv_set("index", idx)

    def recalc_tag_counts(self, exp_repo: AbstractExperimentRepository) -> None:
        idx = self._load_index()
        profile = idx.setdefault("user_profile", {})
        for k, v in _INDEX_DEFAULT_USER_PROFILE.items():
            profile.setdefault(k, v)
        tag_counts: dict[str, int] = {}
        if exp_repo:
            for exp in exp_repo.list_all_full():
                for tag in exp.get("tags", []):
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1
        sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)
        profile["tag_counts"] = tag_counts
        profile["frequent_tags"] = [t for t, _ in sorted_tags[:10]]
        profile["last_updated"] = datetime.now().strftime("%Y-%m-%d")
        self._index_cache = idx
        self._kv_set("index", idx)
