"""实验编号规则：兼容旧 EXP 编号，并为离线多设备生成带设备码的新编号。"""

from __future__ import annotations

import re
import secrets


DEVICE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
LEGACY_EXPERIMENT_ID_RE = re.compile(r"EXP-\d{4}-\d{3,}", re.IGNORECASE)
DEVICE_EXPERIMENT_ID_RE = re.compile(r"\d{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-\d{3,}", re.IGNORECASE)
EXPERIMENT_ID_RE = re.compile(
    rf"(?:{LEGACY_EXPERIMENT_ID_RE.pattern}|{DEVICE_EXPERIMENT_ID_RE.pattern})", re.IGNORECASE
)


def new_device_code() -> str:
    return "".join(secrets.choice(DEVICE_ALPHABET) for _ in range(4))


def normalize_device_code(value: str) -> str:
    code = str(value or "").strip().upper()
    return code if re.fullmatch(r"[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}", code) else ""


def is_experiment_id(value: str) -> bool:
    return bool(EXPERIMENT_ID_RE.fullmatch(str(value or "").lstrip("@")))


def find_references(text: str) -> list[str]:
    return [match.group(1).upper() for match in re.finditer(
        rf"@({EXPERIMENT_ID_RE.pattern})(?![\w-])", text or "", re.IGNORECASE
    )]
