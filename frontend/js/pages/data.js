/* =========================================================
   Pages: alerts / usage
   ========================================================= */
(function () {
  const P = (window.Pages = window.Pages || {});
  const UI = window.UI, C = window.Charts, DB = window.DB;

  /* ============================ alerts ============================ */
  P.alerts = function () {
    const me = window.__ME;
    const canAck = !me || (me.roles || []).some((r) => ["admin", "ops"].includes(r));
    const open = DB.ALERTS.filter((a) => a.state !== "resolved");
    const crit = DB.ALERTS.filter((a) => a.sev === "critical" && a.state !== "resolved").length;
    const warn = DB.ALERTS.filter((a) => a.sev === "warning" && a.state !== "resolved").length;
    const info = DB.ALERTS.filter((a) => a.sev === "info" && a.state !== "resolved").length;
    const resolved = DB.ALERTS.filter((a) => a.state === "resolved").length;

    const items = DB.ALERTS.map((a) => {
      const tone = a.sev === "critical" ? "#f87171" : a.sev === "warning" ? "#fbbf24" : "#60a5fa";
      return `<article class="alert-item ${a.sev === "warning" ? "warning" : a.sev === "info" ? "info" : ""} ${a.state === "resolved" ? "resolved" : ""}">
        <div class="feed-dot" style="background:${tone};box-shadow:0 0 10px ${tone}88;margin-top:6px"></div>
        <div class="alert-main">
          <div class="alert-title">${UI.esc(a.title)} ${UI.severity(a.sev)} <span class="rule-tag">${UI.esc(a.rule)}</span></div>
          <div class="alert-desc">${UI.esc(a.desc)}</div>
          <div class="alert-meta">
            <span>${UI.icon("server", 12)} ${UI.esc(a.node)}</span>
            ${a.jobId ? `<span>${UI.icon("jobs", 12)} 作业 ${a.jobId}</span>` : ""}
            <span>${UI.icon("clock", 12)} ${DB.ago(a.time)}</span>
            <span>·</span><span>${UI.statusLabel(a.state)}</span>
          </div>
        </div>
        <div class="alert-actions">
          ${a.state !== "resolved" ? (canAck ? `<button class="btn btn-sm" data-action="ack-alert" data-id="${UI.esc(a.id)}">确认</button>` : `<span class="badge amber">待处理</span>`) : `<span class="badge green">已恢复</span>`}
        </div>
      </article>`;
    }).join("");

    const ruleHits = {};
    DB.ALERTS.forEach((a) => { ruleHits[a.rule] = (ruleHits[a.rule] || 0) + 1; });
    const topRules = Object.entries(ruleHits).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([n, v]) => UI.hbar(n, v, Math.max(1, ...Object.values(ruleHits)), v + " 次")).join("");

    const severityCounts = {
      critical: DB.ALERTS.filter((a) => a.sev === "critical" && a.state !== "resolved").length,
      warning: DB.ALERTS.filter((a) => a.sev === "warning" && a.state !== "resolved").length,
      info: DB.ALERTS.filter((a) => a.sev === "info" && a.state !== "resolved").length,
    };
    const severityBars = [
      ["严重", severityCounts.critical, "#f87171"],
      ["警告", severityCounts.warning, "#fbbf24"],
      ["信息", severityCounts.info, "#60a5fa"],
    ].map(([label, count, color]) => `<div class="legend-row"><i style="background:${color}"></i>${label}<span class="v">${count}</span></div>`).join("");

    const timeline = DB.ALERTS.map((a) => {
      const tone = a.sev === "critical" ? "#f87171" : a.sev === "warning" ? "#fbbf24" : "#60a5fa";
      const t = new Date(a.time);
      const hhmm = Number(a.time) > 0 && !isNaN(t.getTime()) ? t.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" }) : DB.ago(a.time);
      return `<div class="tl-row ${a.state === "resolved" ? "resolved" : ""}" data-text="${UI.esc(a.title)} ${UI.esc(a.desc)} ${UI.esc(a.node)} ${UI.esc(a.rule)}">
        <span class="tl-time">${hhmm}</span>
        <span class="tl-dot" style="background:${tone}"></span>
        <div class="tl-card">
          <div class="tl-title">${UI.esc(a.title)} ${UI.severity(a.sev)} <span class="rule-tag">${UI.esc(a.rule)}</span></div>
          <div class="tl-desc">${UI.esc(a.desc)}</div>
          <div class="tl-meta"><span>${UI.esc(a.node)}</span>${a.jobId ? `<span>作业 ${a.jobId}</span>` : ""}<span>${DB.ago(a.time)}</span><span>${UI.statusLabel(a.state)}</span>${a.state !== "resolved" && canAck ? `<button class="btn btn-sm btn-ghost" data-action="ack-alert" data-id="${UI.esc(a.id)}" style="margin-left:auto;height:22px;padding:0 8px;font-size:10.5px">确认</button>` : ""}</div>
        </div>
      </div>`;
    }).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "监控 · 告警中心",
        title: "告警中心",
        sub: "按 XID / ECC / 节点 / 平台组件分级。告警确认写入平台审计；静默和通知路由在 Alertmanager 配置。",
        actions: `<button class="btn btn-ghost" data-goto="#/rules">${UI.icon("rules", 15)}规则管理</button><button class="btn" data-action="export">${UI.icon("download", 15)}导出告警</button><a class="btn btn-primary" href="http://${window.__OBS_HOST || "192.168.112.230"}:9090/classic/rules" target="_blank" rel="noopener">${UI.icon("external", 15)}Prometheus 规则</a>`
      })}
      ${window.__DATA_OK && window.__DATA_OK.alerts === false ? `<div class="callout" style="margin-bottom:12px;border-color:var(--red)">${UI.icon("alert", 15)}<span>告警接口加载失败，当前列表为空<strong>不代表系统无告警</strong>，请稍后重试或检查后端。</span></div>` : ""}
      <div class="alert-grid">
        <div class="alert-stat"><span class="as-ic">${UI.icon("alert", 18)}</span><div><b>${crit}</b><small>严重 · 未恢复</small></div></div>
        <div class="alert-stat warn"><span class="as-ic">${UI.icon("alertCircle", 18)}</span><div><b>${warn}</b><small>警告 · 未恢复</small></div></div>
        <div class="alert-stat info"><span class="as-ic">${UI.icon("info", 18)}</span><div><b>${info}</b><small>信息 · 未恢复</small></div></div>
        <div class="alert-stat ok"><span class="as-ic">${UI.icon("check-circle", 18)}</span><div><b>${resolved}</b><small>过去 24h 已恢复</small></div></div>
      </div>

      <div class="toolbar">
        ${UI.chips([{ key: "all", label: "全部", count: DB.ALERTS.length }, { key: "critical", label: "严重", count: crit }, { key: "warning", label: "警告", count: warn }, { key: "resolved", label: "已恢复", count: resolved }], "all", "data-alert-filter")}
        <div class="seg" id="alertView"><button class="active" data-alert-view="list">列表</button><button data-alert-view="timeline">时间线</button></div>
        <div class="grow"></div>
        <div class="field" style="min-width:240px"><input class="input" id="alertSearch" placeholder="搜索规则、节点、描述…" /></div>
      </div>

      <div class="grid-12">
        <div class="span-8">
          <div class="alert-list" id="alertList">${items}</div>
          <div class="alert-timeline" id="alertTimeline" hidden>${timeline}</div>
          <div id="alertEmpty" class="empty" hidden style="margin-top:10px">没有匹配的告警，请调整筛选条件。</div>
        </div>
        <div class="span-4 stack">
          ${UI.panel({ title: "告警统计", tag: "当前", sub: "按级别", body: `<div class="legend" style="display:grid;gap:10px">${severityBars}</div><div class="divider" style="margin:12px 0 10px"></div><div class="mini-row"><span class="lbl">数据源</span><span class="val">Alertmanager</span></div><div class="mini-row"><span class="lbl">未恢复告警</span><span class="val">${DB.ALERTS.filter((a) => a.state !== "resolved").length}</span></div>` })}
          ${UI.panel({ title: "规则命中 Top", sub: "当前告警", body: `<div class="hbar-list">${topRules || '<div class="tiny dim">暂无告警命中</div>'}</div>` })}
          ${UI.panel({ title: "值班与升级", body: `<div class="mini-list">
            <div class="mini-row"><span class="lbl">当前值班</span><span class="val">平台组</span></div>
            <div class="mini-row"><span class="lbl">升级路径</span><span class="val">平台组 → 运维组</span></div>
            <div class="mini-row"><span class="lbl">严重响应时限</span><span class="val">15 分钟</span></div>
            <div class="mini-row"><span class="lbl">通知渠道</span><span class="val">Alertmanager</span></div>
          </div><div class="divider" style="margin:14px 0"></div><div class="callout">${UI.icon("info", 15)}<span>告警确认会写入平台审计链；静默和通知路由请在 Alertmanager 中配置。</span></div>` })}
        </div>
      </div>
    </div>`;
  };

  /* ============================ usage（仅资源用量） ============================ */
  P.usage = function () {
    const me = window.__ME;
    const privileged = !me || (me.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
    const usageScope = window.__USAGE_SCOPE || (privileged ? "global" : "self");
    const usageOk = !(window.__DATA_OK && window.__DATA_OK.usage === false);
    const scopeTab = (key, label) => `<button class="${usageScope === key ? "active" : ""}" data-scope="${key}">${label}</button>`;
    if (!DB.ACCOUNTS.length) {
      return `<div class="page">
        ${UI.pageHead({ eyebrow: "计量 · 资源用量", title: "资源用量", sub: usageOk ? "数据来自 Slurm 当前与已归档作业，按 GPU 数量 × 运行时长汇总。" : "资源用量接口加载失败，当前无法确认用量数据。", actions: `<button class="btn" data-action="export">${UI.icon("download", 15)}导出用量</button>` })}
        ${UI.panel({ title: "GPU·h 用量", sub: usageOk ? "近 30 天暂无记录" : "用量数据不可用", body: `<div class="mini-list"><div class="mini-row"><span class="lbl">数据源</span><span class="val">${usageOk ? "Slurm（已接入）" : "Slurm（接口失败）"}</span></div><div class="mini-row"><span class="lbl">当前结果</span><span class="val">${usageOk ? "暂无已完成作业记录" : "无法读取用量，请稍后重试"}</span></div><div class="mini-row"><span class="lbl">统计方式</span><span class="val">GPU 数量 × 运行小时</span></div></div><div class="divider" style="margin:12px 0"></div>${usageOk ? `<a class="btn btn-sm btn-primary" href="#/catalog">去提交作业</a>` : ""}` })}
      </div>`;
    }
    // 非管理员的数据由后端 scope=group/self 过滤；这里不再按 LDAP 组名二次过滤，
    // 否则作业账户（如 platform）会被误过滤，导致用户看不到自己的用量。
    const scopedAccounts = DB.ACCOUNTS;
    if (!privileged && !scopedAccounts.length) {
      return `<div class="page">
        ${UI.pageHead({ eyebrow: "计量 · 我的用量", title: "资源用量", sub: "近 30 天暂无本人作业记录。" })}
        ${UI.panel({ title: "GPU·h 用量", sub: "近 30 天暂无记录", body: `<div class="mini-list"><div class="mini-row"><span class="lbl">数据源</span><span class="val">Slurm（当前与已归档作业）</span></div><div class="mini-row"><span class="lbl">当前结果</span><span class="val">本人暂无已完成作业记录</span></div><div class="mini-row"><span class="lbl">统计方式</span><span class="val">GPU 数量 × 运行小时</span></div></div><div class="divider" style="margin:12px 0"></div><a class="btn btn-sm btn-primary" href="#/catalog">去提交作业</a>` })}
      </div>`;
    }
    const accounts = scopedAccounts.length ? scopedAccounts : DB.ACCOUNTS.slice(0, 1);
    const series = accounts.map((a) => DB.USAGE_SERIES[DB.ACCOUNTS.indexOf(a)]).filter(Boolean);
    const total = series.reduce((acc, s) => acc + s.values.reduce((x, y) => x + y, 0), 0);
    const byAccount = accounts.map((a, i) => ({
      ...a,
      usage: series[i] ? series[i].values.reduce((x, y) => x + y, 0) : 0,
      color: series[i] ? series[i].color : "#22d3ee"
    })).sort((a, b) => b.usage - a.usage);
    const maxUsage = Math.max(1, byAccount[0].usage);
    const donutSegs = byAccount.map((a) => ({ label: a.name, value: a.usage, color: a.color }));
    const donut = C.donut(donutSegs, { size: 148, thickness: 14, center: `<b>${DB.fmt(total)}</b><small>GPU·h</small>` });
    const legend = byAccount.map((a) => `<div class="legend-row"><i style="background:${a.color}"></i>${a.name}<span class="v">${DB.fmt(a.usage)}</span></div>`).join("");
    const activeUsers = DB.USERS.filter((u) => u.status === "active").length;
    const piCount = DB.USERS.filter((u) => u.role === "pi").length;
    const usersOk = (!me || (me.roles || []).some((r) => ["admin", "ops"].includes(r)))
      && !(window.__DATA_OK && window.__DATA_OK.users === false);
    const myJobs = (me ? DB.JOBS.filter((j) => j.username === me.username) : DB.JOBS);
    const rows = byAccount.map((a) => `<tr>
      <td class="strong">${a.name}</td>
      <td class="num">${DB.fmt(a.usage)}</td>
      <td><div class="bar-row"><span class="bar"><i style="width:${Math.min(100, (a.usage / maxUsage) * 100)}%"></i></span><span class="val">${Math.round((a.usage / Math.max(1, total)) * 100)}%</span></div></td>
    </tr>`).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: privileged ? "计量 · 资源用量" : "计量 · 我的用量",
        title: "资源用量",
        sub: privileged ? "按 Slurm 账户聚合的 GPU·h 资源使用量，数据来自 Slurm 当前与已归档作业。" : `仅展示你本人的 GPU·h 资源使用量（${UI.esc(me.account) || "未分组"}）；全局用量需管理员/运维权限。`,
        actions: `<button class="btn btn-ghost" data-action="export">${UI.icon("download", 15)}导出用量</button><button class="btn" data-action="usage-definition">${UI.icon("clock", 15)}查看统计口径</button>`
      })}
      <div class="toolbar">
        <div class="scope-tabs" id="scopeTabs">${privileged ? scopeTab("global", "全局") : ""}${scopeTab("self", "本人")}</div>
        <span class="tiny dim">范围：${DB.CLUSTER.name} · 近 30 天 · 按账户</span>
        <div class="grow"></div>
        <span class="tiny dim">数据源：Slurm 作业（当前+归档）</span>
      </div>

      <div class="kpi-grid cols-4">
        ${UI.kpi({ label: privileged ? "近 30 天 GPU·h" : "本人 GPU·h", value: DB.fmt(total), unit: "", icon: "usage", tone: "cyan", delta: "", dir: "flat", spark: series[0] ? C.spark(series[0].values.slice(-14), { color: "#22d3ee" }) : "" })}
        ${privileged
          ? UI.kpi({ label: "平均 GPU 利用率", value: String(DB.TOTALS.utilization), unit: "%", icon: "monitor", tone: "green", delta: "", dir: "flat" })
          : UI.kpi({ label: "我的运行作业", value: String(myJobs.filter((j) => j.state === "running").length), unit: "个", icon: "play", tone: "green", delta: "", dir: "flat" })}
        ${privileged
          ? UI.kpi({ label: "运行作业", value: String(DB.TOTALS.runningJobs), unit: "个", icon: "play", tone: "violet", delta: "", dir: "flat" })
          : UI.kpi({ label: "我的排队作业", value: String(myJobs.filter((j) => j.state === "pending").length), unit: "个", icon: "clock", tone: "violet", delta: "", dir: "flat" })}
        ${privileged
          ? UI.kpi({ label: "活跃用户 / PI", value: usersOk ? DB.fmt(activeUsers) : "—", unit: usersOk ? " / " + piCount : "", icon: "users", tone: "amber", delta: "", dir: "flat" })
          : UI.kpi({ label: "我的账户", value: UI.esc(me.account) || "未分组", unit: "", icon: "users", tone: "amber", delta: "", dir: "flat" })}
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-8", title: "每日 GPU·h", sub: privileged ? "按账户堆叠 · 近 30 天" : "本人 · 近 30 天", extra: `<div class="legend">${byAccount.map((a) => `<span><i style="background:${a.color}"></i>${a.name}</span>`).join("")}</div>`, body: C.stacked({ labels: DB.USAGE_LABELS, series, height: 250, unit: " GPU·h" }) })}
        ${UI.panel({ class: "span-4", title: "用量占比", sub: "按账户", body: `<div class="donut-flex">${donut}<div class="donut-legend">${legend}</div></div><div class="divider" style="margin-top:14px"></div><div class="mini-row"><span class="lbl">人均 GPU·h</span><span class="val">${usersOk ? DB.fmt(Math.round(total / Math.max(1, activeUsers))) : "—"}</span></div><div class="mini-row"><span class="lbl">统计周期</span><span class="val">近 30 天</span></div>` })}
      </div>

      ${UI.panel({
        title: privileged ? "账户资源用量明细" : "本人资源用量",
        tag: "近 30 天",
        sub: "GPU·h 按 Slurm 上报作业统计，作业结束后保留已归档记录",
        body: UI.table([{ label: "Slurm 账户" }, { label: "GPU·h", cls: "right" }, { label: privileged ? "集群占比" : "占比" }], rows)
      })}
      <div class="callout">${UI.icon("info", 15)}<span>集群为内部自用：所有服务器、GPU 与作业都只做资源统计。</span></div>
    </div>`;
  };
})();









