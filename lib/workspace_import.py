"""停服维护时，将一个旧 SQLite 作用域导入空账号；源库始终只读。"""
import hashlib
import json
import mimetypes
import re
import sqlite3
import uuid
from contextlib import closing
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote

TABLES = (
    "experiments", "analyses", "favorites", "favorite_collections", "favorite_category_pins",
    "threads", "kv_store", "compressed_history", "update_logs", "attachments", "music_tracks",
    "music_playback", "legacy_uploads",
)


def _columns(db, table):
    return [row[1] for row in db.execute(f'PRAGMA table_info("{table}")')]


def _text_values(value):
    if not isinstance(value, str):
        return
    try:
        parsed = json.loads(value)
    except (ValueError, TypeError):
        parsed = None
    if isinstance(parsed, (dict, list)):
        for item in (parsed.values() if isinstance(parsed, dict) else parsed):
            if isinstance(item, (dict, list)):
                yield from _text_values(json.dumps(item, ensure_ascii=False))
            else:
                yield from _text_values(item)
    else:
        yield value


def import_workspace(source, target, account, backup_dir, *, source_user="", uploads_dir=None):
    """返回备份和计数；拒绝覆盖、跨账号 ID 碰撞、缺失附件及重复的不同数据导入。

    调用者须停掉业务服务并验证目标账号存在。target 是已完成建表的原生连接。
    SQLite backup 读取 WAL 中的已提交数据，备份成功后才执行一个导入事务。
    """
    source = Path(source).resolve(strict=True)
    target_path = Path(target.execute("PRAGMA database_list").fetchone()[2]).resolve()
    if source == target_path:
        raise ValueError("源库不能是目标库")
    backup_root = Path(backup_dir).resolve()
    backup = backup_root / (datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8])
    backup.mkdir(parents=True)
    snapshot = backup / "source.db"
    with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as original:
        with closing(sqlite3.connect(snapshot)) as destination:
            original.backup(destination)
    records, images = {}, {}
    digest = hashlib.sha256()
    with closing(sqlite3.connect(snapshot)) as old:
        old.row_factory = sqlite3.Row
        if old.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("源库完整性检查失败")
        if not _columns(old, "experiments"):
            raise ValueError("源库没有实验表；仅支持 SQLite 工作区")
        for table in TABLES:
            columns = _columns(old, table)
            if not columns:
                continue
            rows = old.execute(f'SELECT * FROM "{table}" WHERE user_id=?', (source_user,)).fetchall() if "user_id" in columns else old.execute(f'SELECT * FROM "{table}"').fetchall()
            records[table] = [dict(row) for row in rows]
            for row in records[table]:
                if table == "attachments":
                    content = row.get("data")
                    if content is None or hashlib.sha256(content).hexdigest() != row["sha256"]:
                        raise ValueError("源库附件缺失或 SHA256 校验失败")
                for value in row.values():
                    for text in _text_values(value):
                        for name in re.findall(r'/uploads/([^\s"\'<>]+)', text):
                            name = unquote(name.rstrip(")"))
                            if not uploads_dir:
                                raise ValueError("旧图片引用需要 --uploads-dir；未写入目标库")
                            root = Path(uploads_dir).resolve(strict=True)
                            path = (root / name).resolve(strict=True)
                            if not path.is_relative_to(root) or not path.is_file():
                                raise ValueError("旧图片路径超出指定上传目录")
                            content = path.read_bytes()
                            mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                            if not mime.startswith("image/"):
                                raise ValueError("旧上传链接必须指向图片")
                            images[name] = (content, mime, path.name)
        known_attachments = {row["sha256"] for row in records.get("attachments", [])}
        if not any(records.values()):
            raise ValueError("指定源作用域没有可导入的数据")
        for row in records.get("experiments", []):
            for attachment in json.loads(row.get("attachments") or "[]"):
                if attachment.get("sha256") not in known_attachments:
                    raise ValueError("实验引用的附件在源库中缺失")
        # 按逻辑内容生成指纹，不依赖 SQLite 页布局或 WAL 文件时间。
        for table, rows in sorted(records.items()):
            serialized = [json.dumps(row, sort_keys=True, ensure_ascii=False, default=lambda value: {"blob": hashlib.sha256(value).hexdigest()}) for row in rows]
            digest.update(json.dumps([table, sorted(serialized)], ensure_ascii=False).encode())
        for name, (content, _, _) in sorted(images.items()):
            digest.update(name.encode() + hashlib.sha256(content).digest())
    fingerprint = digest.hexdigest()
    with closing(sqlite3.connect(backup / "target-before.db")) as destination:
        target.backup(destination)
    target.execute("CREATE TABLE IF NOT EXISTS workspace_imports (account TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, manifest TEXT NOT NULL)")
    previous = target.execute("SELECT fingerprint,manifest FROM workspace_imports WHERE account=?", (account,)).fetchone()
    if previous and previous[0] == fingerprint:
        return {**json.loads(previous[1]), "already_imported": True}
    for table in TABLES:
        if _columns(target, table) and target.execute(f'SELECT 1 FROM "{table}" WHERE user_id=? LIMIT 1', (account,)).fetchone():
            raise ValueError("目标账号已有数据；拒绝合并或覆盖，请使用空账号")
    counts = {table: len(rows) for table, rows in records.items()}
    manifest = {"account": account, "source_user": source_user, "fingerprint": fingerprint,
                "counts": counts, "legacy_images": len(images), "backup": str(backup)}
    try:
        target.execute("BEGIN IMMEDIATE")
        for table, rows in records.items():
            allowed = set(_columns(target, table))
            for row in rows:
                if table == "attachments":
                    # 旧库同步标记已退役；附件本体和账号归属仍完整导入。
                    row.pop("sync_state", None)
                    row.pop("synced_at", None)
                unknown = set(row) - allowed
                if unknown:
                    raise ValueError(f"源表 {table} 存在不支持的字段：{sorted(unknown)}")
                row["user_id"] = account
                keys = list(row)
                columns = ",".join('"' + key + '"' for key in keys)
                placeholders = ",".join("?" for _ in keys)
                target.execute(f'INSERT INTO "{table}" ({columns}) VALUES ({placeholders})', [row[key] for key in keys])
                if table in ("experiments", "analyses"):
                    match = re.fullmatch(r"(?:ANAL-)?(\d{4})-([A-Z0-9]{4})-(\d+)", row["id"])
                    if match:
                        year, device, number = match.groups()
                        counter = "experiment_id_counters" if table == "experiments" else "analysis_id_counters"
                        target.execute(f'INSERT INTO {counter}(year,device_code,next_number) VALUES(?,?,?) ON CONFLICT(year,device_code) DO UPDATE SET next_number=MAX(next_number,excluded.next_number)', (year, device, int(number) + 1))
        for name, (content, mime, filename) in images.items():
            sha = hashlib.sha256(content).hexdigest()
            target.execute("INSERT OR IGNORE INTO attachments(user_id,sha256,size,mime,name,data) VALUES(?,?,?,?,?,?)", (account, sha, len(content), mime, filename, content))
            target.execute("INSERT OR REPLACE INTO legacy_uploads(user_id,path,sha256) VALUES(?,?,?)", (account, name, sha))
        target.execute("INSERT INTO experiments_fts(experiments_fts) VALUES('rebuild')")
        from lib.repositories.sqlite_thread import SqliteThreadRepository
        for row in records.get("compressed_history", []):
            message = json.loads(row["payload"])
            if SqliteThreadRepository._is_visible_chat_message(message):
                target.execute("INSERT INTO chat_history_fts(user_id,session_id,sequence,role,created_at,content) VALUES(?,?,?,?,?,?)",
                               (account, row["session_id"], row["sequence"], message.get("role", ""), message.get("created_at", ""), SqliteThreadRepository._chat_text(message)))
        target.execute("INSERT INTO workspace_imports(account,fingerprint,manifest) VALUES(?,?,?)", (account, fingerprint, json.dumps(manifest, ensure_ascii=False)))
        target.commit()
    except Exception:
        target.rollback()
        raise
    (backup / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest
