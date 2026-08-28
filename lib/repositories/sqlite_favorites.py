"""SQLite repository for pins, experiment categories, and legacy favorites."""

import sqlite3
from typing import Any

from lib.repositories.base import AbstractFavoritesRepository
from lib.repositories.sqlite_common import UserScopeMixin


DEFAULT_COLLECTION = "默认收藏夹"


class SqliteFavoritesRepository(AbstractFavoritesRepository, UserScopeMixin):
    def __init__(self, db: sqlite3.Connection, uid_provider=None, on_dirty=None) -> None:
        """on_dirty: 收藏变更后同步标记回调 (entity_id, tombstone)。"""
        UserScopeMixin.__init__(self, uid_provider)
        self.db = db
        self._on_dirty = on_dirty
        self.db.row_factory = sqlite3.Row
        self._create_tables()

    def _create_tables(self) -> None:
        self.db.execute(
            """
            CREATE TABLE IF NOT EXISTS favorites (
                user_id    TEXT DEFAULT '',
                exp_id     TEXT NOT NULL,
                collection TEXT NOT NULL DEFAULT 'Default',
                pin_order  INTEGER,
                created_at TEXT DEFAULT '',
                PRIMARY KEY (user_id, exp_id, collection)
            )
            """
        )
        self.db.execute(
            """
            CREATE TABLE IF NOT EXISTS favorite_collections (
                user_id     TEXT DEFAULT '',
                name        TEXT NOT NULL,
                description TEXT DEFAULT '',
                sort_order  INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, name)
            )
            """
        )
        self.db.execute(
            """
            CREATE TABLE IF NOT EXISTS favorite_category_pins (
                user_id    TEXT DEFAULT '',
                collection TEXT NOT NULL,
                exp_id     TEXT NOT NULL,
                pin_order  INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, collection, exp_id)
            )
            """
        )
        try:
            self.db.execute("ALTER TABLE favorites ADD COLUMN user_id TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass
        try:
            self.db.execute("ALTER TABLE favorites ADD COLUMN created_at TEXT DEFAULT ''")
        except sqlite3.OperationalError:
            pass

    def _mark_dirty(self) -> None:
        if self._on_dirty is not None:
            self._on_dirty("_snapshot", False)

    def _collections_from_favorites(self) -> list[str]:
        rows = self.db.execute(
            """
            SELECT DISTINCT collection
            FROM favorites
            WHERE user_id = ? AND pin_order IS NULL AND collection != ''
            ORDER BY collection
            """,
            (self._uid(),),
        ).fetchall()
        return [r["collection"] for r in rows]

    def _ensure_collection_meta(self) -> None:
        uid = self._uid()
        existing = {
            r["name"]: r["sort_order"]
            for r in self.db.execute(
                "SELECT name, sort_order FROM favorite_collections WHERE user_id = ?",
                (uid,),
            ).fetchall()
        }
        max_order = max(existing.values(), default=0)
        for name in self._collections_from_favorites():
            if name in existing:
                continue
            max_order += 1
            self.db.execute(
                """
                INSERT OR IGNORE INTO favorite_collections
                    (user_id, name, description, sort_order)
                VALUES (?, ?, '', ?)
                """,
                (uid, name, max_order),
            )

    def _collection_exists(self, name: str) -> bool:
        self._ensure_collection_meta()
        row = self.db.execute(
            "SELECT 1 FROM favorite_collections WHERE user_id = ? AND name = ?",
            (self._uid(), name),
        ).fetchone()
        return row is not None

    def is_pinned(self, exp_id: str) -> bool:
        row = self.db.execute(
            "SELECT 1 FROM favorites WHERE exp_id = ? AND user_id = ? AND pin_order IS NOT NULL",
            (exp_id, self._uid()),
        ).fetchone()
        return row is not None

    def toggle_pin(self, exp_id: str) -> dict[str, Any]:
        if self.is_pinned(exp_id):
            self.db.execute(
                "DELETE FROM favorites WHERE exp_id = ? AND user_id = ? AND pin_order IS NOT NULL",
                (exp_id, self._uid()),
            )
            self._mark_dirty()
            return {"ok": True, "pinned": False}

        count = self.db.execute(
            "SELECT COUNT(*) FROM favorites WHERE user_id = ? AND pin_order IS NOT NULL",
            (self._uid(),),
        ).fetchone()[0]
        if count >= 3:
            return {"ok": False, "error": "Only 3 experiments can be pinned"}

        max_order = self.db.execute(
            "SELECT MAX(pin_order) FROM favorites WHERE user_id = ?",
            (self._uid(),),
        ).fetchone()[0]
        self.db.execute(
            "INSERT INTO favorites (user_id, exp_id, collection, pin_order) VALUES (?, ?, '', ?)",
            (self._uid(), exp_id, (max_order or 0) + 1),
        )
        self._mark_dirty()
        return {"ok": True, "pinned": True}

    def set_pin(self, exp_id: str, pinned: bool) -> dict[str, Any]:
        """明确设为置顶/未置顶；网络重试不会反向切换状态。"""
        current = self.is_pinned(exp_id)
        if current == pinned:
            return {"ok": True, "pinned": pinned}
        return self.toggle_pin(exp_id)

    def toggle_favorite(self, exp_id: str, collection: str = DEFAULT_COLLECTION) -> dict[str, Any]:
        collection = (collection or DEFAULT_COLLECTION).strip()
        if not collection:
            return {"ok": False, "error": "Category name cannot be empty"}
        if not self._collection_exists(collection):
            self.create_collection(collection)

        row = self.db.execute(
            """
            SELECT 1 FROM favorites
            WHERE exp_id = ? AND user_id = ? AND collection = ? AND pin_order IS NULL
            """,
            (exp_id, self._uid(), collection),
        ).fetchone()
        if row:
            self.db.execute(
                """
                DELETE FROM favorites
                WHERE exp_id = ? AND user_id = ? AND collection = ? AND pin_order IS NULL
                """,
                (exp_id, self._uid(), collection),
            )
            self.db.execute(
                """
                DELETE FROM favorite_category_pins
                WHERE exp_id = ? AND user_id = ? AND collection = ?
                """,
                (exp_id, self._uid(), collection),
            )
            self._mark_dirty()
            return {"ok": True, "favorited": False}

        self.db.execute(
            "INSERT INTO favorites (user_id, exp_id, collection) VALUES (?, ?, ?)",
            (self._uid(), exp_id, collection),
        )
        self._mark_dirty()
        return {"ok": True, "favorited": True}

    def is_favorited(self, exp_id: str, collection: str = DEFAULT_COLLECTION) -> bool:
        row = self.db.execute(
            "SELECT 1 FROM favorites WHERE exp_id=? AND user_id=? AND collection=? AND pin_order IS NULL",
            (exp_id, self._uid(), (collection or DEFAULT_COLLECTION).strip()),
        ).fetchone()
        return row is not None

    def set_favorite(self, exp_id: str, collection: str = DEFAULT_COLLECTION,
                     favorited: bool = True) -> dict[str, Any]:
        """明确设为收藏/未收藏；网络重试不会反向切换状态。"""
        current = self.is_favorited(exp_id, collection)
        if current == favorited:
            return {"ok": True, "favorited": favorited}
        return self.toggle_favorite(exp_id, collection)

    def get_pinned(self) -> list[str]:
        rows = self.db.execute(
            """
            SELECT exp_id FROM favorites
            WHERE user_id = ? AND pin_order IS NOT NULL
            ORDER BY pin_order
            """,
            (self._uid(),),
        ).fetchall()
        return [r["exp_id"] for r in rows]

    def get_category_pinned(self) -> dict[str, list[str]]:
        self._ensure_collection_meta()
        rows = self.db.execute(
            """
            SELECT collection, exp_id
            FROM favorite_category_pins
            WHERE user_id = ?
            ORDER BY collection, pin_order
            """,
            (self._uid(),),
        ).fetchall()
        collections = self.get_collections()
        result: dict[str, list[str]] = {name: [] for name in collections}
        for r in rows:
            name = r["collection"]
            exp_id = r["exp_id"]
            if name in collections and exp_id in collections[name]:
                result.setdefault(name, []).append(exp_id)
        return result

    def is_category_pinned(self, exp_id: str, collection: str) -> bool:
        row = self.db.execute(
            """
            SELECT 1 FROM favorite_category_pins
            WHERE user_id = ? AND collection = ? AND exp_id = ?
            """,
            (self._uid(), collection, exp_id),
        ).fetchone()
        return row is not None

    def toggle_category_pin(self, exp_id: str, collection: str) -> dict[str, Any]:
        collection = (collection or "").strip()
        if not self._collection_exists(collection):
            return {"ok": False, "error": "Category does not exist"}
        in_collection = self.db.execute(
            """
            SELECT 1 FROM favorites
            WHERE user_id = ? AND collection = ? AND exp_id = ? AND pin_order IS NULL
            """,
            (self._uid(), collection, exp_id),
        ).fetchone()
        if in_collection is None:
            return {"ok": False, "error": "Experiment is not in this category"}
        if self.is_category_pinned(exp_id, collection):
            self.db.execute(
                """
                DELETE FROM favorite_category_pins
                WHERE user_id = ? AND collection = ? AND exp_id = ?
                """,
                (self._uid(), collection, exp_id),
            )
            self._mark_dirty()
            return {"ok": True, "pinned": False, "collection": collection}
        count = self.db.execute(
            """
            SELECT COUNT(*) FROM favorite_category_pins
            WHERE user_id = ? AND collection = ?
            """,
            (self._uid(), collection),
        ).fetchone()[0]
        if count >= 3:
            return {"ok": False, "error": "Only 3 experiments can be pinned in a category"}
        max_order = self.db.execute(
            """
            SELECT MAX(pin_order) FROM favorite_category_pins
            WHERE user_id = ? AND collection = ?
            """,
            (self._uid(), collection),
        ).fetchone()[0]
        self.db.execute(
            """
            INSERT INTO favorite_category_pins (user_id, collection, exp_id, pin_order)
            VALUES (?, ?, ?, ?)
            """,
            (self._uid(), collection, exp_id, (max_order or 0) + 1),
        )
        self._mark_dirty()
        return {"ok": True, "pinned": True, "collection": collection}

    def get_collections(self) -> dict[str, list[str]]:
        self._ensure_collection_meta()
        rows = self.db.execute(
            """
            SELECT collection, exp_id FROM favorites
            WHERE user_id = ? AND pin_order IS NULL AND collection != ''
            ORDER BY collection, exp_id
            """,
            (self._uid(),),
        ).fetchall()
        result: dict[str, list[str]] = {}
        for r in rows:
            result.setdefault(r["collection"], []).append(r["exp_id"])

        meta_rows = self.db.execute(
            """
            SELECT name FROM favorite_collections
            WHERE user_id = ?
            ORDER BY sort_order, name
            """,
            (self._uid(),),
        ).fetchall()
        ordered: dict[str, list[str]] = {}
        for r in meta_rows:
            ordered[r["name"]] = result.get(r["name"], [])
        for name, ids in result.items():
            ordered.setdefault(name, ids)
        return ordered

    def get_collection_meta(self) -> dict[str, Any]:
        self._ensure_collection_meta()
        rows = self.db.execute(
            """
            SELECT name, description, sort_order
            FROM favorite_collections
            WHERE user_id = ?
            ORDER BY sort_order, name
            """,
            (self._uid(),),
        ).fetchall()
        return {
            r["name"]: {"description": r["description"] or "", "order": r["sort_order"] or 0}
            for r in rows
        }

    def create_collection(self, name: str) -> dict[str, Any]:
        name = (name or "").strip()
        if not name:
            return {"ok": False, "error": "Category name cannot be empty"}
        if self._collection_exists(name):
            return {"ok": False, "error": "Category already exists"}
        max_order = self.db.execute(
            "SELECT MAX(sort_order) FROM favorite_collections WHERE user_id = ?",
            (self._uid(),),
        ).fetchone()[0]
        self.db.execute(
            """
            INSERT INTO favorite_collections (user_id, name, description, sort_order)
            VALUES (?, ?, '', ?)
            """,
            (self._uid(), name, (max_order or 0) + 1),
        )
        self._mark_dirty()
        return {"ok": True}

    def delete_collection(self, name: str) -> dict[str, Any]:
        if not self._collection_exists(name):
            return {"ok": False, "error": "Category does not exist"}
        self.db.execute(
            "DELETE FROM favorites WHERE collection = ? AND user_id = ? AND pin_order IS NULL",
            (name, self._uid()),
        )
        self.db.execute(
            "DELETE FROM favorite_collections WHERE name = ? AND user_id = ?",
            (name, self._uid()),
        )
        self.db.execute(
            "DELETE FROM favorite_category_pins WHERE collection = ? AND user_id = ?",
            (name, self._uid()),
        )
        self._mark_dirty()
        return {"ok": True}

    def update_collection(
        self,
        name: str,
        new_name: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        name = (name or "").strip()
        target = (new_name or name).strip()
        if not name or not target:
            return {"ok": False, "error": "Category name cannot be empty"}
        if not self._collection_exists(name):
            return {"ok": False, "error": "Category does not exist"}
        if target != name and self._collection_exists(target):
            return {"ok": False, "error": "Category already exists"}

        if target != name:
            self.db.execute(
                "UPDATE favorites SET collection = ? WHERE user_id = ? AND collection = ? AND pin_order IS NULL",
                (target, self._uid(), name),
            )
            self.db.execute(
                "UPDATE favorite_collections SET name = ? WHERE user_id = ? AND name = ?",
                (target, self._uid(), name),
            )
            self.db.execute(
                "UPDATE favorite_category_pins SET collection = ? WHERE user_id = ? AND collection = ?",
                (target, self._uid(), name),
            )
        if description is not None:
            self.db.execute(
                "UPDATE favorite_collections SET description = ? WHERE user_id = ? AND name = ?",
                (description.strip(), self._uid(), target),
            )
        self._mark_dirty()
        return {"ok": True, "name": target}

    def reorder_collections(self, names: list[str]) -> dict[str, Any]:
        current = set(self.get_collections().keys())
        order = 1
        for name in names:
            if name not in current:
                continue
            self.db.execute(
                "UPDATE favorite_collections SET sort_order = ? WHERE user_id = ? AND name = ?",
                (order, self._uid(), name),
            )
            order += 1
        for name in current:
            if name in names:
                continue
            self.db.execute(
                "UPDATE favorite_collections SET sort_order = ? WHERE user_id = ? AND name = ?",
                (order, self._uid(), name),
            )
            order += 1
        self._mark_dirty()
        return {"ok": True}

    def export_snapshot(self, user_id: str) -> dict[str, Any]:
        favorite_rows = self.db.execute(
            "SELECT exp_id, collection, pin_order, created_at FROM favorites WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        collection_rows = self.db.execute(
            """
            SELECT name, description, sort_order
            FROM favorite_collections
            WHERE user_id = ?
            ORDER BY sort_order, name
            """,
            (user_id,),
        ).fetchall()
        category_pin_rows = self.db.execute(
            """
            SELECT collection, exp_id, pin_order
            FROM favorite_category_pins
            WHERE user_id = ?
            ORDER BY collection, pin_order
            """,
            (user_id,),
        ).fetchall()
        return {
            "favorites": [dict(r) for r in favorite_rows],
            "collections": [dict(r) for r in collection_rows],
            "category_pins": [dict(r) for r in category_pin_rows],
        }

    def import_snapshot(self, data: list[dict] | dict[str, Any], user_id: str) -> None:
        favorite_rows = data.get("favorites", []) if isinstance(data, dict) else data
        collection_rows = data.get("collections", []) if isinstance(data, dict) else []
        category_pin_rows = data.get("category_pins", []) if isinstance(data, dict) else []
        self.db.execute("BEGIN")
        try:
            self.db.execute("DELETE FROM favorites WHERE user_id = ?", (user_id,))
            self.db.execute("DELETE FROM favorite_collections WHERE user_id = ?", (user_id,))
            self.db.execute("DELETE FROM favorite_category_pins WHERE user_id = ?", (user_id,))
            for row in collection_rows:
                self.db.execute(
                    """
                    INSERT INTO favorite_collections (user_id, name, description, sort_order)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        row["name"],
                        row.get("description", ""),
                        row.get("sort_order", 0),
                    ),
                )
            for row in favorite_rows:
                self.db.execute(
                    """
                    INSERT INTO favorites (user_id, exp_id, collection, pin_order, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        row["exp_id"],
                        row.get("collection", DEFAULT_COLLECTION),
                        row.get("pin_order"),
                        row.get("created_at", ""),
                    ),
                )
            for row in category_pin_rows:
                self.db.execute(
                    """
                    INSERT INTO favorite_category_pins (user_id, collection, exp_id, pin_order)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        row["collection"],
                        row["exp_id"],
                        row.get("pin_order", 0),
                    ),
                )
            self.db.commit()
        except Exception:
            self.db.execute("ROLLBACK")
            raise
