from flask import Blueprint, jsonify, g, request

api_analysis_bp = Blueprint("api_analysis", __name__)


@api_analysis_bp.route("/analysis-history")
def api_analysis_history():
    return jsonify(g.analysis_repo.list_all())


@api_analysis_bp.route("/analysis-history/<anal_id>")
def api_analysis_detail(anal_id):
    a = g.analysis_repo.load(anal_id)
    if not a:
        return jsonify({"ok": False, "error": "Not found"}), 404
    return jsonify({"ok": True, "data": a})


@api_analysis_bp.route("/analysis-history/<anal_id>", methods=["DELETE"])
def api_analysis_delete(anal_id):
    ok = g.analysis_repo.delete(anal_id)
    if ok:
        from routes.api_agent import publish_named_resource_change
        publish_named_resource_change(
            "analysis", "deleted", request.headers.get("X-Exdiary-Client-Id", ""),
            anal_id=anal_id,
        )
    return jsonify({"ok": ok})
