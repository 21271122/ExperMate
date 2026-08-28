# ExperMate｜小同门

> 你的实验记录与分析伙伴。

ExperMate 是一款本地优先的实验记录应用。你可以通过对话记录实验、复刻既有实验、选择多条实验生成分析报告，并管理附件、分类和聊天历史。

它不是云端笔记网站：数据默认保存在当前设备的 SQLite 数据库中。登录后按账号加载数据；多设备同步是可选功能，中继只保存加密后的同步数据，不承担模型调用。

## 适合谁

- 想把零散实验过程整理为可检索、可回溯记录的科研人员；
- 希望让 AI 协助补全实验字段、复刻方案和梳理结论的人；
- 需要把多次实验放在一起核对、比较并生成分析报告的人；
- 希望数据主要留在自己电脑，而不是默认上传到陌生云端的人。

## 主要能力

- 对话式实验记录、复刻与结构化字段维护
- 跨实验分析与只读分析报告
- Excel、PDF、文本与图片等附件的预览和读取
- 图片附件直接交给当前视觉模型阅读；纯文本模型会明确提示不支持视觉
- 按时间翻阅和检索聊天记录
- 分类、置顶、归档与更新日志
- 记录/分析子线程、主对话上下文整理
- 可选的账号登录与端到端加密多设备同步

## 快速开始（Windows）

需要 Python 3.12+、Git 和 Git LFS。Git LFS 用于下载内置音频资源。

```powershell
git clone https://github.com/21271122/ExperMate.git
cd ExperMate
git lfs install
git lfs pull

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

Copy-Item .env.example .env
# 编辑 .env，填入你的模型 API Key
python app.py
```

依次执行以上命令即可启动。

默认会启动桌面窗口，也可通过网页访问，不需要桌面端，只需网页服务时使用：

```bash
python app.py --headless
```

默认网页地址：<http://127.0.0.1:5000>

## 数据与模型服务

- 实验、聊天、附件和设置默认保存在本机；
- 只有在你发起 AI 请求时，完成该请求所需的对话、实验内容或附件才会发送给你自行配置的模型服务商；
- 可选同步中继只处理加密同步数据，不能替代本机备份；
- 前端依赖已经随仓库提供，启动页面不再请求第三方 CDN。

详细边界见[数据与隐私说明](docs/privacy.md)。

## 许可证

ExperMate 的项目代码采用 [Elastic License 2.0（ELv2）](LICENSE)。你可以免费使用、修改和再分发它；但不能把 ExperMate 的主要功能作为托管或受管理服务提供给第三方。ELv2 属于“源码可用”许可，并非 OSI 定义的开源许可证。第三方前端库与音频资源的许可见[第三方组件与音频声明](THIRD_PARTY_NOTICES.md)。

## 文档

- [配置模型与运行参数](docs/getting-started/configuration.md)
- [本地运行与常见问题](docs/getting-started/local-run.md)
- [数据、备份与恢复](docs/operations/data-and-backup.md)
- [服务器与同步中继部署](docs/operations/deployment.md)
- [数据与隐私说明](docs/privacy.md)
- [更新日志](CHANGELOG.md)

## 数据安全

不要提交、公开上传或通过不可信渠道发送以下内容：`.env`、`config.yaml`、`data/` 目录、账号恢复材料和中继运行数据。

同步用于让设备保持一致，不替代备份。升级、迁移或重装前，请按[数据、备份与恢复](docs/operations/data-and-backup.md)完成完整备份。

## 反馈与支持

感谢您的使用！这是主包的个人项目，有很多地方做得非常粗糙，诚邀您填写问卷，我会持续迭代！

📋 [填写反馈问卷](https://v.wjx.cn/vm/PyP0GKm.aspx#)

### Buy me some tokens

本项目截至 2026 年 8 月底，共耗时 4 个月，消耗 60 亿+ tokens。如果觉得项目有帮助，可否小小补贴一下 token 的开销？

<img src="static/img/support-qr.png" alt="扫描二维码支持 ExperMate" width="180">
