"""Exdiary v2 — KMS 抽象与内存模拟（recovery envelope 生成/解密）。

恢复密钥管理服务接口：
- `RecoveryKMS` 抽象给真实云（AWS/GCP/Azure）KMS 一个接缝：
  `Encrypt(RecoveryKey, DEK, EncryptionContext)` → opaque CiphertextBlob；
  `Decrypt(CiphertextBlob, EncryptionContext)` → DEK。
- EncryptionContext 绑定 account_id + key_version + purpose="recovery"（防 envelope 替换）。

`MemoryRecoveryKMS` 用 AES-256-GCM + 一个本地派生密钥模拟同一语义，供本地测试/演示。
真实部署实现 `RecoveryKMS`（调云 KMS 并带 EncryptionContext 权限条件）即可替换。
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import Optional

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from lib.e2ee.crypto import _ALG  # 仅用于文档标记
from lib.e2ee.crypto import canonical_aad

_ENVELOPE_MAGIC = b"RK1"
_ENVELOPE_NONCE_LEN = 12


class RecoveryKMS(ABC):
    """用一个托管 KMS Recovery Key 加解密 DEK 的抽象。

    对应真实 `KMS.Encrypt(KeyId, Plaintext=DEK, EncryptionContext)` /
    `KMS.Decrypt(CiphertextBlob, EncryptionContext)`。
    """

    @abstractmethod
    def encrypt(self, dek: bytes, account_id: bytes, key_version: int) -> bytes:
        """用 KMS Recovery Key 生成 recovery envelope（CiphertextBlob）。"""

    @abstractmethod
    def decrypt(self, envelope: bytes, account_id: bytes, key_version: int) -> bytes:
        """解开 recovery envelope 还原 DEK。key/context 不符 → 抛异常。"""


class MemoryRecoveryKMS(RecoveryKMS):
    """内存模拟：AES-256-GCM + 本地密钥，context 绑 account/key_version/purpose。"""

    def __init__(self, key: bytes | None = None) -> None:
        self._aes = AESGCM(key if key is not None else os.urandom(32))

    def _context(self, account_id: bytes, key_version: int) -> bytes:
        # EncryptionContext 类比：绑定 account_id + key_version + purpose="recovery"
        return canonical_aad(account_id, key_version, "recovery", "memory-kms", 1)

    def encrypt(self, dek: bytes, account_id: bytes, key_version: int) -> bytes:
        if len(dek) != 32:
            raise ValueError("DEK 必须是 32 字节")
        nonce = os.urandom(_ENVELOPE_NONCE_LEN)
        ct_tag = self._aes.encrypt(nonce, dek, self._context(account_id, key_version))
        return _ENVELOPE_MAGIC + nonce + ct_tag

    def decrypt(self, envelope: bytes, account_id: bytes, key_version: int) -> bytes:
        if len(envelope) <= len(_ENVELOPE_MAGIC) + _ENVELOPE_NONCE_LEN + 16:
            raise ValueError("recovery envelope 格式无效")
        if envelope[: len(_ENVELOPE_MAGIC)] != _ENVELOPE_MAGIC:
            raise ValueError("recovery envelope 魔法头不匹配")
        nonce = envelope[len(_ENVELOPE_MAGIC): len(_ENVELOPE_MAGIC) + _ENVELOPE_NONCE_LEN]
        ct_tag = envelope[len(_ENVELOPE_MAGIC) + _ENVELOPE_NONCE_LEN:]
        try:
            return self._aes.decrypt(nonce, ct_tag, self._context(account_id, key_version))
        except Exception as e:
            raise ValueError("recovery 解密失败：KMS key 或 EncryptionContext 不匹配") from e
