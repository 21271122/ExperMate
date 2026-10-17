"""离线库显式导入：完整性、备份、回滚、幂等与账号边界。"""
import hashlib
import sqlite3

import pytest
from flask import g

from app import create_app
from lib.workspace_import import import_workspace


@pytest.fixture
def workspaces(tmp_path):
    source = create_app({"DATA_DIR": tmp_path / "old", "TESTING": True})
    target = create_app({"DATA_DIR": tmp_path / "server", "TESTING": True})
    with source.test_request_context("/"):
        source.preprocess_request()
        g.user_id = ""
        meta = g.attachment_store.put(b"fixture attachment", name="result.txt", mime="text/plain")
        g.exp_repo.save({"id": "2026-TEST-003", "title": "import fixture", "attachments": [meta], "references": ["2026-TEST-004"]})
        g.exp_repo.save({"id": "2026-TEST-004", "title": "reference fixture"})
        g.analysis_repo.save({"id": "ANAL-2026-TEST-001", "selected_ids": ["2026-TEST-003"], "analysis": "report"})
        g.thread_repo.save({"id": "TH1", "title": "thread", "exp_generated": "2026-TEST-003", "messages": [{"role": "user", "content": "old dialogue"}]})
        g.thread_repo.save_current_state({"history": [{"role": "user", "content": "main history"}], "thread_id": "TH1"})
        g.thread_repo.save_child_state("TH1", {"history": [{"role": "assistant", "content": "child history"}]})
        g.thread_repo.archive_compressed_history("SESSION1", 0, [{"role": "user", "content": "archive keyword"}])
        g.favorites_repo.create_collection("collection")
        g.favorites_repo.toggle_pin("2026-TEST-003")
    target_db = target.extensions["exdiary_ctx"].connections[0]._conn
    source_db = source.config["DATABASE_PATH"]
    yield source, target, source_db, target_db, tmp_path / "backups", meta
    source.extensions["exdiary_ctx"].shutdown()
    target.extensions["exdiary_ctx"].shutdown()


def test_import_preserves_records_links_attachments_sessions_and_search(workspaces):
    source, target, path, db, backups, meta = workspaces
    before = hashlib.sha256(path.read_bytes()).hexdigest()
    result = import_workspace(path, db, "owner", backups)
    assert result["counts"]["experiments"] == 2
    from pathlib import Path
    backup = Path(result["backup"])
    assert all((backup / name).exists() for name in ("source.db", "target-before.db", "manifest.json"))
    assert hashlib.sha256(path.read_bytes()).hexdigest() == before
    with target.test_request_context("/"):
        target.preprocess_request()
        g.user_id = "owner"
        assert g.exp_repo.load("2026-TEST-003")["references"] == ["2026-TEST-004"]
        assert g.attachment_store.get(meta["sha256"]) == b"fixture attachment"
        assert g.thread_repo.get_index()["exp_to_thread"]["2026-TEST-003"] == "TH1"
        assert g.thread_repo.load_current_state()["history"][0]["content"] == "main history"
        assert g.thread_repo.load_child_state("TH1")["history"][0]["content"] == "child history"
        assert g.thread_repo.search_chat_history("keyword")
        assert g.analysis_repo.load("ANAL-2026-TEST-001")["selected_ids"] == ["2026-TEST-003"]
        g.exp_repo.device_code = "TEST"
        assert g.exp_repo.next_id() == "2026-TEST-005"
        g.user_id = "other"
        assert g.exp_repo.load("2026-TEST-003") is None
        assert not g.thread_repo.get_index()["threads"]
        assert g.attachment_store.get(meta["sha256"]) is None
    assert import_workspace(path, db, "owner", backups)["already_imported"]


def test_occupied_target_and_cross_account_id_collision_never_overwrite(workspaces):
    _, target, path, db, backups, _ = workspaces
    db.execute("INSERT INTO experiments(user_id,id,title) VALUES('existing','2026-TEST-003','preserved')")
    with pytest.raises(sqlite3.IntegrityError):
        import_workspace(path, db, "owner", backups)
    assert db.execute("SELECT COUNT(*) FROM experiments WHERE user_id='owner'").fetchone()[0] == 0
    assert db.execute("SELECT title FROM experiments WHERE user_id='existing'").fetchone()[0] == "preserved"
    with pytest.raises(ValueError, match="已有数据"):
        import_workspace(path, db, "existing", backups)


def test_corrupt_or_missing_attachment_refuses_before_any_target_write(workspaces):
    source, _, path, db, backups, _ = workspaces
    old = source.extensions["exdiary_ctx"].connections[0]
    old.execute("UPDATE attachments SET data=?", (b"corrupted",))
    with pytest.raises(ValueError, match="SHA256"):
        import_workspace(path, db, "owner", backups)
    assert db.execute("SELECT COUNT(*) FROM experiments").fetchone()[0] == 0


def test_legacy_images_require_explicit_root_and_become_scoped_db_attachments(workspaces, tmp_path):
    source, target, path, db, backups, _ = workspaces
    old = source.extensions["exdiary_ctx"].connections[0]
    old.execute("UPDATE experiments SET original_notes=? WHERE id='2026-TEST-003'", ('<img src="/uploads/_draft/photo.png">',))
    with pytest.raises(ValueError, match="uploads-dir"):
        import_workspace(path, db, "owner", backups)
    uploads = tmp_path / "uploads"
    (uploads / "_draft").mkdir(parents=True)
    (uploads / "_draft/photo.png").write_bytes(b"legacy fixture")
    result = import_workspace(path, db, "owner", backups, uploads_dir=uploads)
    assert result["legacy_images"] == 1
    sha = db.execute("SELECT sha256 FROM legacy_uploads WHERE user_id='owner'").fetchone()[0]
    assert db.execute("SELECT data FROM attachments WHERE user_id='owner' AND sha256=?", (sha,)).fetchone()[0] == b"legacy fixture"
    assert db.execute("SELECT COUNT(*) FROM attachments WHERE user_id='other'").fetchone()[0] == 0


def test_legacy_image_cannot_escape_operator_selected_directory(workspaces, tmp_path):
    source, _, path, db, backups, _ = workspaces
    source.extensions["exdiary_ctx"].connections[0].execute("UPDATE experiments SET original_notes=?", ('<img src="/uploads/../private.png">',))
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    (tmp_path / "private.png").write_bytes(b"private")
    with pytest.raises(ValueError, match="超出"):
        import_workspace(path, db, "owner", backups, uploads_dir=uploads)
    assert db.execute("SELECT COUNT(*) FROM experiments").fetchone()[0] == 0


def test_old_sync_metadata_is_ignored_without_losing_attachment_content(workspaces):
    source, _, path, db, backups, meta = workspaces
    old = source.extensions["exdiary_ctx"].connections[0]
    old.execute("ALTER TABLE attachments ADD COLUMN sync_state TEXT DEFAULT 'pending'")
    old.execute("ALTER TABLE attachments ADD COLUMN synced_at TEXT DEFAULT ''")
    import_workspace(path, db, "owner", backups)
    assert db.execute("SELECT data FROM attachments WHERE user_id='owner' AND sha256=?", (meta["sha256"],)).fetchone()[0] == b"fixture attachment"
