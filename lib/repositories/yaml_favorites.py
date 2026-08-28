from pathlib import Path
from typing import Any

import yaml

from lib.repositories.base import AbstractFavoritesRepository


DEFAULT_COLLECTION = "Default"


class YamlFavoritesRepository(AbstractFavoritesRepository):
    def __init__(self, path: str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._data: dict[str, Any] | None = None

    def _load(self) -> dict[str, Any]:
        if self._data is not None:
            return self._data
        if self.path.exists():
            with open(self.path, "r", encoding="utf-8") as f:
                self._data = dict(yaml.safe_load(f) or {})
        else:
            self._data = {}
        self._data.setdefault("pinned", [])
        self._data.setdefault("category_pinned", {})
        self._data.setdefault("collections", {DEFAULT_COLLECTION: []})
        self._data.setdefault("collection_meta", {})
        self._ensure_collection_meta()
        return self._data

    def _save(self) -> None:
        if self._data is None:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", encoding="utf-8") as f:
            yaml.dump(
                self._data,
                f,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
                indent=2,
            )

    def _ensure_collection_meta(self) -> None:
        if self._data is None:
            return
        collections = self._data.setdefault("collections", {})
        category_pinned = self._data.setdefault("category_pinned", {})
        meta = self._data.setdefault("collection_meta", {})
        for idx, name in enumerate(collections.keys()):
            item = meta.setdefault(name, {})
            item.setdefault("description", "")
            item.setdefault("order", idx)
            category_pinned.setdefault(name, [])

    def is_pinned(self, exp_id: str) -> bool:
        data = self._load()
        return exp_id in data.get("pinned", [])

    def is_favorited(self, exp_id: str, collection: str = DEFAULT_COLLECTION) -> bool:
        data = self._load()
        return exp_id in data.get("collections", {}).get(collection, [])

    def toggle_pin(self, exp_id: str) -> dict[str, Any]:
        data = self._load()
        pinned = data.get("pinned", [])
        if exp_id in pinned:
            pinned.remove(exp_id)
            self._save()
            return {"ok": True, "pinned": False}
        if len(pinned) >= 3:
            return {"ok": False, "error": "最多只能置顶 3 个实验"}
        pinned.append(exp_id)
        data["pinned"] = pinned
        self._save()
        return {"ok": True, "pinned": True}

    def set_pin(self, exp_id: str, pinned: bool) -> dict[str, Any]:
        if self.is_pinned(exp_id) == pinned:
            return {"ok": True, "pinned": pinned}
        return self.toggle_pin(exp_id)

    def toggle_favorite(self, exp_id: str, collection: str = DEFAULT_COLLECTION) -> dict[str, Any]:
        data = self._load()
        collections = data.setdefault("collections", {})
        if collection not in collections:
            collections[collection] = []
            self._ensure_collection_meta()
        if exp_id in collections[collection]:
            collections[collection].remove(exp_id)
            pinned = data.setdefault("category_pinned", {}).setdefault(collection, [])
            if exp_id in pinned:
                pinned.remove(exp_id)
            self._save()
            return {"ok": True, "favorited": False}
        collections[collection].append(exp_id)
        self._save()
        return {"ok": True, "favorited": True}

    def set_favorite(self, exp_id: str, collection: str = DEFAULT_COLLECTION,
                     favorited: bool = True) -> dict[str, Any]:
        if self.is_favorited(exp_id, collection) == favorited:
            return {"ok": True, "favorited": favorited}
        return self.toggle_favorite(exp_id, collection)

    def get_pinned(self) -> list[str]:
        data = self._load()
        return list(data.get("pinned", []))

    def get_category_pinned(self) -> dict[str, list[str]]:
        data = self._load()
        self._ensure_collection_meta()
        return {
            name: list(ids)
            for name, ids in data.get("category_pinned", {}).items()
            if name in data.get("collections", {})
        }

    def is_category_pinned(self, exp_id: str, collection: str) -> bool:
        data = self._load()
        return exp_id in data.get("category_pinned", {}).get(collection, [])

    def toggle_category_pin(self, exp_id: str, collection: str) -> dict[str, Any]:
        data = self._load()
        collections = data.get("collections", {})
        if collection not in collections:
            return {"ok": False, "error": "Category does not exist"}
        if exp_id not in collections.get(collection, []):
            return {"ok": False, "error": "Experiment is not in this category"}
        pinned = data.setdefault("category_pinned", {}).setdefault(collection, [])
        if exp_id in pinned:
            pinned.remove(exp_id)
            self._save()
            return {"ok": True, "pinned": False, "collection": collection}
        if len(pinned) >= 3:
            return {"ok": False, "error": "Only 3 experiments can be pinned in a category"}
        pinned.append(exp_id)
        self._save()
        return {"ok": True, "pinned": True, "collection": collection}

    def get_collections(self) -> dict[str, list[str]]:
        data = self._load()
        collections = dict(data.get("collections", {}))
        meta = data.get("collection_meta", {})
        return dict(
            sorted(
                collections.items(),
                key=lambda kv: meta.get(kv[0], {}).get("order", 999),
            )
        )

    def get_collection_meta(self) -> dict[str, dict[str, Any]]:
        data = self._load()
        self._ensure_collection_meta()
        return dict(data.get("collection_meta", {}))

    def create_collection(self, name: str) -> dict[str, Any]:
        data = self._load()
        name = name.strip()
        if not name:
            return {"ok": False, "error": "分类名称不能为空"}
        if name in data.get("collections", {}):
            return {"ok": False, "error": "分类已存在"}
        data["collections"][name] = []
        meta = data.setdefault("collection_meta", {})
        max_order = max((item.get("order", -1) for item in meta.values()), default=-1)
        meta[name] = {"description": "", "order": max_order + 1}
        self._save()
        return {"ok": True}

    def delete_collection(self, name: str) -> dict[str, Any]:
        data = self._load()
        if name not in data.get("collections", {}):
            return {"ok": False, "error": "分类不存在"}
        del data["collections"][name]
        data.get("collection_meta", {}).pop(name, None)
        data.get("category_pinned", {}).pop(name, None)
        self._save()
        return {"ok": True}

    def update_collection(
        self,
        name: str,
        new_name: str | None = None,
        description: str | None = None,
    ) -> dict[str, Any]:
        data = self._load()
        collections = data.get("collections", {})
        if name not in collections:
            return {"ok": False, "error": "分类不存在"}
        target = (new_name or name).strip()
        if not target:
            return {"ok": False, "error": "分类名称不能为空"}
        if target != name and target in collections:
            return {"ok": False, "error": "分类已存在"}
        meta = data.setdefault("collection_meta", {})
        old_meta = meta.pop(name, {"description": "", "order": len(meta)})
        if description is not None:
            old_meta["description"] = description
        if target != name:
            collections[target] = collections.pop(name)
            category_pinned = data.setdefault("category_pinned", {})
            if name in category_pinned:
                category_pinned[target] = category_pinned.pop(name)
        meta[target] = old_meta
        self._save()
        return {"ok": True, "name": target}

    def reorder_collections(self, names: list[str]) -> dict[str, Any]:
        data = self._load()
        collections = data.get("collections", {})
        meta = data.setdefault("collection_meta", {})
        known = [name for name in names if name in collections]
        rest = [name for name in collections.keys() if name not in known]
        for idx, name in enumerate(known + rest):
            item = meta.setdefault(name, {"description": ""})
            item["order"] = idx
        self._save()
        return {"ok": True}

    def add_to_collection(self, exp_id: str, collection: str) -> dict[str, Any]:
        data = self._load()
        collections = data.setdefault("collections", {})
        if collection not in collections:
            collections[collection] = []
            self._ensure_collection_meta()
        if exp_id not in collections[collection]:
            collections[collection].append(exp_id)
        self._save()
        return {"ok": True}

    def remove_from_collection(self, exp_id: str, collection: str = DEFAULT_COLLECTION) -> dict[str, Any]:
        data = self._load()
        if collection in data.get("collections", {}):
            items = data["collections"][collection]
            if exp_id in items:
                items.remove(exp_id)
            pinned = data.setdefault("category_pinned", {}).setdefault(collection, [])
            if exp_id in pinned:
                pinned.remove(exp_id)
        self._save()
        return {"ok": True}
