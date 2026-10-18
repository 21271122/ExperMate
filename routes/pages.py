"""Auto-generated from app.py."""
import json
from pathlib import Path

from flask import Blueprint, abort, current_app, redirect, send_from_directory, url_for

from lib.runtime_paths import app_root

pages_bp = Blueprint("pages", __name__)

# React 入口与统一构建资源；旧图片、音频地址仅作重定向。

# ---- AI Shell 静态资源 ----

@pages_bp.route("/ai-shell/")
def ai_shell_index():
    return redirect(url_for("dashboard.index"), code=308)

@pages_bp.route("/ai-shell/static/audio/<path:filename>")
def legacy_audio(filename: str):
    return redirect(url_for("pages.react_audio", filename=filename), code=308)


@pages_bp.route("/static/img/<path:filename>")
def legacy_image(filename: str):
    return redirect(url_for("pages.react_image", filename=filename), code=308)


def _react_dist():
    return Path(current_app.config.get("REACT_DIST_DIR", app_root() / "frontend" / "dist"))


def print_assets(kind):
    """打印页和主应用使用同一次 Vite 构建，缺失时明确提示重新构建。"""
    try:
        manifest = json.loads((_react_dist() / ".vite" / "manifest.json").read_text(encoding="utf-8"))
        entry = manifest[f"src/features/print/{kind}.{'tsx' if kind == 'record' else 'ts'}"]
        css = []
        visited = set()
        def collect(value):
            for dependency in value.get('imports', []):
                if dependency not in visited:
                    visited.add(dependency)
                    collect(manifest[dependency])
            for path in value.get('css', []):
                if path not in css: css.append(path)
        collect(entry)
        return {"js": url_for("pages.react_asset", filename=entry["file"].removeprefix("assets/")),
                "css": [url_for("pages.react_asset", filename=path.removeprefix("assets/"))
                        for path in css]}
    except (OSError, ValueError, KeyError):
        abort(503, description="打印前端尚未构建，请在 frontend 目录运行 npm ci 和 npm run build。")


@pages_bp.route("/app/")
@pages_bp.route("/app/new")
@pages_bp.route("/app/record-drafts")
@pages_bp.route("/record-drafts")
@pages_bp.route("/app/record-drafts/<draft_id>")
@pages_bp.route("/record-drafts/<draft_id>")
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
def react_index(exp_id=None, anal_id=None, draft_id=None):
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


@pages_bp.route("/app/img/<path:filename>")
def react_image(filename):
    return send_from_directory(_react_dist() / "img", filename)


@pages_bp.route("/app/audio/<path:filename>")
def react_audio(filename):
    return send_from_directory(_react_dist() / "audio", filename)
