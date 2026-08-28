"""
实验 Schema 定义 + 默认上下文 + 受控词汇表。
纯数据常量，零依赖。
"""

from typing import Any

EXPERIMENT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "title": {"type": "string"},
        "date": {"type": "string"},
        "experimenter": {"type": "string"},
        "status": {"type": "string", "enum": ["planned", "running", "done", "failed", "repeated"]},
        "tags": {"type": "array", "items": {"type": "string"}},
        "purpose": {"type": "string"},
        "materials": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "purity": {"type": "string"},
                    "vendor": {"type": "string"},
                    "amount": {"type": "string"},
                    "notes": {"type": "string"}
                },
                "required": ["name"]
            }
        },
        "equipment": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "device": {"type": "string"},
                    "model": {"type": "string"},
                    "location": {"type": "string"}
                },
                "required": ["device"]
            }
        },
        "experimental_plan": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "group": {"type": "string"},
                    "condition": {"type": "string"},
                    "expected": {"type": "string"}
                }
            }
        },
        "sop": {"type": "array", "items": {"type": "string"}},
        "process_parameters": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "step": {"type": "string"},
                    "parameter": {"type": "string"},
                    "setpoint": {"type": "string"},
                    "actual": {"type": "string"},
                    "deviation": {"type": "string"}
                }
            }
        },
        "observations": {
            "type": "object",
            "properties": {
                "no_anomalies": {"type": "boolean"},
                "items": {"type": "array", "items": {"type": "string"}}
            },
            "required": ["no_anomalies", "items"]
        },
        "characterization": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "method": {"type": "string"},
                    "sample_id": {"type": "string"},
                    "preparation": {"type": "string"},
                    "submission_date": {"type": "string"},
                    "data_path": {"type": "string"}
                }
            }
        },
        "results": {
            "type": "object",
            "properties": {
                "qualitative": {"type": "string"},
                "key_data": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "metric": {"type": "string"},
                            "value": {"type": "string"},
                            "comparison": {"type": "string"},
                            "change": {"type": "string"}
                        }
                    }
                },
                "figures": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "figure": {"type": "string"},
                            "path": {"type": "string"},
                            "conclusion": {"type": "string"}
                        }
                    }
                }
            }
        },
        "conclusion": {"type": "string"},
        "next_steps": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["id", "title", "purpose", "sop", "observations", "conclusion"]
}


DEFAULT_CONTEXT: dict[str, Any] = {
    "title": "",
    "date": "",
    "experimenter": "",
    "status": "planned",
    "tags": [],
    "purpose": "",
    "materials": [],
    "equipment": [],
    "experimental_plan": [],
    "sop": [],
    "process_parameters": [],
    "observations": {"no_anomalies": True, "items": []},
    "characterization": [],
    "results": {"qualitative": "", "key_data": [], "figures": []},
    "conclusion": "",
    "next_steps": [],
}


TAG_VOCABULARY: list[str] = [
    "synthesis", "characterization",
    "photocatalysis", "electrochemistry", "sintering", "ball-milling", "thin-film",
    "XRD", "SEM", "TEM", "mechanical-testing", "thermal-analysis", "DFT",
    "sol-gel", "hydrothermal", "co-precipitation", "calcination", "doping",
    "coating", "corrosion", "battery", "ceramic", "polymer", "composite", "nano",
    "perovskite-solar", "spin-coating",
]
