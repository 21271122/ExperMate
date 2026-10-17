"""旧图片 URL 只解析迁移后的账号附件映射，不访问本机目录。"""
from io import BytesIO

from flask import Blueprint, abort, g, send_file

uploads_bp = Blueprint("uploads", __name__)


@uploads_bp.get("/uploads/<path:filepath>")
def serve_upload(filepath):
    row = g.exp_repo.db.execute("SELECT sha256 FROM legacy_uploads WHERE user_id=? AND path=?", (g.user_id, filepath)).fetchone()
    if row is None:
        abort(404)
    meta = g.attachment_store.meta(row["sha256"])
    content = g.attachment_store.get(row["sha256"])
    if not meta or content is None or not meta.get("mime", "").startswith("image/"):
        abort(404)
    return send_file(BytesIO(content), mimetype=meta["mime"])
