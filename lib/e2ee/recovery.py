"""Exdiary v2 — 邮箱找回：高熵 token + 原子 exchange + 可注入邮件发送。

恢复邮箱与密码恢复流程：
- 只支持**高熵 URL token**（不支持短数字 OTP）：CSPRNG 生成、DB **只存 SHA-256 哈希**。
- **原子 exchange**：`token_hash CAS unused→consumed` 并同时签发唯一 RecoverySession
  （GET 打开不算消费；消费发生在显式 exchange）。
- token 绑 account + `generation_at_issue` + `recovery_email_version_at_issue`，
  exchange 时校验仍等于当前（改密/改邮箱后旧 token 自动失效）。
- RecoveryEmail 是**单一真相**的 verified trust root；改邮箱用 pending candidate。

依赖 `lib.e2ee.grants`（RecoverySession）、`lib.e2ee.keystore`（account/credential 读版本）。
"""

from __future__ import annotations

import hashlib
import secrets
import sqlite3
import time
from abc import ABC, abstractmethod
from typing import Optional

from lib.e2ee.grants import GrantError
from lib.e2ee.policy import canonicalize_email

_TOKEN_HASH = "sha256"


class MailSender(ABC):
    """可注入的邮件发送接口（真实实现接邮件服务 / SMTP）。"""

    @abstractmethod
    def send(self, to: str, subject: str, body: str) -> None: ...


class RecordingMailSender(MailSender):
    """测试/演示用：只记录，不真发。"""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, str]] = []

    def send(self, to: str, subject: str, body: str) -> None:
        self.sent.append((to, subject, body))


def _new_token() -> str:
    return secrets.token_urlsafe(32)


def _hash_token(token: str) -> str:
    return f"{_TOKEN_HASH}:{hashlib.sha256(token.encode()).hexdigest()}"


class RecoveryService:
    def __init__(
        self,
        conn: sqlite3.Connection,
        grants: "object",  # SensitiveGrantStore
        mail: MailSender | None = None,
    ) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self.grants = grants
        self.mail = mail or RecordingMailSender()
        self._create_schema()

    def _create_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS recovery_email (          -- 单一真相：当前 verified trust root
                account_id TEXT PRIMARY KEY,
                address    TEXT NOT NULL,
                version    INTEGER NOT NULL DEFAULT 1,
                status     TEXT NOT NULL DEFAULT 'verified'      -- verified | unverified
            );
            CREATE TABLE IF NOT EXISTS recovery_email_change (   -- pending candidate
                account_id    TEXT PRIMARY KEY,
                candidate     TEXT NOT NULL,
                token_hash    TEXT NOT NULL,
                status        TEXT NOT NULL DEFAULT 'pending',
                expires_at    INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS recovery_token (          -- 高熵 reset token（只存 hash）
                token_hash           TEXT PRIMARY KEY,
                account_id           TEXT NOT NULL,
                challenge_id         TEXT,
                generation_at_issue  INTEGER NOT NULL,
                email_version_at_issue INTEGER NOT NULL,
                expires_at           INTEGER NOT NULL,
                consumed_at          INTEGER
            );
            """
        )
        self.conn.commit()

    def _now(self) -> int:
        return int(time.time())

    def _gen(self, account_id: str) -> tuple[int, int]:
        """当前 credential.generation + recovery_email.version。"""
        gen_row = self.conn.execute(
            "SELECT generation FROM credential WHERE account_id=?", (account_id,)
        ).fetchone()
        gen = gen_row["generation"] if gen_row else 1
        e = self.conn.execute(
            "SELECT version FROM recovery_email WHERE account_id=?", (account_id,)
        ).fetchone()
        e_v = e["version"] if e else 1
        return int(gen), int(e_v)

    # ---- RecoveryEmail（单一真相） ----

    def set_recovery_email(self, account_id: str, address: str, verified: bool = True) -> None:
        self.conn.execute(
            "INSERT INTO recovery_email (account_id, address, version, status) "
            "VALUES (?,?,1,?) ON CONFLICT(account_id) DO UPDATE SET address=excluded.address, "
            "status=excluded.status",
            (account_id, canonicalize_email(address), "verified" if verified else "unverified"),
        )
        self.conn.commit()

    def get_recovery_email(self, account_id: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM recovery_email WHERE account_id=?", (account_id,)
        ).fetchone()
        return dict(row) if row else None

    def begin_email_change(self, account_id: str, candidate: str) -> str:
        """发起改邮箱：生成候选验证 token（发邮件 + 存 pending，不立即替换 verified root）。"""
        candidate = canonicalize_email(candidate)
        token = _new_token()
        now = self._now()
        self.conn.execute(
            "INSERT INTO recovery_email_change (account_id, candidate, token_hash, status, expires_at) "
            "VALUES (?,?,?,'pending',?) ON CONFLICT(account_id) DO UPDATE SET "
            "candidate=excluded.candidate, token_hash=excluded.token_hash, status='pending', expires_at=excluded.expires_at",
            (account_id, candidate, _hash_token(token), now + 900),
        )
        self.conn.commit()
        self.mail.send(candidate, "验证新恢复邮箱",
                       f"验证码：{token}（15 分钟内有效，只显示一次，勿转发他人）")
        return token

    def confirm_email_change(
        self,
        account_id: str,
        token: str,
        grant_id: str | None = None,
    ) -> Optional[dict]:
        """验证候选 token → 原子替换当前 verified email（version++）。

        §11：最终替换 commit 必须持有 fresh SensitiveActionGrant(change_recovery_email)。
        有 grant_id 时在**同一安全事务**内原子消费（single-use）；无 grant_id → fail-closed 拒绝。
        """
        row = self.conn.execute(
            "SELECT candidate, expires_at FROM recovery_email_change "
            "WHERE account_id=? AND token_hash=? AND status='pending'",
            (account_id, _hash_token(token)),
        ).fetchone()
        if not row or row["expires_at"] < self._now():
            raise GrantError("邮箱验证 token 无效或过期")
        new_addr = row["candidate"]
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            if grant_id:
                self.grants.consume_grant(self.conn, grant_id, "change_recovery_email")
            else:
                raise GrantError("缺少 SensitiveActionGrant，拒绝改重启恢复邮箱")
            # version++
            cur = self.conn.execute(
                "SELECT version FROM recovery_email WHERE account_id=?", (account_id,)
            ).fetchone()
            v = (cur["version"] if cur else 0) + 1
            self.conn.execute(
                "INSERT INTO recovery_email (account_id, address, version, status) "
                "VALUES (?,?,?,'verified') ON CONFLICT(account_id) DO UPDATE SET "
                "address=excluded.address, version=excluded.version, status='verified'",
                (account_id, new_addr, v),
            )
            self.conn.execute(
                "DELETE FROM recovery_email_change WHERE account_id=?", (account_id,)
            )
            # 改邮箱属于敏感安全变更 → 使所有已签发 reset token 失效（invalidate all challenge）
            self.conn.execute("DELETE FROM recovery_token WHERE account_id=?", (account_id,))
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        return {"address": new_addr, "version": v}

    # ---- 忘记密码：高熵 reset token ----

    def request_password_reset(self, account_id: str, email: str) -> Optional[str]:
        """邮箱发一次性高熵 reset token（DB 只存 hash）。

        防枚举：无论 email 是否匹配，调用方都应返回一致响应；只有匹配才实际产生 token 并发信。
        """
        email_row = self.conn.execute(
            "SELECT * FROM recovery_email WHERE account_id=? AND address=? AND status='verified'",
            (account_id, canonicalize_email(email)),
        ).fetchone()
        if not email_row:
            return None  # 不匹配：不生成、不发信（调用方应 generic 响应）
        gen, e_v = self._gen(account_id)
        token = _new_token()
        now = self._now()
        self.conn.execute(
            "INSERT INTO recovery_token (token_hash, account_id, challenge_id, generation_at_issue, "
            " email_version_at_issue, expires_at) VALUES (?,?,?,?,?,?)",
            (_hash_token(token), account_id, f"rc_{secrets.token_hex(6)}",
             gen, e_v, now + 900),
        )
        self.conn.commit()
        self.mail.send(email, "重设 Exdiary 密码",
                       f"恢复链接有效期 15 分钟，一次性使用：\n{token}")
        return token

    def exchange_reset_token(self, conn: sqlite3.Connection, account_id: str, token: str) -> str:
        """**原子 exchange**：token_hash CAS unused→consumed，同时签发唯一 RecoverySession。

        在调用方事务内（conn）：只发条件 UPDATE + INSERT recovery_session。
        成功后返回 recovery_session_id，供 `service.recover_password` 消费。
        """
        gen, e_v = self._gen(account_id)
        now = self._now()
        cur = conn.execute(
            """UPDATE recovery_token
               SET consumed_at = ?
               WHERE token_hash = ? AND account_id = ?
                 AND consumed_at IS NULL
                 AND expires_at > ?
                 AND generation_at_issue = ?
                 AND email_version_at_issue = ?""",
            (now, _hash_token(token), account_id, now, gen, e_v),
        )
        if cur.rowcount == 0:
            raise GrantError("reset token 无效/已用/过期/或 account generation·email version 已变")
        # 原子签发唯一 RecoverySession（绑当前 account_epoch）
        acc = conn.execute(
            "SELECT account_epoch FROM account WHERE account_id=?", (account_id,)
        ).fetchone()
        session_id = f"rs_{account_id}_{int(time.time_ns())}"
        conn.execute(
            "INSERT INTO recovery_session (session_id, account_id, challenge_id, credential_generation, "
            " recovery_email_version, account_epoch_at_issue, issued_at, expires_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (session_id, account_id, f"ex_{secrets.token_hex(6)}",
             gen, e_v, int(acc["account_epoch"]), now, now + 300),
        )
        return session_id
