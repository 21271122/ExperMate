"""Exdiary v2 — 真·云中继服务器（HTTP）。

中继是 **data-blind** 的加密 blob 储物柜——
它只存不透明的 `packed = AuthenticatedCleartextHeader || ciphertext` 字节，看不到明文；
UUID 仅标识不授权；blob 名用无意义 UUID（不放可读标题/日期）。

服务端按 §12 做 **revision CAS 写**：
- 从 packed 前缀严格解析 BlobHeader（校验 magic/版本），取其 `blob_revision`；
- 仅当"新 revision > 已存 revision"或不存在时才落库；否则 409 REVISION_CONFLICT，
  防止旧设备用旧 revision 覆盖新内容（stale-device 写规则的服务端兜底）。
- DELETE 写 **tombstone**（不物理删），离线设备不会把已删对象"复活"。

持久化：单文件 SQLite（relay.db）。鉴权：每账号一个 account_key（服务端只存哈希）。
"""

from __future__ import annotations

import base64
import hashlib
import os
import queue
import secrets
import sqlite3
from pathlib import Path

from flask import Flask, Response, jsonify, request, stream_with_context

from lib.e2ee.crypto import BlobHeader, EnvelopeError

DEFAULT_DB = Path(os.environ.get("RELAY_DB", str(Path(__file__).parent / "relay.db")))


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _new_conn(db_path: Path | str) -> sqlite3.Connection:
    # Flask/Werkzeug 多线程处理请求，连接需允许跨线程使用
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS account (
            account_id     TEXT PRIMARY KEY,
            account_key_sha TEXT NOT NULL,
            current_key_version INTEGER NOT NULL DEFAULT 1,  -- §12: 中继跟踪当前 key_version，供 STALE_KEY_VERSION 校验
            created_at     TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS blob (
            account_id      TEXT NOT NULL,
            blob_uuid       TEXT NOT NULL,
            current_revision INTEGER NOT NULL,
            deleted         INTEGER NOT NULL DEFAULT 0,   -- tombstone
            packed          BLOB,
            updated_at      TEXT DEFAULT '',
            PRIMARY KEY (account_id, blob_uuid)
        );
        """
    )
    conn.commit()
    # 旧库迁移：account 无 current_key_version 列时补上（默认 1；新库建表已含该列）
    _acc_cols = [r[1] for r in conn.execute("PRAGMA table_info(account)")]
    if "current_key_version" not in _acc_cols:
        conn.execute("ALTER TABLE account ADD COLUMN current_key_version INTEGER NOT NULL DEFAULT 1")
        conn.commit()
    return conn


def create_app(db_path: Path | str = DEFAULT_DB) -> Flask:
    app = Flask(__name__)
    _conn = _new_conn(db_path)
    app.config["RELAY_CONN"] = _conn

    def _get_conn() -> sqlite3.Connection:
        return _conn

    def _authorize(account_id: str) -> bool:
        key = request.headers.get("X-Account-Key", "")
        if not account_id or not key:
            return False
        row = _get_conn().execute(
            "SELECT account_key_sha FROM account WHERE account_id=?", (account_id,)
        ).fetchone()
        if row is None:
            return False
        return secrets.compare_digest(row["account_key_sha"], _sha256_hex(key.encode()))

    # ---- SSE 实时通知：account -> 该账号所有在线 watch 队列 ----
    _watchers: dict[str, list[queue.Queue]] = {}

    def _notify(account_id: str) -> None:
        for q in list(_watchers.get(account_id, [])):
            try:
                q.put_nowait("sync")
            except queue.Full:
                pass

    @app.get("/api/relay/<account_id>/watch")
    def watch(account_id: str):
        """SSE：有新 blob 写入/删除时通知该账号的在线客户端立即拉取（实时 A->B）。"""
        if not _authorize(account_id):
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        q: queue.Queue = queue.Queue(maxsize=10)
        _watchers.setdefault(account_id, []).append(q)

        def stream():
            try:
                while True:
                    try:
                        msg = q.get(timeout=30)  # 30 秒心跳
                        yield f"event: {msg}\ndata: \n\n"
                    except queue.Empty:
                        yield "event: ping\ndata: \n\n"
            except GeneratorExit:
                pass
            finally:
                ws = _watchers.get(account_id, [])
                if q in ws:
                    ws.remove(q)

        return Response(
            stream_with_context(stream()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    @app.get("/health")
    def health():
        return jsonify({"ok": True, "db": str(db_path)})

    @app.post("/api/relay/account")
    def register_account():
        """注册/重置账号密钥（幂等）。body: {account_id, account_key}。"""
        data = request.get_json(force=True) or {}
        aid = (data.get("account_id") or "").strip()
        key = (data.get("account_key") or "").strip()
        if len(aid) < 3 or len(key) < 8:
            return jsonify({"ok": False, "error": "account_id/account_key 过短"}), 400
        conn = _get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO account (account_id, account_key_sha, created_at) "
            "VALUES (?,?,datetime('now'))",
            (aid, _sha256_hex(key.encode())),
        )
        conn.commit()
        return jsonify({"ok": True})

    @app.put("/api/relay/<account_id>/<blob_uuid>")
    def put_blob(account_id: str, blob_uuid: str):
        """上传一个 packed blob（data-blind）。仅接受基于当前 revision 的下一版本。"""
        if not _authorize(account_id):
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        raw = request.get_data(cache=False)
        if not raw:
            return jsonify({"ok": False, "error": "空 body"}), 400
        try:
            header = BlobHeader.from_bytes(raw)  # 仅读明文头做严格校验 + 取 revision/key_version
        except EnvelopeError as e:
            return jsonify({"ok": False, "error": f"bad_header: {e}"}), 400
        conn = _get_conn()
        # §12：current-key 检查 —— 只有写 key_version == 当前 current_key_version 才可写
        acc = conn.execute(
            "SELECT current_key_version FROM account WHERE account_id=?", (account_id,)
        ).fetchone()
        if acc is None:
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        _current_kv = int(acc["current_key_version"])
        if header.key_version != _current_kv:
            return jsonify(
                {"ok": False, "error": "STALE_KEY_VERSION",
                 "current_key_version": _current_kv}
            ), 409
        expected_raw = request.headers.get("X-Expected-Revision")
        if expected_raw is None:
            return jsonify({"ok": False, "error": "MISSING_EXPECTED_REVISION"}), 409
        try:
            expected_revision = None if expected_raw == "-1" else int(expected_raw)
        except ValueError:
            return jsonify({"ok": False, "error": "BAD_EXPECTED_REVISION"}), 400
        if expected_revision is not None and expected_revision < 0:
            return jsonify({"ok": False, "error": "BAD_EXPECTED_REVISION"}), 400
        incoming_rev = header.blob_revision
        row = conn.execute(
            "SELECT current_revision FROM blob WHERE account_id=? AND blob_uuid=?",
            (account_id, blob_uuid),
        ).fetchone()
        if row is None:
            if expected_revision is not None or incoming_rev != 1:
                return jsonify({"ok": False, "error": "REVISION_CONFLICT",
                                "current_revision": None}), 409
        elif (expected_revision != row["current_revision"]
              or incoming_rev != row["current_revision"] + 1):
            return jsonify(
                {"ok": False, "error": "REVISION_CONFLICT",
                 "current_revision": row["current_revision"]}
            ), 409
        conn.execute(
            "INSERT INTO blob (account_id, blob_uuid, current_revision, deleted, packed, updated_at) "
            "VALUES (?,?,?,0,?,datetime('now')) "
            "ON CONFLICT(account_id, blob_uuid) DO UPDATE SET "
            " current_revision=excluded.current_revision, deleted=0, packed=excluded.packed, "
            " updated_at=excluded.updated_at",
            (account_id, blob_uuid, incoming_rev, raw),
        )
        conn.commit()
        _notify(account_id)
        return jsonify({"ok": True, "revision": incoming_rev})

    @app.get("/api/relay/<account_id>")
    def get_all(account_id: str):
        """全量拉取该账号所有未删除的 packed blob。"""
        if not _authorize(account_id):
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        rows = _get_conn().execute(
            "SELECT blob_uuid, current_revision, packed FROM blob "
            "WHERE account_id=? AND deleted=0 ORDER BY blob_uuid",
            (account_id,),
        ).fetchall()
        blobs = [
            {"uuid": r["blob_uuid"], "revision": r["current_revision"],
             "packed_b64": base64.b64encode(bytes(r["packed"])).decode("ascii")}
            for r in rows
        ]
        return jsonify({"ok": True, "count": len(blobs), "blobs": blobs})

    @app.delete("/api/relay/<account_id>/<blob_uuid>")
    def delete_blob(account_id: str, blob_uuid: str):
        """写 tombstone（不物理删）：revision+1、deleted=1，从 all() 中消失。"""
        if not _authorize(account_id):
            return jsonify({"ok": False, "error": "unauthorized"}), 401
        conn = _get_conn()
        row = conn.execute(
            "SELECT current_revision FROM blob WHERE account_id=? AND blob_uuid=?",
            (account_id, blob_uuid),
        ).fetchone()
        if row is None:
            return jsonify({"ok": True, "deleted": False})  # 不存在视为已删
        exp_raw = request.args.get("expected_revision")
        if exp_raw is None:
            return jsonify(
                {"ok": False, "error": "missing expected_revision",
                 "current_revision": row["current_revision"]}
            ), 409
        try:
            expected_revision = int(exp_raw)
        except ValueError:
            return jsonify({"ok": False, "error": "bad expected_revision"}), 400
        cur = conn.execute(
            "UPDATE blob SET deleted=1, current_revision=current_revision+1, "
            "packed=NULL, updated_at=datetime('now') "
            "WHERE account_id=? AND blob_uuid=? AND current_revision=?",
            (account_id, blob_uuid, expected_revision),
        )
        if cur.rowcount == 0:
            return jsonify(
                {"ok": False, "error": "REVISION_CONFLICT",
                 "current_revision": row["current_revision"]}
            ), 409
        conn.commit()
        _notify(account_id)
        return jsonify({"ok": True, "deleted": True, "revision": row["current_revision"] + 1})

    return app


if __name__ == "__main__":
    _app = create_app()
    _app.run(host="0.0.0.0", port=int(os.environ.get("RELAY_PORT", "5055")), threaded=True, debug=True)
