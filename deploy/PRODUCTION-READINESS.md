# 生产联调门禁与文档目标对照

> 规则：每次联调前先核对本清单；未完成 P0 文档目标前，不进入性能/体验优化。
> 设计依据：`GPU 算力平台需求与设计说明书` 的 D-01、D-02、D-08、D-09、§7、§9、§10、§12、§13。

## 当前联调状态（2026-11-24）

| 目标 | 设计文档依据 | 当前状态 | 是否可进入优化 |
|---|---|---|---|
| 公用前端 + 统一 SSO | D-01 / §5.1 | 230 公用入口 + Dex 统一登录；B 后端复用 A 身份头 | 联调基础通过 |
| 后端独立 | §5.1 / §11.4 | A/B 各自 PostgreSQL/Redis，B 仅暴露 8000 给公用网关 | 通过 |
| 公网/业务入口 | D-01 | 公用入口已启用 HTTPS 443（内部自签证书），HTTP 8080 仅保留健康检查/采集；OOD Apache 和正式 CA 未接 | **不可** |
| 身份源/MFA | D-02 | Dex 静态密码，无 FreeIPA/LDAP/OTP | **不可** |
| Slurm/DCGM 实时数据 | §6.4 / §10.4 | 仍是 mock + nvidia-smi agent，无 DCGM/Slurm/slurmdbd | **不可** |
| 告警闭环 | D-09 / §6.7 | 有确认/审计，但无 Alertmanager/工单/自动 drain | **不可** |
| 实时推送 | §9.4 | SSE `/api/v1/stream/events` 直接应用快照，轮询回退；Last-Event-ID/断线补发未完成 | 部分完成 |
| 审计三源 | D-08 | PostgreSQL 哈希链已有；OOD/sacct 源未接 | **不可** |
| 动态 IP | 用户新增要求 | registry + 告警 + B 上游自动改写 + 系统状态页 IP 面板；A 自身换 IP 仍需告警后人工访问新地址 | 部分完成 |
| 多集群数据联邦 | P2 | 只有公用前端切换独立后端，无跨集群聚合 | P2，暂不阻塞 |

## 下一阶段 P0 顺序

1. 正式入口：OOD Apache 或等价 HTTPS 443，TLS/证书，`PUBLIC_BASE_URL` 改为 HTTPS。
2. 身份：FreeIPA/LDAP + Dex connector + 管理员 MFA；删除静态密码。
3. Slurm/DCGM/Prometheus：真实作业/GPU 数据、XID/ECC、作业映射。
4. 告警：Alertmanager → 后端 webhook → 告警/工单/通知闭环。
5. SSE 替换轮询；审计接 OOD/sacct。
6. 备份/HA/恢复演练与验收证据。

## 当前联调入口

- 公用前端：`http://192.168.112.230:8080/`
- 集群 B 后端：`192.168.112.105:8000`（仅公用网关/本机）
- 集群切换：右上角按钮切换 API 前缀 `/cluster-b`

## 动态 IP 证据

- `/home/test/ip_registry.json`
- `/home/test/ip_alerts.jsonl`
- `journalctl -u starrail-ip-monitor`
- `gateway/cluster-b.conf` 由公用网关侧监控自动重写并 reload。
