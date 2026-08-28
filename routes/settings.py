from flask import Blueprint, request, render_template, g
from lib.llm import PROVIDER_PRESETS

settings_bp = Blueprint("settings", __name__)

# GET 页面路由已迁移到 fragments_bp（/_fragment/settings）


def _masked_key(value: str) -> str:
    return value[:4] + "****" + value[-4:] if len(value) > 8 else ("*" * len(value))


def settings_template_context(config):
    """设置页所需的厂商预设和脱敏密钥，供普通页与 fragment 复用。"""
    return {
        "providers": [
            {"id": provider_id, "label": preset.label, "base_url": preset.base_url}
            for provider_id, preset in PROVIDER_PRESETS.items()
        ],
        "masked_agent_key": _masked_key(config.get("LLM_AGENT_API_KEY", "")),
        "masked_analyze_key": _masked_key(config.get("LLM_ANALYZE_API_KEY", "")),
    }


def _submitted_secret(name: str) -> str:
    """空密码框表示“不修改”，避免仅改模型名时清空已有 API Key。"""
    return request.form.get(name, "").strip() or g.config.get(name, "")


def _analysis_timeout_seconds() -> int:
    """设置页以分钟展示，配置层以秒保存。"""
    try:
        minutes = int(request.form.get("ANALYSIS_TIMEOUT_MINUTES", "8"))
    except (TypeError, ValueError):
        minutes = 8
    return max(1, min(minutes, 30)) * 60


def _reasoning_effort() -> str:
    value = (request.form.get("LLM_REASONING_EFFORT") or "max").strip().lower()
    return value if value in {"low", "medium", "high", "max"} else "max"


def _context_compression_settings() -> tuple[int, int]:
    """表单按 token 接收；压缩量必须小于触发阈值，才能留出最近上下文。"""
    try:
        trigger = int(request.form.get("CONTEXT_COMPRESSION_TRIGGER_TOKENS", "300000"))
        chunk = int(request.form.get("CONTEXT_COMPRESSION_CHUNK_TOKENS", "260000"))
    except (TypeError, ValueError):
        raise ValueError("上下文整理参数必须是整数。")
    if not 10_000 <= trigger <= 1_000_000:
        raise ValueError("触发阈值须在 10,000 到 1,000,000 token 之间。")
    if not 1_000 <= chunk < trigger:
        raise ValueError("每次整理量须不少于 1,000 token，且必须小于触发阈值。")
    return trigger, chunk


@settings_bp.route("/settings", methods=["POST"])
def settings_save():
    try:
        compression_trigger, compression_chunk = _context_compression_settings()
    except ValueError as exc:
        fragment = request.args.get("fragment") == "1" or request.headers.get("X-Fragment") == "1"
        return render_template("settings.html", config=g.config, error=str(exc), fragment=fragment,
                               **settings_template_context(g.config)), 400
    data = {
        "LLM_AGENT_PROVIDER": request.form.get("LLM_AGENT_PROVIDER", "deepseek"),
        "LLM_AGENT_API_KEY": _submitted_secret("LLM_AGENT_API_KEY"),
        "LLM_AGENT_BASE_URL": request.form.get("LLM_AGENT_BASE_URL", ""),
        "LLM_AGENT_MODEL": request.form.get("LLM_AGENT_MODEL", ""),
        "LLM_REASONING_EFFORT": _reasoning_effort(),
        "CONTEXT_COMPRESSION_TRIGGER_TOKENS": compression_trigger,
        "CONTEXT_COMPRESSION_CHUNK_TOKENS": compression_chunk,
        "LLM_ANALYZE_PROVIDER": request.form.get("LLM_ANALYZE_PROVIDER", ""),
        "LLM_ANALYZE_API_KEY": _submitted_secret("LLM_ANALYZE_API_KEY"),
        "LLM_ANALYZE_BASE_URL": request.form.get("LLM_ANALYZE_BASE_URL", ""),
        "LLM_ANALYZE_MODEL": request.form.get("LLM_ANALYZE_MODEL", ""),
        "ANALYSIS_TIMEOUT_SECONDS": _analysis_timeout_seconds(),
        "PORT": request.form.get("PORT", "5000"),
        "HOST": request.form.get("HOST", "0.0.0.0"),
        "GUI": request.form.get("GUI", "false"),
    }
    # 经注入的 ConfigManager 持久化（避免反向 import app）
    g.config_manager.save(data)
    # 判断是否为片段请求（Shell 内 fetch）
    fragment = request.args.get("fragment") == "1" or request.headers.get("X-Fragment") == "1"
    return render_template("settings.html", config=g.config,
                          success="模型配置、思考强度、会话整理与分析时限已保存；后续主 Agent 对话会使用新设置。端口和 GUI 修改需重启应用生效。",
                          fragment=fragment, **settings_template_context(g.config))
