"""Exdiary v2 — 账号安全服务（改密/忘密的原子安全事务）。

改密、恢复与密钥状态服务：
- **change_password**（Authenticated mutation）：consumed `SensitiveActionGrant`(change_password)，
  用旧密码派生旧 KEK 解出全部 DEK，再用新密码重包全部 `password_envelope`，同时更新
  **认证层**（salt_auth+auth_hash）与 **加密层**（salt_kek），`generation++ / key_state++ / row_revision++`，
  全部在**一个 BEGIN IMMEDIATE 安全事务**内提交 —— 杜绝"新密码过不了认证 / 旧密码解不开数据"的锁死。
- **recover_password**（Recovery mutation，forgot-password）：consumed `RecoverySession`，
  **不需要旧密码**，用注入的 `RecoveryKMS` 解各 `recovery_envelope` 拿 DEK，再重包全部 envelope + 更新认证层。

`BEGIN IMMEDIATE` 写锁保证"同一事务内读到的快照(G/S/K)不会变化"，即统一事务快照。
"""

from __future__ import annotations

import json
import secrets
import sqlite3
from typing import Optional

from lib.e2ee.crypto import (
    DEFAULT_KDF,
    EnvelopeError,
    KDF_PARAMS,
    create_password_envelope,
    derive_key,
    generate_dek,
    generate_salt,
    normalize_password,
    open_password_envelope,
)
from lib.e2ee.grants import SensitiveGrantStore
from lib.e2ee.keystore import KeyringStore, SecuritySnapshot
from lib.e2ee.kms import RecoveryKMS


def _kek_params(metadata: Optional[str]) -> dict:
    if metadata:
        try:
            p = json.loads(metadata)
            return {"memory_cost": p["memory_cost"], "time_cost": p["time_cost"],
                    "parallelism": p["parallelism"], "hash_len": p.get("hash_len", 32)}
        except Exception:
            pass
    return {k: KDF_PARAMS[k] for k in ("memory_cost", "time_cost", "parallelism", "hash_len")}


def _meta(params: dict) -> str:
    return json.dumps({"memory_cost": params["memory_cost"], "time_cost": params["time_cost"],
                       "parallelism": params["parallelism"], "hash_len": params["hash_len"]})


class AccountSecurityService:
    def __init__(
        self,
        conn: sqlite3.Connection,
        keyring: KeyringStore,
        grants: SensitiveGrantStore,
        kms: RecoveryKMS,
    ) -> None:
        self.conn = conn
        self.keyring = keyring
        self.grants = grants
        self.kms = kms

    def snapshot(self, account_id: str) -> SecuritySnapshot:
        return self.keyring.snapshot(account_id)

    # ---- 内部：重包全部 DEK + 更新认证/加密层（调用方须已 BEGIN IMMEDIATE）----

    def _rewrap_with_new_credential(
        self,
        account_id: str,
        deks: dict[int, bytes],
        new_password: str,
        kek_params: dict,
    ) -> None:
        # 新加密层（沿用当前 credential 的 KEK 参数；刻意做 KEK 参数升级时另传新参数）
        new_salt_kek = generate_salt()
        new_kek = derive_key(normalize_password(new_password), new_salt_kek, kek_params)
        # 重包全部 DEK 并本地验证
        for kv, dek in deks.items():
            new_env = create_password_envelope(new_kek, dek, account_id.encode(), kv)
            # 本地验证：必须能用新 KEK 解回
            got = open_password_envelope(new_kek, new_env, account_id.encode(), kv)
            if got != dek:
                raise EnvelopeError("新 envelope 本地验证失败")
            self.conn.execute(
                "UPDATE account_key SET password_envelope=?, row_revision=row_revision+1 "
                "WHERE account_id=? AND key_version=? AND status!='destroyed'",
                (new_env, account_id, kv),
            )
        # 新认证层（server-trusted 模型下由服务器生成；本地 service 用新密码派生）
        new_salt_auth = generate_salt()
        new_auth_hash = derive_key(normalize_password(new_password), new_salt_auth, kek_params)
        # 认证层 + 加密层元数据 + generation/row_revision
        self.conn.execute(
            "UPDATE credential SET generation=generation+1, row_revision=row_revision+1, "
            "salt_kek=?, kek_kdf_metadata=?, salt_auth=?, auth_hash=?, auth_kdf_metadata=? "
            "WHERE account_id=?",
            (new_salt_kek, _meta(kek_params), new_salt_auth, new_auth_hash, _meta(kek_params), account_id),
        )
        # password-envelope 语义变化 → key_state_version++
        self.conn.execute(
            "UPDATE account SET key_state_version=key_state_version+1 WHERE account_id=?",
            (account_id,),
        )
        # 改密/恢复 = 会话撤销：account_epoch++ 使所有已签发 JWT 失效（须用新密码重新登录）
        self.conn.execute(
            "UPDATE account SET account_epoch=account_epoch+1 WHERE account_id=?",
            (account_id,),
        )

    def _load_nondestroyed_keys(self, account_id: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "SELECT key_version, password_envelope, recovery_envelope "
            "FROM account_key WHERE account_id=? AND status!='destroyed'",
            (account_id,),
        ).fetchall()

    # ---- 修改密码（Authenticated mutation） ----

    def change_password(self, account_id: str, grant_id: str, old_password: str, new_password: str) -> SecuritySnapshot:
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            # 1) 同一事务内原子消费 grant（single-use + purpose + epoch/generation 校验）
            self.grants.consume_grant(self.conn, grant_id, "change_password")
            # 2) 读一致快照（写锁内 → 最新）
            snap = self.keyring.snapshot(account_id)
            # 3) 用旧密码派生旧 KEK → 解出全部 DEK
            cred = self.conn.execute(
                "SELECT salt_kek, kek_kdf_metadata FROM credential WHERE account_id=?",
                (account_id,),
            ).fetchone()
            if not cred or not cred["salt_kek"]:
                raise EnvelopeError("credential 缺少 salt_kek（初始化不完整）")
            kp = _kek_params(cred["kek_kdf_metadata"])
            old_kek = derive_key(normalize_password(old_password), cred["salt_kek"], kp)
            deks: dict[int, bytes] = {}
            for row in self._load_nondestroyed_keys(account_id):
                deks[row["key_version"]] = open_password_envelope(
                    old_kek, row["password_envelope"], account_id.encode(), row["key_version"]
                )
            # 4) 重包 + 更新认证层（同一事务，沿用当前 KEK 参数）
            self._rewrap_with_new_credential(account_id, deks, new_password, kp)
            # 5) TODO(第五步)：invalidate all outstanding RecoveryChallenge
            self.conn.commit()
            return self.keyring.snapshot(account_id)
        except Exception:
            self.conn.rollback()
            raise

    # ---- 忘记密码恢复（Recovery mutation，不需要旧密码） ----

    def recover_password(
        self,
        account_id: str,
        recovery_session_id: str,
        new_password: str,
    ) -> SecuritySnapshot:
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            # 1) 同一事务内原子消费 recovery session（绑 account_epoch_at_issue；成功 reset 后销毁）
            self.grants.validate_and_use_recovery_session(self.conn, recovery_session_id)
            snap = self.keyring.snapshot(account_id)
            # 2) 用 KMS 解各 recovery_envelope 拿 DEK（没有旧密码）
            cred = self.conn.execute(
                "SELECT kek_kdf_metadata FROM credential WHERE account_id=?", (account_id,)
            ).fetchone()
            kp = _kek_params(cred["kek_kdf_metadata"]) if cred else _kek_params(None)
            deks: dict[int, bytes] = {}
            for row in self._load_nondestroyed_keys(account_id):
                if not row["recovery_envelope"]:
                    raise EnvelopeError(f"key v{row['key_version']} 缺少 recovery_envelope，无法恢复")
                deks[row["key_version"]] = self.kms.decrypt(
                    row["recovery_envelope"], account_id.encode(), row["key_version"]
                )
            # 3) 重包 + 更新认证层（同一事务，沿用当前 KEK 参数）
            self._rewrap_with_new_credential(account_id, deks, new_password, kp)
            # 4) TODO(第五步)：invalidate all RecoveryChallenge + notify
            self.conn.commit()
            return self.keyring.snapshot(account_id)
        except Exception:
            self.conn.rollback()
            raise

    # ---- 注册（建号）与登录（验密） ----

    def register(
        self,
        account_id: str,
        password: str,
        recovery_envelope: Optional[bytes] = None,
    ) -> SecuritySnapshot:
        """注册：建初始 keyring（DEK v1，password_envelope 用密码 KEK 包；recovery_envelope
        由上层用 KMS 生成后传入，缺失则账户暂不可邮箱恢复）。

        认证层（salt_auth/auth_hash）由 server 端生成并写入（server-trusted 模型）。
        """
        kp = _kek_params(None)
        if self._account_exists(account_id):
            raise EnvelopeError("account 已存在")
        dek = generate_dek()
        salt_kek = generate_salt()
        kek = derive_key(normalize_password(password), salt_kek, kp)
        penv = create_password_envelope(kek, dek, account_id.encode(), 1)
        if recovery_envelope is None:
            recovery_envelope = self.kms.encrypt(dek, account_id.encode(), 1)
        self.keyring.create_initial_keyring(account_id, penv, recovery_envelope)
        salt_auth = generate_salt()
        auth_hash = derive_key(normalize_password(password), salt_auth, kp)
        self.conn.execute(
            "UPDATE credential SET salt_kek=?, kek_kdf_metadata=?, salt_auth=?, auth_hash=?, "
            "auth_kdf_metadata=? WHERE account_id=?",
            (salt_kek, _meta(kp), salt_auth, auth_hash, _meta(kp), account_id),
        )
        self.conn.commit()
        return self.keyring.snapshot(account_id)

    def login(self, account_id: str, password: str) -> bool:
        """登录验密：比对 auth_hash（恒定时间）。成功返回 True。

        （这是认证能力；真正的会话签发由上层完成，例如复用现有 JWT lib.auth。"""
        cred = self.conn.execute(
            "SELECT salt_auth, auth_hash, auth_kdf_metadata FROM credential WHERE account_id=?",
            (account_id,),
        ).fetchone()
        if not cred or not cred["salt_auth"] or not cred["auth_hash"]:
            return False
        kp = _kek_params(cred["auth_kdf_metadata"])
        derived = derive_key(normalize_password(password), cred["salt_auth"], kp)
        return secrets.compare_digest(derived, cred["auth_hash"])

    # ---- DEK 供给：登录后可解出该账号的数据密钥（多设备同一 DEK 的前提） ----

    def open_dek(self, account_id: str, password: str, key_version: int | None = None) -> bytes:
        """用密码解出当前 DEK（供构造 SyncEngine 使用）。

        KEK = Argon2id(密码, salt_kek)；打开非 destroyed 的 password_envelope → DEK。
        密码错误 / 无 keyring 时抛 EnvelopeError。默认取当前（最大）key_version。
        """
        cred = self.conn.execute(
            "SELECT salt_kek, kek_kdf_metadata FROM credential WHERE account_id=?",
            (account_id,),
        ).fetchone()
        if not cred or not cred["salt_kek"]:
            raise EnvelopeError("credential 缺少 salt_kek（初始化不完整）")
        kp = _kek_params(cred["kek_kdf_metadata"])
        kek = derive_key(normalize_password(password), cred["salt_kek"], kp)

        if key_version is None:
            row = self.conn.execute(
                "SELECT key_version, password_envelope FROM account_key "
                "WHERE account_id=? AND status!='destroyed' ORDER BY key_version DESC LIMIT 1",
                (account_id,),
            ).fetchone()
        else:
            row = self.conn.execute(
                "SELECT key_version, password_envelope FROM account_key "
                "WHERE account_id=? AND key_version=? AND status!='destroyed'",
                (account_id, key_version),
            ).fetchone()
        if row is None or not row["password_envelope"]:
            raise EnvelopeError("无可用 password_envelope")
        return open_password_envelope(
            kek, row["password_envelope"], account_id.encode(), row["key_version"]
        )

    def _account_exists(self, account_id: str) -> bool:
        return self.conn.execute(
            "SELECT 1 FROM account WHERE account_id=?", (account_id,)
        ).fetchone() is not None
