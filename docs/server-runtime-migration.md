# 服务端运行迁移与运维说明

更新：2026-10-16。本轮承接 React 迁移，保留原双栏布局、CSS、字体、预览与交互。

## 1. 当前运行边界

```text
浏览器（React、文件选择、音频、外观偏好）
  │ 同源 HTTP / HTTPS、HttpOnly Cookie、SSE
  ▼
ExperMate 服务端（Flask 工厂、账号校验、业务 API、Agent、模型客户端）
  ├─ data.db：按账号隔离的实验、分析、收藏、附件、音乐和会话
  ├─ _e2ee_accounts.db + _e2ee_kms.key：账号认证与恢复材料
  ├─ config.yaml：服务端模型与运行配置
  ├─ experiment_templates/：服务端模板
  └─ _logs/：服务端运行日志
         │
         └─ 部署者配置的模型服务商 / SMTP
```

所有客户端使用同一服务端仓储。模型密钥与部署路径不由浏览器管理；普通用户不能修改全局模型设置。管理员可在原设置页编辑模型参数。主题、音量、列表视图与窗口标识仍可保存在浏览器，这些是界面偏好，不是业务数据副本。

未登录、账号不存在、Cookie 无效或账号 epoch 变化均拒绝业务访问；没有匿名离线回退。React 外壳与登录页可公开加载。实验、打印、搜索、模板读取、音乐、上传、附件下载与事件订阅都受认证保护。

当前是可信服务端架构：服务端会读取业务明文并调用模型，不能宣称对服务端端到端加密。历史 `e2ee` 模块名保留用于账号与恢复组件，不代表当前业务数据采用客户端加密。

## 2. 本轮代码变化

| 部分 | 结果 |
| --- | --- |
| 应用生命周期 | `app.py` 导入不加载配置、不打开数据库；`create_app()` 装配独立实例 |
| 配置 | 数据目录内 YAML；同名进程环境变量优先；保存使用锁和原子替换 |
| 模型 | 服务端按当前配置创建主模型和分析模型客户端，密钥不发送给普通用户 |
| 数据 | 服务端一套 SQLite 仓储，业务请求统一注入账号；跨账号同编号写入被拒绝 |
| 会话 | 主/子会话、线程、压缩原文均持久化到服务端 SQLite；浏览器旧 state 不作为恢复来源 |
| 子记录确认 | 只使用服务端生成的待确认预览，并检查实验 revision；拒绝客户端伪造预览 |
| 并发 | 同账号模型写会话互斥；实验编辑保留 revision 冲突检查；索引和摘要不复用跨账号缓存 |
| 附件 | 文件选择后上传到账号附件表；下载使用浏览器；不需要桌面保存桥接 |
| 旧图片 | `/uploads/...` 仅查询导入后的账号附件映射，不读取服务器任意目录 |
| 账号恢复 | SMTP 发送恢复凭证；接口不回显 token；没有邮件服务时明确返回不可用 |
| 历史入口 | 移除浏览器离线导入和同步状态路由；不初始化离线库、Windows 凭据库或同步网关 |
| 启动 | 删除桌面窗口启动与 pywebview 安装依赖；保留 `--headless` 为无效果兼容参数 |

旧同步引擎、网关、中继、后台 watcher、Windows 凭据库、离线运行库、旧 YAML 收藏仓储和 E2EE 演示入口已删除；仓储同步回调、同步队列接口与过时配置也已移除。当前账号口令与恢复组件仍保留。旧工作区仅通过下文的显式导入命令读取；需要旧同步协议时应使用历史 Git 版本，当前版本不再承载它。

## 3. 初始化服务端

需要 Python 3.12+，构建前端需要 Node.js 22.12+。

```powershell
python -m pip install -r requirements.txt
Push-Location frontend
npm ci
npm run build
Pop-Location

# 使用明确的新目录，先验收，再进行真实数据切换。
$env:EXPERMATE_DATA_DIR = 'D:/ExperMateServer/data'
New-Item -ItemType Directory -Force $env:EXPERMATE_DATA_DIR
Copy-Item .env.example "$env:EXPERMATE_DATA_DIR/.env"
# 编辑该 .env 的模型配置，或直接由进程环境提供 LLM_*。
python -m flask --app app:create_app create-user --account admin --email admin@example.com --admin
python app.py --host 127.0.0.1 --port 5000
```

创建账号时终端提示输入密码，不需要把密码写进命令行。`--admin` 将账号加入服务端管理员配置。其他账号可通过登录页注册，或由运维执行同一命令但省略 `--admin`。设置 `ALLOW_REGISTRATION=false` 进程环境变量或 YAML 布尔值可关闭公共注册。

如已通过环境变量 `ADMIN_ACCOUNTS` 固定管理员名单，先将新管理员加入该环境变量；环境覆盖不会被网页或 CLI 改写。

默认监听 `127.0.0.1:5000`。浏览器通过这个地址登录即可；不同电脑访问同一部署地址，共享同账号服务端数据。正式部署使用下面的 WSGI 方式。

## 4. 配置与路径

优先级：工厂运行覆盖 > 同名进程环境变量 > YAML > 默认值。CLI 的 `--host` / `--port` 仅决定本次监听地址。`DATA_DIR` 环境变量、`EXPERMATE_DATA_DIR`、`EXDIARY_DATA_DIR` 都可选择数据目录，前者优先；不指定时为项目的 `data/`。

`EXDIARY_SETTINGS` 可指定 YAML 路径，默认是数据目录的 `config.yaml`。仅在该文件不存在时，读取其同目录的 `.env`，迁移传统模型、监听与路径字段。新字段请直接写 YAML 或进程环境，不依赖旧 `.env` 迁移器。根目录旧 `config.yaml` 不会自动覆盖新服务端配置，需运维明确指定或复制需要的设置。

`EXDIARY_DB` 可覆盖主 SQLite 路径；通常保持数据目录默认布局即可。账号库、恢复密钥和模板均由工厂置于数据目录。`--data-dir`、`--config` 也可用于明确指定。旧配置中的 `GUI`、`OFFLINE_DEVICE_CODE`、`RELAY_*` 已退役，加载时忽略，保存时不再保留。

主要服务端专用配置：

| 配置 | 用途 |
| --- | --- |
| `ADMIN_ACCOUNTS` | YAML 字符串列表；进程环境变量为逗号分隔账号 |
| `ALLOW_REGISTRATION` | 是否允许浏览器注册，默认 true |
| `JWT_SECRET` | 会话签名；未配置时生成并保存到 YAML；多次启动须保持稳定 |
| `TRUSTED_PROXY_HOPS` | 默认 0；仅经受控代理访问时设为实际可信代理层数 |
| `SMTP_HOST/PORT/USERNAME/PASSWORD/FROM` | 邮件恢复服务，使用 STARTTLS；默认端口 587 |
| `LLM_AGENT_*` / `LLM_ANALYZE_*` | 主模型与分析模型配置，留空分析配置可继承主模型 |
| `EXDIARY_ENC_KEY` / `ENCRYPTION_KEY` | 可选服务端 SQLCipher；配置后 SQLCipher 不可用会拒绝启动 |

原设置页不再提供监听地址、端口或 GUI 选项。这些变更需更新部署配置并重启。

## 5. 手动导入旧 SQLite 工作区

**本次不导入真实旧库。归属由用户稍后指定。** 导入工具仅在临时数据库上验收。

操作顺序：停止旧服务和新业务服务；备份旧完整数据目录；创建目标账号；使用明确路径运行导入；验收成功后启动新服务。执行 CLI 时必须与新服务使用相同的数据目录、配置及数据库环境变量。

```powershell
$env:EXPERMATE_DATA_DIR = 'D:/ExperMateServer/data'
python -m flask --app app:create_app import-workspace `
  --source 'D:/OldExperMate/data/offline.db' `
  --account '你手动指定的账号' `
  --backup-dir 'D:/ExperMateBackups'
```

有 `/uploads/...` 旧图片引用时，额外指定 `--uploads-dir 'D:/OldExperMate/data/uploads'`（应指向包含 `_draft/` 或实验子目录的那一层）。源库如果原本已按账号存储，使用 `--source-user '旧账号'`；默认只导入空字符串作用域，即旧离线数据，不混入其他账号。

工具会：

1. 以只读连接读取源库，通过 SQLite backup 保留含 WAL 已提交数据的一致快照。
2. 在写入前保存源库快照和目标库备份。
3. 保留实验与分析 ID、引用字段、收藏、线程索引、主/子会话、压缩历史、更新日志、附件和音乐数据，并改写账号作用域。
4. 校验附件 SHA256 与实验附件引用；缺失内容时拒绝导入。旧图片限制在显式上传目录内，转换为账号附件与旧 URL 映射。
5. 一个事务内写入并重建搜索索引、推进编号计数；任意碰撞或异常回滚业务写入。
6. 保存计数、内容指纹和备份位置；同内容再次导入同账号返回已导入，不重复写入。

目标账号必须为空。跨账号全局 ID 碰撞也会拒绝，不重新编号或覆盖。遇到冲突应先检查备份及归属，不能靠删除未知数据继续。工具支持当前 SQLite 表结构及兼容子集；不支持直接读取加密源库、YAML 实验目录或仅存在于旧浏览器缓存的会话。加密源库需先用对应旧版本和密钥导出可读取的 SQLite 副本；YAML 与浏览器独有数据需另行整理，不能被工具静默丢弃。

自定义模板不在业务 SQLite 中。停服后将需要的旧模板 YAML 人工审查并复制到新数据目录的 `experiment_templates/`；模型配置也由运维显式转入，不随实验导入。

验收至少核对：实验/分析计数、详情字段、附件下载、收藏、主对话刷新恢复、子对话和历史搜索。源库及备份保留到验收结束；回退时停止新服务，再使用旧版本及旧目录。

## 6. 部署与当前限制

Linux 使用单个 worker、多线程：

```bash
export EXPERMATE_DATA_DIR=/var/lib/expermate
gunicorn --workers 1 --threads 8 --bind 127.0.0.1:8765 --timeout 1800 wsgi:application
```

不要使用 `--preload` 或多个 worker；当前连接、互斥锁、SSE 订阅和活动生成状态属于单进程。SSE 长连接会占用线程，部署应按同时在线量安排线程数。超时时间需覆盖配置的模型最长请求。

Nginx 代理需保留 Host、覆盖 `X-Forwarded-Proto`，关闭缓冲，并设置足够长的读取超时。HTTPS 代理后设 `TRUSTED_PROXY_HOPS=1`，且后端只允许该代理访问，才能正确判断同源写入和 Secure Cookie。示例见[部署说明](operations/deployment.md)。

会话结果和工具执行检查点已持久化，重启后可恢复已保存的历史。**生成任务尚未转为持久任务队列**：请求断开或进程重启可能中断当前生成，不能保证自动续跑、恰好执行一次或跨进程事件恢复。后续如需这些能力，应独立实现任务表/队列、任务状态和重连协议；这不属于本轮运行位置与依赖迁移的已完成范围。

## 7. 验证入口

```powershell
python -m pytest tests/test_server_runtime.py tests/test_workspace_import.py tests/test_sqlite_backend.py tests/test_react_frontend.py
Push-Location frontend
npm test
npm run build
Pop-Location
```

覆盖：真实工厂、匿名与失效凭证拒绝、账号与实例隔离、跨账号写入、附件边界、管理员权限、配置原子保存、恢复凭证、服务端会话恢复、子预览与 revision、导入备份/完整性/回滚。浏览器验收记录另见本轮验收文档。
