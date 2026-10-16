"""React 只读迁移：真实 SQLite 作用域、Cookie 登录和静态入口回归。"""

import sqlite3
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import jwt
import pytest
from flask import Flask, g, request

from lib.attachment_store import SqliteAttachmentStore
from lib.auth import decode_token
from lib.e2ee.flask_setup import _make_auth_blueprint
from lib.repositories.sqlite_analysis import SqliteAnalysisRepository
from lib.repositories.sqlite_experiment import SqliteExperimentRepository
from lib.repositories.sqlite_favorites import SqliteFavoritesRepository
from lib.repositories.sqlite_update_log import SqliteUpdateLogRepository
from lib.services.experiment import ExperimentService
from routes.api_analysis import api_analysis_bp
from routes.api_attachment import api_attachment_bp
from routes.api_experiment import api_experiment_bp
from routes.api_v1 import api_v1_bp
from routes.experiment import experiment_bp
from routes.pages import pages_bp
from routes.settings import settings_bp


@pytest.fixture
def react_app(tmp_path, monkeypatch):
    app = Flask(__name__, root_path=str(Path(__file__).resolve().parents[1]))
    app.config.update(TESTING=True, REACT_DIST_DIR=tmp_path / "dist")
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    repo = SqliteExperimentRepository(conn, uid_provider=lambda: g.user_id or "")
    attachments = SqliteAttachmentStore(conn, uid_provider=lambda: g.user_id or "")
    favorites = SqliteFavoritesRepository(conn, uid_provider=lambda: g.user_id or "")
    logs = SqliteUpdateLogRepository(conn, uid_provider=lambda: g.user_id or "")
    experiment_service = ExperimentService(repo, logs, favorites)
    analyses = SqliteAnalysisRepository(conn, uid_provider=lambda: g.user_id or "")
    config = {"LLM_AGENT_API_KEY": "test-agent-secret-12345", "LLM_ANALYZE_API_KEY": "test-analysis-secret-67890",
              "LLM_AGENT_PROVIDER": "deepseek", "LLM_AGENT_MODEL": "test-model", "HOST": "127.0.0.1"}
    template_service = SimpleNamespace(list_all=lambda: [{"id": "sample", "title": "Sample", "category": "Test", "description": "Fixture", "tags": []}])
    monkeypatch.setattr("routes.experiment._notify_experiment_change", lambda *args: None)
    monkeypatch.setattr("routes.api_attachment._notify_attachment_change", lambda *args: None)
    monkeypatch.setattr("routes.api_experiment._notify_experiment_created", lambda *args: None)
    for index in range(24):
        repo.save({"id": f"A-{index:02}", "title": f"实验 {index}", "date": "2026-10-15",
                   "status": "running" if index == 1 else "done", "tags": ["XRD"],
                   "purpose": "p" * 250, "original_notes": "private full text"}, user_id="alice")
    repo.save({"id": "B-01", "title": "Bob private", "tags": []}, user_id="bob")
    repo.save({"id": "A-archived", "title": "Archived", "archived": True}, user_id="alice")
    repo.save({"id": "A-literal", "title": "100%_yield"}, user_id="alice")

    @app.before_request
    def inject_identity():
        # 模拟现有 app 的认证注入，使用真实签发和解码，不启用离线数据源。
        g.user_id = None
        try:
            token = decode_token(request.cookies.get("exdiary_token", ""))
            if token.get("epoch") == 1:
                g.user_id = token["user_id"]
        except jwt.InvalidTokenError:
            pass
        g.exp_repo = repo
        g.attachment_store = attachments
        g.favorites_repo = favorites
        g.experiment_svc = experiment_service
        g.frontend_offline = bool(app.config.get("TEST_FRONTEND_OFFLINE")) and not request.cookies.get("exdiary_token") and not g.user_id
        g.analysis_repo = analyses
        g.template_svc = template_service
        g.config = config
        g.config_manager = SimpleNamespace(save=config.update)
        g.get_extract_llm = lambda: None

    svc = SimpleNamespace(
        login=lambda account, password: account in {"alice", "bob"} and password == "test-password",
        open_dek=lambda account, password: b"test-only-dek",
        snapshot=lambda account: SimpleNamespace(account_epoch=1),
    )
    monkeypatch.setattr("lib.e2ee.flask_setup.credstore.set_dek", lambda *args: None)
    monkeypatch.setattr("lib.e2ee.flask_setup.set_cached_dek", lambda *args: None)
    app.register_blueprint(_make_auth_blueprint(SimpleNamespace(svc=svc)))
    app.register_blueprint(api_v1_bp, url_prefix="/api/v1")
    app.register_blueprint(experiment_bp, url_prefix="/experiments")
    app.register_blueprint(api_attachment_bp, url_prefix="/api")
    app.register_blueprint(api_analysis_bp, url_prefix="/api")
    app.register_blueprint(api_experiment_bp, url_prefix="/api")
    app.register_blueprint(settings_bp)
    app.register_blueprint(pages_bp)
    yield app
    conn.close()


def login(client, account="alice"):
    response = client.post("/api/e2ee/login", json={"account": account, "password": "test-password"})
    assert response.status_code == 200
    return response


def test_cookie_login_and_logout(react_app):
    client = react_app.test_client()
    response = login(client)
    cookie = response.headers["Set-Cookie"]
    assert "HttpOnly" in cookie and "SameSite=Lax" in cookie and "Path=/" in cookie
    assert response.json["token"]  # 旧客户端仍能读取 Bearer token。
    assert client.get("/api/e2ee/me").json["account"] == "alice"
    assert client.get("/api/v1/experiments").status_code == 200
    client.post("/api/e2ee/logout")
    assert client.get("/api/v1/experiments").status_code == 401


def test_https_cookie_is_secure(react_app):
    response = react_app.test_client().post("/api/e2ee/login", base_url="https://localhost",
                                         json={"account": "alice", "password": "test-password"})
    assert "Secure" in response.headers["Set-Cookie"]


def test_session_verification_clears_expired_cookie_before_offline_page_load(react_app):
    react_app.config["TEST_FRONTEND_OFFLINE"] = True
    client = react_app.test_client()
    client.set_cookie("exdiary_token", "invalid-session", domain="localhost")
    response = client.get("/api/e2ee/me")
    assert response.status_code == 401
    assert "Max-Age=0" in response.headers["Set-Cookie"]
    assert client.get("/api/v1/settings").status_code == 200


@pytest.mark.parametrize("path", ["/experiments", "/experiment-list", "/experiments/A-00", "/attachments/unknown",
                                  "/timeline", "/templates", "/analysis", "/analysis/report", "/settings", "/compare"])
def test_anonymous_cannot_read(react_app, path):
    response = react_app.test_client().get("/api/v1" + path)
    assert response.status_code == 401
    assert response.json["error"]["code"] == "unauthenticated"


def test_pagination_summary_and_account_scope(react_app):
    client = react_app.test_client()
    login(client)
    first = client.get("/api/v1/experiments?page_size=10").json
    second = client.get("/api/v1/experiments?page_size=10&page=2").json
    assert first["meta"] == {"total": 25, "page": 1, "page_size": 10}
    assert len(first["data"]) == len(second["data"]) == 10
    assert not ({item["id"] for item in first["data"]} & {item["id"] for item in second["data"]})
    assert all(item["id"].startswith("A-") for item in first["data"])
    assert all("original_notes" not in item for item in first["data"])
    assert all(len(item["purpose"]) <= 200 for item in first["data"])
    assert client.get("/api/v1/experiments/A-00").json["data"]["original_notes"] == "private full text"
    assert client.get("/api/v1/experiments/B-01").status_code == 404
    login(client, "bob")
    assert client.get("/api/v1/experiments").json["meta"]["total"] == 1
    assert client.get("/api/v1/experiments/A-00").status_code == 404


def test_filters_and_literal_wildcards(react_app):
    client = react_app.test_client()
    login(client)
    assert client.get("/api/v1/experiments?status=running").json["data"][0]["id"] == "A-01"
    assert client.get("/api/v1/experiments?include_archived=1").json["meta"]["total"] == 26
    assert client.get("/api/v1/experiments", query_string={"q": "%_"}).json["data"][0]["id"] == "A-literal"
    assert client.get("/api/v1/experiments", query_string={"q": "' OR 1=1 --"}).json["data"] == []
    assert client.get("/api/v1/experiments?q=Bob").json["data"] == []
    assert client.get("/api/v1/experiments?q=XRD").json["meta"]["total"] == 24


def test_list_context_matches_original_projection_and_account_scope(react_app):
    client = react_app.test_client()
    login(client)
    with react_app.test_request_context():
        g.user_id = "alice"
        react_app.preprocess_request()
        g.user_id = "alice"
        g.favorites_repo.create_collection("XRD")
        g.favorites_repo.toggle_favorite("A-00", "XRD")
        g.favorites_repo.toggle_pin("A-00")
    data = client.get("/api/v1/experiment-list").json["data"]
    assert len(data["experiments"]) == 26
    assert all(item["id"].startswith("A-") and "original_notes" not in item for item in data["experiments"])
    assert data["collections"]["XRD"] == ["A-00"]
    assert "A-00" in data["pinnedIds"]
    login(client, "bob")
    other = client.get("/api/v1/experiment-list").json["data"]
    assert [item["id"] for item in other["experiments"]] == ["B-01"]
    assert "XRD" not in other["collections"] and not other["pinnedIds"]


@pytest.mark.parametrize("query", ["page=0", "page=-1", "page=x", "page_size=101", "page_size=0",
                                  "status=unknown", "include_archived=yes", "q=" + "x" * 201])
def test_invalid_filters(react_app, query):
    client = react_app.test_client()
    login(client)
    assert client.get("/api/v1/experiments?" + query).status_code == 400


def test_attachment_download_scope(react_app):
    client = react_app.test_client()
    login(client)
    with react_app.test_request_context():
        g.user_id = "alice"
        # 使用接口注入的附件库，在请求前置处理后插入。
        react_app.preprocess_request()
        g.user_id = "alice"
        meta = g.attachment_store.put(b"<script>test</script>", name="example.txt", mime="text/plain")
    path = "/api/v1/attachments/" + meta["sha256"]
    response = client.get(path)
    assert response.data == b"<script>test</script>"
    assert "attachment" in response.headers["Content-Disposition"]
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["Cache-Control"] == "no-store"
    login(client, "bob")
    assert client.get(path).status_code == 404


def test_react_routes_and_missing_assets(react_app, tmp_path):
    from routes.dashboard import dashboard_bp

    react_app.register_blueprint(dashboard_bp)
    client = react_app.test_client()
    assert client.get("/app/").status_code == 503
    assert client.get("/").status_code == 503
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>React test entry</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('test')", encoding="utf-8")
    for path in ["/app/", "/app/experiments", "/app/experiments/A-01", "/app/settings",
                 "/app/analyze", "/app/analysis/report-1", "/app/timeline", "/app/login", "/app/new",
                 "/", "/experiments", "/experiments/A-01", "/settings", "/analyze", "/analysis/report-1",
                 "/timeline", "/login", "/new", "/compare", "/favorites", "/templates"]:
        response = client.get(path)
        assert b"React test entry" in response.data
        assert response.headers["Cache-Control"] == "no-cache"
    assert client.get("/app/experiments/A-01/print").headers["Location"] == "/experiments/A-01/print"
    assert client.get("/app/analysis/report-1/print").headers["Location"] == "/experiments/analysis/report-1/print"
    assert client.get("/app/assets/app.js").status_code == 200
    for path in ["/app/assets/missing.js", "/app/missing.js", "/app/assets/../index.html"]:
        assert client.get(path).status_code == 404


def test_obsolete_frontend_is_retired_but_styles_audio_and_print_remain(react_app):
    from routes.dashboard import dashboard_bp

    react_app.register_blueprint(dashboard_bp)
    client = react_app.test_client()
    assert client.get("/ai-shell/").status_code == 308
    assert client.get("/ai-shell/").headers["Location"] == "/"
    for path in ("/_fragment/experiments", "/_fragment/settings", "/ai-shell/static/js/agent.js",
                 "/ai-shell/static/js/panel.js", "/static/js/edit-mode.js", "/static/js/attachment-viewer.js"):
        assert client.get(path).status_code == 404
    for path in ("/ai-shell/static/css/shell.css", "/static/css/experiments.css",
                 "/static/css/experiment-detail.css", "/ai-shell/static/audio/uisfx/zen-01-general.mp3"):
        assert client.get(path).status_code == 200
    login(client)
    assert client.get("/experiments/A-00/print").status_code == 200
    with react_app.test_request_context():
        react_app.preprocess_request()
        g.user_id = "alice"
        g.analysis_repo.save({"id": "PRINT-1", "analysis": "Print fixture", "selected_ids": []})
    assert client.get("/experiments/analysis/PRINT-1/print").status_code == 200


def test_form_apis_no_longer_render_removed_templates(react_app, monkeypatch):
    @react_app.before_request
    def fake_model():
        if react_app.config.get("TEST_EXTRACT_MODEL"):
            g.get_extract_llm = lambda: object()

    client = react_app.test_client()
    login(client)
    assert client.post("/api/parse", data={"notes": "short"}).status_code == 400
    assert client.post("/api/parse", data={"notes": "A sufficiently long experimental note"}).is_json
    saved = client.post("/settings", data={"LLM_AGENT_MODEL": "fixture-model"})
    assert saved.status_code == 200 and saved.json["ok"]
    invalid = client.post("/settings", data={"CONTEXT_COMPRESSION_TRIGGER_TOKENS": "invalid"})
    assert invalid.status_code == 400 and invalid.is_json
    monkeypatch.setattr("routes.api_experiment.parse_notes", lambda *args: {"title": "Parsed fixture"})
    react_app.config["TEST_EXTRACT_MODEL"] = True
    result = client.post("/api/parse", data={"notes": "A sufficiently long experimental note"})
    assert result.status_code == 200 and result.json["data"]["title"] == "Parsed fixture"


def test_detail_save_attachment_revision_and_archive_contract(react_app):
    client = react_app.test_client()
    login(client)
    original = client.get("/api/v1/experiments/A-00").json["data"]
    uploaded = client.post("/api/attachments", data={
        "experiment_id": "A-00", "expected_revision": str(original["revision"]),
        "file": (BytesIO(b"test attachment"), "notes.txt"),
    })
    assert uploaded.status_code == 200
    current = client.get("/api/v1/experiments/A-00").json["data"]
    assert current["revision"] == uploaded.json["revision"]
    sha256 = uploaded.json["attachment"]["sha256"]
    saved = client.post("/experiments/A-00/save-json", json={
        **current, "title": "Edited in React", "expected_revision": current["revision"],
        "original_notes": "<p><strong>Preserved HTML</strong></p>",
    })
    assert saved.status_code == 200
    after = client.get("/api/v1/experiments/A-00").json["data"]
    assert after["attachments"][0]["sha256"] == sha256
    assert after["original_notes"] == "<p><strong>Preserved HTML</strong></p>"
    stale = client.post("/experiments/A-00/save-json", json={
        **current, "title": "Stale edit", "expected_revision": current["revision"],
    })
    assert stale.status_code == 409 and stale.json["revision"] == after["revision"]
    assert client.get("/api/v1/experiments/A-00").json["data"]["title"] == "Edited in React"
    assert client.post("/experiments/A-00/archive", json={"expected_revision": current["revision"]}).status_code == 409
    archived = client.post("/experiments/A-00/archive", json={"expected_revision": after["revision"]})
    assert archived.status_code == 200
    restored = client.post("/experiments/A-00/restore", json={"expected_revision": archived.json["revision"]})
    assert restored.status_code == 200
    assert client.get("/api/v1/experiments/A-00").json["data"]["attachments"][0]["sha256"] == sha256


def test_remaining_page_contexts_are_scoped_and_comparison_is_bounded(react_app):
    client = react_app.test_client()
    login(client)
    assert all(item["id"].startswith("A-") for item in client.get("/api/v1/timeline").json["data"])
    assert client.get("/api/v1/templates").json["data"][0]["id"] == "sample"
    assert client.get("/api/v1/compare?ids=A-00,B-01").status_code == 400
    records = client.get("/api/v1/compare?ids=A-00,A-01,A-02,A-03,A-04").json["data"]
    assert [item["id"] for item in records] == ["A-00", "A-01", "A-02", "A-03"]
    with react_app.test_request_context():
        react_app.preprocess_request()
        g.user_id = "alice"
        original = g.exp_repo.load("A-00")
        g.analysis_repo.save({"id": "R1", "selected_ids": ["A-00"], "analysis": "Report",
                              "source_snapshot": {"records": [original]}})
    assert client.get("/api/v1/analysis").json["data"][0]["id"] == "R1"
    assert client.get("/api/v1/analysis/R1").json["data"]["stale_ids"] == []
    original["title"] = "Changed"
    client.post("/experiments/A-00/save-json", json={**original, "expected_revision": original["revision"]})
    assert client.get("/api/v1/analysis/R1").json["data"]["stale_ids"] == ["A-00"]
    login(client, "bob")
    assert client.get("/api/v1/analysis").json["data"] == []
    assert client.get("/api/v1/analysis/R1").status_code == 404


def test_settings_json_masks_secrets_and_preserves_blank_keys(react_app):
    client = react_app.test_client()
    login(client)
    response = client.get("/api/v1/settings")
    assert "test-agent-secret-12345" not in response.get_data(as_text=True)
    assert "LLM_AGENT_API_KEY" not in response.json["data"]["values"]
    assert response.json["data"]["masked_agent_key"] == "test****2345"
    saved = client.post("/api/v1/settings", data={"LLM_AGENT_API_KEY": "", "LLM_AGENT_MODEL": "changed-model"})
    assert saved.status_code == 200 and saved.json["ok"]
    assert saved.json["data"]["masked_agent_key"] == "test****2345"
    assert saved.json["data"]["values"]["LLM_AGENT_MODEL"] == "changed-model"
    invalid = client.post("/api/v1/settings", data={"CONTEXT_COMPRESSION_TRIGGER_TOKENS": "10000", "CONTEXT_COMPRESSION_CHUNK_TOKENS": "20000"})
    assert invalid.status_code == 400 and not invalid.json["ok"]


def test_explicit_offline_scope_remains_separate_from_accounts_and_rejects_invalid_credentials(react_app):
    react_app.config["TEST_FRONTEND_OFFLINE"] = True
    with react_app.test_request_context():
        react_app.preprocess_request()
        g.exp_repo.save({"id": "OFF-1", "title": "Offline fixture"}, user_id="")
    client = react_app.test_client()
    assert [item["id"] for item in client.get("/api/v1/experiment-list").json["data"]["experiments"]] == ["OFF-1"]
    assert client.get("/api/v1/experiments/A-00").status_code == 404
    assert client.get("/api/v1/settings").status_code == 200
    login(client)
    assert client.get("/api/v1/experiments/OFF-1").status_code == 404
    assert all(item["id"].startswith("A-") for item in client.get("/api/v1/experiment-list").json["data"]["experiments"])
    client.set_cookie("exdiary_token", "invalid-session", domain="localhost")
    rejected = client.get("/api/v1/experiment-list")
    assert rejected.status_code == 401
    assert "exdiary_token=;" in rejected.headers["Set-Cookie"]
