# 部署 ExperMate｜小同门

> 状态：当前实现
>
> 源码依据：`app.py`、`lib/e2ee/relay_server.py`

ExperMate 主应用负责登录、实验、聊天、附件和模型调用。可选同步中继只保存加密后的同步数据。

```text
浏览器 / 桌面端
        │ HTTPS
        ▼
Nginx ─────► ExperMate 主应用（Flask，单 worker，SQLite）
        │
        └────► 可选同步中继（Flask，保存加密数据包）
```

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
GUI: "false"
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
Environment=EXPERMATE_DATA_DIR=/var/lib/expermate/data
Environment=PYTHONUTF8=1
ExecStart=/opt/expermate/venv/bin/gunicorn --workers 1 --threads 8 --bind 127.0.0.1:8765 --timeout 600 "app:create_app()"
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
        proxy_read_timeout 620s;
    }
}
```

为域名配置 HTTPS。不要把 Flask 开发服务器或未加密的登录入口直接暴露到公网。

## 可选同步中继

中继应使用独立 HTTPS 域名，并部署在 `127.0.0.1:5055` 后由 Nginx 反代：

```bash
RELAY_PORT=5055 RELAY_DB=/var/lib/expermate/relay.db \
  /opt/expermate/venv/bin/python -m lib.e2ee.relay_server
```

客户端设置：

```yaml
RELAY_URL: https://relay.example.com
RELAY_API_KEY: 高强度随机密钥
```

升级前请先按[数据、备份与恢复](data-and-backup.md)完成备份。中继不解密数据，但中继运行数据同样需要访问控制、HTTPS 和独立备份。
