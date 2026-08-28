import json
from datetime import datetime as dt
from flask import Blueprint, request, jsonify, g, Response, stream_with_context
from lib.agent_v2 import AgentLoop
from lib.agent_factory import (
    get_or_create_agent,
    build_child_for_thread,
    build_analysis_child,
    build_legacy_child,
)

api_child_bp = Blueprint("api_child", __name__)

_MODIFY_MODE_PROMPT = (
    "[修改模式] 你正在修改已完成的实验 {exp_id}。"
    "修改前先用 read_experiment 读取磁盘最新数据和 revision（不要依赖对话记忆）。"
    "修改用 modify_experiment 工具直接执行，会自动保存和记录日志。"
    "不要用 update_schema 或 generate_record。"
    "查询信息用 read_experiment，查历史用 read_update_log。"
    "只能处理当前实验，附件只能关联到当前实验。"
)


def _run_agent(agent, user_message, created_at=None):
    history_start = len(agent.history)
    result = agent.run(user_message, created_at=created_at)
    from routes.api_agent import publish_agent_history_resource_changes
    publish_agent_history_resource_changes(agent, history_start)
    return result


def _stream_agent(agent, user_message, created_at, state_key):
    """子 Agent 与主 Agent 使用同样的 SSE 事件格式，末尾持久化子状态。"""
    history_start = len(agent.history)

    def generate():
        try:
            for event in agent.run_stream(user_message, created_at=created_at):
                if event.get("event") == "done":
                    state = agent.state_to_dict()
                    if state_key:
                        g.thread_repo.save_child_state(state_key, state)
                    from routes.api_agent import publish_agent_history_resource_changes
                    publish_agent_history_resource_changes(agent, history_start)
                    event["state"] = state
                    if agent._generated_preview is not None:
                        event["preview"] = agent._generated_preview
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'event': 'error', 'message': f'AI 处理失败: {exc}'}, ensure_ascii=False)}\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _migrate_legacy_analysis(anal_id, analysis_data):
    tid = g.thread_repo.next_id()
    now = dt.now().strftime("%Y-%m-%d %H:%M:%S")
    messages = [
        {"role": "system", "content": f"旧分析记录 {anal_id}，于 {now} 迁移至线程系统。"},
        {"role": "user", "content": analysis_data.get("question", "")},
        {"role": "assistant", "content": "（分析报告见系统消息）"},
        {"role": "system", "content": f"[分析报告内容]\n{analysis_data.get('analysis', '')}"},
    ]
    thread = {"id": tid, "type": "analyze", "status": "done",
              "created": now, "updated": now,
              "title": (analysis_data.get("question") or "分析")[:30],
              "summary": f"迁移自旧分析记录 {anal_id}",
              "anal_generated": anal_id,
              "messages": messages, "branches": []}
    g.thread_repo.save(thread)
    g.thread_repo.update_index(thread)
    return tid


def _make_analysis_chat_response(agent, result, thread_id):
    state = agent.state_to_dict()
    if thread_id:
        g.thread_repo.save_child_state(thread_id, state)
    return jsonify({"ok": True, "state": state,
                    "type": result.get("type", "reply"),
                    "message": result.get("message", "")})


def _restore_analysis_child_identity(agent, anal_id, thread_id):
    """子 Agent 快照不能因旧标记错误退化为主 Agent。"""
    agent.child.is_child = True
    agent.child.is_legacy = False
    agent.child.agent_role = "analysis_reviewer"
    agent.child.exp_id = anal_id
    agent.thread.id = thread_id
    agent.thread.type = "analyze"


def _restore_experiment_child_identity(agent, exp_id, thread_id=None):
    """旧快照恢复后也始终按实验编辑子 Agent 运行。"""
    agent.child.is_child = True
    agent.child.agent_role = "exp_editor"
    agent.child.exp_id = exp_id
    if thread_id:
        agent.thread.id = thread_id
        agent.thread.type = "record"
    else:
        agent.thread.id = None
        agent.thread.type = None


def _make_chat_response(agent, result, thread_id):
    state = agent.state_to_dict()
    key = thread_id or agent.child.exp_id
    if key:
        g.thread_repo.save_child_state(key, state)
    if result["type"] in ("extract", "generate"):
        preview = agent._generated_preview
        return jsonify({"ok": True, "type": "extract", "state": state,
                        "message": result.get("message", "实验记录已生成，请在预览中确认。"),
                        "preview": preview})
    return jsonify({"ok": True, "state": state, "type": result["type"],
                    "message": result.get("message", "")})




@api_child_bp.route("/analysis/<anal_id>/chat", methods=["POST"])
def api_analysis_chat(anal_id):
    llm = g.get_agent_llm()
    if not llm:
        return jsonify({"ok": False, "error": "未配置 Agent 模型 API Key"}), 500

    a = g.analysis_repo.load(anal_id)
    if not a:
        return jsonify({"ok": False, "error": "分析报告不存在"}), 404

    data = request.get_json() or {}
    user_message = (data.get("message") or "").strip()
    created_at = str(data.get("created_at") or "").strip() or None
    state_dict = data.get("state")
    wants_stream = bool(data.get("stream"))

    idx = g.thread_repo.get_index()
    thread_id = idx.get("anal_to_thread", {}).get(anal_id)

    if not thread_id:
        if not user_message and not state_dict:
            return jsonify({"ok": True, "is_legacy": True,
                            "anal_data": {"id": a.get("id"),
                                          "question": a.get("question", ""),
                                          "timestamp": a.get("timestamp", ""),
                                          "selected_ids": a.get("selected_ids", []),
                                          "analysis": (a.get("analysis") or "")[:500]}})
        thread_id = _migrate_legacy_analysis(anal_id, a)

    if not state_dict:
        disk_state = g.thread_repo.load_child_state(thread_id)
        if disk_state:
            state_dict = disk_state

    if state_dict:
        agent = get_or_create_agent(
            llm=llm, exp_repo=g.exp_repo, state_dict=state_dict,
            thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
            favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
            analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc)
        _restore_analysis_child_identity(agent, anal_id, thread_id)
        if user_message:
            if wants_stream:
                return _stream_agent(agent, user_message, created_at, thread_id)
            result = _run_agent(agent, user_message, created_at)
            return _make_analysis_chat_response(agent, result, thread_id)
        state = agent.state_to_dict()
        g.thread_repo.save_child_state(thread_id, state)
        return jsonify({"ok": True, "state": state})

    thread = g.thread_repo.load(thread_id)
    if not thread:
        return jsonify({"ok": False, "error": "线程不存在"}), 500

    agent = build_analysis_child(llm, g.exp_repo, thread, anal_id,
            thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
            favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
            analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc)
    _restore_analysis_child_identity(agent, anal_id, thread_id)
    if user_message:
        if wants_stream:
            return _stream_agent(agent, user_message, created_at, thread_id)
        result = _run_agent(agent, user_message, created_at)
        return _make_analysis_chat_response(agent, result, thread_id)
    state = agent.state_to_dict()
    g.thread_repo.save_child_state(thread_id, state)
    return jsonify({"ok": True, "state": state})


@api_child_bp.route("/exp/<exp_id>/chat", methods=["POST"])
def api_exp_chat(exp_id):
    llm = g.get_agent_llm()
    if not llm:
        return jsonify({"ok": False, "error": "未配置 Agent 模型 API Key"}), 500

    data = request.get_json() or {}
    user_message = (data.get("message") or "").strip()
    created_at = str(data.get("created_at") or "").strip() or None
    state_dict = data.get("state")
    wants_stream = bool(data.get("stream"))
    is_legacy = data.get("is_legacy", False)

    idx = g.thread_repo.get_index()
    thread_id = idx.get("exp_to_thread", {}).get(exp_id)

    if not thread_id:
        exp = g.exp_repo.load(exp_id)
        if not exp:
            return jsonify({"ok": False, "error": "实验不存在"}), 404

        disk_state = g.thread_repo.load_child_state(exp_id)
        if disk_state and not is_legacy:
            agent = get_or_create_agent(
                llm=llm, exp_repo=g.exp_repo, state_dict=disk_state,
                thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
                favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
                analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc,
                attachment_store=g.attachment_store)
            _restore_experiment_child_identity(agent, exp_id)
            if user_message:
                if wants_stream:
                    return _stream_agent(agent, user_message, created_at, exp_id)
                result = _run_agent(agent, user_message, created_at)
                return _make_chat_response(agent, result, None)
            state = agent.state_to_dict()
            g.thread_repo.save_child_state(exp_id, state)
            return jsonify({"ok": True, "state": state})

        if not user_message and not is_legacy:
            return jsonify({"ok": True, "is_legacy": True,
                            "exp_data": {"id": exp.get("id"),
                                         "title": exp.get("title", ""),
                                         "date": exp.get("date", ""),
                                         "status": exp.get("status", ""),
                                         "tags": exp.get("tags", []),
                                         "purpose": (exp.get("purpose") or "")[:200],
                                         "materials": exp.get("materials", []),
                                         "sop": exp.get("sop", []),
                                         "process_parameters": exp.get("process_parameters", []),
                                         "results": exp.get("results", {}),
                                         "conclusion": (exp.get("conclusion") or "")[:200],
                                         "next_steps": exp.get("next_steps", [])}})

        exp_data = {"id": exp.get("id"), "title": exp.get("title", ""),
                    "tags": exp.get("tags", []),
                    "purpose": (exp.get("purpose") or "")[:200],
                    "materials": exp.get("materials", []), "sop": exp.get("sop", []),
                    "process_parameters": exp.get("process_parameters", []),
                    "results": exp.get("results", {}),
                    "conclusion": (exp.get("conclusion") or "")[:200],
                    "next_steps": exp.get("next_steps", []),
                    "status": exp.get("status", "done"),
                    "date": exp.get("date", ""),
                    "experimenter": exp.get("experimenter", "")}
        agent = build_legacy_child(
            llm, g.exp_repo, exp_data,
            thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
            favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
            attachment_store=g.attachment_store)
        _restore_experiment_child_identity(agent, exp_id)
        agent._append_history({
            "role": "system",
            "content": _MODIFY_MODE_PROMPT.format(exp_id=exp_id),
        })
        if wants_stream:
            return _stream_agent(agent, user_message, created_at, thread_id or exp_id)
        result = _run_agent(agent, user_message, created_at)
        return _make_chat_response(agent, result, thread_id)

    if not state_dict:
        disk_state = g.thread_repo.load_child_state(thread_id)
        if disk_state:
            state_dict = disk_state

    if state_dict:
        agent = get_or_create_agent(
            llm=llm, exp_repo=g.exp_repo, state_dict=state_dict,
            thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
            favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
            analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc,
            attachment_store=g.attachment_store)
        _restore_experiment_child_identity(agent, exp_id, thread_id)
        if user_message:
            if wants_stream:
                return _stream_agent(agent, user_message, created_at, thread_id)
            result = _run_agent(agent, user_message, created_at)
            return _make_chat_response(agent, result, thread_id)
        state = agent.state_to_dict()
        if thread_id:
            g.thread_repo.save_child_state(thread_id, state)
        return jsonify({"ok": True, "state": state})

    parent = AgentLoop(llm, g.exp_repo,
                       thread_store=g.thread_repo,
                       update_log_store=g.update_log_repo,
                       favorites_store=g.favorites_repo,
                       analysis_store=g.analysis_repo, analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc,
                       attachment_store=g.attachment_store)
    agent = build_child_for_thread(parent, thread_id, "exp_editor")
    _restore_experiment_child_identity(agent, exp_id, thread_id)
    agent._append_history({
        "role": "system",
        "content": _MODIFY_MODE_PROMPT.format(exp_id=exp_id),
    })

    if user_message:
        if wants_stream:
            return _stream_agent(agent, user_message, created_at, thread_id or exp_id)
        result = _run_agent(agent, user_message, created_at)
        return _make_chat_response(agent, result, thread_id)
    state = agent.state_to_dict()
    if thread_id:
        g.thread_repo.save_child_state(thread_id, state)
    return jsonify({"ok": True, "state": state})


@api_child_bp.route("/exp/<exp_id>/confirm", methods=["POST"])
def api_exp_confirm(exp_id):
    body = request.get_json()
    if not body or not isinstance(body, dict):
        return jsonify({"ok": False, "error": "无效的请求数据"}), 400

    data = body.get("preview") or {}
    state_dict = body.get("state")
    if not data or not isinstance(data, dict):
        return jsonify({"ok": False, "error": "缺少实验数据"}), 400

    old_exp = g.exp_repo.load(exp_id)
    data["id"] = exp_id

    notes = data.get("original_notes", "")
    refs = g.experiment_svc.extract_references(notes)
    old_refs = old_exp.get("references", []) if old_exp else []
    data["references"] = refs

    thread_id = None
    if state_dict and isinstance(state_dict, dict):
        thread_id = state_dict.get("thread_id")

    g.experiment_svc.save_with_log(exp_id, data, "child_agent", thread_id=thread_id)
    g.exp_repo.save(data)
    g.experiment_svc.update_referenced_by(exp_id, refs, old_refs=old_refs)
    from routes.api_agent import publish_resource_change
    publish_resource_change(exp_id, "edited", request.headers.get("X-Exdiary-Client-Id", ""))
    return jsonify({"ok": True, "exp_id": exp_id})
