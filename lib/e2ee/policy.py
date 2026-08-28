"""Exdiary v2 — 账户策略（密码校验 + 邮箱归一化）。

产品决议（本轮采纳）：
- 密码：**至少 8 字符**，且**只允许字母、数字与一般标点符号**（ASCII 可打印）。
- 邮箱：canonical 比较（整体转小写），注册 / 找回 / 改邮箱一致应用，
  避免 User@Example.com 与 user@example.com 被判成不同身份。
"""

from __future__ import annotations

import string

# 允许的密码字符：ASCII 字母 + 数字 + 一般标点 + 空格
_PWD_ALLOWED = set(string.ascii_letters + string.digits + string.punctuation + " ")


def validate_password(password: str) -> tuple[bool, str]:
    """>=8 且仅限字母数字/一般标点。返回 (ok, reason)。"""
    if len(password) < 8:
        return False, "密码至少 8 个字符"
    bad = [c for c in password if c not in _PWD_ALLOWED]
    if bad:
        return False, "密码仅支持字母、数字与一般标点符号"
    return True, ""


def canonicalize_email(addr: str) -> str:
    """返回用于比较的邮箱 canonical 形式（整体转小写 + 去首尾空格）。"""
    return (addr or "").strip().lower()
