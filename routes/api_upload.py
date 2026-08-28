import uuid
from pathlib import Path
from flask import Blueprint, request, jsonify, g

api_upload_bp = Blueprint("api_upload", __name__)


@api_upload_bp.route("/upload-image", methods=["POST"])
def api_upload_image():
    exp_id = request.form.get("exp_id", "_draft")
    file = request.files.get("image")
    if not file:
        return jsonify({"ok": False, "error": "No image"}), 400

    upload_dir = g.data_dir / "uploads" / exp_id
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename).suffix if file.filename else ".png"
    if ext.lower() not in (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"):
        ext = ".png"
    filename = f"{uuid.uuid4().hex[:8]}{ext}"
    filepath = upload_dir / filename
    file.save(str(filepath))

    url = f"/uploads/{exp_id}/{filename}"
    return jsonify({"ok": True, "url": url})
