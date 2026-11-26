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
    const roles = (me && me.roles) || [];
    const privileged = !me || roles.some((r) => ["admin", "ops", "auditor"].includes(r));
    const canOperate = !me || roles.some((r) => ["admin", "ops"].includes(r));
    const scoped = privileged ? DB.JOBS.slice() : DB.JOBS.filter((j) => j.username === (me && me.username));
    const canCancel = (j) => canOperate || (me && (j.username === me.username || j.user === me.display_name));
    const counts = {
      all: scoped.length,
      running: scoped.filter((j) => j.state === "running").length,
      pending: scoped.filter((j) => j.state === "pending").length,
      completed: scoped.filter((j) => j.state === "completed").length,
      failed: scoped.filter((j) => j.state === "failed").length,
      cancelled: scoped.filter((j) => j.state === "cancelled").length
    };
    const jobsLimit = Math.max(18, Number(window.__JOBS_LIMIT) || 18);
    const list = scoped.sort((a, b) => {
      const order = { running: 0, pending: 1, failed: 2, completed: 3 };
      return (order[a.state] - order[b.state]) || (b.id - a.id);
    }).slice(0, jobsLimit);
    const rows = list.map((j) => `<tr data-goto="#/jobs/${j.id}" data-state="${j.state}" data-partition="${j.partition}" data-text="${j.id} ${UI.esc(j.name)} ${UI.esc(j.user)} ${UI.esc(j.account)} ${UI.esc(j.partition)}">
      <td class="select-col"><input type="checkbox" class="row-check job-check" value="${j.id}" aria-label="选择作业 ${j.id}" /></td>
      <td><span class="id-chip">${j.id}</span></td>
      <td class="strong">${UI.esc(j.name)}</td>
      <td>${UI.esc(j.user)}</td>
      <td><span class="tiny dim">${UI.esc(j.account)}</span></td>
      <td><span class="tiny">${UI.esc(j.partition)}</span></td>
      <td class="num">${j.gpus} 卡</td>
      <td><span class="tiny dim">${UI.esc(j.qos)}</span></td>
      <td>${UI.badge(j.state)}</td>
      <td class="num">${j.state === "pending" ? "等待 " + (j.submitted ? j.wait + "m" : "—") : `<div class="job-dur" title="时长进度 ${j.progress || 0}%"><span>${DB.dur(j.elapsed)}</span><span class="bar mini"><i style="width:${Math.max(2, Math.min(100, j.progress || 0))}%"></i></span></div>`}</td>
      <td class="actions"><button class="btn btn-sm btn-ghost" data-goto="#/jobs/${j.id}">详情</button>${["running", "pending"].includes(j.state) && canCancel(j) ? `<button class="btn btn-sm btn-ghost" data-action="cancel-job" data-id="${j.id}">取消</button>` : ""}</td>
    </tr>`).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "资源与作业 · 作业中心",
        title: "作业中心",
        sub: "作业数据来自 Slurm scontrol；OOD 终端可通过统一入口打开。",
        actions: `<button class="btn" data-action="export">${UI.icon("download", 15)}导出</button><button class="btn btn-primary" data-action="submit-job">${UI.icon("plus", 15)}提交作业</button>`
      })}
      ${window.__DATA_OK && window.__DATA_OK.jobs === false ? `<div class="callout" style="margin-bottom:12px;border-color:var(--red)">${UI.icon("alert", 15)}<span>作业接口加载失败，当前列表不代表真实作业状态，请稍后重试。</span></div>` : ""}
      <div class="panel" style="padding:14px 16px">
        <div class="toolbar">
          ${UI.chips([
            { key: "all", label: "全部", count: counts.all },
            { key: "running", label: "运行中", count: counts.running },
            { key: "pending", label: "排队中", count: counts.pending },
            { key: "completed", label: "已完成", count: counts.completed },
            { key: "failed", label: "失败", count: counts.failed },
            { key: "cancelled", label: "已取消", count: counts.cancelled }
          ], "all", "data-job-state")}
          <div class="grow"></div>
          <div class="field" style="min-width:260px"><input class="input" id="jobSearch" placeholder="搜索作业 ID、名称、用户、账户…" /></div>
          <select class="select" id="jobPartition"><option value="all">全部分区</option>${DB.PARTITIONS.map((p) => `<option value="${p.id}">${p.id}</option>`).join("")}</select>
        </div>
      </div>
      ${UI.panel({
        title: "作业列表",
        tag: `${counts.all} 个作业`,
        sub: "按状态排序 · 最近提交优先",
        body: `<div class="bulk-bar" id="jobBulkBar" hidden>
          <span class="bulk-ic">${UI.icon("check-circle", 14)}</span>
          <span>已选择 <b id="jobSelCount">0</b> 个作业</span>
          <div class="grow"></div>
          <button class="btn btn-sm" data-bulk="export">导出</button>
          ${canOperate ? `<button class="btn btn-sm btn-danger" data-bulk="cancel">取消作业</button>` : ""}
          <span class="bulk-progress" id="bulkProgress" hidden><i></i></span>
          <button class="icon-btn" id="jobSelClear" aria-label="清除选择">${UI.icon("close", 14)}</button>
        </div><div class="jobs-table">${UI.table([
          { label: `<input type="checkbox" class="row-check" id="jobSelectAll" aria-label="全选当前页" />`, cls: "select-col" },
          { label: "作业 ID" }, { label: "名称" }, { label: "用户" }, { label: "账户" }, { label: "分区" },
          { label: "GPU", cls: "right" }, { label: "QOS" }, { label: "状态" }, { label: "时长/等待", cls: "right" }, { label: "", cls: "right" }
        ], rows)}</div>`
      })}
      <div id="jobEmpty" class="empty" ${counts.all ? "hidden" : ""}>${counts.all ? "没有匹配的作业，请调整筛选条件或搜索关键词。" : "暂无作业。提交第一个 Slurm 作业后，这里会显示真实状态和日志。"}</div>
      <div class="pager" id="jobsPager"><span>${counts.all ? `显示 1-${Math.min(list.length, jobsLimit)} / ${counts.all} 个作业` : "暂无作业"}</span><span class="pages"><button class="pg active">1</button>${counts.all > jobsLimit ? `<button class="pg" data-action="jobs-more">加载更多</button>` : ""}</span></div>
    </div>`;
  };

  /* ============================ job detail ============================ */
  P.jobDetail = function (id) {
    const me = window.__ME;
    const roles = (me && me.roles) || [];
    const privileged = !me || roles.some((r) => ["admin", "ops", "auditor"].includes(r));
    const canOperate = !me || roles.some((r) => ["admin", "ops"].includes(r));
    const target = DB.jobById(id);
    if (!target) {
      return `<div class="page"><div class="error-state"><div class="es-icon">${UI.icon("alertCircle", 28)}</div><h2>作业不存在</h2><p>该作业可能已被清理，或作业 ID 有误。</p><div class="row gap-8"><button class="btn" data-goto="#/jobs">返回作业中心</button></div></div></div>`;
    }
    if (!privileged && target.username !== (me && me.username)) {
      return `<div class="page"><div class="error-state"><div class="es-icon">${UI.icon("alertCircle", 28)}</div><h2>无权限查看该作业</h2><p>普通用户只能查看本人作业；如需协助请联系运维。</p><div class="row gap-8"><button class="btn" data-goto="#/jobs">返回我的作业</button></div></div></div>`;
    }
    const j = target;
    let retryConfig = null;
    try {
      const history = JSON.parse(localStorage.getItem("hpc-job-history") || "[]");
      retryConfig = (Array.isArray(history) ? history : []).find((item) =>
        item && (item.name === j.name || (j.name && item.name && j.name.startsWith(item.name))));
    } catch (e) { retryConfig = null; }
    const gpus = DB.GPUS.filter((g) => g.jobId === j.id);
    const realLogs = Array.isArray(j.logTail) ? j.logTail : [];
    const logs = realLogs.map((line) => {
      const text = String(line);
      const level = /\b(ERROR|FAIL|FATAL)\b/i.test(text) ? "err" : /\bWARN(ING)?\b/i.test(text) ? "warn" : "info";
      return [level, text];
    });
    const logHtml = logs.length
      ? logs.map((l, i) => `<div class="log-line ${l[0] === "warn" ? "warn" : l[0] === "err" ? "err" : ""}" data-level="${l[0]}"><span class="ln">${i + 1}</span><span class="ts">job-${UI.esc(String(j.id))}</span><span class="lv">${l[0].toUpperCase()}</span><span class="msg">${UI.esc(l[1])}</span></div>`).join("")
      : `<div class="empty" style="padding:18px">暂无日志输出（作业尚未运行，或 Slurm 日志文件不可读）</div>`;
    const timeline = [
      ["提交作业", j.submitted ? dateStr(j.submitted) : "未提供"],
      ["调度排队", j.submitted ? `${j.wait} 分钟后分配资源` : "未提供"],
      ["开始运行", j.started ? dateStr(j.started) : "—"],
      ["当前状态", j.state === "running" ? `已运行 ${DB.dur(j.elapsed)} · 时长进度 ${j.progress}%` : UI.statusLabel(j.state)]
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
            <div class="job-title">${UI.esc(j.name)} <span class="id-chip">#${j.id}</span> ${UI.badge(j.state)}</div>
            <div class="job-meta"><span>${UI.icon("users", 13)} ${UI.esc(j.user)}</span><span>·</span><span>${UI.esc(j.account)}</span><span>·</span><span>${UI.esc(j.partition)}</span><span>·</span><span>QOS ${UI.esc(j.qos)}</span><span>·</span><span>提交于 ${j.submitted ? dateStr(j.submitted) : "未提供"}</span><span class="id-chip">时长进度 ${j.progress}%</span></div>
          </div>
          <div class="page-actions">
            ${["running", "pending"].includes(j.state) && (canOperate || (me && j.username === me.username)) ? `<button class="btn btn-danger" data-action="cancel-job" data-id="${j.id}">${UI.icon("x", 15)}取消作业</button>` : ""}
            <button class="btn" data-action="retry-job" data-name="${UI.esc(j.name)}" ${retryConfig ? "" : "disabled"} title="${retryConfig ? "载入本次作业的提交参数并返回表单" : "当前浏览器没有该作业的提交参数"}">${UI.icon("refresh", 15)}重跑</button>
            <a class="btn btn-ghost" href="http://${window.__OOD_HOST || "192.168.112.230"}/" target="_blank" rel="noopener" title="${window.__ACTIVE_CLUSTER && window.__ACTIVE_CLUSTER.oodHost ? "打开中心 A 集群 OOD 终端/门户（首次需单独 FreeIPA 登录）" : "打开 OOD 终端/门户（首次需单独 FreeIPA 登录）"}">${UI.icon("terminal", 15)}打开终端</a>
          </div>
        </div>
      </div>

      <div class="job-kpis">
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("gpu", 13)}</span><small>GPU 资源</small></div><b>${j.gpus} <small>卡 · ${j.nodes} 节点</small></b></div>
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("clock", 13)}</span><small>已运行</small></div><b>${j.state === "pending" ? "—" : DB.dur(j.elapsed)}</b></div>
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("clock", 13)}</span><small>排队等待</small></div><b>${j.submitted ? j.wait + " <small>分钟</small>" : "—"}</b></div>
        <div class="job-kpi"><div class="jk-top"><span class="jk-ic">${UI.icon("zap", 13)}</span><small>优先级</small></div><b>${j.priority === null ? "—" : j.priority}</b></div>
      </div>

      <div class="tab-bar">
        <button class="active" data-tab-group="job" data-tab-target="overview">概览</button>
        <button data-tab-group="job" data-tab-target="logs">日志</button>
        <button data-tab-group="job" data-tab-target="gpus">GPU 指标 <span class="dim">${gpus.length}</span></button>
      </div>

      <div data-tab-panel="job" data-panel="overview">
        <div class="grid-12">
          ${UI.panel({ class: "span-8", title: "GPU 利用率", sub: j.state === "running" ? "作业维度 · 来自 DCGM 作业关联" : "作业尚未运行，暂无 GPU 指标", body: Charts.empty("作业级 GPU 历史指标未接入（当前仅展示实时 GPU 状态）") })}
          ${UI.panel({ class: "span-4", title: "生命周期", body: `<div class="timeline">${timeline}</div><div class="divider" style="margin:14px 0"></div><div class="mini-row"><span class="lbl">效率评分</span><span class="val">—</span></div><div class="mini-row"><span class="lbl">GPU·h 已用</span><span class="val">—</span></div>` })}
        </div>
        <div class="grid-12">
          ${UI.panel({ class: "span-4", title: "资源配置", body: UI.kv([["镜像", UI.esc(j.image) || "未提供", "mono"], ["节点数", j.nodes + " 节点"], ["QOS", UI.esc(j.qos)], ["分区", UI.esc(j.partition)], ["账户", UI.esc(j.account)], ["退出码", j.exitCode === null || j.exitCode === undefined ? "—" : String(j.exitCode)]]) })}
          ${UI.panel({ class: "span-4", title: "运行指标", body: `<div class="mini-list"><div class="mini-row"><span class="lbl">GPU 平均利用率</span><span class="val">GPU agent / DCGM</span></div><div class="mini-row"><span class="lbl">显存峰值</span><span class="val">GPU agent / DCGM</span></div><div class="mini-row"><span class="lbl">CPU 效率</span><span class="val">未采集</span></div><div class="mini-row"><span class="lbl">I/O 读取</span><span class="val">未采集</span></div></div>` })}
          ${UI.panel({ class: "span-4", title: "关联告警", body: `<div class="mini-list"><div class="mini-row"><span class="lbl">当前作业暂无关联告警</span><span class="val">—</span></div><div class="mini-row"><span class="lbl">告警数据源</span><span class="val">Alertmanager 已接入</span></div></div>` })}
        </div>
      </div>

      <div data-tab-panel="job" data-panel="logs" hidden>
        ${UI.panel({ title: "作业日志", sub: "最近 200 行 · stdout / stderr 合并", extra: `<span class="tiny dim" style="margin-right:8px">WARN ${warnN} · ERROR ${errN}</span><button class="btn btn-sm btn-ghost" data-action="download-job-log">${UI.icon("download", 13)}下载</button>`, body: `<div class="log-toolbar">${UI.chips([{ key: "all", label: "全部" }, { key: "info", label: "INFO" }, { key: "warn", label: "WARN" }, { key: "err", label: "ERROR" }], "all", "data-log-filter")}<div class="grow"></div><span class="tiny dim">仅展示最近 200 行</span></div><div class="log-view">${logHtml}</div>` })}
      </div>

      <div data-tab-panel="job" data-panel="gpus" hidden>
        ${UI.panel({ title: "GPU 明细", sub: "本作业占用的 GPU", body: UI.table([{ label: "UUID" }, { label: "节点 / 序号" }, { label: "利用率" }, { label: "显存" }, { label: "温度", cls: "right" }, { label: "状态" }], gpuRows) })}
        ${UI.panel({ title: "GPU 利用率对比", sub: "按卡维度", body: Charts.empty("作业级历史利用率未接入；请查看 GPU 监控实时指标") })}
      </div>
    </div>`;
  };

  /* ============================ catalog ============================ */
  P.catalog = function () {
    const gpuEmpty = window.__GPU_EMPTY === true;
    const cards = DB.PARTITION_STATS.map((p) => {
      const pct = p.total ? Math.round((p.used / p.total) * 100) : 0;
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
          <div><small>排队作业</small><b>${DB.JOBS.filter((j) => j.state === "pending" && j.partition === p.id).length} <span class="tiny dim">个</span></b></div>
        </div>
        <div class="pc-avail"><span class="bar"><i style="width:${pct}%;background:linear-gradient(90deg,${p.color},#818cf8)"></i></span><span>可用 ${p.total - p.used} 卡</span></div>
        <div class="row between">
          <span class="tiny dim">${p.model} · 自用集群</span>
          <button class="btn btn-sm btn-primary" data-action="submit-job" data-partition="${p.id}">使用该分区 ${UI.icon("chevron", 13)}</button>
        </div>
      </article>`;
    }).join("");

    const models = Object.keys(DB.MODELS).map((m) => {
      const s = DB.MODELS[m];
      const rec = m === DB.GPU_MODEL;
      return `<article class="model-card ${rec ? "recommend" : ""}">
        ${rec ? `<span class="mc-rec">推荐</span>` : ""}
        <div class="mc-top"><span class="row gap-8"><span class="mc-ic">${UI.icon("gpu", 15)}</span><span class="mc-name">${m}</span></span><span class="badge cyan">${s.arch}</span></div>
        <div class="mc-spec">
          <div>显存 <b>${s.mem} GB</b></div><div>TDP <b>${s.tdp} W</b></div>
          <div>互联 <b>${s.interconnect || "—"}</b></div><div>架构 <b>${s.arch}</b></div>
        </div>
        <button class="btn btn-sm ${rec ? "btn-primary" : ""}" data-action="submit-job">去提交作业</button>
      </article>`;
    }).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "资源与作业 · 资源目录",
        title: "资源目录",
        sub: gpuEmpty ? "GPU Agent 尚未上报，当前分区容量与排队数据不可确认；仍可提交，资源由 Slurm 校验。" : "按分区与 GPU 型号查看可用资源、排队情况。单台 GPU 服务器为内部自用集群。",
        actions: `<button class="btn btn-ghost" data-action="resource-info">${UI.icon("info", 15)}资源说明</button>`
      })}
      ${gpuEmpty ? `<div class="callout" style="margin-bottom:12px;border-color:var(--amber)">${UI.icon("alert", 15)}<span>GPU Agent 尚未上报指标，下方 0 卡与 0% 不代表真实容量；提交仍会由 Slurm 实际校验。</span></div>` : ""}
      <div class="catalog-grid">${cards}</div>

      <div class="grid-12">
        ${UI.panel({ class: "span-8", title: "GPU 型号规格", sub: "自用集群", body: `<div class="model-grid">${models}</div>` })}
        ${UI.panel({ class: "span-4", title: "集群资源", sub: "单台 GPU 服务器 · 全部自用", body: `
          <div class="mini-list">
            <div class="mini-row"><span class="lbl">GPU 总数</span><span class="val">${gpuEmpty ? "GPU Agent 未上报" : DB.TOTALS.gpus + " 卡"}</span></div>
            <div class="mini-row"><span class="lbl">已分配</span><span class="val">${gpuEmpty ? "—" : DB.TOTALS.allocated + " 卡"}</span></div>
            <div class="mini-row"><span class="lbl">空闲</span><span class="val">${gpuEmpty ? "—" : DB.TOTALS.idle + " 卡"}</span></div>
            <div class="mini-row"><span class="lbl">故障</span><span class="val">${gpuEmpty ? "—" : DB.TOTALS.error + " 卡"}</span></div>
            <div class="mini-row"><span class="lbl">服务器</span><span class="val">${DB.NODES.map((n) => n.name).join(" / ")}</span></div>
          </div>
          <div class="divider" style="margin:14px 0"></div>
          <div class="callout">${UI.icon("info", 15)}<span>集群为内部自用，资源申请仅受 Slurm 队列与硬件容量约束。</span></div>`
        })}
      </div>

      ${UI.panel({
        title: "快速提交",
        sub: "表单通过后端命令通道提交到 Slurm；实际队列、分区与配额以 Slurm 校验为准",
        extra: `<span class="badge cyan">自用集群 · 资源预估</span>`,
        body: `<form id="submitForm" class="submit-layout" autocomplete="off">
          <div class="submit-fields">
            <div class="form-grid">
              <div class="field"><label>作业名称</label><input class="input" name="name" placeholder="例如：llama3-finetune" required /></div>
              <div class="field"><label>分区</label><select class="select" name="partition" id="submitPartition">${DB.PARTITIONS.map((p) => `<option value="${p.id}">${p.id} · ${p.model}</option>`).join("")}</select></div>
              <div class="field"><label>GPU 数量 <output id="gpuOut">1 卡</output></label>
                <input class="range" type="range" min="1" max="8" step="1" value="1" name="gpus" id="gpuRange" />
                <div class="row gap-6 wrap" style="margin-top:8px">${[1, 2, 4, 8].map((n) => `<button type="button" class="chip ${n === 1 ? "active" : ""}" data-gpu-preset="${n}">${n} 卡</button>`).join("")}</div>
              </div>
              <div class="field"><label>最长运行时长</label><select class="select" name="time" id="submitTime">${["1h", "4h", "12h", "24h", "72h"].map((t) => `<option value="${t}">${t}</option>`).join("")}</select></div>
              <div class="field" style="grid-column:1/-1"><label>镜像（仅记录）</label><input class="input" name="image" placeholder="例如：registry.example.com/hpc/pytorch:2.4-cu124" /><div class="form-hint" style="margin-top:6px">当前作业命令直接在 GPU 节点执行；镜像字段仅作为作业元数据记录。</div></div>
              <div class="field" style="grid-column:1/-1"><label>运行命令</label><textarea class="input" name="command" rows="3" placeholder="例如：python train.py --epochs 10" required></textarea></div>
            </div>
            <div class="form-hint">提交后将生成 Slurm 作业并以当前 LDAP 身份运行；所有资源申请写入审计。</div>
          </div>
          <aside class="submit-estimate">
            <div class="se-head"><span class="se-label">预估资源</span><span class="badge cyan">实时计算</span></div>
            <div class="se-cost"><b id="estHoursBig">1</b><span class="se-cur" style="font-size:14px;margin-top:8px">GPU·h</span></div>
            <div class="se-sub">自用集群资源预估</div>
            <div class="se-rows">
              <div><span>预计 GPU·h</span><b id="estHours">1</b></div>
              <div><span>预计排队</span><b id="estQueue">未采集</b></div>
              <div><span>GPU 数量</span><b id="estGpuCount">1 卡</b></div>
            </div>
            <div class="se-quota"><div class="between tiny dim"><span>提交后资源由 Slurm 队列分配</span><span>自用集群</span></div></div>
            <div class="submit-actions"><button type="button" class="btn" data-action="save-template">保存为模板</button><button type="submit" class="btn btn-primary">${UI.icon("play", 15)}提交作业</button></div>
          </aside>
        </form>`
      })}
    </div>`;
  };
})();















