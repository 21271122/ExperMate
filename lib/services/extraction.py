"""自然语言提取服务。吸收 lib/parser.py 的 parse_notes() 和 strip_html()。"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any
from lib.core.schema import EXPERIMENT_SCHEMA


class ExtractionService:
    def __init__(self, extract_llm: Any):
        self.extract_llm = extract_llm

    def parse_notes(self, notes: str) -> dict[str, Any]:
        """自然语言 → 结构化 dict。"""
        user_prompt = f"""Extract the following experiment notes into a structured record:

---BEGIN NOTES---
{notes}
---END NOTES---

If the notes are in Chinese, extract in Chinese but keep section keys in English.
If the notes mention experiment IDs or dates, preserve them exactly.
If the notes mention file paths or sample IDs, preserve them exactly.
"""
        result: dict[str, Any] = self.extract_llm.structured_extract(
            prompt=user_prompt,
            system_prompt=EXTRACTION_SYSTEM_PROMPT,
            output_schema=EXPERIMENT_SCHEMA
        )
        if not result.get("date"):
            result["date"] = datetime.now().strftime("%Y-%m-%d")
        result["original_notes"] = notes.strip()
        return result

    @staticmethod
    def strip_html(html_text: str) -> str:
        """Convert rich HTML notes to plain text for AI extraction."""
        text = re.sub(r'<img[^>]*>', '', html_text)
        text = re.sub(r'</?(p|div|br|li|h\d|tr)[^>]*>', '\n', text)
        text = re.sub(r'<[^>]+>', '', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()


EXTRACTION_SYSTEM_PROMPT = """You are an expert materials science research assistant specialized in
extracting structured experiment records from free-form laboratory notes.

Your task: Given the user's informal experiment notes, extract all available
information and output a structured experiment record via the save_experiment function.

EXTRACTION RULES:
1. DO NOT fabricate data. If information is not present in the notes,
   leave the field empty or with a reasonable default (empty list, empty string).
2. Leave the `id` field empty. The system assigns the final local device-based ID.
3. For `status`, infer from context: if notes mention results/data = "done",
   if only plan = "planned", if something went wrong = "failed".
4. For `tags`, use controlled vocabulary from: synthesis, characterization,
   photocatalysis, electrochemistry, sintering, ball-milling, thin-film,
   XRD, SEM, TEM, mechanical-testing, thermal-analysis, DFT,
   sol-gel, hydrothermal, co-precipitation, calcination, doping,
   coating, corrosion, battery, ceramic, polymer, composite, nano.
   Add 2-4 relevant tags.
5. For the `materials` section: extract exact names, purities if mentioned,
   approximate amounts. Use "N/A" for missing vendor info.
6. For the `sop` section: reconstruct chronological steps from the notes.
   Each step should be a single, concrete action. Number them sequentially.
7. For `process_parameters`: only include parameters explicitly mentioned or
   clearly implied. If only setpoint is given, use "N/A" for actual and deviation.
8. For `observations`: extract ANY deviation from expected behavior: color changes,
   bubbling, smells, sounds, equipment alarms, timing discrepancies, unexpected
   intermediates. Set no_anomalies to true only if notes explicitly say nothing
   unusual happened. Otherwise default to false if any anomaly is mentioned.
9. For `conclusion`: directly answer the scientific question posed in the purpose
   section. If no purpose was stated, summarize the key finding. Keep to 1-3 sentences.
10. For `next_steps`: extract any explicitly mentioned future plans. If none
    mentioned, generate 2-3 reasonable next steps based on the experiment's results
    Do NOT prefix with "[ ]" or any checkbox markers.
11. If the notes are in Chinese, keep the extracted content in Chinese but
    preserve section keys in English.
12. If the notes mention sample IDs, file paths, or equipment IDs, preserve them exactly.
13. For the `date` field: use the date mentioned in notes, or today's date as default.
"""
