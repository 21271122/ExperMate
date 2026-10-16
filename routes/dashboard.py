"""Dashboard 蓝图 — Shell 入口 + 页面路由 catch-all。"""

from flask import Blueprint

from routes.pages import react_index

dashboard_bp = Blueprint("dashboard", __name__)


@dashboard_bp.route("/")
def index():
    return react_index()


# ---------------------------------------------------------------------------
# 页面深链接统一返回 React 外壳；打印等明确的服务端路由优先匹配。
# ---------------------------------------------------------------------------

@dashboard_bp.route("/experiments")
@dashboard_bp.route("/experiments/<path:rest>")
def shell_experiments(**kwargs):
    return react_index()


@dashboard_bp.route("/new")
def shell_new():
    return react_index()


@dashboard_bp.route("/timeline")
def shell_timeline():
    return react_index()


@dashboard_bp.route("/analyze")
def shell_analyze():
    return react_index()


@dashboard_bp.route("/analysis/<path:rest>")
def shell_analysis(**kwargs):
    return react_index()


@dashboard_bp.route("/compare")
def shell_compare():
    return react_index()


@dashboard_bp.route("/favorites")
def shell_favorites():
    return react_index()


@dashboard_bp.route("/settings")
def shell_settings():
    return react_index()


@dashboard_bp.route("/templates")
def shell_templates():
    return react_index()


@dashboard_bp.route("/login")
def shell_login():
    return react_index()
