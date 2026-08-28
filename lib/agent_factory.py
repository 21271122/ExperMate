"""Agent 工厂函数 — 消除路由中的 Agent 构造/恢复重复。"""

from __future__ import annotations

from typing import Any
from lib.agent_v2 import AgentLoop


def _is_child_runtime_state(state: dict[str, Any] | None) -> bool:
    if not state:
        return False
    return bool(state.get("_is_child_agent") or state.get("_child_agent_role"))


def load_parent_runtime_state(thread_repo: Any) -> dict[str, Any] | None:
    """读取主 Agent 状态；隔离被旧版错误写入的子 Agent 快照。"""
    saved = thread_repo.load_current_state()
    if not _is_child_runtime_state(saved):
        return saved

    recovered = dict(saved)
    role = str(recovered.get("_child_agent_role") or "")
    child_id = str(recovered.get("_child_exp_id") or "")
    thread_id = str(recovered.get("thread_id") or "")
    if not thread_id and child_id:
        index = thread_repo.get_index()
        mapping = index.get("anal_to_thread", {}) if role == "analysis_reviewer" else index.get("exp_to_thread", {})
        thread_id = str(mapping.get(child_id) or "")
    if thread_id:
        recovered["thread_id"] = thread_id
        recovered["_is_child_agent"] = True
        thread_repo.save_child_state(thread_id, recovered)
    # 空状态会被仓储视为不存在；不让主 Agent 再恢复这份子 Agent 历史。
    thread_repo.save_current_state({})
    return None


def get_or_create_agent(
    llm: Any,
    exp_repo: Any,
    state_dict: dict[str, Any] | None,
    thread_repo: Any,
    update_log_repo: Any = None,
    favorites_repo: Any = None,
    analysis_repo: Any = None,
    analysis_svc: Any = None,
    extraction_svc: Any = None,
    attachment_store: Any = None,
    context_compression_trigger_tokens: int = 300_000,
    context_compression_chunk_tokens: int = 260_000,
) -> AgentLoop:
    """三步回退：state_dict → 磁盘状态 → 新建。"""
    if state_dict:
        return AgentLoop.from_dict(
            llm, exp_repo, state_dict,
            thread_store=thread_repo,
            update_log_store=update_log_repo,
            favorites_store=favorites_repo,
            analysis_store=analysis_repo,
            analysis_svc=analysis_svc,
            extraction_svc=extraction_svc,
            attachment_store=attachment_store,
            context_compression_trigger_tokens=context_compression_trigger_tokens,
            context_compression_chunk_tokens=context_compression_chunk_tokens,
        )
    saved = load_parent_runtime_state(thread_repo)
    if saved:
        return AgentLoop.from_dict(
            llm, exp_repo, saved,
            thread_store=thread_repo,
            update_log_store=update_log_repo,
            favorites_store=favorites_repo,
            analysis_store=analysis_repo,
            analysis_svc=analysis_svc,
            extraction_svc=extraction_svc,
            attachment_store=attachment_store,
            context_compression_trigger_tokens=context_compression_trigger_tokens,
            context_compression_chunk_tokens=context_compression_chunk_tokens,
        )
    return AgentLoop(
        llm, exp_repo,
        thread_store=thread_repo,
        update_log_store=update_log_repo,
        favorites_store=favorites_repo,
        analysis_store=analysis_repo,
        analysis_svc=analysis_svc,
        extraction_svc=extraction_svc,
        attachment_store=attachment_store,
        context_compression_trigger_tokens=context_compression_trigger_tokens,
        context_compression_chunk_tokens=context_compression_chunk_tokens,
    )


def build_child_for_thread(
    parent: AgentLoop,
    thread_id: str,
    role: str,
) -> AgentLoop:
    """从已有线程创建子 Agent。role: 'exp_editor' | 'analysis_reviewer'."""
    child = AgentLoop.create_child_agent(parent, thread_id)
    child.child.agent_role = role
    return child


def build_analysis_child(
    llm: Any,
    store: Any,
    thread: dict[str, Any],
    anal_id: str,
    thread_repo: Any,
    update_log_repo: Any = None,
    favorites_repo: Any = None,
    analysis_repo: Any = None,
    analysis_svc: Any = None,
    extraction_svc: Any = None,
) -> AgentLoop:
    """从线程文件创建分析审阅子 Agent。"""
    agent = AgentLoop(
        llm, store,
        thread_store=thread_repo,
        update_log_store=update_log_repo,
        favorites_store=favorites_repo,
        analysis_store=analysis_repo,
        analysis_svc=analysis_svc,
        extraction_svc=extraction_svc,
    )
    for m in thread.get("messages", []):
        if m.get("role") != "system" or "[全局上下文]" not in (m.get("content") or ""):
            agent.history.append(dict(m))
    agent.child.agent_role = "analysis_reviewer"
    agent.child.is_child = True
    agent.child.exp_id = anal_id
    agent.child.initial_history_len = len(agent.history)
    agent.thread.id = thread.get("id")
    agent._append_history({
        "role": "system",
        "content": (
            "[系统状态] 你正在审阅一份已完成的分析报告。"
            "可用工具：read_experiment（查看报告中引用的实验）、search_experiments、"
            "read_update_log、read_analysis（读取当前报告完整正文）。分析报告已归档，不可修改。"
        ),
    })
    return agent


def build_legacy_child(
    llm: Any,
    store: Any,
    exp_data: dict[str, Any],
    thread_repo: Any = None,
    update_log_repo: Any = None,
    favorites_repo: Any = None,
    analysis_repo: Any = None,
    attachment_store: Any = None,
) -> AgentLoop:
    """为无线程关联的旧实验创建子 Agent。"""
    return AgentLoop.create_legacy_child_agent(
        llm, store, exp_data,
        thread_store=thread_repo,
        update_log_store=update_log_repo,
        favorites_store=favorites_repo,
        analysis_store=analysis_repo,
        attachment_store=attachment_store,
    )
