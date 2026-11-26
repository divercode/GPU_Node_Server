/* =========================================================
   Pages: jobs / job detail / resource catalog
   ========================================================= */
(function () {
  const P = (window.Pages = window.Pages || {});
  const UI = window.UI, C = window.Charts, DB = window.DB;

  const timeStr = (ts) => new Date(ts).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateStr = (ts) => new Date(ts).toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

  /* ============================ jobs ============================ */
  P.jobs = function () {
    const me = window.__ME;
    const privileged = !me || (me.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
    const scoped = privileged ? DB.JOBS.slice() : DB.JOBS.filter((j) => j.user === me.display_name);
    const counts = {
      all: scoped.length,
      running: scoped.filter((j) => j.state === "running").length,
      pending: scoped.filter((j) => j.state === "pending").length,
      completed: scoped.filter((j) => j.state === "completed").length,
      failed: scoped.filter((j) => j.state === "failed").length
    };
    const list = scoped.sort((a, b) => {
      const order = { running: 0, pending: 1, failed: 2, completed: 3 };
      return (order[a.state] - order[b.state]) || (b.id - a.id);
    }).slice(0, 18);
    const rows = list.map((j) => `<tr data-goto="#/jobs/${j.id}" data-state="${j.state}" data-text="${j.id} ${j.name} ${j.user} ${j.account} ${j.partition}">
      <td class="select-col"><input type="checkbox" class="row-check job-check" value="${j.id}" aria-label="选择作业 ${j.id}" /></td>
      <td><span class="id-chip">${j.id}</span></td>
      <td class="strong">${j.name}</td>
      <td>${j.user}</td>
      <td><span class="tiny dim">${j.account}</span></td>
      <td><span class="tiny">${j.partition}</span></td>
      <td class="num">${j.gpus} 卡</td>
      <td><span class="tiny dim">${j.qos}</span></td>
      <td>${UI.badge(j.state)}</td>
      <td class="num">${j.state === "pending" ? "等待 " + j.wait + "m" : `<div class="job-dur" title="进度 ${j.progress || 0}%"><span>${DB.dur(j.elapsed)}</span><span class="bar mini"><i style="width:${Math.max(2, Math.min(100, j.progress || 0))}%"></i></span></div>`}</td>
      <td class="actions"><button class="btn btn-sm btn-ghost" data-goto="#/jobs/${j.id}">详情</button>${j.state === "running" ? `<button class="btn btn-sm btn-ghost" data-action="cancel-job" data-id="${j.id}">取消</button>` : ""}</td>
    </tr>`).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "资源与作业 · 作业中心",
        title: "作业中心",
        sub: "查看与管理工作站作业。提交入口在 OOD；这里的取消/重跑会同步到 Slurm 并写入审计。",
        actions: `<button class="btn" data-action="export">${UI.icon("download", 15)}导出</button><button class="btn btn-primary" data-action="submit-job">${UI.icon("plus", 15)}提交作业</button>`
      })}
      <div class="panel" style="padding:14px 16px">
        <div class="toolbar">
          ${UI.chips([
            { key: "all", label: "全部", count: counts.all },
            { key: "running", label: "运行中", count: counts.running },
            { key: "pending", label: "排队中", count: counts.pending },
            { key: "completed", label: "已完成", count: counts.completed },
            { key: "failed", label: "失败", count: counts.failed }
          ], "all", "data-job-state")}
          <div class="grow"></div>
          <div class="field" style="min-width:260px"><input class="input" id="jobSearch" placeholder="搜索作业 ID、名称、用户、账户…" /></div>
          <select class="select" id="jobPartition"><option value="all">全部分区</option>${DB.PARTITIONS.map((p) => `<option value="${p.id}">${p.id}</option>`).join("")}</select>
        </div>
      </div>
      ${UI.panel({
        title: "作业列表",
        tag: `${counts.all} jobs`,
        sub: "按状态排序 · 最近提交优先",
        body: `<div class="bulk-bar" id="jobBulkBar" hidden>
          <span class="bulk-ic">${UI.icon("check-circle", 14)}</span>
          <span>已选择 <b id="jobSelCount">0</b> 个作业</span>
          <div class="grow"></div>
          <button class="btn btn-sm" data-bulk="export">导出</button>
          <button class="btn btn-sm btn-ghost" data-bulk="maintain">加入维护</button>
          <button class="btn btn-sm btn-danger" data-bulk="cancel">取消作业</button>
          <span class="bulk-progress" id="bulkProgress" hidden><i></i></span>
          <button class="icon-btn" id="jobSelClear" aria-label="清除选择">${UI.icon("close", 14)}</button>
        </div><div class="jobs-table">${UI.table([
          { label: `<input type="checkbox" class="row-check" id="jobSelectAll" aria-label="全选当前页" />`, cls: "select-col" },
          { label: "作业 ID" }, { label: "名称" }, { label: "用户" }, { label: "账户" }, { label: "分区" },
          { label: "GPU", cls: "right" }, { label: "QOS" }, { label: "状态" }, { label: "时长/等待", cls: "right" }, { label: "", cls: "right" }
        ], rows)}</div>`
      })}
      <div id="jobEmpty" class="empty" hidden>没有匹配的作业，请调整筛选条件或搜索关键词。</div>
      <div class="pager" id="jobsPager"><span>显示 1-18 / ${counts.all} 个作业</span><span class="pages"><button class="pg active">1</button><button class="pg" data-action="toast">2</button><button class="pg" data-action="toast">3</button><button class="pg" data-action="toast">…</button></span></div>
    </div>`;
  };

  /* ============================ job detail ============================ */
  P.jobDetail = function (id) {
    const me = window.__ME;
    const privileged = !me || (me.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
    const target = DB.jobById(id);
    if (!target) {
      return `<div class="page"><div class="error-state"><div class="es-icon">${UI.icon("alertCircle", 28)}</div><h2>作业不存在</h2><p>该作业可能已被清理，或作业 ID 有误。</p><div class="row gap-8"><button class="btn" data-goto="#/jobs">返回作业中心</button></div></div></div>`;
    }
    if (!privileged && target.user !== me.display_name) {
      return `<div class="page"><div class="error-state"><div class="es-icon">${UI.icon("alertCircle", 28)}</div><h2>无权限查看该作业</h2><p>普通用户只能查看本人作业；如需协助请联系运维。</p><div class="row gap-8"><button class="btn" data-goto="#/jobs">返回我的作业</button></div></div></div>`;
    }
    const j = target;
    const gpus = DB.GPUS.filter((g) => g.jobId === j.id);
    const logs = [
      ["info", `submit: job ${j.id} name=${j.name} partition=${j.partition} gres=gpu:${j.gpus}`],
      ["info", `sbatch accepted by slurmctld, priority=${j.priority} qos=${j.qos}`],
      ["info", "association check passed: account=" + j.account + ", GrpTRES ok"],
      ["info", "prolog: write hpc job mapping -> /var/lib/dcgm-exporter/job"],
      ["info", "launching apptainer --nv image=" + j.image],
      ["info", "step 0 started: python train.py --config configs/run.yaml"],
      ["warn", "data loader: 3 workers restarted, retrying…"],
      ["info", "epoch 12/40 | loss=0.0843 | lr=2.4e-4 | gpu_util=93%"],
      ["info", "checkpoint saved to /scratch/" + j.user + "/ckpt-" + j.id + "-012.pt"],
      ["info", "epoch 13/40 | loss=0.0819 | lr=2.4e-4 | gpu_util=95%"],
      ["info", "prometheus: job gpu metrics exposed with hpc_job=" + j.id],
      ["info", "heartbeat ok · cgroup v2 · CUDA_VISIBLE_DEVICES=" + gpus.slice(0, 2).map((g) => g.index).join(",")]
    ];
    const logHtml = logs.map((l, i) => `<div class="log-line ${l[0] === "warn" ? "warn" : l[0] === "err" ? "err" : ""}" data-level="${l[0]}"><span class="ln">${i + 1}</span><span class="ts">${timeStr(Date.now() - (logs.length - i) * 16000)}</span><span class="lv">${l[0].toUpperCase()}</span><span class="msg">${l[1]}</span></div>`).join("");
    const utilSeries = [{ name: "利用率", color: "#22d3ee", values: P.sparkFor(91, 3) }, { name: "显存", color: "#818cf8", values: P.sparkFor(78, 6) }];
    const timeline = [
      ["提交作业", dateStr(j.submitted)],
      ["调度排队", `${j.wait} 分钟后分配资源`],
      ["开始运行", j.started ? dateStr(j.started) : "—"],
      ["当前状态", j.state === "running" ? `已运行 ${DB.dur(j.elapsed)} · 进度 ${j.progress}%` : UI.statusLabel(j.state)]
    ].map((t) => `<div class="tl-item"><span class="tl-dot"></span><div class="tl-main"><b>${t[0]}</b><div class="tm">${t[1]}</div></div></div>`).join("");

    const gpuRows = gpus.slice(0, 8).map((g) => `<tr><td class="strong mono">${g.uuid}</td><td>${g.node} · GPU ${g.index}</td>
      <td><div class="bar-row"><span class="bar"><i style="width:${g.util}%"></i></span><span class="val">${g.util}%</span></div></td>
      <td><div class="bar-row"><span class="bar violet"><i style="width:${g.memUsed}%"></i></span><span class="val">${g.memUsed}%</span></div></td>
      <td class="num ${g.temp > 75 ? "temp-hot" : ""}">${g.temp}℃</td><td>${UI.badge(g.state)}</td></tr>`).join("");
    const warnN = logs.filter((l) => l[0] === "warn").length;
    const errN = logs.filter((l) => l[0] === "err").length;

    return `<div class="page">
      <div class="row gap-10"><button class="btn btn-sm btn-ghost" data-goto="#/jobs">${UI.icon("chevron", 14)}返回作业列表</button><span class="tiny dim">/ 作业详情</span></div>
      <div class="job-hero" data-state="${j.state}">
        <div class="job-head">
          <div>
            <div class="eyebrow"><span class="dot cyan"></span>资源与作业 · 作业详情</div>
            <div class="job-title">${j.name} <span class="id-chip">#${j.id}</span> ${UI.badge(j.state)}</div>
            <div class="job-meta"><span>${UI.icon("users", 13)} ${j.user}</span><span>·</span><span>${j.account}</span><span>·</span><span>${j.partition}</span><span>·</span><span>QOS ${j.qos}</span><span>·</span><span>提交于 ${dateStr(j.submitted)}</span><span class="id-chip">进度 ${j.progress}%</span></div>
          </div>
          <div class="page-actions">
            ${j.state === "running" ? `<button class="btn btn-danger" data-action="cancel-job" data-id="${j.id}">${UI.icon("x", 15)}取消作业</button>` : ""}
            <button class="btn" data-action="toast">${UI.icon("refresh", 15)}重跑</button>
            <button class="btn btn-ghost" data-action="toast">${UI.icon("terminal", 15)}打开终端</button>
          </div>
        </div>
      </div>

      <div class="job-kpis">
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("gpu", 13)}</span><small>GPU 资源</small></div><b>${j.gpus} <small>卡 · ${j.nodes} 节点</small></b></div>
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("clock", 13)}</span><small>已运行</small></div><b>${DB.dur(j.elapsed)}</b></div>
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("clock", 13)}</span><small>排队等待</small></div><b>${j.wait} <small>分钟</small></b></div>
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("zap", 13)}</span><small>优先级</small></div><b>${j.priority} <small>/ 1000</small></b></div>
      </div>

      <div class="tab-bar">
        <button class="active" data-tab-group="job" data-tab-target="overview">概览</button>
        <button data-tab-group="job" data-tab-target="logs">日志</button>
        <button data-tab-group="job" data-tab-target="gpus">GPU 指标 <span class="dim">${gpus.length}</span></button>
      </div>

      <div data-tab-panel="job" data-panel="overview">
        <div class="grid-12">
          ${UI.panel({ class: "span-8", title: "GPU 利用率", sub: "作业维度 · 来自 dcgm hpc_job 关联", body: C.line({ labels: ["-60m", "-50m", "-40m", "-30m", "-20m", "-10m", "now"], series: utilSeries, height: 210, yMax: 100, unit: "%" }) })}
          ${UI.panel({ class: "span-4", title: "生命周期", body: `<div class="timeline">${timeline}</div><div class="divider" style="margin:14px 0"></div><div class="mini-row"><span class="lbl">效率评分</span><span class="val">92</span></div><div class="mini-row"><span class="lbl">GPU·h 已用</span><span class="val">${(j.gpus * j.elapsed / 3600).toFixed(1)}</span></div>` })}
        </div>
        <div class="grid-12">
          ${UI.panel({ class: "span-4", title: "资源配置", body: UI.kv([["镜像", j.image, "mono"], ["节点数", j.nodes + " 节点"], ["QOS", j.qos], ["分区", j.partition], ["账户", j.account], ["退出码", j.exitCode === null || j.exitCode === undefined ? "—" : String(j.exitCode)]]) })}
          ${UI.panel({ class: "span-4", title: "运行指标", body: `<div class="mini-list"><div class="mini-row"><span class="lbl">GPU 平均利用率</span><span class="val">91.4%</span></div><div class="mini-row"><span class="lbl">显存峰值</span><span class="val">74.2 GB</span></div><div class="mini-row"><span class="lbl">CPU 效率</span><span class="val">68%</span></div><div class="mini-row"><span class="lbl">I/O 读取</span><span class="val">412 GB</span></div></div>` })}
          ${UI.panel({ class: "span-4", title: "关联告警", body: `<div class="feed"><div class="feed-item"><span class="feed-dot" style="background:#fbbf24"></span><div class="feed-main"><div class="feed-title"><b>GPU 温度偏高</b> · gpu-02</div><div class="feed-meta"><span>10 分钟前</span><span>·</span><span>已确认</span></div></div></div><div class="feed-item"><span class="feed-dot" style="background:#60a5fa"></span><div class="feed-main"><div class="feed-title"><b>作业指标采集正常</b></div><div class="feed-meta"><span>DCGM · 15s</span></div></div></div></div>` })}
        </div>
      </div>

      <div data-tab-panel="job" data-panel="logs" hidden>
        ${UI.panel({ title: "作业日志", sub: "最近 200 行 · stdout / stderr 合并", extra: `<span class="tiny dim" style="margin-right:8px">WARN ${warnN} · ERROR ${errN}</span><button class="btn btn-sm btn-ghost" data-action="toast">${UI.icon("download", 13)}下载</button>`, body: `<div class="log-toolbar">${UI.chips([{ key: "all", label: "全部" }, { key: "info", label: "INFO" }, { key: "warn", label: "WARN" }, { key: "err", label: "ERROR" }], "all", "data-log-filter")}<div class="grow"></div><span class="tiny dim">仅展示最近 200 行</span></div><div class="log-view">${logHtml}</div>` })}
      </div>

      <div data-tab-panel="job" data-panel="gpus" hidden>
        ${UI.panel({ title: "GPU 明细", sub: "本作业占用的 GPU", body: UI.table([{ label: "UUID" }, { label: "节点 / 序号" }, { label: "利用率" }, { label: "显存" }, { label: "温度", cls: "right" }, { label: "状态" }], gpuRows) })}
        ${UI.panel({ title: "GPU 利用率对比", sub: "按卡维度", body: C.line({ labels: ["-60m", "-50m", "-40m", "-30m", "-20m", "-10m", "now"], series: utilSeries, height: 200, yMax: 100, unit: "%" }) })}
      </div>
    </div>`;
  };

  /* ============================ catalog ============================ */
  P.catalog = function () {
    const cards = DB.PARTITION_STATS.map((p) => {
      const pct = Math.round((p.used / p.total) * 100);
      const stat = C.ring(pct, { size: 58, color: p.color });
      return `<article class="part-card" style="--accent:${p.color}">
        <div class="pc-head">
          <div class="part-ring">${stat}<span class="ring-val">${pct}%</span></div>
          <div style="flex:1"><div class="pc-name">${p.name} ${p.id === "gpu-h100" ? `<span class="badge cyan" style="height:18px;font-size:9px">推荐</span>` : ""}</div><div class="pc-desc">${p.desc}</div></div>
          <span class="badge ${p.priority === "极高" ? "red" : p.priority === "高" ? "amber" : "cyan"}">优先级 ${p.priority}</span>
        </div>
        <div class="pc-stats">
          <div><small>可用 GPU</small><b>${p.total - p.used} <span class="tiny dim">/ ${p.total}</span></b></div>
          <div><small>占用率</small><b>${pct}%</b></div>
          <div><small>排队 P95</small><b>${p.queueP95} <span class="tiny dim">min</span></b></div>
        </div>
        <div class="pc-avail"><span class="bar"><i style="width:${pct}%;background:linear-gradient(90deg,${p.color},#818cf8)"></i></span><span>可用 ${p.total - p.used} 卡</span></div>
        <div class="row between">
          <span class="tiny dim">${p.model} · 自用集群</span>
          <button class="btn btn-sm btn-primary" data-action="submit-job">申请资源 ${UI.icon("chevron", 13)}</button>
        </div>
      </article>`;
    }).join("");

    const models = Object.keys(DB.MODELS).map((m) => {
      const s = DB.MODELS[m];
      const rec = m === "H100 80G";
      return `<article class="model-card ${rec ? "recommend" : ""}">
        ${rec ? `<span class="mc-rec">推荐</span>` : ""}
        <div class="mc-top"><span class="row gap-8"><span class="mc-ic">${UI.icon("gpu", 15)}</span><span class="mc-name">${m}</span></span><span class="badge cyan">${s.arch}</span></div>
        <div class="mc-spec">
          <div>显存 <b>${s.mem} GB</b></div><div>TDP <b>${s.tdp} W</b></div>
          <div>NVLink <b>${s.nvlink}</b></div><div>架构 <b>${s.arch}</b></div>
        </div>
        <button class="btn btn-sm ${rec ? "btn-primary" : ""}" data-action="submit-job">按型号申请</button>
      </article>`;
    }).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "资源与作业 · 资源目录",
        title: "资源目录",
        sub: "按分区与 GPU 型号查看可用资源、排队情况。两台 GPU 服务器为内部自用集群。",
        actions: `<button class="btn btn-ghost" data-action="toast">${UI.icon("info", 15)}资源说明</button>`
      })}
      <div class="catalog-grid">${cards}</div>

      <div class="grid-12">
        ${UI.panel({ class: "span-8", title: "GPU 型号规格", sub: "自用集群", body: `<div class="model-grid">${models}</div>` })}
        ${UI.panel({ class: "span-4", title: "集群资源", sub: "两台服务器 · 全部自用", body: `
          <div class="mini-list">
            <div class="mini-row"><span class="lbl">GPU 总数</span><span class="val">${DB.TOTALS.gpus} 卡</span></div>
            <div class="mini-row"><span class="lbl">已分配</span><span class="val">${DB.TOTALS.allocated} 卡</span></div>
            <div class="mini-row"><span class="lbl">空闲</span><span class="val">${DB.TOTALS.idle} 卡</span></div>
            <div class="mini-row"><span class="lbl">故障</span><span class="val">${DB.TOTALS.error} 卡</span></div>
            <div class="mini-row"><span class="lbl">服务器</span><span class="val">gpu-01 / gpu-02</span></div>
          </div>
          <div class="divider" style="margin:14px 0"></div>
          <div class="callout">${UI.icon("info", 15)}<span>集群为内部自用，资源申请仅受 Slurm 队列与硬件容量约束。</span></div>`
        })}
      </div>

      ${UI.panel({
        title: "快速提交",
        sub: "表单提交到 OOD / Slurm；实际队列、镜像与限额以 Slurm 校验为准",
        extra: `<span class="badge cyan">自用集群 · 资源预估</span>`,
        body: `<form id="submitForm" class="submit-layout" autocomplete="off">
          <div class="submit-fields">
            <div class="form-grid">
              <div class="field"><label>作业名称</label><input class="input" name="name" value="llama3-70b-sft" /></div>
              <div class="field"><label>分区</label><select class="select" name="partition" id="submitPartition">${DB.PARTITIONS.map((p) => `<option value="${p.id}">${p.id} · ${p.model}</option>`).join("")}</select></div>
              <div class="field"><label>GPU 数量 <output id="gpuOut">1 卡</output></label>
                <input class="range" type="range" min="1" max="8" step="1" value="1" name="gpus" id="gpuRange" />
                <div class="row gap-6 wrap" style="margin-top:8px">${[1, 2, 4, 8].map((n) => `<button type="button" class="chip ${n === 1 ? "active" : ""}" data-gpu-preset="${n}">${n} 卡</button>`).join("")}</div>
              </div>
              <div class="field"><label>最长运行时长</label><select class="select" name="time" id="submitTime">${["1h", "4h", "12h", "24h", "72h"].map((t) => `<option value="${t}">${t}</option>`).join("")}</select></div>
              <div class="field" style="grid-column:1/-1"><label>容器镜像</label><input class="input" name="image" value="registry.example.com/hpc/pytorch:2.4-cu124" /></div>
            </div>
            <div class="form-hint">提交后将生成 Slurm 作业并以当前 LDAP 身份运行；所有资源申请写入审计。</div>
          </div>
          <aside class="submit-estimate">
            <div class="se-head"><span class="se-label">预估资源</span><span class="badge cyan">实时计算</span></div>
            <div class="se-cost"><b id="estHoursBig">1</b><span class="se-cur" style="font-size:14px;margin-top:8px">GPU·h</span></div>
            <div class="se-sub">自用集群资源预估</div>
            <div class="se-rows">
              <div><span>预计 GPU·h</span><b id="estHours">1</b></div>
              <div><span>预计排队</span><b id="estQueue">34 min</b></div>
              <div><span>GPU 数量</span><b id="estGpuCount">1 卡</b></div>
            </div>
            <div class="se-quota"><div class="between tiny dim"><span>提交后资源由 Slurm 队列分配</span><span>自用集群</span></div></div>
            <div class="submit-actions"><button type="button" class="btn" data-action="toast">保存为模板</button><button type="submit" class="btn btn-primary">${UI.icon("play", 15)}提交作业</button></div>
          </aside>
        </form>`
      })}
    </div>`;
  };
})();
