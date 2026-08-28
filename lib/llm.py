"""LLM 客户端 — OpenAI SDK 封装，含 ABC 抽象接口 + 指数退避重试。"""

from __future__ import annotations

import base64
import json
import time
from abc import ABC, abstractmethod
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

from openai import OpenAI, APIError, APITimeoutError, RateLimitError, APIConnectionError
from openai.types.chat import ChatCompletionChunk


@dataclass(frozen=True)
class ProviderPreset:
    """OpenAI 兼容厂商的少量协议差异。"""

    label: str
    base_url: str
    supports_reasoning_effort: bool = False
    preserve_reasoning_content: bool = False
    stream_usage: bool = False


# 仅列出本项目 Agent 所需的 Chat Completions 兼容入口；模型名由用户在设置中选择。
PROVIDER_PRESETS: dict[str, ProviderPreset] = {
    "deepseek": ProviderPreset(
        "DeepSeek", "https://api.deepseek.com", True, True, True),
    "qwen": ProviderPreset(
        "阿里云百炼 / 千问", "https://dashscope.aliyuncs.com/compatible-mode/v1", stream_usage=True),
    "zhipu": ProviderPreset("智谱 GLM", "https://open.bigmodel.cn/api/paas/v4/"),
    "kimi": ProviderPreset("Kimi / Moonshot", "https://api.moonshot.cn/v1"),
    "minimax": ProviderPreset("MiniMax", "https://api.minimaxi.com/v1"),
    "baidu": ProviderPreset("百度 AI Studio / 千帆", "https://aistudio.baidu.com/llm/lmapi/v3"),
    "volcengine": ProviderPreset("火山方舟 / 豆包", "https://ark.cn-beijing.volces.com/api/v3"),
    "custom": ProviderPreset("自定义 OpenAI 兼容服务", ""),
}


def provider_preset(name: str) -> ProviderPreset:
    """取得厂商预设；配置文件中的未知值按自定义兼容服务处理。"""
    return PROVIDER_PRESETS.get((name or "custom").strip().lower(), PROVIDER_PRESETS["custom"])


@dataclass
class LLMResponse:
    content: str
    reasoning: str = ""
    tool_calls: list[dict[str, Any]] | None = None
    usage: dict[str, int] | None = None


@dataclass
class StreamEvent:
    """流式输出中的单个事件。"""
    type: str  # "text" | "tool_call" | "done"
    content: str = ""           # text 事件时的增量文本
    tool_name: str = ""         # tool_call 事件时的工具名
    tool_args: str = ""         # tool_call 事件时的参数 JSON（增量累积）
    finished: LLMResponse | None = None  # done 事件时的完整响应


class AbstractLLMClient(ABC):
    """LLM 客户端抽象接口。只有 chat() 需要子类实现。"""

    @abstractmethod
    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        reasoning_effort: str | None = None,
    ) -> LLMResponse: ...

    def structured_extract(
        self,
        prompt: str,
        system_prompt: str,
        output_schema: dict[str, Any],
    ) -> dict[str, Any]:
        resp = self.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            tools=[{
                "type": "function",
                "function": {
                    "name": "save_experiment",
                    "description": "Save parsed experiment record",
                    "parameters": output_schema,
                },
            }],
        )
        if not resp.tool_calls:
            raise RuntimeError(f"Model did not call the function. Response: {resp.content[:200]}")
        return dict(json.loads(resp.tool_calls[0]["function"]["arguments"]))

    def describe_image(self, content: bytes, mime: str, name: str = "") -> str:
        """把图片像素直接交给当前模型阅读，不经本地 OCR。"""
        image_mime = mime if mime.startswith("image/") else "image/jpeg"
        encoded = base64.b64encode(content).decode("ascii")
        response = self.chat(
            messages=[
                {
                    "role": "system",
                    "content": (
                        "你负责阅读用户上传的图片附件。直接依据图像像素回答，"
                        "不要声称使用了 OCR，不要补造看不清的细节。"
                        "请用中文概括画面、可辨认文字、图表或实验信息，并说明不确定处。"
                    ),
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"请阅读图片附件：{name or '未命名图片'}。",
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:{image_mime};base64,{encoded}"},
                        },
                    ],
                },
            ],
            temperature=0.1,
            reasoning_effort="low",
        )
        return response.content.strip()

    def analyze(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        request_timeout: float | None = None,
        max_attempts: int = 3,
        reasoning_effort: str | None = None,
    ) -> str:
        """执行非流式分析；非默认参数由具体客户端实现。"""
        resp = self.chat(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            reasoning_effort=reasoning_effort,
        )
        return resp.content


class LLMClient(AbstractLLMClient):
    def __init__(
        self,
        api_key: str,
        model: str = "deepseek-v4-pro",
        base_url: str = "https://api.deepseek.com",
        provider: str = "deepseek",
        reasoning_effort: str = "max",
    ):
        self.provider = (provider or "custom").strip().lower()
        self.preset = provider_preset(self.provider)
        self.base_url = (base_url or self.preset.base_url).strip().rstrip("/")
        if not self.base_url:
            raise ValueError("自定义 OpenAI 兼容服务必须填写 Base URL")
        self.client = OpenAI(
            api_key=api_key,
            base_url=self.base_url,
            max_retries=0,   # 禁用 SDK 内置重试，完全由自定义逻辑接管
            timeout=30.0,
        )
        self.model = model
        self.default_reasoning_effort = reasoning_effort

    def _messages_for_provider(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """去掉非标准推理字段，避免兼容服务拒绝下一轮工具调用历史。

        DeepSeek 推理模型要求原样回传 reasoning_content，因此仅该预设保留。
        """
        if self.preset.preserve_reasoning_content:
            return messages
        result = []
        for message in messages:
            item = dict(message)
            item.pop("reasoning_content", None)
            item.pop("reasoning", None)
            result.append(item)
        return result

    def _request_kwargs(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None,
        temperature: float,
        reasoning_effort: str | None,
        stream: bool = False,
    ) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "model": self.model,
            "messages": self._messages_for_provider(messages),
            "temperature": temperature,
        }
        if tools:
            kwargs["tools"] = tools
        if reasoning_effort and self.preset.supports_reasoning_effort:
            kwargs["reasoning_effort"] = reasoning_effort
        if stream:
            kwargs["stream"] = True
            if self.preset.stream_usage:
                kwargs["stream_options"] = {"include_usage": True}
        return kwargs

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        reasoning_effort: str | None = None,
    ) -> LLMResponse:
        return self._chat_with_options(
            messages, tools, temperature,
            reasoning_effort or self.default_reasoning_effort,
        )

    def _chat_with_options(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        reasoning_effort: str | None = None,
        request_timeout: float | None = None,
        max_attempts: int = 3,
    ) -> LLMResponse:
        kwargs = self._request_kwargs(messages, tools, temperature, reasoning_effort)
        client = (self.client.with_options(timeout=request_timeout)
                  if request_timeout is not None else self.client)

        last_exception: Exception | None = None
        for attempt in range(max(1, max_attempts)):
            try:
                resp = client.chat.completions.create(**kwargs)
                msg = resp.choices[0].message
                return LLMResponse(
                    content=_content_text(getattr(msg, "content", "")),
                    reasoning=_reasoning_text(msg),
                    tool_calls=_tool_calls(getattr(msg, "tool_calls", None)),
                    usage=_usage_dict(getattr(resp, "usage", None)),
                )
            except RateLimitError as e:
                last_exception = e
                if attempt < max_attempts - 1:
                    retry_after = _parse_retry_after(e)
                    wait = max(retry_after, 5.0) if retry_after > 0 else _backoff(attempt)
                    time.sleep(wait)
            except (APITimeoutError, APIConnectionError) as e:
                last_exception = e
                if attempt < max_attempts - 1:
                    time.sleep(_backoff(attempt))
            except APIError as e:
                last_exception = e
                if attempt < max_attempts - 1:
                    time.sleep(_backoff(attempt))

        raise last_exception  # type: ignore[misc]

    def analyze(
        self,
        system_prompt: str,
        user_prompt: str,
        temperature: float = 0.3,
        request_timeout: float | None = None,
        max_attempts: int = 3,
        reasoning_effort: str | None = None,
    ) -> str:
        resp = self._chat_with_options(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            reasoning_effort=reasoning_effort or self.default_reasoning_effort,
            request_timeout=request_timeout,
            max_attempts=max_attempts,
        )
        return resp.content

    def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.3,
        reasoning_effort: str | None = None,
    ) -> Generator[StreamEvent, None, LLMResponse]:
        """流式 chat：逐 token 产出 text 事件，工具调用时产 tool_call 事件，
        流结束后产 done 事件，yield 结束返回完整 LLMResponse。"""
        kwargs = self._request_kwargs(
            messages, tools, temperature,
            reasoning_effort or self.default_reasoning_effort, stream=True,
        )

        last_exception: Exception | None = None
        for attempt in range(3):
            try:
                stream = self.client.chat.completions.create(**kwargs)
                content_chunks: list[str] = []
                reasoning_chunks: list[str] = []
                tool_calls_acc: dict[int, dict[str, Any]] = {}
                final_usage: dict[str, int] | None = None

                for chunk in stream:
                    if getattr(chunk, "usage", None):
                        final_usage = _usage_dict(chunk.usage)
                    delta = chunk.choices[0].delta if chunk.choices else None
                    if delta is None:
                        continue

                    # 文本增量
                    content = _content_text(getattr(delta, "content", ""))
                    if content:
                        content_chunks.append(content)
                        yield StreamEvent(type="text", content=content)

                    # 推理增量
                    reasoning = _reasoning_text(delta)
                    if reasoning:
                        reasoning_chunks.append(reasoning)

                    # 工具调用增量
                    if delta.tool_calls:
                        for tc_delta in delta.tool_calls:
                            idx = getattr(tc_delta, "index", None)
                            if idx is None:
                                idx = len(tool_calls_acc)
                            if idx not in tool_calls_acc:
                                tool_calls_acc[idx] = {
                                    "id": getattr(tc_delta, "id", "") or f"call_{idx}",
                                    "type": "function",
                                    "function": {"name": "", "arguments": ""},
                                }
                            elif getattr(tc_delta, "id", None):
                                tool_calls_acc[idx]["id"] = tc_delta.id
                            if getattr(tc_delta, "function", None):
                                if tc_delta.function.name:
                                    tool_calls_acc[idx]["function"]["name"] += tc_delta.function.name
                                if tc_delta.function.arguments:
                                    tool_calls_acc[idx]["function"]["arguments"] += _tool_arguments(tc_delta.function.arguments)
                            # 推送工具名
                            if tc_delta.function and tc_delta.function.name:
                                yield StreamEvent(
                                    type="tool_call",
                                    tool_name=tc_delta.function.name,
                                    tool_args=tool_calls_acc[idx]["function"]["arguments"],
                                )

                # 构建完整响应
                raw_tool_calls = [tool_calls_acc[i] for i in sorted(tool_calls_acc.keys())]
                resp = LLMResponse(
                    content="".join(content_chunks),
                    reasoning="".join(reasoning_chunks),
                    tool_calls=raw_tool_calls if raw_tool_calls else None,
                    usage=final_usage,
                )
                yield StreamEvent(type="done", finished=resp)
                return resp

            except RateLimitError as e:
                last_exception = e
                if attempt < 2:
                    retry_after = _parse_retry_after(e)
                    wait = max(retry_after, 5.0) if retry_after > 0 else _backoff(attempt)
                    time.sleep(wait)
            except (APITimeoutError, APIConnectionError) as e:
                last_exception = e
                if attempt < 2:
                    time.sleep(_backoff(attempt))
            except APIError as e:
                last_exception = e
                if attempt < 2:
                    time.sleep(_backoff(attempt))

        raise last_exception  # type: ignore[misc]


def _content_text(value: Any) -> str:
    """兼容少数服务把 content 返回为内容分片列表的情况。"""
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict):
                parts.append(str(item.get("text") or item.get("content") or ""))
            else:
                parts.append(str(getattr(item, "text", "") or getattr(item, "content", "") or ""))
        return "".join(parts)
    return str(value)


def _reasoning_text(message: Any) -> str:
    """统一 reasoning_content / reasoning / reasoning_details 的返回字段。"""
    for name in ("reasoning_content", "reasoning", "reasoning_text"):
        value = getattr(message, name, None)
        if value:
            return _content_text(value)
    details = getattr(message, "reasoning_details", None)
    if isinstance(details, list):
        return "".join(
            _content_text(item.get("text") if isinstance(item, dict) else getattr(item, "text", ""))
            for item in details
        )
    return ""


def _tool_arguments(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _tool_calls(calls: Any) -> list[dict[str, Any]] | None:
    if not calls:
        return None
    normalized = []
    for index, call in enumerate(calls):
        function = getattr(call, "function", None)
        if function is None and isinstance(call, dict):
            function = call.get("function") or {}
        get_value = (lambda name: function.get(name)) if isinstance(function, dict) else (lambda name: getattr(function, name, None))
        call_id = call.get("id") if isinstance(call, dict) else getattr(call, "id", None)
        normalized.append({
            "id": call_id or f"call_{index}",
            "type": "function",
            "function": {
                "name": get_value("name") or "",
                "arguments": _tool_arguments(get_value("arguments")),
            },
        })
    return normalized


def _usage_dict(usage: Any) -> dict[str, int] | None:
    if not usage:
        return None
    prompt = getattr(usage, "prompt_tokens", None)
    if prompt is None and isinstance(usage, dict):
        prompt = usage.get("prompt_tokens") or usage.get("input_tokens")
    completion = getattr(usage, "completion_tokens", None)
    if completion is None and isinstance(usage, dict):
        completion = usage.get("completion_tokens") or usage.get("output_tokens")
    return {"prompt_tokens": int(prompt or 0), "completion_tokens": int(completion or 0)}


def _backoff(attempt: int) -> float:
    """指数退避: 2s, 4s, 8s."""
    return 2.0 ** (attempt + 1)


def _parse_retry_after(exc: RateLimitError) -> float:
    """尝试从响应头读取 Retry-After。"""
    try:
        headers = getattr(exc, "response", None)
        if headers is not None:
            val = headers.headers.get("Retry-After")
            if val is not None:
                return float(val)
    except Exception:
        pass
    return 0.0
