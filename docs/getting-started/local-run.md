# 运行 ExperMate 服务端

需要 Python 3.12+、Node.js 22.12+ 和 Git。图片附件由模型视觉能力读取，不要求 Tesseract。

```powershell
python -m pip install -r requirements.txt
Push-Location frontend
npm ci
npm run build
Pop-Location
New-Item -ItemType Directory -Force data
Copy-Item .env.example data/.env
# 编辑 data/.env 的模型配置。
python -m flask --app app:create_app create-user --account admin --email admin@example.com --admin
python app.py --host 127.0.0.1 --port 5000
```

从浏览器访问 <http://127.0.0.1:5000> 并登录。Linux/macOS 使用对应 shell 的目录和环境变量命令即可。

当前不启动桌面窗口，也不安装 pywebview。`--headless` 只作为旧命令兼容参数。默认只监听本机；局域网/服务器部署需由运维明确配置地址和访问入口。

- 缺少 React 构建时页面返回 503：在 `frontend/` 运行 `npm ci`、`npm run build`。
- 未配置模型时仍可登录和管理记录，AI 对话提示模型不可用：请管理员配置模型。
- 旧库没有显示：新模式不自动搬迁旧库，不把未登录请求回退到离线库。按导入说明手动指定账号。
- 登录过期：重新登录；不使用浏览器旧会话缓存冒充恢复成功。
- 端口占用：停止原服务，或通过 `--port` 使用其他端口。

部署、数据路径和迁移步骤见[服务端运行迁移说明](../server-runtime-migration.md)。

Windows 本机后台部署（Waitress、启动/停止脚本与日志位置）见[本地部署说明](../../deploy/local-windows/README.md)。
