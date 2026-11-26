# 星轨算力 · 平台后端

两台 GPU 服务器、全部自用。后端只负责**身份映射、RBAC、GPU/作业/告警只读 API、采集上报**；不包含任何费用/账单/计价功能。

## 两种认证模式（对齐设计说明书 §5.3 / §9.3 / §13.2）

### 1. 生产/容器模式（默认，`AUTH_MODE=proxy`）

```
浏览器 → 8080 Nginx gateway → oauth2-proxy → Dex(OIDC)
                              → /api/* → 本服务（仅内网）
```

- 浏览器会话由 oauth2-proxy + Dex 建立，后端不保存密码；
- 网关注入 `X-Auth-Request-User`、`X-Auth-Request-Email`、`X-Auth-Request-Groups` 与共享密钥 `X-Portal-Proxy-Secret`；
- 后端只信任带正确共享密钥的请求，**不信任前端传参**；
- 组到角色映射：`hpc-admins→admin`、`hpc-ops→ops`、`hpc-pi-*→pi`、`hpc-finance→auditor`、`hpc-users→user`；
- 内网 Dex 静态密码演示版本不返回 groups 时，后端按 `auth_users.json` 的本地角色缓存兜底；生产 FreeIPA LDAP 以 groups claim 为准。

### 2. 本地开发模式（`AUTH_MODE=local`）

无 Docker / 无 Dex 时，后端自己提供 `/login` 表单、PBKDF2 密码校验和 HMAC 签名会话 cookie，用于联调：

```powershell
$env:AUTH_MODE='local'
$env:PORTAL_SESSION_SECRET='dev-session-secret-change-me-1234567890'
python app.py --host 0.0.0.0 --port 8080
```

本地开发账号（密码仅用于本地联调，生产不生效）：

| 用户 | 密码 | 角色 |
|---|---|---|
| `linya` | `Admin@12345` | 平台管理员 |
| `chenyz` | `Ops@12345` | 运维人员 |
| `zhangqm` | `Pi@12345` | PI |
| `shenyr` | `User@12345` | 普通用户 |

> 密码哈希在 `auth_users.json`；生产身份由 Dex/FreeIPA 提供，本文件仅用于本地角色缓存。

## 持久层（PostgreSQL + Redis）

| 组件 | 用途 |
|---|---|
| PostgreSQL 16 | `jobs`、`alerts`、`gpu_telemetry`、`audit_events`（哈希链） |
| Redis 7 | 最新遥测缓存、登录/API 限流、本地会话撤销 |

启动时 `store.py` 自动建表；生产环境 `PORTAL_REAL_DATA=1` 不写入演示种子数据，只从 PostgreSQL 加载已有记录；非生产模式可用种子数据初始化。容器设置 `PORTAL_DB_REQUIRED=1`、`PORTAL_REDIS_REQUIRED=1`，依赖不可用时启动失败，不会静默丢持久化。

审计链路：

- 每条事件包含 `prev_hash`、`hash`；哈希覆盖时间、操作人、角色、动作、对象、详情、结果、IP、UA、request_id、prev_hash；
- 追加时使用 PostgreSQL advisory lock 串行化，避免并发分叉；
- `audit_events` 上有 append-only 触发器，UPDATE/DELETE 直接报错；
- `GET /api/v1/audit/verify` 从创世哈希重算全链，返回 `valid/checked/broken_at/head_hash`。

真实来源 IP：

- local 模式只使用 TCP `client_address`，忽略可伪造的 `X-Forwarded-For`；
- proxy 模式在网关共享密钥校验通过后使用 Nginx 覆盖写入的 `X-Real-IP`；
- 审计 `ip` 字段记录真实来源，不再统一写 `proxy`。

## API

统一前缀 `/api/v1`，响应格式 `{code,message,data,request_id}`；错误码对齐设计说明书 §9.6。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/healthz` | 公开 | 容器健康检查 |
| GET | `/api/health` | 公开 | 旧版健康检查 |
| GET | `/api/v1/health` | 公开 | 健康检查（含 auth_mode） |
| GET | `/api/v1/me` | 已登录 | 当前用户、组、角色、账号 |
| GET | `/api/v1/cluster` | 已登录 | 集群配置与 catalog |
| GET | `/api/v1/catalog` | 已登录 | 分区、GPU 型号、可用资源 |
| GET | `/api/v1/nodes` | admin/ops/auditor | 节点状态 |
| GET | `/api/v1/gpus` | admin/ops/auditor | GPU 指标 |
| GET | `/api/v1/jobs` | 已登录（普通用户仅本人） | 作业列表 |
| GET | `/api/v1/jobs/{id}` | 本人 / admin/ops/auditor | 作业详情 |
| POST | `/api/v1/jobs/{id}/cancel` | 本人 / admin/ops；需 CSRF | 取消作业 |
| GET | `/api/v1/alerts` | admin/ops/auditor | 告警列表 |
| POST | `/api/v1/alerts/{id}/ack` | admin/ops；需 CSRF | 确认告警 |
| GET | `/api/v1/usage?scope=self\|group\|global` | 已登录；global 仅 admin/ops/auditor | GPU·h 用量 |
| GET | `/api/v1/users` | admin/ops | 用户目录（来自 auth_users 缓存） |
| GET | `/api/v1/audit` | admin/ops/auditor | PostgreSQL 审计事件（哈希链） |
| GET | `/api/v1/audit/verify` | admin/ops/auditor | 校验审计哈希链 |
| GET | `/api/v1/system/status` | admin/ops | 组件健康（静态检查） |
| GET | `/api/v1/sync/status` | admin/ops | LDAP 同步状态 |
| POST | `/api/v1/collector/ingest` | `X-Collector-Token` | GPU agent 上报 |

请求 ID 来自 `X-Request-Id` 或自动生成；写操作使用 double-submit CSRF：`/api/v1/me` 下发 HttpOnly `portal_csrf` cookie 和 token，请求头 `X-CSRF-Token` 必须与 cookie 一致，同时校验同源 Origin。

## GPU 服务器 agent

每台 GPU 服务器运行：

```powershell
python agent.py --server gpu-01 --backend http://<内网IP>:8080 --token <PORTAL_COLLECTOR_TOKEN>
python agent.py --server gpu-02 --backend http://<内网IP>:8080 --token <PORTAL_COLLECTOR_TOKEN>
```

- 通过 8080 的 `/api/v1/collector/ingest` 上报，不经过 OIDC 会话，只校验采集 token；
- 采集字段：GPU index/UUID/温度/功耗/利用率/显存；
- XID/ECC/NVLink 等硬件错误下一阶段接 dcgm-exporter / Prometheus。

无 GPU 开发机验证：

```powershell
python agent.py --server gpu-01 --backend http://127.0.0.1:8080 --token <token> --mock --once
```

## 环境变量

| 变量 | 说明 |
|---|---|
| `AUTH_MODE` | `proxy`（容器）或 `local`（开发） |
| `PORTAL_PROXY_SECRET` | 网关共享密钥，proxy 模式必填 |
| `PORTAL_SESSION_SECRET` | 本地会话签名密钥 |
| `PORTAL_COLLECTOR_TOKEN` | agent 上报 token |
| `PORTAL_COOKIE_SECURE` | HTTPS 时设为 true |
| `PORTAL_DATABASE_URL` | PostgreSQL DSN；设置后持久化，容器必填 |
| `PORTAL_REDIS_URL` | Redis URL；设置后限流/缓存/会话撤销，容器必填 |
| `PORTAL_DB_REQUIRED` | `1` 时 PostgreSQL 连接失败则启动失败 |
| `PORTAL_REDIS_REQUIRED` | `1` 时 Redis 连接失败则启动失败 |
| `PORTAL_SESSION_TTL_SECONDS` | 本地会话 TTL，默认 28800 |
| `PORTAL_USERS_FILE` | 本地角色缓存路径 |
| `PORTAL_CONFIG_PATH` | 集群配置路径 |

## 当前边界

- 作业、告警、用量仍是雏形数据，尚未接 slurmrestd/slurmdbd/Prometheus；
- 持久层已具备 PostgreSQL/Redis，但仍是单后端写入模型，未做多副本/读写分离；
- 容器内未启用 TLS（内网 8080），生产需按设计说明书在 443 终结 TLS；
- 管理员 MFA 未在原型实现（设计 D-02 为生产要求）。
