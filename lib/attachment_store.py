"""附件二进制本体的 SQLite 存储 — 内容寻址。

把附件图片等**二进制本体**收进 SQLite，
以内容 sha256 为地址（content-addressed）：
- 相同内容 → 相同 sha256 → 同一行（天然去重、天然完整性校验）；
- 换设备/跨库同步时可凭 sha256 判断"云端是否已有该文件"，只传一次。

表 `attachments(user_id, sha256, size, mime, name, data BLOB, created_at)`，以
`(user_id, sha256)` 为主键。
data 存原始字节（BLOB）。本模块只做存储；与上传路由/同步引擎的接线属同步阶段。
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import datetime
from typing import Any

from lib.repositories.sqlite_common import UserScopeMixin


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


class SqliteAttachmentStore(UserScopeMixin):
    def __init__(self, db: sqlite3.Connection, uid_provider=None, on_dirty=None,
                 on_music_library_dirty=None) -> None:
        UserScopeMixin.__init__(self, uid_provider)
        self.db = db
        self.db.row_factory = sqlite3.Row
        self._on_dirty = on_dirty
        self._on_music_library_dirty = on_music_library_dirty
        self._create_tables()

    def _create_tables(self) -> None:
        self.db.execute(
            """
            CREATE TABLE IF NOT EXISTS attachments (
                user_id    TEXT NOT NULL DEFAULT '',
                sha256     TEXT NOT NULL,
                size       INTEGER DEFAULT 0,
                mime       TEXT DEFAULT '',
                name       TEXT DEFAULT '',
                data       BLOB,
                created_at TEXT DEFAULT '',
                sync_state TEXT DEFAULT 'local',
                synced_at  TEXT DEFAULT '',
                PRIMARY KEY (user_id, sha256)
            );
            """
        )
        info = self.db.execute("PRAGMA table_info(attachments)").fetchall()
        columns = {row["name"] for row in info}
        primary_key = [row["name"] for row in sorted(info, key=lambda row: row["pk"]) if row["pk"]]
        # 早期版本以 sha256 单列为主键，两个账号上传相同文件会彼此覆盖。
        if primary_key != ["user_id", "sha256"]:
            sync_state = "sync_state" if "sync_state" in columns else "'local'"
            synced_at = "synced_at" if "synced_at" in columns else "''"
            self.db.executescript("""
                CREATE TABLE attachments_v2 (
                    user_id TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL,
                    size INTEGER DEFAULT 0, mime TEXT DEFAULT '', name TEXT DEFAULT '',
                    data BLOB, created_at TEXT DEFAULT '', sync_state TEXT DEFAULT 'local',
                    synced_at TEXT DEFAULT '', PRIMARY KEY (user_id, sha256)
                );
            """)
            self.db.execute(
                "INSERT OR IGNORE INTO attachments_v2 "
                "(user_id,sha256,size,mime,name,data,created_at,sync_state,synced_at) "
                f"SELECT user_id,sha256,size,mime,name,data,created_at,{sync_state},{synced_at} FROM attachments"
            )
            self.db.executescript("DROP TABLE attachments; ALTER TABLE attachments_v2 RENAME TO attachments;")
        else:
            if "sync_state" not in columns:
                self.db.execute("ALTER TABLE attachments ADD COLUMN sync_state TEXT DEFAULT 'local'")
            if "synced_at" not in columns:
                self.db.execute("ALTER TABLE attachments ADD COLUMN synced_at TEXT DEFAULT ''")
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS music_tracks (
                user_id TEXT NOT NULL DEFAULT '', sha256 TEXT NOT NULL,
                title TEXT DEFAULT '', added_at TEXT DEFAULT '',
                PRIMARY KEY (user_id, sha256)
            )"""
        )
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS music_playback (
                user_id TEXT PRIMARY KEY, playing INTEGER NOT NULL DEFAULT 0,
                track_id TEXT DEFAULT '', updated_at TEXT DEFAULT ''
            )"""
        )
        self.db.commit()

    def _mark_dirty(self, sha: str, tombstone: bool = False) -> None:
        if self._on_dirty is not None:
            self._on_dirty(sha, tombstone)

    def _mark_music_library_dirty(self) -> None:
        if self._on_music_library_dirty is not None:
            self._on_music_library_dirty("library")

    def put(self, content: bytes, name: str = "", mime: str = "", *, mark_dirty: bool = True) -> dict[str, Any]:
        """存入一个附件；返回内容寻址元数据。相同内容幂等（去重）。"""
        sha = _sha256(content)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.db.execute(
            "INSERT INTO attachments (user_id,sha256,size,mime,name,data,created_at,sync_state) "
            "VALUES (?,?,?,?,?,?,?,'pending') "
            "ON CONFLICT(user_id,sha256) DO UPDATE SET "
            "size=excluded.size,mime=CASE WHEN excluded.mime<>'' THEN excluded.mime ELSE attachments.mime END,"
            "name=CASE WHEN excluded.name<>'' THEN excluded.name ELSE attachments.name END,data=excluded.data,"
            "sync_state=CASE WHEN attachments.sync_state='synced' THEN 'synced' ELSE 'pending' END",
            (self._uid(), sha, len(content), mime or "", name or "", content, now),
        )
        self.db.commit()
        if mark_dirty:
            self._mark_dirty(sha)
        return self.meta(sha) or {"sha256": sha, "size": len(content), "mime": mime or "", "name": name or ""}

    def get(self, sha256: str) -> bytes | None:
        row = self.db.execute(
            "SELECT data FROM attachments WHERE user_id=? AND sha256=?",
            (self._uid(), sha256),
        ).fetchone()
        if row is None or row["data"] is None:
            return None
        return bytes(row["data"])

    def meta(self, sha256: str) -> dict[str, Any] | None:
        row = self.db.execute(
            "SELECT sha256, size, mime, name, created_at, sync_state, synced_at, data IS NOT NULL AS has_content FROM attachments "
            "WHERE user_id=? AND sha256=?",
            (self._uid(), sha256),
        ).fetchone()
        return dict(row) if row else None

    def for_sync(self, sha256: str) -> dict[str, Any] | None:
        """返回同步实体；二进制经 base64 编码后再交由 E2EE 层加密。"""
        import base64
        meta = self.meta(sha256)
        content = self.get(sha256)
        if not meta or content is None:
            return None
        return {
            "id": sha256, "sha256": sha256, "name": meta.get("name", ""),
            "mime": meta.get("mime", ""), "size": len(content),
            "content_b64": base64.b64encode(content).decode("ascii"),
        }

    def save_synced(self, sha256: str) -> None:
        self.db.execute(
            "UPDATE attachments SET sync_state='synced', synced_at=? WHERE user_id=? AND sha256=?",
            (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), self._uid(), sha256),
        )
        self.db.commit()

    def has(self, sha256: str) -> bool:
        return self.get(sha256) is not None

    def list_all(self) -> list[dict[str, Any]]:
        rows = self.db.execute(
            "SELECT sha256, size, mime, name, created_at, sync_state, synced_at, data IS NOT NULL AS has_content FROM attachments "
            "WHERE user_id=? ORDER BY created_at DESC, sha256",
            (self._uid(),),
        ).fetchall()
        return [dict(r) for r in rows]

    def count(self) -> int:
        return self.db.execute(
            "SELECT COUNT(*) FROM attachments WHERE user_id=?", (self._uid(),)
        ).fetchone()[0]

    def list_music_tracks(self) -> list[dict[str, Any]]:
        rows = self.db.execute(
            """SELECT mt.sha256, mt.title, mt.added_at, a.name, a.mime, a.size
               FROM music_tracks mt JOIN attachments a
                 ON a.user_id=mt.user_id AND a.sha256=mt.sha256
               WHERE mt.user_id=? AND a.data IS NOT NULL
               ORDER BY mt.added_at, mt.sha256""",
            (self._uid(),),
        ).fetchall()
        return [dict(row) for row in rows]

    def export_music_library(self) -> dict[str, Any]:
        rows = self.db.execute(
            "SELECT sha256,title,added_at FROM music_tracks WHERE user_id=? ORDER BY added_at,sha256",
            (self._uid(),),
        ).fetchall()
        return {"id": "library", "tracks": [dict(row) for row in rows]}

    def import_music_library(self, data: dict[str, Any]) -> None:
        tracks = data.get("tracks") if isinstance(data, dict) else []
        if not isinstance(tracks, list):
            return
        for item in tracks:
            if not isinstance(item, dict):
                continue
            sha256 = str(item.get("sha256") or "").strip().lower()
            if len(sha256) != 64 or any(ch not in "0123456789abcdef" for ch in sha256):
                continue
            self.db.execute(
                """INSERT INTO music_tracks (user_id,sha256,title,added_at) VALUES (?,?,?,?)
                   ON CONFLICT(user_id,sha256) DO UPDATE SET
                     title=CASE WHEN music_tracks.title='' THEN excluded.title ELSE music_tracks.title END,
                     added_at=CASE WHEN music_tracks.added_at='' THEN excluded.added_at ELSE music_tracks.added_at END""",
                (self._uid(), sha256, str(item.get("title") or "").strip()[:200],
                 str(item.get("added_at") or "")[:40]),
            )
        self.db.commit()

    def add_music_track(self, sha256: str, title: str = "") -> dict[str, Any] | None:
        meta = self.meta(sha256)
        if not meta or self.get(sha256) is None:
            return None
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.db.execute(
            """INSERT INTO music_tracks (user_id,sha256,title,added_at) VALUES (?,?,?,?)
               ON CONFLICT(user_id,sha256) DO UPDATE SET
                 title=CASE WHEN excluded.title<>'' THEN excluded.title ELSE music_tracks.title END""",
            (self._uid(), sha256, title.strip()[:200], now),
        )
        self.db.commit()
        self._mark_music_library_dirty()
        return next((item for item in self.list_music_tracks() if item["sha256"] == sha256), None)

    def get_music_playback(self) -> dict[str, Any]:
        row = self.db.execute(
            "SELECT playing,track_id,updated_at FROM music_playback WHERE user_id=?", (self._uid(),)
        ).fetchone()
        return dict(row) if row else {"playing": 0, "track_id": "", "updated_at": ""}

    def set_music_playback(self, playing: bool, track_id: str = "") -> dict[str, Any]:
        current = self.get_music_playback()
        selected = track_id if track_id != "" else str(current.get("track_id") or "")
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.db.execute(
            """INSERT INTO music_playback (user_id,playing,track_id,updated_at) VALUES (?,?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET playing=excluded.playing,
                 track_id=excluded.track_id, updated_at=excluded.updated_at""",
            (self._uid(), int(bool(playing)), selected, now),
        )
        self.db.commit()
        return self.get_music_playback()

    def delete(self, sha256: str) -> bool:
        cur = self.db.execute(
            "DELETE FROM attachments WHERE user_id=? AND sha256=?",
            (self._uid(), sha256),
        )
        if cur.rowcount > 0:
            self._mark_dirty(sha256, tombstone=True)
        return cur.rowcount > 0
