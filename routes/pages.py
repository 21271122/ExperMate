"""Auto-generated from app.py."""
from pathlib import Path

from flask import Blueprint, abort, current_app, redirect, send_from_directory, url_for

from lib.runtime_paths import app_root

pages_bp = Blueprint("pages", __name__)

# React 入口与静态资源；CSS、字体和音频保留原有 URL。

# ---- AI Shell 静态资源 ----

@pages_bp.route("/ai-shell/")
def ai_shell_index():
    return redirect(url_for("dashboard.index"), code=308)

@pages_bp.route("/ai-shell/static/<path:filename>")
def ai_shell_static(filename: str):
    return send_from_directory("ai-shell/static", filename)


def _react_dist():
    return Path(current_app.config.get("REACT_DIST_DIR", app_root() / "frontend" / "dist"))


@pages_bp.route("/app/")
@pages_bp.route("/app/new")
@pages_bp.route("/app/experiments")
@pages_bp.route("/app/experiments/<exp_id>")
@pages_bp.route("/app/analysis/<anal_id>")
@pages_bp.route("/app/timeline")
@pages_bp.route("/app/analyze")
@pages_bp.route("/app/compare")
@pages_bp.route("/app/favorites")
@pages_bp.route("/app/settings")
@pages_bp.route("/app/templates")
@pages_bp.route("/app/login")
def react_index(exp_id=None, anal_id=None):
    if not (_react_dist() / "index.html").is_file():
        abort(503, description="React 前端尚未构建，请在 frontend 目录运行 npm ci 和 npm run build。")
    response = send_from_directory(_react_dist(), "index.html")
    response.headers["Cache-Control"] = "no-cache"
    return response


@pages_bp.route("/app/experiments/<exp_id>/print")
def react_experiment_print(exp_id):
    return redirect(url_for("experiment.print_experiment", exp_id=exp_id))


@pages_bp.route("/app/analysis/<anal_id>/print")
def react_analysis_print(anal_id):
    return redirect(url_for("experiment.print_analysis", anal_id=anal_id))


@pages_bp.route("/app/assets/<path:filename>")
def react_asset(filename):
    return send_from_directory(_react_dist() / "assets", filename)
