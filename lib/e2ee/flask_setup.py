"""把 lib/e2ee 接入现有 Flask app。

- 独立的账号库（`data/_e2ee_accounts.db`），不依赖现有 STORAGE_BACKEND / relay。
- 提供 `/api/e2ee/*` 认证蓝本：register / login / me。
- 登录成功复用现有 JWT（lib.auth.create_token）签发会话，base.html 顶栏弹悬浮窗使用。
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from flask import Blueprint, jsonify, make_response, request

from lib.e2ee.grants import SensitiveGrantStore
from lib.e2ee.journal import SecurityJournal
from lib.e2ee.keystore import KeyringStore
from lib.e2ee.kms import MemoryRecoveryKMS
from lib.e2ee.recovery import RecordingMailSender, RecoveryService
from lib.e2ee.service import AccountSecurityService
from lib.e2ee.policy import canonicalize_email, validate_password
from lib.e2ee import credstore
from lib.runtime_paths import resolve_data_dir

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_RUNTIME_DATA_DIR = resolve_data_dir(_PROJECT_ROOT)
_ACCOUNT_DB = Path(os.environ.get("EXDIARY_ACCOUNT_DB", str(_RUNTIME_DATA_DIR / "_e2ee_accounts.db")))
_KMS_KEY_FILE = Path(os.environ.get("EXDIARY_KMS_KEY_FILE", str(_RUNTIME_DATA_DIR / "_e2ee_kms.key")))

# 进程内存 DEK 缓存（key=账号）。登录/注册时经 open_dek 解出后缓存；
# 重启即空需重新登录派生。绝不落明文盘（对应设计 §16 的边界取舍）。
_DEK_CACHE: dict[str, bytes] = {}


def get_cached_dek(account: str) -> bytes | None:
    return _DEK_CACHE.get(account)


def set_cached_dek(account: str, dek: bytes) -> None:
    _DEK_CACHE[account] = dek


def drop_cached_dek(account: str) -> None:
    _DEK_CACHE.pop(account, None)


def _load_kms_key() -> bytes:
    """recovery key 必须跨重启持久（真实 KMS 是持久化的）；这里持久化到一个私有文件。

    生产应替换为真实 KMS（key material 不出 KMS），本文件仅演示/自托管等效。
    """
    if _KMS_KEY_FILE.exists():
        return _KMS_KEY_FILE.read_bytes()
    _KMS_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    key = os.urandom(32)
    _KMS_KEY_FILE.write_bytes(key)
    return key


def _open_account_db() -> sqlite3.Connection:
    _ACCOUNT_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_ACCOUNT_DB), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


class E2eeCtx:
    """进程级 e2ee 装配（账号库 + 各安全模块 + 独立故障域 journal）。"""

    def __init__(self) -> None:
        self.conn = _open_account_db()
        self.ks = KeyringStore(self.conn)
        self.grants = SensitiveGrantStore(self.conn)
        self.kms = MemoryRecoveryKMS(key=_load_kms_key())
        self.svc = AccountSecurityService(self.conn, self.ks, self.grants, self.kms)
        # 独立故障域 journal（生产应独立存储/更严 RPO；此处内存）
        self.jconn = sqlite3.connect(":memory:", check_same_thread=False)
        self.journal = SecurityJournal(self.jconn)
        self.mail = RecordingMailSender()
        self.rec = RecoveryService(self.conn, self.grants, self.mail)

    def register(self, account: str, email: str, password: str) -> None:
        self.svc.register(account, password)
        self.rec.set_recovery_email(account, email, verified=True)
        head = self.journal.read_live_head(self.conn, account, email_version=1)
        self.journal.record_head(account, head)


def _make_auth_blueprint(ctx: E2eeCtx) -> Blueprint:
    from lib.auth import create_token

    bp = Blueprint("e2ee_auth", __name__, url_prefix="/api/e2ee")

    def current_session_account() -> tuple[str | None, str]:
        """验证浏览器 JWT 及账号 epoch，不能把失效会话伪装成离线模式。"""
        from lib.auth import decode_token

        auth_header = request.headers.get("Authorization", "")
        token = (auth_header[7:] if auth_header.startswith("Bearer ")
                 else request.cookies.get("exdiary_token", ""))
        if not token:
            return None, "未登录"
        try:
            payload = decode_token(token)
            account = str(payload.get("user_id") or "")
            if not account:
                return None, "登录已失效，请重新登录"
            try:
                snapshot = ctx.svc.snapshot(account)
            except KeyError:
                # 与 app.py 的旧账号兼容策略保持一致：历史账号没有 e2ee 条目时，
                # 仍可使用已签发的有效 JWT。
                return account, ""
            if int(payload.get("epoch")) != int(snapshot.account_epoch):
                return None, "登录已失效，请重新登录"
        except Exception:
            return None, "登录已失效，请重新登录"
        return account, ""

    @bp.post("/register")
    def register():
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        email = (data.get("email") or "").strip()
        password = data.get("password") or ""
        if len(account) < 2 or "@" not in email:
            return jsonify({"ok": False, "error": "账号至少 2 字符、邮箱需含 @"}), 400
        _ok, _reason = validate_password(password)
        if not _ok:
            return jsonify({"ok": False, "error": _reason}), 400
        if ctx.svc.login(account, password):
            return jsonify({"ok": False, "error": "该账号已存在"}), 409
        try:
            ctx.register(account, email, password)
        except Exception:
            return jsonify({"ok": False, "error": "注册失败"}), 500
        try:  # 注册即解出该账号 DEK（进程内存缓存 + 持久化到系统凭据库）
            _dek = ctx.svc.open_dek(account, password)
            set_cached_dek(account, _dek)
            credstore.set_dek(account, _dek)  # §16：重启后凭合法 JWT 免重登
        except Exception:
            pass
        _result = {"ok": True, "account": account,
                   "notice": "注册成功 — 已设置恢复邮箱（忘记密码用邮箱找回）"}
        try:
            from lib.offline import has_offline_data
            if has_offline_data():
                _result["has_offline_data"] = True
        except Exception:
            pass
        return jsonify(_result)

    @bp.post("/login")
    def login():
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        password = data.get("password") or ""
        if ctx.svc.login(account, password):
            try:  # 登录成功 → 解该账号 DEK（进程内存缓存 + 持久化到系统凭据库）
                _dek = ctx.svc.open_dek(account, password)
                set_cached_dek(account, _dek)
                credstore.set_dek(account, _dek)  # §16：重启后凭合法 JWT 免重登
            except Exception:
                pass
            _epoch = ctx.svc.snapshot(account).account_epoch
            token = create_token(account, _epoch)  # 带当前 epoch；改密后旧 epoch 的 token 失效
            return jsonify({"ok": True, "account": account, "token": token})
        return jsonify({"ok": False, "error": "账号或密码错误"}), 401

    @bp.get("/me")
    def me():
        account, error = current_session_account()
        if not account:
            return jsonify({"ok": False, "error": error}), 401
        return jsonify({"ok": True, "account": account})

    @bp.post("/logout")
    def logout():
        """JWT 为无状态凭证；退出仅清除当前浏览器的会话 Cookie。"""
        response = make_response(jsonify({"ok": True}))
        response.delete_cookie("exdiary_token", path="/")
        return response

    @bp.post("/change-password")
    def change_password():
        """改密：重输当前密码=reauth → 签发 grant → 原子改密。"""
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        old_password = data.get("old_password") or ""
        new_password = data.get("new_password") or ""
        _ok, _reason = validate_password(new_password)
        if not _ok:
            return jsonify({"ok": False, "error": _reason}), 400
        if not ctx.svc.login(account, old_password):
            return jsonify({"ok": False, "error": "当前密码错误"}), 401
        gid = ctx.grants.issue_grant(account, "change_password")
        try:
            ctx.svc.change_password(account, gid, old_password, new_password)
            return jsonify({"ok": True, "notice": "密码已修改，请用新密码重新登录"})
        except Exception:
            return jsonify({"ok": False, "error": "改密失败"}), 500

    @bp.post("/forgot")
    def forgot():
        """忘密：发高熵 reset token 到恢复邮箱（演示模式回显 token；真实环境只发信）。"""
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        email = (data.get("email") or "").strip()
        token = ctx.rec.request_password_reset(account, email)
        if token is None:
            return jsonify({"ok": False, "error": "账号/邮箱不匹配"}), 404
        return jsonify({"ok": True, "token": token,
                        "notice": "（演示）已向该邮箱发送一次性验证码，见下方"})

    @bp.post("/reset")
    def reset():
        """重置：token 一次性原子 exchange 签 RecoverySession → 无需旧密码重设新密码。"""
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        token = data.get("token") or ""
        new_password = data.get("new_password") or ""
        _ok, _reason = validate_password(new_password)
        if not _ok:
            return jsonify({"ok": False, "error": _reason}), 400
        try:
            ctx.conn.execute("BEGIN IMMEDIATE")
            try:
                sid = ctx.rec.exchange_reset_token(ctx.conn, account, token)
                ctx.conn.commit()
            except Exception:
                ctx.conn.rollback()
                return jsonify({"ok": False, "error": "验证码无效/已用/过期"}), 400
            ctx.svc.recover_password(account, sid, new_password)
            return jsonify({"ok": True, "notice": "密码已重置，请用新密码登录"})
        except Exception:
            return jsonify({"ok": False, "error": "重置失败"}), 500

    @bp.post("/change-email-request")
    def change_email_request():
        """改恢复邮箱 step1：把新地址作为 pending candidate，发验证 token 到新邮箱。"""
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        password = data.get("password") or ""
        new_email = (data.get("new_email") or "").strip()
        if "@" not in new_email:
            return jsonify({"ok": False, "error": "新邮箱需含@"}), 400
        # §11 step-up：改恢复邮箱必须先 current-password reauth
        if not ctx.svc.login(account, password):
            return jsonify({"ok": False, "error": "当前密码错误"}), 401
        try:
            token = ctx.rec.begin_email_change(account, new_email)
            return jsonify({"ok": True, "token": token,
                            "notice": "已向新邮箱发送验证码（演示回显，见下方）；确认前旧邮箱仍有效"})
        except Exception:
            return jsonify({"ok": False, "error": "发起失败"}), 400

    @bp.post("/change-email-confirm")
    def change_email_confirm():
        """改恢复邮箱 step2：登录 → 签 fresh SensitiveActionGrant → 原子替换 verified 邮箱。

        §11：最终替换 commit 必须持有 fresh grant（single-use），并在同一事务内消费。
        """
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        token = data.get("token") or ""
        password = data.get("password") or ""
        if not ctx.svc.login(account, password):
            return jsonify({"ok": False, "error": "当前密码错误"}), 401
        grant_id = ctx.grants.issue_grant(account, "change_recovery_email")
        try:
            r = ctx.rec.confirm_email_change(account, token, grant_id=grant_id)
            return jsonify({"ok": True, "notice": f"恢复邮箱已更新为 {r['address']}"})
        except Exception:
            return jsonify({"ok": False, "error": "验证码无效/已用/过期，或授权失败"}), 400

    return bp


def init_e2ee(app) -> bool:
    """挂到现有 Flask app；返回是否成功启用。"""
    try:
        ctx = E2eeCtx()
        app.extensions["e2ee"] = ctx
        app.register_blueprint(_make_auth_blueprint(ctx))
        app.config["E2EE_ENABLED"] = True
        return True
    except Exception as e:  # 依赖缺失等 → 不阻断 app 启动
        app.config["E2EE_ENABLED"] = False
        print(f"[warn] e2ee 未启用（{e}）—— 生产需安装 cryptography + argon2-cffi")
        return False
