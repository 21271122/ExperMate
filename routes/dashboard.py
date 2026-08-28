"""Dashboard 蓝图 — Shell 入口 + 页面路由 catch-all。"""

from flask import Blueprint, send_from_directory

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/")
def index():
    return send_from_directory("ai-shell", "index.html")


# ---------------------------------------------------------------------------
# Catch-all: 所有页面路由都返回 Shell（ai-shell/index.html）
# Shell 加载后根据 window.location.pathname 自动 fetch 对应 /_fragment/ 片段
# ---------------------------------------------------------------------------

@dashboard_bp.route("/experiments")
@dashboard_bp.route("/experiments/<path:rest>")
def shell_experiments(**kwargs):
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/new")
def shell_new():
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/timeline")
def shell_timeline():
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/analyze")
def shell_analyze():
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/analysis/<path:rest>")
def shell_analysis(**kwargs):
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/compare")
def shell_compare():
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/favorites")
def shell_favorites():
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/settings")
def shell_settings():
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/templates")
def shell_templates():
    return send_from_directory("ai-shell", "index.html")


@dashboard_bp.route("/login")
def shell_login():
    return send_from_directory("ai-shell", "index.html")
