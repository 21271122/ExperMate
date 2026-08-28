from flask import Blueprint, jsonify, g

templates_bp = Blueprint("templates", __name__)

# GET /templates 页面路由已迁移到 fragments_bp（/_fragment/templates）


@templates_bp.route("/api/templates/<template_id>")
def api_get_template(template_id):
    tmpl = g.template_svc.load(template_id)
    if not tmpl:
        return jsonify({"ok": False, "error": "Template not found"}), 404
    return jsonify({"ok": True, "title": tmpl.get("title", ""),
                    "content": tmpl.get("content", "")})
