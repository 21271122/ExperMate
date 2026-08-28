"""认证模块。JWT 签发/验证 + bcrypt 密码哈希 + require_auth 装饰器。"""

import functools
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

import bcrypt
import jwt
from flask import g, jsonify, request

_TOKEN_EXPIRE_HOURS: int = 24
SECRET_KEY: str = os.environ.get("JWT_SECRET", "")
if not SECRET_KEY:
    import warnings
    warnings.warn("JWT_SECRET 未设置，使用开发默认密钥。生产环境必须设置环境变量 JWT_SECRET。")
    SECRET_KEY = "exdiary-dev-secret-key-change-in-production"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user_id: str, epoch: int = 1) -> str:
    """签发 JWT。epoch 用于改密/恢复后吊销旧会话：旧 token 携带旧 epoch，校验时与
    Account.account_epoch 不符则失效（必须用新密码重新登录）。"""
    payload = {
        "user_id": user_id,
        "epoch": int(epoch),
        "exp": datetime.now(timezone.utc) + timedelta(hours=_TOKEN_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])


def require_auth(f: Callable[..., Any]) -> Callable[..., Any]:
    @functools.wraps(f)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"ok": False, "error": "请先登录"}), 401
        try:
            payload = decode_token(auth_header[7:])
            g.user_id = payload["user_id"]
        except jwt.ExpiredSignatureError:
            return jsonify({"ok": False, "error": "登录已过期，请重新登录"}), 401
        except jwt.InvalidTokenError:
            return jsonify({"ok": False, "error": "无效的登录凭证"}), 401
        return f(*args, **kwargs)
    return wrapper


def optional_auth(f: Callable[..., Any]) -> Callable[..., Any]:
    """可选认证：有 token 就解析，没有也不拒绝。用于离线模式兼容。"""
    @functools.wraps(f)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        g.user_id = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                payload = decode_token(auth_header[7:])
                g.user_id = payload["user_id"]
            except jwt.InvalidTokenError:
                pass
        return f(*args, **kwargs)
    return wrapper
