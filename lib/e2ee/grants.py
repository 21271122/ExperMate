"""Exdiary v2 — 双授权状态机（SensitiveActionGrant / RecoverySession）。

敏感操作授权与恢复会话：
- **Authenticated mutation**（改密码/改邮箱/手动 rotate/KEK 升级/设备信任）
  用 `SensitiveActionGrant`：由 current-password reauth 签发，short TTL、
  原子 single-use、绑 session/device/account_epoch/credential_generation/purpose。
- **Recovery mutation**（forgot-password / compromise recovery）
  用 `RecoverySession`：由 email token 的原子 exchange 签发，绑
  challenge/generation/email_version/account_epoch_at_issue，成功 reset 后销毁。

关键点（评审 P0）：
- forgot-password 走 RecoverySession 本身就是身份恢复证明，**不再要求** current-password grant。
- grant/session 的消费与业务 mutation 在**同一安全事务**内完成（`consume_*` 依赖调用方事务）。
- 任何 logout-all / account_epoch++ 都会使已签发 grant 失效（绑 epoch）。
"""

from __future__ import annotations

import sqlite3
import time
from typing import Optional

VALID_PURPOSES = {
    "change_password",
    "change_recovery_email",
    "rotate_dek",
    "kek_kdf_upgrade",
    "device_trust_change",
    "compromise_recovery",  # 由 RecoverySession 覆盖，此处不注入 current-password grant
}

_DEFAULT_TTL_SECONDS = 300  # 5 分钟


class GrantError(RuntimeError):
    """授权无效 / 已消费 / 用途不符 / 已过期 / epoch 失效。"""


class SensitiveGrantStore:
    """SensitiveActionGrant + RecoverySession 落库（复用 keystore 的 account/credential）。"""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self._create_schema()

    def _create_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sensitive_action_grant (
                grant_id             TEXT PRIMARY KEY,
                account_id           TEXT NOT NULL,
                session_id           TEXT,
                device_id            TEXT,
                account_epoch        INTEGER NOT NULL,
                credential_generation INTEGER NOT NULL,
                purpose              TEXT NOT NULL,
                issued_at            INTEGER NOT NULL,   -- unix seconds
                expires_at           INTEGER NOT NULL,
                consumed_at          INTEGER
            );

            CREATE TABLE IF NOT EXISTS recovery_session (
                session_id               TEXT PRIMARY KEY,
                account_id               TEXT NOT NULL,
                challenge_id             TEXT,
                credential_generation    INTEGER NOT NULL,
                recovery_email_version   INTEGER NOT NULL,
                account_epoch_at_issue   INTEGER NOT NULL,
                issued_at                INTEGER NOT NULL,
                expires_at               INTEGER NOT NULL,
                consumed_at              INTEGER
            );
            """
        )
        self.conn.commit()

    def _now(self) -> int:
        return int(time.time())

    # ---- SensitiveActionGrant ----

    def _current_epoch_generation(self, account_id: str) -> tuple[int, int]:
        acc = self.conn.execute(
            "SELECT account_epoch FROM account WHERE account_id=?", (account_id,)
        ).fetchone()
        if acc is None:
            raise KeyError(f"account 不存在: {account_id}")
        gen_row = self.conn.execute(
            "SELECT generation FROM credential WHERE account_id=?", (account_id,)
        ).fetchone()
        gen = gen_row["generation"] if gen_row else 1
        return int(acc["account_epoch"]), int(gen)

    def issue_grant(
        self,
        account_id: str,
        purpose: str,
        session_id: Optional[str] = None,
        device_id: Optional[str] = None,
        ttl: int = _DEFAULT_TTL_SECONDS,
    ) -> str:
        """current-password reauth 通过后签发 grant。绑当前 epoch+generation。"""
        if purpose not in VALID_PURPOSES:
            raise GrantError(f"非法 purpose: {purpose}")
        if ttl <= 0:
            raise GrantError("ttl 必须为正")
        epoch, gen = self._current_epoch_generation(account_id)
        grant_id = f"sg_{account_id}_{int(time.time_ns())}"
        now = self._now()
        self.conn.execute(
            "INSERT INTO sensitive_action_grant "
            "(grant_id, account_id, session_id, device_id, account_epoch, credential_generation, "
            " purpose, issued_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (grant_id, account_id, session_id, device_id, epoch, gen,
             purpose, now, now + ttl),
        )
        self.conn.commit()
        return grant_id

    def consume_grant(self, conn: sqlite3.Connection, grant_id: str, purpose: str) -> None:
        """在同一安全事务内原子消费 grant（single-use）。

        条件：未消费 + 用途匹配 + grant 绑定 epoch/generation 仍等于当前
           （即 logout-all / epoch++ 或 generation++ 后 grant 自动失效）+ 未过期。
        调用方负责外层 BEGIN COMMIT；此处只发一条条件 UPDATE。
        """
        now = self._now()
        cur = conn.execute(
            """UPDATE sensitive_action_grant
               SET consumed_at = ?
               WHERE grant_id = ?
                 AND purpose = ?
                 AND consumed_at IS NULL
                 AND issued_at <= ?
                 AND expires_at > ?
                 AND account_epoch =
                     (SELECT account_epoch FROM account WHERE account_id =
                        sensitive_action_grant.account_id)
                 AND credential_generation =
                     (SELECT generation FROM credential WHERE account_id =
                        sensitive_action_grant.account_id)""",
            (now, grant_id, purpose, now, now),
        )
        if cur.rowcount == 0:
            raise GrantError(
                f"grant {grant_id} 无效/已消费/用途不符/过期/或 epoch·generation 已变"
            )

    # ---- RecoverySession ----

    def issue_recovery_session(
        self,
        account_id: str,
        challenge_id: str,
        generation: int,
        recovery_email_version: int,
        ttl: int = _DEFAULT_TTL_SECONDS,
    ) -> str:
        """email token 原子 exchange 后签发唯一 recovery session（绑 account_epoch_at_issue）。"""
        acc = self.conn.execute(
            "SELECT account_epoch FROM account WHERE account_id=?", (account_id,)
        ).fetchone()
        if acc is None:
            raise KeyError(f"account 不存在: {account_id}")
        session_id = f"rs_{account_id}_{int(time.time_ns())}"
        now = self._now()
        self.conn.execute(
            "INSERT INTO recovery_session "
            "(session_id, account_id, challenge_id, credential_generation, recovery_email_version, "
            " account_epoch_at_issue, issued_at, expires_at) VALUES (?,?,?,?,?,?,?,?)",
            (session_id, account_id, challenge_id, generation, recovery_email_version,
             int(acc["account_epoch"]), now, now + ttl),
        )
        self.conn.commit()
        return session_id

    def validate_and_use_recovery_session(self, conn: sqlite3.Connection, session_id: str) -> None:
        """每次 KMS recovery 调用前校验，并在成功 reset 时同一事务内销毁。

        条件：未消费 + 未过期 + account_epoch_at_issue 仍 == 当前 account_epoch
          （logout-all / security revoke 后 recovery capability 失效）。
        """
        now = self._now()
        cur = conn.execute(
            """UPDATE recovery_session
               SET consumed_at = ?
               WHERE session_id = ?
                 AND consumed_at IS NULL
                 AND issued_at <= ?
                 AND expires_at > ?
                 AND account_epoch_at_issue =
                     (SELECT account_epoch FROM account WHERE account_id =
                        recovery_session.account_id)""",
            (now, session_id, now, now),
        )
        if cur.rowcount == 0:
            raise GrantError(
                f"recovery session {session_id} 无效/已用/过期/或 account_epoch 已变"
            )

    def get_grant(self, grant_id: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM sensitive_action_grant WHERE grant_id=?", (grant_id,)
        ).fetchone()
        return dict(row) if row else None

    def get_recovery_session(self, session_id: str) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM recovery_session WHERE session_id=?", (session_id,)
        ).fetchone()
        return dict(row) if row else None
