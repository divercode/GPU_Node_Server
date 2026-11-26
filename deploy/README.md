# 部署说明（容器化 · 公务前端 / 独立后端）

## 1. 当前拓扑

```text
浏览器
  │ HTTPS 443（自签证书，待正式 CA）
  ▼
230 gateway（8080 健康检查/采集 + 8443 TLS）
  ├─ /           公用 SPA（OIDC 登录）
  ├─ /api/       集群 A 后端
  └─ /cluster-b/ 集群 B 后端（105:8000，仅允许 230 访问）
```

- 230：gateway/backend/dex/oauth2-proxy/postgres/redis
- 105：backend/postgres/redis；gateway/dex/oauth2-proxy 已停止
- 105 的 8000 端口由 `starrail-firewall.service` 限制为只允许 230 和 105 本机。
- 两套后端数据独立；B 通过 230 的 Dex 会话认证。

## 2. 配置 `.env`

```dotenv
PUBLIC_BASE_URL=https://192.168.112.230
PORTAL_HTTP_PORT=8080
PORTAL_HTTPS_PORT=443
PORTAL_COOKIE_SECURE=true
POSTGRES_PASSWORD=<随机值>
REDIS_PASSWORD=<随机值>
PORTAL_PROXY_SECRET=<随机值>
PORTAL_SESSION_SECRET=<随机值>
PORTAL_COLLECTOR_TOKEN=<随机值>
OAUTH2_PROXY_CLIENT_SECRET=<随机值>
OAUTH2_PROXY_COOKIE_SECRET=<32 hex>
IP_ALERT_WEBHOOK=<可选>
```

证书放在 `certs/portal.crt`、`certs/portal.key`；当前为自签证书。首次可先访问 `http://192.168.112.230:8080/portal.crt` 下载并安装到“受信任的根证书颁发机构”，再访问 HTTPS。正式生产应换内部 CA/正式证书。

## 3. 启动

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f gateway backend dex oauth2-proxy postgres redis
```

- HTTP `8080`：仅 `/healthz` 和 `/api/v1/collector/ingest`，其他请求 308 到 HTTPS。
- HTTPS `443`：SPA、API、Dex、OAuth2。
- 访问 `https://192.168.112.230/`，Dex 登录邮箱 `linya@hpc.local`。

第二集群（只后端）：

```bash
docker compose stop gateway dex oauth2-proxy
docker compose -f docker-compose.yml -f deploy/docker-compose.backend-only.yml up -d backend
```

## 4. 健康检查

```bash
curl -k https://192.168.112.230/healthz
curl -k https://192.168.112.230/dex/.well-known/openid-configuration
cat /home/test/ip_registry.json
tail -f /home/test/ip_alerts.jsonl
```

## 5. 生产替换点

- **入口**：设计 D-01 要求 OOD Apache 作为唯一业务 HTTPS 入口；当前 Nginx 是等价过渡入口。
- **TLS**：替换自签证书为内部 CA/正式证书；已启用 TLS1.2/1.3、HSTS、Secure cookie。
- **身份**：替换 Dex 静态密码为 FreeIPA/LDAP + 管理员 MFA。
- **数据源**：接 slurmrestd/slurmdbd/Prometheus/DCGM；当前 jobs/alerts/usage 仍是雏形。
- **实时**：SSE `/api/v1/stream/events` 直接推送 GPU/作业/告警快照；SSE 不可用时回退 15s 轮询。
- **多集群**：当前是共享前端 + 独立后端，不是 P2 数据联邦。
- **IP**：动态 IP 记录/告警见 `tools/README.md`；B 上游已可自动改写，A 自身换 IP 需更新访问地址。

## 6. 常见问题

### 登录后 500 Internal Server Error / invalid code_verifier

这是 oauth2-proxy 在 HTTPS 切换后读到了旧的 HTTP PKCE cookie，或用户刷新了已使用过的 callback URL。处理：

1. 不要刷新错误页，直接打开 `https://192.168.112.230/`；
2. 仍失败时清除该站点的 cookie，或用无痕窗口重新登录；
3. 当前 oauth2-proxy cookie 名已改为 `starrail_oauth2`，旧 `_oauth2_proxy` cookie 不再参与登录。

### 浏览器提示证书不受信任

先通过 `http://192.168.112.230:8080/portal.crt` 下载证书，安装到「受信任的根证书颁发机构」，再访问 HTTPS。

