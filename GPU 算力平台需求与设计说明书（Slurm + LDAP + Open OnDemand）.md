# GPU 算力平台需求与设计说明书（Slurm + LDAP + Open OnDemand）

版本 v0.2（可实施版）｜日期 2026-11-19｜状态 待评审（评审通过后进入详细设计）｜读者：产品、前端、后端、运维、测试、安全
替代 v0.1（2026-11-18）；v0.1 原文另存为同目录 `-v0.1备份.md`。

## 0. 文档控制

### 0.1 修订记录

| 版本 | 日期 | 修订人 | 说明 |
| --- | --- | --- | --- |
| v0.1 | 2026-11-18 | 平台组 | 初稿：目标、架构、流程、需求、部署、运维、里程碑 |
| v0.2 | 2026-11-19 | 平台组 | 关闭 13 项关键决策；锁定版本基线；逐条补验收标准与追溯；修正 dcgm 标签、node/rnode、会话撤销、审计三源、slurmdbd HA、令牌模型等技术问题；里程碑与 M0 门禁重写 |

### 0.2 v0.1 → v0.2 修订要点（评审问题闭环）

| 上版问题 | 本版处理 |
| --- | --- |
| LDAP 写路径与正文/接口矛盾 | 决策 D-03：首期只读同步 + 审批后运维在 FreeIPA 执行；接口从首期清单移除写入类 |
| 入口拓扑三态未决 | 决策 D-01：OOD Apache 为唯一**业务**入口，`custom_vhost_directives` 反代 `/portal`、`/api`；TLS 在 Apache 终结；Dex 独立域名 |
| OOD 生产形态待确认 | 决策 D-04：VM + RPM，双节点，容器仅用于开发测试 |
| 版本基线过时/未锁定 | §2.4 版本基线表；D-06，M0 冻结；明确 OOD 4.2 已移除 Ubuntu 22.04 |
| dcgm 作业映射写法错误 | §6.4/§12.5：`--hpc-job-mapping-dir`、标签 `hpc_job`、文件命名、`--collect-interval=15000`；user/account 查询期关联 |
| “禁用 5 分钟 Web 失效”不可测 | §6.2/§14.2：SSO 会话 TTL 2h/8h，验收拆分为 SSH/NSS≤5min、Web≤TTL+可强制撤销 |
| 审计漏 OOD 侧 | 决策 D-08、§6.9：审计三源（后端/OOD 日志/sacct）与统一关联 ID |
| slurmdbd + Galera 与官方建议相反 | 决策 D-05：单 slurmdbd + MariaDB 主备，不使用 Galera |
| GrpTRESMins 当余额限制有滞后 | 决策 D-11：并发/时长用 GrpTRES、GrpTRESRunMins，月额度日结写入并双向对账 |
| StateSaveLocation 放 NFS 风险 | §12.4：低延迟共享存储（SAN/DRBD），明确不复用 NFS 家目录 |
| MIG 计量无依据 | 决策 D-07：首期不启用 MIG；启用须过 M0 PoC 门禁 |
| 需求不可测、无追溯 | §7 每条需求带验收标准；§15.4 追溯矩阵 |
| “P1=二期”无二期里程碑、drain/resume 缺位 | §7 优先级改为 P0（上线必需）/P1（上线后 3 个月）/P2（择机）；B-10 保持 P1，首期以运维手册中的 `scontrol` 命令 + 审计兜底（§14.5），M6 交付管理界面 |
| 页面/接口/状态机缺失 | §9 页面清单、权限矩阵、接口表、错误码、状态机、SSE 事件 |
| 缺少容量/成本/RACI/演练判据 | §8.4 容量模型、§15.2 RACI、§14.4 恢复判据与演练、§16 风险登记 |

### 0.3 读者指南

| 读者 | 必读章节 |
| --- | --- |
| 产品/项目经理 | 1、2、7、15 |
| 前端 | 5、7、9、10 |
| 后端 | 5、6、9、10、12、13 |
| 运维/交付 | 2.4、5、12、13、14、16 |
| 测试 | 7、8、9、14、15.5 |
| 安全/审计 | 3、12、13、14 |

### 0.4 文档约定

- 编号规则：`A/B/C-xx`（功能需求）、`D-xx`（决策）、`ACC-xx`（验收）、`PoC-xx`（M0 验证）、`RB-xx`（Runbook）、`R-xx`（风险）、`T-xx`（待确认）；§14.2 关联列中的 NFR/SEC/OPS 分别指 §8/§13/§14 的要求集合。
- 优先级：**P0** 首期上线必需；**P1** 上线后 3 个月内交付；**P2** 择机。与 v0.1 的“二期”不同，本版每个 P1 都有明确里程碑（§15.3）。
- 单位：GPU·h=GPU 卡数×小时；存储容量以 TiB 计；金额 CNY、两位小数。
- 时间：服务端与日志统一 UTC；账单日界、报表展示按 Asia/Shanghai。
- 规范性：§3 决策、§7 需求、§12 配置、§14 运维判据为规范性内容；附录与示例为参考性。

## 1. 概述

### 1.1 目的

建设基于 Slurm、LDAP（FreeIPA/AD）、Open OnDemand 的 GPU 算力平台，覆盖三个子平台：A. GPU 监控管理；B. 算力资源调用（Web 提交/交互式应用/文件）；C. 监控、计量与计费。本文档作为设计、开发、测试、上线和验收的统一依据。

### 1.2 平台组成

三平台共用同一账号（LDAP）、同一入口（OOD Apache + Dex SSO）、同一数据底座（Slurm 记账 + PostgreSQL + Prometheus）：

- **A. GPU 监控管理**：GPU 资产、实时指标、健康与告警、GPU↔作业↔用户关联。
- **B. 算力资源调用**：OOD 作业提交、交互式应用（Jupyter/VS Code/远程桌面/TensorBoard）、文件、配额与队列。
- **C. 监控与计量**：集群与平台自监控、按用户/课题组/项目用量、账单、效率分析。

### 1.3 术语

| 术语 | 说明 |
| --- | --- |
| Slurm | 作业调度系统：slurmctld（控制）、slurmd（节点）、slurmdbd（记账，后端 MariaDB）、slurmrestd（REST） |
| GRES / TRES | 通用资源（gres/gpu）/ 可追踪资源（CPU、内存、GPU 分钟等，用于记账与限额） |
| QOS / Association | 服务质量等级 / 用户-账户-分区关联，是 Slurm 限额与记账的基本单位 |
| OOD / PUN | Open OnDemand（Apache+Passenger 门户）/ 每用户独立 Nginx 进程（以用户 UID 运行） |
| Dex | OIDC 身份代理：对接 LDAP，向 OOD、平台前端/后端下发 OIDC 令牌 |
| LDAP / FreeIPA / SSSD | 集中账号目录 / 集成 LDAP+Kerberos+CA+OTP 的身份域 / 节点侧身份解析服务 |
| DCGM / dcgm-exporter | NVIDIA 数据中心 GPU 管理工具 / 按 Prometheus 格式暴露 GPU 指标 |
| `hpc_job` | dcgm-exporter 的 HPC 作业标签，需 `--hpc-job-mapping-dir` 显式开启 |
| GPU·h | 计量单位：分配卡数 × 运行小时；本版按整卡计，MIG 首期不启用 |
| ADR / SLO / RTO / RPO | 架构决策记录 / 服务目标 / 恢复时间目标 / 恢复点目标 |
| ETL / 水位线 | 计量数据抽取转换加载 / 增量拉取的时间下界 |

### 1.4 设计原则

1. **复用而非重造**：提交/交互应用用 OOD，调度记账用 Slurm，身份用 LDAP；自研只做集成、管理面与计量。
2. **单一事实来源**：身份以 LDAP 为准；资源/作业/用量以 Slurm 记账为准；时序指标以 Prometheus 为准；业务/账单/审计以 PostgreSQL 为准。
3. **先决策、后设计**：未在 §3 关闭的问题不得进入开发；新决策走 ADR（§3 末尾流程）。
4. **计量以 slurmdbd 记账为准**，监控采样只用于效率分析与告警，不参与计费。
5. **用户态操作以本人身份落到集群**（UID/GID 全局一致），平台不保存用户密码。
6. **故障隔离**：自研平台、Prometheus、slurmrestd 任一故障不得影响已运行作业与 OOD 提交。
7. **默认最小权限、可审计、可回滚**；所有写操作留痕，所有变更可回退。
8. **诚实标注证据**：涉及上游组件行为的结论标明“已验证/待 M0 验证”（附录 A）。

## 2. 目标、范围与约束

### 2.1 业务目标与度量

| 目标 | 度量指标 | 首期目标 |
| --- | --- | --- |
| 降低使用门槛 | 新用户首次成功提交/启动交互应用耗时 | ≤30 分钟（含模板与指引） |
| 管理员可见可用 | GPU 资产与状态覆盖率、故障发现时延 | 100%；故障发现 ≤2 分钟 |
| 精确计量 | 完成作业入账率、与 sreport 对账偏差 | 100%；≤0.5% |
| 账号统一 | LDAP→Slurm 账户同步延迟、不一致数 | ≤5 分钟；0 |
| 门户稳定 | OOD 可用性（计划维护除外） | 首期 99.5%，运行 12 个月后目标 99.9% |

### 2.2 范围

**首期（P0）**：LDAP/FreeIPA 与 SSSD；Slurm 集群（记账、GRES、cgroup 隔离）；Dex+OOD 登录与交互式应用；GPU/节点/Slurm 监控与告警；自研平台后端/前端（资源目录、作业视图、账户与配额管理、审计、自监控）；计量 ETL、日/月账单、额度联动；容器化部署（平台服务层）。

**P1（上线后 3 个月）**：计费规则与账单价目扩展、CSV/PDF 导出与邮件订阅、低效利用识别、历史趋势对比、Apptainer 镜像白名单与模块、QOS 优先级/抢占/预约、管理员批量运维、告警规则管理界面完善。

**P2（择机）**：申请审批流全线上化、容量分析、对外收费与财务系统对接、多集群联邦、MIG 计量。

**首期不做**：Kubernetes 调度 GPU 作业；MIG 切片（见 D-07）；跨机房容灾；对象存储服务；在线支付；Ubuntu 22.04 作为 OOD 节点（OOD 4.2 已不支持）。

### 2.3 规模基线（M0 复核）

| 项 | 基线假设 |
| --- | --- |
| GPU 节点 / GPU 卡 | 64 节点 × 8 卡 = 512 卡（以 A100/H100 为主） |
| 分区 / QOS | 4 个分区、6 个 QOS |
| 注册用户 / 并发 Web / 并发 PUN | 2,000 / 300 / 150 |
| 作业量 | 12 万作业/月，峰值 2 万/日 |
| 共享存储 | home 200 TiB、scratch 500 TiB（NFS/Lustre/BeeGFS 待定） |

> 以上为容量设计基线而非合同承诺；M0 确认后回写本节并修订 §8.4 容量模型。

### 2.4 版本基线（D-06，M0 冻结）

| 组件 | 基线版本 | 依据/备注 |
| --- | --- | --- |
| 操作系统 | Rocky Linux 9.6 或 Ubuntu 24.04 LTS | OOD 4.2 支持 EL8/9/10、Ubuntu 24.04/26.04；**4.2 不支持 Ubuntu 22.04** |
| Slurm | 25.11（不低于 24.11） | 需 slurmrestd API 与 MIG 相关能力；M0 按 18 个月支持窗口复核 |
| Open OnDemand | 4.2.x | 官方支持矩阵与 OIDC/Dex 集成能力 |
| Dex | 2.42+ | 独立部署，OOD 通过 OIDC 对接 |
| FreeIPA | RHEL 9 自带（≥4.11）或既有 AD | 提供 LDAP+CA+OTP；选型见 D-02 |
| NVIDIA 驱动 / DCGM | 570 系列 / DCGM 4.5+ | 按卡型与 CUDA 兼容矩阵认证 |
| dcgm-exporter | 4.x（支持 `hpc_job` 与 `--hpc-job-mapping-dir`） | 采集间隔显式设为 15s |
| Apptainer | 1.4+ | 计算节点用户态容器 |
| MariaDB | 10.11 | slurmdbd 后端，主备复制，不使用 Galera |
| PostgreSQL | 16.x | 业务库与计量库 |
| Prometheus / Alertmanager / Grafana | 3.x / 0.28+ / 12.x | 指标、告警、可视化 |
| Redis | 7.2+ | 缓存、SSE 跨进程总线、分布式锁 |
| 后端 / 前端 | Python 3.12 + FastAPI / Vue 3 + TS + ECharts | 容器化交付 |
| 镜像仓库 / CI | Harbor + GitLab CI（或既有） | 镜像签名与漏洞扫描 |

版本变更须经 ADR 评审；基线冻结后不得在实施中漂移。

### 2.5 成功标准（Definition of Done）

首期上线需同时满足：§14.2 验收项全部通过；§15.4 追溯矩阵中 P0 需求 100% 有验收证据；§14.4 恢复演练与 §14.6 上线检查单通过；§16.3 风险登记中“高”风险均有已批准对策。

## 3. 关键决策记录（ADR）

> 本节为规范性决策。任何决策变更需新增 ADR 并在 §0.1 记录版本。

| 编号 | 决策 | 理由 | 验证方式 |
| --- | --- | --- | --- |
| D-01 | **入口与 SSO**：OOD Apache 作为唯一**业务** HTTPS 入口并在 Apache 终结 TLS；独立 Dex 以独立域名部署（`https://dex.<域名>`，TLS 由 Dex 终结，2 副本）；通过 `custom_vhost_directives` 将 `/portal`、`/api` 反代到自研前端/后端；OOD 与平台共用同一 Dex OIDC 会话 | OOD 本身即 Apache+Passenger，官方提供 custom vhost 扩展点；业务单入口避免双反代导致的 cookie/重定向/SSO 域问题；Dex 独立域名避免子路径 issuer 问题，并便于为 OOD 与平台分别注册客户端 | M0 PoC-01：登录 OOD 后访问 `/portal` 免二次登录；登出统一；`/portal` 与 `/api` 在 OOD 升级后仍工作 |
| D-02 | **身份源与 MFA**：身份源采用 FreeIPA（若企业已有 AD 则用 AD）；管理员账号强制 OTP（FreeIPA `EnforceLDAPOTP`，或 AD 等效策略），Dex LDAP connector 仅透传密码绑定；不采用 OpenLDAP 作为首选 | OpenLDAP 无 MFA 落点，无法满足 §13.2 的管理员二次认证要求；FreeIPA 同时提供 DNS/CA/OTP，减少组件 | M0 验证：启用 OTP 的管理员无法仅用密码登录；普通用户不受影响；删除/禁用账号后新登录被拒 |
| D-03 | **LDAP 写入路径**：首期平台**只读** LDAP；开户/变更由审批单驱动，运维在 FreeIPA 管理工具执行（提供脚本模板），平台同步服务校验并回写状态；二期（P2）再开放后端写入 | 平台直写 LDAP 的 uid/gid 号段治理、home/scratch 创建、幂等与回滚风险高，首期用“审批+人工执行+只读同步”降低不可逆数据事故 | 同步服务 dry-run 差异报告为 0；开户全流程演练 ≤1 工作日 |
| D-04 | **OOD 部署形态**：生产用 VM + RPM 部署，2 节点 active/active + 四层负载均衡 + 粘性会话；PUN 状态保留在本机；容器仅用于开发/测试。首期 OOD SLO 99.5% | 官方仅支持 RPM 安装；容器化需解决 SSSD、munge、sudo nginx_stage、共享存储与动态端口，风险高；2 节点+粘性可满足首期目标 | 单节点故障后粘性用户会话重建；§14.2 门户验收项通过 |
| D-05 | **Slurm 控制面与记账 HA**：slurmctld 主备，StateSaveLocation 放低延迟共享存储（SAN/DRBD，**不得复用 NFS 家目录**）；slurmdbd **单实例** + MariaDB 主备流复制（binlog），不使用 Galera 多主 | SchedMD 建议单个 slurmdbd + 非 HA 数据库，slurmctld 侧有消息缓存；Galera 多主与 slurmdbd 事务/一致性模型不匹配 | M0 故障演练：主备切换作业不丢失、state 目录可被备机访问；MariaDB 切换后记账连续 |
| D-06 | **版本基线**：按 §2.4 冻结；变更走 ADR；上线前锁定并留回退包 | 避免“参数以版本文档为准”的漂移；slurmrestd API/OOD/OS 支持矩阵强相关 | M0 输出《版本基线确认单》并经评审 |
| D-07 | **计量与计费口径**：首期不启用 MIG，按整卡 GPU·h；计费粒度 1 分钟向上取整；账单日界 Asia/Shanghai；金额 CNY 两位小数；运行中作业每小时快照估算、结束后以 slurmdbd 最终值校正；冲正不超过 1 个账期 | 社区反馈 MIG 的 TRES/映射数据在目标版本不稳定，先保证可验收；日界/取整不定则账单不可复核 | M0 MIG 测试结论；§14.2 计量验收；账单抽检 |
| D-08 | **审计**：三源审计——平台后端审计表（写操作）、OOD Apache/Passenger 日志（登录/提交/文件/终端）、slurmdbd/sacct（作业生命周期）；以 `job_id`+`request_id`+`uid` 关联；审计表 append-only（独立库账号+触发器+哈希链），每日摘要归档 | 只依赖后端审计会漏掉 OOD 侧主提交通道；合规要求可追溯 | 抽查 10 个作业在三个源中均可关联；审计防篡改演练 |
| D-09 | **告警与自动处置**：XID 按 NVIDIA Fatal/Nonfatal 分类分级；自动 drain 白名单仅限“掉卡/不可纠正 ECC/节点 down”，限速每小时 2 节点；其余告警人工确认；所有自动处置生成工单并通知用户 | v0.1“XID 非零即严重”会造成告警风暴与误 drain | 故障注入演练：误报率、drain 限速、工单闭环 |
| D-10 | **Slurm 令牌与权限模型**：平台维护两套令牌——`user-read`（只读查询，配合 X-SLURM-USER-NAME 代表用户）与 `admin-ops`（节点/作业管理，仅 worker 持有）；不共享、分进程隔离；TTL 30 分钟自动轮换；管理操作需“操作人+审批码”双因子记录并全量审计；按用户签发短时令牌作为 P1 替代方案 | 单一 SlurmUser/root 令牌可代表任意用户，违反最小权限；拆分后即使读通道泄露也不能改变集群状态 | M0 渗透测试：读令牌无法执行写操作；令牌过期/轮换无中断 |
| D-11 | **额度联动**：首期采用“配额+钱包”双轨：并发（`GrpTRES` GPU 数）与运行时长（`GrpTRESRunMins`）作为 Slurm 硬限；月额度由平台 ETL 月末计算后写入 `GrpTRESMins` 并每日对账；钱包余额变动写流水表，禁止直接改余额 | GrpTRESMins 用量随作业结束入账，存在滞后，不能作为实时余额扣减；双写必须有流水与对账 | 模拟欠费：限额生效、充值后自动解除；对账差异为 0 |
| D-12 | **发布与变更**：GitOps 管理配置与规则；预发→灰度→生产；OOD/Slurm/驱动升级固定窗口（周二/周四 22:00-02:00），升级前备份、升级后回归 | 生产环境多组件耦合，需可回退的变更节奏 | 变更单抽检；回滚演练 |
| D-13 | **计费模式**：首期为**内部分摊记账**（不对外收款、不对接财务支付），账单金额用于内部成本分摊；对外收费与发票在 P2 评估 | 真实收费涉及合同/财务/发票流程，首期未确认前不应阻塞计量上线 | 财务确认 §16.2-T04；账单口径评审 |

**决策变更流程**：提出 ADR（背景/选项/影响/回滚）→ 平台组评审（安全、运维必须参加）→ 更新本表与受影响章节 → 记录到 §0.1 → 通知开发/测试。

## 4. 角色与权限

### 4.1 角色定义（来源：LDAP 组 → Dex groups → 平台 RBAC）

| 角色 | LDAP 组 | 说明 |
| --- | --- | --- |
| 平台管理员 | `hpc-admins` | 全部功能：系统配置、账户/限额、价格与账单、告警规则、审计 |
| 运维人员 | `hpc-ops` | 监控、告警处置、节点 drain/resume、强制取消作业、只读计量 |
| 课题组负责人（PI） | `hpc-pi-<组>` | 审批组内配额申请、查看本组用量与账单 |
| 普通用户 | `hpc-users` | 提交/管理自己的作业、使用交互式应用、查看本人/本组用量 |
| 财务/审计 | `hpc-finance` | 只读全局计量、账单、审计日志，不可操作集群 |

### 4.2 权限矩阵

| 能力 | 管理员 | 运维 | PI | 普通用户 | 财务/审计 |
| --- | --- | --- | --- | --- | --- |
| 登录 OOD / 平台门户 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 提交/取消自己的作业 | ✓ | ✓ | ✓ | ✓ | — |
| 交互式应用/文件（本人空间） | ✓ | ✓ | ✓ | ✓ | — |
| 查看本人作业与指标 | ✓ | ✓ | ✓ | ✓ | — |
| 查看本组用量/账单 | ✓ | ✓ | ✓ | — | ✓（全局只读） |
| 查看全局 GPU/节点监控 | ✓ | ✓ | — | — | ✓（只读） |
| 查看全部用户用量与账单 | ✓ | 只读 | — | — | ✓ |
| 账户开通/停用执行（FreeIPA） | —（由运维执行） | ✓ | — | — | — |
| Slurm 账户/QOS/限额管理 | ✓ | — | — | — | — |
| 节点 drain/resume、强制取消作业 | ✓ | ✓ | — | — | — |
| 告警规则/静默/升级策略 | ✓ | ✓（可静默） | — | — | — |
| 价格规则/账单调整 | ✓ | — | — | — | 审批（复核） |
| 审计日志查询/导出 | ✓ | ✓ | — | — | ✓ |
| 系统配置/密钥/版本变更 | ✓ | — | — | — | — |

### 4.3 对象级权限规则

- 数据范围三级：**本人**（uid）、**本组**（LDAP 组 ↔ Slurm Account ↔ 项目）、**全局**（管理员/财务）。
- 全部对象级校验在后端服务层完成；前端传参只作筛选条件，不作为授权依据。
- 组边界定义：一个 LDAP 组对应一个 Slurm Account；一个项目属于一个 Account（首期 1:1；多项目共用 Account 留 P2）。
- 写操作审计字段：操作人、角色、动作、对象、前值/后值、来源 IP、`request_id`、时间（UTC）。

## 5. 总体架构

### 5.1 逻辑架构

```
浏览器
  │ HTTPS 443
  ▼
OOD Apache（唯一业务入口，mod_auth_openidc，TLS 终结）
  ├─ /pun /node /rnode /nginx /public /logout ─→ PUN / 计算节点（以用户身份）
  ├─ /portal/ ─→ 平台 SPA 静态资源（/var/www/portal）
  └─ /api/    ─→ 平台后端 127.0.0.1:8080

浏览器 ──HTTPS──> Dex（dex.<域名>，独立 OIDC 入口，TLS 由 Dex 终结）
Dex → LDAP（636/TLS）      SSSD（全部节点，含 OOD/计算/登录节点）
平台后端 → slurmrestd（6820，JWT） → slurmctld / slurmdbd → MariaDB
        → Prometheus（9090） → dcgm-exporter / node_exporter / slurm-exporter
        → PostgreSQL（5432）→ Redis（6379）
        → LDAP（636，只读服务账号）
OOD / munge / Slurm 客户端 → slurmctld（6817）
审计：后端审计表 + OOD Apache/Passenger 日志 + sacct/slurmdbd → 集中日志
```

### 5.2 组件职责与部署形态

| 组件 | 职责 | 部署形态 | 端口 |
| --- | --- | --- | --- |
| FreeIPA（或 AD） | 账号、组、CA、OTP | 2 节点复制 | 389/636 |
| SSSD | 节点解析用户/组 | 宿主机 | — |
| Dex | OIDC 身份代理，对接 LDAP | 容器，2 副本（PostgreSQL 存储） | 443（独立域名） |
| Open OnDemand | 门户入口、作业、文件、终端、交互式应用 | VM + RPM，2 节点 + L4 负载均衡 | 443 |
| slurmctld / slurmdbd / slurmrestd | 调度、记账、REST | 管理节点（主备）/ 记账节点 / 管理节点 | 6817 / 6819 / 6820 |
| slurmd | 节点作业执行与 GPU 管理 | GPU 节点宿主机 | 6818 |
| dcgm-exporter、node_exporter | GPU/节点指标 | GPU 节点（容器/宿主机服务） | 9400 / 9100 |
| Prometheus / Alertmanager / Grafana | 指标、告警、可视化 | 容器（2 节点或 1+备份） | 9090 / 9093 / 3000 |
| 平台后端 / worker / 前端 | 业务 API、ETL、管理控制台 | 容器（后端 ≥2 副本） | 8080 |
| PostgreSQL / Redis | 业务库、缓存/SSE 总线 | 容器或独立节点 | 5432 / 6379 |
| MariaDB | slurmdbd 后端 | 主备（流复制） | 3306 |
| 集中日志 | 审计与排障日志 | Loki/ELK 或文件+归档 | — |

### 5.3 关键集成点

1. **LDAP ↔ OS**：全部节点经 SSSD 解析；启用 LDAPS；同一用户 UID/GID 全局一致；OOD/计算/登录节点必须能解析用户，否则 PUN 或作业启动失败。
2. **LDAP ↔ Dex**：Dex LDAP connector 使用只读服务账号；配置 `groupSearch`（baseDN/filter/nameAttr/userMatchers）以传递 groups；嵌套组不支持。
3. **Dex ↔ OOD**：OOD 以 OIDC RP 方式对接外部 Dex（`oidc_provider_metadata_url`、client_id/secret、`oidc_remote_user_claim=preferred_username`、`oidc_scope` 含 `groups`）；`user_map_match` 将 claims 映射为本地用户名，与 LDAP uid 一致。
4. **Dex ↔ 平台 SPA/API**：SPA 走 Apache 会话（同源 cookie）；后端只信任来自 Apache 的身份头（`OIDC_CLAIM_preferred_username`、`OIDC_CLAIM_groups`），且只接受回环/专网固定代理地址；自动化调用使用平台 API Token（P1）。
5. **OOD ↔ Slurm**：OOD 节点安装 Slurm 客户端、munge（同 key）、slurm.conf，`/etc/ood/config/clusters.d/*.yml` 定义 `v2.job.adapter: slurm`；提交经 sbatch/squeue/scontrol/sacct。
6. **平台后端 ↔ Slurm**：slurmrestd `auth/jwt`；只读令牌代表用户查询（`X-SLURM-USER-NAME`，需 Administrator/Operator 权限），写操作走 admin-ops 令牌与二次确认（D-10）。
7. **监控 ↔ dcgm**：dcgm-exporter 以 `--hpc-job-mapping-dir` 读取 Prolog 写入的 GPU↔作业映射，产生 `hpc_job` 标签；user/account 由后端查询期关联，不在 exporter 侧补标签。
8. **审计 ↔ 三源**：后端审计表、OOD Apache/Passenger 日志、sacct/slurmdbd 以 `job_id`/`request_id`/`uid` 关联（D-08）。
9. **同步服务**：LDAP→PostgreSQL（用户缓存/组/项目）→ Slurm（Account/Association/QOS），定时+事件触发、幂等、可 dry-run。

### 5.4 登录时序（正常路径）

```
浏览器 → GET /           : OOD Apache 无会话
       → 302 Dex（https://dex.<域名>/auth?client_id=ood&scope=openid profile email groups）
       → Dex LDAP connector 绑定校验（FreeIPA；管理员带 OTP）
       → 回调 Apache（https://<门户域名>/oidc），建立 mod_auth_openidc 会话
       → 映射 REMOTE_USER → nginx_stage 启动 PUN → 页面
浏览器 → GET /portal/    : 同一 OIDC 会话（Dex），Apache 反代 SPA（免二次登录）
浏览器 → GET /api/v1/me  : Apache 注入身份头 → 后端返回用户/角色
```

### 5.5 作业提交时序（OOD 路径）

```
用户填 form.yml → submit.yml.erb 渲染 sbatch 参数
→ OOD Slurm 适配器 sbatch（以用户身份）→ slurmctld 校验 Association/QOS → 分配 GRES
→ Prolog（best-effort 写 GPU↔JobID 映射）→ 作业启动（Apptainer --nv）
→ before.sh/script.sh.erb 启动服务 → connection.yml → OOD 反代 /node|/rnode
→ 结束/取消：Epilog 清理映射与临时文件
```

## 6. 端到端流程

### 6.1 账号开通与资源授权（D-03：LDAP 只读）

1. 用户在门户提交开通/变更申请（P2 前以工单表单或线下表单进入）；平台生成审批单，PI 或管理员审批。
2. 审批通过后，运维在 FreeIPA 执行开户脚本（`ipa user-add` 模板，含 uid、uidNumber、gidNumber、homeDirectory、loginShell、组；可选 sshPublicKey），平台只记录执行结果与操作人。
3. 平台同步服务（每 5 分钟 + 手动触发，幂等）读取 LDAP，更新 `users_cache`、`groups`、`projects`；随后同步 Slurm：创建 Account、Association，设置默认 QOS、`GrpTRES`、`MaxJobs`、`MaxSubmitJobs`、`GrpTRESRunMins`。
4. home/scratch 由存储侧配额系统或运维脚本创建（D-03；不得由普通用户自建目录绕过配额）。
5. 用户首次登录门户自动创建 PUN；平台显示“待完善资料/待加入项目”等引导项。

### 6.2 登录、SSO 会话与登出

- 会话参数：OIDC inactivity timeout = **7200s**（2 小时），max duration = **28800s**（8 小时）；登出采用 RP 发起登出并清理 Apache 会话与 Dex 会话。
- 管理员强制 MFA（D-02）；普通用户首期不做 MFA。
- 账号停用后的时效（写入验收标准）：**SSH/NSS 侧 ≤5 分钟**（SSSD 缓存 + LDAP 禁用）；**新 Web 登录立即拒绝**；**已存在的 Web 会话最迟在 inactivity TTL 内失效**；如需立即中断，执行 §14.5 Runbook（IdP 会话清理 + Apache 重载 + 终止 PUN）。
- 会话固定/重放防护：`mod_auth_openidc` 默认 state/nonce 校验；禁止将会话 cookie 暴露给交互式应用（OOD 4.1+ 默认剥离 `strip_proxy_cookies`，保持不变）。

### 6.3 作业提交与交互式应用

1. 表单/模板在 OOD 应用 `template/` 目录（form.yml、submit.yml.erb、before/script/after.sh.erb、connection.yml）；clusters.d 仅放全局 `batch_connect` 选项（如 `script_wrapper`）。
2. 表单字段：分区、GPU 型号与数量、CPU、内存、时长、计费账户、QOS、容器镜像；选项来自后端 `/api/v1/catalog`（按用户权限过滤）。
3. 提交：`sbatch --gres=gpu:<type>:<n> -A <account> -p <partition> -t <time>`；OOD 以用户身份执行，限额由 Slurm 硬校验。
4. 隔离：slurmd 设置 `CUDA_VISIBLE_DEVICES`；`cgroup.conf` 启用 `ConstrainDevices=yes` 作为设备白名单兜底（需在目标内核/cgroup v2 环境验证，见 PoC-06）。
5. 交互式应用：按应用选择反代方式——`/node`（保留完整 URI，适合能处理子路径的应用）或 `/rnode`（剥离前缀，适合相对路径应用）；首期不启用 `secure_node_uri`（计算节点侧 TLS 未部署），以私有网络隔离 + 一次性令牌 + `host_regex` 限制补偿。
6. 每个交互式服务必须设置一次性 token/密码；计算节点仅放行 OOD 节点到“应用端口池”（§12.3），禁止对全网开放。
7. 结束后 Epilog 清理：GPU 映射文件、临时目录、残留进程；Prolog/Epilog 失败不得阻塞作业（必须 `exit 0` 并记录日志）。

### 6.4 GPU 监控与 dcgm 作业映射（D-10 相关）

1. 采集参数：dcgm-exporter 启动参数 `--collect-interval=15000 --hpc-job-mapping-dir=/var/lib/dcgm-exporter/job`；Prometheus 抓取间隔 15s；页面推送 5s（服务端缓存 5s）。
2. 映射目录与文件：目录属主 root/0755；文件名 `<gpu-id>`（MIG 场景为 `<gpu-id>.<gpu-instance-id>`，首期不启用 MIG），每行一个 JobID；Prolog 以 root 写入，Epilog 删除；多节点作业在每个节点各写本节点 GPU。
3. 标签：dcgm 指标得到 `hpc_job`；`user/account/partition` **不在 exporter 上补**，由后端按 `hpc_job` 关联作业元数据（查询期 join/缓存），因为 Prometheus 无法跨 exporter 给已有序列追加动态标签。
4. 指标可用性：默认 collector 已含 GPU 利用率、显存、温度、功耗、SM/显存时钟、Tensor 活跃度、NVLink 带宽、XID 错误（带 `err_code`/`err_msg`）；ECC SBE/DBE、retired pages、NVLink CRC/replay 等为可选行，需显式启用（A-02 要求 ECC）。
5. 掉卡/映射缺失兜底：后端按 Slurm 分配信息（`scontrol`/`sacct` + `SLURM_JOB_GPUS`）对账；连续 3 个采集周期无 `hpc_job` 的 GPU 产生告警。

### 6.5 计量与账单（D-07）

1. 记账前提：`AccountingStorageTRES=gres/gpu`（按型号细分时同时配置 `gres/gpu:<model>`）；`AccountingStorageEnforce=associations,limits,qos`。
2. ETL：每小时拉取作业记账（优先 slurmdbd REST/sacct，不直接依赖 slurmdbd 表结构）；水位线 = 上次成功结束时间 − 10 分钟重叠窗口，写入 `etl_watermark`；作业唯一键 `(cluster, job_id, array_task_id, submit_time, attempt)`，幂等重跑。
3. 特殊状态：数组作业按 `array_task_id` 逐项计量；requeue 以最终完成记录为准，NODE_FAIL 不重复计费；取消作业按实际运行区间计费；运行中作业每小时快照估算，结束后以最终值校正。
4. 汇总：`job_usage`（事实）→ `usage_daily`（日汇总，含 cluster 字段）→ 账单。
5. 计价：按 `price_rules`（GPU 型号/优先级/时段系数/免费额度/折扣，含生效区间与版本）计算；账单状态 draft→issued→paid（内部记账为已分摊）；出账后只允许冲正，冲正单不超过 1 个账期。
6. 对账：每月执行 `sreport`（按目标版本校准命令，例如 `sreport cluster AccountUtilizationByUser Start=... End=... TRES=gres/gpu`）与 `job_usage` 汇总比对；阈值 0.5%；每月抽查 100 个作业，GPU·h 与 `sacct` 分配值一致（含取整规则）。
7. MIG：首期不启用；若启用须先通过 M0 PoC-03，并在 §2.2 与价格表更新后实施。

### 6.6 额度联动（D-11）

- 钱包：`wallets`（余额）+ `wallet_ledger`（充值/扣费/退款/冲正流水，金额变动必须有流水）。
- Slurm 硬限：并发 GPU 数用 `GrpTRES=gres/gpu=<n>`；运行时长用 `GrpTRESRunMins`；月额度由 ETL 月末计算后写入 `GrpTRESMins`（并记录写入事件）。
- 预警：余额/额度 80%、100% 各一次通知 PI 与用户；耗尽后新作业被拒绝，运行中作业不强制杀（除非管理员操作）。
- 对账：每日比对钱包余额与账单累计扣费，差异 >0 元告警；Slurm 限额与平台额度每日比对。

### 6.7 告警与故障处置（D-09）

| 级别 | 触发示例 | 处置 |
| --- | --- | --- |
| 严重（自动） | 掉卡（XID 79/119/120）、不可纠正 ECC、节点 down、GPU 数量少于资产台账 | 自动 drain（白名单，限速 2 节点/小时）→ 工单 → 通知用户与运维 |
| 严重（人工） | 其他 NVIDIA 标记 Fatal 的 XID、NVLink 链路错误、温度持续超阈值 | 通知值班，人工确认后 drain |
| 警告 | XID 非致命（如应用类 XID）、单卡利用率异常、显存泄漏模式 | 记录/通知用户，不自动处置 |
| 信息 | 证书 14 天内到期、磁盘 >85%、登录失败率上升 | 通知对应负责人 |

> 首期（M5 前）自动 drain 由值班按 Runbook 人工执行；自动处置能力在 M6 上线（A-06），本表为设计目标。

所有自动处置必须可回滚（`scontrol update State=RESUME`）并记录处理结论；XID 分级以 NVIDIA Xid Errors 表与目标驱动版本为准。

### 6.8 账号停用与退场

1. LDAP 禁用/移出组（运维执行）→ 同步服务取消 Slurm Association（历史记录保留）→ 通知用户。
2. 运行中作业：默认给予 15 分钟宽限并通知，到期后 `scancel`；排队作业立即取消；数据按保留策略归档。
3. 终止 PUN、清理临时目录与 token；保留账单关联与审计记录。
4. 验收：新登录立即失败；已完成作业计量不受影响；审计可查。

### 6.9 审计数据流（D-08）

- 源 1：平台后端审计表（账户/配额/价格/规则/账单/节点操作），字段见 §9.1；append-only。
- 源 2：OOD Apache access/error 日志与 PUN 日志（登录、提交、文件、终端），按天归档。
- 源 3：sacct/slurmdbd 作业生命周期（提交、开始、结束、取消、requeue）。
- 关联键：`job_id`、`request_id`、`uid`、时间窗口；后端提供统一审计查询 `/api/v1/audit`，支持按用户、作业、对象、时间检索。
- 完整性：审计账号仅有 INSERT；哈希链（`prev_hash`/`hash`）每日生成摘要并写入独立备份；发现缺失/断裂告警。

## 7. 功能需求（含验收标准）

> 每条需求必须有可执行判定；验收方法写入 §14.2/§15.5。优先级：P0 首期上线必需；P1 上线后 3 个月内；P2 择机。

### 7.1 GPU 监控管理平台（A）

| 编号 | 需求 | 优先级 | 验收标准（可执行判定） | 里程碑 |
| --- | --- | --- | --- | --- |
| A-01 | GPU 资产台账：节点、机架、GPU 型号、UUID、序列号、驱动/CUDA 版本、MIG 模式（只读）、PCIe/NVLink 拓扑；来源 DCGM、nvidia-smi、scontrol | P0 | 100% 在线 GPU 的 UUID 与节点/机架/型号入台账；换卡/驱动升级后 1 个采集周期内更新；抽查 10% 节点与 `nvidia-smi`/DCGM 一致 | M2 |
| A-02 | 实时指标：利用率、显存、温度、功耗、SM/显存时钟、PCIe/NVLink 带宽、ECC、XID；采集周期 15s | P0 | dcgm-exporter `--collect-interval=15000`，Prometheus 抓取 15s；页面首屏 P95 ≤5s、推送 ≤10s；采集到可见延迟 P95 ≤30s；ECC 可选指标已启用并有数据 | M2 |
| A-03 | 集群总览：GPU 总数/已分配/空闲/故障/Drain，按分区、型号、机架聚合 | P0 | 与 `sinfo`/`scontrol show node` 统计一致（差异 0）；总览接口 P95 ≤500ms（缓存 5s） | M2 |
| A-04 | GPU↔作业↔用户关联：GPU 下钻到作业/用户/账户/运行时长；作业下钻到 GPU 曲线 | P0 | 抽样 20 个运行中作业，GPU 序列的 `hpc_job` 与作业一致；user/account 由后端关联正确；无映射时展示“未关联”并告警 | M2 |
| A-05 | 告警规则管理：阈值/持续/级别/渠道/静默/升级；版本化与回滚 | P0 | 管理界面修改规则 → 1 分钟内生效；历史版本可查看/回滚；变更写审计；静默按用户/节点/规则生效 | M2 |
| A-06 | 健康与故障：XID/不可纠正 ECC/掉卡/过温/降频检测；自动或确认后 drain 并生成处置记录 | P1 | XID 按 Fatal/Nonfatal 分级；自动 drain 仅白名单且限速；误报率抽检 ≤5%；工单闭环率 100% | M6 |
| A-07 | 低效利用识别：连续 1h GPU 利用率 <5% 且显存占用 >0，通知用户/管理员 | P1 | 每日扫描；通知可达；抽检 10 条误报 ≤2 条；可配置阈值 | M6 |
| A-08 | 历史趋势与对比：GPU/节点/分区/用户/时间窗，导出 CSV | P1 | 30 天范围查询 P95 ≤3s；导出字段完整；大数据量异步任务 + 进度 | M6 |

### 7.2 算力集群资源调用平台（B）

| 编号 | 需求 | 优先级 | 验收标准 | 里程碑 |
| --- | --- | --- | --- | --- |
| B-01 | 统一登录：LDAP 账号登录 OOD 与平台，单点登录 | P0 | 登录 OOD 后访问 `/portal` 免二次登录；统一登出；`/api/v1/me` 返回正确角色 | M1 |
| B-02 | 资源目录：分区、QOS、GPU 型号、可用量、预计排队时间 | P0 | 数据与 `sinfo`/`squeue` 一致（30s 缓存内）；按权限过滤；无权限项不可见 | M3 |
| B-03 | 作业提交：OOD Job Composer 模板 + 自定义训练表单；模板库管理员维护 | P0 | 提供 ≥4 类模板；提交成功率 ≥99%（演练）；超限前端提示且 Slurm 二次拦截 | M3 |
| B-04 | 交互式应用：Jupyter、VS Code、远程桌面、TensorBoard（batch_connect） | P0 | 资源就绪后 60s 内可打开页面；8h WebSocket 不断连；一次性 token；按应用选择 `/node` 或 `/rnode` | M1（基础）/M3（完善） |
| B-05 | 作业管理：列表、详情、日志、取消、重提交、依赖与数组作业 | P0 | 取消生效 ≤10s；日志可下载；作业列表（10 万条）分页 P95 ≤1s（PG 读模型） | M3 |
| B-06 | 配额与限额：并行作业数、GPU 数、最长时长、运行时长/月额度；提交前提示 | P0 | 超限提交被前端提示且 Slurm 拒绝；限额修改 ≤1 分钟生效；与 Slurm 限额每日对账 | M3 |
| B-07 | 文件管理：OOD Files；展示存储配额与使用量 | P0 | 配额展示与存储侧查询一致；超配额上传被拒；大文件下载有提示 | M3 |
| B-08 | 环境与镜像：Apptainer 镜像白名单、预置镜像、Lmod、Conda 使用说明 | P1 | 镜像白名单流程可执行；预置镜像 ≥5 个；文档可检索 | M6 |
| B-09 | 优先级、抢占与预约：QOS 优先级、可抢占队列、Reservation | P1 | 配置模板与操作手册；演练抢占与预约；用户可见队列策略 | M6 |
| B-10 | 管理员运维：节点 drain/resume、强制取消、调整优先级，全部审计 | P1 | 批量操作 ≤100 节点；全部写审计；误操作可回滚（resume/恢复优先级） | M6 |
| B-11 | 申请与审批：配额增加、时长延期、专用预约；PI+管理员两级 | P2 | 审批状态机完整；通知可达；与限额联动 | P2 |

### 7.3 算力监控与计量平台（C）

| 编号 | 需求 | 优先级 | 验收标准 | 里程碑 |
| --- | --- | --- | --- | --- |
| C-01 | 作业级用量：GPU·h、CPU·h、内存 GB·h、等待时间（来源 slurmdbd） | P0 | 100% 完成作业入账；抽样 100 个作业与 `sacct` 一致（含取整规则）；NODE_FAIL 不重复计费 | M4 |
| C-02 | 多维聚合：用户、组、项目、分区、GPU 型号、日/周/月 | P0 | 90 天范围查询 P95 ≤3s；聚合与明细可交叉验证 | M4 |
| C-03 | 计费规则：按型号定价、优先级/时段系数、免费额度、折扣；生效区间与版本 | P1 | 规则改版不改变历史账单；同一时段规则唯一；价格变更审批留痕 | M6 |
| C-04 | 余额与额度控制：预充值/配额两模式；80%/100% 预警；耗尽限制新作业 | P0（内部记账） | 预警可达；耗尽后新作业被拒；充值后自动解除；日对账差异 0 | M4 |
| C-05 | 账单与报表：日/月账单、CSV/PDF、邮件订阅 | P1 | 账单可下载；出账后仅允许冲正；抽检金额与明细一致 | M6 |
| C-06 | 资源效率：分配 vs 实际利用（GPU 利用率/显存/CPU） | P1 | 按作业/用户聚合；缺失映射时标注；周报可导出 | M6 |
| C-07 | 容量分析：排队等待、分区利用率、碎片率、峰值时段 | P2 | 指标定义文档化；查询可用 | P2 |
| C-08 | 审计日志：登录、提交、取消、配额、规则、账单变动 | P0 | 三源覆盖（D-08）；按用户/作业/时间检索 P95 ≤3s；保留 1 年；防篡改校验通过 | M3（查询）/M4（三源） |
| C-09 | 平台自监控：slurmctld/slurmdbd/slurmrestd/OOD/Dex/LDAP/Prometheus/PostgreSQL/磁盘/证书 | P0 | 组件健康、指标断流、队列积压、备份失败、证书到期均有告警；监控自身故障由外部 deadman 告警 | M3 |

### 7.4 计量口径（D-07）

- **GPU·h** = Σ（作业分配的整卡 `gres/gpu` 数量 × 计费秒数 ÷ 3600）；首期不启用 MIG；MIG 启用需先修订本节与价格表。
- **计费秒数** = `end_time − start_time`（按 slurmdbd 记录）；不足 1 分钟按 1 分钟向上取整（建议值，写入价格规则配置）。
- **不计费**：排队时间；因 NODE_FAIL 失败且未实际运行的部分；管理员冲正的作业（需审计）。
- **跨日/跨月**：运行中作业每小时快照估算；结束后以最终值校正；账单日界 00:00 Asia/Shanghai；校正差异计入下一账期冲正。
- **费用** = Σ（用量 × 单价 × 系数）；建议配置 `TRESBillingWeights` 使公平份额与价格方向一致，但财务金额以平台价格表为准。
- **对账口径**：作业级抽样完全一致 + 月总量偏差 ≤0.5%（GPU·h 与金额双口径）；sreport 命令按目标 Slurm 版本校准并固化到脚本。

### 7.5 需求变更

新增/修改需求须更新本表、§15.4 追溯矩阵与验收项，并在评审记录中说明影响（范围/工期/风险）；未进入追溯矩阵的需求不得开发。

## 8. 非功能需求与容量

### 8.1 性能（负载模型与测量点）

| 指标 | 目标 | 测量条件 |
| --- | --- | --- |
| 实时页面首屏 | P95 ≤5s，P99 ≤8s | 300 并发 Web、500 节点、512 GPU 基线数据 |
| 页面数据推送间隔 | ≤10s | SSE，服务端缓存 5s |
| 作业列表（10 万条） | 分页 P95 ≤1s | 每页 ≤200 条，走 PG 读模型；禁止直连 slurmrestd 全量拉取 |
| 监控历史查询（30 天） | P95 ≤3s，单次 ≤1000 点 | Prometheus 降采样 + recording rules |
| 用量/账单查询（90 天） | P95 ≤3s | 预聚合表 |
| 指标采集到可见延迟 | P95 ≤30s | 采集 15s + 抓取 15s |

测量方法：预发环境按基线数据量与混合比例压测，使用固定脚本与采样窗口（≥30 分钟），结果写入验收报告。

### 8.2 可用性 SLO

| 范围 | 目标 | 测量/口径 |
| --- | --- | --- |
| 认证链路（LDAP + Dex + Apache OIDC） | 99.9% | 每分钟探针，2 个观测点，按月统计 |
| OOD 门户（首期） | 99.5% | 同上；12 个月后目标 99.9% |
| slurmctld / slurmdbd | 99.9% | 进程与端口探针 + 关键 API |
| PostgreSQL / 计量 API | 99.9% | 探针 |
| Prometheus/告警 | 99.5% | 探针；自身故障由外部 deadman 检测 |

计划维护窗口（D-12）不计入 SLO；无维护窗口的紧急变更需记录豁免原因。未达 SLO 时按季度做根因复盘。

### 8.3 安全与合规

见 §13。最低要求：全链路 TLS 1.2+、LDAPS、管理员 MFA、审计三源与防篡改、密钥/证书生命周期管理、镜像扫描、漏洞修复时限（高危 72 小时评估）、等保级别按 §16.2-T06 确认。

### 8.4 容量模型（M0 实测校准）

| 项 | 估算 | 说明 |
| --- | --- | --- |
| Prometheus 活跃序列 | 约 7–10 万 | GPU 512×约 25 + 节点 64×约 800 + Slurm/平台；M0 实测 |
| 原始指标存储（30 天） | 约 30–100GB | 15s 抓取、1.5–2 B/样本；数据盘独立 ≥200GB |
| PostgreSQL 作业事实表 | 5 年约 700 万行（12 万/月） | 按年分区 + 冷归档 |
| OOD/PUN 内存 | 150 并发 × 约 150MB ≈ 22.5GB | OOD 节点建议 16C/64G ×2（参考 OSC 经验值），M0 压测复核 |
| 审计日志量 | 约 2–10GB/月 | 保留 1 年热数据 + 归档 |
| 集中日志 | 约 50–200GB/月 | 保留 30 天热 + 180 天归档 |

容量不足的判定：Prometheus 内存 >70%、PG 分区增长超线性、/tmp 或日志盘 >85%、PUN 启动失败率 >1% 时触发扩容评审。

### 8.5 可维护、可扩展、兼容与数据保留

- **可维护**：配置即代码（Git + Ansible），部署幂等，日志 JSON 集中；版本基线见 §2.4。
- **可扩展**：新增 GPU 型号/分区/价格项只需配置；Prometheus 支持分片/联邦；平台无状态水平扩容。
- **兼容性**：Chrome/Edge/Firefox 最近两个主版本；宽 1366px 以上正常。
- **数据保留矩阵**：

| 数据类 | 在线 | 归档 | 备份 | RPO | RTO |
| --- | --- | --- | --- | --- | --- |
| 原始指标 | 30 天 | 降采样 1 年 | 不单独备份 | 不适用 | 不适用 |
| 作业记账/账单 | 5 年 | 按年冷归档 | 每日全量 + binlog | ≤15 分钟 | ≤2 小时 |
| 审计日志 | 1 年 | 5 年 | 每日摘要 + 独立备份 | ≤15 分钟 | ≤2 小时 |
| 业务库 | 5 年 | 按年归档 | 每日全量 + WAL | ≤15 分钟 | ≤2 小时 |
| 配置/规则 | 永久 | Git 历史 | 异地 Git 镜像 | 不适用 | ≤30 分钟 |
| slurmctld 状态 | 实时共享 | 每日快照 7 天 | 快照 + 共享存储 | 切换秒级/灾备 24 小时 | 切换 ≤5 分钟/重建 ≤4 小时 |

## 9. 前后端协作设计

### 9.1 职责边界

- **OOD**：用户态作业/交互应用/文件/终端，以用户本人身份运行；不访问平台业务库。
- **平台 SPA**：资源目录、作业视图、监控与告警、用量与账单、管理控制台；只调用 `/api`。
- **平台后端**：身份/角色映射、RBAC 与对象级校验、封装 Slurm/LDAP/Prometheus/DB、ETL、审计、告警接收。
- **边界原则**：前端不直连 Slurm/LDAP/Prometheus/Grafana；后端不绕过 Slurm 实现调度语义；OOD 与平台仅通过 OIDC 与只读接口协作。

### 9.2 页面清单

| 路由 | 页面 | 角色 | 主要数据源 |
| --- | --- | --- | --- |
| `/portal/` | 工作台（我的作业、配额、告警摘要） | 全部 | `/me`、`/jobs`、`/alerts` |
| `/portal/catalog` | 资源目录与提交入口 | 全部 | `/catalog` |
| `/portal/jobs` | 我的作业列表/筛选 | 全部 | `/jobs` |
| `/portal/jobs/:id` | 作业详情、日志、GPU 曲线 | 全部（本人） | `/jobs/:id`、`/jobs/:id/metrics` |
| `/portal/monitor` | 集群总览（GPU/节点/告警） | 运维/管理员/审计只读 | `/nodes`、`/gpus`、SSE |
| `/portal/monitor/gpus` | GPU 列表与筛选 | 运维/管理员 | `/gpus` |
| `/portal/monitor/gpus/:uuid` | GPU 详情（指标/作业/拓扑） | 运维/管理员 | `/gpus/:uuid/metrics` |
| `/portal/alerts` | 告警中心与处置 | 运维/管理员 | `/alerts`、`/alert-rules` |
| `/portal/usage` | 用量分析（本人/本组/全局） | 全部（按范围） | `/usage` |
| `/portal/bills` | 账单（日/月） | PI/财务/管理员 | `/bills` |
| `/portal/admin/users` | 用户、组、项目与同步状态 | 管理员/运维（只读） | `/accounts`、`/sync/status` |
| `/portal/admin/quotas` | 配额与限额 | 管理员 | `/quotas` |
| `/portal/admin/pricing` | 价格规则（P1） | 管理员/财务复核 | `/pricing/rules` |
| `/portal/admin/alert-rules` | 告警规则管理 | 管理员/运维 | `/alert-rules` |
| `/portal/admin/audit` | 审计检索与导出 | 管理员/审计 | `/audit` |
| `/portal/admin/system` | 平台自监控 | 管理员/运维 | `/system/status` |

交互要求：所有列表支持筛选/排序/分页；错误态、空态、无权限态明确；危险操作二次确认并展示影响范围；异步操作显示任务进度（`/tasks/{id}` 或 SSE）。

### 9.3 认证与授权协作

1. 浏览器会话由 Apache + `mod_auth_openidc` 建立；SPA 用同源 cookie 调用 `/api`，不把令牌写入 localStorage。
2. Apache 向后端注入 `OIDC_CLAIM_preferred_username`、`OIDC_CLAIM_groups`、`OIDC_CLAIM_email`，并携带 `X-Request-Id`；后端只接受来自回环/固定代理 IP 的请求。
3. 后端校验：身份头存在、用户存在于 LDAP 缓存、角色由 groups 映射；对象级校验在服务层完成。
4. CSRF：写接口校验 `Origin`/`Referer` 同源 + 自定义头 `X-CSRF-Token`（会话内下发）；幂等写接口支持 `Idempotency-Key`。
5. 自动化/脚本：P1 提供平台 API Token（`/api/v1/tokens`），权限为只读或作业管理子集，独立审计。
6. 前端不持有 Slurm/LDAP/数据库凭据；后端不向前端返回他人敏感字段（邮箱可脱敏）。

### 9.4 API 约定

- REST + JSON，前缀 `/api/v1`；OpenAPI 3 契约先行；破坏性变更升 v2。
- 统一响应：`{code, message, data, request_id}`；HTTP 状态码表达传输层语义，业务码见 §9.6。
- 分页：`page`、`page_size`（≤200）；大结果集用游标（`cursor`）；排序/过滤使用白名单字段。
- 时间：UTC ISO 8601；金额：十进制字符串（两位小数）；单位：GPU·h 四位小数。
- 异步：账号同步、报表导出等返回 `task_id`，前端轮询 `/tasks/{id}` 或订阅 SSE。
- 实时：GPU/告警使用 SSE；断线自动重连并携带 `Last-Event-ID` 回补（窗口 5 分钟，超出回补走 REST 快照）。
- 保护：每用户读 10 rps / 写 1 rps；PromQL 单次 ≤1000 点、跨度 ≤30 天；SSE 每用户 ≤5 连接；集群总览缓存 5s。

### 9.5 首期接口清单

| 模块 | 接口 | 说明 |
| --- | --- | --- |
| 身份 | `GET /api/v1/me` | 当前用户、角色、组、账户、可用配额 |
| 目录 | `GET /api/v1/catalog` | 分区、QOS、GPU 型号、可用量、预计等待 |
| 作业 | `GET /api/v1/jobs`；`GET /api/v1/jobs/{id}` | 列表（筛选/分页）、详情 |
| 作业 | `DELETE /api/v1/jobs/{id}` | 取消（本人/管理员） |
| 作业 | `GET /api/v1/jobs/{id}/logs`；`GET /api/v1/jobs/{id}/metrics` | 日志与 GPU 曲线（后端关联 `hpc_job`） |
| 作业 | `GET /api/v1/stream/jobs`（SSE） | 作业状态变化（可选 P1） |
| 节点 | `GET /api/v1/nodes`；`POST /nodes/{name}/drain`；`POST /nodes/{name}/resume` | 节点状态与处置（审计） |
| GPU | `GET /api/v1/gpus`；`GET /gpus/{uuid}`；`GET /gpus/{uuid}/metrics` | 资产与指标 |
| GPU | `GET /api/v1/stream/gpus`（SSE） | 实时 GPU 指标推送 |
| 告警 | `GET /api/v1/alerts`；`POST /alerts/{id}/ack`；`POST /alerts/{id}/resolve` | 告警查询与处置 |
| 告警 | `POST /api/v1/alerts/webhook` | Alertmanager 回调（内部） |
| 告警 | `GET/POST/PUT/DELETE /api/v1/alert-rules`；`POST /alert-rules/{id}/rollback` | 规则管理与回滚 |
| 用量 | `GET /api/v1/usage`；`POST /usage/export`（P1） | 多维用量与导出 |
| 账单 | `GET /api/v1/bills`；`GET /bills/{id}`；`POST /bills/{id}/export`（P1）；`POST /bills/{id}/reversal` | 账单与冲正 |
| 钱包 | `GET /api/v1/wallets/{account}`；`POST /wallets/{account}/ledger`（管理员） | 余额与流水 |
| 配额 | `GET /api/v1/quotas`；`PUT /quotas/{account}` | 配额与限额（写 Slurm） |
| 账户 | `GET /api/v1/accounts`；`GET /accounts/{id}` | 只读（LDAP 写路径 D-03） |
| 同步 | `POST /api/v1/sync/ldap?dry_run=true`；`GET /sync/status` | 同步与差异报告 |
| 任务 | `GET /api/v1/tasks/{id}` | 异步任务进度 |
| 审计 | `GET /api/v1/audit` | 三源检索（管理员/审计） |
| 价格 | `GET/POST/PUT /api/v1/pricing/rules`（P1） | 价格规则与版本 |
| 系统 | `GET /api/v1/system/status`；`GET /system/certificates` | 自监控与证书 |

### 9.6 错误码

| 业务码 | HTTP | 含义 |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | 未认证/会话过期 |
| `FORBIDDEN` | 403 | 无权限 |
| `OBJECT_SCOPE_DENIED` | 403 | 超出本人/本组数据范围 |
| `NOT_FOUND` | 404 | 对象不存在 |
| `VALIDATION_FAILED` | 400 | 参数校验失败 |
| `INVALID_STATE` | 409 | 对象状态不允许该操作 |
| `IDEMPOTENCY_CONFLICT` | 409 | 幂等键冲突 |
| `QUOTA_EXCEEDED` | 422 | 超出配额/额度 |
| `SLURM_REJECTED` | 422 | Slurm 拒绝（限额/分区/QOS） |
| `SLURM_UNAVAILABLE` | 503 | slurmrestd/调度器不可用 |
| `PROMETHEUS_UNAVAILABLE` | 503 | 指标后端不可用 |
| `UPSTREAM_TIMEOUT` | 504 | 上游超时 |
| `RATE_LIMITED` | 429 | 限流 |
| `TASK_CONFLICT` | 409 | 同类异步任务进行中 |
| `INTERNAL_ERROR` | 500 | 未分类错误（含 request_id） |

### 9.7 状态机

- **审批单**（P2 前为工单）：draft → submitted → pi_approved/rejected → admin_approved/rejected → provisioning → provisioned → closed；任一步可撤回（cancelled）。
- **账单**：draft → issued →（内部）settled；issued 后仅可通过 reversal 生成负数冲正单；禁止原地修改。
- **告警**：firing → acked → resolved；firing → silenced（到期回到 firing）；resolved 后 7 天内不可重复升级。
- **异步任务**：queued → running（progress 0-100）→ succeeded/failed；失败可重试（≤3 次），超时 30 分钟标记 failed。
- **同步任务**：queued → dry_run_completed → applied → succeeded/failed；每次记录差异数、耗时、错误摘要。
- **作业展示状态映射**：Slurm（PENDING/RUNNING/COMPLETING/COMPLETED/FAILED/CANCELLED/TIMEOUT/NODE_FAIL/PREEMPTED）→ 平台统一展示值；未知状态显示原始值并告警。

### 9.8 SSE 事件 schema

```
event: gpu.sample
id: 1732500000123
data: {"ts":1732500000,"cluster":"gpu-cluster","node":"gpu-01","gpu_uuid":"GPU-...",
       "gpu_index":0,"hpc_job":null,"util":0.93,"mem_used_mib":60123,"temp_c":62,
       "power_w":412,"xid":null}

event: alert
data: {"fingerprint":"...","rule":"gpu_xid_fatal","severity":"critical",
       "node":"gpu-03","gpu_uuid":"...","job_id":12345,"state":"firing","ts":...}

event: heartbeat
data: {"ts":...,"server":"api-1"}
```

约束：`id` 单调；客户端重连携带 `Last-Event-ID`；断线 30s 后指数退避（1-30s）；心跳 15s；单连接 1 小时自动重连。

### 9.9 缓存与降级

| 数据 | TTL | 降级策略 |
| --- | --- | --- |
| 集群总览 | 5s | 返回上次快照并标注时间 |
| GPU/节点列表 | 5s | 同上 |
| 资源目录 | 30s | 返回上次快照 |
| 作业列表 | 不缓存（PG 读模型） | Slurm 不可用时展示最近同步状态 |
| 用量/账单 | 60s / 不缓存 | 报表异步生成 |
| Prometheus 不可用 | — | 页面显示“指标暂不可用”，不影响作业/账单 |

## 10. 数据模型与指标

### 10.1 PostgreSQL 主要表

| 表 | 关键字段 | 约束/索引 | 说明 |
| --- | --- | --- | --- |
| `users_cache` | `uid` PK, `uid_number` UQ, `gid_number`, `display_name`, `email`, `status`, `groups` jsonb, `ldap_dn`, `synced_at` | `uid_number` 唯一；`status` 索引 | LDAP 只读缓存（权威在 LDAP） |
| `groups` | `account` PK, `display_name`, `pi_uid`, `slurm_account` UQ, `project_id`, `status` | 与 Slurm Account 1:1 | 课题组 |
| `projects` | `project_id` PK, `account` FK, `name`, `budget_type`, `budget_amount`, `status` | `account` 索引 | 项目（首期与账号 1:1） |
| `node_asset` | `node` PK, `rack`, `role`, `gpu_count`, `state`, `updated_at` | `rack` 索引 | 节点与机架（A-01/A-03） |
| `gpu_asset` | `gpu_uuid` PK, `node` FK, `gpu_index`, `model`, `serial`, `mig_mode`, `driver_version`, `cuda_version`, `pci_bus`, `nvlink_topology` jsonb, `updated_at` | `(node, gpu_index)` 唯一 | GPU 资产台账 |
| `job_usage` | `cluster, job_id, array_task_id, submit_time, attempt` PK；`uid, account, project, partition, qos, gpu_type, gpu_count, cpu_alloc, mem_mb, start_time, end_time, elapsed_sec, state, gpu_hours numeric(12,4), cost numeric(14,2), source, corrected, created_at` | 主键如上；`(account, end_time)`、`(uid, end_time)`、`(partition, end_time)` 索引；按 `submit_time` 月分区 | 用量事实表；数组/requeue 不冲突 |
| `usage_daily` | `date, cluster, account, uid, partition, gpu_type` PK；`gpu_hours, cpu_hours, cost` | 按 date 分区 | 日汇总，支撑报表 |
| `etl_watermark` | `source` PK, `last_end_time`, `last_run_at`, `status` | — | ETL 增量水位线 |
| `price_rules` | `rule_id` PK, `resource_type`, `gpu_type`, `unit_price`, `coefficient`, `qos`, `valid_from`, `valid_to`, `version`, `status`, `created_by` | `(resource_type, gpu_type, valid_from)` 索引；历史不可改 | 价格表 |
| `wallets` | `account` PK, `balance`, `credit_limit`, `period`, `updated_at` | — | 余额/额度 |
| `wallet_ledger` | `entry_id` PK, `account`, `amount`, `type`(topup/charge/refund/rebate), `ref_type`, `ref_id`, `balance_after`, `created_at`, `created_by` | `(account, created_at)` 索引 | 钱包流水（必须） |
| `bills` | `bill_id` PK, `account`, `period_start`, `period_end`, `amount`, `status`, `issued_at`, `reversed_by` | `(account, period_start)` 索引 | 账单，出账后只冲正 |
| `bill_items` | `bill_id, item_type, ref` PK；`gpu_hours, cpu_hours, amount` | — | 账单明细 |
| `alert_rules` | `rule_id` PK, `name`, `expr`, `severity`, `duration`, `channels` jsonb, `silence` jsonb, `escalate`, `version`, `status`, `updated_by` | — | 规则当前版本 |
| `alert_rule_versions` | `rule_id, version` PK；`content` jsonb, `created_at`, `created_by` | — | 规则历史，可回滚 |
| `alerts` | `fingerprint` PK, `rule_id`, `severity`, `node`, `gpu_uuid`, `job_id`, `state`, `started_at`, `acked_by`, `resolved_at`, `resolution`, `ticket_id` | `(state, started_at)` 索引 | 告警 |
| `tickets` | `ticket_id` PK, `alert_id`, `assignee`, `status`, `resolution`, `opened_at`, `closed_at` | — | 处置工单 |
| `audit_log` | `id` bigserial, `ts`, `actor_uid`, `actor_role`, `action`, `object_type`, `object_id`, `before` jsonb, `after` jsonb, `ip`, `request_id`, `prev_hash`, `hash` | PK `(id, ts)`；按 `ts` 月分区；仅 INSERT | 审计（哈希链） |
| `approvals` | `id` PK, `type`, `applicant`, `target`, `payload` jsonb, `status`, `approver`, `decided_at`, `comment` | — | 审批 |
| `tasks` | `task_id` PK, `type`, `status`, `progress`, `payload`, `result`, `created_by`, `created_at`, `finished_at` | `(status, created_at)` 索引 | 异步任务 |
| `sync_runs` | `run_id` PK, `source`, `dry_run`, `diff_count`, `status`, `started_at`, `finished_at`, `detail` jsonb | — | 同步历史 |
| `role_mapping` | `role` PK, `ldap_group` UQ | — | 角色映射（可在配置中维护） |
| `api_tokens`（P1） | `token_id` PK, `owner_uid`, `scope`, `token_hash`, `expires_at`, `status` | `owner_uid` 索引 | 自动化令牌 |

### 10.2 分区、归档与保留

- `job_usage`、`audit_log` 按月分区；`usage_daily` 按年分区；保留策略见 §8.5。
- 归档任务：每周将超过在线期的分区导出为 Parquet/CSV 至归档存储，校验行数与金额后删除分区。
- 索引用途明确，避免重复索引；大表禁止无界查询（API 强制时间范围 ≤90 天，账单/审计可放宽带审计权限）。

### 10.3 数据初始化与迁移（首期上线）

1. 初始化管理员与角色映射（LDAP 组需先存在）；初始化 QOS/分区/价格规则。
2. LDAP 存量用户导入：以同步服务全量 dry-run 生成差异报告，确认后应用；只读，不修改 LDAP。
3. Slurm 存量 Account/Association 导入：`sacctmgr dump` 备份后比对；差异人工确认。
4. 历史作业回补：按 sreport 月度总量与回补结果对账，偏差 >0.5% 停止并排查。
5. 迁移脚本纳入 Git 与发布流水线；可回退（备份 + 只回滚代码不删数据）。

### 10.4 Prometheus 指标与标签

- **GPU（dcgm-exporter）**：`DCGM_FI_DEV_GPU_UTIL`、`DCGM_FI_DEV_FB_USED/FREE`、`DCGM_FI_DEV_GPU_TEMP`、`DCGM_FI_DEV_POWER_USAGE`、`DCGM_FI_DEV_SM_CLOCK`、`DCGM_FI_DEV_MEM_CLOCK`、`DCGM_FI_PROF_PIPE_TENSOR_ACTIVE`、`DCGM_FI_DEV_NVLINK_BANDWIDTH_TOTAL`、`DCGM_FI_DEV_XID_ERRORS`（`err_code`/`err_msg`）；ECC/retired/CRC 为可选行，按 A-02 启用。
- **节点**：node_exporter（CPU、内存、磁盘、网络、温度）。
- **Slurm**：slurm-exporter（节点状态、排队/运行作业数、分区 GPU 分配、调度延迟）；具体 exporter 项目与指标名在 M0 锁定并写入验收报告（ACC-04）。
- **标签**：`cluster`、`node`、`gpu`（序号）、`gpu_uuid`、`modelName`、`hostname`、`hpc_job`；**不添加** user/account/partition 标签（高基数且无法跨 exporter 补）。
- **recording rules**（必须）：`cluster:gpu_util:avg5m`、`cluster:gpu_alloc:count`、`node:gpu_util:avg5m`、`job:gpu_util:avg5m`（仅原始保留期）；长期趋势按节点/分区/型号预聚合。
- **基数控制**：`hpc_job` 仅保留在原始数据（30 天）；长期数据移除该标签；单条时间序列标签数 ≤15。
- **查询与权限**：后端按 RBAC 限定 `cluster/node` 白名单；禁止前端传入任意 PromQL；PromQL 模板化并限制点数。

### 10.5 XID 分级与告警规则（D-09）

| 分类 | 示例 | 处置 |
| --- | --- | --- |
| 掉卡/总线致命 | XID 79、119、120 | 严重；自动 drain（白名单）+ 工单 + 通知 |
| 硬件不可恢复 | 不可纠正 ECC（DBE）、row remap 失败、NVLink 致命 | 严重；自动 drain + 备件流程 |
| 驱动/固件致命 | 其余 NVIDIA 标记 Fatal 的 XID（如 48/62/63/64/94/95/140/144-150 中 Fatal） | 严重；通知值班，人工确认后 drain |
| 应用类/非致命 | XID 13、31、43、45 等非致命或应用触发 | 警告/信息；通知作业所有者，不 drain |

规则落地：Prometheus 规则按 `xid` 分类统计（`DCGM_FI_DEV_XID_ERRORS` + `err_code`），自动处置由后端根据“规则→动作”白名单执行；所有动作限速、可回滚、入审计。具体 XID 清单以目标驱动版本的 NVIDIA Xid Errors 文档为准（附录 A）。

## 11. 容器化方案

### 11.1 容器化取舍

| 组件 | 容器化 | 说明 |
| --- | --- | --- |
| FreeIPA / SSSD / slurmd | 否（宿主机/VM） | 与系统身份、内核、驱动、cgroup 强耦合 |
| slurmctld / slurmdbd / MariaDB | 测试可容器；生产 VM/宿主机 | 有状态、对时间/主机名/munge 敏感 |
| slurmrestd | 可容器（与管理节点同机） | 需 munge socket 与 JWT key；只暴露内网 |
| Open OnDemand | 否（生产 VM+RPM，D-04） | 官方仅支持 RPM；容器仅开发测试 |
| Dex | 是（2 副本，PostgreSQL 存储） | 无状态+共享存储；TLS 证书挂载 |
| Prometheus / Alertmanager / Grafana | 是 | Prometheus 用持久卷；AM 双副本 |
| 平台后端 / worker / SPA | 是 | 后端 ≥2 副本；SPA 静态产物同步到 OOD 节点 `/var/www/portal` |
| PostgreSQL / Redis | 是（或托管） | 持久卷、备份、监控；PG 主备 |
| dcgm-exporter | 容器或宿主机服务 | 需 NVIDIA Container Toolkit；profiling 指标需 `SYS_ADMIN` |
| node_exporter | 宿主机 | 采集宿主机指标更准确 |
| 用户作业环境 | Apptainer | 计算节点不向普通用户开放 Docker |

### 11.2 镜像规范

- 基础镜像固定 tag+digest，禁止 latest；多阶段构建；非 root；根文件系统只读，仅挂载必要可写卷。
- 声明 `HEALTHCHECK`；启动检查依赖（DB/Dex/slurmrestd）连通性；统一 UTC；日志 JSON 到 stdout。
- 命名：`registry.example.com/hpc/<component>:<semver>-<gitsha>`；Harbor 漏洞扫描 + 签名；镜像内不含密钥。
- 生成 SBOM；CUDA/驱动兼容矩阵随镜像发布自动测试（§10.6 之外的 GPU 作业镜像）。

### 11.3 构建与发布流水线

1. 提交触发 CI：静态检查、单测、SAST、OpenAPI 契约测试、镜像构建。
2. 扫描/签名/推送；部署预发（Compose 或 Helm）；跑 E2E 与迁移演练。
3. 人工审批后滚动发布生产；数据库迁移用 Alembic/Flyway，遵循“先扩后收缩”。
4. 回滚：保留最近 5 个镜像版本；迁移脚本可回退或采用向前修复并记录发布单。
5. 配置与镜像分离：ConfigMap/挂载/环境变量；Secrets 用 Vault/SOPS/K8s Secret；禁止明文进 Git。

### 11.4 平台服务层 Compose 示例（仅示意，生产需补健康检查/资源限制/网络/密钥）

```yaml
services:
  dex:
    image: ghcr.io/dexidp/dex:<pin>
    volumes: ["./dex/config.yaml:/etc/dex/config.yaml:ro", "./certs:/certs:ro"]
    restart: unless-stopped
  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
    environment: [POSTGRES_DB=portal, POSTGRES_USER=portal]
  redis:
    image: redis:7.2
  backend:
    image: registry.example.com/hpc/portal-api:<pin>
    environment:
      DATABASE_URL: postgresql://portal@postgres:5432/portal
      SLURMRESTD_URL: http://slurm-mgmt.internal:6820
      PROMETHEUS_URL: http://prometheus:9090
      OIDC_ISSUER: https://dex.example.com
      TRUSTED_PROXY_CIDR: 10.0.0.0/24
    depends_on: [postgres, redis, dex]
  worker:
    image: registry.example.com/hpc/portal-api:<pin>
    command: ["worker"]
  prometheus:
    image: prom/prometheus:<pin>
    volumes: ["./prom:/etc/prometheus:ro", "promdata:/prometheus"]
  alertmanager:
    image: prom/alertmanager:<pin>
  grafana:
    image: grafana/grafana:<pin>
volumes: {pgdata: {}, promdata: {}}
```

> OOD、Slurm、LDAP、MariaDB 不在此 Compose 内；SPA 静态文件由 OOD Apache 直接服务。

### 11.5 Kubernetes（仅平台服务层）

- 仅后端/worker/SPA/Dex/Prometheus/Grafana/PG（托管）可入 K8s；Slurm/LDAP/OOD/GPU 节点留在宿主机。
- Ingress 不承担 OOD 入口；OOD Apache 仍是业务入口。后端通过 NetworkPolicy 仅放通 slurmrestd、Prometheus、LDAP、DB 与镜像仓库。
- PG 用成熟 Operator 或外置；Prometheus 用 kube-prometheus-stack + 静态目标抓取集群外 GPU 节点。
- 配置 requests/limits、PDB；HPA 仅用于无状态 API；Secrets 走外部密钥管理。

### 11.6 GPU 节点容器注意事项

- dcgm-exporter：NVIDIA Container Toolkit + GPU runtime；profiling 指标需 `SYS_ADMIN`（另一方式为宿主机服务）；只读挂载映射目录。
- Apptainer：`--nv` 注入驱动库；镜像来源白名单；`apptainer.conf` 限制 bind 与特权；CUDA/驱动兼容矩阵纳入镜像发布检查。
- 禁止在计算节点向普通用户开放 Docker/privileged 容器。

## 12. 部署方案

### 12.1 部署拓扑

| 节点角色 | 数量 | 规格建议 | 主要组件 |
| --- | --- | --- | --- |
| OOD Web 节点 | 2 | 16C/64G/500G SSD | OOD(RPM)、Apache、SSSD、Slurm 客户端、munge、共享存储挂载；PUN 本机 |
| 四层负载均衡 | 2（主备） | 4C/8G | VIP → OOD 节点，源 IP 粘性 |
| Slurm 管理节点 | 2（主备） | 16C/32G | slurmctld、slurmrestd、munge、SSSD |
| 记账节点 | 1 | 8C/32G + SSD | slurmdbd、MariaDB 主（备库可在平台节点或另一 VM） |
| LDAP/FreeIPA 节点 | 2 | 4C/8G | FreeIPA、CA、DNS（可选） |
| 登录节点 | 2 | 8C/16G | SSH、SSSD、Slurm 客户端、Apptainer |
| GPU 计算节点 | N（基线 64） | 按卡型 | slurmd、SSSD、munge、DCGM、exporters、Apptainer |
| 平台服务节点 | 3 | 8C/32G/500G | Dex、后端、worker、Redis、Prometheus、Alertmanager、Grafana、PostgreSQL |
| 共享存储 | — | 按容量 | home、scratch、镜像与模块目录 |

### 12.2 网络域与防火墙（源→目的）

| 源 | 目的 | 端口 | 说明 |
| --- | --- | --- | --- |
| 用户浏览器 | OOD VIP | 443 | 唯一业务入口 |
| OOD 节点 | Dex | 443 | OIDC（独立域名，双向 TLS 可选） |
| OOD / 后端 / 登录节点 | FreeIPA | 636 | LDAPS |
| 全部节点 | slurmctld | 6817 | 调度控制 |
| slurmctld | slurmd | 6818 | 作业下发 |
| slurmctld | slurmdbd | 6819 | 记账 |
| 平台后端 | slurmrestd | 6820 | REST（内网、TLS 反代） |
| 平台后端 | PostgreSQL | 5432 | 业务库 |
| 平台后端 | Prometheus | 9090 | 查询 |
| Prometheus | GPU/节点 exporters | 9100/9400/slurm-exporter | 抓取 |
| 平台后端 / Grafana | Alertmanager / Grafana | 9093/3000 | 告警/可视化 |
| OOD 节点 | 计算节点 | 20000-29999 | 交互式应用端口池（仅 OOD 源 IP） |
| 计算节点之间 | 计算节点之间 | SrunPortRange（30000-32000） | srun 回连；仅计算网段 |
| 运维跳板机 | 全部管理节点 | 22 | SSH（仅跳板机源） |
| 监控/备份 | 管理节点 | 依组件 | 备份、探针 |

- 网络分区：管理网、业务网、存储网、带外（BMC）分离；GPU 节点 BMC 只允许运维网访问。
- 交互式端口：OOD 应用脚本从固定池分配端口并写入 `connection.yml`；计算节点防火墙仅放行 OOD 源 IP 到该池；禁止对全网开放。
- 默认拒绝，按上表逐条放通；防火墙规则代码化（Ansible/nftables）并纳入 Git。

### 12.3 端口汇总（应用视角）

| 服务 | 端口 | 暴露范围 |
| --- | --- | --- |
| OOD Apache | 443 | 用户网 |
| Dex | 443 | OOD、平台后端、用户浏览器 |
| LDAP/FreeIPA | 636 | 集群节点 |
| slurmctld / slurmd / slurmdbd | 6817 / 6818 / 6819 | 各自上游节点 |
| slurmrestd | 6820 | 平台后端 |
| dcgm-exporter / node_exporter | 9400 / 9100 | Prometheus |
| Prometheus / Alertmanager / Grafana | 9090 / 9093 / 3000 | 平台网 |
| PostgreSQL / Redis | 5432 / 6379 | 平台后端 |
| MariaDB | 3306 | slurmdbd、备份 |
| 交互式应用端口池 | 20000-29999 | OOD 源 IP |
| SrunPortRange | 30000-32000 | 计算网段 |

### 12.4 关键配置要点

**Slurm（slurm.conf / gres.conf / cgroup.conf）**

- `ClusterName`、`SlurmctldHost`（主备）、`StateSaveLocation`（低延迟共享存储，非 NFS）、`SlurmUser`、`SlurmdUser`。
- `SelectType=select/cons_tres`；`GresTypes=gpu`；`AccountingStorageType=accounting_storage/slurmdbd`；`AccountingStorageTRES=gres/gpu`（按型号细分时追加 `gres/gpu:<model>`）；`AccountingStorageEnforce=associations,limits,qos`。
- `ProctrackType=proctrack/cgroup`；`TaskPlugin=task/cgroup,task/affinity`；`PriorityType=priority/multifactor`；`AuthAltTypes=auth/jwt`（`AuthAltParameters=jwt_key=<path>`，权限 0600，属主 SlurmUser）。
- `SrunPortRange=30000-32000`；Prolog/Epilog 路径与超时；`PrologFlags=Contain`（按版本验证）。
- `gres.conf`：`AutoDetect=nvml`；`cgroup.conf`：`ConstrainCores=yes`、`ConstrainRAMSpace=yes`、`ConstrainDevices=yes`（cgroup v2 下需验证 eBPF 与版本，PoC-06）。
- munge：全集群同一 key，属主 munge/400；轮换流程见 §14.5。
- slurmdbd：单实例 + MariaDB 主备；`DbdHost`、`StorageHost`、`StorageLoc`；版本与 slurmctld 兼容（slurmdbd 同或更高主版本）。
- 升级顺序：slurmdbd → slurmctld → slurmd → 客户端；升级前备份 DB 与 StateSaveLocation。

**slurmrestd 与令牌（D-10）**

- 只读实例：`user-read` JWT（仅查询接口），仅后端 API 容器可达；写实例：`admin-ops` JWT，仅 worker 可达，网络策略限制。
- `X-SLURM-USER-NAME` 仅用于只读代表用户查询；调用方须为 Administrator/Operator；审计记录被代表用户。
- JWT 有效期 30 分钟，自动轮换；轮换窗口内新旧并存；泄露处置 Runbook 见 §14.5。

**Open OnDemand（ood_portal.yml 关键项）**

- `servername`、`ssl`（证书路径）、`auth`（`AuthType openid-connect` + `Require valid-user`）。
- OIDC：`oidc_provider_metadata_url=https://dex.example.com/.well-known/openid-configuration`、`oidc_client_id=ood`、`oidc_client_secret`、`oidc_remote_user_claim=preferred_username`、`oidc_scope="openid profile email groups"`、`oidc_session_inactivity_timeout=7200`、`oidc_session_max_duration=28800`。
- 用户映射：`user_map_match` 取 `preferred_username` 与 LDAP uid 对齐；失败重定向到说明页。
- 反代：`host_regex`（仅本集群计算节点域名）、`node_uri: /node`、`rnode_uri: /rnode`；默认不启用 `secure_node_uri/secure_rnode_uri`（计算节点无 TLS），以网络隔离+一次性令牌补偿。
- 自研入口：`custom_vhost_directives` 注入 `/portal`（Alias + `FallbackResource /portal/index.html`）与 `/api`（ProxyPass/ProxyPassReverse 到后端），并限制仅经 Apache 访问后端。
- PUN：`nginx_stage` sudo 规则仅限自身命令；日志与临时文件定期清理；OOD 版本锁定并保留回退 RPM。

**Dex（config.yaml）**

- `issuer: https://dex.example.com`；`web: https` + 证书；`storage: postgres`。
- `staticClients`：`ood`（redirect URI 为 OOD 回调）、`portal`（redirect URI 为 SPA 回调）。
- `connectors: ldap`：`host: ldap.example.com:636`、`bindDN`（只读账号）、`userSearch`、`groupSearch`（baseDN/filter/nameAttr/userMatchers）。
- 会话/令牌：idToken 有效期 30 分钟、refresh 8 小时；密钥轮换流程见 §14.5。

**FreeIPA / SSSD**

- LDAPS/StartTLS；SSSD `enumerate=false`、合理缓存；HBAC 限制登录节点与 OOD 访问；sudo 规则最小化。
- OTP：管理员启用 OTP，`ipa config-mod --addattr ipaconfigstring=EnforceLDAPOTP`（RHEL 9.4+；其他版本验证等效方案）。
- 号段：uidNumber/gidNumber 由号段表统一分配（如 10000-59999），与既有 AD/LDAP 对账，禁止复用。

**监控**

- Prometheus：抓取 15s、原始保留 30 天、数据盘独立；规则/告警配置在 Git；Alertmanager 双副本 + 外部 deadman。
- dcgm-exporter：`--collect-interval=15000 --hpc-job-mapping-dir=/var/lib/dcgm-exporter/job`；映射目录 root/0755；Prolog 写入、Epilog 删除。
- 告警路由：严重→电话/企微+工单；警告→邮件/企微；信息→看板。

### 12.5 部署顺序

1. 基础：DNS、chrony、主机名、内部 CA/证书、防火墙、共享存储挂载、NTP 校时。
2. FreeIPA：OU/组/号段、TLS、复制、OTP 策略。
3. SSSD：全节点接入，验证 `id`/`getent` 一致；OOD/计算节点重点验证。
4. munge：统一 key，跨节点 `munge -n | unmunge` 验证。
5. MariaDB/slurmdbd → slurmctld → slurmd：建 cluster/account/QOS；`srun --gres=gpu:1 nvidia-smi` 验证隔离。
6. slurmrestd：JWT key、两套实例、TLS 反代、健康检查。
7. 监控：exporters、Prolog/Epilog 映射、Prometheus/Alertmanager/Grafana，验证 `hpc_job` 标签。
8. Dex + OOD：OIDC 对接、PUN、Job Composer、clusters.d、`/portal`/`/api` 反代、登出。
9. 交互式应用：Jupyter/VS Code/桌面/TensorBoard，验证 node/rnode、WebSocket、一次性令牌、端口池。
10. 平台服务：PostgreSQL/Redis/后端/worker/SPA 上线；LDAP 同步 dry-run → 应用；账户/配额初始化。
11. 计量：回补历史、与 sreport 对账、试算账单；额度联动演练。
12. 验收：§14.2 全部用例、故障演练、恢复演练、安全扫描、上线检查单（§14.6）。

## 13. 安全与合规

### 13.1 威胁模型（STRIDE 摘要）

| 威胁 | 场景 | 控制 | 验证 |
| --- | --- | --- | --- |
| 身份冒用 | 盗用密码/会话 | OIDC+PKCE、HttpOnly/Secure cookie、管理员 MFA、会话 TTL、登录失败锁定与告警 | 渗透测试 |
| 越权 | 查看他人作业/用量 | 后端对象级校验、数据范围三级、审计 | 越权用例 |
| 交互端口被越权访问 | 同节点用户直连他人应用端口 | 端口池+仅 OOD 源 IP 放行、一次性 token、host_regex、私有网络 | 网络与越权测试 |
| 后端被攻破 | 借 slurmrestd 令牌控制集群 | 令牌拆分、最小权限、网络隔离、mTLS/白名单、写操作双人确认、审计 | 渗透/故障演练 |
| 审计篡改 | 修改审计表掩盖操作 | 独立审计账号仅 INSERT、哈希链、每日摘要归档、断裂告警 | 篡改演练 |
| 凭据泄露 | munge key/JWT/LDAP bind 泄露 | 密钥管理、定期轮换、最小暴露、泄露 Runbook | 轮换演练 |
| 供应链/镜像 | 恶意镜像/依赖 | 固定 digest、扫描、签名、SBOM、白名单 | CI 门禁 |
| DoS | API/提交洪泛 | 限流、MaxSubmitJobs/MaxJobs、Prometheus 查询限制、AM 抑制 | 压测 |

### 13.2 认证与会话

- 全站 TLS 1.2+、HSTS；LDAPS；内部服务跨主机通信 TLS 或私有网络。
- 管理员 MFA（D-02）；登录失败 5 次锁定 10 分钟并告警；会话参数见 §6.2。
- 统一登出 + 会话失效 Runbook；账号停用流程见 §6.8。
- 服务账号（LDAP bind、Dex、后端、监控）独立且最小权限；禁止共享个人账号。

### 13.3 授权与最小权限

- RBAC 映射由 LDAP 组驱动；对象级校验在服务层；前端不参与授权。
- Slurm 令牌按 D-10 拆分；管理写操作要求“操作人+审批码”，并全量审计。
- LDAP 只读服务账号仅能读指定 OU；平台不保存用户密码。
- 数据库账号按服务拆分（API/ETL/审计只写/只读报表），禁止应用使用超级用户。

### 13.4 审计与合规

- 三源审计（D-08）；审计保留 1 年热数据、5 年归档；检索接口按角色限权。
- 审计日志禁止输出密码/令牌/密钥；必要时脱敏。
- 合规：个人信息最小化采集；等保级别、数据留存与跨境要求按 §16.2-T06 确认；在确认前按最高适用要求保守配置。

### 13.5 证书与密钥生命周期

| 对象 | 签发/来源 | 轮换 | 监控 |
| --- | --- | --- | --- |
| OOD Apache TLS | 内部 CA（FreeIPA certmonger） | 自动续期（到期前 30 天） | 到期 14 天告警 |
| Dex TLS | 内部 CA | 自动续期 | 同上 |
| LDAP TLS | FreeIPA CA | 自动续期 | 同上 |
| munge.key | 运维生成 | 计划内轮换（窗口+全集群同步） | 轮换演练 |
| Slurm JWT key | 运维生成 | 90 天轮换（新旧并存窗口） | 到期告警 |
| Dex client secret | 生成 | 180 天 | 到期告警 |
| LDAP bind / DB 密码 | Vault 生成 | 90 天 | 轮换演练 |
| 平台 API Token（P1） | 平台签发 | 按需/最长 180 天 | 使用审计 |

密钥统一存放 Vault（或 SOPS+加密仓库）；禁止明文进 Git/镜像/日志。

### 13.6 主机、容器与网络

- 宿主机基线加固（CIS/等保要求）；SSH 仅跳板机、密钥登录、禁 root 远程。
- OOD 节点 sudo 规则仅限 `nginx_stage`；SELinux 保持 enforcing（或按 OOD 文档配置）。
- 容器：非 root、只读根、最小能力；dcgm-exporter profiling 需要 `SYS_ADMIN` 时单独评估。
- 网络：默认拒绝 + 白名单（§12.2）；管理网/业务网/存储网分离；BMC 独立。

### 13.7 漏洞与补丁

- 镜像与主机每月基线更新；高危漏洞 72 小时内评估并制定处置计划；CVE 影响评估纳入发布门禁。
- 升级前备份、预发验证、回滚包保留；GPU 驱动升级逐节点 drain→升级→验证→resume。

### 13.8 数据保护

- 个人信息最小化：姓名、邮箱、课题组；导出需审计。
- 文件权限/umask 统一；作业私有临时目录；scratch 定期清理（见 §16.2-T05）。
- 日志脱敏；备份加密存储；销毁按保留策略执行。

## 14. 运维、备份与升级

### 14.1 高可用与故障域

- **slurmctld**：主备，`StateSaveLocation` 在低延迟共享存储；备份机只读运行，主挂后备机接管；使用 IPMI/PDU 做 fencing，防止双主；监控心跳与 state 目录可达性（备机无 state 会取消作业，属高危）。
- **slurmdbd**：单实例 + MariaDB 主备流复制；slurmdbd 重启期间 slurmctld 缓存记账消息（`MaxDBDMsgs`），恢复后补传；不做 Galera 多主（D-05）。
- **OOD**：双节点 + L4 粘性负载均衡；PUN 本机状态，节点故障时该节点用户会话丢失，PUN 在重连/重新登录后重建；SLO 99.5% 已计入该风险。
- **Dex**：2 副本（共享 PostgreSQL 存储与会话密钥），负载均衡后无粘性要求；单副本故障不影响已建立会话的校验。
- **PostgreSQL**：主备 + WAL 归档；切换由 Patroni 或运维脚本执行，RPO≤15 分钟。
- **Prometheus/Alertmanager**：Prometheus 单实例 + 规则 Git 化（重建≤30 分钟）；Alertmanager 双副本；监控自身故障由外部 deadman 告警。
- **共享存储**：StateSaveLocation 与 home/scratch 物理/协议隔离；存储故障按 §14.4 场景处置。

### 14.2 验收标准（上线必须全部通过；P1 项标注 M6）

| 编号 | 验收项 | 判定方法 | 关联需求 |
| --- | --- | --- | --- |
| ACC-01 | 认证与 SSO：新用户 10 分钟内可登录 OOD/登录节点；OOD 登录后访问 `/portal` 免二次登录；统一登出；管理员 MFA 生效；禁用账号后 SSH ≤5 分钟失效、新 Web 登录立即失败、旧会话 ≤TTL | 脚本+人工；停用/启用演练；MFA 绕过测试 | B-01、SEC |
| ACC-02 | 调度与限额：申请 2 GPU 作业内 `nvidia-smi` 仅见 2 卡、`CUDA_VISIBLE_DEVICES` 正确；绕过前端直接 sbatch 超限被拒；前端提示与 Slurm 拒绝一致 | 作业脚本验证 + cgroup v2 检查 | B-02、B-06 |
| ACC-03 | 交互式应用：就绪后 60s 内可打开 Jupyter/VS Code/桌面；8h WebSocket 不断连；`/node` 与 `/rnode` 应用各验证 1 个；同节点其他用户无法直连端口 | 人工+自动化；越权测试 | B-03、B-04、B-07 |
| ACC-04 | 监控：GPU 采集到可见 P95≤30s；GPU 可定位作业/用户（抽样 20 个）；资产台账与 `nvidia-smi` 一致；XID/ECC 规则生效 | 抽样+延迟探针 | A-01~A-04 |
| ACC-05 | 告警：XID 分级正确；告警到通知 ≤2 分钟；规则/静默/升级可用；工单闭环（首期人工 drain + Runbook） | 故障注入 | A-05 |
| ACC-06 | 计量：100 个作业 GPU·h 与 `sacct` 一致（含取整）；月总量与 sreport 偏差 ≤0.5%；跨日/跨月/数组/requeue 正确；MIG 未启用 | 对账脚本+抽样 | C-01、C-02 |
| ACC-07 | 额度：80%/100% 预警可达；耗尽后新作业被拒；充值后自动解除；钱包流水与余额一致 | 演练 | C-04 |
| ACC-08 | 审计：登录/提交/取消/配额/规则/账单在三源可关联；检索 P95≤3s；篡改检测有效 | 抽查 10 作业+篡改演练 | C-08 |
| ACC-09 | 故障隔离：停 slurmrestd/Prometheus/后端时 OOD 提交与运行作业不受影响；slurmctld 切换作业不丢 | 故障注入 | NFR |
| ACC-10 | 恢复：LDAP/DB/StateSaveLocation/整站恢复满足 §14.4 判据与 RTO/RPO | 恢复演练 | OPS |
| ACC-11 | 安全：镜像扫描无高危未处置项；越权/渗透测试通过；证书与密钥轮换演练通过 | 扫描报告+渗透报告 | SEC |
| ACC-12 | 性能与容量：§8.1 指标达标；§8.4 容量阈值未超 | 压测报告 | NFR |
| ACC-13 | 自监控：组件健康、指标断流、证书/磁盘、备份失败告警可触发；外部 deadman 有效 | 逐项注入 | C-09 |
| ACC-14 | 运维就绪：Runbook 演练（至少 5 个场景）；上线检查单签署；值班表与升级路径就绪 | 演练记录 | OPS |
| ACC-15 | 自动处置（P1/M6）：自动 drain 仅白名单且限速；误报率 ≤5%；处置可回滚 | 故障注入 | A-06 |

### 14.3 备份与恢复

| 对象 | 方式 | 频率 | 保留 | 校验 |
| --- | --- | --- | --- | --- |
| slurmdbd/MariaDB | mariabackup 全量 + binlog | 每日全量，binlog 持续 | 30 天 | 每周恢复校验（行数与最近作业数） |
| slurmctld StateSaveLocation | 一致性快照（暂停写入或存储快照） | 每日 | 7 天 | 每季度恢复演练 |
| FreeIPA/LDAP | `ipa-backup` / `slapcat` | 每日 | 30 天 | 每季度恢复演练 |
| PostgreSQL | 全量 + WAL 归档 | 每日全量，WAL 持续 | 30 天；账单/审计按 §8.5 | 每月 PITR 校验 |
| 平台配置/规则/密钥元数据 | Git + Vault 备份 | 变更即提交，Vault 每日 | 永久 | 每季度校验 |
| 审计摘要 | 哈希链摘要 + 独立备份 | 每日 | 5 年 | 每月校验 |

- 备份窗口：每日 01:00-03:00（避开作业高峰）；备份加密；至少一份异地/离线副本。
- 恢复判据：恢复后登录/提交/查询可用；`job_usage` 与 sreport 偏差 ≤0.5%；审计哈希链完整；备份校验失败或恢复超时视为不合格并触发整改。

### 14.4 恢复演练与 RTO/RPO

| 场景 | RTO | RPO | 演练判据（季度） |
| --- | --- | --- | --- |
| slurmctld 主备切换 | ≤5 分钟 | 切换秒级（共享 state） | 作业不丢、队列恢复、无重复计费 |
| slurmdbd 数据库故障 | ≤2 小时 | ≤15 分钟 | 最近作业可查、记账连续、对账偏差 ≤0.5% |
| LDAP/FreeIPA 节点故障 | ≤1 小时 | ≤15 分钟 | 登录恢复；SSSD 缓存期内不中断 |
| PostgreSQL 恢复 | ≤2 小时 | ≤15 分钟 | 账单/审计可查；金额一致 |
| OOD 节点重建 | ≤2 小时 | 会话丢失（可接受） | PUN 重建、SSO 正常 |
| 整站灾难重建 | ≤8 小时 | 调度状态 ≤24 小时（快照） | 按 Runbook 顺序恢复并验收关键链路 |

灾害场景（整站）不承诺 4 小时；对业务方的承诺口径以此表为准，并在 §16.2-T06 合规确认后复核。

### 14.5 Runbook 清单（详细步骤在详细设计交付，编号固定）

| 编号 | 场景 | 首步动作 | 验证 |
| --- | --- | --- | --- |
| RB-01 | GPU 节点故障/掉卡 | 确认 XID/ECC → 自动或人工 drain → 通知用户 → 备件/重启 | 节点 resume 后作业可调度 |
| RB-02 | slurmctld 主备切换 | 检查共享 state 可达 → 切 VIP/服务 → fencing 防双主 | 作业与队列一致 |
| RB-03 | slurmdbd/MariaDB 故障 | 切备库/恢复 binlog → 重启 slurmdbd → 校验补传 | 记账无缺口 |
| RB-04 | LDAP/FreeIPA 故障 | 切复制节点 → SSSD 多服务器 → 检查登录 | 登录恢复 |
| RB-05 | Dex/OIDC 登录故障 | 检查 Dex/证书/LDAP → 重启副本 → 回退版本 | OOD/portal 登录恢复 |
| RB-06 | OOD/PUN 启动失败 | 检查 nginx_stage/sudo/munge/存储 → 清理残 PUN → 重启 Apache | 用户可启动应用 |
| RB-07 | 存储/磁盘写满 | 定位增长 → 清理 scratch/日志 → 扩容评审 | 水位 <85% |
| RB-08 | 证书/密钥泄露或到期 | 启用备用证书 → 按 §13.5 轮换 → 撤销旧凭据 | 全链路可用 |
| RB-09 | 账单偏差 | 冻结出账 → 比对 sreport/sacct → 冲正/修正 → 复盘 | 偏差 ≤0.5% |
| RB-10 | 账号紧急封禁 | 禁用 LDAP → 撤销会话 → 取消作业/PUN → 留证 | 5 分钟内无新会话 |

munge key 轮换：计划窗口内停止 slurm 服务→分发新 key→启动→验证；JWT key 轮换：新旧 key 并存→切换签发→过期旧 key。

### 14.6 上线检查单（Go-Live Checklist）

| 检查项 | 责任人 | 通过标准 |
| --- | --- | --- |
| 版本基线冻结并记录 | 运维 | §2.4 表与实际一致 |
| 备份与恢复演练完成 | 运维 | §14.3/§14.4 判据通过 |
| 安全扫描/渗透/越权测试完成 | 安全 | 高危已处置或批准风险 |
| 容量压测通过 | 测试/后端 | §8.1 指标达标 |
| 监控与告警值班就绪 | 运维 | 告警路由、升级、deadman 验证 |
| Runbook 与账号交接完成 | 运维 | 演练记录 + 值班表 |
| 用户培训与公告完成 | 产品 | 培训材料、FAQ、支持渠道 |
| 灰度与回滚方案就绪 | 平台组 | 回滚步骤、回退包、决策人 |
| 计费口径财务确认 | 财务 | D-13/§7.4 签字 |
| 审计三源联调完成 | 后端/运维 | ACC-08 通过 |
| 应急联系人名单 | 项目经理 | 24×7 可达 |

### 14.7 日常运维

- 告警分级响应：严重 15 分钟、警告 1 小时、信息当班处理；值班表按月轮换。
- 变更：工单+评审+回滚方案；生产变更窗口见 D-12；紧急变更后 48 小时内补评审。
- 月度：容量与成本评审（GPU 利用率、排队、存储水位、Prometheus 容量）、备份成功率、SLO 达成、审计抽查。
- 季度：恢复演练、权限复核（LDAP 组/账号）、密钥与证书盘点。
- 年度：等保/合规评估、版本升级规划、架构复盘。

### 14.8 监控自监控

- 外部 deadman：独立于 Prometheus 的探针每分钟检查 API/告警链路，异常直接通知值班。
- 指标断流检测：关键指标 10 分钟无数据告警；Prometheus 自身 up 由 Alertmanager 规则 + 外部探针双保险。
- 告警质量：每月统计误报率、静默数、未闭环工单；误报 >10% 需调整规则。

### 14.9 容量与成本运营

- 每月输出：GPU 利用率分布、排队时长、分区饱和度、存储增长、Prometheus 序列/磁盘增长、PUN 内存峰值。
- 触发扩容/优化的阈值：GPU 排队 P95 >2h、GPU 平均利用率 <50% 且排队高、存储水位 >85%、Prometheus 内存 >70%、PUN 启动失败 >1%。

## 15. 实施计划、验收与追溯

### 15.1 里程碑

| 阶段 | 周期 | 主要交付 | 完成判据 |
| --- | --- | --- | --- |
| M0 方案与 PoC | 4 周 | 关闭 §16.2 待确认项；完成 §15.5 的 PoC；版本冻结；输出 PoC 报告与决策记录 | PoC 全绿或明确降级方案；版本基线评审通过 |
| M1 基础集群 | 5 周 | FreeIPA/SSSD、Slurm（记账/GRES/cgroup）、Dex、OOD 登录与基础交互应用 | 用户可登录并在 GPU 上跑 Jupyter/批处理；ACC-01 初测 |
| M2 平台基础与 GPU 监控 | 5 周 | 后端/前端骨架、RBAC、账户同步、A-01~A-05、指标采集与 `hpc_job` 映射 | 管理员可见 GPU 看板与告警；ACC-04/ACC-05 初测 |
| M3 资源调用平台 MVP | 5 周 | B-02/B-03/B-05/B-06/B-07、C-08 查询、C-09 自监控 | 四条主链路 E2E；ACC-02/ACC-03/ACC-08 初测 |
| M4 计量与账单 | 5 周 | ETL、C-01/C-02/C-04、审计三源、内部试算账单、对账 | 对账偏差 ≤0.5%；ACC-06/ACC-07/ACC-08 通过 |
| M5 试运行与上线 | 4 周 | 压测、故障/恢复演练、培训、灰度、上线检查单 | §14.2 全部通过；上线检查单签署 |
| M6 P1 迭代（上线后 3 个月） | 12 周 | A-06~A-08、B-08~B-10、C-03/C-05/C-06、审批流预研 | P1 需求验收；SLO 达成复盘 |

总工期约 28 周（不含 P1）；M0 为 go/no-go 门禁。

### 15.2 团队与 RACI

| 工作项 | 产品 | 后端 | 前端 | HPC/运维 | 安全 | 测试 |
| --- | --- | --- | --- | --- | --- | --- |
| 需求与验收口径 | A | C | C | C | C | C |
| 架构与决策 | C | A/R | C | R | C | I |
| Slurm/OOD/LDAP 建设 | I | C | I | A/R | C | C |
| 平台开发 | C | A/R | R | C | C | C |
| 计量与账单 | A | R | C | C | I | C |
| 安全与审计 | C | C | C | C | A/R | C |
| 测试与验收 | C | C | C | C | C | A/R |
| 上线与演练 | A | C | C | R | C | R |

### 15.3 需求与里程碑映射

| 里程碑 | 需求（P0） | 需求（P1/P2） |
| --- | --- | --- |
| M1 | B-01、B-04（基础） | — |
| M2 | A-01~A-05 | — |
| M3 | B-02、B-03、B-04（完善）、B-05、B-06、B-07、C-08（查询）、C-09 | — |
| M4 | C-01、C-02、C-04、C-08（三源） | — |
| M5 | 全部 P0 验收（ACC-01~ACC-14） | — |
| M6 | — | A-06~A-08、B-08~B-10、C-03、C-05、C-06；验收 ACC-15 |
| 待排期 | — | B-11、C-07（P2） |

### 15.4 追溯矩阵

| 需求 | 设计章节 | 接口/页面 | 数据 | 验收 | 里程碑 |
| --- | --- | --- | --- | --- | --- |
| A-01 | §5.3、§6.4、§10.1 | `/gpus`、`/portal/monitor/gpus` | `gpu_asset`、`node_asset` | ACC-04 | M2 |
| A-02 | §6.4、§10.4 | `/gpus/{uuid}/metrics`、SSE | Prometheus | ACC-04 | M2 |
| A-03 | §5、§9.5 | `/nodes`、总览 | `node_asset` | ACC-04 | M2 |
| A-04 | §6.4、§9.5 | `/jobs/{id}/metrics` | `job_usage`、Prometheus | ACC-04 | M2 |
| A-05 | §6.7、§9.5 | `/alert-rules`、`/alerts` | `alert_rules`、`alerts` | ACC-05 | M2 |
| A-06 | §6.7、§10.5 | `/alert-rules` | `alert_rules`、`tickets` | ACC-15 | M6 |
| A-07 | §7.1 | `/usage`（P1 视图） | `job_usage`、Prometheus | M6 验收 | M6 |
| A-08 | §7.1、§9.5 | `/usage/export` | `usage_daily` | M6 验收 | M6 |
| B-01 | §5.4、§6.2、§12.4 | `/me`、OOD 登录 | `users_cache` | ACC-01 | M1 |
| B-02 | §9.5 | `/catalog`、资源目录页 | Slurm 查询 | ACC-02 | M3 |
| B-03 | §6.3 | OOD 模板/表单 | — | ACC-03 | M3 |
| B-04 | §6.3、§12.2 | OOD batch_connect | — | ACC-03 | M1/M3 |
| B-05 | §9.5 | `/jobs`、作业详情页 | `job_usage`（读模型） | ACC-02 | M3 |
| B-06 | §6.6、§9.5 | `/quotas` | `quotas`、Slurm 限额 | ACC-02 | M3 |
| B-07 | §6.3 | OOD Files | 存储配额 | ACC-03 | M3 |
| B-08 | §11.6、§7.2 | OOD 应用/文档 | — | M6 验收 | M6 |
| B-09 | §7.2、§12.4 | QOS/Reservation | — | M6 验收 | M6 |
| B-10 | §9.5、§14.5 | `/nodes/*`、批量运维 | 审计表 | ACC-08 | M6 |
| B-11 | §9.7 | 审批 API（P2） | `approvals` | P2 | P2 |
| C-01 | §6.5、§10.1 | `/usage` | `job_usage` | ACC-06 | M4 |
| C-02 | §6.5、§9.5 | `/usage` | `usage_daily` | ACC-06 | M4 |
| C-03 | §7.3、§10.1 | `/pricing/rules` | `price_rules` | M6 验收 | M6 |
| C-04 | §6.6、§9.5 | `/wallets`、`/quotas` | `wallets`、`wallet_ledger` | ACC-07 | M4 |
| C-05 | §6.5、§9.5 | `/bills`、导出 | `bills`、`bill_items` | M6 验收 | M6 |
| C-06 | §7.3、§9.5 | `/usage`（效率） | `job_usage`、Prometheus | M6 验收 | M6 |
| C-07 | §7.3 | 容量分析页（P2） | `usage_daily` | P2 | P2 |
| C-08 | §6.9、§9.5 | `/audit` | `audit_log`、日志三源 | ACC-08 | M3/M4 |
| C-09 | §9.5、§14.8 | `/system/status` | Prometheus/探针 | ACC-13 | M3 |

### 15.5 测试策略

| 层级 | 内容 | 工具/方法 | 门禁 |
| --- | --- | --- | --- |
| 单元/集成 | 后端服务、ETL、规则计算 | pytest、Testcontainers | 覆盖率 ≥70% 核心模块 |
| 契约 | OpenAPI 与实际实现一致 | Mock/Prism、契约测试 | 不一致即阻断合并 |
| E2E | 登录→提交→取消→用量→账单四条主链路 | Playwright | 每次发布预发必跑 |
| 性能 | §8.1 指标 | k6/Locust + 基线数据 | P95 达标 |
| 故障注入 | 停 slurmrestd/Prometheus/后端、LDAP 节点、OOD 节点、DB 切换 | 脚本+人工 | ACC-09/ACC-10 |
| 安全 | 越权、端口、注入、会话、镜像扫描、渗透 | OWASP ZAP/人工 | 高危清零或批准风险 |
| 计量验收 | 100 作业抽样、sreport 对账 | 对账脚本 | ≤0.5% |
| 恢复演练 | §14.4 场景 | Runbook | 判据通过 |

### 15.6 M0 PoC 清单（Go/No-Go）

| 编号 | 验证项 | 通过标准 | 失败处置 |
| --- | --- | --- | --- |
| PoC-01 | OOD + Dex + `/portal` SSO、登出、会话 TTL、`/node` 与 `/rnode` | 免二次登录；登出统一；TTL 生效；两类应用可用 | 改用独立反代/调整映射方案 |
| PoC-02 | slurmrestd 代用户、API 版本、双令牌隔离 | 只读可代表用户；写令牌受限；版本与后端匹配 | 锁定版本或增加适配层 |
| PoC-03 | MIG 记账与映射 | 目标版本 `AllocTRES`/`sacct` 能区分 MIG 或确认不支持 | 维持首期不启用 MIG（D-07） |
| PoC-04 | dcgm `hpc_job` 端到端（Prolog→exporter→查询） | 20 个作业抽样 100% 可关联；ECC 可选指标有数据 | 调整映射脚本/指标清单 |
| PoC-05 | cgroup v2 下 GPU 隔离 | `CUDA_VISIBLE_DEVICES` 正确；设备白名单生效 | 调整 `ConstrainDevices`/内核参数或降级 cgroup v1 |
| PoC-06 | StateSaveLocation 共享存储与 slurmctld 切换 | 备机接管、作业不丢 | 更换共享存储方案 |
| PoC-07 | OOD PUN 容量与 2 节点粘性 | 200 PUN 内存/启动达标；故障切换行为符合预期 | 扩容 OOD 或调整 SLO |
| PoC-08 | 计量原型与 XID 分级 | 与 sreport 偏差 ≤0.5%；XID 规则误报可接受 | 修订计费规则/XID 清单 |

### 15.7 交付物与培训

- 交付物：本项目文档 v0.2（评审版）、详细设计（接口/数据库/部署手册）、测试方案与报告、运维手册与 Runbook、安全评估报告、培训材料。
- 培训：用户（模板/交互应用/配额）、管理员（账户/限额/告警）、运维（部署/演练/Runbook）；上线前完成并考核。

## 16. 风险与待确认事项

### 16.1 风险登记

| 编号 | 风险 | 影响 | 概率 | 应对 | 责任人 | 触发信号 |
| --- | --- | --- | --- | --- | --- | --- |
| R-01 | OOD/Dex SSO 集成与升级回退 | 登录不可用 | 中 | PoC-01；预发回归；回退包；升级窗口 | 平台组 | 登录失败率 >1% |
| R-02 | dcgm `hpc_job` 映射缺失/错配 | 作业维度指标不可用 | 中 | PoC-04；Prolog best-effort；Slurm 分配兜底 | 运维 | 映射覆盖率 <99% |
| R-03 | MIG 计量不可用 | 无法按 MIG 计价 | 高 | 首期不启用 MIG；PoC-03 | 产品/运维 | 业务提出 MIG 需求 |
| R-04 | slurmdbd/DB 单点与恢复超时 | 记账中断 | 中 | 主备流复制；恢复演练；监控 | 运维 | 记账延迟 >5 分钟 |
| R-05 | 存储写满/配额失控 | 登录、PUN、作业失败 | 中 | 水位告警；scratch 清理；配额 | 运维 | 水位 >85% |
| R-06 | 后端令牌泄露 | 集群被控制 | 低 | D-10 拆令牌；轮换；网络隔离；审计 | 安全/后端 | 异常写操作 |
| R-07 | 计费偏差/账单争议 | 财务纠纷 | 中 | 对账；冲正；审计；财务确认 | 财务/后端 | 偏差 >0.5% |
| R-08 | 项目进度与人力不足 | 延期 | 高 | M0 门禁；里程碑评审；外部依赖清单 | 项目经理 | 连续两周里程碑偏差 |
| R-09 | 离线环境/镜像与依赖准备 | 部署延期 | 中 | T03 确认；离线源清单 | 运维 | M0 确认离线 |
| R-10 | OOD custom 指令被升级覆盖 | 入口中断 | 低 | 预发验证；配置即代码；回退 | 运维 | OOD 升级后 404 |
| R-11 | Prometheus 高基数 | 监控不可用 | 中 | 标签规范；recording rules；容量告警 | 后端/运维 | 序列 >10 万 |
| R-12 | 账期跨月与冲正规则不清 | 账单错误 | 中 | D-07；冲正上限；财务评审 | 财务/后端 | 跨月争议 |

### 16.2 待确认事项（M0 关闭，未关闭不得进入 M1）

| 编号 | 事项 | 影响章节 | 责任人 | 期限 | 默认方案（未确认时） |
| --- | --- | --- | --- | --- | --- |
| T01 | GPU 型号/数量/到货计划 | §2.3、§8.4 | 采购/项目经理 | M0 第 2 周 | 按基线 512 卡设计 |
| T02 | 共享存储类型与配额能力 | §2.3、§6.1、§12 | 运维 | M0 第 2 周 | 按支持配额与快照的并行文件系统设计 |
| T03 | 是否离线环境 | §2.4、§11.3 | 运维 | M0 第 1 周 | 按在线设计，预留离线镜像方案 |
| T04 | 计费模式与财务口径 | D-13、§7.4 | 财务/产品 | M4 前 | 内部记账、不对外收款 |
| T05 | scratch 清理策略与周期 | §6.1、§13.8 | 运维 | M1 前 | 90 天未访问清理，提前 7 天通知 |
| T06 | 等保级别/留存/跨境要求 | §13.4、§14.4 | 安全/合规 | M0 第 3 周 | 按等保三级保守配置 |
| T07 | 既有 AD 还是 FreeIPA | D-02、§12.4 | 身份组 | M0 第 1 周 | FreeIPA（新建） |
| T08 | OOD 目标版本（4.2.x 与后续版本选型） | §2.4、§12.4 | 平台组 | M0 第 1 周 | OOD 4.2.x |
| T09 | MIG 是否二期启用 | D-07、§6.5 | 产品/运维 | M0 第 3 周 | 首期不启用 |
| T10 | 团队规模与预算 | §15.1/§15.2 | 项目经理 | M0 第 1 周 | 8-10 人满编 |
| T11 | Slurm 目标版本支持窗口 | §2.4、§12.4 | 运维 | M0 第 2 周 | 25.11，不低于 24.11 |

> 未关闭的 T 项如果影响 M1，由 M0 评审会给出书面豁免与降级方案，并记录在 §0.1。

### 16.3 上线后回顾

上线后 1 个月/3 个月各做一次复盘：SLO、告警质量、账单准确性、用户反馈、容量与成本；P1 需求的优先级依据复盘结果调整。

## 附录 A 参考文档与证据等级

| 主题 | 来源 | 等级 |
| --- | --- | --- |
| OOD 4.2 系统支持矩阵（EL8/9/10、Ubuntu 24.04/26.04，不含 22.04） | https://osc.github.io/ood-documentation/latest/requirements.html | A（官方直连） |
| OOD 4.1 支持矩阵（含 Ubuntu 22.04） | https://osc.github.io/ood-documentation/release-4.1/requirements.html | A |
| `ood_portal.yml`（node/rnode、secure 变体、OIDC 会话 28800 默认、custom_vhost_directives、user_map_*） | https://osc.github.io/ood-documentation/latest/reference/files/ood-portal-yml.html | A |
| OOD 架构（Apache 前端/PUN/反向代理） | https://osc.github.io/ood-documentation/latest/architecture.html | A |
| OOD Dex 集成（默认认证、LDAP connector、端口 5554/5556） | https://osc.github.io/ood-documentation/latest/authentication/dex.html | A |
| 交互式应用与反向代理（host_regex/node_uri/rnode_uri） | https://osc.github.io/ood-documentation/latest/how-tos/app-development/interactive/setup/enable-reverse-proxy.html | A |
| DCGM Exporter CLI（`hpc_job`、`--hpc-job-mapping-dir`、默认采集 30s） | https://docs.nvidia.com/datacenter/dcgm/latest/reference/command-line-reference/dcgm-exporter.html | A |
| DCGM Exporter 指标与标签（默认/可选指标、XID 标签、无 user/account 标签） | https://docs.nvidia.com/datacenter/dcgm/latest/reference/dcgm-exporter-metrics.html | A |
| NVIDIA Xid 分类与处置 | https://docs.nvidia.com/deploy/xid-errors/latest/index.html | B（未逐条直连） |
| Slurm 升级顺序与备份要求 | https://slurm.schedmd.com/upgrades.html | B（页面片段） |
| Slurm 支持窗口与 slurmdbd 建议（单实例+非 HA DB） | https://slurm.schedmd.com/SLUG24/Field-Notes-8.pdf | B |
| StateSaveLocation 需共享存储、不建议 NFS | SchedMD quickstart 文档镜像 | B |

> A=已直连官方页面核对；B=与官方语义一致但未直连原文；C=待 M0 实测/复核。涉及 Slurm 具体参数行为的条目（如 `SLURM_JOB_GPUS` 在 Prolog 的可用性、cgroup v2 + `ConstrainDevices` 的生效条件）在 M0 PoC 中回归确认。

## 附录 B 关键配置示例（参考性）

**B.1 OOD `custom_vhost_directives`（示意）**

```yaml
custom_vhost_directives:
  - 'ProxyPass /api http://127.0.0.1:8080/api retry=0'
  - 'ProxyPassReverse /api http://127.0.0.1:8080/api'
  - 'Alias /portal /var/www/portal'
```

> `/portal` 的 SPA 回退（Apache `FallbackResource`）需与 `Alias` 一并按 OOD 官方 custom 指令方式注入；正式片段在详细设计中给出并在预发验证后再上生产。实际以 `update_ood_portal` 生成的 Apache 配置为准；修改后必须重启 Apache 并回归 OOD 全路径。

**B.2 dcgm-exporter 映射（Prolog 片段，best-effort）**

```bash
#!/bin/bash
# /etc/slurm/prolog.d/90-gpu-job-map.sh —— 失败不得阻塞作业
set +e
dir=/var/lib/dcgm-exporter/job
[ -d "$dir" ] || exit 0
for gpu in ${SLURM_JOB_GPUS//,/ }; do
  printf '%s\n' "$SLURM_JOB_ID" > "$dir/$gpu" 2>/dev/null
done
exit 0
```

> `SLURM_JOB_GPUS` 在 Prolog 中的可用性与格式需 PoC-04 验证；不可用时改用 `scontrol show job` 输出解析。Epilog 对应删除本节点写入的文件。

**B.3 Prometheus 抓取与规则（示意）**

```yaml
scrape_configs:
  - job_name: dcgm
    static_configs:
      - targets: ['gpu-01:9400', 'gpu-02:9400']
    relabel_configs:
      - source_labels: [__address__]
        target_label: node
        regex: '([^:]+):.*'
        replacement: '$1'
rule_files: ['/etc/prometheus/rules/*.yml']
```

**B.4 cgroup.conf（要点）**

```ini
CgroupPlugin=cgroup/v2
ConstrainCores=yes
ConstrainRAMSpace=yes
ConstrainDevices=yes
```

> cgroup v2 下 `ConstrainDevices` 依赖内核 eBPF 与 Slurm 版本；PoC-05 验证，失败时以 `CUDA_VISIBLE_DEVICES` + 设备权限控制作为过渡并记录风险。

## 附录 C 术语与缩写补充

| 缩写 | 含义 |
| --- | --- |
| RB | 资源块 |
| OIDC | OpenID Connect |
| RP | Relying Party（OOD/平台作为 OIDC 客户端） |
| ACC | 验收用例编号 |
| RB-xx | Runbook 编号 |
| R-xx / T-xx | 风险/待确认编号 |
| PoC-xx | M0 验证项 |





