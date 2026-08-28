"""Exdiary v2 — 灾备 SecurityJournal（完整 SecurityHead + fail-closed）。

安全状态的灾备日志：
- SecurityJournal 记录**完整 SecurityHead**：`(generation, account_epoch, recovery_email.version,
  key_state_version, current_key_version)` —— 不是只记 generation（否则察觉不到 DEK
  rotation 回滚 / destroyed 旧 key 复活）。
- 每 account 有单调递增 `security_revision`（任何 SecurityHead 语义变更都 +1）。
- **fail-closed**：恢复时 `restored SecurityHead == authoritative` 才放行；
  任何不一致 → `SECURITY_STATE_STALE`（禁止普通登录/恢复，直到从权威状态恢复或重建）。
  high-water 是 **rollback detector，不是 repair mechanism**——不能只把版本号抬高。

★ 独立故障域：SecurityJournal 必须与业务 DB **不同的 failure domain**（不同 DB/存储、
更严 RPO；绝不能与业务备份一起回滚到同一天，否则检测不出回滚）。
本实现按"独立连接/独立库"设计，注入 conn；测试可给独立 :memory: 连接演示隔离。
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class SecurityHead:
    generation: int
    account_epoch: int
    recovery_email_version: int
    key_state_version: int
    current_key_version: int

    def equals(self, o: "SecurityHead | None") -> bool:
        if o is None:
            return False
        return (
            self.generation == o.generation
            and self.account_epoch == o.account_epoch
            and self.recovery_email_version == o.recovery_email_version
            and self.key_state_version == o.key_state_version
            and self.current_key_version == o.current_key_version
        )


class SecurityJournal:
    """独立故障域的灾备安全状态源（比业务 DB 权威）。"""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.conn.row_factory = sqlite3.Row
        self._create_schema()

    def _create_schema(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS security_journal (
                account_id              TEXT NOT NULL,
                security_revision       INTEGER NOT NULL,
                generation              INTEGER NOT NULL,
                account_epoch           INTEGER NOT NULL,
                recovery_email_version  INTEGER NOT NULL,
                key_state_version       INTEGER NOT NULL,
                current_key_version     INTEGER NOT NULL,
                recorded_at             INTEGER NOT NULL,
                PRIMARY KEY (account_id, security_revision)
            );
            """
        )
        self.conn.commit()

    def record_head(self, account_id: str, head: SecurityHead) -> int:
        """记录/追加一个 SecurityHead，返回新 security_revision（单调递增）。"""
        last = self.conn.execute(
            "SELECT security_revision FROM security_journal WHERE account_id=? "
            "ORDER BY security_revision DESC LIMIT 1",
            (account_id,),
        ).fetchone()
        new_rev = (int(last["security_revision"]) + 1) if last else 1
        self.conn.execute(
            "INSERT INTO security_journal (account_id, security_revision, generation, account_epoch, "
            " recovery_email_version, key_state_version, current_key_version, recorded_at) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (account_id, new_rev, head.generation, head.account_epoch,
             head.recovery_email_version, head.key_state_version,
             head.current_key_version, int(time.time())),
        )
        self.conn.commit()
        return new_rev

    def authoritative(self, account_id: str) -> Optional[tuple[int, SecurityHead]]:
        """返回最新(security_revision, SecurityHead)，无记录则 None。"""
        row = self.conn.execute(
            "SELECT * FROM security_journal WHERE account_id=? "
            "ORDER BY security_revision DESC LIMIT 1",
            (account_id,),
        ).fetchone()
        if row is None:
            return None
        head = SecurityHead(row["generation"], row["account_epoch"],
                            row["recovery_email_version"], row["key_state_version"],
                            row["current_key_version"])
        return int(row["security_revision"]), head

    def verify_restore(self, account_id: str, restored: SecurityHead) -> dict:
        """fail-closed 判定：restored==authoritative 才 ok；任何不一致或缺失 → stale。

        返回 {"ok": bool, "revision": n|None, "reason": str}。
        """
        auth = self.authoritative(account_id)
        if auth is None:
            return {"ok": False, "revision": None,
                    "reason": "SECURITY_STATE_STALE: 无 authoritative journal（保守 fail-closed）"}
        rev, head = auth
        if restored.equals(head):
            return {"ok": True, "revision": rev, "reason": "ok"}
        return {"ok": False, "revision": rev,
                "reason": "SECURITY_STATE_STALE: restored SecurityHead 与 authoritative 不一致（检测到安全状态回滚）"}

    @staticmethod
    def read_live_head(
        conn: sqlite3.Connection,
        account_id: str,
        email_version: int = 1,
    ) -> SecurityHead:
        """从业务库读当前活状态构造 SecurityHead（用于每次变更后 record_head）。"""
        acc = conn.execute(
            "SELECT account_epoch, key_state_version, current_key_version FROM account WHERE account_id=?",
            (account_id,),
        ).fetchone()
        if acc is None:
            raise KeyError(account_id)
        gen_row = conn.execute(
            "SELECT generation FROM credential WHERE account_id=?", (account_id,)
        ).fetchone()
        gen = gen_row["generation"] if gen_row else 1
        return SecurityHead(
            generation=gen,
            account_epoch=int(acc["account_epoch"]),
            recovery_email_version=email_version,
            key_state_version=int(acc["key_state_version"]),
            current_key_version=int(acc["current_key_version"]),
        )
