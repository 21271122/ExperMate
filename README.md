# ExperMate｜小同门

> 你的实验记录与分析伙伴。

ExperMate 是一款由服务端统一管理数据和模型调用的实验记录应用。你可以通过对话记录实验、复刻既有实验、选择多条实验生成分析报告，并管理附件、分类和聊天历史。

浏览器负责交互，服务端保存配置、账号、实验、报告、附件和会话。浏览器与服务端通过同源 API 通信，业务数据按账号隔离。

## 适合谁

- 想把零散实验过程整理为可检索、可回溯记录的科研人员；
- 希望让 AI 协助补全实验字段、复刻方案和梳理结论的人；
- 需要把多次实验放在一起核对、比较并生成分析报告的人；
- 希望在自己管理的服务器上保存实验数据的人。

## 主要能力

- 对话式实验记录、复刻与结构化字段维护
- 跨实验分析与只读分析报告
- Excel、PDF、文本与图片等附件的预览和读取
- 图片附件直接交给当前视觉模型阅读；纯文本模型会明确提示不支持视觉
- 按时间翻阅和检索聊天记录
- 分类、置顶、归档与更新日志
- 记录/分析子线程、主对话上下文整理
- 账号登录与多浏览器共享服务端数据

## 快速开始（Windows）

需要 Python 3.12+ 和 Git。

```powershell
git clone https://github.com/21271122/ExperMate.git
cd ExperMate

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

New-Item -ItemType Directory -Force data
Copy-Item .env.example data/.env
# 编辑 data/.env，填入服务端模型 API Key
python -m flask --app app:create_app create-user --account admin --email admin@example.com --admin
# 按提示设置密码
python app.py --host 127.0.0.1 --port 5000
```

通过浏览器访问 <http://127.0.0.1:5000> 并登录。当前启动方式不再创建桌面窗口。
首次使用还需完成下方 React 构建。服务器部署与旧数据导入见[服务端运行迁移说明](docs/server-runtime-migration.md)。旧离线库不会自动导入，需手动指定归属账号。

### React 前端

默认 `/` 及各页面深链接已使用 React，`/app/` 保留为同一应用的别名。外壳、账号、聊天、实验列表/详情/编辑、分析报告、时间线、模板、对比、设置和预览已迁移，继续使用原双栏、Canvas、CSS、字体和动效。

首次启动前需要 Node.js 22.12+，在 `frontend/` 目录执行 `npm ci`、`npm run build`，再启动 Python 服务。部署必须包含构建后的 `frontend/dist/`；缺少构建时页面返回明确的 503 提示。开发与验收见 [React 前端说明](frontend/README.md)，后续服务端集中化见 [服务端与 React 重构方案](docs/server-react-refactoring-plan.md)。

## 数据与模型服务

- 实验、聊天、附件、模型密钥和运行配置均保存在部署的服务端；
- 模型请求由服务端发出，普通账号不能修改全局模型密钥；
- 登录过期后要求重新登录，不回退到离线库；
- 浏览器仅保留主题、列表视图和音量等显示偏好；
- 服务端能读取业务数据；当前模式不提供对服务端的端到端加密。

详细边界见[数据与隐私说明](docs/privacy.md)。

## 许可证

ExperMate 的项目代码采用 [Elastic License 2.0（ELv2）](LICENSE)。你可以免费使用、修改和再分发它；但不能把 ExperMate 的主要功能作为托管或受管理服务提供给第三方。ELv2 属于“源码可用”许可，并非 OSI 定义的开源许可证。第三方前端库与音频资源的许可见[第三方组件与音频声明](THIRD_PARTY_NOTICES.md)。

## 文档

- [配置模型与运行参数](docs/getting-started/configuration.md)
- [本地运行与常见问题](docs/getting-started/local-run.md)
- [数据、备份与恢复](docs/operations/data-and-backup.md)
- [服务器部署](docs/operations/deployment.md)
- [数据与隐私说明](docs/privacy.md)
- [更新日志](CHANGELOG.md)

## 数据安全

不要提交、公开上传或通过不可信渠道发送以下内容：`.env`、`config.yaml`、`data/` 目录、账号恢复材料和中继运行数据。

服务端集中存储不能替代备份。升级、迁移或重装前，请按[数据、备份与恢复](docs/operations/data-and-backup.md)完成完整备份。

## 反馈与支持

感谢您的使用！这是主包的个人项目，有很多地方做得非常粗糙，诚邀您填写问卷，我会持续迭代！

📋 [填写反馈问卷](https://v.wjx.cn/vm/PyP0GKm.aspx#)

### Buy me some tokens

本项目截至 2026 年 8 月底，共耗时 4 个月，消耗 60 亿+ tokens。如果觉得项目有帮助，可否小小补贴一下 token 的开销？

<img src="frontend/public/img/support-qr.png" alt="扫描二维码支持 ExperMate" width="180">
