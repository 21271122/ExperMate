"""配置模块 — Settings 加载/保存的唯一权威。

改造前配置逻辑散落在 app.py（模块级 config dict + global 更新），
且 routes 反向 `from app import save_settings`（循环依赖）。
现在由 ConfigManager 持有，app 与路由经注入访问（g.config_manager）。
"""

import warnings
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field
from lib.experiment_ids import new_device_code, normalize_device_code


class Settings(BaseModel):
    # 新模型配置。Agent/结构化提取与分析可分别选厂商；分析字段留空时继承 Agent。
    LLM_AGENT_PROVIDER: str = "deepseek"
    LLM_AGENT_API_KEY: str = ""
    LLM_AGENT_BASE_URL: str = ""
    LLM_AGENT_MODEL: str = ""
    LLM_REASONING_EFFORT: str = "max"
    # 主 Agent 当前会话的上下文整理策略；子 Agent 不使用该机制。
    CONTEXT_COMPRESSION_TRIGGER_TOKENS: int = Field(default=300_000, ge=10_000, le=1_000_000)
    CONTEXT_COMPRESSION_CHUNK_TOKENS: int = Field(default=260_000, ge=1_000, le=990_000)
    LLM_ANALYZE_PROVIDER: str = ""
    LLM_ANALYZE_API_KEY: str = ""
    LLM_ANALYZE_BASE_URL: str = ""
    LLM_ANALYZE_MODEL: str = ""
    ANALYSIS_TIMEOUT_SECONDS: int = Field(default=8 * 60, ge=60, le=30 * 60)
    # 保留旧键，确保现有 config.yaml / .env 不会因升级失效。
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_MODEL: str = "deepseek-v4-flash"
    DEEPSEEK_ANALYZE_MODEL: str = "deepseek-v4-pro"
    ENCRYPTION_KEY: str = ""       # 数据库加密密钥（空=不加密），生产环境通过环境变量设置
    JWT_SECRET: str = ""             # JWT 签名密钥（空=自动生成），生产环境通过环境变量设置
    RELAY_URL: str = ""             # 中继服务器地址（空=纯本地模式）
    RELAY_API_KEY: str = ""         # 中继 API Key
    PORT: int = Field(default=5000, ge=1024, le=65535)
    HOST: str = "0.0.0.0"
    GUI: str = "true"
    DATA_DIR: str = ""
    DEVICE_CODE: str = ""
    OFFLINE_DEVICE_CODE: str = ""

    def validate_model_names(self) -> None:
        known = {"deepseek", "qwen", "zhipu", "kimi", "minimax", "baidu", "volcengine", "custom"}
        for field_name in ("LLM_AGENT_PROVIDER", "LLM_ANALYZE_PROVIDER"):
            value = str(getattr(self, field_name) or "").lower()
            if value and value not in known:
                warnings.warn(f"{field_name}='{value}' 未内置预设，将按自定义 OpenAI 兼容服务处理。", stacklevel=2)
        if self.LLM_REASONING_EFFORT not in {"low", "medium", "high", "max"}:
            warnings.warn("LLM_REASONING_EFFORT 无效，已恢复为 max。", stacklevel=2)
            self.LLM_REASONING_EFFORT = "max"
        if self.CONTEXT_COMPRESSION_CHUNK_TOKENS >= self.CONTEXT_COMPRESSION_TRIGGER_TOKENS:
            warnings.warn("上下文整理量必须小于触发阈值，已恢复为 300000 / 260000。", stacklevel=2)
            self.CONTEXT_COMPRESSION_TRIGGER_TOKENS = 300_000
            self.CONTEXT_COMPRESSION_CHUNK_TOKENS = 260_000


def _parse_dotenv(path: Path) -> dict[str, str]:
    cfg: dict[str, str] = {}
    if not path.exists():
        return cfg
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key:
                cfg[key] = value
    return cfg


class ConfigManager:
    """进程级配置管理器。

    - `load()` 返回 dict 兼容视图（model_dump），并与内部 `view` 同一引用
    - `save()` 落盘 + 原地更新传入 dict + 更新权威视图 `view`，
      保证 g.config（= view）始终反映最新配置
    """

    def __init__(self, settings_path: Path) -> None:
        self.settings_path = settings_path
        self.settings: Settings | None = None
        self.view: dict[str, Any] = {}

    def load(self) -> dict[str, Any]:
        """加载配置。config.yaml 优先；否则回退 .env（并落盘为 config.yaml）。"""
        if self.settings_path.exists():
            with open(self.settings_path, "r", encoding="utf-8") as f:
                raw = yaml.safe_load(f) or {}
            self.settings = Settings(**raw)
            self.settings.validate_model_names()
        else:
            old = _parse_dotenv(self.settings_path.with_name(".env"))
            self.settings = Settings(
                LLM_AGENT_PROVIDER=old.get("LLM_AGENT_PROVIDER", "deepseek"),
                LLM_AGENT_API_KEY=old.get("LLM_AGENT_API_KEY", old.get("DEEPSEEK_API_KEY", "")),
                LLM_AGENT_BASE_URL=old.get("LLM_AGENT_BASE_URL", ""),
                LLM_AGENT_MODEL=old.get("LLM_AGENT_MODEL", old.get("DEEPSEEK_MODEL", "")),
                LLM_ANALYZE_PROVIDER=old.get("LLM_ANALYZE_PROVIDER", ""),
                LLM_ANALYZE_API_KEY=old.get("LLM_ANALYZE_API_KEY", ""),
                LLM_ANALYZE_BASE_URL=old.get("LLM_ANALYZE_BASE_URL", ""),
                LLM_ANALYZE_MODEL=old.get("LLM_ANALYZE_MODEL", old.get("DEEPSEEK_ANALYZE_MODEL", "")),
                DEEPSEEK_API_KEY=old.get("DEEPSEEK_API_KEY", ""),
                DEEPSEEK_MODEL=old.get("DEEPSEEK_MODEL", "deepseek-v4-flash"),
                DEEPSEEK_ANALYZE_MODEL=old.get("DEEPSEEK_ANALYZE_MODEL", "deepseek-v4-pro"),
                PORT=int(old.get("PORT", "5000")),
                HOST=old.get("HOST", "0.0.0.0"),
                GUI=old.get("GUI", "true"),
                DATA_DIR=old.get("DATA_DIR", old.get("EXPERMATE_DATA_DIR", old.get("EXDIARY_DATA_DIR", ""))),
            )
            self.save(self.settings)
        changed = self._migrate_legacy_llm_settings()
        self.view = self.settings.model_dump()
        if changed:
            self.save(self.settings)
        return self.view

    def _migrate_legacy_llm_settings(self) -> bool:
        """首次读取旧配置时填充新字段，后续保存不再依赖 DeepSeek 专用键。"""
        if self.settings is None:
            return False
        changed = False
        if not self.settings.LLM_AGENT_API_KEY:
            self.settings.LLM_AGENT_API_KEY = self.settings.DEEPSEEK_API_KEY
            changed = True
        if not self.settings.LLM_AGENT_MODEL:
            self.settings.LLM_AGENT_MODEL = self.settings.DEEPSEEK_MODEL
            changed = True
        if not self.settings.LLM_ANALYZE_MODEL:
            self.settings.LLM_ANALYZE_MODEL = self.settings.DEEPSEEK_ANALYZE_MODEL
            changed = True
        code = normalize_device_code(self.settings.DEVICE_CODE)
        if not code:
            code = new_device_code()
        if code != self.settings.DEVICE_CODE:
            self.settings.DEVICE_CODE = code
            changed = True
        offline_code = normalize_device_code(self.settings.OFFLINE_DEVICE_CODE)
        if not offline_code or offline_code == code:
            offline_code = new_device_code()
            while offline_code == code:
                offline_code = new_device_code()
        if offline_code != self.settings.OFFLINE_DEVICE_CODE:
            self.settings.OFFLINE_DEVICE_CODE = offline_code
            changed = True
        return changed

    def save(self, data: Settings | dict[str, Any]) -> dict[str, Any]:
        """保存配置。dict 输入先规范化（表单字符串 → 类型）。

        落盘后原地更新传入 dict 与权威视图 view（外部引用保持新鲜）。
        """
        if isinstance(data, dict):
            # 强制类型转换，防止表单提交的字符串值（如 PORT="5000"）被 Pydantic 拒绝
            normalized: dict[str, Any] = {}
            for k, v in data.items():
                if k == "PORT" and isinstance(v, str):
                    normalized[k] = int(v)
                elif k == "GUI":
                    normalized[k] = str(v).lower() if isinstance(v, (bool, int)) else str(v).strip()
                else:
                    normalized[k] = str(v).strip() if isinstance(v, str) else v
            # 关键修复：与现有配置合并，避免"设置保存"重建整份 config 时，
            # 把 STORAGE_BACKEND/RELAY_URL/RELAY_API_KEY/ENCRYPTION_KEY/JWT_SECRET 等
            # 表单未提供的进阶字段重置为默认值（导致静默退回 YAML 后端/丢失中继配置）。
            base = self.settings.model_dump() if self.settings is not None else {}
            merged = {**base, **normalized}
            self.settings = Settings(**merged)
        else:
            self.settings = data
        clean: dict[str, Any] = self.settings.model_dump()
        with open(self.settings_path, "w", encoding="utf-8") as f:
            yaml.dump(clean, f, allow_unicode=True, sort_keys=False, default_flow_style=False, indent=2)
        if isinstance(data, dict):
            data.clear()
            data.update(clean)
        self.view.clear()
        self.view.update(clean)
        return clean
