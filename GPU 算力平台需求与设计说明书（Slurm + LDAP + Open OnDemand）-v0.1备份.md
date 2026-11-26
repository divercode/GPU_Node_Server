# GPU 算力平台需求与设计说明书（Slurm + LDAP + Open OnDemand）

版本 v0.1（草案）｜日期 2026-11-18｜状态 待评审｜读者：产品、前端、后端、运维、测试

## 1. 文档说明

### 1.1 目的

本文档定义基于 Slurm、LDAP、Open OnDemand（以下简称 OOD）三套开源组件，建设“GPU 监控管理平台、算力集群资源调用平台、算力监控与计量平台”的需求，覆盖业务全流程、前后端协作方式、容器化过程与部署要点，作为设计、开发、测试和上线的统一依据。

### 1.2 平台组成

三个子平台共用同一套账号、同一个访问入口、同一套数据底座：

- **A. GPU 监控管理平台**：GPU 资产、实时状态、健康与故障、GPU 与作业及用户的关联视图。
- **B. 算力集群资源调用平台**：用户在浏览器中申请并使用 GPU 资源，包括作业提交、交互式应用（Jupyter、VS Code、远程桌面）、文件管理、配额与队列管理。
- **C. 算力监控与计量平台**：集群与平台自身监控、按用户/课题组/项目的用量统计、计费与账单、资源效率分析。

### 1.3 术语

- **Slurm**：开源作业调度与资源管理系统。slurmctld 为控制器，slurmd 为计算节点守护进程，slurmdbd 为记账守护进程（后端库为 MariaDB/MySQL），slurmrestd 为 REST API 服务。
- **GRES / TRES**：通用资源（如 gres/gpu）/ 可追踪资源（CPU、内存、GPU 等，用于记账与限额）。
- **QOS / Association**：服务质量等级（优先级、限额、抢占策略）/ “用户-账户-分区”关联，是 Slurm 限额与记账的基本单位。
- **OOD**：Open OnDemand，面向 HPC 的 Web 门户（Apache + Passenger），提供作业、文件、终端与交互式应用。**PUN** 为 OOD 为每个登录用户启动的独立 Nginx 进程，以该用户的 UID 运行。
- **LDAP / SSSD / Dex**：集中账号目录 / 各节点解析 LDAP 用户与组的守护进程 / OIDC 身份代理（对接 LDAP，向 OOD 与自研平台下发令牌）。
- **DCGM / MIG**：NVIDIA 数据中心 GPU 管理工具 / GPU 多实例切分。
- **GPU·h**：GPU 卡数 × 占用小时数，是本平台的基础计量单位。

### 1.4 设计原则

1. **复用而非重造**：作业提交与交互应用用 OOD，调度与记账用 Slurm，身份用 LDAP。自研部分只做三者之间的集成，以及缺失能力（管理控制台、统一监控视图、计量计费）。
2. **单一事实来源**：身份以 LDAP 为准；资源、作业、用量以 Slurm 及 slurmdbd 为准；时序指标以 Prometheus 为准；审批、账单、配置等业务数据以 PostgreSQL 为准。
3. **计量以 Slurm 记账为准**，不以监控采样值计费；监控数据只用于效率分析与告警。
4. **用户态操作以用户本人身份落到集群**（UID/GID 全局一致），平台不保存用户密码。
5. **可观测、可审计、可回滚**：所有变更操作留痕，所有组件有健康检查与升级回退方案。

## 2. 建设目标与边界

### 2.1 业务目标

- 用户无需命令行即可申请 GPU、启动 Jupyter 或桌面环境、提交训练作业，首次使用培训成本显著下降。
- 管理员可在一个界面看到全部 GPU 的状态、占用者、利用率与故障，并能快速处置。
- 所有算力消耗按用户、课题组、项目精确计量，支持月度账单与额度控制。
- 账号体系统一：一个 LDAP 账号即可登录 Web 门户、登录节点和计算节点。

### 2.2 范围

范围内：

- LDAP 账号与组管理、Slurm 账户与限额同步、OOD 门户及定制应用、自研管理控制台与后端 API。
- GPU 与节点监控、告警、作业级指标；用量采集、账单、报表、审计。
- 以上全部组件的容器化与部署方案。

范围外（首期不做）：Kubernetes 调度 GPU 任务、多集群联邦、在线支付、对象存储服务、跨机房容灾。

### 2.3 假设与约束（需在评审中确认）

- 操作系统为 Rocky/Alma Linux 8/9 或 Ubuntu 22.04/24.04；GPU 为 NVIDIA，已安装驱动，并可安装 DCGM。
- 登录节点、OOD 节点、计算节点共享存储（NFS/Lustre/BeeGFS），用户 home 目录路径一致。
- Slurm 版本不低于 23.11（需要较新的 slurmrestd 数据接口），启用 cgroup v2 与 GRES 自动探测。
- 集群规模、GPU 型号（是否使用 MIG）、并发用户数、是否复用已有 LDAP，见第 15 章待确认事项。

## 3. 角色与权限

角色来源于 LDAP 组，经 Dex 的 groups 声明传递给平台后端，后端据此做 RBAC。Slurm 侧的 Account 与 LDAP 课题组一一对应。

- **平台管理员**（hpc-admins）：全部功能，含 LDAP 用户管理、Slurm 账户与 QOS、价格与计费规则、系统配置。
- **运维人员**（hpc-ops）：监控、告警、节点 drain/resume、强制取消作业、只读计量数据。
- **课题组负责人 / PI**（组管理员）：审批组内成员、调整组内配额分配、查看本组用量与账单。
- **普通用户**：提交与管理自己的作业，使用交互式应用，查看自己的用量与自己作业占用 GPU 的指标。
- **财务 / 审计**（只读）：查看全局计量、账单与审计日志，不可操作集群。

权限原则：默认最小授权；对用户可见的数据按“本人/本组/全局”三级过滤；所有写操作记录审计日志（操作人、对象、前后值、时间、来源 IP）。

## 4. 总体架构

### 4.1 逻辑架构

```
浏览器 ──HTTPS──> 入口反向代理（TLS 终结）
                    ├─ /pun /node /rnode ─> Open OnDemand（作业、文件、终端、交互式应用）
                    ├─ /portal/ ──────────> 平台前端 SPA（管理控制台、监控、计量）
                    └─ /api/ ─────────────> 平台后端 API

Dex（OIDC）──> LDAP（OpenLDAP / FreeIPA）   <── SSSD（登录/计算/OOD 节点）

平台后端 ──> slurmrestd（JWT）──> slurmctld / slurmdbd ──> MariaDB
         ──> Prometheus HTTP API ──> dcgm-exporter / node_exporter / slurm-exporter
         ──> PostgreSQL（业务库、计量库）
         ──> LDAP（用户与组管理，使用服务账号）

OOD ──> sbatch / squeue / scancel / scontrol（经 Slurm 客户端 + munge）──> slurmctld
```

### 4.2 组件职责与部署形态

| 组件 | 职责 | 建议部署形态 | 常用端口 |
| --- | --- | --- | --- |
| OpenLDAP / FreeIPA | 统一账号、组、SSH 公钥 | 独立 2 节点，主从或多主复制 | 389 / 636 |
| SSSD | 各节点解析 LDAP 用户与组，保证 UID/GID 一致 | 宿主机 | - |
| Dex | OIDC 身份代理，对接 LDAP | 容器 | 5556 |
| Open OnDemand | 浏览器入口：作业、文件、终端、交互式应用 | 独立 Web 节点（见 11.2 的取舍） | 443 |
| slurmctld / slurmdbd / slurmrestd | 调度、记账、REST 接口 | 管理节点，slurmctld 配备份 | 6817 / 6819 / 6820（可配置） |
| slurmd | 计算节点作业执行与 GPU 管理 | GPU 节点宿主机 | 6818 |
| dcgm-exporter、node\_exporter | GPU 与节点指标 | GPU 节点（宿主机服务或容器） | 9400 / 9100 |
| Prometheus、Alertmanager、Grafana | 指标存储、告警、可视化 | 容器 | 9090 / 9093 / 3000 |
| 平台后端、前端 | 业务 API、管理控制台、计量 ETL | 容器 | 8080 / 80 |
| PostgreSQL | 平台业务库与计量库 | 容器或独立节点 | 5432 |

### 4.3 技术选型建议

- 后端：Python（FastAPI）或 Go，接口遵循 OpenAPI 3，计量 ETL 与同步任务使用独立 worker（Celery 或 APScheduler）。
- 前端：Vue 3 + TypeScript + ECharts（或 React + Ant Design），构建为静态资源由 Nginx 提供。
- 时序存储：Prometheus；需要长期留存时增加 VictoriaMetrics 或 Thanos。
- 可视化：管理控制台使用自研页面展示核心视图，Grafana 用于运维深度排障，两者共用 Prometheus 数据源。

### 4.4 关键集成点

1. **LDAP 与操作系统**：所有节点通过 SSSD 解析用户与组，启用 LDAPS 或 StartTLS，保证同一用户在任意节点 UID/GID 相同。
2. **LDAP 与 OOD**：OOD 通过 Dex 的 LDAP connector 做 OIDC 登录（使用 ood-portal-generator 生成 Apache 配置），登录名映射为 LDAP uid。
3. **OOD 与 Slurm**：OOD 的 Slurm 适配器通过命令行（sbatch、squeue、scancel、scontrol）工作，因此 OOD 节点必须安装 Slurm 客户端、munge（与集群使用同一 key）和 slurm.conf，并在 /etc/ood/config/clusters.d/ 中定义集群。
4. **平台后端与 Slurm**：后端通过 slurmrestd（auth/jwt）访问调度与记账数据。后端使用 SlurmUser 或 root 签发的令牌，并通过 X-SLURM-USER-NAME 头以终端用户身份操作（具体行为以所选 Slurm 版本文档为准，需在 PoC 阶段验证）。
5. **Slurm 与 LDAP**：Slurm 通过 NSS 识别用户，但 Slurm 账户体系需由同步服务用 sacctmgr 维护，两者不会自动联动。
6. **Slurm 与监控**：slurm-exporter 提供队列与节点指标；Prolog/Epilog 写入 GPU 与作业的映射，使 GPU 指标可按作业与用户聚合。
7. **Slurm 与计量**：计量 ETL 从 slurmdbd 增量读取作业记账数据。

## 5. 端到端业务流程

### 5.1 账号开通与资源授权

1. 用户在门户提交开通申请，或由管理员直接创建；PI 或管理员审批。
2. 后端在 LDAP 创建用户（uid、uidNumber、gidNumber、homeDirectory、loginShell，可选 sshPublicKey），并加入课题组。uidNumber 由后端从受控号段中分配，防止冲突。
3. 同步服务（定时 + 事件触发，必须幂等）把 LDAP 组映射为 Slurm Account，使用 sacctmgr 建立用户关联，并设置默认 QOS、GrpTRES、MaxJobs、最大时长等限额。
4. 创建 home 与 scratch 目录并设置存储配额（oddjob-mkhomedir 或后端通过受控通道在存储节点执行）。
5. 通知用户；用户使用 LDAP 账号登录门户，首次登录时自动创建 PUN。

### 5.2 登录认证

1. 浏览器访问 OOD 或 /portal/，未登录则跳转 Dex。
2. Dex 通过 LDAP connector 执行绑定校验，成功后返回 OIDC 令牌，包含用户名与 groups。
3. OOD 侧由 Apache 的 mod\_auth\_openidc 建立会话，并将 REMOTE\_USER 映射为系统用户名；nginx\_stage 以该用户 UID 启动 PUN（要求 OOD 节点 SSSD 可解析该用户）。
4. 自研前端使用授权码 + PKCE 登录同一个 Dex，实现与 OOD 的单点登录；后端校验令牌签名（JWKS）、有效期与 groups，再映射为平台角色。
5. 退出登录时同时清理 OOD 会话与平台会话（前端统一登出入口）。

### 5.3 作业提交与交互式应用

1. 用户在 OOD 或平台“资源申请”页选择应用（Jupyter、VS Code、远程桌面、自定义训练表单、批处理模板）。
2. 表单（form.yml）收集分区、GPU 型号与数量、CPU、内存、时长、计费账户、QOS、容器镜像。表单选项来自当前用户有权使用的资源目录，避免提交后才被拒绝。
3. submit.yml.erb 将表单渲染为 sbatch 参数，例如 `--gres=gpu:a100:2 -A <account> -p <partition> -t <time>`。
4. OOD Slurm 适配器调用 sbatch，并通过 squeue 轮询状态。
5. 调度：Slurm 校验 Association 与 QOS 限额，按优先级与公平份额排队，分配 GRES。
6. 作业启动：Prolog 写入 GPU 与 JobID 映射；cgroup 限制作业只能看到分配给它的 GPU；before.sh 与 script.sh.erb 在 Apptainer 容器内（`--nv`）启动服务。
7. 交互式应用就绪后，OOD 读取 connection.yml，通过 /node/\<host>/\<port> 反向代理把 Web 服务提供给用户。
8. 结束或取消：用户点击删除触发 scancel，或到时自动结束；Epilog 清理 GPU 进程、临时目录与映射文件。

平台也支持通过后端 API 提交作业（后端经 slurmrestd 以用户身份提交），用于流水线与自动化场景，与 OOD 提交走同一套限额与记账。

### 5.4 监控数据流

1. GPU 节点上的 dcgm-exporter 与 node\_exporter 每 15 秒暴露指标。
2. Prolog 在约定目录按 GPU 编号写入作业号，Epilog 删除，使 GPU 指标带上 job\_id 标签（对应 dcgm-exporter 的 HPC 作业映射能力，参数以所用版本文档为准）；用户与账户标签由 slurm-exporter 或后端补全。
3. Prometheus 抓取，原始数据保留 15 到 30 天；长期趋势降采样后留存。
4. 后端通过 PromQL 查询并按 RBAC 过滤后提供给前端；OOD 的 Active Jobs 页面可嵌入 Grafana 作业面板（按所用 OOD 版本文档配置）。
5. Alertmanager 按规则告警（邮件、企业微信、钉钉 webhook），后端接收 webhook，落库、通知，并按策略触发自动处置。

### 5.5 计量与账单

1. 作业结束后，slurmdbd 完成记账。必须在 slurm.conf 中配置 AccountingStorageTRES 包含 gres/gpu（以及按型号细分的 gres/gpu:型号），并设置 AccountingStorageEnforce 包含 associations、limits、qos。
2. 计量 ETL 每小时增量拉取（优先使用 slurmrestd 的 slurmdb 接口或 sacct，不直接绑定 slurmdbd 表结构），按作业结束时间做水位线，防止漏采与重复。
3. 清洗：补全用户、组、项目归属；处理 requeue、NODE\_FAIL、取消、数组作业等特殊状态。
4. 汇总：写入 PostgreSQL 的作业用量事实表与日汇总表。
5. 计价：按价格表与系数计算费用，扣减预付额度，生成日账单与月账单。
6. 额度联动：余额或配额不足时，后端通过 sacctmgr 在 Association 或 QOS 上设置限制（例如 GrpTRESMins），新作业将被调度器拒绝；充值或调整后自动解除。
7. 对账：每月与 sreport 的结果对账，偏差超出约定阈值（建议 0.5%）时告警。

### 5.6 告警与故障处置（示例）

GPU 出现严重 XID 错误或掉卡 → Prometheus 规则触发 → Alertmanager 通知运维，并回调后端 → 按策略自动执行 `scontrol update NodeName=<node> State=DRAIN Reason="GPU XID"`，在管理控制台生成工单，并通知受影响作业的所有者 → 运维修复后在控制台 resume 节点，记录处理结论。自动 drain 默认仅对白名单告警类型开启，其余需人工确认。

### 5.7 账号停用与退场

LDAP 中禁用账号或移出课题组 → 同步服务取消对应 Slurm 关联（历史作业记录保留）→ 取消该用户运行中与排队的作业 → 终止其 PUN → 数据按策略归档或限期清理 → 计量系统冻结其账单关联并保留历史。

## 6. 功能需求

优先级说明：P0 为首期必须，P1 为二期，P2 为择机实现。

### 6.1 GPU 监控管理平台（A）

| 编号 | 需求说明 | 优先级 |
| --- | --- | --- |
| A-01 | GPU 资产台账：节点、GPU 型号、UUID、序列号、驱动与 CUDA 版本、MIG 配置、PCIe/NVLink 拓扑；来源为 DCGM、nvidia-smi 与 scontrol show node | P0 |
| A-02 | 实时指标：利用率、显存、温度、功耗、SM 时钟、PCIe/NVLink 带宽、ECC 与 XID 错误；采集周期 15 秒，页面刷新不超过 10 秒 | P0 |
| A-03 | 集群总览：GPU 总数、已分配、空闲、故障、Drain 数量，可按分区、型号、机架聚合 | P0 |
| A-04 | GPU、作业、用户关联：任一 GPU 可下钻到当前作业、所有者、账户、已运行时长；任一作业可下钻到其占用的全部 GPU 曲线 | P0 |
| A-05 | 告警规则管理：阈值、持续时间、级别、通知渠道、静默与升级；规则以版本化文件保存，可回滚 | P0 |
| A-06 | 健康与故障：检测 XID、不可纠正 ECC、掉卡、过温、降频；可自动或经确认后 drain 节点并生成处置记录 | P1 |
| A-07 | 低效利用识别：连续占用但利用率低于阈值（例如 1 小时内低于 5%）的作业，通知用户与管理员 | P1 |
| A-08 | 历史趋势与对比：按 GPU、节点、分区、用户、时间窗口对比，支持导出 | P1 |

### 6.2 算力集群资源调用平台（B）

| 编号 | 需求说明 | 优先级 |
| --- | --- | --- |
| B-01 | 统一登录：LDAP 账号登录 OOD 与管理控制台，二者单点登录 | P0 |
| B-02 | 资源目录：展示用户有权使用的分区、QOS、GPU 型号、当前可用量与预计排队时间 | P0 |
| B-03 | 作业提交：OOD Job Composer 模板与自定义训练表单；模板库由管理员维护 | P0 |
| B-04 | 交互式应用：Jupyter、VS Code（code-server）、远程桌面、TensorBoard，以 OOD batch\_connect 方式交付 | P0 |
| B-05 | 作业管理：列表、详情、日志、取消、重提交、依赖与数组作业；时长延期仅限规则允许或管理员操作 | P0 |
| B-06 | 配额与限额：并行作业数、GPU 数、最长时长、GrpTRESMins；超限时在提交前给出明确提示 | P0 |
| B-07 | 文件管理：OOD Files 应用，展示存储配额与使用量 | P0 |
| B-08 | 环境与镜像：Apptainer 镜像白名单与预置镜像、Lmod 模块、Conda 环境使用说明 | P1 |
| B-09 | 优先级、抢占与预约：QOS 优先级、可抢占队列、Reservation（课程、比赛等） | P1 |
| B-10 | 管理员运维：节点 drain/resume、强制取消、调整优先级，全部审计 | P1 |
| B-11 | 申请与审批：配额增加、时长延期、专用预约，走 PI 与管理员两级审批 | P2 |

### 6.3 算力监控与计量平台（C）

| 编号 | 需求说明 | 优先级 |
| --- | --- | --- |
| C-01 | 作业级用量：GPU·h、CPU·h、内存 GB·h、等待时间，来源 slurmdbd | P0 |
| C-02 | 多维聚合：用户、课题组、项目、分区、GPU 型号、时间（日、周、月） | P0 |
| C-03 | 计费规则：按 GPU 型号定价、优先级与时段系数、免费额度、折扣；规则有生效时间与历史版本 | P1 |
| C-04 | 余额与额度控制：预充值或配额两种模式，80% 与 100% 预警，耗尽后自动限制新作业 | P1 |
| C-05 | 账单与报表：日账单、月账单，CSV 与 PDF 导出，邮件订阅 | P1 |
| C-06 | 资源效率：分配与实际利用对比（GPU 利用率、显存、CPU 效率） | P1 |
| C-07 | 容量分析：排队等待时间、分区利用率、碎片率、峰值时段 | P2 |
| C-08 | 审计日志：登录、提交、取消、配额变更、规则变更、账单调整 | P0 |
| C-09 | 平台自监控：slurmctld、slurmdbd、slurmrestd、OOD、Dex、LDAP、Prometheus、PostgreSQL、磁盘与证书到期 | P0 |

### 6.4 计量口径

- GPU·h = Σ（作业分配的 gres/gpu 数量 × 运行秒数 ÷ 3600）。MIG 切片作为独立 GRES 类型，按配置的折算系数计价。
- 排队时间不计费。因节点故障（NODE\_FAIL）失败的作业，管理员可标记冲正。
- 运行中的作业按日切片估算，作业结束后以最终值校正，避免跨日、跨月作业归属错误。
- 费用 = Σ（各类资源用量 × 单价 × 系数）。建议在 Slurm 中配置 TRESBillingWeights，使公平份额与价格权重方向一致；财务金额以平台价格表计算结果为准。
- 最小计费粒度（建议 1 分钟）、金额精度（建议 2 位小数）、币种与是否对外结算，均为可配置项，待确认。

## 7. 非功能需求

以下为初始指标，待第 15 章规模信息确认后调整。

- **性能**：在线用户 500 以内时，实时页面 P95 响应不超过 2 秒，作业列表（10 万条以内）P95 不超过 1 秒，监控历史查询 P95 不超过 3 秒。
- **可用性**：核心控制面（LDAP、Dex、slurmctld、slurmdbd、OOD）目标可用性 99.9%。
- **故障隔离**：自研平台、Prometheus、slurmrestd 任一故障，都不得影响已运行作业与命令行提交；OOD 提交走 Slurm 客户端，不依赖自研后端。
- **安全**：详见第 12 章，全链路 TLS、最小权限、审计可追溯。
- **可扩展**：节点规模增长时，Prometheus 支持分片或联邦；新增 GPU 型号、分区、价格项只需配置，不改代码。
- **兼容性**：支持 Chrome、Edge、Firefox 最近两个主版本，宽度 1366 像素以上显示正常。
- **可维护**：配置即代码（Git 管理）、部署脚本幂等、日志统一为 JSON 并集中收集。
- **数据保留**：原始指标 30 天；作业记账与账单至少 5 年；审计日志至少 1 年（均可配置）。

## 8. 前后端协作设计

### 8.1 职责边界

- **OOD**：用户态功能，包括作业创建与管理、交互式应用、文件、终端，全部以用户本人身份运行。
- **平台前端（SPA）**：资源目录与申请、GPU 监控与告警、用量与账单、管理控制台（含 LDAP 与 Slurm 账户管理）。
- **平台后端**：身份映射与 RBAC，封装 Slurm、LDAP、Prometheus，计量 ETL，审批与审计，告警接收。
- **边界原则**：前端不直接访问 Slurm、LDAP、Prometheus、Grafana；后端不绕过 Slurm 自行实现调度语义；OOD 不直接读写平台业务库。
- **入口整合**：通过 OOD 的 ondemand.d 配置扩展导航栏，加入指向 /portal/ 的菜单；/portal/ 顶栏回链 OOD（具体配置项以所用 OOD 版本文档为准）。

### 8.2 三种集成方式及选用

1. **OOD 原生应用**（Passenger 应用，可用 Ruby、Python、Node，随 PUN 以用户身份运行）：用于作业类应用、交互式应用。
2. **OOD 仪表盘扩展**（导航、公告、小部件、自定义页面）：用于入口整合、配额摘要、公告。
3. **独立 SPA + 后端 API**（与 OOD 同域不同路径）：用于管理与计量等需要平台级权限、需要跨用户读取数据的功能。

需要平台级权限的功能不放进 PUN，因为 PUN 以普通用户身份运行，既没有也不应拥有这类权限。

### 8.3 认证与授权协作

1. 前端使用 OIDC 授权码 + PKCE 登录 Dex。
2. 前端以 Bearer 令牌调用 /api，令牌只放内存，不写入 localStorage；续期方式（静默刷新，或后端 HttpOnly Cookie 会话）在评审中二选一。
3. 后端校验 JWT 的签名、iss、aud、exp，并由 groups 映射角色。对象级权限（本人、本组）在后端服务层校验，不信任前端传参。
4. 后端访问 Slurm 时使用服务令牌并通过 X-SLURM-USER-NAME 代表用户；管理类操作使用管理员身份并写审计。
5. 后端访问 LDAP 使用最小权限服务账号（仅限指定 OU 的有限属性），密码由 Secret 管理。
6. 前端不持有任何 Slurm、LDAP、数据库凭据。

### 8.4 API 约定

- **风格**：REST + JSON，路径 /api/v1/...；OpenAPI 3 契约先行，契约变更需前后端评审，破坏性变更升 v2。
- **统一响应**：{code, message, data, request\_id}。HTTP 状态码表达传输层语义，业务错误码按模块划分，例如令牌过期、无权限、超出配额、Slurm 不可用各有独立编码。
- **分页与过滤**：page、page\_size（上限 200）、sort、filter；超大结果集使用游标。
- **时间与金额**：服务端统一 UTC（ISO 8601），前端按用户时区展示；金额使用十进制字符串，避免浮点误差。
- **幂等**：创建类接口支持 Idempotency-Key。
- **异步任务**：账号同步、报表生成等长耗时操作返回 task\_id，前端通过 GET /api/v1/tasks/{id} 或 SSE 获取进度。
- **实时数据**：GPU 实时面板使用 SSE（或 WebSocket），服务端聚合后每 5 到 10 秒推送，断线自动重连并回补。
- **缓存与保护**：集群总览等高频数据后端缓存 5 秒；Prometheus 查询限制时间跨度与点数（例如单次最多 1000 点），超出自动降采样；按用户与接口限流，保护 slurmrestd 与 Prometheus。

### 8.5 核心接口清单（首期）

| 模块 | 接口 | 说明 | 数据来源 |
| --- | --- | --- | --- |
| 身份 | GET /api/v1/me | 当前用户、角色、所属组、可用账户 | Dex 令牌 + LDAP |
| 资源目录 | GET /api/v1/catalog | 分区、QOS、GPU 型号、可用量 | slurmrestd |
| 作业 | POST /api/v1/jobs | 提交作业（模板或脚本） | slurmrestd |
| 作业 | GET /api/v1/jobs 与 /jobs/{id} | 列表与详情，含 GPU 曲线入口 | slurmrestd + Prometheus |
| 作业 | DELETE /api/v1/jobs/{id} | 取消作业 | slurmrestd |
| 节点 | GET /api/v1/nodes；POST /nodes/{name}/drain | 节点状态与处置 | slurmrestd |
| GPU | GET /api/v1/gpus 与 /gpus/{uuid}/metrics | 资产与指标 | Prometheus |
| GPU | GET /api/v1/stream/gpus（SSE） | 实时推送 | Prometheus |
| 用量 | GET /api/v1/usage?group\_by=&from=&to= | 多维用量 | PostgreSQL |
| 账单 | GET /api/v1/bills；POST /bills/{id}/export | 账单与导出 | PostgreSQL |
| 账户 | POST /api/v1/accounts 与 /users | LDAP 与 Slurm 账户管理 | LDAP + sacctmgr |
| 配额 | PUT /api/v1/accounts/{id}/limits | 修改限额 | sacctmgr |
| 告警 | POST /api/v1/alerts/webhook | Alertmanager 回调 | 内部 |
| 审计 | GET /api/v1/audit | 审计查询 | PostgreSQL |

### 8.6 协作开发流程

1. **契约先行**：后端在 Git 中维护 OpenAPI；前端据此生成 TypeScript SDK，并用 Mock（如 Prism、MSW）并行开发。
2. **本地联调**：后端对接容器化的 Slurm 测试集群（单机多 slurmd 或社区 Docker 化 Slurm 集群）；GPU 指标使用模拟数据或测试节点。
3. **预发环境**：与生产同构、至少 2 个 GPU 节点，代码合并后自动部署。
4. **契约与端到端测试**：CI 中以契约测试工具校验实现与 OpenAPI 一致；前端 E2E（如 Playwright）覆盖登录、提交作业、取消作业、用量查询四条主链路。
5. **版本管理**：前后端同一发布清单，后端向前兼容至少一个前端版本。
6. **可追踪**：每个请求带 request\_id，前端展示并上报，后端日志与 slurmrestd 调用日志可按该 ID 串联。
7. **灰度发布**：新功能由特性开关控制，管理员先行，再逐步放量。

## 9. 数据模型与指标设计

### 9.1 平台业务库（PostgreSQL）主要表

| 表 | 主要字段 | 说明 |
| --- | --- | --- |
| users\_cache | uid、uid\_number、姓名、邮箱、状态、同步时间 | LDAP 用户的只读缓存，LDAP 仍为权威来源 |
| groups、projects | 组名、PI、Slurm Account、项目名、预算、状态 | 课题组与项目，和 Slurm Account 一一对应 |
| job\_usage | cluster、job\_id、array\_task\_id、uid、account、project、partition、qos、gpu\_type、gpu\_count、cpu、mem、submit/start/end 时间、elapsed、state、gpu\_hours、cost | 作业用量事实表，唯一键建议为（cluster、job\_id、submit\_time），因为 job\_id 在计数器重置后可能重复 |
| usage\_daily | 日期、account、uid、partition、gpu\_type、gpu\_hours、cpu\_hours、cost | 日汇总，支撑报表与看板 |
| price\_rules | 资源、gpu\_type、单价、系数、生效与失效时间、版本 | 价格表，历史版本不可修改 |
| quotas、wallets | account、余额、配额、周期、状态 | 额度与余额，每次变动写流水 |
| bills | bill\_id、account、周期、金额、状态、生成时间 | 账单，出账后只允许冲正，不允许修改 |
| alerts | 指纹、规则、级别、节点、gpu\_uuid、job\_id、状态、起止时间、处理人、结论 | 告警与处置记录 |
| audit\_log | 时间、操作人、角色、动作、对象、前后值、来源 IP、request\_id | 审计日志，只追加 |
| approvals、tasks | 类型、申请人、审批人、状态、进度、结果 | 审批流与异步任务 |

### 9.2 指标与标签规范（Prometheus）

- **GPU 指标（dcgm-exporter）**：利用率、显存使用、温度、功耗、SM 时钟、XID 错误等；DCGM 默认计数器之外的指标（如 Tensor 活跃度、NVLink 带宽）需在 dcgm-exporter 的计数器配置中启用。
- **节点指标（node\_exporter）**：CPU、内存、磁盘、网络、温度。
- **Slurm 指标（slurm-exporter）**：节点状态（alloc、idle、drain、down）、排队与运行作业数、分区 GPU 分配数、调度器延迟。
- **统一标签**：cluster、node、gpu（序号）、UUID、modelName；作业相关标签 job\_id、user、account、partition。
- **基数控制**：job\_id、user 这类高基数标签只用于短期原始数据；长期趋势通过 recording rules 预聚合到 account、partition、gpu\_type 维度后再保留。
- **告警规则示例**：GPU 温度持续高于 85℃ 超 5 分钟（警告）；XID 非零（严重）；节点 down 或 drain 超 30 分钟；Slurm 显示的 GPU 数量少于资产台账（掉卡）；slurmctld 或 slurmdbd 不可达；Dex 或 LDAP 登录失败率突增；证书剩余有效期小于 14 天；磁盘使用超过 85%。

## 10. 容器化方案

### 10.1 总体策略：哪些容器化，哪些不容器化

原则：与内核、驱动、设备、系统身份强耦合的组件留在宿主机；无状态或易迁移的平台服务全部容器化。

| 组件 | 是否容器化 | 理由与说明 |
| --- | --- | --- |
| LDAP | 测试环境容器；生产建议宿主机或 VM | 被全部节点依赖，涉及复制与持久化，故障影响面最大 |
| SSSD | 否（宿主机） | 属于系统级身份解析 |
| slurmd（GPU 节点） | 否（宿主机） | 需要管理 cgroup、GPU 设备，与内核和驱动紧耦合 |
| slurmctld、slurmdbd、MariaDB | 测试环境容器；生产建议 VM 或宿主机 | 有状态且对时间、主机名、munge 敏感；K8s 方案可评估 SchedMD 的 Slinky 项目，需单独评估成熟度 |
| slurmrestd | 可容器化 | 无状态，但需访问 munge socket 与 JWT 密钥，可与 slurmctld 同机部署 |
| Open OnDemand | 开发测试用容器；生产建议独立 VM 或物理机（RPM 部署） | 官方容器镜像主要面向开发测试；容器化需解决 SSSD、munge、共享存储、用户切换、反向代理到计算节点网络等问题 |
| Dex、Grafana、Alertmanager、Prometheus | 是 | 无状态或仅需持久卷 |
| PostgreSQL | 是（或外置托管） | 需持久卷、备份与监控，规模较大时建议独立节点 |
| 平台后端、worker、前端、入口代理 | 是 | 自研服务，标准容器化交付 |
| dcgm-exporter | 容器或宿主机服务均可 | 使用 NVIDIA 官方镜像，需 NVIDIA Container Toolkit |
| node\_exporter | 宿主机 | 采集宿主机指标更准确 |
| 用户作业环境 | Apptainer 镜像 | 通过 OOD batch\_connect 与 sbatch 使用；不在计算节点开放 Docker 给普通用户，避免 UID 与权限隔离问题 |

OOD 若必须容器化，需满足：容器内可经 SSSD 解析 LDAP 用户（挂载宿主机 SSSD pipes 或在容器内运行 SSSD）、挂载与集群同一份 munge socket 或 key 及 slurm.conf、挂载共享存储（保持路径一致）、容器内允许 nginx\_stage 通过 sudo 切换用户、网络可直达计算节点动态端口；并在预发环境完成 PUN 启动、交互式应用与 WebSocket 的完整验收。

### 10.2 镜像规范

- 基础镜像使用官方最小化镜像，固定版本 tag 与 digest，不使用 latest。
- 多阶段构建；除确需特权的组件外，一律非 root 运行；根文件系统只读，仅挂载必要的可写卷。
- 每个镜像声明 HEALTHCHECK，启动前检查依赖（数据库、Dex、Slurm）连通性。
- 命名规则：registry.example.com/hpc/<组件>:<语义化版本>-\<git 短哈希>。
- 使用内部镜像仓库（如 Harbor），启用漏洞扫描与镜像签名。
- 配置与镜像分离：通过挂载、ConfigMap 或环境变量注入；密钥使用 Docker/K8s Secret、sops 或 Vault，不进入镜像，也不以明文进入 Git。
- 容器统一 UTC 时区；宿主机统一使用 chrony 同步时间。
- 日志输出到 stdout，格式为 JSON，由统一采集器收集。

### 10.3 构建与发布流水线

1. 代码提交触发 CI：静态检查、单元测试、OpenAPI 契约测试。
2. 构建镜像：前端构建产物打入 Nginx 镜像，后端多阶段构建。
3. 扫描、签名并推送到内部仓库。
4. 部署到预发环境（Compose 或 Helm），运行 E2E 用例。
5. 人工审批后滚动发布到生产；数据库迁移使用 Alembic 或 Flyway，遵循“先加后删”的向后兼容原则。
6. 回滚：保留最近 N 个镜像版本；迁移脚本可回退，或采用向前修复策略并在发布单中注明。

### 10.4 单机或小规模部署示例（平台服务层，Docker Compose）

```yaml
services:
  proxy:            # 若以 OOD 的 Apache 作为统一入口，则去掉该服务
    image: nginx:stable
    ports: ["443:443"]
    volumes: ["./proxy/nginx.conf:/etc/nginx/nginx.conf:ro", "./certs:/etc/nginx/certs:ro"]
    depends_on: [dex, backend, frontend]
  dex:
    image: dexidp/dex:<固定版本>
    volumes: ["./dex/config.yaml:/etc/dex/config.yaml:ro"]
  frontend:
    image: registry.example.com/hpc/portal-web:1.0.0
  backend:
    image: registry.example.com/hpc/portal-api:1.0.0
    environment:
      SLURMRESTD_URL: http://slurm-mgmt.internal:6820
      PROMETHEUS_URL: http://prometheus:9090
    secrets: [db_url, slurm_jwt, ldap_bind_pw]
    depends_on: [postgres, prometheus]
  worker:
    image: registry.example.com/hpc/portal-api:1.0.0
    command: ["worker"]
    secrets: [db_url, slurm_jwt, ldap_bind_pw]
  prometheus:
    image: prom/prometheus:<固定版本>
    volumes: ["./prom:/etc/prometheus:ro", "promdata:/prometheus"]
  alertmanager:
    image: prom/alertmanager:<固定版本>
  grafana:
    image: grafana/grafana:<固定版本>
  postgres:
    image: postgres:16
    volumes: ["pgdata:/var/lib/postgresql/data"]
```

说明：示例仅表达服务划分与依赖，实际使用时需补充网络、健康检查、资源限制、Secret 定义与卷声明；OOD、Slurm、LDAP 不在此 Compose 内。

### 10.5 Kubernetes 部署要点（仅平台服务层）

- 只把平台服务层放入 K8s；Slurm、LDAP、OOD、GPU 节点仍在宿主机或 VM。
- 使用 Helm 管理；Ingress 终结 TLS；后端与前端为 Deployment，PostgreSQL 使用成熟 Operator 或外置数据库。
- Prometheus 可用 kube-prometheus-stack，并以静态目标或 file\_sd 抓取集群外的 GPU 节点。
- Pod 访问 slurmrestd 与 LDAP 走集群外地址，使用 NetworkPolicy 限制出向，仅放通必要目标。
- slurmrestd 推荐以非 root 用户运行；跨主机暴露 TCP 时需在内网限制来源并用反向代理提供 TLS，JWT 令牌设置较短有效期并定期轮换。
- 配置 requests/limits、PodDisruptionBudget；HPA 仅用于无状态 API。

### 10.6 GPU 节点上的容器注意事项

- dcgm-exporter 容器：安装 NVIDIA Container Toolkit，使用 GPU 运行时；只读挂载作业映射目录；与宿主机 DCGM 版本保持兼容。
- Apptainer 作业环境：使用 `--nv` 注入宿主机驱动库；镜像来自受控目录或经审核的仓库；在 apptainer.conf 中限制可绑定路径与特权行为。
- 容器内 CUDA 版本与宿主机驱动的兼容矩阵纳入镜像规范，并在镜像发布时自动测试。

## 11. 部署方案与要点

### 11.1 部署拓扑

| 节点角色 | 数量 | 主要组件 |
| --- | --- | --- |
| OOD Web 节点 | 1（可扩展为 2 个并配粘性负载均衡） | OOD、SSSD、Slurm 客户端、munge、共享存储挂载；PUN 状态保存在本机，高可用方案需评估 |
| Slurm 管理节点 | 2（主备） | slurmctld、slurmrestd、munge、SSSD |
| 记账节点 | 1 到 2 | slurmdbd、MariaDB（主从或 Galera） |
| LDAP 节点 | 2 | OpenLDAP 或 FreeIPA，复制部署 |
| 登录节点 | 至少 1 | SSH、SSSD、Slurm 客户端 |
| GPU 计算节点 | N | slurmd、SSSD、munge、DCGM、node\_exporter、dcgm-exporter、Apptainer |
| 平台服务节点 | 2 到 3 | Dex、后端、worker、前端、Prometheus、Alertmanager、Grafana、PostgreSQL（容器宿主或 K8s） |
| 共享存储 | - | home、scratch、公共镜像与模块目录 |

### 11.2 部署顺序（按依赖关系）

1. **基础环境**：DNS、chrony 时间同步、主机名规划、内部 CA 与证书、防火墙、共享存储挂载。
2. **LDAP**：建立 OU 与组，规划 uid/gid 号段，启用 TLS，配置复制。
3. **SSSD**：所有节点接入 LDAP，验证 `id <用户>` 与 `getent group <组>` 结果一致。
4. **munge**：全集群统一 munge.key（属主 munge、权限 400），验证跨节点 munge 与 unmunge。
5. **Slurm**：MariaDB、slurmdbd、slurmctld、slurmd 依次上线；配置 gres.conf、cgroup.conf、分区与 QOS；创建 cluster、account 与用户关联；用 `srun --gres=gpu:1 nvidia-smi` 验证 GPU 分配与隔离。
6. **slurmrestd**：配置 auth/jwt，JWT 密钥权限 0600、属主为 SlurmUser，以非 root 用户运行，监听范围受限。
7. **监控**：node\_exporter、dcgm-exporter、slurm-exporter、Prometheus、Alertmanager、Grafana；上线 Prolog 与 Epilog 作业映射脚本，验证 GPU 指标带有 job\_id 标签。
8. **Dex 与 OOD**：配置 Dex 的 LDAP connector；用 ood\_portal.yml 生成 Apache 配置；定义 clusters.d；验证登录、PUN 启动、Job Composer 提交与取消。
9. **交互式应用**：部署 Jupyter、code-server、远程桌面与 Apptainer 镜像；验证反向代理与 WebSocket。
10. **平台服务**：PostgreSQL、后端、worker、前端、入口代理依次上线；LDAP 到 Slurm 的同步先以 dry-run 模式试运行，核对结果后再正式启用。
11. **计量**：回补历史作业，与 sreport 对账，生成首期试算账单。
12. **验收**：压力测试、故障演练、备份恢复演练。

### 11.3 关键配置要点

**Slurm**

- slurm.conf：`SelectType=select/cons_tres`，`GresTypes=gpu`，`AccountingStorageType=accounting_storage/slurmdbd`，`AccountingStorageTRES` 包含 gres/gpu 及按型号细分项，`AccountingStorageEnforce` 包含 associations、limits、qos，`ProctrackType=proctrack/cgroup`，`TaskPlugin=task/cgroup,task/affinity`，`PriorityType=priority/multifactor`，`AuthAltTypes=auth/jwt`，并配置 Prolog 与 Epilog。
- gres.conf 使用 `AutoDetect=nvml`；cgroup.conf 中启用 `ConstrainDevices=yes`，这是保证作业只能看到被分配 GPU 的关键；MIG 需预先划分，并确认 slurmd 能识别。
- 用 `SrunPortRange` 固定 srun 回连端口范围，并在防火墙放行。
- slurmdbd 与 slurmctld 版本保持一致；数据库调优（如 innodb\_buffer\_pool\_size）按记账数据量设置。

**LDAP 与 SSSD**

- 全程使用 LDAPS 或 StartTLS；SSSD 配置合理的缓存时间，并关闭全量枚举（enumerate=false）。
- 预留 uidNumber、gidNumber 号段（例如 10000 到 59999），由后端统一分配，避免冲突与复用。
- 密码策略与锁定策略在 LDAP 侧配置（如 ppolicy 或 FreeIPA 策略）。
- 平台后端使用的服务账号只具有指定 OU 的有限写权限。

**Open OnDemand**

- ood\_portal.yml：servername、证书、认证方式（Dex/OIDC）、用户名映射 `user_map_cmd`；需要接入自研入口时，可通过 custom\_vhost\_directives 等自定义指令增加到 /portal 与 /api 的代理（以所用版本文档为准）。
- /etc/ood/config/clusters.d/<集群>.yml：`v2.job.adapter: slurm`，并配置 bin 与 conf 路径；交互式应用在其中声明 batch\_connect 模板。
- 通过 host\_regex 等代理配置限制可访问的计算节点范围；OOD 节点到计算节点的交互端口范围需在防火墙放行。
- 交互式应用服务必须设置一次性密码或令牌，避免同一节点上的其他用户通过端口直接访问。
- OOD 的 sudo 授权仅限 nginx\_stage 命令；定期清理 PUN 日志与临时文件；锁定 OOD 与应用版本，并保留回退安装包。

**监控**

- Prometheus：抓取间隔 15 秒，原始数据保留 30 天，数据盘独立；规则文件与告警配置保存在 Git。
- Grafana：通过 Dex 登录；如需嵌入 OOD 页面，需配置允许嵌入并保证同域或反向代理一致。

### 11.4 网络与端口（常用默认值，可调整）

| 方向 | 端口 | 用途 |
| --- | --- | --- |
| 浏览器到入口 | 443 | HTTPS |
| OOD、后端到 LDAP；浏览器与后端到 Dex | 636；5556 | 身份认证 |
| 所有节点与 slurmctld | 6817 | 调度控制 |
| slurmctld 到 slurmd | 6818 | 作业下发 |
| slurmctld 到 slurmdbd | 6819 | 记账 |
| 后端到 slurmrestd | 6820（示例） | REST 访问 |
| Prometheus 到节点 | 9100、9400、slurm-exporter 端口 | 指标抓取 |
| 后端到 Prometheus | 9090 | 指标查询 |
| srun 回连 | SrunPortRange 指定范围 | 交互式作业 |
| OOD 到计算节点 | 限定的动态端口范围 | 交互式应用反向代理 |

## 12. 安全与合规

- **传输安全**：全站 HTTPS（TLS 1.2 及以上）、LDAPS；内部服务间使用 TLS，或限制在受控内网；启用 HSTS。
- **身份认证**：统一经 Dex 与 LDAP；管理员角色强制二次认证（可由 FreeIPA OTP 或上游身份源提供）；会话设置合理过期与统一登出。
- **授权**：RBAC 加对象级校验；Slurm 侧限额是硬约束，平台侧限额用于提前提示并同步到 Slurm，二者不得相互矛盾。
- **凭据管理**：LDAP 服务账号最小权限；Slurm JWT 短有效期并定期轮换；数据库与第三方凭据走 Secret 管理；日志中禁止输出令牌与密码。
- **主机与容器**：最小化镜像、非 root、只读根文件系统、漏洞扫描、宿主机基线加固；OOD 节点的 sudo 规则严格限定。
- **多租户隔离**：cgroup 限制 GPU 与资源可见性；作业使用私有临时目录；文件权限与 umask 统一；交互式应用使用一次性凭据。
- **防滥用**：对提交与 API 请求限流；用 MaxSubmitJobs、MaxJobs 等限制单用户规模；对异常提交与异常登录告警。
- **审计**：所有写操作与管理操作写入审计日志，集中保存至少 1 年，审计日志只允许追加。
- **合规**：个人信息最小化采集；数据留存与跨境要求、等保级别按所在地区要求执行（待确认）。
- **补丁策略**：每月更新系统与镜像基线；高危漏洞在 72 小时内完成评估并制定处置计划。

## 13. 运维、备份与升级

### 13.1 高可用

- slurmctld 配置主备，StateSaveLocation 置于共享存储；slurmdbd 后端数据库使用主从或 Galera。
- LDAP 使用多主或 syncrepl 复制，SSSD 配置多个服务器地址。
- PostgreSQL 主从加 WAL 归档，支持时间点恢复。
- OOD 的配置与自定义应用保存在 Git 与配置管理工具中，节点故障时可在 30 分钟内重建。
- 平台后端与前端至少 2 个副本，无状态，滚动更新。

### 13.2 备份与恢复

| 对象 | 方式 | 频率 | 保留 |
| --- | --- | --- | --- |
| slurmdbd 数据库 | mariabackup 全量 + binlog | 每日全量，binlog 持续 | 30 天 |
| slurmctld StateSaveLocation | 快照 | 每日 | 7 天 |
| LDAP | slapcat 或 FreeIPA 备份 | 每日 | 30 天 |
| PostgreSQL | 全量 + WAL 归档 | 每日全量，WAL 持续 | 30 天；账单与审计永久或按合规要求 |
| 配置与规则 | Git | 变更即提交 | 永久 |

每季度执行一次恢复演练。建议目标：整体 RTO 不超过 4 小时，计量库 RPO 不超过 15 分钟（待确认）。

### 13.3 升级策略

- **Slurm**：遵循官方升级路径，不跨过多个主版本；先备份数据库与 StateSaveLocation；顺序为 slurmdbd、slurmctld、slurmd，最后是登录节点与 OOD 节点上的客户端；slurmd 滚动升级。slurmrestd 的数据接口版本变化可能影响后端解析，后端需设置版本适配层并纳入回归测试。
- **Open OnDemand**：升级前备份 /etc/ood/config 与自定义应用；先在预发环境验证登录、PUN、各交互式应用，再升级生产。
- **Dex、Prometheus、Grafana、自研服务**：镜像更新，灰度发布，保留回退版本。
- **GPU 驱动与 DCGM**：逐节点执行 drain、升级、验证、resume，同时确认 dcgm-exporter 与 Apptainer 的兼容性。

### 13.4 日常运维与应急预案

- 告警分级响应：严重告警 15 分钟内响应，重要告警 1 小时内响应。
- 编写并演练 Runbook：GPU 节点故障、slurmctld 主备切换、slurmdbd 数据库恢复、LDAP 故障、OOD 无法启动 PUN、账单偏差处理。
- 变更通过工单与评审，先预发后生产，每次变更附回退方案。

## 14. 实施里程碑与验收

### 14.1 里程碑（周期为建议值，依团队规模调整）

| 阶段 | 周期 | 主要交付 | 完成标志 |
| --- | --- | --- | --- |
| M0 方案与 PoC | 2 到 3 周 | 确认第 15 章事项；单节点联通 Slurm、LDAP、OOD；验证 slurmrestd 以用户身份操作、GPU 作业映射、OOD 容器化可行性 | PoC 报告通过评审 |
| M1 基础集群 | 3 到 4 周 | LDAP 与 SSSD；Slurm（含记账、GRES、cgroup）；Dex 与 OOD 登录；基础交互式应用 | 用户可登录，并在 GPU 上运行 Jupyter 与批处理作业 |
| M2 监控 | 3 周 | GPU、节点、Slurm 指标；Prometheus、Alertmanager、Grafana；作业映射；A-01 到 A-05 | 管理员可见完整 GPU 看板，告警可达 |
| M3 自研平台 MVP | 6 到 8 周 | 后端、前端、资源目录、账户同步；B-01 到 B-07；C-01、C-02、C-08、C-09 | 四条主链路 E2E 通过 |
| M4 计量与计费 | 4 到 6 周 | ETL、价格规则、账单、额度联动、对账 | 与 sreport 对账偏差不超过 0.5% |
| M5 试运行与上线 | 4 周 | 压测、故障与恢复演练、用户培训、灰度放量 | 验收通过，全量上线 |

### 14.2 验收标准

1. **认证**：LDAP 新用户 10 分钟内可登录 OOD 与登录节点；账号被禁用后，在缓存时间内（目标 5 分钟）失效。
2. **调度**：用户申请 2 块 GPU，作业内 nvidia-smi 只能看到 2 块；超出限额的提交在前端被提前拦截，绕过前端直接 sbatch 同样被 Slurm 拒绝。
3. **交互式应用**：资源就绪后 30 秒内可打开 Jupyter 页面；连续 8 小时使用 WebSocket 不断连。
4. **监控**：GPU 指标延迟不超过 30 秒；任一 GPU 可定位到作业与用户；告警触发到通知送达不超过 2 分钟。
5. **计量**：随机抽样 100 个作业，GPU·h 与 sacct 完全一致；月度总量与 sreport 偏差不超过 0.5%；跨日与跨月作业归属正确。
6. **故障隔离**：停止 slurmrestd、Prometheus 或自研后端时，OOD 提交与已运行作业不受影响；slurmctld 主备切换后作业不丢失。
7. **安全**：镜像扫描无高危漏洞；越权测试通过，普通用户无法查看其他组的数据；审计记录可检索。
8. **恢复**：备份恢复演练通过，满足约定的 RTO 与 RPO。
9. **性能**：满足第 7 章性能指标。

## 15. 风险与待确认事项

### 15.1 待确认事项

1. **规模**：节点数、GPU 总数与型号、是否使用 MIG、预期注册用户与并发用户数、日均作业量。
2. **身份**：是否已有 LDAP 或 AD；选用 OpenLDAP 还是 FreeIPA；是否需要多因素认证，是否对接企业统一登录。
3. **LDAP 写入方式**：由平台后端直接写 LDAP，还是由管理员在现有工具中操作、后端只读同步。后者风险更低，建议首期采用后者，二期再开放后端写入。
4. **计费模式**：真实收费还是内部记账；预付费还是后付费；是否按项目而非课题组核算；是否对接财务系统与发票。
5. **存储**：共享存储类型与配额能力；是否需要 scratch 自动清理。
6. **部署环境**：操作系统；是否已有 Kubernetes 与镜像仓库；网络是否隔离（离线环境需准备镜像与依赖的离线源）。
7. **版本**：Slurm 与 OOD 的目标版本；OOD 生产环境是否允许容器化。
8. **交互式应用清单**：Jupyter、VS Code、桌面、RStudio 等；是否需要图形应用的 GPU 渲染。
9. **可用性与恢复指标**：目标 RTO、RPO。
10. **合规**：数据留存期限、等保级别与审计要求。

### 15.2 主要风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| OOD 容器化遇到 SSSD、munge、用户切换问题 | 登录或 PUN 启动失败 | 生产先用 VM 加 RPM 部署，容器化仅在预发验证，由 M0 PoC 给出结论 |
| slurmrestd 数据接口版本变化 | 后端解析失败 | 后端增加版本适配层，锁定 Slurm 版本，升级前回归 |
| Slurm 与 LDAP 账户不同步 | 用户能登录但无法提交作业 | 同步服务幂等，输出差异报告并告警 |
| 计量偏差 | 账单争议 | 以 slurmdbd 为准，月度对账，冲正机制与审计 |
| 指标高基数 | Prometheus 内存暴涨 | 标签规范、recording rules、限制保留期 |
| GPU 与作业映射缺失 | 无法按作业与用户归集 | Prolog 与 Epilog 做健壮性测试，并用 Slurm 分配信息兜底对账 |
| 交互式应用端口被越权访问 | 数据泄露 | 一次性令牌、host\_regex 限制、网络分区 |
| 单点故障（OOD、LDAP） | 平台整体不可用 | 主备或复制、快速重建脚本、定期演练 |
| 自动 drain 误触发 | 可用 GPU 骤减 | 白名单策略、速率限制（每小时最多 drain 的节点数）、关键告警人工确认 |

### 15.3 后续工作

本文档为 v0.1 草案。评审通过后，输出详细设计（接口与数据库设计、部署手册、测试方案）与 M0 PoC 报告。
