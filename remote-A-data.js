/* =========================================================
   星轨算力 · GPU Console — mock data layer
   目标环境：2 台 GPU 服务器 + 1 台运维自用服务器
   说明：仅做界面/接口雏形；面向 2 台自用 GPU 服务器。
   ========================================================= */
(function () {
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rnd = mulberry32(20261121);
  const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  const now = Date.now();

  /* ---------------- 集群配置（按现场修改） ---------------- */
  const CLUSTER = {
    name: "GPU-Test-01",
    env: "测试环境",
    gpuServers: [
      { name: "gpu-01", model: "NVIDIA RTX PRO 5000 72GB", gpus: 8, ip: "192.168.112.230", rack: "R1·U10" }
    ],
    opsServers: [],
    partition: "gpu",
    note: "单台测试 GPU 服务器，8×RTX PRO 5000 72GB；平台只做资源监控、作业管理与告警。"
  };
  const GPU_MODEL = "NVIDIA RTX PRO 5000 72GB";
  const GPU_PER_SERVER = 8;
  const CLUSTERS = [
    { name: "GPU-Test-01", apiPrefix: "", env: "测试环境" },
    { name: "GPU-Test-02", apiPrefix: "/cluster-b", env: "测试环境" }
  ];

  /* ---------------- users & accounts ---------------- */
  const USERS = [
    { uid: 10001, name: "林予安", role: "admin", group: "平台组", email: "linya@hpc.example.com", status: "active", quota: [42, 200], last: 2 },
    { uid: 10012, name: "陈砚舟", role: "ops", group: "运维组", email: "chenyz@hpc.example.com", status: "active", quota: [8, 120], last: 8 },
    { uid: 10023, name: "张启明", role: "pi", group: "智能计算组", email: "zhangqm@hpc.example.com", status: "active", quota: [186, 600], last: 26 },
    { uid: 10024, name: "周雨桐", role: "pi", group: "视觉感知组", email: "zhouyt@hpc.example.com", status: "active", quota: [142, 500], last: 41 },
    { uid: 10031, name: "沈亦然", role: "user", group: "智能计算组", email: "shenyr@hpc.example.com", status: "active", quota: [64, 200], last: 6 },
    { uid: 10032, name: "许清和", role: "pi", group: "语言智能组", email: "xuqh@hpc.example.com", status: "active", quota: [98, 400], last: 19 },
    { uid: 10033, name: "贺知白", role: "user", group: "视觉感知组", email: "hezb@hpc.example.com", status: "active", quota: [51, 200], last: 3 },
    { uid: 10034, name: "唐微澜", role: "user", group: "智能计算组", email: "tangwl@hpc.example.com", status: "disabled", quota: [4, 120], last: 2880 },
    { uid: 10042, name: "宋知遥", role: "user", group: "语言智能组", email: "songzy@hpc.example.com", status: "active", quota: [37, 160], last: 12 }
  ];
  const ROLE_LABEL = { admin: "平台管理员", ops: "运维人员", pi: "课题组负责人", user: "普通用户" };

  const ACCOUNTS = [
    { id: "air", name: "智能计算组", pi: "张启明", members: 12, model: GPU_MODEL, usage: 1860, quota: 600 },
    { id: "vision", name: "视觉感知组", pi: "周雨桐", members: 8, model: GPU_MODEL, usage: 1420, quota: 500 },
    { id: "nlp", name: "语言智能组", pi: "许清和", members: 6, model: GPU_MODEL, usage: 980, quota: 400 },
    { id: "ops", name: "运维组", pi: "陈砚舟", members: 3, model: GPU_MODEL, usage: 260, quota: 200, selfUse: true }
  ];

  /* ---------------- partitions / nodes / GPUs ---------------- */
  const PARTITIONS = [
    { id: "gpu", name: "gpu", model: GPU_MODEL, nodes: 1, desc: "训练 / 微调 / 推理（单台测试 GPU 服务器）", priority: "高", color: "#22d3ee", nodeFrom: 1, nodeTo: 1 }
  ];
  const MODELS = {
    "NVIDIA RTX PRO 5000 72GB": { mem: 72, tdp: 300, nvlink: "PCIe 5.0", arch: "Blackwell" },
    "A100 80G": { mem: 80, tdp: 400, nvlink: "600 GB/s", arch: "Ampere" }
  };

  const NODES = [];
  CLUSTER.gpuServers.forEach((s, i) => {
    NODES.push({
      name: s.name, partition: "gpu", model: s.model, gpus: s.gpus,
      rack: s.rack, state: "online", util: 0, temp: 0, memUsed: 0, uptime: 100 - rint(0, 2), role: "GPU 计算"
    });
  });
  CLUSTER.opsServers.forEach((s) => {
    NODES.push({
      name: s.name, partition: "ops", model: "—", gpus: 0,
      rack: s.rack, state: "online", util: 0, temp: 0, memUsed: 0, uptime: 100, role: s.role
    });
  });
  // 当前现场只有两台 GPU 服务器；控制面服务与 GPU 节点同机部署。

  function gpuStateFor(nodeName, gpuIdx) {
    if (nodeName === "gpu-02") {
      if (gpuIdx < 2) return "error";
      if (gpuIdx >= 6) return "idle";
      return "allocated";
    }
    return "allocated";
  }

  const HEX = "0123456789abcdef";
  function uuid() {
    let s = "GPU-";
    for (let i = 0; i < 12; i++) s += HEX[Math.floor(rnd() * 16)];
    return s;
  }

  const GPUS = [];
  NODES.forEach((node) => {
    if (!node.gpus) return;
    for (let g = 0; g < node.gpus; g++) {
      const state = gpuStateFor(node.name, g);
      const spec = MODELS[node.model] || MODELS[GPU_MODEL];
      const util = state === "allocated" ? rint(38, 96) : state === "idle" ? rint(0, 2) : 0;
      const memRatio = state === "allocated" ? clamp(0.32 + util / 150 + rnd() * 0.13, 0.2, 0.97) : state === "idle" ? rnd() * 0.04 : 0;
      GPUS.push({
        uuid: uuid(), node: node.name, index: g, partition: node.partition, model: node.model, spec, state, util,
        temp: state === "error" ? rint(70, 90) : state === "allocated" ? rint(42, 79) : rint(28, 38),
        power: state === "allocated" ? rint(Math.round(spec.tdp * 0.55), spec.tdp) : rint(25, 60),
        memUsed: Math.round(memRatio * 100), jobId: null, user: null,
        xid: state === "error" ? pick([79, 48]) : null
      });
    }
    const list = GPUS.filter((g) => g.node === node.name);
    node.util = Math.round(list.reduce((a, g) => a + g.util, 0) / node.gpus);
    node.temp = Math.round(list.reduce((a, g) => a + g.temp, 0) / node.gpus);
    node.memUsed = Math.round(list.reduce((a, g) => a + g.memUsed, 0) / node.gpus);
    const st = list.map((g) => g.state);
    node.state = st.includes("error") ? "degraded" : st.includes("drain") ? "drain" : "online";
  });

  /* ---------------- jobs ---------------- */
  const JOB_NAMES = [
    "llama3-8b-sft", "qwen2-vl-finetune", "diffusion-xl-train", "bert-bio-ner",
    "rlhf-reward-model", "sd-lora-tuning", "vllm-serving-bench", "vit-segmentation",
    "moe-pretrain", "embedding-index", "codegen-sft", "detectron3d-train",
    "mri-reconstruction", "climate-forecast", "rag-reranker", "speech-asr"
  ];
  const IMAGES = [
    "registry.local/hpc/pytorch:2.4-cu124",
    "registry.local/hpc/vllm:0.6.3",
    "registry.local/hpc/tensorflow:2.16-cu124",
    "registry.local/hpc/base-cuda:12.4"
  ];
  const QOS = ["normal", "high", "low", "interactive"];
  const jobs = [];
  let jobId = 200100;

  function baseJob(extra) {
    return Object.assign({
      id: jobId++, name: pick(JOB_NAMES), user: "", uid: 0, account: "", accountId: "",
      partition: "gpu", gpus: 1, nodes: 1, qos: pick(QOS), image: pick(IMAGES),
      state: "running", progress: 0, elapsed: 0, wait: rint(1, 60),
      submitted: now - rint(600, 86400) * 1000, started: null, priority: rint(100, 980), exitCode: null
    }, extra);
  }
  const runSizes = [4, 3, 2, 2, 1];
  runSizes.forEach((gpus, i) => {
    const user = pick(USERS.filter((u) => u.role === "user" || u.role === "pi"));
    const account = ACCOUNTS.find((a) => a.name === user.group) || ACCOUNTS[0];
    const elapsed = rint(900, 30 * 3600);
    jobs.push(baseJob({
      name: JOB_NAMES[i % JOB_NAMES.length], user: user.name, uid: user.uid,
      account: account.name, accountId: account.id, gpus, nodes: 1,
      state: "running", progress: rint(18, 94), elapsed,
      wait: rint(1, 25), submitted: now - (elapsed + rint(60, 900)) * 1000,
      started: now - elapsed * 1000
    }));
  });
  for (let i = 0; i < 4; i++) {
    const user = pick(USERS.filter((u) => u.role === "user" || u.role === "pi"));
    const account = ACCOUNTS.find((a) => a.name === user.group) || ACCOUNTS[0];
    jobs.push(baseJob({
      name: JOB_NAMES[(i + 5) % JOB_NAMES.length], user: user.name, uid: user.uid,
      account: account.name, accountId: account.id, gpus: pick([1, 1, 2, 4]), nodes: 1,
      state: "pending", progress: 0, wait: rint(3, 90), submitted: now - rint(120, 7200) * 1000
    }));
  }
  for (let i = 0; i < 5; i++) {
    const user = pick(USERS.filter((u) => u.role === "user" || u.role === "pi"));
    const account = ACCOUNTS.find((a) => a.name === user.group) || ACCOUNTS[0];
    const elapsed = rint(1200, 6 * 3600);
    jobs.push(baseJob({
      name: JOB_NAMES[(i + 9) % JOB_NAMES.length], user: user.name, uid: user.uid,
      account: account.name, accountId: account.id, gpus: pick([1, 2, 2, 4]), nodes: 1,
      state: "completed", progress: 100, elapsed, wait: rint(1, 30),
      submitted: now - rint(3, 40) * 3600 * 1000, priority: rint(100, 900), exitCode: 0
    }));
  }
  for (let i = 0; i < 2; i++) {
    const user = pick(USERS.filter((u) => u.role === "user" || u.role === "pi"));
    const account = ACCOUNTS.find((a) => a.name === user.group) || ACCOUNTS[0];
    const elapsed = rint(300, 2400);
    jobs.push(baseJob({
      name: JOB_NAMES[(i + 13) % JOB_NAMES.length], user: user.name, uid: user.uid,
      account: account.name, accountId: account.id, gpus: pick([1, 2]), nodes: 1,
      state: "failed", progress: 100, elapsed, wait: rint(1, 20),
      submitted: now - rint(2, 20) * 3600 * 1000, exitCode: pick([1, 2, 137]),
      reason: pick(["NODE_FAIL", "OUT_OF_MEMORY", "CUDA_ERROR", "TIMEOUT"])
    }));
  }
  jobs.forEach((j) => { if (j.state === "completed" || j.state === "failed") j.started = j.submitted + j.wait * 60000; });
  const allocatedGpus = GPUS.filter((g) => g.state === "allocated");
  let gi = 0;
  jobs.filter((j) => j.state === "running").forEach((j) => {
    for (let k = 0; k < j.gpus && gi < allocatedGpus.length; k++) {
      const g = allocatedGpus[gi++];
      g.jobId = j.id;
      g.user = j.user;
    }
  });

  /* ---------------- alerts ---------------- */
  const ALERT_SEEDS = [
    ["critical", "GPU 掉卡 · XID 79", "gpu-02", "GPU-2f81a4", "GPU 已从总线掉落，节点 gpu-02 已自动 drain 并生成工单。", "gpu_xid_fatal", 3, "firing"],
    ["critical", "不可纠正 ECC (DBE)", "gpu-01", "GPU-7b2c90", "检测到 DBE（不可纠正 ECC），建议隔离该卡并安排备件。", "gpu_ecc_dbe", 11, "acked"],
    ["warning", "GPU 温度持续偏高", "gpu-02", "GPU-2f81a4", "温度连续 10 分钟高于 83℃，可能触发降频。", "gpu_temp_high", 24, "firing"],
    ["warning", "NVLink CRC 增长", "gpu-02", "GPU-3a9d11", "NVLink 重放错误计数在 30 分钟内增长 8 次。", "nvlink_crc", 38, "firing"],
    ["warning", "队列等待超阈值", "gpu", "—", "gpu 队列 P95 等待 34 分钟，超过 30 分钟阈值。", "queue_wait", 55, "firing"],
    ["info", "证书 30 天内到期", "gpu-01", "—", "OOD Apache 证书将于 30 天后到期，certmonger 自动续期已排程。", "cert_expiry", 90, "firing"],
    ["info", "磁盘水位 78%", "gpu-01", "—", "Prometheus 数据盘使用率 78%，建议纳入巡检。", "disk_usage", 150, "acked"],
    ["info", "系统负载偏高", "gpu-01", "—", "gpu-01 近 15 分钟 CPU 负载偏高，检查备份任务。", "ops_load", 210, "resolved"]
  ];
  const ALERTS = ALERT_SEEDS.map((a, i) => {
    const g = GPUS.find((x) => x.node === a[2]);
    return {
      id: "ALT-" + (2401 + i), sev: a[0], title: a[1], node: a[2],
      gpu: a[3] !== "—" ? a[3] : (g ? g.uuid : "—"),
      jobId: g && g.jobId ? g.jobId : null,
      desc: a[4], rule: a[5], mins: a[6], state: a[7], time: now - a[6] * 60000
    };
  });
  ALERTS.sort((a, b) => a.mins - b.mins);

  /* ---------------- 24h trend ---------------- */
  const TREND_LABELS = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(now - i * 3600 * 1000);
    TREND_LABELS.push(pad(d.getHours()) + ":00");
  }
  let v1 = 76, v2 = 71, v3 = 2;
  const TREND = TREND_LABELS.map((lb) => {
    v1 = clamp(v1 + (rnd() - 0.45) * 9, 55, 97);
    v2 = clamp(v2 + (rnd() - 0.5) * 8, 48, 92);
    v3 = clamp(v3 + (rnd() - 0.5) * 2.4, 0, 7);
    return {
      label: lb, util: Math.round(v1), a100: Math.round(v2),
      allocated: Math.round((12 / 16) * 100 + (rnd() - 0.5) * 4),
      queue: Math.round(v3)
    };
  });

  /* ---------------- partition stats ---------------- */
  const PARTITION_STATS = PARTITIONS.map((p) => {
    const list = GPUS.filter((g) => g.partition === p.id);
    const used = list.filter((g) => g.state === "allocated").length;
    const error = list.filter((g) => g.state === "error").length;
    const idle = list.filter((g) => g.state === "idle").length;
    const drain = list.filter((g) => g.state === "drain").length;
    const pending = jobs.filter((j) => j.state === "pending" && j.partition === p.id).length;
    return { ...p, total: list.length, used, idle, error, drain, pending, queueP95: 34 };
  });

  /* ---------------- usage（仅资源用量） ---------------- */
  const USAGE_LABELS = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now - i * 86400 * 1000);
    USAGE_LABELS.push((d.getMonth() + 1) + "/" + d.getDate());
  }
  const usageSeries = ACCOUNTS.map((a, idx) => {
    let base = [26, 20, 14, 5][idx] || 10;
    return {
      id: a.id, name: a.name,
      color: ["#22d3ee", "#818cf8", "#a78bfa", "#34d399"][idx],
      values: USAGE_LABELS.map(() => {
        base = clamp(base + (rnd() - 0.5) * 9, 2, 46);
        return Math.round(base);
      })
    };
  });
  const TOTAL_USAGE = usageSeries.reduce((acc, s) => acc + s.values.reduce((a, b) => a + b, 0), 0);
  ACCOUNTS.forEach((a, i) => { a.usage = usageSeries[i].values.reduce((x, y) => x + y, 0); });

  /* ---------------- audit ---------------- */
  const AUDIT_ACTIONS = [
    ["节点运维", "对 gpu-02 执行 drain", "gpu-02", "ops"],
    ["资源调整", "调整 视觉感知组 的 GrpTRES 上限为 gres/gpu=8", "account:vision", "admin"],
    ["告警处置", "确认告警 ALT-2402 并创建工单 TK-8801", "ALT-2402", "ops"],
    ["账户开通", "审批通过 uid=10042 的开户申请", "uid:10042", "pi"],
    ["审计导出", "导出 2026-11 审计摘要（哈希链）", "audit:2026-11", "admin"],
    ["作业操作", "取消作业 200104（用户申请）", "job:200104", "ops"],
    ["版本变更", "OOD 4.2.1 升级窗口审批", "ood:4.2.1", "admin"],
    ["告警静默", "静默 node_down 规则 30 分钟", "rule:node_down", "ops"],
    ["账户停用", "禁用 uid=10034 并撤销 SSO 会话", "uid:10034", "admin"],
    ["备份恢复", "执行 slurmdbd 恢复演练", "db:slurmdbd", "ops"]
  ];
  const AUDIT = AUDIT_ACTIONS.map((a, i) => ({
    id: "AUD-" + (98120 + i),
    action: a[0], detail: a[1], object: a[2],
    actor: pick(USERS).name, role: pick(["admin", "ops", "pi"]),
    ip: "10.0.0." + rint(10, 240),
    mins: 3 + i * 17 + rint(0, 6),
    ok: i !== 4
  })).sort((a, b) => a.mins - b.mins);

  /* ---------------- system health ---------------- */
  const HEALTH = [
    { name: "slurmctld", role: "调度控制器", status: "ok", latency: 6, uptime: "99.99%", detail: "gpu-01" },
    { name: "slurmdbd", role: "作业记录", status: "warn", latency: 38, uptime: "99.95%", detail: "gpu-01 · 写入延迟 5.2s" },
    { name: "slurmrestd", role: "REST API", status: "ok", latency: 14, uptime: "99.99%", detail: "gpu-01 · 6820" },
    { name: "Open OnDemand", role: "Web 门户", status: "ok", latency: 18, uptime: "99.97%", detail: "gpu-01" },
    { name: "Dex", role: "OIDC 身份代理", status: "ok", latency: 12, uptime: "99.98%", detail: "gpu-01" },
    { name: "FreeIPA", role: "LDAP / CA / OTP", status: "ok", latency: 5, uptime: "100%", detail: "gpu-01" },
    { name: "Prometheus", role: "指标存储", status: "ok", latency: 8, uptime: "99.95%", detail: "gpu-01 · 15d 保留" },
    { name: "DCGM Exporter", role: "GPU 指标采集", status: "ok", latency: 9, uptime: "99.99%", detail: "gpu-01 / gpu-02" }
  ];

  /* ---------------- alert rules ---------------- */
  const RULES = [
    { id: "R-01", name: "GPU 掉卡 / XID 79", expr: 'DCGM_FI_DEV_XID_ERRORS{err_code="79"} > 0', sev: "critical", dur: "1m", on: true, ver: "v3", updated: "2026-11-21" },
    { id: "R-02", name: "不可纠正 ECC (DBE)", expr: "DCGM_FI_DEV_ECC_DBE_VOL_TOTAL > 0", sev: "critical", dur: "1m", on: true, ver: "v2", updated: "2026-11-21" },
    { id: "R-03", name: "节点 down / drain", expr: 'slurm_node_state{state=~"down|drain"} == 1', sev: "critical", dur: "2m", on: true, ver: "v2", updated: "2026-11-20" },
    { id: "R-04", name: "GPU 温度过高", expr: "DCGM_FI_DEV_GPU_TEMP > 83", sev: "warning", dur: "10m", on: true, ver: "v2", updated: "2026-11-21" },
    { id: "R-05", name: "NVLink CRC 增长", expr: "increase(nvlink_crc[30m]) > 10", sev: "warning", dur: "5m", on: true, ver: "v1", updated: "2026-11-20" },
    { id: "R-06", name: "GPU 功耗接近上限", expr: "DCGM_FI_DEV_POWER_USAGE / DCGM_FI_DEV_POWER_MGMT_LIMIT > 0.95", sev: "warning", dur: "10m", on: true, ver: "v1", updated: "2026-11-21" },
    { id: "R-07", name: "证书 30 天内到期", expr: "cert_expiry_days < 30", sev: "info", dur: "1h", on: true, ver: "v1", updated: "2026-11-20" },
    { id: "R-08", name: "队列等待超阈值", expr: "queue_wait_p95 > 1800", sev: "warning", dur: "15m", on: false, ver: "v1", updated: "2026-11-20" }
  ];

  /* ---------------- totals ---------------- */
  const stateCount = (s) => GPUS.filter((g) => g.state === s).length;
  const TOTALS = {
    servers: CLUSTER.gpuServers.length + CLUSTER.opsServers.length,
    gpuServers: CLUSTER.gpuServers.length,
    opsServers: CLUSTER.opsServers.length,
    gpus: GPUS.length,
    nodes: NODES.length,
    allocated: stateCount("allocated"),
    idle: stateCount("idle"),
    error: stateCount("error"),
    drain: stateCount("drain"),
    runningJobs: jobs.filter((j) => j.state === "running").length,
    pendingJobs: jobs.filter((j) => j.state === "pending").length,
    criticalAlerts: ALERTS.filter((a) => a.sev === "critical" && a.state !== "resolved").length,
    gpuHoursMonth: TOTAL_USAGE,
    utilization: Math.round((stateCount("allocated") / GPUS.length) * 1000) / 10,
    topAccounts: [...ACCOUNTS].sort((a, b) => b.usage - a.usage)
  };

  /* ---------------- helpers ---------------- */
  const STATUS_LABEL = {
    running: "运行中", pending: "排队中", completed: "已完成", failed: "失败", cancelled: "已取消",
    allocated: "使用中", idle: "空闲", error: "故障", drain: "Drain",
    online: "在线", degraded: "降级",
    firing: "未恢复", acked: "已确认", resolved: "已恢复",
    active: "正常", disabled: "已禁用",
    critical: "严重", warning: "警告", info: "信息"
  };
  const STATUS_TONE = {
    running: "green", pending: "amber", completed: "slate", failed: "red", cancelled: "slate",
    allocated: "green", idle: "slate", error: "red", drain: "amber",
    online: "green", degraded: "red",
    firing: "red", acked: "amber", resolved: "green",
    active: "green", disabled: "slate",
    critical: "red", warning: "amber", info: "blue"
  };

  function fmt(n) { return Number(n).toLocaleString("en-US"); }
  function ago(ts) {
    const m = Math.max(1, Math.round((Date.now() - ts) / 60000));
    if (m < 60) return m + " 分钟前";
    const h = Math.floor(m / 60);
    if (h < 24) return h + " 小时前";
    return Math.floor(h / 24) + " 天前";
  }
  function dur(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  window.DB = {
    CLUSTER, CLUSTERS, GPU_MODEL, GPU_PER_SERVER, USERS, ACCOUNTS, PARTITIONS, MODELS, NODES, GPUS, JOBS: jobs, ALERTS, TREND, TREND_LABELS,
    PARTITION_STATS, USAGE_LABELS, USAGE_SERIES: usageSeries, TOTAL_USAGE, AUDIT, HEALTH, RULES, TOTALS,
    ROLE_LABEL, STATUS_LABEL, STATUS_TONE,
    fmt, ago, dur, clamp,
    gpuByUuid: (u) => GPUS.find((g) => g.uuid === u),
    gpuByNode: (n) => GPUS.filter((g) => g.node === n),
    jobById: (id) => jobs.find((j) => String(j.id) === String(id)),
    nodeByName: (n) => NODES.find((x) => x.name === n),
    accountById: (id) => ACCOUNTS.find((a) => a.id === id),
    ruleById: (id) => RULES.find((r) => r.id === id)
  };
})();
