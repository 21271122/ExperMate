"""
Exdiary 统一日志系统 — 四个 JSONL 文件覆盖父子 Agent 全部行为。

   agent.log      对话消息（父子Agent混排，agent字段区分）
   tools.log      工具调用摘要
   operations.log 文件/状态变更
   system.log     启动/错误

用法:
    from lib.logger import init_logger, get_logger
    init_logger("/path/to/experiments")
    log = get_logger()
    log.agent("parent", "user", content="记录新实验")
    log.tool("parent", "load_reference", ok=True, refs=["EXP-003"])
    log.operation("exp_saved", exp="EXP-021", agent="child")
    log.system("error", "exception", path="/api/agent/message", error="...")
"""

import json, sys, traceback
from datetime import datetime
from pathlib import Path

_logger = None


def init_logger(base_dir: str | Path) -> "ExdiaryLogger":
    global _logger
    _logger = ExdiaryLogger(Path(base_dir))
    return _logger


def get_logger() -> "ExdiaryLogger | None":
    return _logger


class ExdiaryLogger:
    def __init__(self, base_dir: Path):
        self.dir = base_dir / "_logs"
        self.dir.mkdir(parents=True, exist_ok=True)

    # -- 内部 --

    def _write(self, filename: str, entry: dict):
        entry["ts"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
        try:
            with open(self.dir / filename, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            print("[Exdiary] 日志写入失败", file=sys.stderr)

    def _agent_type(self, loop) -> str:
        """从 AgentLoop 实例推断 agent 类型。"""
        if loop is None:
            return "?"
        return "child" if loop.child.is_child else "parent"

    def _agent_exp(self, loop) -> str | None:
        if loop is None:
            return None
        return loop.child.exp_id if loop.child.is_child else None

    # -- agent.log --

    def agent(self, agent: str, role: str, content: str,
              tool_calls: list[str] | None = None, exp: str | None = None):
        entry = {"agent": agent, "role": role, "content": content[:2000]}
        if tool_calls:
            entry["tool_calls"] = tool_calls
        if exp:
            entry["exp"] = exp
        self._write("agent.log", entry)

    def agent_user(self, loop, content: str):
        self.agent(self._agent_type(loop), "user", content,
                   exp=self._agent_exp(loop))

    def agent_assistant(self, loop, content: str, tool_calls: list[str] | None = None):
        self.agent(self._agent_type(loop), "assistant", content,
                   tool_calls=tool_calls, exp=self._agent_exp(loop))

    # -- tools.log --

    def tool(self, agent: str, tool_name: str, ok: bool,
             exp: str | None = None, **summary):
        entry = {"agent": agent, "tool": tool_name, "ok": ok}
        if exp:
            entry["exp"] = exp
        entry.update({k: v for k, v in summary.items() if v})
        self._write("tools.log", entry)

    def tool_from_loop(self, loop, tool_name: str, ok: bool, **summary):
        self.tool(self._agent_type(loop), tool_name, ok,
                  exp=self._agent_exp(loop), **summary)

    # -- operations.log --

    def operation(self, op: str, agent: str | None = None, **kwargs):
        entry = {"op": op}
        if agent:
            entry["agent"] = agent
        entry.update({k: v for k, v in kwargs.items() if v is not None})
        self._write("operations.log", entry)

    def op_from_loop(self, loop, op: str, **kwargs):
        self.operation(op, agent=self._agent_type(loop), **kwargs)

    # -- system.log --

    def system(self, level: str, event: str, **kwargs):
        entry = {"level": level, "event": event}
        entry.update({k: v for k, v in kwargs.items() if v is not None})
        self._write("system.log", entry)

    def exception(self, event: str, **kwargs):
        """记录异常（自动附带 traceback）。"""
        self.system("error", event,
                    traceback=traceback.format_exc()[-2000:],
                    **kwargs)
