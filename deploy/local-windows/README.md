# Windows 本地服务部署

当前本机已部署到 <http://localhost:8765>，使用 Waitress 单进程、16 线程运行完整服务端。浏览器只负责页面交互；配置、模型调用、实验、附件和会话保存在服务端。

在项目根目录运行：

```powershell
& ./deploy/local-windows/start.ps1
& ./deploy/local-windows/stop.ps1
# 换端口前先停止服务：
& ./deploy/local-windows/start.ps1 -Port 8766
```

启动脚本在后台运行，关闭终端后服务继续运行。停止脚本验证进程身份，只停止本项目记录的 Waitress 进程。电脑重启后需要再次启动；尚未配置 Windows 开机服务。

本机运行目录为 `data/local-server/`（已被 Git 忽略）：

| 文件 | 用途 |
| --- | --- |
| `config.yaml` | 服务端模型配置和管理员名单 |
| `data.db` | 实验、附件及会话数据库 |
| `access.json` | 本次部署生成的 `local-admin`、`local-reader` 账号及随机密码，仅供本机验收 |
| `stdout.log`、`stderr.log` | 启动和运行日志，重新启动会覆盖这两个输出文件 |
| `server.pid` | 当前服务的进程编号 |

账号库、密钥及其它运行文件也由应用写入此目录。备份应停止服务后复制整个目录，并妥善保存其中的配置、密码与密钥。不要提交该目录。

这次仅复制了已有模型设置，没有导入旧实验、附件或会话；注册入口已关闭。旧库仍由你稍后指定账号并手动导入。服务仅监听 `127.0.0.1`，当前不能通过其它电脑访问。

## 在另一台 Windows 机器安装

需要 Python 3.12+ 和 Node.js 22.12+。在项目根目录执行：

```powershell
python -m venv .venv
& ./.venv/Scripts/python.exe -m pip install -r requirements.txt
Push-Location frontend
npm ci
npm run build
Pop-Location
$env:EXPERMATE_DATA_DIR = "$PWD/data/local-server"
$env:DATA_DIR = $env:EXPERMATE_DATA_DIR
$env:EXDIARY_SETTINGS = "$env:DATA_DIR/config.yaml"
$env:EXDIARY_DB = "$env:DATA_DIR/data.db"
& ./.venv/Scripts/python.exe -m flask --app app:create_app create-user --account admin --email admin@example.com --admin
& ./deploy/local-windows/start.ps1
```

创建账号时按提示设置密码；登录后在设置页面配置模型。不要把本机验收用的 `access.json` 当作固定默认密码配置。当前本机 `.venv` 为复用已安装依赖而使用 `--system-site-packages` 创建，另行安装了 Waitress 3.0.2；新机器按上面完整安装即可。

长对话仍在进程内执行，停止或重启会中断尚未完成的任务；已保存的数据保留。公网部署的 HTTPS、代理和备份要求见[上线检查表](../../docs/operations/production-cutover.md)。Waitress 参数见[官方文档](https://docs.pylonsproject.org/projects/waitress/en/latest/arguments.html)。
