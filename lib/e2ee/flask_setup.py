"""把 lib/e2ee 接入现有 Flask app。

- 独立的账号库（`data/_e2ee_accounts.db`），不依赖现有 STORAGE_BACKEND / relay。
- 提供 `/api/e2ee/*` 认证蓝本：register / login / me。
- 登录成功通过 HttpOnly Cookie 签发服务端会话。
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

from flask import Blueprint, current_app, g, jsonify, make_response, request

from lib.e2ee.grants import SensitiveGrantStore
from lib.e2ee.journal import SecurityJournal
from lib.e2ee.keystore import KeyringStore
from lib.e2ee.kms import MemoryRecoveryKMS
from lib.e2ee.recovery import RecordingMailSender, RecoveryService
from lib.e2ee.service import AccountSecurityService
from lib.e2ee.policy import canonicalize_email, validate_password
from lib.runtime_paths import app_root, resolve_data_dir

# 打包后 __file__ 位于 _internal，必须用统一的 app_root() 推导，避免
# 账号库与 KMS 密钥落进程序目录（升级/覆盖会丢数据）。
_PROJECT_ROOT = app_root()
_RUNTIME_DATA_DIR = resolve_data_dir(_PROJECT_ROOT)
_ACCOUNT_DB = Path(os.environ.get("EXDIARY_ACCOUNT_DB", str(_RUNTIME_DATA_DIR / "_e2ee_accounts.db")))
_KMS_KEY_FILE = Path(os.environ.get("EXDIARY_KMS_KEY_FILE", str(_RUNTIME_DATA_DIR / "_e2ee_kms.key")))

class E2eeCtx:
    """进程级 e2ee 装配（账号库 + 各安全模块 + 独立故障域 journal）。"""

    def __init__(self, account_db=None, kms_key_file=None, mail=None) -> None:
        self.lock = threading.RLock()
        account_db = Path(account_db or _ACCOUNT_DB)
        account_db.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(account_db, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.ks = KeyringStore(self.conn)
        self.grants = SensitiveGrantStore(self.conn)
        key_file = Path(kms_key_file or _KMS_KEY_FILE)
        key_file.parent.mkdir(parents=True, exist_ok=True)
        if not key_file.exists():
            with key_file.open("xb") as output:
                output.write(os.urandom(32))
        self.kms = MemoryRecoveryKMS(key=key_file.read_bytes())
        self.svc = AccountSecurityService(self.conn, self.ks, self.grants, self.kms)
        # 独立故障域 journal（生产应独立存储/更严 RPO；此处内存）
        self.jconn = sqlite3.connect(":memory:", check_same_thread=False)
        self.journal = SecurityJournal(self.jconn)
        self.mail = mail or RecordingMailSender()
        self.rec = RecoveryService(self.conn, self.grants, self.mail)

    def close(self):
        self.conn.close()
        self.jconn.close()

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
                return None, "登录已失效，请重新登录"
            if int(payload.get("epoch")) != int(snapshot.account_epoch):
                return None, "登录已失效，请重新登录"
        except Exception:
            return None, "登录已失效，请重新登录"
        return account, ""

    @bp.before_request
    def acquire_account_lock():
        if getattr(ctx, "lock", None) is not None:
            ctx.lock.acquire()
            g.account_lock_held = True

    @bp.teardown_request
    def release_account_lock(error):
        if g.pop("account_lock_held", False):
            ctx.lock.release()

    @bp.post("/register")
    def register():
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        email = (data.get("email") or "").strip()
        password = data.get("password") or ""
        config = current_app.config.get("EXDIARY_CONFIG", {})
        if not config.get("ALLOW_REGISTRATION", True) or account in config.get("ADMIN_ACCOUNTS", []):
            return jsonify(ok=False, error="该账号请由服务端管理员创建"), 403
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
        return jsonify(ok=True, account=account, notice="注册成功，请登录")

    @bp.post("/login")
    def login():
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        password = data.get("password") or ""
        if ctx.svc.login(account, password):
            _epoch = ctx.svc.snapshot(account).account_epoch
            token = create_token(account, _epoch)  # 带当前 epoch；改密后旧 epoch 的 token 失效
            payload = {"ok": True, "account": account}
            if not current_app.config.get("SERVER_MODE"):
                payload["token"] = token
            response = jsonify(payload)
            # 服务端模式只签发 HttpOnly Cookie，不将凭证复制到浏览器存储。
            response.set_cookie("exdiary_token", token, httponly=True, secure=request.is_secure,
                                samesite="Lax", max_age=24 * 60 * 60, path="/")
            return response
        return jsonify({"ok": False, "error": "账号或密码错误"}), 401

    @bp.get("/me")
    def me():
        account, error = current_session_account()
        if not account:
            response = jsonify({"ok": False, "error": error})
            if request.cookies.get("exdiary_token"):
                response.delete_cookie("exdiary_token", path="/")
            return response, 401
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
        """忘密：高熵 reset token 仅发送到恢复邮箱。"""
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        email = (data.get("email") or "").strip()
        if not current_app.config.get("MAIL_CONFIGURED"):
            return jsonify(ok=False, error="服务端尚未配置邮件服务，请联系管理员"), 503
        try:
            ctx.rec.request_password_reset(account, email)
        except Exception:
            return jsonify(ok=False, error="邮件发送失败，请稍后重试"), 503
        return jsonify(ok=True, notice="如账号与邮箱匹配，验证码已发送至邮箱")

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
        if not current_app.config.get("MAIL_CONFIGURED"):
            return jsonify(ok=False, error="服务端尚未配置邮件服务，请联系管理员"), 503
        try:
            ctx.rec.begin_email_change(account, new_email)
            return jsonify(ok=True, notice="验证码已发送至新邮箱；确认前旧邮箱仍有效")
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
        from lib.server_mail import SMTPMailSender
        config = app.config.get("EXDIARY_CONFIG", {})
        mail = app.config.get("MAIL_SENDER")
        app.config["MAIL_CONFIGURED"] = bool(mail or config.get("SMTP_HOST"))
        if mail is None and config.get("SMTP_HOST"):
            mail = SMTPMailSender(config)
        ctx = E2eeCtx(app.config.get("ACCOUNT_DB_PATH"), app.config.get("KMS_KEY_PATH"), mail)
        app.extensions["e2ee"] = ctx
        app.register_blueprint(_make_auth_blueprint(ctx))
        app.config["E2EE_ENABLED"] = True
        return True
    except Exception as e:  # 依赖缺失等 → 不阻断 app 启动
        app.config["E2EE_ENABLED"] = False
        print(f"[warn] e2ee 未启用（{e}）—— 生产需安装 cryptography + argon2-cffi")
        return False
