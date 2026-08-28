"""用户认证 API — 已迁移到 e2ee 账号体系（/api/e2ee/*）。

老 relay 代理认证（/api/auth/register|login|password）已废弃，返回 410 提示。
仅保留 /api/auth/import-offline（离线数据迁移助手，配合 e2ee 账号使用）。
"""

from flask import Blueprint, g, jsonify

from lib.auth import require_auth
from lib.offline import migrate_offline_to_user

api_auth_bp = Blueprint("api_auth", __name__)


@api_auth_bp.route("/register", methods=["POST"])
def api_register():
    """已废弃：请改用 /api/e2ee/register。"""
    return jsonify({"ok": False, "error": "已迁移到 e2ee 账号体系，请使用 /api/e2ee/register"}), 410


@api_auth_bp.route("/login", methods=["POST"])
def api_login():
    """已废弃：请改用 /api/e2ee/login。"""
    return jsonify({"ok": False, "error": "已迁移到 e2ee 账号体系，请使用 /api/e2ee/login"}), 410


@api_auth_bp.route("/password", methods=["PUT"])
def api_password():
    """已废弃：请改用 /api/e2ee/change-password。"""
    return jsonify({"ok": False, "error": "已迁移到 e2ee 账号体系，请使用 /api/e2ee/change-password"}), 410


@api_auth_bp.route("/import-offline", methods=["POST"])
@require_auth
def api_import_offline():
    if not hasattr(g.exp_repo, "db"):
        return jsonify({"ok": False, "error": "离线导入仅在 SQLite 模式下可用"}), 400
    imported = migrate_offline_to_user(g.exp_repo.db, g.user_id)
    return jsonify({"ok": True, "imported": imported})
