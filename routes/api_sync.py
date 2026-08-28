"""同步状态 API。前端拉取当前用户的同步状态。"""

from flask import Blueprint, jsonify, g, current_app

api_sync_bp = Blueprint("api_sync", __name__)


def _app_ctx():
    """应用容器（AppContext），经 Flask extensions 访问，避免反向 import app。"""
    return current_app.extensions.get("exdiary_ctx")


@api_sync_bp.route("/sync-status")
def sync_status():
    ctx = _app_ctx()
    svc = ctx.get_sync_service(g.user_id) if (ctx and g.user_id) else None
    if svc is None:
        return jsonify({"status": "offline", "dirty": 0, "last_sync": ""})
    dirty = 0
    if hasattr(svc, "_exp_repo") and hasattr(svc._exp_repo, "get_sync_dirty"):
        dirty = len(svc._exp_repo.get_sync_dirty(svc._user_id))
    return jsonify({"status": "dirty" if dirty else "synced", "dirty": dirty, "last_sync": svc._last_sync})
