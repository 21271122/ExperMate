# 本地运行 ExperMate｜小同门

> 状态：当前实现
>
> 源码依据：`app.py`、`requirements.txt`、`pyproject.toml`

## 前置条件

- Python 3.12 或更高版本；
- Git；推荐安装 Git LFS，以获取内置背景音乐和音效；
- 桌面窗口需要 `pywebview` 可用。若不可用，仍可使用网页模式；
- 可用的 OpenAI 兼容模型 API Key。

图片附件由模型视觉能力读取，不要求安装 Tesseract。

## Windows

使用系统已安装的 Python 3.12+ 安装依赖后，直接运行 `python app.py` 即可启动；不需要 Anaconda、虚拟环境或 `run.bat`。

```powershell
git clone https://github.com/21271122/ExperMate.git
cd ExperMate
git lfs install
git lfs pull

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

Copy-Item .env.example .env
notepad .env
python app.py
```

在 `.env` 中至少填写 `LLM_AGENT_API_KEY` 和 `LLM_AGENT_MODEL`。第一次启动会生成 `config.yaml`；以后可通过设置页修改。

首次升级到新目录结构时，启动会将根目录旧的数据库、账号密钥、旧上传文件和日志迁移到 `data/`。迁移前请先完全退出旧的桌面窗口和网页服务；SQLite 数据库及其 WAL/SHM 文件会作为一组处理。

## macOS / Linux

```bash
git clone https://github.com/21271122/ExperMate.git
cd ExperMate
git lfs install
git lfs pull

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

cp .env.example .env
${EDITOR:-vi} .env
python app.py --headless
```

## 启动方式

| 命令 | 结果 |
| --- | --- |
| `python app.py` | 启动网页服务，并尝试打开桌面窗口 |
| `python app.py --headless` | 只启动网页服务 |

默认网页地址是 <http://127.0.0.1:5000>。终端也会显示可用于局域网访问的地址；开放给局域网前，请确认 `HOST`、防火墙和账号安全设置。

## 常见问题

**桌面窗口没有打开**：使用 `python app.py --headless`，再从浏览器访问本机地址；这不影响核心功能。

**背景音乐或音效缺失**：在仓库目录执行 `git lfs pull` 后重启。

**图片附件提示模型不支持视觉**：在设置中选择具备视觉输入能力的主 Agent 模型；本地不会以 OCR 替代。

**登录后看见的数据不对**：退出并重新登录，确认当前账号；未登录时应用使用 `data/offline.db`，登录后使用账号作用域的数据。

**端口已被占用**：修改 `PORT` 后重启应用。

## 开发检查

```bash
python -m pip install -e ".[dev]"
python -m pytest
```

CI 的类型与格式检查仍在清理历史基线；做功能改动时，优先运行与改动模块对应的测试。

服务器部署见[部署文档](../operations/deployment.md)。
