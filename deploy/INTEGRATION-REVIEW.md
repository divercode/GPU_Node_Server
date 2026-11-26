# 前后端联调检查记录

日期：2026-11-21。检查对象：`frontend/` 与 `backend/`、`gateway/` 的接口与认证链路；同时复核 8080 入口、Docker Compose 配置。

## 1. 已通过的链路

| 链路 | 结果 |
|---|---|
| 前端启动 → `/api/v1/health` | 通过（返回 envelope） |
| 前端启动 → `/api/v1/me` | 通过（返回 username/display_name/roles/account/auth_mode） |
| 身份同步 → 顶部用户菜单/侧栏菜单 | 通过（管理员 11 项、普通用户 4 项） |
| 普通用户访问 `#/gpus` | 通过（路由守卫回到工作台） |
| GPU 数据合并 | 通过（`/api/v1/gpus` → `DB.GPUS` 温度/功耗/利用率/显存） |
| 本地认证 → 登录 → API → 页面 | 通过（Playwright + 8080） |
| 真实 Dex v2.41.1 → oauth2-proxy v7.7.1 → Nginx → backend → SPA | 通过（18080 测试环境，管理员/普通用户） |
| Nginx `/dex/` 反代 | 已修复并通过（Dex issuer 带 `/dex` 前缀，`proxy_pass` 不能加尾斜杠） |
| Nginx 静态 SPA + `/api` 身份头注入 | 通过（真实 oauth2-proxy） |
| `/api/v1/gpus` 普通用户 | 401/403（未登录 401，普通用户 403） |
| CSRF（本地模式） | 无 token 403，带 token 200 |
| Collector token | 无 token 401，正确 token 200 |
| Docker Compose 配置 | `docker compose config --quiet` exit 0 |

## 2. 发现的问题

### P0（已修复）：业务页面已接入后端 API

前端启动后会在身份同步后 hydrate：

- `/api/v1/jobs` → `DB.JOBS`（含用户显示名、QoS、镜像、等待/提交/开始时间等）
- `/api/v1/alerts` → `DB.ALERTS`（admin/ops/auditor；含 `sev/node/desc/mins/time`）
- `/api/v1/usage?scope=global|group` → `DB.USAGE_SERIES` / `DB.USAGE_LABELS` / `DB.ACCOUNTS`
- `/api/v1/users` → `DB.USERS`（admin/ops）
- `/api/v1/audit` → `DB.AUDIT`（admin/ops/auditor）
- `/api/v1/system/status` → `DB.HEALTH`（admin/ops）
- GPU 作业关联会重新映射到运行中作业；TOTALS 计数同步刷新

验证：管理员作业 6 行、告警 4 条、用量 30 天 4 组、用户 4 个、审计 10+动态、系统组件 8 个；普通用户作业 2 行、本组用量 681 GPU·h；无控制台错误。

仍使用 mock 的页面：

- 告警规则：`DB.RULES`（后端暂无 `/api/v1/rules`）
- 资源目录部分静态说明

> 注意：users/system 的 API 目前仍是雏形数据（auth_users 缓存、静态组件），不是真实 FreeIPA / Prometheus；audit 已切 PostgreSQL 哈希链，但尚未接 OOD/sacct 审计源。

### P1（大部分已处理）：接口字段兼容与剩余数据源

本轮已把作业/告警/用量/用户/审计/系统状态字段补齐并接入页面；仅告警规则页仍使用 mock。

| 前端期望 | 后端当前 | 状态 |
|---|---|---|
| `job.user`（中文显示名） | 已补 `user/user_display/username/owner` | 已接入 |
| `job.qos / image / nodes / wait / submitted / started / priority / exitCode` | 已补齐 | 已接入 |
| `alert.sev` | 已补别名 `sev` | 已接入 |
| `alert.node` | 已补别名 `node` | 已接入 |
| `alert.desc / mins / time / jobId` | 已补齐 | 已接入 |
| `usage.labels / usage.series[]` | 已补 30 天 labels/series、group/self scope | 已接入 |
| `DB.USERS` | 已有 `/api/v1/users` | 已接入（admin/ops） |
| `DB.AUDIT` | 已接 `/api/v1/audit` + PostgreSQL 哈希链 | 已接入（示例种子 + 真实写操作） |
| `DB.HEALTH` | 已有 `/api/v1/system/status` components | 已接入（静态组件检查） |

> 结论：**作业/告警/用量/用户/审计/系统状态均已前后端联调**；规则页仍是 mock，users/system 后端仍是雏形数据，audit 已切 PostgreSQL 哈希链。

### P1（已实现）：持久层与真实来源 IP

- PostgreSQL：`jobs`、`alerts`、`gpu_telemetry`、`audit_events`；启动时自动建表并种子初始化；
- Redis：最新遥测缓存、登录/API 限流、本地会话撤销 key；
- 审计链：`prev_hash + sha256`，advisory lock 串行追加，append-only 触发器；
- `/api/v1/audit/verify` 全链重算；
- 取消作业/确认告警已从 UI 真实调用后端并写库；
- 真实 IP：local 只信任 TCP 对端，proxy 信任 Nginx `X-Real-IP`（共享密钥校验后），审计不再写 `proxy`。

### P1（已实现）：公用前端 + 独立后端

- 公用入口固定在 `192.168.112.230:8080`，统一 Dex 登录；
- 集群 A 使用 `/api/`，集群 B 使用 `/cluster-b/api/`；
- B 只保留 backend/postgres/redis，不再提供自己的前端/gateway/Dex；
- B 的 8000 端口仅允许公用网关和本机访问；
- 右上角集群按钮切换 API 前缀并 reload，不跳转页面。

### P1（已实现）：15s 轮询

- 前端在首次 API 成功后启动 15s 轮询；
- 只在 dashboard/monitor/gpus/alerts 页面、页面可见且没有抽屉/弹窗/命令面板/输入聚焦时自动 render；
- 渲染后恢复滚动位置；
- 仍不是设计要求的 SSE，页面文案已改为“15s 轮询”，后续可替换为 SSE。

### P2（已修复）：代理模式 CSRF Token

- `/api/v1/me` 下发 HttpOnly `portal_csrf` cookie，并在响应 `csrf` 字段返回 token；
- 前端 `window.apiWrite()` 自动带 `X-CSRF-Token`；
- 后端写接口对所有模式做 double-submit 校验（cookie + header），并校验同源 Origin；
- 实测：无 token 403，带 token 200，且不依赖本地会话存储，适合代理模式/多副本。

### P2：真实 Dex 首次登录会多一个授权页

`skipApprovalScreen: true` 已配置，但真实 Dex 测试仍出现 “Grant Access” 页面。功能可用，但用户体验与文档描述需保持一致，后续需要确认 Dex 2.41.1 的审批条件或显式保留该步骤。

### P2：Docker 运行时未验证

开发机无 Docker Engine/WSL2/Hyper-V，无法执行 `docker compose up -d --build`。
已验证 Compose 配置、Dex/oauth2-proxy/Nginx 真实链路，但镜像构建与非 root 容器运行仍需目标机复验。

## 3. 本轮已修复的联调问题

1. Nginx `/dex/` 反代必须保留 `/dex` 前缀，否则 Dex discovery/login 404。
2. Dex 登录框使用邮箱（`linya@hpc.local`），本地模式才用 `linya`；部署文档已纠正。
3. 普通用户 `#/gpus` 路由守卫、菜单/手机底栏隐藏、用户菜单审计入口隐藏。
4. 普通用户身份若没有映射到 HPC 组，后端返回 403（不再默认当普通用户放行）。
5. `/api/v1/audit` 对运维开放，与权限矩阵 §4.2 一致。
6. 代理模式空组兜底、本地会话 `account` 字段、登录后用量按组展示。
7. 真实 Dex/oauth2-proxy/Nginx 链路修复并验证。
8. 新增 `/api/v1/users`、`/api/v1/audit`、`/api/v1/system/status` 并 hydrate 用户/审计/系统状态页。
9. 前端加入 15s 轮询（仅安全页面/无浮层时刷新）并修正“每 15 秒”文案。
10. 代理模式改为 double-submit CSRF：`/me` 下发 HttpOnly cookie + token，写接口校验 cookie+header。
11. 新增 PostgreSQL/Redis 持久层、审计哈希链、真实来源 IP、限流与会话撤销；UI 取消作业/确认告警改为真实 API。

## 4. 建议下一步

1. 规则页接 `/api/v1/rules`（当前仍 mock）。
2. 把 users/system 的雏形数据替换为真实 FreeIPA 缓存、Node/Prometheus 检查；审计已使用 PostgreSQL 哈希链。
3. 将 15s 轮询替换为设计要求的 SSE；补 Last-Event-ID 回补。
4. 目标机执行 Docker 构建/运行并复验 OIDC、agent 上报、8080 内网访问。
