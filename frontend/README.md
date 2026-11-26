# 星轨算力 · GPU Console 前端

面向 GPU 服务器的监控、作业、告警、用量和管理 SPA。纯静态、零外部依赖，由统一网关提供认证入口。

## 入口

- 公用前端：`http://192.168.112.230:8080/`（经 oauth2-proxy / Dex 登录）
- 平台入口由网关统一认证；OOD 与平台会话独立，首次打开 OOD 需单独登录。
- 本地无容器预览：

```bash
cd ../backend
AUTH_MODE=local PORTAL_SESSION_SECRET=dev-session-secret-change-me-1234567890 \
PORTAL_DATABASE_URL=postgresql://postgres@127.0.0.1:5432/starrail \
PORTAL_REDIS_URL=redis://127.0.0.1:6379/0 \
python app.py --host 0.0.0.0 --port 8080
```

## 页面

| 路由 | 页面 |
|---|---|
| `#/dashboard` | 工作台 |
| `#/catalog` | 资源目录 |
| `#/jobs` / `#/jobs/:id` | 作业中心 / 详情 |
| `#/monitor` | 集群总览 |
| `#/gpus` | GPU 监控 |
| `#/alerts` | 告警中心 |
| `#/rules` | 告警规则 |
| `#/usage` | 资源用量 |
| `#/users` | 用户与账户 |
| `#/audit` | 审计日志 |
| `#/system` | 系统状态（含集群 IP 记录面板） |

## 多集群（公用前端 + 独立后端）

| 部分 | API 前缀 | 后端 |
|---|---|---|
| GPU-Prod-01 | `/api/` | 192.168.112.230 内部 8000 |
| GPU-Prod-02 | `/cluster-b/api/` | 192.168.112.105:8000 |

右上角集群按钮只切换 API 前缀并 reload，不跳转到第二套前端；B 不部署本地 gateway/Dex/OOD，身份与 OOD 统一由中心 A 提供。两套后端有独立 PostgreSQL/Redis/Slurm 控制面，通过各自 API 前缀读取。

## 交互

- 深/浅主题、`Ctrl K` 命令面板、键盘快捷键；
- GPU 卡片、节点热力图、30 天用量图；
- 作业取消、告警确认通过后端 API 写库并追加审计；
- 优先使用 SSE `/api/v1/stream/events` 直接应用快照；SSE 不可用时回退 3s 轮询，SSE 已连接时保留 15s 慢轮询兜底；
- 支持 `?demo=...` 演示态；`?theme=light`、`?noanim=1`。

## 边界

- 前端不参与授权，后端做 RBAC/对象级校验；
- Slurm 作业来自 Agent 的 `scontrol`，GPU 指标来自 DCGM/Prometheus，SSE 为真实服务端事件流；
- Prometheus 告警规则由真实 API 读取；镜像字段仅作元数据记录，作业命令直接在 GPU 节点执行；配额与 OOD/sacct 审计尚未接入。


