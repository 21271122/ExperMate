# 配置 ExperMate｜小同门

> 状态：当前实现
>
> 源码依据：`lib/config.py`、`app.py`、`routes/settings.py`

ExperMate 的设置由服务端数据目录的 `config.yaml` 保存。首次缺少该文件时读取同目录 `.env`；进程环境变量优先于 YAML。普通用户不能修改全局模型设置。

技术兼容性说明：当前环境变量、配置键和仓库目录仍使用 `EXDIARY_*` 前缀；产品名称已更新为 ExperMate｜小同门，但这些技术名称暂不改动。

## 最小配置

复制 `.env.example` 为服务端数据目录的 `.env`，填写模型服务信息：

```dotenv
LLM_AGENT_PROVIDER=deepseek
LLM_AGENT_API_KEY=你的密钥
LLM_AGENT_MODEL=你的模型名
PORT=5000
HOST=127.0.0.1
```

首次启动后管理员可在“设置”页面继续编辑模型参数。API Key、密码、数据库和同步密钥都不应提交到 Git。

## 模型设置

| 字段 | 用途 | 说明 |
| --- | --- | --- |
| `LLM_AGENT_PROVIDER` | 主 Agent 服务商 | 内置 `deepseek`、`qwen`、`zhipu`、`kimi`、`minimax`、`baidu`、`volcengine`、`custom` |
| `LLM_AGENT_API_KEY` | 主 Agent 密钥 | 敏感信息 |
| `LLM_AGENT_BASE_URL` | 兼容接口地址 | 内置服务商可留空；自定义服务必须填写 |
| `LLM_AGENT_MODEL` | 主 Agent 模型 | 用于日常对话、工具调用和图片读取 |
| `LLM_ANALYZE_PROVIDER` | 分析模型服务商 | 留空时继承主 Agent 服务商 |
| `LLM_ANALYZE_API_KEY` | 分析模型密钥 | 留空时继承主 Agent 密钥 |
| `LLM_ANALYZE_BASE_URL` | 分析模型接口 | 留空时继承主 Agent 地址 |
| `LLM_ANALYZE_MODEL` | 分析模型 | 留空时继承主 Agent 模型 |

图片附件会作为像素数据发送给当前主 Agent 模型。若该模型不支持视觉输入，`read_attachment` 会返回明确提示；不会退回到本地 OCR。

旧版 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL`、`DEEPSEEK_ANALYZE_MODEL` 仍会在首次读取时迁移，供旧配置兼容使用。新配置优先使用 `LLM_*` 字段。

## Agent 与分析

| 字段 | 默认值 | 用途 |
| --- | ---: | --- |
| `LLM_REASONING_EFFORT` | `max` | 主 Agent 推理强度；可选 `low`、`medium`、`high`、`max` |
| `CONTEXT_COMPRESSION_TRIGGER_TOKENS` | `300000` | 主聊天达到此估算 token 数时启动上下文整理 |
| `CONTEXT_COMPRESSION_CHUNK_TOKENS` | `260000` | 每次整理进入摘要的历史量，必须小于触发阈值 |
| `ANALYSIS_TIMEOUT_SECONDS` | `480` | 单次分析 Worker 请求上限，范围 60–1800 秒 |

上下文整理仅用于主聊天。记录和分析子 Agent 服务于当前任务，不使用主聊天的长期压缩机制。

## 服务端路径与权限

默认目录为项目下 `data/`，其中包含 `config.yaml`、`data.db`、账号库、恢复密钥、模板和日志。通过 `--data-dir` 或进程环境变量 `DATA_DIR`、`EXPERMATE_DATA_DIR`、`EXDIARY_DATA_DIR` 指定服务端目录。`EXDIARY_SETTINGS` / `--config` 可指定配置文件，`EXDIARY_DB` 可指定业务库。

`HOST` 默认 `127.0.0.1`，`PORT` 默认 `5000`，也可使用启动参数指定。监听地址、端口、管理员名单和 SMTP 均由运维管理；网页只提交模型参数。`GUI`、`OFFLINE_DEVICE_CODE`、`RELAY_*` 已删除，旧配置中的这些字段会被忽略。

`ADMIN_ACCOUNTS` 在 YAML 中是字符串列表，在进程环境中用逗号分隔。`ALLOW_REGISTRATION` 控制公开注册。`JWT_SECRET` 未配置时生成并保存；需随配置备份以保持会话签名稳定。账号和恢复材料位于服务端，不写入 Windows 凭据库。

恢复邮件使用 `SMTP_HOST`、`SMTP_PORT`（默认 587）、`SMTP_USERNAME`、`SMTP_PASSWORD`、`SMTP_FROM`，通过 STARTTLS 发送。未配置时恢复接口明确不可用，不在网页回显恢复凭证。

HTTPS 反代使用受控代理时设置 `TRUSTED_PROXY_HOPS`，默认 0。`ENCRYPTION_KEY` / `EXDIARY_ENC_KEY` 可启用服务端 SQLCipher；配置加密但缺少 SQLCipher 时拒绝启动。服务器能读取业务数据，账号隔离不是对服务器端到端加密。

完整配置优先级、初始化与旧数据导入见[服务端运行迁移说明](../server-runtime-migration.md)。
