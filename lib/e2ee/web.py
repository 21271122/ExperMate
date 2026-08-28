"""Exdiary v2 — e2ee 的 Flask 装配层与演示路由（登录/注册悬浮窗）。

独立自包含：用独立 SQLite（默认临时文件）+ lib/e2ee 各模块，**不侵入现有 app.py / 路由**。
用于演示与接入验证；生产接入时把 blueprints 挂进主 app，替换 MemoryKMS/RecordingMail。
"""

from __future__ import annotations

import os
import sqlite3
import sys
import tempfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request

from lib.e2ee.grants import SensitiveGrantStore
from lib.e2ee.journal import SecurityHead, SecurityJournal
from lib.e2ee.keystore import KeyringStore
from lib.e2ee.kms import MemoryRecoveryKMS
from lib.e2ee.recovery import RecordingMailSender, RecoveryService
from lib.e2ee.service import AccountSecurityService

_PROJECT_ROOT = Path(__file__).resolve().parents[2]  # 项目根（templates/、static/ 所在）


class _Ctx:
    def __init__(self, db_path: str | None) -> None:
        if db_path is None:
            # 临时文件 DB，进程结束自动清理
            fd, path = tempfile.mkstemp(suffix="_exdiary_e2ee.db")
            os.close(fd)
            os.remove(path)
            db_path = path
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.ks = KeyringStore(self.conn)
        self.grants = SensitiveGrantStore(self.conn)
        self.kms = MemoryRecoveryKMS()
        self.svc = AccountSecurityService(self.conn, self.ks, self.grants, self.kms)
        # 独立故障域的 journal
        self.jconn = sqlite3.connect(":memory:", check_same_thread=False)
        self.journal = SecurityJournal(self.jconn)
        self.mail = RecordingMailSender()
        self.rec = RecoveryService(self.conn, self.grants, self.mail)


def make_app(db_path: str | None = None) -> Flask:
    app = Flask(__name__,
                template_folder=str(_PROJECT_ROOT / "templates"),
                static_folder=str(_PROJECT_ROOT / "static"))
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    ctx = _Ctx(db_path)
    app.extensions["e2ee"] = ctx

    @app.get("/e2ee")
    def page():
        return render_template("e2ee.html")

    @app.post("/api/e2ee/register")
    def register():
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        email = (data.get("email") or "").strip()
        password = data.get("password") or ""
        if len(account) < 2 or len(password) < 6 or "@" not in email:
            return jsonify({"ok": False, "error": "账号至少2字符、密码至少6位、邮箱需含@"}), 400
        if ctx.svc.login(account, password):
            return jsonify({"ok": False, "error": "该账号已存在"}), 409
        try:
            ctx.svc.register(account, password)
            ctx.rec.set_recovery_email(account, email, verified=True)
            head = ctx.journal.read_live_head(ctx.conn, account, email_version=1)
            ctx.journal.record_head(account, head)
        except Exception:
            return jsonify({"ok": False, "error": "注册失败"}), 500
        return jsonify({"ok": True, "account": account,
                        "notice": "注册成功 — 已设置恢复邮箱（忘记密码可用邮箱找回）"})

    @app.post("/api/e2ee/login")
    def login():
        data = request.get_json(silent=True) or {}
        account = (data.get("account") or "").strip()
        password = data.get("password") or ""
        if ctx.svc.login(account, password):
            return jsonify({"ok": True, "account": account})
        return jsonify({"ok": False, "error": "账号或密码错误"}), 401

    @app.get("/api/e2ee/status")
    def status():
        return jsonify({"ok": True})

    return app


if __name__ == "__main__":
    app = make_app()
    port = int(os.environ.get("PORT", "5111"))
    print(f"e2ee demo: http://127.0.0.1:{port}/e2ee")
    app.run(host="127.0.0.1", port=port, debug=False)
