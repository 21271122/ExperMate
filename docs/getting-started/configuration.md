# 配置 ExperMate｜小同门

> 状态：当前实现
>
> 源码依据：`lib/config.py`、`app.py`、`routes/settings.py`

ExperMate 的设置由 `config.yaml` 保存。首次启动时，如果同目录没有 `config.yaml`，程序会读取 `.env`，迁移为 `config.yaml`，之后以 `config.yaml` 为准。

技术兼容性说明：当前环境变量、配置键和仓库目录仍使用 `EXDIARY_*` 前缀；产品名称已更新为 ExperMate｜小同门，但这些技术名称暂不改动。

## 最小配置

复制 `.env.example` 为 `.env`，填写模型服务信息：

```dotenv
LLM_AGENT_PROVIDER=deepseek
LLM_AGENT_API_KEY=你的密钥
LLM_AGENT_MODEL=你的模型名
PORT=5000
GUI=true
```

首次启动后可在“设置”页面继续编辑。API Key、密码、数据库和同步密钥都不应提交到 Git。

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

## 运行与本机数据

| 字段 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | Flask 监听地址；公开或局域网部署前应评估访问控制 |
| `PORT` | `5000` | 本地服务端口 |
| `GUI` | `true` | 是否尝试打开 pywebview 桌面窗口 |
| `DEVICE_CODE` | 自动生成 | 当前登录数据设备的编号前缀 |
| `OFFLINE_DEVICE_CODE` | 自动生成 | 离线数据设备的编号前缀 |

启动参数 `--headless` 会只启动网页服务，不打开桌面窗口。

默认运行数据统一放在项目根目录的 `data/`。在 `.env` 或 `config.yaml` 中设置 `DATA_DIR` 可改为其他目录；部署环境也可用 `EXPERMATE_DATA_DIR` 覆盖，旧变量 `EXDIARY_DATA_DIR` 仍可使用。`EXDIARY_DB`、`EXDIARY_ACCOUNT_DB`、`EXDIARY_KMS_KEY_FILE` 仍可分别覆盖单个文件路径，主要用于部署或多实例测试。

## 安全与同步

| 字段 | 用途 |
| --- | --- |
| `ENCRYPTION_KEY` | 可选的数据库加密密钥；生产环境优先通过环境变量提供 |
| `JWT_SECRET` | 登录令牌签名密钥；为空时程序生成并写入本机配置 |
| `RELAY_URL` | 可选同步中继地址；为空时为纯本地模式 |
| `RELAY_API_KEY` | 中继访问密钥；敏感信息 |

账户安全状态、恢复邮箱与恢复材料由本机账号库管理。它们和数据库一样属于必须备份、不可公开的内容。

## 配置位置与生效方式

- `EXDIARY_SETTINGS`：指定 `config.yaml` 的位置。
- `DATA_DIR`：写入 `.env` 或 `config.yaml` 的运行数据目录，包含业务数据库、账号安全库、旧附件兼容文件与日志。
- `EXPERMATE_DATA_DIR`：部署环境中覆盖 `DATA_DIR` 的运行数据目录。
- `EXDIARY_DATA_DIR`：`EXPERMATE_DATA_DIR` 的旧名称，保留兼容。
- `EXDIARY_DB`：指定登录数据数据库位置。
- `EXDIARY_ACCOUNT_DB`、`EXDIARY_KMS_KEY_FILE`：服务器部署时指定账号库与密钥文件位置。
- 通过设置页保存的配置会写回 `config.yaml`；涉及监听地址、端口、桌面窗口和进程级模型客户端的改动，建议重启应用后确认。

完整启动步骤见[本地运行](local-run.md)；备份边界见[数据、备份与恢复](../operations/data-and-backup.md)。
