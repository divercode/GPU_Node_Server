# 本轮验证记录

日期：2026-11-24。目标：后端容器化、8080 单入口、身份认证、RBAC、持久层。

## 已执行

| 验证项 | 结果 |
|---|---|
| Python 语法编译（app/auth/store/agent） | 通过 |
| 前端 JS 语法检查（data/charts/ui/pages/app） | 通过 |
| Compose YAML 解析（含 postgres/redis） | 通过 |
| `docker compose config --quiet`（Docker Compose v2.29.7） | 通过（exit 0） |
| Dockerfile 指令解析（dockerfile-parse） | 通过 |
| Dex 配置模板渲染并解析（4 用户、issuer、redirect URI） | 通过 |
| `nginx -t`（用渲染后的 gateway 配置） | 通过 |
| Nginx auth_request：未登录 302 → `/oauth2/sign_in`，已登录 200 | 通过（真实 oauth2-proxy v7.7.1 + Dex v2.41.1） |
| Nginx 身份头注入 + 共享密钥 → backend `/api/v1/me` | 通过 |
| Nginx SPA 静态托管（`/`、`/js/*`）及 CSP | 通过 |
| **真实 Dex OIDC 登录**：Dex v2.41.1 源码构建 Windows 二进制，Nginx→oauth2-proxy→Dex→backend→SPA | 通过（管理员/普通用户两种身份） |
| Dex issuer 带 `/dex` 路径的 Nginx 反代 | 通过（修正 proxy_pass 保留前缀） |
| 普通用户登录：导航裁剪、隐藏全局 GPU/告警/系统、看本人作业、本组用量 | 通过（真实 Dex 登录 + Playwright） |
| 普通用户直接访问 `#/gpus` → 回到工作台 | 通过 |
| 管理员登录：11 个路由全部渲染，无控制台错误 | 通过 |
| 退出登录清理会话并回到 `/login` | 通过（本地模式） |
| 业务数据联调：jobs/alerts/usage/users/audit/system hydrate 到页面 | 通过（管理员 jobs=6/alerts=4/usage=4/users=4/audit=10+动态/system=8；普通用户 jobs=2/usage=681） |
| 15s 轮询 | 通过（Dashboard 停留 16s，health 请求由 1 次增至 2 次，无控制台错误） |
| CSRF double-submit（cookie + header） | 通过（无 token 403，带 token 200） |
| Collector token：无 token 401，正确 token 200 | 通过（Nginx + backend） |
| PostgreSQL 16 持久化：jobs/alerts/gpu_telemetry/audit_events | 通过（本地 PostgreSQL 16.2） |
| 重启 backend 后作业/告警/遥测/审计链保持 | 通过 |
| 审计哈希链校验（`/api/v1/audit/verify`） | 通过（valid=true，逐条重算） |
| 审计 append-only 触发器 | 通过（UPDATE 被 PostgreSQL 拒绝） |
| Redis 限流：API 10 次后 429 | 通过（10×200 + 4×429） |
| Redis 登录限流：伪造 XFF 不再绕过 | 通过（第 6 次 429） |
| 真实来源 IP：local=127.0.0.1，proxy `X-Real-IP`=203.0.113.9 | 通过（审计 ip 字段一致） |
| 本地会话撤销：logout 后旧 cookie 401 | 通过（Redis jti 删除） |
| UI 取消作业 / 确认告警真实写库 | 通过（状态变为 cancelled/acked 并新增审计） |
| 公用前端 + 独立后端：230 `/cluster-b/api/` → 105:8000 | 通过（OIDC 登录、8 卡、B 后端写操作、审计链） |
| 第二后端 8000 防火墙 | 通过（仅 .230/.105 可访问，Windows 直连被拒绝） |
| 动态 IP 注册 registry | 通过（两台均记录 GPU-Test-01 .230:8080、GPU-Test-02 .105:8000） |
| IP 失效告警 | 通过（模拟不可达写入 ip_alerts.jsonl 与 journal） |
| 集群 B 上游自动改写 | 通过（monitor 写入 cluster-b.conf 并 reload gateway，nginx -t 通过） |
| IP 状态 UI 面板 | 通过（公用前端系统状态页显示 A/B IP、健康、最近告警） |
| HTTPS 443 公用入口 | 通过（内部自签证书，TLS1.2/1.3；HTTP 8080 除健康/采集/证书下载外 308 跳转） |
| 证书 HTTP 下载 | 通过（`http://192.168.112.230:8080/portal.crt` 200，1151 bytes） |
| HTTPS OIDC + 共享 B 后端 | 通过（浏览器忽略自签警告后登录，B 8 卡；B 写操作/审计正常） |
| SSE `/api/v1/stream/events` | 通过（`__LIVE_MODE=sse`；快照直接更新 GPU/作业/告警；12s 内只有 1 次初始 jobs REST，无 429；B 也通过） |
| 依赖镜像 tag：`nginxinc/nginx-unprivileged:1.27-alpine`、`oauth2-proxy:v7.7.1`、`dex:v2.41.1` | Registry 存在 |

## 未执行 / 限制

开发机 **未安装 Docker Engine / WSL2 / Hyper-V**，因此无法在本机真正 `docker compose build/up`。
但已用 Docker Compose v2.29.7 的 `docker compose config --quiet` 校验编排文件通过。

容器镜像构建与 Docker 运行时验证需要在目标内网服务器执行：

```bash
docker compose up -d --build
docker compose ps
```

当前 8080 端到端验证是在 **`AUTH_MODE=local` 后端** 下完成；持久层验证使用本机 **PostgreSQL 16.2（pgserver 嵌入二进制）+ Memurai 7.2（Redis 兼容）**，不是 Docker 容器。另用 **真实 Dex v2.41.1（源码构建 Windows 二进制）+ 真实 oauth2-proxy v7.7.1 + Nginx（与容器配置同源）** 在 18080 跑通了完整 OIDC 登录、身份头注入、管理员/普通用户 RBAC 和 SPA/API 访问。容器内 Dex/oauth2/Postgres/Redis 的唯一差异是 Linux 运行环境与镜像层，需目标机复验。

## 目标机上线前检查

- Docker/Compose 版本满足要求；
- `.env` 的 `PUBLIC_BASE_URL` 等于浏览器地址；
- 8080 防火墙仅放通内网；
- Dex 静态账号/密码已替换，或切到 FreeIPA LDAP connector；
- GPU agent token 与 `.env` 一致；
- 生产前补充 TLS 443、MFA、真实 slurmrestd/Prometheus；
- PostgreSQL/Redis 密码已写入 `.env`，目标机需轮换并确认数据卷备份。
