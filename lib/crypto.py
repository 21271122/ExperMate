"""加密模块: 密钥派生 + SQLCipher 连接管理。"""

import hashlib
import sqlite3

# 优先用 SQLCipher，不可用时回退到标准 sqlite3
try:
    import sqlcipher3 as _sqlite_lib
    _HAS_CIPHER = True
except ImportError:
    import sqlite3 as _sqlite_lib  # type: ignore[no-redef]
    _HAS_CIPHER = False


def derive_key(raw: str) -> bytes:
    """从配置密钥派生 256-bit 加密密钥。确定性（相同输入→相同输出），不加 salt。"""
    return hashlib.sha256(raw.encode("utf-8")).digest()


def open_encrypted_db(db_path: str, key: bytes) -> sqlite3.Connection:
    """打开 SQLCipher 加密数据库。不可用时回退到普通 sqlite3。"""
    conn = _sqlite_lib.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    if _HAS_CIPHER:
        pragma_key = "x'" + key.hex() + "'"
        conn.execute(f"PRAGMA key = {pragma_key}")
        conn.execute("PRAGMA cipher_compatibility = 4")
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def open_plain_db(db_path: str) -> sqlite3.Connection:
    """打开非加密数据库（用于离线模式或开发环境）。"""
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def is_cipher_available() -> bool:
    return _HAS_CIPHER
