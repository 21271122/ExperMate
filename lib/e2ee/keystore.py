"""Exdiary v2 — keyring 数据模型 + 统一事务快照（G/S/K）。

账户密钥与安全状态存储：
- 第 5 节：`Account.key_state_version`/`current_key_version` 是 keyring head 单一真相；
  唯一 active + destroyed 真销毁。
- 第 9.1 节（首要不变量）：任何创建/替换/重包 `password_envelope` 的事务
  （改密、恢复、KEK 升级、rotation）都必须基于同一一致性快照，
  提交时**同时**校验 `generation + key_state_version + current_key_version`。

本模块用 SQLite 的 `BEGIN IMMEDIATE`（写锁）+ 同一事务内重读快照实现原子提交：
拿写锁后读-比较-写整体原子，任何预期冲突 → `SecurityConflict`（不覆盖）。
这是"统一事务快照"（而非各自 CAS）的落库表达。

依赖 `lib.e2ee.crypto` 的密码学原语（envelope 由调用方用 KEK/KMS 生成后传入）。
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from typing import Callable, Optional

# ---------------------------------------------------------------------------
# 快照与异常
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SecuritySnapshot:
    """统一安全快照：generation + account_epoch + key_state + current_key。

    任何会改变 password-envelope/keyring 语义的事务，提交时都必须与它一致。
    """

    account_id: str
    generation: int
    account_epoch: int
    key_state_version: int
    current_key_version: int

    def matches(self, other: "SecuritySnapshot | None") -> bool:
        if other is None:
            return False
        return (
            self.account_id == other.account_id
            and self.generation == other.generation
            and self.account_epoch == other.account_epoch
            and self.key_state_version == other.key_state_version
            and self.current_key_version == other.current_key_version
        )


class SecurityConflict(RuntimeError):
    """安全状态已被并发变更，事务中止（须 reload → recompute → retry）。"""


# ---------------------------------------------------------------------------
# keyring 存储
# ---------------------------------------------------------------------------


class KeyringStore:
    """SQLite keyring 存储：统一快照 + 原子安全事务。"""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self._create_schema()

    # ---- schema ----

    def _create_schema(self) -> None:
        c = self.conn
        c.executescript(
            """
            CREATE TABLE IF NOT EXISTS account (
                account_id           TEXT PRIMARY KEY,
                account_epoch        INTEGER NOT NULL DEFAULT 1,
                current_key_version  INTEGER,
                key_state_version    INTEGER NOT NULL DEFAULT 1,
                status               TEXT NOT NULL DEFAULT 'active'
            );

            CREATE TABLE IF NOT EXISTS credential (
                account_id         TEXT PRIMARY KEY,
                generation         INTEGER NOT NULL DEFAULT 1,
                row_revision       INTEGER NOT NULL DEFAULT 1,
                salt_auth          BLOB,
                auth_hash          BLOB,
                auth_kdf_metadata  TEXT,
                salt_kek           BLOB,
                kek_kdf_metadata   TEXT
            );

            CREATE TABLE IF NOT EXISTS account_key (
                account_id           TEXT NOT NULL,
                key_version          INTEGER NOT NULL,
                status               TEXT NOT NULL,        -- active|retired|pending|destroyed
                password_envelope    BLOB,
                recovery_envelope    BLOB,
                recovery_kms_key_arn TEXT,
                row_revision         INTEGER NOT NULL DEFAULT 1,
                created_at           TEXT DEFAULT '',
                retired_at           TEXT DEFAULT '',
                PRIMARY KEY (account_id, key_version)
            );

            -- 唯一 active：每 account 至多一个 active key（DB 硬约束，不只看 CAS）
            CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active
                ON account_key(account_id) WHERE status = 'active';
            """
        )
        c.commit()

    # ---- 快照 ----

    def snapshot(self, account_id: str) -> SecuritySnapshot:
        acc = self.conn.execute(
            "SELECT account_epoch, current_key_version, key_state_version "
            "FROM account WHERE account_id=?",
            (account_id,),
        ).fetchone()
        if acc is None:
            raise KeyError(f"account 不存在: {account_id}")
        gen_row = self.conn.execute(
            "SELECT generation FROM credential WHERE account_id=?", (account_id,)
        ).fetchone()
        generation = gen_row["generation"] if gen_row else 1
        return SecuritySnapshot(
            account_id=account_id,
            generation=generation,
            account_epoch=acc["account_epoch"],
            key_state_version=acc["key_state_version"],
            current_key_version=acc["current_key_version"],
        )

    # ---- 原子安全事务（统一快照） ----

    def _atomic(self, account_id: str, expected: SecuritySnapshot, fn: Callable[[sqlite3.Connection], None]) -> None:
        """BEGIN IMMEDIATE 内：重读快照 → 校验 ——> 执行 fn → bump key_state_version → COMMIT。

        任一步失败 → ROLLBACK，不覆盖并发变更。
        """
        cur = self.conn.execute("BEGIN IMMEDIATE")
        try:
            current = self.snapshot(account_id)  # 同一事务内、持写锁后读
            if not expected.matches(current):
                raise SecurityConflict(
                    f"安全快照不匹配: expected {expected} vs current {current}"
                )
            fn(self.conn)
            # 任何 password-keyring 语义变化的表写，都在上方 fn 内 + 这里统一 S++
            self.conn.execute(
                "UPDATE account SET key_state_version = key_state_version + 1 WHERE account_id=?",
                (account_id,),
            )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise
        finally:
            pass

    # ---- 初始化 ----

    def create_initial_keyring(
        self,
        account_id: str,
        password_envelope: bytes,
        recovery_envelope: Optional[bytes],
    ) -> None:
        """创建一个可以用密码+（若给 recovery）恢复的初始 keyring（DEK v1 active）。

        若 recovery_envelope 缺失，则账户处于无法邮箱恢复状态 —— 交给上层
        (Account.status / recovery_enabled)判断，本层只负责 keyring 完整。
        """
        self.conn.execute("BEGIN IMMEDIATE")
        try:
            self.conn.execute(
                "INSERT INTO account (account_id, account_epoch, current_key_version, key_state_version, status) "
                "VALUES (?,1,1,1,'active')",
                (account_id,),
            )
            self.conn.execute(
                "INSERT INTO credential (account_id, generation, row_revision) VALUES (?,1,1)",
                (account_id,),
            )
            self.conn.execute(
                "INSERT INTO account_key (account_id, key_version, status, password_envelope, recovery_envelope) "
                "VALUES (?,1,'active',?,?)",
                (account_id, password_envelope, recovery_envelope),
            )
            self.conn.commit()
        except Exception:
            self.conn.rollback()
            raise

    # ---- DEK 生命周期（都带统一快照校验 + S++） ----

    def rotate(self, account_id: str, expected: SecuritySnapshot,
               password_envelope: bytes, recovery_envelope: Optional[bytes]) -> int:
        """轮换：新 active DEK 顶替当前，旧 current 标记 retired。统一快照原子。

        先 retire 旧再 insert 新，保证全程唯一 active（DB 唯一索引）。
        上层保证：先在本地用 KEK/KMS 凑齐新 DEK 的 password/recovery envelope，
        再调用本方法 —— 符合"先凑齐三件套再 CAS"，不会先推进 current 再补。
        """
        new_version: int = 0
        old_version: int = 0

        def fn(c: sqlite3.Connection) -> None:
            nonlocal new_version, old_version
            old_version = expected.current_key_version
            new_version = old_version + 1
            c.execute(
                "UPDATE account_key SET status='retired', retired_at=datetime('now') "
                "WHERE account_id=? AND key_version=? AND status='active'",
                (account_id, old_version),
            )
            c.execute(
                "INSERT INTO account_key (account_id,key_version,status,password_envelope,recovery_envelope) "
                "VALUES (?,?,'active',?,?)",
                (account_id, new_version, password_envelope, recovery_envelope),
            )
            c.execute(
                "UPDATE account SET current_key_version=? WHERE account_id=?",
                (new_version, account_id),
            )

        self._atomic(account_id, expected, fn)
        return new_version

    def destroy(self, account_id: str, expected: SecuritySnapshot, key_version: int) -> None:
        """真销毁：仅 retired 可 destroy；销毁后 envelope 置 NULL（无服务器可恢复副本）。

        前提（上层保证）：无 live blob 引用 + 无保留期备份引用 + 无 pending migration。
        本层强制 committed 那些能立刻表达的约束（envelope 置空 + 非 active）。"""
        def fn(c: sqlite3.Connection) -> None:
            cur = c.execute(
                "UPDATE account_key SET status='destroyed', password_envelope=NULL, recovery_envelope=NULL, "
                "row_revision=row_revision+1 "
                "WHERE account_id=? AND key_version=? AND status='retired'",
                (account_id, key_version),
            )
            if cur.rowcount == 0:
                raise SecurityConflict(f"destroy 失败：key v{key_version} 不是 retired 或不存在")

        self._atomic(account_id, expected, fn)

    # ---- 查询 ----

    def get_key(self, account_id: str, key_version: int) -> Optional[dict]:
        row = self.conn.execute(
            "SELECT * FROM account_key WHERE account_id=? AND key_version=?",
            (account_id, key_version),
        ).fetchone()
        return dict(row) if row else None

    def active_key_count(self, account_id: str) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) AS n FROM account_key WHERE account_id=? AND status='active'",
            (account_id,),
        ).fetchone()
        return int(row["n"])
