"""ExperMate 服务端入口；导入模块不读取配置或打开数据库。"""
import argparse
import atexit
import os
import secrets
import sqlite3
from contextlib import nullcontext
from pathlib import Path

import click
from flask import Flask, g, jsonify, request

from lib.config import ConfigManager, Settings
from lib.container import AppContext
from lib.llm import LLMClient
from lib.runtime_paths import app_root, resolve_data_dir


def _uid_provider():
    return g.user_id or ""


def _session_epoch_ok(app, user_id, tok_epoch):
    security = app.extensions.get("e2ee")
    if not user_id or security is None or tok_epoch is None:
        return False
    try:
        with getattr(security, "lock", nullcontext()):
            row = security.conn.execute("SELECT account_epoch FROM account WHERE account_id=?", (user_id,)).fetchone()
        return row is not None and int(row["account_epoch"]) == int(tok_epoch)
    except (TypeError, ValueError, sqlite3.Error):
        return False


def _configured_llm(config, role: str):
    """按角色创建模型客户端；兼容未迁移的 DeepSeek 配置。"""
    is_analysis = role == "analyze"
    agent_provider = config.get("LLM_AGENT_PROVIDER", "deepseek") or "deepseek"
    agent_key = config.get("LLM_AGENT_API_KEY", "") or config.get("DEEPSEEK_API_KEY", "")
    agent_base = config.get("LLM_AGENT_BASE_URL", "")
    agent_model = config.get("LLM_AGENT_MODEL", "") or config.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
    if is_analysis:
        provider = config.get("LLM_ANALYZE_PROVIDER", "") or agent_provider
        api_key = config.get("LLM_ANALYZE_API_KEY", "") or agent_key
        base_url = config.get("LLM_ANALYZE_BASE_URL", "") or agent_base
        model = (config.get("LLM_ANALYZE_MODEL", "")
                 or config.get("DEEPSEEK_ANALYZE_MODEL", "")
                 or agent_model)
    else:
        provider, api_key, base_url, model = agent_provider, agent_key, agent_base, agent_model
    if not api_key or not model:
        return None
    return LLMClient(
        api_key=api_key, model=model, base_url=base_url, provider=provider,
        reasoning_effort=config.get("LLM_REASONING_EFFORT", "max"),
    )


def create_app(overrides=None):
    """每个应用实例拥有独立的配置、仓储、账号和运行上下文。"""
    overrides = dict(overrides or {})
    root = app_root()
    data_dir = Path(overrides.get("DATA_DIR") or os.environ.get("DATA_DIR") or resolve_data_dir(root)).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    settings_path = Path(overrides.pop("SETTINGS_PATH", os.environ.get("EXDIARY_SETTINGS", str(data_dir / "config.yaml"))))
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    manager = ConfigManager(settings_path)
    config = manager.load()
    # 环境变量仅由服务端进程读取，不从浏览器接收部署配置。
    env = {name: os.environ[name] for name in Settings.model_fields if name in os.environ}
    if "ADMIN_ACCOUNTS" in env:
        env["ADMIN_ACCOUNTS"] = [value.strip() for value in env["ADMIN_ACCOUNTS"].split(",") if value.strip()]
    runtime_values = {**env, **{key: value for key, value in overrides.items() if key in Settings.model_fields}}
    if "DATA_DIR" in runtime_values:
        runtime_values["DATA_DIR"] = str(runtime_values["DATA_DIR"])
    validated = Settings(**{**config, **runtime_values})
    manager.overrides = {key: getattr(validated, key) for key in runtime_values}
    config.update(manager.overrides)
    if not config.get("JWT_SECRET"):
        if "JWT_SECRET" in manager.overrides:
            raise RuntimeError("JWT_SECRET 环境变量或运行参数不能为空")
        manager.save({"JWT_SECRET": secrets.token_hex(32)})
    app = Flask(__name__, static_folder=None, template_folder=None)
    app.config.update(MAX_CONTENT_LENGTH=16 * 1024 * 1024, SERVER_MODE=True,
                      JWT_SECRET=config["JWT_SECRET"], EXDIARY_CONFIG=config,
                      DATA_DIR=data_dir, ACCOUNT_DB_PATH=data_dir / "_e2ee_accounts.db",
                      KMS_KEY_PATH=data_dir / "_e2ee_kms.key")
    app.config.update(overrides)
    if config.get("TRUSTED_PROXY_HOPS", 0):
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=config["TRUSTED_PROXY_HOPS"],
                               x_proto=config["TRUSTED_PROXY_HOPS"], x_host=0)
    from lib.logger import ExdiaryLogger
    app.extensions["exdiary_logger"] = ExdiaryLogger(data_dir)
    ctx = AppContext()
    app.extensions["exdiary_ctx"] = ctx
    app.extensions["config_manager"] = manager
    db_path = Path(overrides.get("DATABASE_PATH") or os.environ.get("EXDIARY_DB", str(data_dir / "data.db")))
    db_path.parent.mkdir(parents=True, exist_ok=True)
    app.config["DATABASE_PATH"] = db_path
    from lib.crypto import derive_key, is_cipher_available, open_encrypted_db
    enc_key = os.environ.get("EXDIARY_ENC_KEY", config.get("ENCRYPTION_KEY", ""))
    if enc_key:
        if not is_cipher_available():
            raise RuntimeError("已配置数据库加密密钥，但 SQLCipher 不可用；拒绝回退为明文。")
        conn = open_encrypted_db(str(db_path), derive_key(enc_key))
    else:
        conn = sqlite3.connect(db_path, check_same_thread=False, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    from lib.attachment_store import SqliteAttachmentStore
    from lib.repositories.sqlite_analysis import SqliteAnalysisRepository
    from lib.repositories.sqlite_common import ThreadSafeConnection
    from lib.repositories.sqlite_experiment import SqliteExperimentRepository
    from lib.repositories.sqlite_favorites import SqliteFavoritesRepository
    from lib.repositories.sqlite_thread import SqliteThreadRepository
    from lib.repositories.sqlite_update_log import SqliteUpdateLogRepository
    from lib.services.analysis import AnalysisService
    from lib.services.experiment import ExperimentService
    from lib.services.extraction import ExtractionService
    from lib.services.template import TemplateService
    from lib.services.record_document import RecordDocumentService
    db = ThreadSafeConnection(conn)
    ctx.connections.append(db)
    db.execute("CREATE TABLE IF NOT EXISTS legacy_uploads (user_id TEXT NOT NULL, path TEXT NOT NULL, sha256 TEXT NOT NULL, PRIMARY KEY(user_id,path))")
    repositories = {
        "exp_repo": SqliteExperimentRepository(db, uid_provider=_uid_provider, device_code=config["DEVICE_CODE"]),
        "analysis_repo": SqliteAnalysisRepository(db, uid_provider=_uid_provider, device_code=config["DEVICE_CODE"]),
        "favorites_repo": SqliteFavoritesRepository(db, uid_provider=_uid_provider),
        "thread_repo": SqliteThreadRepository(db, uid_provider=_uid_provider),
        "update_log_repo": SqliteUpdateLogRepository(db, uid_provider=_uid_provider),
        "attachment_store": SqliteAttachmentStore(db, uid_provider=_uid_provider),
    }
    def get_agent_llm():
        return _configured_llm(config, "agent")

    def get_analyze_llm():
        return _configured_llm(config, "analyze")
    services = {
        "record_svc": RecordDocumentService(db, repositories["exp_repo"], repositories["update_log_repo"],
                                            _uid_provider, repositories["attachment_store"]),
        "experiment_svc": ExperimentService(repositories["exp_repo"], repositories["update_log_repo"], repositories["favorites_repo"]),
        "extraction_svc": ExtractionService(None),
        "analysis_svc": AnalysisService(repositories["exp_repo"], repositories["analysis_repo"], get_analyze_llm,
            timeout_seconds=lambda: int(config.get("ANALYSIS_TIMEOUT_SECONDS", 480)),
            update_log_repo=repositories["update_log_repo"], attachment_store=repositories["attachment_store"]),
        "template_svc": TemplateService(str(data_dir / "experiment_templates")),
    }
    from lib.e2ee.flask_setup import init_e2ee
    if not init_e2ee(app):
        ctx.shutdown()
        raise RuntimeError("服务端账号服务初始化失败；拒绝以匿名模式继续运行。")
    security = app.extensions["e2ee"]
    ctx.add_shutdown_hook(security.close)
    atexit.register(ctx.shutdown)

    @app.errorhandler(ValueError)
    def invalid_input(error):
        return jsonify(ok=False, error=str(error)), 400

    @app.before_request
    def inject_services():
        from lib.auth import decode_token
        g.user_id = None
        header = request.headers.get("Authorization", "")
        token = header[7:] if header.startswith("Bearer ") else request.cookies.get("exdiary_token", "")
        if token:
            try:
                payload = decode_token(token)
                if _session_epoch_ok(app, payload.get("user_id"), payload.get("epoch")):
                    g.user_id = payload["user_id"]
            except Exception:
                pass
        g.config, g.config_manager, g.data_dir = config, manager, data_dir
        g.is_admin = bool(g.user_id and g.user_id in config.get("ADMIN_ACCOUNTS", []))
        for name, repository in {**repositories, **services}.items():
            setattr(g, name, repository)
        g.get_extract_llm, g.get_agent_llm, g.get_analyze_llm = get_agent_llm, get_agent_llm, get_analyze_llm
        # 所有业务 API/打印/上传都受同一认证保护；静态外壳可以公开加载登录界面。
        private = request.path.startswith(("/api/", "/experiments/", "/uploads/"))
        public = request.path.startswith("/api/e2ee/") or request.path in ("/api/bootstrap", "/api/health")
        is_page = request.method == "GET" and request.path.startswith("/experiments/") and request.path.count("/") == 2
        if private and not public and not is_page and not g.user_id:
            return jsonify(ok=False, error={"code": "unauthenticated", "message": "请先登录"}), 401
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("Origin")
            if request.headers.get("Sec-Fetch-Site") == "cross-site" or (origin and origin.rstrip("/") != request.host_url.rstrip("/")):
                return jsonify(ok=False, error="不接受跨站写入请求"), 403
        if request.path == "/settings" and request.method == "POST" and not g.user_id:
            return jsonify(ok=False, error="请先登录"), 401

    @app.after_request
    def private_headers(response):
        if request.path.startswith(("/api/", "/uploads/")) or request.path.endswith("/print"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/api/bootstrap")
    def bootstrap():
        return jsonify(server_mode=True, registration_enabled=bool(config.get("ALLOW_REGISTRATION", True)),
                       authenticated=bool(g.user_id), can_configure=bool(g.is_admin))

    @app.get("/api/health")
    def health():
        db.execute("SELECT 1")
        return jsonify(ok=True)

    from routes.api_agent import api_agent_bp
    from routes.api_analysis import api_analysis_bp
    from routes.api_attachment import api_attachment_bp
    from routes.api_child import api_child_bp
    from routes.api_experiment import api_experiment_bp
    from routes.api_favorites import api_favorites_bp
    from routes.api_music import api_music_bp
    from routes.api_search import api_search_bp
    from routes.api_upload import api_upload_bp
    from routes.api_v1 import api_v1_bp
    from routes.dashboard import dashboard_bp
    from routes.api_record import api_record_bp
    from routes.experiment import experiment_bp
    from routes.pages import pages_bp
    from routes.settings import settings_bp
    from routes.templates import templates_bp
    from routes.uploads import uploads_bp
    for blueprint, prefix in [(api_record_bp, "/api/v1"), (dashboard_bp, ""), (pages_bp, ""), (settings_bp, ""), (templates_bp, ""),
            (experiment_bp, "/experiments"), (api_experiment_bp, "/api"), (api_agent_bp, "/api/agent"),
            (api_child_bp, "/api"), (api_analysis_bp, "/api"), (api_search_bp, "/api"),
            (api_favorites_bp, "/api"), (api_attachment_bp, "/api"), (api_music_bp, "/api"), (api_v1_bp, "/api/v1"), (uploads_bp, ""), (api_upload_bp, "/api")]:
        app.register_blueprint(blueprint, url_prefix=prefix)

    @app.cli.command("create-user")
    @click.option("--account", prompt=True)
    @click.option("--email", prompt=True)
    @click.option("--admin", is_flag=True)
    @click.password_option()
    def create_user(account, email, admin, password):
        """运维端创建账号；管理员身份只能经服务端配置授予。"""
        from lib.e2ee.policy import validate_password
        valid, reason = validate_password(password)
        if not valid or len(account) < 2 or "@" not in email:
            raise click.ClickException(reason or "账号或邮箱无效")
        if admin and "ADMIN_ACCOUNTS" in manager.overrides and account not in manager.overrides["ADMIN_ACCOUNTS"]:
            raise click.ClickException("请先将账号加入服务端 ADMIN_ACCOUNTS 环境配置，再创建管理员")
        security.register(account, email, password)
        if admin:
            manager.save({"ADMIN_ACCOUNTS": sorted(set(config.get("ADMIN_ACCOUNTS", [])) | {account})})
        click.echo("账号已创建")

    @app.cli.command("import-workspace")
    @click.option("--source", required=True, type=click.Path(exists=True, dir_okay=False, path_type=Path))
    @click.option("--account", required=True)
    @click.option("--source-user", default="", help="旧库中的作用域；离线库默认为空字符串")
    @click.option("--backup-dir", required=True, type=click.Path(path_type=Path))
    @click.option("--uploads-dir", type=click.Path(exists=True, file_okay=False, path_type=Path))
    def import_old_workspace(source, account, source_user, backup_dir, uploads_dir):
        """停服后运行：备份并导入旧库到指定的空账号，不覆盖已有数据。"""
        from lib.workspace_import import import_workspace
        try:
            security.svc.snapshot(account)
            result = import_workspace(source, conn, account, backup_dir, source_user=source_user, uploads_dir=uploads_dir)
        except (KeyError, ValueError, OSError, sqlite3.Error) as error:
            raise click.ClickException(str(error)) from error
        import json
        click.echo(json.dumps(result, ensure_ascii=False, indent=2))

    return app


def main():
    parser = argparse.ArgumentParser(description="ExperMate 服务端")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--data-dir", type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--headless", action="store_true", help="兼容旧启动参数；现在始终运行网页服务")
    args = parser.parse_args()
    overrides = {key: value for key, value in {"DATA_DIR": args.data_dir, "SETTINGS_PATH": args.config}.items() if value is not None}
    app = create_app(overrides)
    settings = app.config["EXDIARY_CONFIG"]
    app.run(host=args.host or settings.get("HOST", "127.0.0.1"), port=args.port or int(settings.get("PORT", 5000)), threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
