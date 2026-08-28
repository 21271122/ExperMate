import os
import sys
import socket
import threading
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from flask import Flask, g, request

from lib.logger import init_logger, get_logger
from lib.llm import LLMClient
from lib.config import ConfigManager
from lib.container import AppContext
from lib.runtime_paths import prepare_runtime_data
from lib.services.experiment import ExperimentService
from lib.services.extraction import ExtractionService
from lib.services.analysis import AnalysisService
from lib.services.template import TemplateService

from routes.dashboard import dashboard_bp
from routes.experiment import experiment_bp
from routes.api_experiment import api_experiment_bp
from routes.api_agent import api_agent_bp
from routes.api_child import api_child_bp
from routes.api_analysis import api_analysis_bp
from routes.api_search import api_search_bp
from routes.api_favorites import api_favorites_bp
from routes.api_upload import api_upload_bp
from routes.api_attachment import api_attachment_bp
from routes.api_music import api_music_bp
from routes.settings import settings_bp
from routes.templates import templates_bp
from routes.uploads import uploads_bp
from routes.pages import pages_bp
from routes.api_auth import api_auth_bp
from routes.api_sync import api_sync_bp
from routes.fragments import fragments_bp

# PyInstaller --onefile 兼容：exe 所在目录 vs 源码目录
import sys as _sys
if getattr(_sys, 'frozen', False):
    _DATA_ROOT = Path(_sys.executable).parent
else:
    _DATA_ROOT = Path(__file__).parent
BASE_DIR = _DATA_ROOT
SETTINGS_PATH = Path(os.environ.get("EXDIARY_SETTINGS", str(BASE_DIR / "config.yaml")))

# 进程级配置与容器（全局状态唯一宿主，见 lib/config.py / lib/container.py）
config_manager = ConfigManager(SETTINGS_PATH)
config = config_manager.load()
if config.get("DATA_DIR"):
    os.environ.setdefault("EXPERMATE_DATA_DIR", str(config["DATA_DIR"]))
DATA_DIR = prepare_runtime_data(BASE_DIR)
# 每实例数据 DB 路径：多实例/多设备本地联测时用 EXDIARY_DB 指向各自独立的 data.db
DATABASE_PATH = os.environ.get("EXDIARY_DB", str(DATA_DIR / "data.db"))
ctx = AppContext()

# 新同步网关按 user 缓存（EXDIARY_DEK 存在才启用；否则此表为空、不引入任何行为）
_GATEWAYS: dict[str, object] = {}
_GATEWAY_LOCK = threading.RLock()
_GATEWAY_BOOTSTRAPS: set[str] = set()
_PENDING_SYNC: dict[str, dict[tuple[str, str], bool]] = {}

init_logger(DATA_DIR)


def _uid_provider() -> str:
    """请求上下文注入的用户 ID 解析（仓储构造注入用，仓储层不依赖 Flask）。"""
    return getattr(g, "user_id", None) or ""


def _session_epoch_ok(app, user_id, tok_epoch) -> bool:
    """校验 JWT 携带的 epoch 是否仍等于账号当前 account_epoch（改密/恢复后旧 token 失效）。"""
    if not user_id:
        return False
    e2ee = (app.extensions or {}).get("e2ee")
    if e2ee is None:
        return True  # e2ee 未启用（YAML 后端/离线）→ 不做 epoch 校验
    if tok_epoch is None:
        return False  # 有 e2ee 却无 epoch → 旧/非法 token，视为未登录
    try:
        row = e2ee.conn.execute(
            "SELECT account_epoch FROM account WHERE account_id=?", (user_id,)
        ).fetchone()
    except Exception:
        return True
    if row is None:
        return True  # 非 e2ee 账号（旧账号）→ 保持兼容放行
    return int(row["account_epoch"]) == int(tok_epoch)


def _dirty_trigger(entity_type: str):
    """仓储构造注入的同步标记回调：保存后经当前请求加密推送（新网关路径）。"""
    def trigger(entity_id: str, tombstone: bool = False) -> None:
        user_id = getattr(g, "user_id", None)
        if not user_id:
            return
        with _GATEWAY_LOCK:
            gw = _GATEWAYS.get(user_id)
            if gw is None:
                pending = _PENDING_SYNC.setdefault(user_id, {})
                pending[(entity_type, entity_id)] = tombstone
                return
        if gw is not None:
            from lib.e2ee.app_glue import build_readers, forward_dirty
            readers = build_readers(
                getattr(g, "exp_repo", None), getattr(g, "thread_repo", None),
                getattr(g, "analysis_repo", None), getattr(g, "favorites_repo", None),
                getattr(g, "update_log_repo", None), getattr(g, "attachment_store", None),
            )
            synced = forward_dirty(gw, entity_type, entity_id, tombstone, readers)
            if entity_type == "attachment" and not tombstone and synced:
                g.attachment_store.save_synced(entity_id)
            # 线程保存会连带改索引（含 user_profile）→ 一并推送 thread_index
            if entity_type == "thread":
                forward_dirty(gw, "thread_index", "index", False, readers)
    return trigger


def _configured_llm(role: str):
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


def get_extract_llm():
    return _configured_llm("agent")


def get_analyze_llm():
    return _configured_llm("analyze")


def get_agent_llm():
    return _configured_llm("agent")


# ---- 应用工厂 ----
def create_app():
    app = Flask(__name__)
    # 应用容器挂 Flask extensions，路由经 current_app 访问（避免反向 import app）
    app.extensions["exdiary_ctx"] = ctx
    app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024
    # 模板热重载：注意必须同时设置 TEMPLATES_AUTO_RELOAD 配置——
    # Flask 的 debug setter 会在 app.run() 时把 jinja_env.auto_reload 重设为
    # templates_auto_reload（= self.debug and 本配置），debug=False 时只有本配置能兜住
    app.config["TEMPLATES_AUTO_RELOAD"] = True
    app.jinja_env.auto_reload = True  # 即使 debug=False 也自动重载模板

    import atexit

    # JWT 密钥：环境变量 > config.yaml > 自动生成
    import lib.auth as _auth_mod
    jwt_key = _auth_mod.SECRET_KEY
    if jwt_key == "exdiary-dev-secret-key-change-in-production":
        jwt_key = config.get("JWT_SECRET", "")
        if not jwt_key:
            import secrets as _secrets
            jwt_key = _secrets.token_hex(32)
            config["JWT_SECRET"] = jwt_key
            config_manager.save(config)
        _auth_mod.SECRET_KEY = jwt_key

    # ---- 仓储层（SQLite 为唯一后端；YAML 后端已移除，不再是可配置选项） ----
    from lib.repositories.sqlite_experiment import SqliteExperimentRepository
    from lib.repositories.sqlite_analysis import SqliteAnalysisRepository
    from lib.repositories.sqlite_favorites import SqliteFavoritesRepository
    from lib.repositories.sqlite_update_log import SqliteUpdateLogRepository
    from lib.repositories.sqlite_thread import SqliteThreadRepository
    from lib.attachment_store import SqliteAttachmentStore
    from lib.crypto import open_encrypted_db, open_plain_db, derive_key, is_cipher_available
    from lib.offline import init_offline_db
    # 加密密钥：从环境变量或配置读取
    enc_key_raw = os.environ.get("EXDIARY_ENC_KEY", config.get("ENCRYPTION_KEY", ""))
    if enc_key_raw and is_cipher_available():
        key_bytes = derive_key(enc_key_raw)
        db_path = DATABASE_PATH
        # 首次启动需对已有数据库加密（SQLCipher 的 PRAGMA key 首次设置即加密）
        db_conn = open_encrypted_db(db_path, key_bytes)
    else:
        import sqlite3 as _sqlite3
        db_conn = _sqlite3.connect(DATABASE_PATH, check_same_thread=False, timeout=30)
        db_conn.row_factory = _sqlite3.Row
        db_conn.execute("PRAGMA journal_mode=WAL")
    db_conn.execute("PRAGMA busy_timeout=30000")  # 多写连接并存时等锁而非报错
    from lib.repositories.sqlite_common import ThreadSafeConnection
    db_conn = ThreadSafeConnection(db_conn)  # threaded 服务器多请求线程共享连接：串行化防 database is locked
    exp_repo = SqliteExperimentRepository(db_conn, data_dir=str(DATA_DIR / "experiments"),
                                          uid_provider=_uid_provider, on_dirty=_dirty_trigger("experiment"),
                                          device_code=config["DEVICE_CODE"])
    analysis_repo = SqliteAnalysisRepository(
        db_conn, uid_provider=_uid_provider, on_dirty=_dirty_trigger("analysis"),
        device_code=config["DEVICE_CODE"],
    )
    favorites_repo = SqliteFavoritesRepository(db_conn, uid_provider=_uid_provider,
                                               on_dirty=_dirty_trigger("favorites"))
    update_log_repo = SqliteUpdateLogRepository(db_conn, uid_provider=_uid_provider,
                                                on_dirty=_dirty_trigger("update_log"))
    attachment_store = SqliteAttachmentStore(
        db_conn, uid_provider=_uid_provider, on_dirty=_dirty_trigger("attachment"),
        on_music_library_dirty=_dirty_trigger("music_library"),
    )
    # 离线数据库（不加密——离线模式不需要额外密钥配置）
    off_conn = init_offline_db()
    off_conn = ThreadSafeConnection(off_conn)  # 离线连接也纳入全局写锁，统一串行化
    # 主连接挂容器，shutdown 时统一关闭（先停 sync 线程再关连接）
    ctx.connections.extend([db_conn, off_conn])
    exp_repo_offline = SqliteExperimentRepository(off_conn, data_dir=str(DATA_DIR / "experiments"),
                                                  uid_provider=_uid_provider, device_code=config["OFFLINE_DEVICE_CODE"])
    analysis_repo_offline = SqliteAnalysisRepository(
        off_conn, uid_provider=_uid_provider, device_code=config["OFFLINE_DEVICE_CODE"],
    )
    favorites_repo_offline = SqliteFavoritesRepository(off_conn, uid_provider=_uid_provider)
    update_log_repo_offline = SqliteUpdateLogRepository(off_conn, uid_provider=_uid_provider)
    attachment_store_offline = SqliteAttachmentStore(off_conn, uid_provider=_uid_provider)
    # 线程：main (data.db) + offline (offline.db) 均用 SQLite 实现
    thread_repo = SqliteThreadRepository(db_conn, uid_provider=_uid_provider,
                                         on_dirty=_dirty_trigger("thread"))
    thread_repo_offline = SqliteThreadRepository(off_conn, uid_provider=_uid_provider)
    atexit.register(ctx.shutdown)

    # ---- 服务层（两套：在线 + 离线） ----
    experiment_svc = ExperimentService(exp_repo, update_log_repo, favorites_repo, DATA_DIR)
    extraction_svc = ExtractionService(None)
    analysis_svc = AnalysisService(
        exp_repo, analysis_repo, get_analyze_llm,
        timeout_seconds=lambda: config.get("ANALYSIS_TIMEOUT_SECONDS", 8 * 60),
        update_log_repo=update_log_repo,
        attachment_store=attachment_store,
    )
    template_svc = TemplateService(str(BASE_DIR / "experiment_templates"))
    experiment_svc_offline = ExperimentService(
        exp_repo_offline, update_log_repo_offline, favorites_repo_offline, DATA_DIR)
    analysis_svc_offline = AnalysisService(
        exp_repo_offline, analysis_repo_offline, get_analyze_llm,
        timeout_seconds=lambda: config.get("ANALYSIS_TIMEOUT_SECONDS", 8 * 60),
        update_log_repo=update_log_repo_offline,
        attachment_store=attachment_store_offline,
    )

    def _flush_pending_sync(account: str, gateway: object) -> None:
        """推送网关启动前落到本机的修改，避免后台首连漏掉保存。"""
        with _GATEWAY_LOCK:
            pending = list(_PENDING_SYNC.pop(account, {}).items())
        if not pending:
            return
        from lib.e2ee.app_glue import build_readers, forward_dirty
        readers = build_readers(
            exp_repo, thread_repo, analysis_repo, favorites_repo, update_log_repo,
            attachment_store,
        )
        for (entity_type, entity_id), tombstone in pending:
            forward_dirty(gateway, entity_type, entity_id, tombstone, readers)

    def _start_gateway_in_background(account: str, dek: bytes) -> None:
        """首次同步只启动一次，并放到后台，避免首屏等待中继网络。"""
        with _GATEWAY_LOCK:
            if account in _GATEWAYS or account in _GATEWAY_BOOTSTRAPS:
                return
            _GATEWAY_BOOTSTRAPS.add(account)

        def bootstrap() -> None:
            gateway = None
            gateway_conn = None
            registered = False
            try:
                with app.app_context():
                    with app.test_request_context():
                        g.user_id = account
                        from lib.e2ee.app_glue import setup_gateway
                        gateway, gateway_conn = setup_gateway(
                            DATABASE_PATH, account, dek,
                            config["RELAY_URL"], config.get("RELAY_API_KEY", ""), _uid_provider,
                        )
                        with _GATEWAY_LOCK:
                            _GATEWAYS[account] = gateway
                            ctx.sync_connections.append(gateway_conn)
                            registered = True
                        try:
                            from lib.e2ee.watch import ensure_watcher, ensure_backfill
                            ensure_watcher(app, ctx, account, gateway,
                                           config["RELAY_URL"], config.get("RELAY_API_KEY", ""))
                        except Exception:
                            pass
                        try:
                            ensure_backfill(app, ctx, account, gateway, DATABASE_PATH, _uid_provider)
                        except Exception:
                            pass
                        try:
                            _flush_pending_sync(account, gateway)
                        except Exception:
                            pass  # 网关已可用；待同步补推失败由后续重试兜底
            except Exception:
                if not registered and gateway_conn is not None:
                    try:
                        gateway_conn.close()
                    except Exception:
                        pass
            finally:
                with _GATEWAY_LOCK:
                    _GATEWAY_BOOTSTRAPS.discard(account)

        threading.Thread(target=bootstrap, name=f"sync-bootstrap-{account}", daemon=True).start()

    # ---- flask.g 注入 ----
    @app.before_request
    def inject_services():
        # 可选认证：Authorization header 或 cookie 中有 token 就解析 user_id
        g.user_id = None
        token = ""
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
        else:
            token = request.cookies.get("exdiary_token", "")
        if token:
            from lib.auth import decode_token
            try:
                payload = decode_token(token)
                _uid = payload.get("user_id")
                _epoch = payload.get("epoch")
                if _session_epoch_ok(app, _uid, _epoch):
                    g.user_id = _uid  # 改密/恢复（epoch 已变）后旧 token 失效，必须重新登录
            except Exception:
                pass
        is_online = g.user_id is not None
        g.config = config
        g.config_manager = config_manager
        g.exp_repo = exp_repo if is_online else (exp_repo_offline or exp_repo)
        g.analysis_repo = analysis_repo if is_online else (analysis_repo_offline or analysis_repo)
        g.favorites_repo = favorites_repo if is_online else (favorites_repo_offline or favorites_repo)
        g.update_log_repo = update_log_repo if is_online else (update_log_repo_offline or update_log_repo)
        g.attachment_store = attachment_store if is_online else (attachment_store_offline or attachment_store)
        g.thread_repo = thread_repo if is_online else (thread_repo_offline or thread_repo)
        g.experiment_svc = experiment_svc if is_online else (experiment_svc_offline or experiment_svc)
        g.analysis_svc = analysis_svc if is_online else (analysis_svc_offline or analysis_svc)
        g.extraction_svc = extraction_svc
        g.template_svc = template_svc
        g.data_dir = DATA_DIR
        g.get_extract_llm = get_extract_llm
        g.get_analyze_llm = get_analyze_llm
        g.get_agent_llm = get_agent_llm

        # 新同步是否启用：登录 + 配了 RELAY_URL + 进程内已缓存该账号 DEK
        _new_sync = False
        if is_online and g.config.get("RELAY_URL"):
            try:
                from lib.e2ee.flask_setup import get_cached_dek, set_cached_dek
                _dek = get_cached_dek(g.user_id)
                if _dek is None:
                    # 重启后进程内无 DEK：凭合法 JWT 从系统凭据库恢复（免重登）
                    from lib.e2ee import credstore
                    _dek = credstore.get_dek(g.user_id)
                    if _dek is not None:
                        set_cached_dek(g.user_id, _dek)
                _new_sync = _dek is not None
            except Exception:
                _new_sync = False
        g._sync_svc = None  # 老 SyncService 已移除；同步统一走新网关（lib/e2ee/watch.py）

        # 同步网关的首连会访问中继并全量拉取；不能占住首屏 HTTP 请求。
        # 后台启动期间的新本地写入由 _dirty_trigger 记入 _PENDING_SYNC，网关就绪后补推。
        if _new_sync:
            _start_gateway_in_background(g.user_id, _dek)
        with _GATEWAY_LOCK:
            g._sync_gateway = _GATEWAYS.get(g.user_id, None) if is_online else None

    # ---- 注册蓝图 ----
    app.register_blueprint(dashboard_bp)
    app.register_blueprint(experiment_bp, url_prefix="/experiments")
    app.register_blueprint(pages_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(templates_bp)
    app.register_blueprint(uploads_bp)

    app.register_blueprint(api_experiment_bp, url_prefix="/api")
    app.register_blueprint(api_agent_bp, url_prefix="/api/agent")
    app.register_blueprint(api_child_bp, url_prefix="/api")
    app.register_blueprint(api_analysis_bp, url_prefix="/api")
    app.register_blueprint(api_search_bp, url_prefix="/api")
    app.register_blueprint(api_favorites_bp, url_prefix="/api")
    app.register_blueprint(api_upload_bp, url_prefix="/api")
    app.register_blueprint(api_attachment_bp, url_prefix="/api")
    app.register_blueprint(api_music_bp, url_prefix="/api")
    app.register_blueprint(api_auth_bp, url_prefix="/api/auth")
    app.register_blueprint(api_sync_bp, url_prefix="/api")
    app.register_blueprint(fragments_bp)

    # ---- e2ee 认证（可选接入：依赖缺失时自动跳过，不阻断启动） ----
    try:
        from lib.e2ee.flask_setup import init_e2ee
        init_e2ee(app)
    except Exception as _e:  # 任何导入/装配问题都不影响现有功能
        app.config["E2EE_ENABLED"] = False
        print(f"[warn] e2ee 未启用（{_e}）")

    app.config["EXDIARY_CONFIG"] = config
    return app


# ---- 启动 ----
if __name__ == "__main__":
    app = create_app()
    config = app.config["EXDIARY_CONFIG"]
    port = int(config.get("PORT", 5000))
    host = config.get("HOST", "0.0.0.0")
    use_gui = config.get("GUI", "true").lower() in ("true", "1", "yes")

    log = get_logger()
    if log:
        log.system("info", "startup", port=port, gui=config.get("GUI", "true"))

    model = config.get("DEEPSEEK_MODEL", "deepseek-v4-flash")
    analyze_model = config.get("DEEPSEEK_ANALYZE_MODEL", "deepseek-v4-pro")

    if sys.stdout.encoding != "utf-8":
        sys.stdout.reconfigure(encoding="utf-8")

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        lan_ip = "127.0.0.1"

    print("  ExperMate｜小同门")
    print(f"  Local:    http://127.0.0.1:{port}")
    print(f"  Network:  http://{lan_ip}:{port}")
    print(f"  Extract:  {model}")
    print(f"  Analyze:  {analyze_model}")

    debug = os.environ.get("FLASK_DEBUG") == "1"

    if "--headless" in sys.argv or not use_gui:
        print(f"  Mode:     headless (web only)")
        app.run(host=host, port=port, threaded=True, debug=debug or None)
    else:
        try:
            import webview
        except ImportError:
            print("  pywebview not installed. Run: pip install pywebview")
            print("  Falling back to web mode...")
            app.run(host=host, port=port, threaded=True, debug=debug or None)
            sys.exit()

        def run_flask():
            # 不传 debug=False：Flask 的 debug setter 会重置 jinja_env.auto_reload
            #（templates_auto_reload = self.debug and ...），从而关掉模板热重载。
            # 传 None（默认）则不触发 setter，保留 create_app 中开启的 auto_reload。
            app.run(host=host, port=port, threaded=True, use_reloader=False)

        class DesktopAttachmentApi:
            """供 pywebview 调用系统“另存为”窗口，避免 Blob 下载在桌面端失效。"""

            def save_attachment(self, url: str, filename: str, token: str) -> dict[str, Any]:
                parsed = urlparse(url)
                if parsed.hostname not in {"127.0.0.1", "localhost"} or not parsed.path.startswith("/api/attachments/"):
                    return {"ok": False, "error": "无效的附件下载地址"}
                try:
                    headers = {"Authorization": f"Bearer {token}"} if token else {}
                    with urlopen(Request(url, headers=headers), timeout=60) as response:
                        content = response.read()
                    save_name = Path(filename or "attachment").name
                    selected = webview.windows[0].create_file_dialog(
                        webview.SAVE_DIALOG,
                        save_filename=save_name,
                    )
                    if not selected:
                        return {"ok": False, "cancelled": True}
                    target = Path(selected[0])
                    if not target.suffix and Path(save_name).suffix:
                        target = target.with_suffix(Path(save_name).suffix)
                    target.write_bytes(content)
                    return {"ok": True}
                except Exception as exc:
                    return {"ok": False, "error": f"附件保存失败：{str(exc)[:160]}"}

        flask_thread = threading.Thread(target=run_flask, daemon=True)
        flask_thread.start()

        print(f"  Mode:     native desktop window")
        webview.create_window(
            title="ExperMate｜小同门 — 实验记录",
            url=f"http://127.0.0.1:{port}",
            width=1100, height=750,
            text_select=True,
            js_api=DesktopAttachmentApi(),
        )
        # 桌面端需要在重启和页面刷新后保留登录 Cookie/localStorage，才能按账号
        # 读取 data.db 中的历史；未登录时才由后端显式切到 offline.db。
        desktop_storage = Path(os.environ.get("LOCALAPPDATA", str(BASE_DIR))) / "Exdiary" / "webview"
        webview.start(private_mode=False, storage_path=str(desktop_storage))
        sys.exit(0)
