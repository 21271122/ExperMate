"""旧版自由文本解析模块。功能已迁入 ExtractionService，保留作为 fallback。"""

import re
from datetime import datetime
from lib.core.schema import EXPERIMENT_SCHEMA
from lib.services.extraction import EXTRACTION_SYSTEM_PROMPT

SYSTEM_PROMPT = EXTRACTION_SYSTEM_PROMPT  # 合并重复 prompt，单一维护源在 extraction.py


def strip_html(html_text: str) -> str:
    """Convert rich HTML notes to plain text for AI extraction."""
    text = re.sub(r'<img[^>]*>', '', html_text)
    text = re.sub(r'</?(p|div|br|li|h\d|tr)[^>]*>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


def parse_notes(notes: str, llm_client) -> dict:
    """Convert free-form experiment notes into structured YAML-ready dict."""
    user_prompt = f"""Extract the following experiment notes into a structured record:

---BEGIN NOTES---
{notes}
---END NOTES---

If the notes are in Chinese, extract in Chinese but keep section keys in English.
If the notes mention experiment IDs or dates, preserve them exactly.
If the notes mention file paths or sample IDs, preserve them exactly.
"""

    result = llm_client.structured_extract(
        prompt=user_prompt,
        system_prompt=SYSTEM_PROMPT,
        output_schema=EXPERIMENT_SCHEMA
    )
    if not result.get("date"):
        result["date"] = datetime.now().strftime("%Y-%m-%d")
    result["original_notes"] = notes.strip()
    return result
