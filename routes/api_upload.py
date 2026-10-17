"""兼容旧图片上传 API；内容存入账号作用域的服务端附件仓储。"""
from flask import Blueprint, jsonify, request

from routes.api_attachment import store_uploaded_attachment

api_upload_bp = Blueprint("api_upload", __name__)


@api_upload_bp.post("/upload-image")
def api_upload_image():
    image = request.files.get("image")
    if not image or not (image.mimetype or "").startswith("image/"):
        return jsonify(ok=False, error="请选择图片"), 400
    try:
        meta = store_uploaded_attachment(image)
    except (ValueError, OverflowError) as error:
        return jsonify(ok=False, error=str(error)), 400
    return jsonify(ok=True, url="/api/attachments/" + meta["sha256"])
