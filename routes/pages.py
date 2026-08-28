"""Auto-generated from app.py."""
from flask import Blueprint, send_from_directory

pages_bp = Blueprint("pages", __name__)

# 页面路由已迁移到 fragments_bp（/_fragment/...）
# 此蓝图仅保留静态资源路由

# ---- AI Shell 静态资源 ----

@pages_bp.route("/ai-shell/")
def ai_shell_index():
    return send_from_directory("ai-shell", "index.html")

@pages_bp.route("/ai-shell/static/<path:filename>")
def ai_shell_static(filename: str):
    return send_from_directory("ai-shell/static", filename)
