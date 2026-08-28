"""Exdiary v2 端到端加密实现。

端到端加密同步的密码学原语层。
本包只承载 **纯算法**（无数据库、无网络、无 KMS），可独立单元测试：
  密码 NFC 归一化 → Argon2id 派生 → AES-256-GCM envelope → canonical AAD → blob 加解密。

设计要点（与架构文档保持一致）：
- password_bytes = UTF8(NFC(password))，客户端/服务器两端必须一致。
- 认证哈希与加密 KEK 用**独立盐**派生（用途隔离），参数各自 ≥ floor。
- envelope 用 AES-256-GCM；每次加密用全新随机 nonce。
- AAD 用长度前缀(uint16) canonical 编码，禁止手写 `a + "|" + b`。
- blob 的 AAD 覆盖 AuthenticatedCleartextHeader 全部字段 + account_id + blob_uuid。
"""

from __future__ import annotations

import os
import unicodedata
from dataclasses import dataclass
from typing import Sequence

from argon2.low_level import Type as Argon2Type
from argon2.low_level import hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

__all__ = [
    "KDF_PARAMS",
    "normalize_password",
    "generate_salt",
    "generate_dek",
    "derive_key",
    "canonical_aad",
    "create_password_envelope",
    "open_password_envelope",
    "BlobHeader",
    "header_to_bytes",
    "header_from_bytes",
    "canonical_blob_aad",
    "encrypt_blob",
    "decrypt_blob",
    "NonceBudget",
    "EnvelopeError",
]

# ---------------------------------------------------------------------------
# 常量与 KDF 参数
# ---------------------------------------------------------------------------

# AES-256-GCM
_ALG = "AES-256-GCM"

# 默认 Argon2id 参数（KiB 单位）。架构文档推荐桌面目标值 64MiB/t=3/p=1。
# 认证与加密可独立微调，但都必须 ≥ 统一 floor（见 _MIN*）。
DEFAULT_KDF = {
    "type": "Argon2id",
    "memory_cost": 64 * 1024,     # 64 MiB（argon2 以 KiB 计）
    "time_cost": 3,
    "parallelism": 1,
    "hash_len": 32,
}
# 统一最低 offline-resistance floor（评审 1.3：两 KDF 取较便宜者，都要达标）
_MIN_MEMORY_COST = 19 * 1024      # 19 MiB
_MIN_TIME_COST = 2

KDF_PARAMS = dict(DEFAULT_KDF)


def _validate_params(params: dict) -> None:
    if params.get("memory_cost", 0) < _MIN_MEMORY_COST:
        raise ValueError(f"KDF memory_cost 低于统一 floor ({_MIN_MEMORY_COST} KiB)")
    if params.get("time_cost", 0) < _MIN_TIME_COST:
        raise ValueError(f"KDF time_cost 低于统一 floor ({_MIN_TIME_COST})")


# ---------------------------------------------------------------------------
# 基础原语
# ---------------------------------------------------------------------------


def normalize_password(password: str) -> bytes:
    """password_bytes = UTF8(NFC(password))。两端的唯一输入形式。"""
    return unicodedata.normalize("NFC", password).encode("utf-8")


def generate_salt(length: int = 16) -> bytes:
    """密码学安全随机盐（≥16 B 满足 RFC 9106 建议）。"""
    if length < 16:
        raise ValueError("salt 至少 16 字节")
    return os.urandom(length)


def generate_dek() -> bytes:
    """真随机数据钥匙 DEK（32 字节 · 256-bit）。"""
    return os.urandom(32)


def derive_key(
    password_bytes: bytes,
    salt: bytes,
    params: dict | None = None,
) -> bytes:
    """Argon2id 派生 32 字节钥匙（KEK 或认证哈希都用它，靠独立盐分离用途）。

    参数按架构文档可由 server 强制，但本层执行统一 floor 校验。
    """
    p = dict(DEFAULT_KDF if params is None else params)
    _validate_params(p)
    if len(salt) < 16:
        raise ValueError("salt 至少 16 字节")
    return hash_secret_raw(
        secret=password_bytes,
        salt=salt,
        time_cost=p["time_cost"],
        memory_cost=p["memory_cost"],
        parallelism=p["parallelism"],
        hash_len=p["hash_len"],
        type=Argon2Type.ID,
    )


# ---------------------------------------------------------------------------
# canonical AAD 编码
# ---------------------------------------------------------------------------


def canonical_aad(*fields: object) -> bytes:
    """类型安全 + 长度前缀 canonical 编码（防类型/转义/端序歧义）。

    每个字段 = 1 字节类型标签 + 2 字节长度(big-endian) + 内容。
    显式区分 bytes/str/int，避免 `int 1` 与 `str "1"` 被编码成相同字节
    （评审要求 canonical 编码不得有 type ambiguity）。不要用 `a + "|" + b`。
    """
    out = bytearray()
    for f in fields:
        if isinstance(f, bytes):
            tag, raw = b"b", f
        elif isinstance(f, bool):
            tag, raw = b"i", b"1" if f else b"0"
        elif isinstance(f, int):
            tag, raw = b"i", str(f).encode("ascii")
        elif isinstance(f, str):
            tag, raw = b"s", f.encode("utf-8")
        else:
            raise TypeError(f"canonical_aad 不支持类型: {type(f)!r}")
        if len(raw) > 0xFFFF:
            raise ValueError("AAD field 过长")
        out += bytes([tag[0]])
        out += len(raw).to_bytes(2, "big")
        out += raw
    return bytes(out)


# ---------------------------------------------------------------------------
# password envelope（AES-256-GCM 包裹 DEK）
# ---------------------------------------------------------------------------

_ENVELOPE_MAGIC = b"EXEN"      # exdiary envelope
_ENVELOPE_VERSION = 1
_ENVELOPE_ALG_GCM = 1
_ENVELOPE_NONCE_LEN = 12


class EnvelopeError(ValueError):
    """envelope 格式 / 认证失败。"""


def _envelope_aad(account_id: bytes, key_version: int, nonce: bytes) -> bytes:
    # 同一 KEK 包多个 DEK：nonce 也纳入 AAD，防 envelope 替换。
    return canonical_aad(account_id, key_version, "password", nonce)


def create_password_envelope(
    kek: bytes,
    dek: bytes,
    account_id: bytes,
    key_version: int,
    nonce: bytes | None = None,
) -> bytes:
    """AES-256-GCM 用 KEK 包裹 DEK → password envelope。

    二进制格式：magic(EXEN) | version(1) | alg(1) | nonce(12) | ct||tag。
    """
    if len(kek) != 32:
        raise ValueError("KEK 必须是 32 字节")
    if len(dek) != 32:
        raise ValueError("DEK 必须是 32 字节")
    if nonce is None:
        nonce = os.urandom(_ENVELOPE_NONCE_LEN)
    if len(nonce) != _ENVELOPE_NONCE_LEN:
        raise ValueError(f"nonce 必须是 {_ENVELOPE_NONCE_LEN} 字节")
    aad = _envelope_aad(account_id, key_version, nonce)
    ct_tag = AESGCM(kek).encrypt(nonce, dek, aad)
    return (
        _ENVELOPE_MAGIC
        + bytes([_ENVELOPE_VERSION, _ENVELOPE_ALG_GCM])
        + nonce
        + ct_tag
    )


def open_password_envelope(
    kek: bytes,
    envelope: bytes,
    account_id: bytes,
    key_version: int,
) -> bytes:
    """解开 password envelope，还原 DEK。AAD/密文被改 → 抛 EnvelopeError。"""
    if len(kek) != 32:
        raise ValueError("KEK 必须是 32 字节")
    if (
        len(envelope) < len(_ENVELOPE_MAGIC) + 2 + _ENVELOPE_NONCE_LEN + 16
        or envelope[: len(_ENVELOPE_MAGIC)] != _ENVELOPE_MAGIC
    ):
        raise EnvelopeError("envelope 格式无效")
    ver, alg = envelope[len(_ENVELOPE_MAGIC)], envelope[len(_ENVELOPE_MAGIC) + 1]
    if ver != _ENVELOPE_VERSION:
        raise EnvelopeError(f"unsupported envelope version: {ver}")
    if alg != _ENVELOPE_ALG_GCM:
        raise EnvelopeError(f"unsupported algorithm id: {alg}")
    body = envelope[len(_ENVELOPE_MAGIC) + 2:]
    nonce = body[: _ENVELOPE_NONCE_LEN]
    ct_tag = body[_ENVELOPE_NONCE_LEN:]
    aad = _envelope_aad(account_id, key_version, nonce)
    try:
        return AESGCM(kek).decrypt(nonce, ct_tag, aad)
    except Exception as e:  # InvalidTag 等
        raise EnvelopeError("envelope 认证失败（密钥错或数据被篡改）") from e


# ---------------------------------------------------------------------------
# blob：明文头 + AAD + AES-GCM
# ---------------------------------------------------------------------------

_BLOB_MAGIC = b"EXBL"
_BLOB_HEADER_VER = 1


@dataclass(frozen=True)
class BlobHeader:
    """AuthenticatedCleartextHeader：明文传输，且全部字段进入 AAD。

    crypto_format_version 用于锁死后续序列化/编码/密钥轮换规则（防 downgrade/歧义）。
    """

    crypto_format_version: int
    object_type: str
    schema_version: int
    key_version: int
    blob_revision: int
    nonce: bytes

    def to_bytes(self) -> bytes:
        # 明文字节：magic | hdrver | cform(1) | otype(打包) | schema(2) | key(2) | rev(4) | nonce(12)
        otype_b = self.object_type.encode("utf-8")
        if len(otype_b) > 0xFF:
            raise ValueError("object_type 过长")
        return (
            _BLOB_MAGIC
            + bytes([_BLOB_HEADER_VER, self.crypto_format_version])
            + bytes([len(otype_b)]) + otype_b
            + self.schema_version.to_bytes(2, "big")
            + self.key_version.to_bytes(2, "big")
            + self.blob_revision.to_bytes(4, "big")
            + self.nonce
        )

    @classmethod
    def from_bytes(cls, data: bytes) -> "BlobHeader":
        if len(data) < 4 + 2 + 1 + 12 + 4:
            raise EnvelopeError("blob header 过短")
        if data[:4] != _BLOB_MAGIC:
            raise EnvelopeError("bad blob header magic")
        hdr_ver = data[4]
        if hdr_ver != _BLOB_HEADER_VER:
            raise EnvelopeError(f"unsupported blob header version: {hdr_ver}")
        cform = data[5]
        olen = data[6]
        pos = 7
        otype = data[pos : pos + olen].decode("utf-8")
        pos += olen
        schema = int.from_bytes(data[pos : pos + 2], "big"); pos += 2
        keyver = int.from_bytes(data[pos : pos + 2], "big"); pos += 2
        rev = int.from_bytes(data[pos : pos + 4], "big"); pos += 4
        nonce = data[pos : pos + 12]
        return cls(cform, otype, schema, keyver, rev, nonce)

    def canonical_aad_fields(self) -> tuple[object, ...]:
        return (
            self.crypto_format_version,
            self.object_type,
            self.schema_version,
            self.key_version,
            self.blob_revision,
            self.nonce,
        )


def canonical_blob_aad(
    account_id: bytes,
    blob_uuid: bytes,
    header: BlobHeader,
) -> bytes:
    """blob AAD = canonical(account_id, blob_uuid, header 全字段)。"""
    return canonical_aad(account_id, blob_uuid, *header.canonical_aad_fields())


def _encrypt_gcm(key: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> bytes:
    return AESGCM(key).encrypt(nonce, plaintext, aad)


def _decrypt_gcm(key: bytes, nonce: bytes, data: bytes, aad: bytes) -> bytes:
    return AESGCM(key).decrypt(nonce, data, aad)


def encrypt_blob(
    dek: bytes,
    account_id: bytes,
    blob_uuid: bytes,
    header: BlobHeader,
    plaintext: bytes,
) -> bytes:
    """用 DEK 加密一条 blob：返回 ct||tag。AAD 来自 account_id+blob_uuid+header。"""
    if len(dek) != 32:
        raise ValueError("DEK 必须是 32 字节")
    aad = canonical_blob_aad(account_id, blob_uuid, header)
    return _encrypt_gcm(dek, header.nonce, plaintext, aad)


def decrypt_blob(
    dek: bytes,
    account_id: bytes,
    blob_uuid: bytes,
    header: BlobHeader,
    data: bytes,
) -> bytes:
    """用 DEK 解一条 blob。AAD/密文被改 → EnvelopeError。"""
    if len(dek) != 32:
        raise ValueError("DEK 必须是 32 字节")
    aad = canonical_blob_aad(account_id, blob_uuid, header)
    try:
        return _decrypt_gcm(dek, header.nonce, data, aad)
    except Exception as e:
        raise EnvelopeError("blob 认证失败（密钥错或数据被篡改）") from e


# ---------------------------------------------------------------------------
# 单 DEK nonce 预算（本地单实例）
# ---------------------------------------------------------------------------


class NonceBudget:
    """跟踪单 DEK 的加密次数，超上限即拒绝（防 (key, nonce) 复用）。

    注意：多设备共享同一 DEK 时，这是**所有设备总和**的预算；跨设备协调
    属于 crypto implementation spec（架构文档 12 节），本层只提供单实例哨兵。
    """

    def __init__(self, max_ops: int = 2**32) -> None:
        if max_ops <= 0:
            raise ValueError("max_ops 必须为正")
        self._max = max_ops
        self._count = 0

    @property
    def count(self) -> int:
        return self._count

    def reserve(self, n: int = 1) -> None:
        if self._count + n > self._max:
            raise EnvelopeError("单 DEK 加密次数超过安全上限，请轮换 DEK")
        self._count += n
