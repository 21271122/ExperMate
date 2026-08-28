"""背景音乐库与当前播放状态 API。"""

from __future__ import annotations

from flask import Blueprint, g, jsonify, request

from lib.music import is_audio_attachment, library_for


api_music_bp = Blueprint("api_music", __name__)


def _library() -> list[dict]:
    return library_for(g.attachment_store)


@api_music_bp.get("/music/library")
def api_music_library():
    return jsonify({"ok": True, "tracks": _library(),
                    "playback": g.attachment_store.get_music_playback()})


@api_music_bp.post("/music/library")
def api_music_library_add():
    """将已上传的音频附件登记进当前账号的自定义曲库。"""
    if not g.user_id:
        return jsonify({"ok": False, "error": "请先登录"}), 401
    data = request.get_json(silent=True) or {}
    sha256 = str(data.get("sha256") or "").strip()
    meta = g.attachment_store.meta(sha256)
    if not meta:
        return jsonify({"ok": False, "error": "找不到该附件"}), 404
    if not is_audio_attachment(str(meta.get("name") or ""), str(meta.get("mime") or "")):
        return jsonify({"ok": False, "error": "该附件不是支持的音频文件"}), 400
    track = g.attachment_store.add_music_track(sha256, str(data.get("title") or ""))
    if not track:
        return jsonify({"ok": False, "error": "附件内容尚未下载到本机"}), 409
    return jsonify({"ok": True, "track": {
        "id": f"attachment:{track['sha256']}",
        "title": track.get("title") or track.get("name") or "未命名音频",
        "src": f"/api/attachments/{track['sha256']}", "source": "attachment",
    }})


@api_music_bp.post("/music/state")
def api_music_state():
    data = request.get_json(silent=True) or {}
    track_id = str(data.get("track_id") or "")
    track_ids = {track["id"] for track in _library()}
    if track_id and track_id not in track_ids:
        return jsonify({"ok": False, "error": "曲目不存在"}), 404
    state = g.attachment_store.set_music_playback(bool(data.get("playing")), track_id)
    return jsonify({"ok": True, "playback": state})
