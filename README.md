# 星轨算力 GPU 平台（容器化）

面向两台自用 GPU 服务器的 GPU 监控、作业管理、告警、用量和审计平台。当前不包含费用、账单或计价功能。

## 当前测试生产入口

- 公用前端 + 统一 OIDC：`https://192.168.112.230/`
- 集群 A 后端：`192.168.112.230`（GPU-Test-01）
- 集群 B 后端：`192.168.112.105:8000`（GPU-Test-02，仅公用网关访问）
- HTTP `8080` 只保留 `/healthz` 和 GPU agent 采集路径，其他请求跳转 HTTPS。
- 当前 TLS 为内部自签证书；首次可通过 HTTP 下载证书：`http://192.168.112.230:8080/portal.crt`，安装到受信任根证书后再访问 HTTPS。正式 CA/OOD Apache 入口仍未接入。

## 部署

```powershell
Copy-Item .env.example .env
# 修改 PUBLIC_BASE_URL、证书、数据库/Redis 密码
docker compose up -d --build
```

详细步骤见 [deploy/README.md](deploy/README.md)。

## 目录

| 路径 | 说明 |
|---|---|
| `frontend/` | 零依赖静态 SPA，支持集群 API 前缀切换 |
| `backend/` | Python HTTP 后端、RBAC、PostgreSQL/Redis、审计链、GPU agent |
| `gateway/` | Nginx 8080/8443：TLS、静态资源、OIDC 代理、集群 B 反代 |
| `dex/` | Dex OIDC 配置模板与 FreeIPA LDAP 示例 |
| `docker-compose.yml` | gateway/backend/dex/oauth2-proxy/postgres/redis |
| `deploy/` | 部署、验证、生产门禁和联调记录 |
| `tools/` | 动态 IP 注册/告警监控 |
| `ip/` | 软件著作权与专利草案（本地材料，不参与部署） |

## 本地开发

```powershell
cd backend
$env:AUTH_MODE='local'
$env:PORTAL_SESSION_SECRET='dev-session-secret-change-me-1234567890'
$env:PORTAL_DATABASE_URL='postgresql://postgres@127.0.0.1:5432/starrail'
$env:PORTAL_REDIS_URL='redis://127.0.0.1:6379/0'
python app.py --host 0.0.0.0 --port 8080
```

无数据库/Redis 时会降级到内存，仅用于静态预览。

## GPU agent

```powershell
python backend/agent.py --server gpu-01 --backend http://127.0.0.1:8080 --token <PORTAL_COLLECTOR_TOKEN>
```

agent 走内网采集端点，不经过用户 OIDC；容器部署时由 systemd 托管。

## 当前边界

- 公用前端 + 独立后端已联调；集群 B 不单独提供前端。
- PostgreSQL 保存 jobs/alerts/gpu_telemetry/audit_events；Redis 保存缓存、限流、会话撤销。
- 动态 IP 记录与告警见 [tools/README.md](tools/README.md)；B 的上游地址可由 IP 监控自动改写并 reload gateway。
- 实时：前端通过 SSE `/api/v1/stream/events` 直接应用 GPU/作业/告警快照；SSE 不可用时回退 15s 轮询。
- Slurm/DCGM/Prometheus/FreeIPA/OOD 仍未接入；users/system/rules 仍有雏形数据。
- 当前是内部自签 TLS，生产需正式证书、OOD Apache、FreeIPA/MFA。
- 生产联调门禁见 [deploy/PRODUCTION-READINESS.md](deploy/PRODUCTION-READINESS.md)。
