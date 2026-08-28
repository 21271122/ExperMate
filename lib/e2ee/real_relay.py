"""Exdiary v2 — 真实中继客户端（实现 SyncRelay 接口，走 HTTP）。

使 `lib.e2ee.syncengine.SyncEngine` 在真实多设备/多进程下工作：
把本地的 `put(account_id, blob_uuid, packed)` / `all(account_id)` 翻译成对
`relay_server`（或托管中继）的 HTTP 调用。对应 §14：中继只见不透明密文，data-blind。
"""

from __future__ import annotations

import base64
from typing import Any

import requests

from lib.e2ee.syncengine import SyncConflict, SyncRelay


class RealRelay(SyncRelay):
    """HTTP 中继适配器：SyncEngine 无需改动，换入即可真联网同步。"""

    def __init__(self, base_url: str, account_id: str, account_key: str,
                 timeout: float = 10.0, session: requests.Session | None = None) -> None:
        self._url = base_url.rstrip("/")
        self.account_id = account_id
        self._key = account_key
        self._timeout = timeout
        self._session = session or requests.Session()

    # ---- 账号 ----

    def ensure_account(self) -> None:
        """在服务端注册/重置账号密钥（幂等）。"""
        r = self._session.post(
            f"{self._url}/api/relay/account",
            json={"account_id": self.account_id, "account_key": self._key},
            timeout=self._timeout,
        )
        r.raise_for_status()

    # ---- SyncRelay 接口 ----

    def put(self, account_id: bytes, blob_uuid: str, packed: bytes,
            expected_revision: int | None = None) -> None:
        """上传一个 opaque packed blob，并以读取时 revision 作为条件写前提。"""
        r = self._session.put(
            f"{self._url}/api/relay/{account_id.decode('utf-8')}/{blob_uuid}",
            data=packed,
            headers={
                "X-Account-Key": self._key,
                "Content-Type": "application/octet-stream",
                "X-Expected-Revision": str(expected_revision if expected_revision is not None else -1),
            },
            timeout=self._timeout,
        )
        if r.status_code == 409:
            try:
                detail = r.json()
            except ValueError:
                detail = {}
            raise SyncConflict(
                str(detail.get("error") or "REVISION_CONFLICT"),
                current_revision=detail.get("current_revision"),
            )
        r.raise_for_status()

    def all(self, account_id: bytes) -> dict[str, bytes]:
        """全量拉取该账号所有未删除 blob：{uuid: packed_bytes}。"""
        r = self._session.get(
            f"{self._url}/api/relay/{account_id.decode('utf-8')}",
            headers={"X-Account-Key": self._key},
            timeout=self._timeout,
        )
        r.raise_for_status()
        data = r.json()
        out: dict[str, bytes] = {}
        for b in data.get("blobs", []):
            out[b["uuid"]] = base64.b64decode(b["packed_b64"])
        return out

    def delete(self, account_id: bytes, blob_uuid: str, expected_revision: int) -> None:
        """删除（服务端写 tombstone）。revision CAS：须传 blob 当前 expected_revision。

        旧 revision（409 REVISION_CONFLICT）→ 视作 stale，raise（调用方得知需重拉或已被覆盖）。
        404（不存在/已删）→ 幂等返回。
        """
        r = self._session.delete(
            f"{self._url}/api/relay/{account_id.decode('utf-8')}/{blob_uuid}",
            params={"expected_revision": expected_revision},
            headers={"X-Account-Key": self._key},
            timeout=self._timeout,
        )
        if r.status_code == 404:
            return
        r.raise_for_status()

    def close(self) -> None:
        self._session.close()

    def __enter__(self) -> "RealRelay":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()
