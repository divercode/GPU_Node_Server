# 动态 IP 注册与失效告警

`ip_monitor.py` 是标准库脚本，不需要额外依赖。

## 记录内容

- `ip_registry.json`：当前各集群 IP、端口、健康状态、最后探测时间；
- `ip_alerts.jsonl`：IP 变化、连续不可达告警；
- **共用前端“系统状态”页的“集群 IP 记录”面板**：读取 registry/最近告警；
- systemd journal：`journalctl -u starrail-ip-monitor`；
- 可选 `IP_ALERT_WEBHOOK`：告警 JSON POST 到外部系统（企业微信/钉钉/Alertmanager 适配器均可）。

## 探测方式

每台服务器运行一份，互相探测对方固定端口：

| 集群 | 端口 | 健康路径 |
|---|---|---|
| GPU-Test-01 | 8080（公用前端网关） | `/healthz` |
| GPU-Test-02 | 8000（独立后端） | `/healthz` |

当前 IP 失效时，监控会扫描 `192.168.112.0/24` 的对应端口，并用 `/healthz` 确认新地址，更新 registry 并发出告警。

> 第二集群 8000 仅允许公用网关 `192.168.112.230` 和本机 `192.168.112.105` 访问，已由 `starrail-firewall.service` 持久化；其他主机直连 8000 会被 DROP。

## 部署

每台服务器：

```bash
cp tools/ip_monitor.py /home/test/ip_monitor.py
# 按本机角色写 /home/test/ip_monitor.json
sudo cp deploy/starrail-ip-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now starrail-ip-monitor.service
```

`/home/test/ip_monitor.json` 示例：

```json
{
  "self_cluster": "GPU-Test-01",
  "self_port": 8080,
  "peers": [
    { "cluster": "GPU-Test-02", "port": 8000, "ip": "192.168.112.105", "gateway_peer": true }
  ],
  "gateway_upstream_file": "/home/test/starrail-compose/gateway/cluster-b.conf",
  "gateway_reload_dir": "/home/test/starrail-compose"
}
```

`gateway_peer`/`gateway_upstream_file` 只配置在公用网关所在服务器；发现 B 新 IP 后会改写 `cluster-b.conf` 并执行 `docker compose exec -T gateway nginx -s reload`。该服务需要以 root 运行才能访问 Docker。

第二台服务器需对调 `self_cluster`/`self_port`，并把 peer 指向 `GPU-Test-01:8080`。

## 告警 webhook

在服务器 `/home/test/starrail-compose/.env` 中设置：

```dotenv
IP_ALERT_WEBHOOK=https://example.internal/hooks/ip-alert
```

脚本发送：

```json
{"text": "GPU-Test-02 IP 从 ... 变为 ...", "source": "starrail-ip-monitor"}
```

未配置 webhook 时只写 `ip_alerts.jsonl` 和 journal。

## 限制

- A 的监控会自动改写 **B 的上游地址**并 reload gateway；A 自身 IP 变化时公用入口地址仍会变化，需要依赖 B 的监控告警后再更新访问地址。
- 两台服务器同时发生 IP 变化时，单点监控无法保证发现；生产建议增加独立管理节点或 DDNS/DHCP 保留。
- 告警默认写文件和 systemd journal；要真正推送消息，必须配置 `IP_ALERT_WEBHOOK`。

## systemd

```ini
[Unit]
Description=StarRail dynamic IP registry and alert monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=test
Group=test
WorkingDirectory=/home/test
EnvironmentFile=/home/test/starrail-compose/.env
ExecStart=/usr/bin/python3 /home/test/ip_monitor.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```
