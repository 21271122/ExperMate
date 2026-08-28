import yaml
from flask import Blueprint, request, redirect, url_for, jsonify, render_template, g
from lib.parser import parse_notes, strip_html

experiment_bp = Blueprint("experiment", __name__)


def _notify_experiment_change(exp_id, action):
    from routes.api_agent import publish_resource_change
    publish_resource_change(exp_id, action, request.headers.get("X-Exdiary-Client-Id", ""))


# 页面路由已迁移到 fragments_bp（/_fragment/...）
# 此蓝图仅保留 API/动作路由


@experiment_bp.route("/<exp_id>/yaml")
def view_yaml(exp_id):
    exp = g.exp_repo.load(exp_id)
    if not exp:
        return "Experiment not found", 404
    raw = yaml.dump(exp, allow_unicode=True, sort_keys=False,
                    default_flow_style=False, indent=2)
    return raw, 200, {"Content-Type": "text/plain; charset=utf-8"}


def _set_experiment_archive(exp_id, archived):
    data = request.get_json(silent=True) or {}
    expected_revision = data.get("expected_revision")
    if expected_revision is not None:
        try:
            expected_revision = int(expected_revision)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid revision"}), 400
    result = g.experiment_svc.set_archived_with_log(exp_id, archived, expected_revision)
    if not result.get("ok"):
        status = 409 if result.get("error") == "revision_conflict" else 404
        return jsonify({"ok": False, "error": "内容已在另一窗口更新，请刷新后再操作。"
                        if status == 409 else "实验不存在", "revision": result.get("revision")}), status
    action = "archived" if archived else "restored"
    _notify_experiment_change(exp_id, action)
    return jsonify({"ok": True, "archived": archived, "revision": result.get("revision")})


@experiment_bp.route("/<exp_id>/archive", methods=["POST"])
def archive_experiment(exp_id):
    return _set_experiment_archive(exp_id, True)


@experiment_bp.route("/<exp_id>/restore", methods=["POST"])
def restore_experiment(exp_id):
    return _set_experiment_archive(exp_id, False)


@experiment_bp.route("/<exp_id>/delete", methods=["DELETE"])
def delete_experiment(exp_id):
    """旧客户端兼容：DELETE 现在也是归档。"""
    return _set_experiment_archive(exp_id, True)


@experiment_bp.route("/<exp_id>/save-json", methods=["POST"])
def save_experiment_json(exp_id):
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Invalid JSON"}), 400
    expected_revision = data.pop("expected_revision", None)
    old_exp = g.exp_repo.load(exp_id)
    if old_exp and expected_revision is not None and hasattr(g.exp_repo, "save_if_revision"):
        try:
            expected_revision = int(expected_revision)
        except (TypeError, ValueError):
            return jsonify({"ok": False, "error": "Invalid revision"}), 400
        result = g.experiment_svc.save_and_update_refs_if_revision(
            exp_id, data, expected_revision, source="manual_edit"
        )
        if not result.get("ok"):
            return jsonify({"ok": False, "error": "内容已在另一窗口更新，请刷新后再保存。",
                            "revision": result.get("revision")}), 409
        _notify_experiment_change(exp_id, "edited")
        return jsonify({"ok": True, "revision": result["revision"]})
    old_refs = old_exp.get("references", []) if old_exp else []
    g.experiment_svc.save_and_update_refs(exp_id, data, source="manual_edit", old_refs=old_refs)
    _notify_experiment_change(exp_id, "edited")
    saved = g.exp_repo.load(exp_id) or {}
    return jsonify({"ok": True, "revision": saved.get("revision", 0)})


@experiment_bp.route("/<exp_id>/regenerate", methods=["POST"])
def regenerate_experiment(exp_id):
    exp = g.exp_repo.load(exp_id)
    if not exp:
        return jsonify({"ok": False, "error": "Experiment not found"}), 404

    notes_raw = request.form.get("original_notes", "").strip()
    if notes_raw and "<" in notes_raw:
        notes_plain = strip_html(notes_raw)
    else:
        notes_plain = notes_raw
    if not notes_plain or len(notes_plain) < 10:
        return jsonify({"ok": False, "error": "Notes too short"}), 400

    llm = g.get_extract_llm()
    if not llm:
        return jsonify({"ok": False, "error": "No API key configured"}), 500

    try:
        result = parse_notes(notes_plain, llm)
    except Exception as e:
        return jsonify({"ok": False, "error": f"AI processing failed: {str(e)}"}), 500

    result["original_notes"] = notes_raw if notes_raw else notes_plain
    result["id"] = exp_id
    refs = g.experiment_svc.extract_references(notes_raw if notes_raw else notes_plain)
    result["references"] = refs
    old_exp = g.exp_repo.load(exp_id)
    old_refs = old_exp.get("references", []) if old_exp else []
    g.exp_repo.update(exp_id, result)
    g.experiment_svc.update_referenced_by(exp_id, refs, old_refs=old_refs)
    _notify_experiment_change(exp_id, "regenerated")
    return jsonify({"ok": True})


@experiment_bp.route("/<exp_id>/print")
def print_experiment(exp_id):
    exp = g.exp_repo.load(exp_id)
    if not exp:
        return "Experiment not found", 404
    return render_template("print.html", exp=exp)


@experiment_bp.route("/analysis/<anal_id>/print")
def print_analysis(anal_id):
    a = g.analysis_repo.load(anal_id)
    if not a:
        return "Analysis not found", 404
    return render_template("print_analysis.html", analysis=a)
