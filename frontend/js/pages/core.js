/* =========================================================
   Pages: dashboard / cluster monitor / GPU fleet
   ========================================================= */
(function () {
  const P = (window.Pages = window.Pages || {});
  const UI = window.UI, C = window.Charts, DB = window.DB;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  function currentUser() {
    return window.__ME || null;
  }
  function isPrivileged(me) {
    return !me || (me.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
  }

  function nodeColor(n) {
    if (n.state === "degraded") return "rgba(248,113,113,.72)";
    if (n.state === "drain") return "rgba(251,191,36,.62)";
    const u = Math.max(0, Math.min(1, n.util / 100));
    return `rgba(34,211,238,${(0.14 + u * 0.66).toFixed(2)})`;
  }
  function heatCells(nodes) {
    return nodes.map((n) => `<span class="heat-cell" style="background:${nodeColor(n)}" title="${n.name} · ${n.partition} · 利用率 ${n.util}% · 状态 ${UI.statusLabel(n.state)}"></span>`).join("");
  }

  /* 普通用户/ PI 的个人工作台：不展示全局 GPU、节点、他人作业与告警。 */
  function personalDashboard(me) {
    const name = esc((me && me.display_name) || "用户");
    const myJobs = DB.JOBS.filter((j) => j.username === (me && me.username));
    const running = myJobs.filter((j) => j.state === "running");
    const pending = myJobs.filter((j) => j.state === "pending");
    // 后端 scope=self 已只返回本人账户数据；这里用全部返回账户汇总，
    // 不再按 LDAP 组名精确匹配（作业账户可能是 platform）。
    const myAccounts = DB.ACCOUNTS || [];
    const account = myAccounts[0] || null;
    const myUsage = myAccounts.reduce((sum, a) => sum + Number(a.usage || 0), 0);
    const jobsOk = !(window.__DATA_OK && window.__DATA_OK.jobs === false);
    const usageOk = !(window.__DATA_OK && window.__DATA_OK.usage === false);
    const rows = myJobs.slice(0, 8).map((j) => `<tr data-goto="#/jobs/${j.id}">
      <td><span class="id-chip">${j.id}</span></td><td class="strong">${esc(j.name)}</td>
      <td class="num">${j.gpus} 卡</td><td>${UI.badge(j.state)}</td>
      <td class="num">${j.state === "pending" ? j.wait + "m" : DB.dur(j.elapsed)}</td>
    </tr>`).join("");
    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "我的工作台",
        title: `下午好，${name}`,
        sub: "这里只展示你本人的作业、账号与资源使用；集群监控与告警需运维/管理员权限。",
        actions: `<button class="btn btn-ghost" data-goto="#/jobs">${UI.icon("jobs", 15)}我的作业</button><button class="btn btn-primary" data-goto="#/catalog">${UI.icon("plus", 15)}提交作业</button>`
      })}
      ${!jobsOk ? `<div class="callout" style="margin-bottom:12px;border-color:var(--red)">${UI.icon("alert", 15)}<span>我的作业接口加载失败，当前 0 个作业不代表真实状态，请稍后重试。</span></div>` : ""}
      ${!usageOk ? `<div class="callout" style="margin-bottom:12px;border-color:var(--amber)">${UI.icon("alert", 15)}<span>我的用量接口加载失败，当前 GPU·h 无法确认。</span></div>` : ""}
      <div class="kpi-grid cols-4">
        ${UI.kpi({ label: "我的运行作业", count: running.length, unit: "个", icon: "play", tone: "green", delta: "", dir: "flat", foot: "仅本人作业" })}
        ${UI.kpi({ label: "我的排队作业", count: pending.length, unit: "个", icon: "clock", tone: "amber", delta: "", dir: "flat", foot: "等待 Slurm 调度" })}
        ${UI.kpi({ label: "近 30 天 GPU·h", value: usageOk ? DB.fmt(myUsage) : "—", unit: "", icon: "usage", tone: "cyan", delta: "", dir: "flat", foot: usageOk ? (account ? esc(account.name) : "个人用量") : "用量数据不可用" })}
        ${UI.kpi({ label: "我的账号", value: esc(me && me.username || "—"), unit: "", icon: "users", tone: "violet", delta: "", dir: "flat", foot: esc((me && me.role_label) || "普通用户") })}
      </div>
      <div class="grid-12">
        ${UI.panel({
          class: "span-8",
          title: "我的作业",
          tag: `${myJobs.length} 个`,
          sub: "仅本人数据 · 取消/日志操作在作业详情",
          extra: `<button class="btn btn-sm btn-ghost" data-goto="#/jobs">全部 ${UI.icon("chevron", 13)}</button>`,
          body: myJobs.length ? UI.table([{ label: "作业 ID" }, { label: "名称" }, { label: "GPU", cls: "right" }, { label: "状态" }, { label: "时长/等待", cls: "right" }], rows) : `<div class="empty">${jobsOk ? "暂无作业，去资源目录提交第一份作业。" : "作业数据加载失败，当前列表为空不代表没有作业，请稍后重试。"}</div>`
        })}
        ${UI.panel({
          class: "span-4",
          title: "我的账号",
          sub: "身份与资源使用",
          body: `<div class="mini-list">
            <div class="mini-row"><span class="lbl">登录用户</span><span class="val">${esc(me && me.username || "—")}</span></div>
            <div class="mini-row"><span class="lbl">显示名</span><span class="val">${name}</span></div>
            <div class="mini-row"><span class="lbl">角色</span><span class="val">${esc((me && me.role_label) || "普通用户")}</span></div>
            <div class="mini-row"><span class="lbl">Slurm 账户</span><span class="val">${esc((me && me.account) || "—")}</span></div>
            <div class="mini-row"><span class="lbl">近 30 天 GPU·h</span><span class="val">${usageOk ? DB.fmt(myUsage) : "—"}</span></div>
          </div>
          <div class="divider" style="margin:14px 0"></div>
          <div class="callout">${UI.icon("info", 15)}<span>集群为内部自用。全局 GPU/节点视图仅对运维与管理员开放，普通账号只看到本人作业。</span></div>`
        })}
      </div>
    </div>`;
  }

  /* ============================ unified entrance ============================ */
  function entryCard(opts) {
    const external = !!opts.external;
    return `<a class="entry-card${opts.primary ? " primary" : ""}" href="${esc(opts.href)}"${external ? ' target="_blank" rel="noopener"' : ""}>
      <span class="entry-icon tone-${esc(opts.tone || "cyan")}">${UI.icon(opts.icon, 22)}</span>
      <span class="entry-body"><b>${esc(opts.title)}</b><small>${esc(opts.sub)}</small></span>
      <span class="entry-foot"><span>${esc(opts.meta || "")}</span>${UI.icon(external ? "external" : "chevron", 15)}</span>
    </a>`;
  }

  P.entrance = function () {
    const me = currentUser();
    const roleList = (me && me.roles) || [];
    const isAdmin = !!(me && (me.primary_role === "admin" || roleList.includes("admin")));
    const isOps = isAdmin || !!(me && (me.primary_role === "ops" || roleList.includes("ops")));
    const name = esc((me && (me.display_name || me.username)) || "用户");
    const cards = [
      entryCard({
        href: "#/dashboard", icon: "dashboard", tone: "cyan", primary: true,
        title: "算力运维平台", sub: "作业、资源、GPU、告警、用量与审计",
        meta: "当前平台"
      }),
      entryCard({
        href: `http://${window.__OOD_HOST || "192.168.112.230"}/`, icon: "terminal", tone: "blue", external: true,
        title: "OOD 终端与门户", sub: "Shell、文件管理、交互式应用",
        meta: (window.__ACTIVE_CLUSTER && window.__ACTIVE_CLUSTER.oodHost) ? "中心 A 集群" : "Open OnDemand"
      })
    ];
    if (isOps) {
      cards.push(entryCard({
        href: `http://${window.__OBS_HOST || "192.168.112.230"}:9090/`, icon: "activity", tone: "cyan", external: true,
        title: "Prometheus 监控", sub: "GPU、节点、采集目标与指标查询",
        meta: "仅运维 / 管理员"
      }));
      cards.push(entryCard({
        href: `http://${window.__OBS_HOST || "192.168.112.230"}:9093/`, icon: "alert", tone: "amber", external: true,
        title: "Alertmanager", sub: "告警分组、静默与通知路由",
        meta: "仅运维 / 管理员"
      }));
    }
    if (isAdmin) {
      cards.push(entryCard({
        href: "http://192.168.112.230:8080/ipa/login", icon: "lock", tone: "violet", external: true,
        title: "FreeIPA 身份管理", sub: "用户、组、OTP、主机与证书（经平台网关访问）",
        meta: "仅管理员"
      }));
    }
    const cols = isAdmin ? "cols-5" : isOps ? "cols-4" : "cols-2";
    return `<div class="page entrance-page">
      ${UI.pageHead({
        eyebrow: "星轨算力 · 统一入口",
        title: `你好，${name}`,
        sub: isOps ? "统一入口：从这里进入算力平台、OOD 终端，以及身份与监控后台。" : "统一入口：从这里进入算力平台，或打开 OOD 终端。",
        actions: `<a class="btn btn-primary" href="#/dashboard">${UI.icon("dashboard", 15)}进入平台</a><a class="btn btn-ghost" href="http://${window.__OOD_HOST || "192.168.112.230"}/" target="_blank" rel="noopener">${UI.icon("terminal", 15)}打开 OOD 终端</a>`
      })}
      <div class="entry-grid ${cols}">${cards.join("")}</div>
      <div class="entry-note">
        ${UI.icon("info", 15)}
        <span>${isOps ? "普通用户只显示平台与 OOD；身份、监控入口按角色对管理员/运维开放。" : "普通用户只显示平台与 OOD；身份、监控入口仅管理员可见。"} OOD 首次打开需单独使用 FreeIPA 账号登录（与平台会话独立）；FreeIPA 管理经平台网关访问。</span>
      </div>
    </div>`;
  };

  /* ============================ dashboard ============================ */
  P.dashboard = function () {
    const me = currentUser();
    if (!isPrivileged(me)) return personalDashboard(me);
    const t = DB.TOTALS;
    const trend = DB.TREND;
    const gpuPart = DB.PARTITION_STATS[0] || { total: t.gpus, used: t.allocated, error: t.error };
    const utilSeries = [
      { name: "GPU 利用率", color: "#22d3ee", values: trend.map((x) => x.util) }
    ];
    const donutSegs = [
      { label: "已分配", value: t.allocated, color: "#22d3ee" },
      { label: "空闲", value: t.idle, color: "#475569" },
      { label: "故障", value: t.error, color: "#f87171" },
      { label: "Drain", value: t.drain, color: "#fbbf24" }
    ];
    const donut = C.donut(donutSegs, { size: 152, thickness: 15, center: `<b>${t.utilization}%</b><small>已分配</small>` });
    const legend = donutSegs.map((s) => `<div class="legend-row"><i style="background:${s.color}"></i>${s.label}<span class="v">${DB.fmt(s.value)}</span></div>`).join("");
    const healthTotal = (DB.HEALTH || []).length;
    const healthOk = (DB.HEALTH || []).filter((h) => h.status !== "warn").length;
    const healthKnown = healthTotal > 0;
    const healthScore = healthTotal ? Math.round((healthOk / healthTotal) * 100) : 100;
    const degradedComponents = healthTotal - healthOk;
    const offline = window.__API_ONLINE === false;
    const trendOk = !(window.__DATA_OK && window.__DATA_OK.trend === false);
    const gpusOk = !(window.__DATA_OK && window.__DATA_OK.gpus === false) && !(window.__GPU_EMPTY === true);
    const gpuEmpty = window.__GPU_EMPTY === true;
    const renderedAt = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    const greeting = (() => {
      const hour = new Date().getHours();
      if (hour < 6) return "凌晨好";
      if (hour < 12) return "上午好";
      if (hour < 18) return "下午好";
      return "晚上好";
    })();

    const recent = DB.JOBS.filter((j) => j.state === "running").slice(0, 7);
    const recentRows = recent.length ? recent.map((j) => `<tr data-goto="#/jobs/${j.id}">
      <td><span class="id-chip">${j.id}</span></td>
      <td class="strong">${j.name}</td>
      <td>${j.user}</td>
      <td class="num">${j.gpus} 卡</td>
      <td>${UI.badge(j.state)}</td>
      <td><div class="cell-progress"><span class="bar"><i style="width:${j.progress}%"></i></span><span class="val">${j.progress}%</span></div></td>
      <td class="num">${DB.dur(j.elapsed)}</td>
    </tr>`).join("") : `<tr><td colspan="7" class="empty" style="padding:20px">暂无运行中作业</td></tr>`;

    const alertFeed = DB.ALERTS.slice(0, 5).map((a) => {
      const tone = a.sev === "critical" ? "#f87171" : a.sev === "warning" ? "#fbbf24" : "#60a5fa";
      return `<div class="feed-item"><span class="feed-dot" style="background:${tone};box-shadow:0 0 9px ${tone}88"></span>
        <div class="feed-main"><div class="feed-title"><b>${UI.esc(a.title)}</b> · <span class="muted">${UI.esc(a.node)}</span></div>
        <div class="feed-meta"><span>${UI.esc(a.rule)}</span><span>·</span><span>${DB.ago(a.time)}</span><span>·</span><span>${UI.statusLabel(a.state)}</span></div></div>
        <button class="btn btn-sm btn-ghost" data-goto="#/alerts">处理</button></div>`;
    }).join("");

    const pendingByPartition = DB.PARTITIONS.map((p) => ({
      name: p.name,
      count: DB.JOBS.filter((j) => j.state === "pending" && j.partition === p.id).length,
    }));
    const pendingMax = Math.max(1, ...pendingByPartition.map((p) => p.count));
    const queueBars = pendingByPartition.map((p) => UI.hbar(p.name, p.count, pendingMax, p.count + " 个")).join("");
    const accColors = ["#22d3ee", "#818cf8", "#a78bfa", "#34d399", "#fbbf24"];
    const topAccounts = DB.ACCOUNTS.slice().sort((a, b) => b.usage - a.usage);
    const topTotal = topAccounts.reduce((a, x) => a + x.usage, 0);
    const topAcc = topAccounts.slice(0, 5).map((a, i) => UI.hbar(a.name, a.usage, topAccounts[0].usage, DB.fmt(a.usage) + " GPU·h", accColors[i])).join("");
    const heat = heatCells(DB.NODES);
    const onlineN = DB.NODES.filter((n) => n.state === "online").length;
    const abnormalN = DB.NODES.length - onlineN;
    const maxWait = Math.max(0, ...DB.JOBS.filter((j) => j.state === "pending").map((j) => j.wait));

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: `${DB.CLUSTER.name} · 生产环境`,
        title: `${greeting}，${esc((currentUser() && currentUser().display_name) || "林予安")}`,
        sub: offline
          ? "后端不可用，暂无法读取实时集群状态；下方数据为最近一次已知快照或空状态。"
          : !healthKnown
          ? `平台健康数据暂不可用，无法判断集群是否正常。当前 ${t.gpuServers} 台 GPU 服务器、${t.gpus} 张卡，GPU 分配率 ${t.utilization}%。`
          : !gpusOk
          ? (gpuEmpty ? `GPU Agent 尚未上报指标，当前 GPU 数量、分配率与告警数据不可确认。` : `GPU 指标接口加载失败，当前 GPU 数量、分配率与告警数据不可确认。`)
          : degradedComponents
          ? `有 ${degradedComponents} 个平台组件需要处理。当前 ${t.gpuServers} 台 GPU 服务器、${t.gpus} 张卡，GPU 分配率 ${t.utilization}%，${t.criticalAlerts} 个严重告警。`
          : `集群运行正常。当前 ${t.gpuServers} 台 GPU 服务器、${t.gpus} 张卡，GPU 分配率 ${t.utilization}%，${t.criticalAlerts} 个严重告警待处理。`,
        actions: `<button class="btn btn-ghost" data-action="export">${UI.icon("download", 16)}导出日报</button>
                  <button class="btn btn-primary" data-action="submit-job">${UI.icon("plus", 16)}提交作业</button>`
      })}
      ${!gpusOk && !offline ? `<div class="callout" style="margin-bottom:12px;border-color:var(--amber)">${UI.icon("alert", 15)}<span>${gpuEmpty ? "GPU Agent 尚未上报指标，下方 0 卡/0% 不代表真实集群状态。" : "GPU 指标接口加载失败，下方 0 卡/0% 不代表真实集群状态。"}</span></div>` : ""}
      ${!trendOk && !offline ? `<div class="callout" style="margin-bottom:12px;border-color:var(--amber)">${UI.icon("alert", 15)}<span>Prometheus 历史趋势加载失败，下方“GPU 利用率趋势”图表暂不可用，当前实时指标仍可参考。</span></div>` : ""}
      <div class="hero-strip">
        <span class="live-pill"><i></i>${offline ? "数据离线" : window.__LIVE_MODE === "poll-fallback" ? "轮询数据 · 3s 更新" : "实时数据 · 3s 更新"}</span>
        <span class="hero-stat">${UI.icon("clock", 13)} 最后更新 <b>${renderedAt}</b></span>
        <span class="hero-stat">${UI.icon("server", 13)} <b>${t.nodes}</b> 节点 / <b>${t.gpus}</b> 卡</span>
        <span class="hero-score">${UI.icon("check-circle", 13)} 健康评分 <b>${healthTotal ? healthScore : "—"}</b> / 100</span>
        <span class="hero-stat">${UI.icon("mail", 13)} 值班：<b>平台组</b></span>
      </div>

      <div class="kpi-grid">
        ${UI.kpi({ label: "GPU 总量", count: t.gpus, unit: "卡 · " + t.nodes + " 节点", icon: "gpu", tone: "cyan", delta: "", dir: "flat", foot: `${t.gpuServers} 台 GPU 服务器 · 自用` })}
        ${UI.kpi({ label: "已分配 GPU", count: t.allocated, unit: "卡", icon: "layers", tone: "indigo", delta: "", dir: "flat", foot: "占用率 " + t.utilization + "%" })}
        ${UI.kpi({ label: "运行作业", count: t.runningJobs, unit: "个", icon: "play", tone: "green", delta: "", dir: "flat", foot: `跨 ${t.gpuServers} 台服务器` })}
        ${UI.kpi({ label: "排队作业", count: t.pendingJobs, unit: "个", icon: "clock", tone: "amber", delta: "", dir: "flat", foot: "Slurm 队列统计" })}
        ${UI.kpi({ label: "严重告警", count: t.criticalAlerts, unit: "条", icon: "alert", tone: "red", delta: "", dir: "flat", foot: "Alertmanager 未恢复" })}
        ${UI.kpi({ label: "近 30 天 GPU·h", count: t.gpuHoursMonth, unit: "GPU·h", icon: "usage", tone: "violet", delta: "", dir: "flat", foot: "Slurm 当前与归档作业" })}
      </div>

      <div class="grid-12">
        ${UI.panel({
          class: "span-8",
          title: "GPU 利用率趋势",
          tag: "24h",
          sub: "全部节点 · Prometheus 5m 采样",
          extra: `<div class="legend"><span><i style="background:#22d3ee"></i>GPU 利用率</span></div>`,
          body: DB.TREND.length
            ? C.line({ labels: DB.TREND_LABELS, series: utilSeries, height: 248, unit: "%", yMax: 100 })
            : Charts.empty("Prometheus 历史趋势不可用")
        })}
        ${UI.panel({
          class: "span-4",
          title: "GPU 状态分布",
          sub: `${t.gpus} 卡 · 最近一次采集`,
          body: `<div class="donut-flex">${donut}<div class="donut-legend">${legend}</div></div>
                 <div class="divider" style="margin-top:16px"></div>
                 <div class="mini-row"><span class="lbl">空闲卡</span><span class="val">${t.idle}</span><span class="tiny dim">/ ${t.gpus}</span></div>
                 <div class="mini-row"><span class="lbl">故障卡</span><span class="val">${t.error}</span><span class="tiny dim">需处置</span></div>`
        })}
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-4", title: "节点负载热力图", sub: `${DB.NODES.length} 节点 · 颜色越亮负载越高`, extra: `<div class="heat-badges"><span class="badge green">${onlineN} 健康</span><span class="badge red">${abnormalN} 降级</span></div>`, body: `<div class="heatmap dense">${heat}</div><div class="heat-legend"><span>低</span><span class="scale"><i style="background:rgba(34,211,238,.16)"></i><i style="background:rgba(34,211,238,.38)"></i><i style="background:rgba(34,211,238,.62)"></i><i style="background:rgba(34,211,238,.86)"></i></span><span>高</span><span style="margin-left:auto">${UI.icon("alert", 11)} 故障 / Drain</span></div>` })}
        ${UI.panel({ class: "span-4", title: "分区排队", sub: "当前排队作业数 · Slurm", extra: `<button class="btn btn-sm btn-ghost" data-goto="#/jobs">详情 ${UI.icon("chevron", 13)}</button>`, body: `<div class="hbar-list">${queueBars}</div><div class="divider" style="margin:14px 0"></div><div class="mini-list"><div class="mini-row"><span class="lbl">排队总数</span><span class="val">${DB.JOBS.filter((j) => j.state === "pending").length} 个</span></div><div class="mini-row"><span class="lbl">最长等待</span><span class="val">${maxWait} 分钟</span></div><div class="mini-row"><span class="lbl">今日取消</span><span class="val">${DB.JOBS.filter((j) => j.state === "cancelled").length} 个</span></div></div>` })}
        ${UI.panel({ class: "span-4", title: "Top 账户用量", sub: "近 30 天 GPU·h", extra: `<span class="tiny dim">单位：GPU·h</span>`, body: `<div class="hbar-list">${topAcc}</div><div class="divider" style="margin:14px 0"></div><div class="mini-row"><span class="lbl">合计</span><span class="val">${DB.fmt(topTotal)}</span><span class="tiny dim" style="margin-left:4px">GPU·h</span></div>` })}
      </div>

      <div class="grid-12">
        ${UI.panel({
          class: "span-8",
          title: "最近作业",
          tag: "运行中",
          extra: `<button class="btn btn-sm btn-ghost" data-goto="#/jobs">全部作业 ${UI.icon("chevron", 13)}</button>`,
          body: UI.table([
            { label: "作业 ID" }, { label: "名称" }, { label: "用户" }, { label: "资源", cls: "right" }, { label: "状态" }, { label: "进度" }, { label: "已运行", cls: "right" }
          ], recentRows)
        })}
        ${UI.panel({ class: "span-4", title: "告警动态", extra: `<button class="btn btn-sm btn-ghost" data-goto="#/alerts">全部 ${UI.icon("chevron", 13)}</button>`, body: `<div class="feed">${alertFeed}</div>` })}
      </div>
    </div>`;
  };

  /* ============================ monitor ============================ */
  P.monitor = function () {
    const offline = window.__API_ONLINE === false;
    const gpusOk = !(window.__DATA_OK && window.__DATA_OK.gpus === false) && !(window.__GPU_EMPTY === true);
    const gpuEmpty = window.__GPU_EMPTY === true;
    const trendOk = !(window.__DATA_OK && window.__DATA_OK.trend === false);
    const ps = DB.PARTITION_STATS;
    const queueStats = DB.PARTITIONS.map((p) => ({
      id: p.name,
      pending: DB.JOBS.filter((j) => j.state === "pending" && j.partition === p.id).length,
      used: DB.GPUS.filter((g) => g.partition === p.id && g.state === "allocated").length,
      total: DB.GPUS.filter((g) => g.partition === p.id).length,
    }));
    const maxQueue = Math.max(1, ...queueStats.map((p) => p.pending));
    const total = DB.TOTALS.gpus;
    const series = [
      { name: "GPU 利用率", color: "#22d3ee", values: DB.TREND.map((x) => x.util) }
    ];
    const donutSegs = ps.map((p) => ({ label: p.name, value: p.used, color: p.color }));
    const donut = C.donut(donutSegs, { size: 150, thickness: 15, center: `<b>${DB.TOTALS.utilization}%</b><small>集群分配率</small>` });
    const legend = ps.map((p) => `<div class="legend-row"><i style="background:${p.color}"></i>${p.name}<span class="v">${p.used}</span></div>`).join("");
    const buckets = [
      { label: "0–20", min: 0, max: 20, color: "#64748b" },
      { label: "20–40", min: 20, max: 40, color: "#38bdf8" },
      { label: "40–60", min: 40, max: 60, color: "#22d3ee" },
      { label: "60–80", min: 60, max: 80, color: "#818cf8" },
      { label: "80–100", min: 80, max: 101, color: "#f472b6" }
    ].map((b) => ({ ...b, count: DB.GPUS.filter((g) => g.util >= b.min && g.util < b.max).length }));
    const maxBucket = Math.max.apply(null, buckets.map((b) => b.count));
    const onlineN = DB.NODES.filter((n) => n.state === "online").length;
    const drainN = DB.NODES.filter((n) => n.state === "drain").length;
    const degradedN = DB.NODES.filter((n) => n.state === "degraded").length;
    const slurmComponent = DB.HEALTH.find((h) => /slurm/i.test(h.name || ""));
    const nodeRank = { online: 0, drain: 1, degraded: 2 };
    const nodeRows = DB.NODES.slice().sort((a, b) => (nodeRank[a.state] - nodeRank[b.state]) || a.name.localeCompare(b.name)).slice(0, 10).map((n) => {
      const gpus = DB.gpuByNode(n.name);
      const used = gpus.filter((g) => g.state === "allocated").length;
      const cap = n.gpus || 0;
      return `<tr data-goto="#/gpus" data-node-state="${n.state}" data-text="${n.name} ${n.partition} ${n.rack}">
        <td><div class="strong">${n.name}</div><span class="tiny dim">${n.rack}</span></td>
        <td><span class="tiny dim">${n.partition}</span></td>
        <td>${cap ? `<div class="bar-row"><span class="bar ${used < cap ? "amber" : ""}"><i style="width:${(used / cap) * 100}%"></i></span><span class="val">${used}/${cap}</span></div>` : `<span class="tiny dim">运维自用 · 无 GPU</span>`}</td>
        <td class="num">${cap ? n.util + "%" : "—"}</td>
        <td class="num ${n.temp > 75 ? "temp-hot" : ""}">${cap ? n.temp + "℃" : "—"}</td>
        <td>${UI.badge(n.state === "degraded" ? "error" : n.state === "drain" ? "drain" : "online")}</td>
        <td class="right"><button class="btn btn-sm btn-ghost" data-goto="#/gpus">查看</button></td></tr>`;
    }).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "监控 · 集群总览",
        title: "集群总览",
        sub: window.__API_ONLINE === false
          ? "API 离线，展示最近已知的节点与资源快照；实时 Prometheus/Slurm 数据不可用。"
          : !gpusOk
            ? (gpuEmpty ? "GPU Agent 尚未上报指标，节点与利用率数据不可确认。" : "GPU 指标接口加载失败，节点与利用率数据不可确认。")
            : "Slurm 控制面、节点与 GPU 资源的实时健康视图。数据源：Prometheus + Slurm scontrol + DCGM。",
        actions: `<button class="btn btn-ghost" data-action="refresh">${UI.icon("refresh", 15)}刷新</button><button class="btn" data-action="export">${UI.icon("download", 15)}导出快照</button>`
      })}
      ${!gpusOk && window.__API_ONLINE !== false ? `<div class="callout" style="margin-bottom:12px;border-color:var(--amber)">${UI.icon("alert", 15)}<span>${gpuEmpty ? "GPU Agent 尚未上报指标，当前节点与利用率数据不可确认。" : "GPU 指标加载失败，当前节点与利用率数据不代表真实状态。"}</span></div>` : ""}
      ${!trendOk && !offline ? `<div class="callout" style="margin-bottom:12px;border-color:var(--amber)">${UI.icon("alert", 15)}<span>Prometheus 历史趋势加载失败，趋势图表暂不可用。</span></div>` : ""}
      <div class="stat-strip">
        <div class="stat-box">
          <div class="between"><span class="sl">健康节点</span><span class="delta ${offline ? "down" : "up"}" data-live-delta>${offline ? "离线快照" : window.__LIVE_MODE === "poll-fallback" ? "轮询" : "实时"}</span></div>
          <span class="sv">${onlineN}<small>/ ${DB.NODES.length}</small></span>
          <div class="stat-foot"><span class="tiny dim">${drainN} drain · ${degradedN} 降级</span></div>
        </div>
        <div class="stat-box">
          <div class="between"><span class="sl">集群 GPU 利用率</span><span class="delta ${offline ? "down" : "up"}" data-live-delta>${offline ? "离线快照" : window.__LIVE_MODE === "poll-fallback" ? "轮询" : "实时"}</span></div>
          <span class="sv">${DB.TOTALS.utilization}<small>%</small></span>
          <div class="stat-foot"><span class="tiny dim">${offline ? "DCGM 离线快照" : "DCGM 实时采集"}</span></div>
          ${DB.TREND.length ? `<div class="stat-spark">${C.spark(DB.TREND.slice(-8).map((p) => p.util), { color: "#22d3ee" })}</div>` : ""}
        </div>
        <div class="stat-box">
          <div class="between"><span class="sl">Slurm 健康延迟</span><span class="delta ${offline || !slurmComponent ? "down" : slurmComponent.status === "warn" ? "down" : "up"}">${offline ? "离线" : !slurmComponent ? "未知" : slurmComponent.status === "warn" ? "异常" : "正常"}</span></div>
          <span class="sv">${slurmComponent ? slurmComponent.latency : "—"}<small>ms</small></span>
          <div class="stat-foot"><span class="tiny dim">/api/v1/system/status</span></div>
        </div>
        <div class="stat-box">
          <div class="between"><span class="sl">队列等待 P95</span><span class="delta">未接入</span></div>
          <span class="sv">—<small>min</small></span>
          <div class="stat-foot"><span class="tiny dim">队列历史数据未接入</span></div>
        </div>
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-8", title: "GPU 利用率趋势", tag: "24h", sub: "Prometheus 5m 采样", extra: `<div class="legend"><span><i style="background:#22d3ee"></i>GPU 利用率</span></div>`, body: DB.TREND.length ? C.line({ labels: DB.TREND_LABELS, series, height: 236, yMax: 100, unit: "%" }) : Charts.empty("Prometheus 历史趋势不可用") })}
        ${UI.panel({ class: "span-4", title: "分区占用", sub: "按分区 GPU 分配", body: `<div class="donut-flex">${donut}<div class="donut-legend">${legend}</div></div>` })}
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-5", title: "全节点热力图", sub: window.__GPU_EMPTY ? `${DB.NODES.length} 节点 · GPU 未上报` : `${DB.NODES.length} 节点 × ${DB.TOTALS.gpus} 卡`, body: `<div class="heatmap compact">${heatCells(DB.NODES)}</div>
          <div class="node-legend"><span>低负载</span><span class="scale"><i style="background:rgba(34,211,238,.15)"></i><i style="background:rgba(34,211,238,.4)"></i><i style="background:rgba(34,211,238,.7)"></i><i style="background:rgba(34,211,238,.95)"></i></span><span>高负载</span>
          <span class="l" style="margin-left:auto"><i style="background:rgba(251,191,36,.7)"></i>Drain</span><span class="l"><i style="background:rgba(248,113,113,.8)"></i>故障</span></div>` })}
        ${UI.panel({ class: "span-3", title: "GPU 利用率分布", sub: `${total} 卡 · 当前`, body: `<div class="dist-bars">${buckets.map((b) => `<div class="dist-col"><span class="dv">${b.count}</span><span class="dbar"><i style="height:${Math.max(5, (b.count / maxBucket) * 100)}%;background:linear-gradient(180deg,${b.color},${b.color}55)"></i></span><small>${b.label}</small></div>`).join("")}</div><div class="divider" style="margin:12px 0 0"></div><div class="mini-row"><span class="lbl">高负载卡（≥80%）</span><span class="val">${buckets[4].count}</span></div><div class="mini-row"><span class="lbl">低负载卡（&lt;20%）</span><span class="val">${buckets[0].count}</span></div>` })}
        ${UI.panel({ class: "span-4", title: "分区队列", sub: "当前排队作业数 · Slurm", body: `<div class="hbar-list">${queueStats.map((p) => UI.hbar(p.id, p.pending, maxQueue, p.pending + " 个")).join("")}</div>
          <div class="divider" style="margin:14px 0"></div>
          <div class="mini-list">${queueStats.map((p) => `<div class="mini-row"><span class="lbl">${p.id} · 已分配</span><span class="val">${p.used}/${p.total}</span><span class="tiny dim">排队 ${p.pending}</span></div>`).join("")}</div>` })}
      </div>

      ${UI.panel({
        title: "节点状态", tag: `${DB.NODES.length} 节点`, extra: `<button class="btn btn-sm btn-ghost" data-goto="#/gpus">GPU 详情 ${UI.icon("chevron", 13)}</button>`,
        body: `<div class="toolbar" style="margin-bottom:12px">
          <div class="field" style="min-width:220px"><input class="input" id="nodeSearch" placeholder="搜索节点、分区、机架…" /></div>
          ${UI.chips([{ key: "all", label: "全部", count: DB.NODES.length }, { key: "online", label: "在线", count: onlineN }, { key: "drain", label: "Drain", count: drainN }, { key: "degraded", label: "降级", count: degradedN }], "all", "data-node-state")}
          <div class="grow"></div><span class="tiny dim">显示 ${nodeRows ? Math.min(DB.NODES.length, 10) : 0} / ${DB.NODES.length} 节点</span>
          <button class="btn btn-sm btn-ghost" data-goto="#/gpus">GPU 详情</button>
        </div>` + UI.table([{ label: "节点" }, { label: "分区" }, { label: "GPU 使用" }, { label: "利用率", cls: "right" }, { label: "平均温度", cls: "right" }, { label: "状态" }, { label: "", cls: "right" }], nodeRows) + `<div id="nodeEmpty" class="empty" hidden style="margin-top:10px">没有匹配的节点，请调整筛选条件。</div>`
      })}
    </div>`;
  };

  /* ============================ GPU fleet ============================ */
  function gpuTop() {
    const order = { allocated: 0, idle: 1, drain: 2, error: 3 };
    return DB.GPUS.slice().sort((a, b) => (order[a.state] - order[b.state]) || a.node.localeCompare(b.node) || (a.index - b.index)).slice(0, 48);
  }
  function gpuCard(g) {
    const color = g.state === "error" ? "#f87171" : g.state === "drain" ? "#fbbf24" : g.util > 88 ? "#f472b6" : g.model === "H100 80G" ? "#818cf8" : g.model === "L40S 48G" ? "#a78bfa" : "#22d3ee";
    const job = g.jobId ? DB.jobById(g.jobId) : null;
    const jobText = job ? job.name : "无作业";
    return `<article class="gpu-card" data-gpu="${g.uuid}" data-state="${g.state}" data-model="${g.model}" data-partition="${g.partition}" data-node="${g.node}" data-util="${g.util}" data-mem="${g.memUsed}" data-text="${g.uuid} ${g.node} ${g.model} ${g.partition}" tabindex="0" role="button" aria-label="${g.model} ${g.node} GPU ${g.index}" style="--accent:${color}">
      <div class="gc-top">
        <div class="gc-model"><span class="mi">${UI.icon("gpu", 15)}</span><div><div class="row gap-6"><span class="mdot"></span>${g.model}</div><div class="gc-node">${g.node} · GPU ${g.index}</div></div></div>
        ${UI.badge(g.state)}
      </div>
      <div class="gc-util"><b>${g.util}<small>%</small></b><span class="tiny dim">显存 ${g.memUsed}% · ${g.temp}℃</span></div>
      <div class="gc-bar"><i style="width:${Math.max(2, g.util)}%;background:linear-gradient(90deg,${color},#818cf8)"></i></div>
      <div class="gc-mem"><div class="bar"><i style="width:${Math.max(2, g.memUsed)}%"></i></div></div>
      <div class="gc-meta"><span>${g.power} W</span><span>·</span><span class="truncate" style="max-width:128px">${jobText}</span><span style="margin-left:auto">${g.partition}</span></div>
      <div class="gc-uuid">${g.uuid}</div>
    </article>`;
  }
  function gpuCards() {
    return gpuTop().map(gpuCard).join("");
  }
  function gpuCardsGrouped() {
    const order = { error: 0, drain: 1, allocated: 2, idle: 3 };
    const groups = DB.PARTITIONS.map((p) => ({ id: p.id, color: p.color }));
    return groups.map((grp) => {
      const list = DB.GPUS.filter((g) => g.partition === grp.id)
        .sort((a, b) => (order[a.state] - order[b.state]) || a.node.localeCompare(b.node) || (a.index - b.index))
        .slice(0, 8);
      if (!list.length) return "";
      const used = list.filter((g) => g.state === "allocated").length;
      const errs = list.filter((g) => g.state === "error").length;
      const drains = list.filter((g) => g.state === "drain").length;
      const avg = Math.round(list.reduce((s, g) => s + g.util, 0) / list.length);
      return `<section class="gpu-group">
        <header class="gpu-group-head">
          <span class="ggh-dot" style="background:${grp.color};box-shadow:0 0 10px ${grp.color}66"></span>
          <b>${grp.id}</b><span class="badge slate">样本 ${list.length} 卡</span>
          <span class="tiny dim">已分配 ${used} · 平均利用率 ${avg}%</span>
          ${errs ? `<button class="ggh-state bad" data-gpu-state-jump="error">故障 ${errs}</button>` : ""}
          ${drains ? `<button class="ggh-state warn" data-gpu-state-jump="drain">Drain ${drains}</button>` : ""}
          <span class="grow"></span>
          <span class="tiny dim">${list[0] ? list[0].model : ""}</span>
        </header>
        <div class="gpu-grid">${list.map(gpuCard).join("")}</div>
      </section>`;
    }).join("");
  }

  P.gpus = function () {
    const t = DB.TOTALS;
    const gpusOk = !(window.__DATA_OK && window.__DATA_OK.gpus === false) && !(window.__GPU_EMPTY === true);
    const gpuEmpty = window.__GPU_EMPTY === true;
    let gpuView = "grid";
    try { gpuView = localStorage.getItem("hpc-gpu-view") === "group" ? "group" : "grid"; } catch (e) { gpuView = "grid"; }
    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "监控 · GPU 监控",
        title: "GPU 监控",
        sub: window.__API_ONLINE === false
          ? `API 离线，展示最近已知的 ${t.gpus} 块 GPU 资产快照；实时指标不可用。`
          : !gpusOk
            ? (gpuEmpty ? "GPU Agent 尚未上报指标，当前数量与状态不可确认，请等待 Agent 上报。" : "GPU 指标接口加载失败，当前数量与状态不可确认，请稍后重试。")
            : `${t.gpus} 块 GPU（${t.gpuServers} 台服务器，全部自用）的资产、状态与利用率。点击卡片查看单卡详情。`,
        actions: `<button class="btn" data-action="export">${UI.icon("download", 15)}导出资产</button><button class="btn btn-primary" data-action="refresh">${UI.icon("refresh", 15)}刷新指标</button>`
      })}
      ${!gpusOk && window.__API_ONLINE !== false ? `<div class="callout" style="margin-bottom:12px;border-color:var(--amber)">${UI.icon("alert", 15)}<span>${gpuEmpty ? "GPU Agent 尚未上报指标，当前没有可展示的 GPU 卡片。" : "GPU 指标加载失败，当前 0 块 GPU 不代表集群没有 GPU。"}</span></div>` : ""}
      <div class="gpu-stat-strip">
        <div class="gpu-stat"><span class="gs-dot" style="background:#22d3ee;color:#22d3ee"></span><div><small>使用中</small><b>${t.allocated}</b></div><span class="gs-sub">${t.utilization}%</span></div>
        <div class="gpu-stat"><span class="gs-dot" style="background:#64748b;color:#64748b"></span><div><small>空闲</small><b>${t.idle}</b></div><span class="gs-sub">${t.gpus ? Math.round((t.idle / t.gpus) * 100) : 0}%</span></div>
        <div class="gpu-stat"><span class="gs-dot" style="background:#f87171;color:#f87171"></span><div><small>故障</small><b>${t.error}</b></div><span class="gs-sub">需处置</span></div>
        <div class="gpu-stat"><span class="gs-dot" style="background:#fbbf24;color:#fbbf24"></span><div><small>Drain</small><b>${t.drain}</b></div><span class="gs-sub">人工确认</span></div>
        <div class="gpu-stat"><span class="gs-dot" style="background:#a78bfa;color:#a78bfa"></span><div><small>平均利用率</small><b>${t.gpus ? Math.round(DB.GPUS.reduce((a, g) => a + g.util, 0) / t.gpus) : 0}%</b></div><span class="gs-sub">当前</span></div>
      </div>
      <div class="panel" style="padding:14px 16px">
        <div class="toolbar">
          <div class="field" style="min-width:220px"><input class="input" id="gpuSearch" placeholder="搜索 UUID、节点、型号、分区…" /></div>
          ${UI.chips([{ key: "all", label: "全部", count: t.gpus }, { key: "allocated", label: "使用中", count: t.allocated }, { key: "idle", label: "空闲", count: t.idle }, { key: "error", label: "故障", count: t.error }, { key: "drain", label: "Drain", count: t.drain }], "all", "data-gpu-state")}
          <div class="seg" id="gpuView"><button class="${gpuView === "grid" ? "active" : ""}" data-gpu-view="grid">卡片</button><button class="${gpuView === "group" ? "active" : ""}" data-gpu-view="group">按分区</button></div>
          <div class="grow"></div>
          <div class="row gap-8 gpu-filters">
            <button class="btn btn-sm btn-ghost" id="gpuReset" hidden>重置筛选</button>
            <select class="select" id="gpuSort"><option value="state">按状态</option><option value="util">按利用率</option><option value="mem">按显存</option><option value="node">按节点</option></select>
            <select class="select" id="gpuPartition"><option value="all">全部分区</option>${DB.PARTITIONS.map((p) => `<option value="${p.id}">${p.id}</option>`).join("")}</select>
            <select class="select" id="gpuModel"><option value="all">全部型号</option>${Object.keys(DB.MODELS).map((m) => `<option value="${m}">${m}</option>`).join("")}</select>
          </div>
        </div>
      </div>
      <div class="between" style="font-size:12px;color:var(--muted)">
        <span>显示 <b id="gpuCount" style="color:var(--text)">${gpuView === "group" ? Math.min(8, t.gpus) : t.gpus}</b> / ${t.gpus} 块 GPU · 3s 轮询</span>
        <span class="row gap-12"><span class="dot cyan"></span>使用中 <span class="dot" style="background:var(--green)"></span>正常 <span class="dot warn"></span>Drain <span class="dot bad"></span>故障</span>
      </div>
      <div id="gpuGridWrap" ${gpuView === "group" ? "hidden" : ""}><div class="gpu-grid" id="gpuGrid">${gpuCards()}</div></div>
      <div id="gpuGroups" ${gpuView === "grid" ? "hidden" : ""}>${gpuCardsGrouped()}</div>
      <div id="gpuEmpty" class="empty" hidden style="margin-top:12px">没有匹配的 GPU，请调整筛选条件。</div>
      <div class="pager"><span>共 ${t.gpus} 块 GPU（${t.gpuServers} 台 GPU 服务器），${gpuView === "group" ? "按分区展示样本" : "全部展示"}</span><span class="pages"><button class="pg active">1</button></span></div></div>
    </div>`;
  };

  P.gpuDrawer = function (uuid) {
    const g = DB.gpuByUuid(uuid);
    if (!g) return "";
    const job = g.jobId ? DB.jobById(g.jobId) : null;
    const node = DB.nodeByName(g.node);
    const accent = g.state === "error" ? "#f87171" : g.state === "drain" ? "#fbbf24" : g.model === "H100 80G" ? "#818cf8" : g.model === "L40S 48G" ? "#a78bfa" : "#22d3ee";
    const healthOk = !g.xid && g.temp < 80;
    return `<div class="drawer-head" style="border-top:3px solid ${accent}">
      <div class="avatar" style="width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,${accent},#818cf8)">${UI.icon("gpu", 20)}</div>
      <div><div class="drawer-title">${g.model}</div><div class="drawer-sub">${node ? node.name : g.node} · GPU ${g.index} · ${g.partition}</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body">
      <div class="drawer-status-row">
        <span class="badge ${UI.statusTone(g.state)}">${UI.statusLabel(g.state)}</span>
        <span class="id-chip">${g.uuid}</span>
        <span class="drawer-temp ${g.temp > 75 ? "hot" : ""}">${g.temp}℃ · ${g.power}W</span>
      </div>
      <div class="drawer-gauge">
        ${C.gauge(g.util, { label: "利用率", size: 94 })}
        ${C.gauge(g.memUsed, { label: "显存", size: 94, color: "#818cf8" })}
        <div class="dg"><b style="color:${healthOk ? "var(--green)" : "var(--amber)"}">${healthOk ? "正常" : "注意"}</b><small>健康状态</small><span class="tiny dim">XID ${g.xid ? g.xid : "无"}</span></div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">最近 1 小时负载<span>未接入单卡历史</span></div>
        ${Charts.empty("单卡历史利用率/显存未接入；以上方实时仪表为准")}
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">资产信息</div>
        <div class="spec-grid">
          ${[["节点", node ? node.name : g.node], ["机架", node ? node.rack : "—"], ["分区", g.partition], ["型号", g.model + " · " + g.spec.mem + "GB"], ["GPU 编号", String(g.index)], ["UUID", g.uuid], ["显存占用", g.memUsed + " %"], ["温度", g.temp + "℃"]].map((x) => `<div class="spec-item"><small>${x[0]}</small><b>${x[1]}</b></div>`).join("")}
        </div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">关联作业</div>
        ${job ? `<div class="drawer-job" data-goto="#/jobs/${job.id}">
          <span class="dj-ic">${UI.icon("jobs", 16)}</span>
          <div class="dj-main"><b>${job.name}</b><small>${job.id} · ${job.user} · ${job.gpus} 卡 · ${DB.dur(job.elapsed)}</small></div>
          <span class="badge ${UI.statusTone(job.state)}">${UI.statusLabel(job.state)}</span>
        </div>` : `<div class="empty" style="padding:16px">当前没有关联作业</div>`}
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">健康检查</div>
        <div class="chip-row">
          <span class="chip ${g.xid ? "" : "active"}">XID ${g.xid ? g.xid : "无"}</span>
          <span class="chip">ECC 未采集</span>
          <span class="chip ${g.temp > 80 ? "" : "active"}">温度 ${g.temp}℃</span>
          <span class="chip">MIG 未采集</span>
        </div>
      </div>
    </div>
    <div class="drawer-foot">
      <button class="btn btn-sm" data-goto="#/monitor">查看节点</button>
      <button class="btn btn-sm" data-action="copy-gpu" data-copy="${g.uuid}">复制 GPU UUID</button>
      <a class="btn btn-sm btn-ghost" style="margin-left:auto" href="http://${window.__OBS_HOST || "192.168.112.230"}:9090/classic/targets" target="_blank" rel="noopener">Prometheus 目标</a>
    </div>`;
  };

  P.heatCells = heatCells;
})();

















