from flask import Blueprint, send_from_directory, g

uploads_bp = Blueprint("uploads", __name__)


@uploads_bp.route("/uploads/<path:filepath>")
def serve_upload(filepath):
    return send_from_directory(str(g.data_dir / "uploads"), filepath)
