import json
import queue
import re
import threading
import uuid
from flask import Blueprint, request, jsonify, Response, g, stream_with_context
from lib.agent_factory import get_or_create_agent, load_parent_runtime_state
from routes.api_experiment import api_parse_confirm
from routes.api_attachment import store_uploaded_attachment

api_agent_bp = Blueprint("api_agent", __name__)


# 同一账号可在桌面 WebView 与浏览器中同时打开。运行状态不能再依赖任一
# 窗口各自的 sessionStorage，因此用进程内事件总线把流式事件分发给全部窗口。
_event_lock = threading.RLock()
_event_subscribers = {}
_run_locks = {}
_active_runs = {}
_HISTORY_PAGE_SIZE = 50


def _channel_key():
    return g.user_id or "__offline__"


def _context_compression_options() -> dict:
    """设置只影响主 Agent；每次从持久化状态恢复时读取最新配置。"""
    return {
        "context_compression_trigger_tokens": g.config.get("CONTEXT_COMPRESSION_TRIGGER_TOKENS", 300_000),
        "context_compression_chunk_tokens": g.config.get("CONTEXT_COMPRESSION_CHUNK_TOKENS", 260_000),
    }


def _agent_data_freshness_context() -> str:
    """每个顶层用户回合主动拉取一次，并把真实同步结果交给 Agent。"""
    if not g.user_id:
        return (
            "[数据同步状态]\n当前为离线数据模式，未连接账号同步。"
            "本机数据库是本轮唯一可读取的数据来源。"
        )
    gateway = getattr(g, "_sync_gateway", None)
    if gateway is None:
        return (
            "[数据同步状态]\n账号同步尚未就绪，本轮无法确认其他设备的最新改动。"
            "本机对话中的旧实验陈述可能过期；涉及读取、判断、修改或删除时必须用工具读取当前数据。"
        )
    gateway.pull()
    status = gateway.last_pull_status()
    if not status.get("ok"):
        return (
            "[数据同步状态]\n本轮开始前远端同步失败，无法确认其他设备的最新改动。"
            "本机对话中的旧实验陈述可能过期；涉及读取、判断、修改或删除时必须用工具读取当前数据。"
        )
    changes = status.get("changed") or []
    rendered = []
    for change in changes[:8]:
        entity_type = str(change.get("type") or "资源")
        entity_id = str(change.get("id") or "")
        revision = change.get("revision")
        suffix = f" rev {revision}" if revision is not None else ""
        rendered.append(f"{entity_type}:{entity_id}{suffix}")
    change_text = "、".join(rendered) if rendered else "无外部数据变更"
    if len(changes) > len(rendered):
        change_text += f"，另有 {len(changes) - len(rendered)} 项"
    return (
        "[数据同步状态]\n"
        f"本轮开始前远端同步成功（{status.get('pulled_at') or '时间未知'}）；"
        f"本次收到 {len(changes)} 项变化：{change_text}。\n"
        "本机对话中的旧实验陈述不保证仍正确；涉及读取、判断、修改或删除时必须调用工具读取当前数据。"
    )


def _message_attachments(raw) -> list[dict]:
    """只接受当前账号已上传的附件，避免客户端伪造其他账号的引用。"""
    if not isinstance(raw, list):
        return []
    attachments = []
    seen = set()
    for item in raw[:10]:
        sha256 = str((item or {}).get("sha256") or "").strip() if isinstance(item, dict) else ""
        if not re.fullmatch(r"[0-9a-f]{64}", sha256) or sha256 in seen:
            continue
        meta = g.attachment_store.meta(sha256)
        if not meta:
            continue
        seen.add(sha256)
        attachments.append({
            "sha256": sha256, "name": meta.get("name", ""), "mime": meta.get("mime", ""),
            "size": meta.get("size", 0),
        })
    return attachments


@api_agent_bp.route("/attachments", methods=["POST"])
def api_agent_attachment_upload():
    """聊天附件先只入附件库；是否关联实验由后续 Agent 工具决定。"""
    file = request.files.get("file")
    try:
        meta = store_uploaded_attachment(file)
    except OverflowError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 413
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    return jsonify({"ok": True, "attachment": {
        "sha256": meta["sha256"], "name": meta.get("name", ""),
        "mime": meta.get("mime", ""), "size": meta.get("size", 0),
    }})


def _run_lock(channel):
    with _event_lock:
        return _run_locks.setdefault(channel, threading.Lock())


def _history_page(state, before=None, limit=_HISTORY_PAGE_SIZE):
    """从当前会话的原文历史取一页，包含压缩归档与运行态尾部。"""
    session_id = str((state or {}).get("_session_id") or "")
    if session_id:
        try:
            before_sequence = None if before is None else int(before)
        except (TypeError, ValueError):
            before_sequence = None
        try:
            return g.thread_repo.page_chat_history(
                session_id, before_sequence, limit, current_state=state or {},
            )
        except (TypeError, ValueError):
            pass
    # 兼容尚未拥有 session_id 的旧运行态。
    history = list((state or {}).get("history") or [])
    total = len(history)
    try:
        end = total if before is None else max(0, min(int(before), total))
    except (TypeError, ValueError):
        end = total
    limit = max(1, min(int(limit), 100))
    start = max(0, end - limit)
    return {"history": history[start:end], "history_start": start, "history_total": total}


def _client_state(state):
    """浏览器只需要运行元数据；完整 history 留在服务端并按页获取。"""
    result = dict(state or {})
    result.pop("history", None)
    # 摘要只给模型作为当前会话上下文，聊天页始终渲染原始消息。
    result.pop("_session_summary", None)
    return result


def _state_with_latest_history(state):
    return {"state": _client_state(state), **_history_page(state)}


def _subscribe(channel):
    subscriber = queue.Queue()
    with _event_lock:
        _event_subscribers.setdefault(channel, set()).add(subscriber)
        active = dict(_active_runs.get(channel) or {})
    return subscriber, active


def _unsubscribe(channel, subscriber):
    with _event_lock:
        subscribers = _event_subscribers.get(channel)
        if not subscribers:
            return
        subscribers.discard(subscriber)
        if not subscribers:
            _event_subscribers.pop(channel, None)


def _publish(channel, event):
    with _event_lock:
        active = _active_runs.get(channel)
        if active and active.get("request_id") == event.get("request_id"):
            if event.get("event") == "text":
                active["text"] += event.get("content", "")
            elif event.get("event") in ("done", "error"):
                _active_runs.pop(channel, None)
        subscribers = list(_event_subscribers.get(channel, ()))
    for subscriber in subscribers:
        subscriber.put(event)


def publish_named_resource_change_for_user(user_id, resource, action, origin_id="", **details):
    """供后台同步线程通知指定账号的已打开窗口。"""
    event = {
        "event": "resource_changed",
        "resource": resource,
        "action": action,
        "origin_id": origin_id,
    }
    event.update({key: value for key, value in details.items() if value is not None})
    _publish(user_id or "__offline__", event)


def publish_resource_change_for_user(user_id, exp_id, action, origin_id=""):
    """兼容已有调用：通知某个实验发生变化。"""
    publish_named_resource_change_for_user(
        user_id, "experiment", action, origin_id, exp_id=exp_id
    )


def publish_resource_change(exp_id, action, origin_id=""):
    """通知同一账号的其他窗口：实验数据已在服务端变更。"""
    publish_resource_change_for_user(_channel_key(), exp_id, action, origin_id)


def publish_named_resource_change(resource, action, origin_id="", **details):
    """通知当前账号的窗口：指定类型的资源已变化。"""
    publish_named_resource_change_for_user(
        _channel_key(), resource, action, origin_id, **details
    )


def _publish_agent_resource_change(channel, name, args, result):
    """Agent 工具直接写入仓储后，立即刷新所有已打开的相关页面。"""
    if not isinstance(result, dict) or result.get("error"):
        return
    if name == "modify_experiment":
        for exp_id, item in (result.get("modified") or {}).items():
            if isinstance(item, dict) and item.get("status") == "modified":
                publish_named_resource_change_for_user(
                    channel, "experiment", "edited", exp_id=str(exp_id)
                )
    elif name == "manage_archive" and result.get("changed"):
        action = "archived" if result.get("action") == "archive" else "restored"
        for exp_id in result.get("refs") or []:
            publish_named_resource_change_for_user(
                channel, "experiment", action, exp_id=str(exp_id)
            )
    elif name == "manage_attachment" and result.get("status") == "ok":
        publish_named_resource_change_for_user(
            channel, "experiment", "edited", exp_id=result.get("exp_id")
        )
    elif name in ("manage_category", "manage_collection") and result.get("changed"):
        publish_named_resource_change_for_user(channel, "categories", "updated")
    elif name == "generate_analysis":
        anal_id = result.get("anal_id")
        if result.get("display") != "analysis_done":
            return
        if anal_id:
            publish_named_resource_change_for_user(
                channel, "analysis", "created",
                anal_id=anal_id,
            )


def publish_agent_history_resource_changes(agent, history_start=0):
    """非流式父/子 Agent 也复用同一套资源变更通知。"""
    tool_names = {}
    for message in (agent.history or [])[history_start:]:
        if message.get("role") == "assistant":
            for call in message.get("tool_calls") or []:
                function = call.get("function") or {}
                tool_names[call.get("id")] = function.get("name")
        elif message.get("role") == "tool":
            try:
                result = json.loads(message.get("content") or "{}")
            except (TypeError, json.JSONDecodeError):
                continue
            name = tool_names.get(message.get("tool_call_id"))
            if name:
                _publish_agent_resource_change(_channel_key(), name, {}, result)


def _resolve_selector(agent, tool_call_id, status, selected_ids):
    """在服务端唯一 state 中原子地确认或取消一个选择器。"""
    for message in reversed(agent.history):
        if message.get("role") != "tool" or message.get("tool_call_id") != tool_call_id:
            continue
        try:
            result = json.loads(message.get("content") or "{}")
        except (TypeError, json.JSONDecodeError):
            return None, "选择面板状态无效"
        if result.get("display") != "selector":
            return None, "未找到实验选择面板"
        if result.get("status") in ("confirmed", "cancelled"):
            return None, "该选择已处理"
        candidate_ids = {
            str(item.get("id")) for item in result.get("items", [])
            if isinstance(item, dict) and item.get("id")
        }
        if status == "confirmed" and (
            len(set(selected_ids)) != len(selected_ids)
            or any(exp_id not in candidate_ids for exp_id in selected_ids)
        ):
            return None, "所选实验已失效，请重新打开选择面板"
        result["status"] = status
        result["selected_ids"] = selected_ids if status == "confirmed" else []
        message["content"] = json.dumps(result, ensure_ascii=False)
        # 选择结果是分析任务的正式输入，不依赖主 Agent 从聊天文本里再猜一次。
        thread_id = agent.thread.id
        if thread_id:
            thread = agent.thread_store.load(thread_id)
            if thread and thread.get("type") == "analyze" and thread.get("status") == "active":
                thread["selected_exps"] = result["selected_ids"]
                agent.thread_store.save(thread)
        agent.thread_store.save_current_state(agent.state_to_dict())
        return agent.state_to_dict(), None
    return None, "未找到实验选择面板"


@api_agent_bp.route("/events")
def api_agent_events():
    """向每个同账号窗口转发另一窗口的 Agent 流式事件。"""
    channel = _channel_key()
    subscriber, active = _subscribe(channel)

    def generate():
        try:
            if active:
                yield f"data: {json.dumps({'event': 'sync', 'busy': True, **active}, ensure_ascii=False)}\n\n"
            while True:
                try:
                    event = subscriber.get(timeout=15)
                except queue.Empty:
                    yield ": keep-alive\n\n"
                    continue
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            _unsubscribe(channel, subscriber)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_agent_bp.route("/start", methods=["POST"])
def api_agent_start():
    llm = g.get_agent_llm()
    if not llm:
        return jsonify({"ok": False, "error": "未配置 Agent 模型 API Key"}), 500

    is_resumed = load_parent_runtime_state(g.thread_repo) is not None

    agent = get_or_create_agent(
        llm=llm, exp_repo=g.exp_repo, state_dict=None,
        thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
        favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
        analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc,
        attachment_store=g.attachment_store,
        **_context_compression_options(),
    )

    client_settings = {"analysis_timeout_seconds": g.config.get("ANALYSIS_TIMEOUT_SECONDS", 8 * 60)}
    if is_resumed:
        return jsonify({"ok": True, **client_settings, **_state_with_latest_history(agent.state_to_dict()),
                        "type": "resumed", "message": "",
                        "greeting": "会话已恢复。",
                        "context": {}})

    result = agent.run("")
    return jsonify({"ok": True, **client_settings, **_state_with_latest_history(agent.state_to_dict()),
                    "type": result["type"], "message": result.get("message", ""),
                    "greeting": result.get("message", ""),
                    "context": result.get("context", {})})


@api_agent_bp.route("/history")
def api_agent_history():
    """向上翻阅时按页读取当前未压缩聊天记录。"""
    try:
        limit = int(request.args.get("limit", _HISTORY_PAGE_SIZE))
    except ValueError:
        limit = _HISTORY_PAGE_SIZE
    state = load_parent_runtime_state(g.thread_repo) or {}
    return jsonify({"ok": True, **_history_page(state, request.args.get("before"), limit)})


def _history_date_arg(name):
    value = (request.args.get(name) or "").strip()
    if value and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError(f"{name} 必须是 YYYY-MM-DD")
    return value or None


@api_agent_bp.route("/history/search")
def api_agent_history_search():
    """跨压缩归档和当前尾部按正文搜索；仅返回可点击的短摘要。"""
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"ok": False, "error": "请输入搜索词"}), 400
    if len(query) > 200:
        return jsonify({"ok": False, "error": "搜索词不能超过 200 个字符"}), 400
    try:
        limit = max(1, min(int(request.args.get("limit", 20)), 50))
        date_from = _history_date_arg("date_from")
        date_to = _history_date_arg("date_to")
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    if date_from and date_to and date_from > date_to:
        return jsonify({"ok": False, "error": "起始日期不能晚于结束日期"}), 400
    session_id = (request.args.get("session_id") or "").strip() or None
    matches = g.thread_repo.search_chat_history(
        query, session_id=session_id, date_from=date_from, date_to=date_to, limit=limit,
    )
    return jsonify({"ok": True, "query": query, "matches": matches})


@api_agent_bp.route("/history/context")
def api_agent_history_context():
    """根据稳定定位加载命中记录附近的小窗口，而不是整段历史。"""
    session_id = (request.args.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"ok": False, "error": "缺少会话 ID"}), 400
    try:
        sequence = int(request.args["sequence"])
        before = max(0, min(int(request.args.get("before", 3)), 10))
        after = max(0, min(int(request.args.get("after", 3)), 10))
    except (KeyError, TypeError, ValueError):
        return jsonify({"ok": False, "error": "聊天记录定位参数无效"}), 400
    context = g.thread_repo.read_chat_history_context(session_id, sequence, before, after)
    if not context:
        return jsonify({"ok": False, "error": "未找到聊天记录"}), 404
    return jsonify({"ok": True, **context})


@api_agent_bp.route("/history/sessions")
def api_agent_history_sessions():
    """按时间列出会话，供聊天记录页或 agent 做非关键词翻阅。"""
    try:
        limit = max(1, min(int(request.args.get("limit", 20)), 100))
    except ValueError:
        return jsonify({"ok": False, "error": "limit 必须是整数"}), 400
    return jsonify({"ok": True, "sessions": g.thread_repo.list_chat_sessions(limit)})


@api_agent_bp.route("/history/browse")
def api_agent_history_browse():
    """按时间从新到旧分页读取一个会话，不把全量历史发送给前端。"""
    session_id = (request.args.get("session_id") or "").strip()
    if not session_id:
        return jsonify({"ok": False, "error": "缺少会话 ID"}), 400
    try:
        before_raw = request.args.get("before_sequence")
        before = int(before_raw) if before_raw is not None else None
        limit = max(1, min(int(request.args.get("limit", 20)), 100))
    except ValueError:
        return jsonify({"ok": False, "error": "聊天记录分页参数无效"}), 400
    return jsonify({"ok": True, **g.thread_repo.browse_chat_history(session_id, before, limit)})


@api_agent_bp.route("/selection", methods=["POST"])
def api_agent_selection():
    """提交实验选择，并让所有同账号窗口立即替换为确认后的选择卡片。"""
    data = request.get_json() or {}
    tool_call_id = (data.get("tool_call_id") or "").strip()
    status = data.get("status")
    selected_ids = data.get("selected_ids") or []
    if not tool_call_id or status not in ("confirmed", "cancelled"):
        return jsonify({"ok": False, "error": "选择请求无效"}), 400
    if status == "confirmed" and not selected_ids:
        return jsonify({"ok": False, "error": "请至少选择一个实验"}), 400
    if not isinstance(selected_ids, list) or not all(isinstance(exp_id, str) for exp_id in selected_ids):
        return jsonify({"ok": False, "error": "实验 ID 无效"}), 400

    channel = _channel_key()
    run_lock = _run_lock(channel)
    if not run_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "AI 正在生成回复，请稍后再提交选择"}), 409
    try:
        llm = g.get_agent_llm()
        if not llm:
            return jsonify({"ok": False, "error": "未配置 Agent 模型 API Key"}), 500
        agent = get_or_create_agent(
            llm=llm, exp_repo=g.exp_repo, state_dict=None,
            thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
            favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
            analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc,
            attachment_store=g.attachment_store,
            **_context_compression_options(),
        )
        state, error = _resolve_selector(agent, tool_call_id, status, selected_ids)
        if error:
            return jsonify({"ok": False, "error": error}), 409
        client_payload = _state_with_latest_history(state)
        event = {"event": "state", **client_payload,
                 "origin_id": data.get("client_id") or ""}
        _publish(channel, event)
        return jsonify({"ok": True, **client_payload})
    finally:
        run_lock.release()


@api_agent_bp.route("/message", methods=["POST"])
def api_agent_message():
    llm = g.get_agent_llm()
    if not llm:
        return jsonify({"ok": False, "error": "未配置 Agent 模型 API Key"}), 500

    data = request.get_json()
    if not data:
        return jsonify({"ok": False, "error": "缺少请求数据"}), 400

    attachments = _message_attachments(data.get("attachments"))
    user_message = (data.get("message") or "").strip()
    created_at = str(data.get("created_at") or "").strip() or None
    if not user_message and attachments:
        user_message = "我上传了附件，请查看并处理。"
    if not user_message:
        return jsonify({"ok": False, "error": "消息不能为空"}), 400

    run_lock = _run_lock(_channel_key())
    if not run_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "另一窗口正在生成回复"}), 409

    try:
        # 服务端已持久化的 state 是多个窗口共享的唯一真相；忽略客户端旧缓存。
        agent = get_or_create_agent(
            llm=llm, exp_repo=g.exp_repo, state_dict=None,
            thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
            favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
            analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc,
            attachment_store=g.attachment_store,
            **_context_compression_options(),
        )
        agent.set_data_freshness_context(_agent_data_freshness_context())
        history_start = len(agent.history)
        result = agent.run(user_message, attachments=attachments, created_at=created_at)
        publish_agent_history_resource_changes(agent, history_start)

        if result["type"] in ("extract", "generate"):
            preview = result["preview"]
            notes = result.get("notes", "")
            if not preview.get("id"):
                preview["id"] = g.exp_repo.next_id()
            refs = g.experiment_svc.extract_references(notes)
            preview["references"] = refs
            g.exp_repo.save(preview)
            g.experiment_svc.update_referenced_by(preview["id"], refs)
            g.experiment_svc.move_draft_images(preview["id"])
            publish_named_resource_change("experiment", "created", exp_id=preview["id"])
            return jsonify({"ok": True, "type": "saved", "exp_id": preview["id"],
                            **_state_with_latest_history(result.get("state") or agent.state_to_dict()),
                            "message": result.get("message", "实验记录已生成。")})

        return jsonify({"ok": True, **_state_with_latest_history(agent.state_to_dict()),
                        "type": result["type"], "message": result.get("message", ""),
                        "context": result.get("context", {})})
    finally:
        run_lock.release()


@api_agent_bp.route("/message/stream", methods=["POST"])
def api_agent_message_stream():
    llm = g.get_agent_llm()
    if not llm:
        return jsonify({"ok": False, "error": "未配置 Agent 模型 API Key"}), 500

    data = request.get_json()
    if not data:
        return jsonify({"ok": False, "error": "缺少请求数据"}), 400

    attachments = _message_attachments(data.get("attachments"))
    user_message = (data.get("message") or "").strip()
    created_at = str(data.get("created_at") or "").strip() or None
    if not user_message and attachments:
        user_message = "我上传了附件，请查看并处理。"
    if not user_message:
        return jsonify({"ok": False, "error": "消息不能为空"}), 400
    channel = _channel_key()
    run_lock = _run_lock(channel)
    if not run_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "另一窗口正在生成回复"}), 409

    try:
        agent = get_or_create_agent(
            llm=llm, exp_repo=g.exp_repo, state_dict=None,
            thread_repo=g.thread_repo, update_log_repo=g.update_log_repo,
            favorites_repo=g.favorites_repo, analysis_repo=g.analysis_repo,
            analysis_svc=g.analysis_svc, extraction_svc=g.extraction_svc,
            attachment_store=g.attachment_store,
            **_context_compression_options(),
        )
    except Exception:
        run_lock.release()
        raise
    agent.set_data_freshness_context(_agent_data_freshness_context())
    request_id = uuid.uuid4().hex
    history_before = list(agent.history)
    origin_id = data.get("client_id") or ""
    with _event_lock:
        _active_runs[channel] = {
            "request_id": request_id,
            "origin_id": origin_id,
            "message": user_message,
            "attachments": attachments,
            "created_at": created_at,
            "text": "",
        }

    def generate():
        completed = False
        try:
            _publish(channel, {"event": "start", "request_id": request_id,
                               "origin_id": origin_id, "message": user_message,
                               "attachments": attachments, "created_at": created_at})
            for event in agent.run_stream(user_message, attachments=attachments,
                                          created_at=created_at):
                if event.get("event") == "tool_done":
                    _publish_agent_resource_change(channel, event.get("name"),
                                                   event.get("args"), event.get("result"))
                    if (event.get("result") or {}).get("display"):
                        event["display_result"] = event["result"]
                    if (event.get("name") == "manage_music"
                            and (event.get("result") or {}).get("display") == "music_control"):
                        event["music_control"] = event["result"]
                    event = {key: value for key, value in event.items()
                             if key not in ("args", "result")}
                # 检查是否是 final done 事件
                if event.get("event") == "done":
                    preview = agent._generated_preview
                    if preview is not None:
                        notes = agent._generated_notes or ""
                        if not preview.get("id"):
                            preview["id"] = g.exp_repo.next_id()
                        refs = g.experiment_svc.extract_references(notes)
                        preview["references"] = refs
                        g.exp_repo.save(preview)
                        g.experiment_svc.update_referenced_by(preview["id"], refs)
                        g.experiment_svc.move_draft_images(preview["id"])
                        event["exp_id"] = preview["id"]
                        event["type"] = "saved"
                        publish_named_resource_change_for_user(
                            channel, "experiment", "created", exp_id=preview["id"]
                        )
                        agent._generated_preview = None
                    full_state = agent.state_to_dict()
                    event["state"] = _client_state(full_state)
                    # 压缩或线程标记插入会改变旧消息的索引，此时让客户端重取最新页；
                    # 常规轮次只传本轮新增消息。
                    if (len(agent.history) >= len(history_before)
                            and agent.history[:len(history_before)] == history_before):
                        sequence_start = agent._compressed_history_count + len(history_before)
                        event["history_append"] = [
                            {**message, "_sequence": sequence_start + index}
                            for index, message in enumerate(agent.history[len(history_before):])
                        ]
                        event["history_total"] = (
                            agent._compressed_history_count + len(agent.history)
                        )
                    else:
                        event["history_reset"] = True
                        event.update(_history_page(full_state))
                event["request_id"] = request_id
                event["origin_id"] = origin_id
                if event.get("event") == "done":
                    completed = True
                _publish(channel, event)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            # 兜底：任何未捕获异常都以 SSE error 事件返回（前端 new.html 会渲染），
            # 避免流被掐断只剩 "network error"；同时打进服务端日志便于定位。
            import traceback as _tb
            _tb.print_exc()
            event = {"event": "error", "message": f"AI 处理失败: {e}",
                     "request_id": request_id, "origin_id": origin_id}
            _publish(channel, event)
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
            completed = True
        finally:
            if not completed:
                _publish(channel, {"event": "error", "message": "AI 生成已中断",
                                   "request_id": request_id, "origin_id": origin_id})
            run_lock.release()

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_agent_bp.route("/confirm", methods=["POST"])
def api_agent_confirm():
    return api_parse_confirm()
