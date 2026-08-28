"""Exdiary v2 加密实现包。

纯算法/安全状态机层（无真实网络/KMS/邮件）。
模块：crypto(原语) / keystore(keyring+统一快照) / grants(双授权) / kms(接口+模拟) /
      service(改密忘密原子事务) / recovery(邮箱找回) / blobstore(blob 原子写) / journal(灾备)。
"""

# --- 密码学原语 ---
from lib.e2ee.crypto import (  # noqa: F401
    BlobHeader,
    EnvelopeError,
    KDF_PARAMS,
    NonceBudget,
    canonical_aad,
    canonical_blob_aad,
    create_password_envelope,
    decrypt_blob,
    derive_key,
    encrypt_blob,
    generate_dek,
    generate_salt,
    normalize_password,
    open_password_envelope,
)

# --- 账号/恢复/同步/灾备 ---
from lib.e2ee.recovery import MailSender, RecordingMailSender, RecoveryService  # noqa: F401
from lib.e2ee.kms import MemoryRecoveryKMS, RecoveryKMS  # noqa: F401
from lib.e2ee.grants import GrantError, SensitiveGrantStore  # noqa: F401
from lib.e2ee.keystore import KeyringStore, SecurityConflict, SecuritySnapshot  # noqa: F401
from lib.e2ee.service import AccountSecurityService  # noqa: F401
from lib.e2ee.blobstore import BlobConflict, BlobStore, Incoming  # noqa: F401
from lib.e2ee.journal import SecurityHead, SecurityJournal  # noqa: F401
