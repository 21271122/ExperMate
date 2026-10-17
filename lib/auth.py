"""服务端会话 JWT 签发与验证；账号口令由账号安全服务管理。"""

import os
import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from flask import current_app, has_app_context

_TOKEN_EXPIRE_HOURS: int = 24
SECRET_KEY: str = os.environ.get("JWT_SECRET") or secrets.token_urlsafe(32)


def create_token(user_id: str, epoch: int = 1) -> str:
    """签发 JWT。epoch 用于改密/恢复后吊销旧会话：旧 token 携带旧 epoch，校验时与
    Account.account_epoch 不符则失效（必须用新密码重新登录）。"""
    payload = {
        "user_id": user_id,
        "epoch": int(epoch),
        "exp": datetime.now(UTC) + timedelta(hours=_TOKEN_EXPIRE_HOURS),
        "iat": datetime.now(UTC),
    }
    key = current_app.config.get("JWT_SECRET", SECRET_KEY) if has_app_context() else SECRET_KEY
    return jwt.encode(payload, key, algorithm="HS256")


def decode_token(token: str) -> dict[str, Any]:
    key = current_app.config.get("JWT_SECRET", SECRET_KEY) if has_app_context() else SECRET_KEY
    return jwt.decode(token, key, algorithms=["HS256"])
