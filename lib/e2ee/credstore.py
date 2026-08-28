"""Exdiary v2 — DEK 持久化到系统凭据库（Windows 凭据管理器）。

DEK 不落明文盘，存系统凭据库，
重启进程后凭合法 JWT 可免重登恢复 DEK（从而恢复网关/同步）。

后端选择：
- Windows：ctypes 调 advapi32 CredWriteW/CredReadW/CredDeleteW（零依赖，受本账户 DPAPI 保护）；
- 其它平台：降级为内存后端（不持久，重启即失，至少不阻塞）。

存储内容仅为加密数据钥匙 DEK（32B）；用户名不做区分，一律存于本机本账户。
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes   # 仅 Windows 使用
import os
from typing import Optional


class _FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", wintypes.DWORD), ("dwHighDateTime", wintypes.DWORD)]


class _CREDENTIAL(ctypes.Structure):
    pass


_CREDENTIAL._fields_ = [
    ("Flags", wintypes.DWORD),
    ("Type", wintypes.DWORD),
    ("TargetName", wintypes.LPWSTR),
    ("Comment", wintypes.LPWSTR),
    ("LastWritten", _FILETIME),
    ("CredentialBlobSize", wintypes.DWORD),
    ("CredentialBlob", ctypes.POINTER(ctypes.c_ubyte)),
    ("Persist", wintypes.DWORD),
    ("AttributeCount", wintypes.DWORD),
    ("Attributes", wintypes.LPVOID),
    ("TargetAlias", wintypes.LPWSTR),
    ("UserName", wintypes.LPWSTR),
]

_CRED_TYPE_GENERIC = 1
_CRED_PERSIST_LOCAL_MACHINE = 2
_ERROR_NOT_FOUND = 1168


def _target(account: str) -> str:
    return f"exdiary:dek:{account}"


class WinCredStore:
    """Windows 凭据管理器后端（advapi32.Cred*）。"""

    def __init__(self) -> None:
        self._adv = ctypes.WinDLL("advapi32")


    def set_dek(self, account: str, dek: bytes) -> bool:
        blob = bytes(dek)
        c = _CREDENTIAL()
        c.Type = _CRED_TYPE_GENERIC
        c.TargetName = _target(account)
        c.CredentialBlobSize = len(blob)
        buf = ctypes.create_string_buffer(blob, len(blob))
        c.CredentialBlob = ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte))
        c.Persist = _CRED_PERSIST_LOCAL_MACHINE
        return bool(self._adv.CredWriteW(ctypes.byref(c), 0))

    def get_dek(self, account: str) -> Optional[bytes]:
        pcred = ctypes.c_void_p()
        ok = self._adv.CredReadW(_target(account), _CRED_TYPE_GENERIC, 0, ctypes.byref(pcred))
        if not ok:
            return None
        try:
            cred = ctypes.cast(pcred, ctypes.POINTER(_CREDENTIAL)).contents
            n = int(cred.CredentialBlobSize)
            return bytes(ctypes.string_at(cred.CredentialBlob, n))
        finally:
            self._adv.CredFree(pcred)

    def delete_dek(self, account: str) -> bool:
        return bool(self._adv.CredDeleteW(_target(account), _CRED_TYPE_GENERIC, 0))

    def has_dek(self, account: str) -> bool:
        return self.get_dek(account) is not None


class MemoryStore:
    """非 Windows / 测试用：不持久，仅进程内。"""

    def __init__(self) -> None:
        self._m: dict[str, bytes] = {}

    def set_dek(self, account: str, dek: bytes) -> bool:
        self._m[account] = bytes(dek)
        return True

    def get_dek(self, account: str) -> Optional[bytes]:
        return self._m.get(account)

    def delete_dek(self, account: str) -> bool:
        return self._m.pop(account, None) is not None

    def has_dek(self, account: str) -> bool:
        return account in self._m


def _pick_backend() -> object:
    if os.environ.get("EXDIARY_CREDENTIAL_STORE", "").lower() == "memory":
        return MemoryStore()
    if os.name == "nt":
        try:
            return WinCredStore()
        except Exception:
            pass
    return MemoryStore()


def get_backend() -> object:
    return _store


_store = _pick_backend()


def set_dek(account: str, dek: bytes) -> bool:
    try:
        return bool(_store.set_dek(account, dek))
    except Exception:
        return False


def get_dek(account: str) -> Optional[bytes]:
    try:
        return _store.get_dek(account)
    except Exception:
        return None


def has_dek(account: str) -> bool:
    try:
        return _store.has_dek(account)
    except Exception:
        return False


def delete_dek(account: str) -> bool:
    try:
        return bool(_store.delete_dek(account))
    except Exception:
        return False
