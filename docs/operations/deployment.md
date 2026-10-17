# 部署 ExperMate｜小同门

> 状态：当前实现
>
> 源码依据：`app.py`、`wsgi.py`、`lib/config.py`

ExperMate 主应用集中负责账号、配置、实验、会话、附件和模型调用。当前主应用不再接入旧同步中继。初始化与导入见[服务端运行迁移说明](../server-runtime-migration.md)。

```text
浏览器
        │ HTTPS
        ▼
Nginx ─────► ExperMate 主应用（Flask，单 worker，SQLite）
```

正式上线按[部署与数据切换清单](production-cutover.md)逐项执行，包括目标确认、发布版本、配置、迁移、验收、切换与回退。

## 主应用（Ubuntu / Debian）

```bash
sudo adduser --system --group --home /opt/expermate expermate
sudo mkdir -p /opt/expermate /var/lib/expermate
sudo chown -R expermate:expermate /opt/expermate /var/lib/expermate

sudo -u expermate git clone https://github.com/21271122/ExperMate.git /opt/expermate/app
cd /opt/expermate/app
sudo -u expermate git lfs install
sudo -u expermate git lfs pull
sudo -u expermate python3.12 -m venv /opt/expermate/venv
sudo -u expermate /opt/expermate/venv/bin/pip install -r requirements.txt
```

创建 `/var/lib/expermate/config.yaml`：

```yaml
LLM_AGENT_PROVIDER: deepseek
LLM_AGENT_API_KEY: 请替换为真实密钥
LLM_AGENT_MODEL: 请填写可用模型
HOST: 127.0.0.1
PORT: 8765
ALLOW_REGISTRATION: false
TRUSTED_PROXY_HOPS: 1
```

```bash
sudo chown -R expermate:expermate /var/lib/expermate
sudo chmod 700 /var/lib/expermate
sudo chmod 600 /var/lib/expermate/config.yaml
```

创建 `/etc/systemd/system/expermate.service`：

```ini
[Unit]
Description=ExperMate web application
After=network.target

[Service]
Type=simple
User=expermate
Group=expermate
WorkingDirectory=/opt/expermate/app
Environment=EXDIARY_SETTINGS=/var/lib/expermate/config.yaml
Environment=EXPERMATE_DATA_DIR=/var/lib/expermate
Environment=PYTHONUTF8=1
ExecStart=/opt/expermate/venv/bin/gunicorn --workers 1 --threads 8 --bind 127.0.0.1:8765 --timeout 1800 wsgi:application
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now expermate
sudo systemctl status expermate
curl http://127.0.0.1:8765/
```

必须使用单个 Gunicorn worker。当前应用使用 SQLite、流式消息和进程内实时状态；多 worker 会让这些状态在不同进程间分裂。

## HTTPS 反向代理

以 Nginx 为例：

```nginx
server {
    listen 80;
    server_name expermate.example.com;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 1860s;
    }
}
```

为域名配置 HTTPS。不要把 Flask 开发服务器或未加密的登录入口直接暴露到公网。

## 旧中继

旧中继、同步网关和 Windows 凭据模块已删除。当前服务通过同一个服务端数据库共享数据，不配置 `RELAY_*`；旧协议只能从历史 Git 版本运行。

部署前构建 `frontend/dist/`；创建管理员时使用与 systemd 相同的数据目录和配置环境，执行 `python -m flask --app app:create_app create-user --account admin --email admin@example.com --admin`。旧离线数据按迁移文档显式导入，不能仅更改数据库路径代替归属迁移。
