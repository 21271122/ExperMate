"""实验 CRUD + 引用管理 + 更新日志服务。从 app.py 私有函数迁出。"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any
import json as _json
from lib.experiment_ids import find_references


class ExperimentService:
    def __init__(
        self,
        exp_repo: Any,
        update_log_repo: Any,
        favorites_repo: Any,
        base_dir: Path | None = None,
    ):
        self.exp_repo = exp_repo
        self.update_log_repo = update_log_repo
        self.favorites_repo = favorites_repo
        self.base_dir = base_dir

    # -- 公共 API --

    def save_with_log(
        self,
        exp_id: str,
        data: dict[str, Any],
        source: str,
        thread_id: str | None = None,
    ) -> None:
        """保存实验 + 自动计算 diff + 写更新日志。
        自动判断新建（调 save()）还是修改（调 update()）。"""
        old = self.exp_repo.load(exp_id)
        if old is None:
            self.exp_repo.save(data)
            return
        ok = self.exp_repo.update(exp_id, data)
        if not ok:
            return
        diff = self._compute_diff(old, data)
        if diff:
            self.update_log_repo.append(
                exp_id, source, diff,
                context={"summary": f"修改了 {len(diff)} 个字段"},
                thread_id=thread_id,
            )

    def set_archived_with_log(
        self,
        exp_id: str,
        archived: bool,
        expected_revision: int | None = None,
    ) -> dict[str, Any]:
        """归档或恢复实验；保留数据、附件、引用与同步快照。"""
        result = self.exp_repo.set_archived(exp_id, archived, expected_revision)
        if not result.get("ok"):
            return result
        label = "已归档" if archived else "已恢复到实验列表"
        self.update_log_repo.append(
            exp_id=exp_id, source="system",
            changes=[{"path": "archived", "field": "归档状态",
                      "old": "正常" if archived else "已归档", "new": label}],
            context={"summary": f"实验记录 {exp_id} {label}"})
        return result

    def delete_with_log(self, exp_id: str) -> dict[str, Any]:
        """兼容旧调用：删除入口改为归档，不再物理移除实验。"""
        return self.set_archived_with_log(exp_id, True)

    def extract_references(self, text: str) -> list[str]:
        """从文本提取 @实验编号引用（确定性，不调 LLM）。"""
        seen: set[str] = set()
        refs: list[str] = []
        for rid in find_references(text):
            if rid not in seen:
                seen.add(rid)
                refs.append(rid)
        return refs

    def update_referenced_by(
        self,
        exp_id: str,
        refs: list[str],
        old_refs: list[str] | None = None,
    ) -> None:
        """维护双向引用关系。"""
        for ref_id in refs:
            ref_exp = self.exp_repo.load(ref_id)
            if ref_exp:
                rb: list[str] = ref_exp.get("referenced_by", [])
                if exp_id not in rb:
                    rb.append(exp_id)
                    ref_exp["referenced_by"] = rb
                    self.exp_repo.save(ref_exp)
        old_refs = old_refs or []
        for rid in old_refs:
            if rid not in refs:
                r_exp = self.exp_repo.load(rid)
                if r_exp:
                    rb = r_exp.get("referenced_by", [])
                    if exp_id in rb:
                        rb.remove(exp_id)
                        r_exp["referenced_by"] = rb
                        self.exp_repo.save(r_exp)

    def save_and_update_refs(
        self,
        exp_id: str,
        data: dict[str, Any],
        source: str,
        old_refs: list[str] | None = None,
        thread_id: str | None = None,
    ) -> None:
        """保存实验 + 自动处理引用关系。大多数路由直接调此方法即可。"""
        text = data.get("original_notes", "")
        refs = self.extract_references(text)
        data["references"] = refs
        self.save_with_log(exp_id, data, source, thread_id=thread_id)
        self.update_referenced_by(exp_id, refs, old_refs=old_refs)

    def save_and_update_refs_if_revision(
        self,
        exp_id: str,
        data: dict[str, Any],
        expected_revision: int,
        source: str,
        thread_id: str | None = None,
    ) -> dict[str, Any]:
        """带乐观锁的保存。冲突时不写更新日志、不改引用关系。"""
        old = self.exp_repo.load(exp_id)
        if old is None or not hasattr(self.exp_repo, "save_if_revision"):
            return {"ok": False, "error": "not_found"}
        old_refs = old.get("references", [])
        data["id"] = exp_id
        refs = self.extract_references(data.get("original_notes", ""))
        data["references"] = refs
        result = self.exp_repo.save_if_revision(data, expected_revision)
        if not result.get("ok"):
            return result
        diff = self._compute_diff(old, data)
        if diff:
            self.update_log_repo.append(
                exp_id, source, diff,
                context={"summary": f"修改了 {len(diff)} 个字段"},
                thread_id=thread_id,
            )
        self.update_referenced_by(exp_id, refs, old_refs=old_refs)
        return result

    def move_draft_images(self, exp_id: str) -> None:
        """将 uploads/_draft/ 中的图片迁移到 uploads/<exp_id>/"""
        if not self.base_dir:
            return
        draft_dir = self.base_dir / "uploads" / "_draft"
        if draft_dir.exists():
            exp_img_dir = self.base_dir / "uploads" / exp_id
            exp_img_dir.mkdir(parents=True, exist_ok=True)
            for f in draft_dir.iterdir():
                shutil.move(str(f), str(exp_img_dir / f.name))
            draft_dir.rmdir()

    def get_pinned_and_others(self) -> tuple[list[dict[str, Any]], list[str]]:
        """获取置顶 + 其余实验列表"""
        experiments = self.exp_repo.list_all()
        pinned_ids = self.favorites_repo.get_pinned()
        pinned: list[dict[str, Any]] = []
        others: list[dict[str, Any]] = []
        for exp in experiments:
            if exp["id"] in pinned_ids:
                pinned.append(exp)
            else:
                others.append(exp)
        pinned.sort(key=lambda e: pinned_ids.index(e["id"]) if e["id"] in pinned_ids else 99)
        return pinned + others, pinned_ids

    # -- 私有方法 --

    def _compute_diff(self, old: dict[str, Any] | None, new: dict[str, Any]) -> list[dict[str, Any]]:
        return compute_experiment_diff(old, new)


def compute_experiment_diff(old: dict[str, Any] | None, new: dict[str, Any]) -> list[dict[str, Any]]:
    """比较两个实验 dict，返回 [{path, field, old, new}] 差异列表。"""
    changes: list[dict[str, Any]] = []
    simple_fields = ["title", "date", "experimenter", "status", "purpose",
                     "conclusion", "original_notes"]
    array_fields = ["tags", "sop", "next_steps"]
    complex_fields = ["materials", "equipment", "experimental_plan",
                      "process_parameters", "characterization"]
    nested_fields = ["observations", "results"]

    for field in simple_fields:
        old_val = (old.get(field) or "") if old else ""
        new_val = (new.get(field) or "") if new else ""
        if old_val != new_val:
            changes.append({
                "path": field, "field": field,
                "old": str(old_val)[:200], "new": str(new_val)[:200],
            })

    for field in array_fields:
        old_val = old.get(field, []) if old else []
        new_val = new.get(field, []) if new else []
        if old_val != new_val:
            changes.append({
                "path": field, "field": field,
                "old": ", ".join(str(v) for v in old_val)[:200],
                "new": ", ".join(str(v) for v in new_val)[:200],
            })

    for field in complex_fields:
        old_items = old.get(field, []) if old else []
        new_items = new.get(field, []) if new else []
        if old_items != new_items:
            if _json.dumps(old_items, ensure_ascii=False, sort_keys=True) != \
               _json.dumps(new_items, ensure_ascii=False, sort_keys=True):
                changes.append({
                    "path": field, "field": field,
                    "old": f"{len(old_items)} entries" if old_items else "empty",
                    "new": f"{len(new_items)} entries" if new_items else "empty",
                })

    for field in nested_fields:
        old_val = old.get(field, {}) if old else {}
        new_val = new.get(field, {}) if new else {}
        if old_val != new_val:
            changes.append({
                "path": field, "field": field,
                "old": "filled" if old_val else "empty",
                "new": "filled" if new_val else "empty",
            })

    return changes
