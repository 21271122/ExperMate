from flask import Blueprint, request, redirect, url_for, jsonify, render_template, g
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
    is_json = request.is_json or request.headers.get("Accept", "") == "application/json"

    if notes_raw and "<" in notes_raw:
        notes_plain = strip_html(notes_raw)
    else:
        notes_plain = notes_raw
    if not notes_plain or len(notes_plain) < 10:
        msg = "实验描述太短，请提供更多细节（至少 10 个字符）。"
        if is_json:
            return jsonify({"ok": False, "error": msg}), 400
        return render_template("new.html", error=msg)

    llm = g.get_extract_llm()
    if not llm:
        msg = '未配置 DeepSeek API Key。请点击导航栏的"设置"按钮配置 API Key。'
        if is_json:
            return jsonify({"ok": False, "error": msg}), 500
        return render_template("new.html", error=msg)

    try:
        result = parse_notes(notes_plain, llm)
    except Exception as e:
        msg = f"AI 处理失败: {str(e)}"
        if is_json:
            return jsonify({"ok": False, "error": msg}), 500
        return render_template("new.html", error=msg)

    result["original_notes"] = notes_raw if notes_raw else notes_plain
    result["id"] = g.exp_repo.next_id()
    if is_json:
        return jsonify({"ok": True, "data": result})
    exp_id = g.exp_repo.save(result)
    g.experiment_svc.move_draft_images(exp_id)
    _notify_experiment_created(exp_id)
    return redirect(url_for("experiment.view_experiment", exp_id=exp_id))


@api_experiment_bp.route("/parse/confirm", methods=["POST"])
def api_parse_confirm():
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify({"ok": False, "error": "无效的实验数据"}), 400

    exp_id = data.get("id") or g.exp_repo.next_id()
    data["id"] = exp_id
    notes = data.get("original_notes", "")
    refs = g.experiment_svc.extract_references(notes)
    data["references"] = refs
    g.exp_repo.save(data)
    g.experiment_svc.update_referenced_by(exp_id, refs)
    g.experiment_svc.move_draft_images(exp_id)
    _notify_experiment_created(exp_id)
    return jsonify({"ok": True, "exp_id": exp_id})
