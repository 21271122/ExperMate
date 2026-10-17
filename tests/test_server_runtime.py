"""服务端运行模式的真实工厂、认证、账号隔离和部署配置回归。"""
import importlib.util
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask import g

from app import create_app
from lib.auth import create_token
from lib.e2ee.recovery import RecordingMailSender

PASSWORD = "Test-password-932!"


@pytest.fixture
def server(tmp_path):
    mail = RecordingMailSender()
    app = create_app({"DATA_DIR": tmp_path, "TESTING": True, "ADMIN_ACCOUNTS": ["admin"], "MAIL_SENDER": mail})
    for account in ("alice", "bob", "admin"):
        app.extensions["e2ee"].register(account, account + "@example.test", PASSWORD)
    yield app
    app.extensions["exdiary_ctx"].shutdown()


def client_for(app, account="alice"):
    client = app.test_client()
    response = client.post("/api/e2ee/login", json={"account": account, "password": PASSWORD})
    assert response.status_code == 200
    assert "token" not in response.json
    return client


def account_context(app, account="alice"):
    with app.app_context():
        token = create_token(account, 1)
    return app.test_request_context("/", headers={"Authorization": "Bearer " + token})


def test_import_does_not_load_config_or_create_runtime_files(monkeypatch, tmp_path):
    def unexpected(*args, **kwargs):
        raise AssertionError("模块导入不应初始化运行数据")
    monkeypatch.setattr("lib.config.ConfigManager.load", unexpected)
    spec = importlib.util.spec_from_file_location("server_import_probe", Path(__file__).parents[1] / "app.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert callable(module.create_app)


def test_retired_offline_desktop_and_relay_modules_are_removed():
    for module in ("lib.offline", "lib.e2ee.app_glue", "lib.e2ee.blobstore", "lib.e2ee.credstore",
                   "lib.e2ee.real_relay", "lib.e2ee.relay_server", "lib.e2ee.sync_router",
                   "lib.e2ee.syncengine", "lib.e2ee.watch", "lib.e2ee.web",
                   "lib.repositories.yaml_favorites"):
        assert importlib.util.find_spec(module) is None, module


def test_new_server_has_no_sync_queue_or_sync_only_attachment_metadata(server):
    with account_context(server):
        server.preprocess_request()
        assert g.exp_repo.db.execute("SELECT 1 FROM sqlite_master WHERE name='sync_queue'").fetchone() is None
        meta = g.attachment_store.put(b"fixture", name="data.txt", mime="text/plain")
        assert "sync_state" not in meta and "synced_at" not in meta
        assert g.exp_repo.save({"id": "cleanup-fixture", "title": "record"}) == "cleanup-fixture"
        result = g.exp_repo.save_if_revision({"id": "cleanup-fixture", "title": "updated"}, 1)
        assert result["ok"] and result["revision"] == 2
        assert not g.exp_repo.save_if_revision({"id": "cleanup-fixture", "title": "stale"}, 1)["ok"]


def test_retired_config_keys_are_ignored_and_removed_on_save(tmp_path):
    from lib.config import ConfigManager
    path = tmp_path / "config.yaml"
    path.write_text('GUI: "true"\nRELAY_URL: https://old.example\nOFFLINE_DEVICE_CODE: OLD1\n', encoding="utf-8")
    manager = ConfigManager(path)
    config = manager.load()
    manager.save({"LLM_AGENT_MODEL": "fixture-model"})
    for name in ("GUI", "OFFLINE_DEVICE_CODE", "RELAY_URL", "RELAY_API_KEY"):
        assert name not in config and name not in path.read_text(encoding="utf-8")


def test_old_unused_sync_table_is_left_untouched(tmp_path):
    import sqlite3
    path = tmp_path / "data.db"
    with sqlite3.connect(path) as conn:
        conn.execute("CREATE TABLE sync_queue (exp_id TEXT PRIMARY KEY, payload TEXT)")
        conn.execute("INSERT INTO sync_queue VALUES ('legacy-id', 'preserved')")
    app = create_app({"DATA_DIR": tmp_path, "TESTING": True})
    try:
        conn = app.extensions["exdiary_ctx"].connections[0]
        assert tuple(conn.execute("SELECT * FROM sync_queue").fetchone()) == ("legacy-id", "preserved")
    finally:
        app.extensions["exdiary_ctx"].shutdown()


@pytest.mark.parametrize("path", ["/api/v1/experiments", "/api/agent/history", "/api/agent/events", "/api/analysis-history", "/api/music/library", "/api/templates/photocatalysis", "/api/attachments/unknown", "/uploads/_draft/a.png", "/experiments/E1/print"])
def test_anonymous_and_invalid_cookie_never_fall_back_to_offline(server, path):
    client = server.test_client()
    assert client.get(path).status_code == 401
    client.set_cookie("exdiary_token", "bad-token")
    assert client.get(path).status_code == 401
    assert not (server.config["DATA_DIR"] / "offline.db").exists()


def test_foreign_id_cannot_be_overwritten_and_attachment_is_private(server):
    alice, bob = client_for(server), client_for(server, "bob")
    assert alice.post("/experiments/E1/save-json", json={"title": "Alice private"}).status_code == 200
    assert bob.post("/experiments/E1/save-json", json={"title": "forged"}).status_code == 400
    assert alice.get("/api/v1/experiments/E1").json["data"]["title"] == "Alice private"
    assert bob.get("/api/v1/experiments/E1").status_code == 404
    assert bob.get("/experiments/E1/print").status_code == 404
    result = alice.post("/api/agent/attachments", data={"file": (BytesIO(b"private fixture"), "result.txt")}).json
    sha = result["attachment"]["sha256"]
    assert alice.get("/api/attachments/" + sha).data == b"private fixture"
    assert bob.get("/api/attachments/" + sha).status_code == 404


def test_shared_repository_has_no_cross_account_index_or_summary_cache(server):
    for account in ("alice", "bob", "alice"):
        with account_context(server, account):
            server.preprocess_request()
            g.thread_repo.save({"id": "THREAD-" + account, "title": account, "messages": []})
            g.exp_repo.save({"id": "EXP-" + account, "title": account})
            assert all(row["id"] == "THREAD-" + account for row in g.thread_repo.get_index()["threads"])
            summary = g.thread_repo.build_global_summary(g.exp_repo, g.update_log_repo)
            assert ("bob" if account == "alice" else "alice") not in summary
            g.thread_repo.save_current_state({"history": [{"role": "user", "content": account}]})
    assert client_for(server).get("/api/agent/history").json["history"][0]["content"] == "alice"
    assert client_for(server, "bob").get("/api/agent/history").json["history"][0]["content"] == "bob"


def test_model_settings_are_admin_only_and_deployment_fields_are_not_editable(server):
    user, admin = client_for(server), client_for(server, "admin")
    assert not user.get("/api/v1/settings").json["data"]["can_configure"]
    assert user.post("/api/v1/settings", data={"LLM_AGENT_API_KEY": "stolen"}).status_code == 403
    response = admin.post("/api/v1/settings", data={"LLM_AGENT_MODEL": "fixture-model", "LLM_AGENT_API_KEY": "fixture-secret-12345", "HOST": "0.0.0.0", "PORT": 1234, "GUI": True})
    assert response.status_code == 200
    assert "fixture-secret-12345" not in response.get_data(as_text=True)
    config = server.config["EXDIARY_CONFIG"]
    assert config["HOST"] == "127.0.0.1" and config["PORT"] == 5000
    assert config["LLM_AGENT_MODEL"] == "fixture-model"


def test_origin_rejection_covers_login_and_business_writes(server):
    client = client_for(server)
    for path in ("/api/e2ee/login", "/experiments/E1/save-json", "/api/v1/settings"):
        assert client.post(path, json={}, headers={"Origin": "https://foreign.example"}).status_code == 403


def test_recovery_secrets_go_to_mail_only_and_missing_smtp_is_explicit(server):
    client = server.test_client()
    response = client.post("/api/e2ee/forgot", json={"account": "alice", "email": "alice@example.test"})
    assert response.status_code == 200 and "token" not in response.json
    sent = server.extensions["e2ee"].mail.sent
    assert len(sent) == 1 and sent[0][0] == "alice@example.test"
    server.config["MAIL_CONFIGURED"] = False
    assert client.post("/api/e2ee/forgot", json={"account": "alice"}).status_code == 503


def test_session_epoch_and_nonexistent_account_fail_closed(server):
    client = client_for(server)
    server.extensions["e2ee"].conn.execute("UPDATE account SET account_epoch=2 WHERE account_id='alice'")
    server.extensions["e2ee"].conn.commit()
    assert client.get("/api/agent/history").status_code == 401
    with server.app_context():
        forged = create_token("missing-user", 1)
    client.set_cookie("exdiary_token", forged)
    assert client.get("/api/agent/history").status_code == 401


def test_child_confirm_uses_server_preview_and_revision(server):
    client = client_for(server)
    client.post("/experiments/E1/save-json", json={"title": "original"})
    assert client.post("/api/exp/E1/confirm", json={"preview": {"title": "forged"}}).status_code == 409
    with account_context(server):
        server.preprocess_request()
        g.thread_repo.save_child_state("preview:E1", {"preview": {"title": "server preview"}, "revision": 1})
    assert client.post("/api/exp/E1/confirm", json={"preview": {"title": "forged"}}).status_code == 200
    assert client.get("/api/v1/experiments/E1").json["data"]["title"] == "server preview"
    assert client.post("/api/exp/E1/confirm", json={}).status_code == 409
    with account_context(server):
        server.preprocess_request()
        g.thread_repo.save_child_state("preview:E1", {"preview": {"title": "stale"}, "revision": 1})
    assert client.post("/api/exp/E1/confirm", json={}).status_code == 409


def test_child_ignores_browser_state_and_serializes_with_main_agent(server, monkeypatch):
    client = client_for(server)
    client.post("/experiments/E1/save-json", json={"title": "original"})
    with account_context(server):
        server.preprocess_request()
        g.thread_repo.save_child_state("E1", {"history": [{"role": "user", "content": "server history"}]})
    monkeypatch.setattr("app._configured_llm", lambda *args: object())
    seen = []
    def restore(**kwargs):
        seen.append(kwargs["state_dict"])
        return SimpleNamespace(child=SimpleNamespace(), thread=SimpleNamespace(), _generated_preview=None, state_to_dict=lambda: kwargs["state_dict"])
    monkeypatch.setattr("routes.api_child.get_or_create_agent", restore)
    response = client.post("/api/exp/E1/chat", json={"state": {"history": [{"content": "forged"}]}, "is_legacy": True})
    assert response.status_code == 200
    assert seen[0]["history"][0]["content"] == "server history"
    with account_context(server):
        server.preprocess_request()
        from routes.api_agent import _run_lock
        lock = _run_lock("alice")
        lock.acquire()
    try:
        assert client.post("/api/exp/E1/chat", json={}).status_code == 409
    finally:
        lock.release()


def test_instances_have_independent_jwt_keys_and_runtime_state(server, tmp_path):
    other = create_app({"DATA_DIR": tmp_path / "other", "TESTING": True})
    try:
        other.extensions["e2ee"].register("alice", "alice@example.test", PASSWORD)
        with server.app_context():
            token = create_token("alice", 1)
            from routes.api_agent import _runtime
            first_runtime = _runtime()
        client = other.test_client()
        client.set_cookie("exdiary_token", token)
        assert client.get("/api/agent/history").status_code == 401
        with other.app_context():
            assert _runtime() is not first_runtime
    finally:
        other.extensions["exdiary_ctx"].shutdown()


def test_config_write_failure_keeps_disk_and_live_settings(server, monkeypatch):
    manager = server.extensions["config_manager"]
    before = manager.settings_path.read_bytes()
    previous = manager.view["LLM_AGENT_MODEL"]
    def fail(*args):
        raise OSError("replace fixture")
    monkeypatch.setattr("lib.config.os.replace", fail)
    with pytest.raises(OSError):
        manager.save({"LLM_AGENT_MODEL": "uncommitted"})
    assert manager.settings_path.read_bytes() == before
    assert manager.view["LLM_AGENT_MODEL"] == manager.settings.LLM_AGENT_MODEL == previous


def test_main_chat_and_stream_persist_on_server_and_survive_restart(server, monkeypatch):
    from lib.llm import LLMResponse, StreamEvent
    class Model:
        def chat(self, **kwargs):
            return LLMResponse(content="server reply")

        def chat_stream(self, **kwargs):
            yield StreamEvent(type="text", content="stream reply")
            yield StreamEvent(type="done", finished=LLMResponse(content="stream reply"))
            return LLMResponse(content="stream reply")
    monkeypatch.setattr("app._configured_llm", lambda *args: Model())
    client = client_for(server)
    response = client.post("/api/agent/message", json={"message": "first request", "state": {"history": [{"role": "user", "content": "forged"}]}})
    assert response.status_code == 200 and response.json["message"] == "server reply"
    response = client.post("/api/agent/message/stream", json={"message": "second request"}, buffered=True)
    assert response.status_code == 200 and "stream reply" in response.get_data(as_text=True)
    assert '"event": "error"' not in response.get_data(as_text=True)
    response.close()
    history = client.get("/api/agent/history").json["history"]
    assert [message["content"] for message in history if message["role"] == "user"] == ["first request", "second request"]
    server.extensions["exdiary_ctx"].shutdown()
    restarted = create_app({"DATA_DIR": server.config["DATA_DIR"], "TESTING": True})
    try:
        restored = client_for(restarted).get("/api/agent/history").json["history"]
        assert restored == history
    finally:
        restarted.extensions["exdiary_ctx"].shutdown()


def test_create_admin_and_disabled_registration_are_server_controlled(tmp_path):
    app = create_app({"DATA_DIR": tmp_path, "TESTING": True, "ALLOW_REGISTRATION": False})
    try:
        result = app.test_cli_runner().invoke(args=["create-user", "--account", "operator", "--email", "operator@example.test", "--admin"], input=PASSWORD + "\n" + PASSWORD + "\n")
        assert result.exit_code == 0, result.output
        client = client_for(app, "operator")
        assert client.get("/api/bootstrap").json["can_configure"]
        assert client.post("/api/e2ee/register", json={"account": "public", "email": "public@example.test", "password": PASSWORD}).status_code == 403
    finally:
        app.extensions["exdiary_ctx"].shutdown()


def test_trusted_https_proxy_preserves_same_origin_and_secure_cookie(tmp_path):
    app = create_app({"DATA_DIR": tmp_path, "TESTING": True, "TRUSTED_PROXY_HOPS": 1})
    try:
        app.extensions["e2ee"].register("proxy-user", "proxy@example.test", PASSWORD)
        client = app.test_client()
        response = client.post("/api/e2ee/login", json={"account": "proxy-user", "password": PASSWORD},
                               headers={"Host": "lab.example.test", "Origin": "https://lab.example.test", "X-Forwarded-Proto": "https"})
        assert response.status_code == 200 and "Secure" in response.headers["Set-Cookie"]
    finally:
        app.extensions["exdiary_ctx"].shutdown()


def test_compression_archives_only_to_sqlite_and_keeps_originals_if_archive_fails(server):
    from lib.agent_v2 import AgentLoop
    class Model:
        def analyze(self, **kwargs):
            return "server summary"
    with account_context(server):
        server.preprocess_request()
        loop = AgentLoop(Model(), g.exp_repo, thread_store=g.thread_repo,
                         context_compression_trigger_tokens=10000, context_compression_chunk_tokens=7000)
        older, newer = {"role": "user", "content": "旧" * 9000}, {"role": "assistant", "content": "新" * 3000}
        loop.history = [older, newer]
        loop._save_runtime_state()
        assert loop.history == [newer]
        assert g.thread_repo.list_compressed_history(loop.session_id) == [older]
        assert not hasattr(loop, "_cold_store_path")
        assert not (server.config["DATA_DIR"] / "experiments" / "_history").exists()
        failed = AgentLoop(Model(), g.exp_repo, thread_store=SimpleNamespace(),
                           context_compression_trigger_tokens=10000, context_compression_chunk_tokens=7000)
        failed.history = [older, newer]
        failed._maybe_summarize()
        assert failed.history == [older, newer]
