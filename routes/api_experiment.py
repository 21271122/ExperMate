from flask import Blueprint, g, jsonify, request

from lib.parser import parse_notes, strip_html

api_experiment_bp = Blueprint("api_experiment", __name__)


def _notify_experiment_created(exp_id):
    from routes.api_agent import publish_resource_change
    publish_resource_change(exp_id, "created", request.headers.get("X-Exdiary-Client-Id", ""))


@api_experiment_bp.route("/parse", methods=["POST"])
def api_parse():
    notes_raw = request.form.get("notes", "").strip()
    if request.is_json:
        notes_raw = request.json.get("notes", "").strip()

    if notes_raw and "<" in notes_raw:
        notes_plain = strip_html(notes_raw)
    else:
        notes_plain = notes_raw
    if not notes_plain or len(notes_plain) < 10:
        msg = "实验描述太短，请提供更多细节（至少 10 个字符）。"
        return jsonify({"ok": False, "error": msg}), 400

    llm = g.get_extract_llm()
    if not llm:
        msg = '未配置 DeepSeek API Key。请点击导航栏的"设置"按钮配置 API Key。'
        return jsonify({"ok": False, "error": msg}), 500

    if getattr(g, 'record_svc', None):
        from lib.core.record_document import RecordDocument
        from lib.core.record_tools import RECORD_PROMPT
        document = llm.structured_extract(notes_plain, RECORD_PROMPT, RecordDocument.model_json_schema())
        draft = g.record_svc.create_draft({})
        draft['original_input'] = notes_raw
        g.record_svc.storage.save_draft(draft)
        proposal = g.record_svc.propose('draft', draft['id'], draft['revision'], document)
        return jsonify(ok=True, draft_id=draft['id'], proposal_id=proposal['id'], data=proposal)

    try:
        result = parse_notes(notes_plain, llm)
    except Exception as e:
        msg = f"AI 处理失败: {str(e)}"
        return jsonify({"ok": False, "error": msg}), 500

    result["original_notes"] = notes_raw if notes_raw else notes_plain
    result["id"] = g.exp_repo.next_id()
    return jsonify({"ok": True, "data": result})


@api_experiment_bp.route("/parse/confirm", methods=["POST"])
def api_parse_confirm():
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify({"ok": False, "error": "无效的实验数据"}), 400
    if getattr(g, 'record_svc', None):
        if not all(key in data for key in ('draft_id', 'expected_revision', 'request_id')):
            return jsonify(error={'code': 'use_record_draft', 'message': '请先确认草稿结构，再发布记录。'}), 409
        from lib.services.record_document import RecordError
        try:
            record = g.record_svc.publish(data['draft_id'], data['expected_revision'], data['request_id'])
        except RecordError as error:
            return jsonify(error={'code': error.code, 'message': str(error)}), error.status
        _notify_experiment_created(record['id'])
        return jsonify(ok=True, exp_id=record['id'])

    exp_id = data.get("id") or g.exp_repo.next_id()
    data["id"] = exp_id
    notes = data.get("original_notes", "")
    refs = g.experiment_svc.extract_references(notes)
    data["references"] = refs
    g.exp_repo.save(data)
    g.experiment_svc.update_referenced_by(exp_id, refs)
    _notify_experiment_created(exp_id)
    return jsonify({"ok": True, "exp_id": exp_id})
