/* =========================================================
   Pages: users / alert rules / audit / system status
   ========================================================= */
(function () {
  const P = (window.Pages = window.Pages || {});
  const UI = window.UI, C = window.Charts, DB = window.DB;

  /* ============================ users ============================ */
  P.users = function () {
    const rows = DB.USERS.map((u) => {
      const pct = u.quota[1] ? Math.round((u.quota[0] / u.quota[1]) * 100) : 0;
      return `<tr data-action="user-drawer" data-user="${UI.esc(u.name)}" data-role="${u.role}" data-text="${UI.esc(u.name)} ${UI.esc(u.uid)} ${UI.esc(u.group)} ${UI.esc(u.email)}">
        <td><div class="user-cell">${UI.avatar(u.name)}<div><b>${UI.esc(u.name)}</b><small>uid=${UI.esc(u.uid)}</small></div></div></td>
        <td><span class="tiny">${UI.esc(u.group)}</span></td>
        <td>${u.role === "pi" ? `<span class="badge violet">${DB.ROLE_LABEL[u.role]}</span>` : u.role === "auditor" ? `<span class="badge amber">${DB.ROLE_LABEL[u.role]}</span>` : `<span class="badge ${u.role === "admin" ? "cyan" : u.role === "ops" ? "blue" : "slate"}">${DB.ROLE_LABEL[u.role]}</span>`}</td>
        <td>${u.quota[1] ? `<div class="bar-row"><span class="bar ${pct > 85 ? "amber" : ""}"><i style="width:${pct}%"></i></span><span class="val">${pct}%</span></div>` : `<span class="dim">—</span>`}</td>
        <td>${UI.badge(u.status)}</td>
        <td class="num">${u.last ? (u.last < 60 ? u.last + " 分钟前" : u.last < 1440 ? Math.round(u.last / 60) + " 小时前" : Math.round(u.last / 1440) + " 天前") : "—"}</td>
        <td class="actions"><button class="btn btn-sm btn-ghost" data-action="user-drawer" data-user="${UI.esc(u.name)}">详情</button><a class="btn btn-sm btn-ghost" href="http://192.168.112.230:8080/ipa/login" target="_blank" rel="noopener">FreeIPA</a></td>
      </tr>`;
    }).join("");

    const offline = window.__API_ONLINE === false;
    const ldapOk = window.__LDAP_OK !== false;
    const roleMeta = {
      admin: ["平台管理员", "#22d3ee"], pi: ["课题组负责人", "#a78bfa"],
      ops: ["运维人员", "#60a5fa"], auditor: ["审计员", "#f472b6"], user: ["普通用户", "#64748b"]
    };
    const roleCounts = {};
    DB.USERS.forEach((u) => { roleCounts[u.role] = (roleCounts[u.role] || 0) + 1; });
    const roleSegs = Object.keys(roleMeta).filter((k) => roleCounts[k]).map((k) => ({ label: roleMeta[k][0], value: roleCounts[k], color: roleMeta[k][1] }));
    const roleDonut = C.donut(roleSegs, { size: 128, thickness: 13, center: `<b>${DB.USERS.length}</b><small>账号</small>` });
    const roleLegend = roleSegs.map((s) => `<div class="legend-row"><i style="background:${s.color}"></i>${s.label}<span class="v">${s.value}</span></div>`).join("");
    const activeUsers = DB.USERS.filter((u) => u.status === "active").length;
    const sourcePanel = `<div class="mini-list">
      <div class="mini-row"><span class="lbl">身份源</span><span class="val">FreeIPA LDAP</span></div>
      <div class="mini-row"><span class="lbl">目录地址</span><span class="val mono">ldap://192.168.112.230:389</span></div>
      <div class="mini-row"><span class="lbl">同步方式</span><span class="val">只读 · 即时查询</span></div>
      <div class="mini-row"><span class="lbl">开户 / 禁用</span><span class="val">在 FreeIPA 执行</span></div>
    </div><div class="divider" style="margin:12px 0"></div><div class="callout">${UI.icon("info", 15)}<span>FreeIPA 通过平台网关访问，使用 FreeIPA 账号登录后进入管理后台。</span></div><a class="btn btn-sm btn-ghost" style="width:100%;margin-top:8px" href="http://192.168.112.230:8080/ipa/login" target="_blank" rel="noopener">${UI.icon("external", 14)}打开 FreeIPA 管理</a>`;

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "管理 · 用户与账户",
        title: "用户与账户",
        sub: "LDAP（FreeIPA）为权威身份源，平台只读；开户与变更直接在 FreeIPA 执行，平台即时查询。",
        actions: `<a class="btn btn-ghost" href="http://192.168.112.230:8080/ipa/login" target="_blank" rel="noopener">${UI.icon("external", 15)}FreeIPA 管理</a><button class="btn" data-action="export">${UI.icon("download", 15)}导出</button><button class="btn btn-primary" data-action="refresh-users">${UI.icon("refresh", 15)}立即同步</button>`
      })}
      <div class="stat-strip">
        <div class="stat-box"><span class="sl">注册用户</span><span class="sv">${DB.USERS.length}</span><span class="tiny dim">来自 FreeIPA LDAP</span></div>
        <div class="stat-box"><span class="sl">已启用</span><span class="sv">${activeUsers}</span><span class="tiny dim">未锁定账号</span></div>
        <div class="stat-box"><span class="sl">管理员</span><span class="sv">${roleCounts.admin || 0}</span><span class="tiny dim">hpc-admins 组</span></div>
        <div class="stat-box"><span class="sl">普通用户</span><span class="sv">${roleCounts.user || 0}</span><span class="tiny dim">hpc-users 组</span></div>
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-4", title: "角色分布", sub: `账号 · ${DB.USERS.length} 人`, body: `<div class="donut-flex">${roleDonut}<div class="donut-legend">${roleLegend}</div></div>` })}
        ${UI.panel({ class: "span-4", title: "身份源", sub: "FreeIPA → 平台（只读）", body: sourcePanel })}
        ${UI.panel({ class: "span-4", title: "目录同步", sub: "账号与角色以 FreeIPA 为准", body: `<div class="mini-list">
          <div class="mini-row"><span class="lbl">身份源</span><span class="val">FreeIPA LDAP</span></div>
          <div class="mini-row"><span class="lbl">目录查询</span><span class="val" style="color:${offline || !ldapOk ? "var(--red)" : "var(--green)"}">${offline || !ldapOk ? "不可用" : "正常"}</span></div>
          <div class="mini-row"><span class="lbl">角色来源</span><span class="val">hpc-* 组</span></div>
          <div class="mini-row"><span class="lbl">开户与变更</span><span class="val">FreeIPA Web</span></div>
        </div><div class="divider" style="margin:12px 0"></div><div class="callout">${UI.icon("lock", 15)}<span>平台只读身份数据；开户、禁用、重置 OTP 请在 FreeIPA 管理后台执行。</span></div>` })}
      </div>

      <div class="panel" style="padding:14px 16px">
        <div class="toolbar">
          ${UI.chips([{ key: "all", label: "全部", count: DB.USERS.length }, { key: "admin", label: "管理员", count: roleCounts.admin || 0 }, { key: "user", label: "普通用户", count: roleCounts.user || 0 }, { key: "pi", label: "PI", count: roleCounts.pi || 0 }, { key: "ops", label: "运维", count: roleCounts.ops || 0 }, { key: "auditor", label: "审计", count: roleCounts.auditor || 0 }], "all", "data-user-role")}
          <div class="grow"></div>
          <div class="field" style="min-width:250px"><input class="input" id="userSearch" placeholder="搜索姓名、uid、组、邮箱…" /></div>
        </div>
      </div>

      ${UI.panel({
        title: "用户列表",
        tag: `${DB.USERS.length} 用户`,
        sub: "身份与角色来自 FreeIPA；配额未接入时显示 —；停用账号的 Web 会话将在 TTL 内失效",
        body: `<div class="users-table">${UI.table([{ label: "用户" }, { label: "LDAP 组" }, { label: "角色" }, { label: "配额占用" }, { label: "状态" }, { label: "最近登录", cls: "num" }, { label: "", cls: "right" }], rows)}</div>`
      })}
      <div id="userEmpty" class="empty" hidden>没有匹配的用户，请调整搜索或角色筛选。</div>
      <div class="pager"><span>显示 1-${DB.USERS.length} / ${DB.USERS.length} 用户</span><span class="pages"><button class="pg active">1</button></span></div>
    </div>`;
  };

  /* ============================ user drawer ============================ */
  P.userDrawer = function (name) {
    const u = DB.USERS.find((x) => x.name === name) || DB.USERS[0];
    if (!u) return `<div class="drawer-head"><div><div class="drawer-title">用户不可用</div><div class="drawer-sub">用户目录未加载或该用户已不存在</div></div><button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button></div><div class="drawer-body"><div class="empty" style="padding:28px">请刷新用户目录后重试。</div></div>`;
    const pct = u.quota[1] ? Math.round((u.quota[0] / u.quota[1]) * 100) : 0;
    const jobs = DB.JOBS.filter((j) => j.username === u.username).slice(0, 3);
    return `<div class="drawer-head" style="border-top:3px solid #22d3ee">
      <div class="avatar" style="width:42px;height:42px;border-radius:13px">${UI.esc(u.name.slice(0, 1))}</div>
      <div><div class="drawer-title">${UI.esc(u.name)}</div><div class="drawer-sub">uid=${UI.esc(u.uid)} · ${UI.esc(u.group)}</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body">
      <div class="drawer-status-row">
        ${u.role === "pi" ? `<span class="badge violet">${DB.ROLE_LABEL[u.role]}</span>` : u.role === "auditor" ? `<span class="badge amber">${DB.ROLE_LABEL[u.role]}</span>` : `<span class="badge ${u.role === "admin" ? "cyan" : u.role === "ops" ? "blue" : "slate"}">${DB.ROLE_LABEL[u.role]}</span>`}
        ${UI.badge(u.status)}
        <span class="id-chip">FreeIPA 只读</span>
        <span class="drawer-temp">${u.last ? `最近登录 ${u.last < 60 ? u.last + " 分钟前" : u.last < 1440 ? Math.round(u.last / 60) + " 小时前" : Math.round(u.last / 1440) + " 天前"}` : "最近登录未提供"}</span>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">账户信息</div>
        <div class="spec-grid">
          <div class="spec-item"><small>用户名</small><b>${UI.esc(u.name)}</b></div>
          <div class="spec-item"><small>UID</small><b class="mono">${u.uid}</b></div>
          <div class="spec-item"><small>LDAP 组</small><b>${UI.esc(u.group)}</b></div>
          <div class="spec-item"><small>角色</small><b>${DB.ROLE_LABEL[u.role]}</b></div>
          <div class="spec-item"><small>邮箱</small><b>${UI.esc(u.email) || "—"}</b></div>
          <div class="spec-item"><small>认证方式</small><b>FreeIPA LDAP</b></div>
          <div class="spec-item"><small>组</small><b>${UI.esc((u.groups || []).join(", ")) || "—"}</b></div>
        </div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">GPU·h 使用<span>${u.quota[1] ? `${DB.fmt(u.quota[0])} / ${DB.fmt(u.quota[1])}` : "未提供"}</span></div>
        ${u.quota[1] ? `<div class="bar-row"><span class="bar ${pct > 85 ? "amber" : ""}" style="flex:1"><i style="width:${pct}%"></i></span><span class="val">${pct}%</span></div>` : `<div class="tiny dim">平台未从 FreeIPA 读取到登录与配额数据，不展示推测值。</div>`}
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">最近作业<span>最近 3 条</span></div>
        ${jobs.length ? `<div class="drawer-job" data-goto="#/jobs/${jobs[0].id}" style="margin-bottom:0">
          <span class="dj-ic">${UI.icon("jobs", 16)}</span>
          <div class="dj-main"><b>${UI.esc(jobs[0].name)}</b><small>${jobs[0].id} · ${jobs[0].gpus} 卡 · ${DB.dur(jobs[0].elapsed)}</small></div>
          <span class="badge ${UI.statusTone(jobs[0].state)}">${UI.statusLabel(jobs[0].state)}</span>
        </div><div class="mini-list" style="margin-top:8px">${jobs.slice(1).map((j) => `<div class="mini-row"><span class="lbl">${UI.esc(j.name)}</span><span class="val">${j.gpus} 卡</span><span class="tiny dim">${UI.statusLabel(j.state)}</span></div>`).join("")}</div>` : `<div class="empty" style="padding:16px">暂无近期作业</div>`}
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">权限与标签</div>
        <div class="chip-row"><span class="chip active">LDAP 用户</span><span class="chip active">OOD 访问</span><span class="chip active">Slurm 账户</span><span class="chip">${u.role === "admin" ? "平台管理" : "普通权限"}</span></div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">登录与安全</div>
        <div class="mini-list">
          <div class="mini-row"><span class="lbl">身份源</span><span class="val">FreeIPA LDAP</span></div>
          <div class="mini-row"><span class="lbl">密码 / OTP</span><span class="val">在 FreeIPA 中管理</span></div>
          <div class="mini-row"><span class="lbl">账户状态</span><span class="val">${u.status === "active" ? "启用" : "已锁定"}</span></div>
          <div class="mini-row"><span class="lbl">平台权限</span><span class="val">只读身份</span></div>
        </div>
      </div>
    </div>
    <div class="drawer-foot">
      <a class="btn btn-sm btn-primary" href="http://192.168.112.230:8080/ipa/login" target="_blank" rel="noopener">${UI.icon("external", 14)}在 FreeIPA 管理</a>
      <span class="tiny dim" style="margin-left:auto">修改密码、禁用账户、重置 OTP 均在 FreeIPA 执行</span>
    </div>`;
  };

  /* ============================ rules ============================ */
  P.rules = function () {
    const rulesOk = !(window.__DATA_OK && window.__DATA_OK.rules === false);
    const healthText = (v) => v === "ok" ? "正常" : v === "err" ? "异常" : (v || "—");
    const rows = DB.RULES.map((r) => `<tr>
      <td><span class="id-chip">${UI.esc(r.id)}</span></td>
      <td class="strong">${UI.esc(r.name)}</td>
      <td><span class="code">${UI.esc(r.expr)}</span></td>
      <td>${UI.severity(r.sev)}</td>
      <td class="num">${UI.esc(r.dur)}</td>
      <td class="num">${healthText(r.ver)}</td>
      <td><span class="badge ${r.on ? "green" : "slate"}">${r.on ? "已加载" : "不可用"}</span></td>
      <td class="muted tiny">${UI.esc(r.updated)}</td>
      <td class="actions"><button class="btn btn-sm btn-ghost" data-action="rule-drawer" data-id="${UI.esc(r.id)}">查看</button></td>
    </tr>`).join("");

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "管理 · 告警规则",
        title: "告警规则",
        sub: "只读展示 Prometheus rule files 中的当前规则；新增、编辑、停用请在 Prometheus/Alertmanager 配置中执行。",
        actions: `<button class="btn btn-ghost" data-goto="#/alerts">${UI.icon("alert", 15)}告警中心</button><a class="btn btn-primary" href="http://${window.__OBS_HOST || "192.168.112.230"}:9090/classic/rules" target="_blank" rel="noopener">${UI.icon("external", 15)}Prometheus 规则</a>`
      })}
      <div class="stat-strip">
        <div class="stat-box"><span class="sl">启用规则</span><span class="sv">${DB.RULES.filter((r) => r.on).length} <small>/ ${DB.RULES.length}</small></span><span class="tiny dim">Prometheus rule files</span></div>
        <div class="stat-box"><span class="sl">正在触发</span><span class="sv">${DB.ALERTS.filter((a) => a.state !== "resolved").length}</span><span class="tiny dim">严重 ${DB.ALERTS.filter((a) => a.sev === "critical" && a.state !== "resolved").length} · 警告 ${DB.ALERTS.filter((a) => a.sev === "warning" && a.state !== "resolved").length}</span></div>
        <div class="stat-box"><span class="sl">静默中</span><span class="sv">0</span><span class="tiny dim">当前无静默规则</span></div>
        <div class="stat-box"><span class="sl">数据源</span><span class="sv">Prometheus</span><span class="tiny dim">/api/v1/rules · 只读</span></div>
      </div>
      ${UI.panel({ title: "规则列表", tag: `${DB.RULES.length} 条规则`, sub: "Prometheus 当前加载的告警规则（只读）", body: DB.RULES.length ? UI.table([{ label: "ID" }, { label: "名称" }, { label: "表达式" }, { label: "级别" }, { label: "持续", cls: "num" }, { label: "健康", cls: "num" }, { label: "状态" }, { label: "最近评估" }, { label: "", cls: "right" }], rows) : `<div class="empty" style="padding:24px">${rulesOk ? "Prometheus 规则暂不可用，请检查 Prometheus 服务" : "规则接口加载失败，无法读取 Prometheus 规则"}</div>` })}
      <div class="callout">${UI.icon("info", 15)}<span>规则由 Prometheus 加载；平台只读展示。告警确认写入平台审计链，静默与通知路由在 Alertmanager 中配置。</span></div>
    </div>`;
  };

  P.ruleDrawer = function (id) {
    const r = DB.RULES.find((x) => x.id === id) || DB.RULES[0];
    if (!r) return `<div class="drawer-head"><div><div class="drawer-title">规则不可用</div><div class="drawer-sub">规则数据未加载或该规则已不存在</div></div><button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button></div><div class="drawer-body"><div class="empty" style="padding:28px">请刷新规则列表后重试。</div></div>`;
    const sevColor = r.sev === "critical" ? "#f87171" : r.sev === "warning" ? "#fbbf24" : "#60a5fa";
    const sevLabel = r.sev === "critical" ? "严重" : r.sev === "warning" ? "警告" : "信息";
    const ruleHealth = r.ver === "ok" ? "正常" : r.ver === "err" ? "异常" : (r.ver || "—");
    return `<div class="drawer-head" style="border-top:3px solid ${sevColor}">
      <div class="avatar" style="width:42px;height:42px;border-radius:13px;background:linear-gradient(135deg,${sevColor},#818cf8)">${UI.icon("rules", 19)}</div>
      <div><div class="drawer-title">${UI.esc(r.name)}</div><div class="drawer-sub">${UI.esc(r.id)} · 更新于 ${UI.esc(r.updated)}</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body">
      <div class="drawer-status-row">
        ${UI.severity(r.sev)}
        <span class="id-chip">${UI.esc(r.id)}</span>
        <span class="drawer-temp">持续 ${UI.esc(r.dur)}</span>
        <span class="badge ${r.on ? "green" : "slate"}" style="margin-left:auto">${r.on ? "已启用" : "已停用"}</span>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">触发表达式<span>PromQL</span></div>
        <div class="expr-block">${UI.esc(r.expr)}</div>
      </div>
      <div class="drawer-section">
        <div class="drawer-section-title">规则参数</div>
        <div class="spec-grid">
          <div class="spec-item"><small>级别</small><b>${sevLabel}</b></div>
          <div class="spec-item"><small>持续时间</small><b>${UI.esc(r.dur)}</b></div>
          <div class="spec-item"><small>作用域</small><b>GPU / 节点 / 平台</b></div>
          <div class="spec-item"><small>自动处置</small><b>由 Alertmanager 配置</b></div>
          <div class="spec-item"><small>规则组</small><b>${UI.esc(r.group) || "—"}</b></div>
          <div class="spec-item"><small>健康状态</small><b>${ruleHealth}</b></div>
        </div>
      </div>
      <div class="callout">${UI.icon("lock", 15)}<span>该页面为只读；规则变更请通过 Prometheus rule files 完成，平台不写入规则配置。</span></div>
    </div>
    <div class="drawer-foot">
      <a class="btn btn-sm btn-primary" href="http://${window.__OBS_HOST || "192.168.112.230"}:9090/classic/rules" target="_blank" rel="noopener">${UI.icon("external", 14)}在 Prometheus 查看规则</a>
      <a class="btn btn-sm" href="http://${window.__OBS_HOST || "192.168.112.230"}:9093/#/silences" target="_blank" rel="noopener">Alertmanager 静默</a>
    </div>`;
  };
  P.audit = function () {
    const auditLimit = Math.max(16, Number(window.__AUDIT_LIMIT) || 16);
    const rows = DB.AUDIT.slice(0, auditLimit).map((a) => {
      const at = a.ts ? new Date(a.ts) : new Date(Date.now() - Number(a.mins || 0) * 60000);
      const timeText = isNaN(at.getTime()) ? "时间未知" : `${at.toLocaleDateString("sv-SE")} ${at.toLocaleTimeString("zh-CN", { hour12: false })}`;
      return `<div class="audit-row" data-text="${UI.esc(a.action)} ${UI.esc(a.detail)} ${UI.esc(a.actor)} ${UI.esc(a.object)}">
      <span class="audit-time">${timeText}</span>
      <span class="audit-main"><b>${UI.esc(a.action)}</b> <span>${UI.esc(a.detail)}</span> <span class="id-chip">${UI.esc(a.object)}</span></span>
      <span class="audit-actor">${UI.avatar(UI.esc(a.actor))}${UI.esc(a.actor)} · ${UI.esc(DB.ROLE_LABEL[a.role] || a.role)}</span>
    </div>`;
    }).join("");
    const lastAudit = DB.AUDIT[0];
    const lastAuditDate = lastAudit ? (lastAudit.ts ? new Date(lastAudit.ts) : new Date(Date.now() - Number(lastAudit.mins || 0) * 60000)) : null;
    const lastAuditTime = lastAuditDate && !isNaN(lastAuditDate.getTime()) ? lastAuditDate.toLocaleString("zh-CN", { hour12: false }) : "—";
    const eventCounts = {
      write: DB.AUDIT.filter((a) => /操作|写入|提交|取消|删除|修改/.test(a.action)).length,
      auth: DB.AUDIT.filter((a) => /登录|认证|会话/.test(a.action)).length,
      config: DB.AUDIT.filter((a) => /配置|规则/.test(a.action)).length
    };

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "管理 · 审计日志",
        title: "审计日志",
        sub: "平台写操作审计统一检索；OOD 访问日志与 sacct 作业账本需在外部系统查询。只追加、哈希链校验，最多加载最近 200 条。",
        actions: `<button class="btn btn-ghost" data-action="export">${UI.icon("download", 15)}导出</button><button class="btn" data-action="verify-audit">${UI.icon("audit", 15)}校验哈希链</button>`
      })}
      ${window.__DATA_OK && window.__DATA_OK.audit === false ? `<div class="callout" style="margin-bottom:12px;border-color:var(--red)">${UI.icon("alert", 15)}<span>审计接口加载失败，当前列表为空不代表没有审计事件，请稍后重试。</span></div>` : ""}
      <div class="toolbar">
        ${UI.chips([{ key: "all", label: "全部", count: DB.AUDIT.length }, { key: "write", label: "写操作", count: eventCounts.write }, { key: "auth", label: "认证", count: eventCounts.auth }, { key: "config", label: "配置", count: eventCounts.config }], "all", "data-audit-filter")}
        <div class="grow"></div>
        <div class="field" style="min-width:260px"><input class="input" id="auditSearch" placeholder="搜索操作人、对象、动作…" /></div>
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-8", title: "审计事件", tag: `${DB.AUDIT.length} 条`, sub: "按时间倒序 · 可点击右上角校验哈希链", body: `<div class="audit-list" id="auditList">${rows}</div><div id="auditEmpty" class="empty" hidden style="margin-top:10px">没有匹配的审计事件。</div>` })}
        <div class="span-4 stack">
          ${UI.panel({ title: "完整性", body: `<div class="mini-list"><div class="mini-row"><span class="lbl">校验方式</span><span class="val">SHA-256 哈希链</span></div><div class="mini-row"><span class="lbl">已加载事件</span><span class="val">${DB.AUDIT.length}</span></div><div class="mini-row"><span class="lbl">最近事件</span><span class="val">${lastAuditTime}</span></div><div class="mini-row"><span class="lbl">数据源</span><span class="val">PostgreSQL audit_events</span></div></div><div class="divider" style="margin:12px 0"></div><button class="btn btn-sm btn-primary" data-action="verify-audit" style="width:100%">校验哈希链</button><div class="divider" style="margin:14px 0"></div><div class="callout">${UI.icon("lock", 15)}<span>审计表只追加；点击“校验哈希链”会实时调用后端 verify 接口并显示结果。</span></div>` })}
          ${UI.panel({ title: "审计来源", body: `<div class="mini-list"><div class="mini-row"><span class="lbl">平台后端</span><span class="val">已接入 · 写入 / 配置</span></div><div class="mini-row"><span class="lbl">OOD Apache</span><span class="val">未接入平台</span></div><div class="mini-row"><span class="lbl">sacct / slurmdbd</span><span class="val">未接入平台</span></div></div><div class="callout" style="margin-top:10px">${UI.icon("info", 15)}<span>当前审计页只展示平台自身写入的审计事件，不伪造 OOD 或 sacct 记录。</span></div>` })}
        </div>
      </div>
      ${DB.AUDIT.length > auditLimit ? `<div class="pager"><span>显示 1-${Math.min(auditLimit, DB.AUDIT.length)} / 已加载 ${DB.AUDIT.length} 条审计事件</span><span class="pages"><button class="pg" data-action="audit-more">加载更多</button></span></div>` : ""}
    </div>`;
  };

  /* ============================ system ============================ */
  P.system = function () {
    const offline = window.__API_ONLINE === false;
    const systemOk = !(window.__DATA_OK && window.__DATA_OK.system === false);
    const gpusOk = !(window.__DATA_OK && window.__DATA_OK.gpus === false) && !(window.__GPU_EMPTY === true);
    if (!DB.HEALTH.length) {
      return `<div class="page">
        ${UI.pageHead({
          eyebrow: "管理 · 系统状态",
          title: "系统状态",
          sub: "平台自监控（C-09）：控制面、身份、数据与可观测性组件的健康与延迟。",
          actions: `<button class="btn btn-ghost" data-action="runbook">${UI.icon("terminal", 15)}查看 Runbook</button><button class="btn btn-primary" data-action="recheck-system">${UI.icon("refresh", 15)}重新检测</button>`
        })}
        <div class="empty">${offline ? "后端不可用，无法读取系统健康状态。" : !systemOk ? "系统状态接口加载失败，无法读取组件健康数据。请稍后重新检测。" : "尚未采集到组件健康数据，请稍后重新检测。"}</div>
      </div>`;
    }
    const cards = DB.HEALTH.map((h) => `<div class="health-card">
      <div class="health-top"><span class="hi ${h.status === "warn" ? "bad" : ""}">${UI.icon(h.status === "warn" ? "alertCircle" : "check-circle", 17)}</span>
        <div><b>${h.name}</b><small>${h.role}</small></div>
        <span class="badge ${h.status === "warn" ? "amber" : "green"}" style="margin-left:auto">${h.status === "warn" ? "注意" : "正常"}</span></div>
      <div class="health-metrics"><div>延迟 <b>${h.latency} ms</b></div><div>可用性 <b>${h.uptime}</b></div><div style="grid-column:1/-1">实例 <b>${h.detail}</b></div></div>
    </div>`).join("");

    const serviceNodes = DB.NODES.map((n) => n.name).join(" / ") || "—";
    const centralMode = !!(window.__ACTIVE_CLUSTER && window.__ACTIVE_CLUSTER.oodHost);
    const oodDetail = centralMode ? "中心 A 集群" : serviceNodes;
    const identityDetail = centralMode ? "中心 A 网关" : serviceNodes;
    const healthState = (pattern) => {
      const hit = DB.HEALTH.find((h) => pattern.test(h.name || ""));
      return hit ? (hit.status === "warn" ? "warn" : "ok") : "unknown";
    };
    const topo = [
      ["身份接入", [["OOD Apache", oodDetail, healthState(/OOD/i)], ["Dex", identityDetail, healthState(/Dex/i)], ["FreeIPA", centralMode ? "中心 A LDAP" : serviceNodes, healthState(/FreeIPA/i)]]],
      ["作业控制面", [["scontrol agent", serviceNodes, healthState(/GPU agent/i)], ["slurmctld", serviceNodes, healthState(/Slurm/i)], ["slurmdbd", `${serviceNodes} · 6819`, healthState(/SlurmDBD/i)]]],
      ["可观测性", [["DCGM Exporter", serviceNodes, healthState(/DCGM Exporter/i)], ["Prometheus", `${serviceNodes} · 9090`, healthState(/Prometheus/i)], ["Alertmanager", "9093", healthState(/Alertmanager/i)]]],
      ["业务数据", [["BFF API", "REST API", "ok"], ["PostgreSQL", "读模型 + 审计", healthState(/PostgreSQL/i)]]]
    ].map(([label, nodes]) => `<div class="topo-lane"><span class="topo-label">${label}</span>${nodes.map((n, i) => `${i ? `<span class="topo-arrow">→</span>` : ""}<div class="topo-node ${n[2]}" title="${n[2] === "unknown" ? "该组件没有独立健康探测结果" : n[2] === "warn" ? "最近一次探测异常" : "最近一次探测正常"}"><span class="tn-dot"></span><div><b>${n[0]}</b><small>${n[1]}${n[2] === "unknown" ? " · 未探测" : ""}</small></div></div>`).join("")}</div>`).join("");
    const healthy = DB.HEALTH.filter((h) => h.status !== "warn").length;
    const healthPct = DB.HEALTH.length ? Math.round((healthy / DB.HEALTH.length) * 100) : 100;
    const failedComponents = DB.HEALTH.filter((h) => h.status === "warn").map((h) => h.name);
    const recentAudit = DB.AUDIT.slice(0, 5);
    const auditRows = recentAudit.length
      ? recentAudit.map((a) => `<div class="mini-row"><span class="lbl">${UI.esc(a.action)}</span><span class="val">${UI.esc(a.actor)}</span><span class="tiny dim">${UI.esc(a.detail).slice(0, 40)}</span></div>`).join("")
      : `<div class="mini-row"><span class="lbl">暂无审计事件</span><span class="val">—</span></div>`;
    const opsAudit = DB.AUDIT.filter((a) => ["admin", "ops"].includes(a.role)).slice(0, 5);
    const opsRows = opsAudit.length
      ? opsAudit.map((a) => `<div class="mini-row"><span class="lbl">${UI.esc(a.action)}</span><span class="val">${UI.esc(a.actor)}</span><span class="tiny dim">${UI.esc(a.detail).slice(0, 40)}</span></div>`).join("")
      : `<div class="mini-row"><span class="lbl">暂无运维操作</span><span class="val">—</span></div>`;

    return `<div class="page">
      ${UI.pageHead({
        eyebrow: "管理 · 系统状态",
        title: "系统状态",
        sub: "平台自监控（C-09）：控制面、身份、数据与可观测性组件的健康与延迟。",
        actions: `<button class="btn btn-ghost" data-action="runbook">${UI.icon("terminal", 15)}查看 Runbook</button><button class="btn btn-primary" data-action="recheck-system">${UI.icon("refresh", 15)}重新检测</button>`
      })}
      <div class="health-grid">${cards}</div>

      <div class="grid-12">
        ${UI.panel({ class: "span-8", title: "组件依赖拓扑", sub: "身份 → 控制面 → 数据 / 可观测性", extra: `<span class="tiny dim">3s 健康检查</span>`, body: `<div class="topo">${topo}</div>` })}
        ${UI.panel({ class: "span-4", title: "整体健康", sub: "实时健康检查", body: `<div class="ring-flex">${C.gauge(healthPct, { size: 118, label: "健康度", color: healthPct === 100 ? "#34d399" : "#fbbf24" })}<div class="mini-list"><div class="mini-row"><span class="lbl">服务健康</span><span class="val">${healthy} / ${DB.HEALTH.length}</span></div><div class="mini-row"><span class="lbl">失败组件</span><span class="val">${failedComponents.length ? failedComponents.join(" / ") : "无"}</span></div><div class="mini-row"><span class="lbl">数据源</span><span class="val">/api/v1/system/status</span></div></div></div><div class="divider" style="margin:14px 0"></div><div class="mini-row"><span class="lbl">依赖链路</span><span class="val">${DB.HEALTH.length} 个组件 · 实时探测</span></div>` })}
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-4", title: "备份状态", sub: "未接入平台", body: `<div class="mini-list">
          <div class="mini-row"><span class="lbl">slurmdbd 备份</span><span class="val">需在主机检查</span></div>
          <div class="mini-row"><span class="lbl">PostgreSQL 备份</span><span class="val">需在主机检查</span></div>
          <div class="mini-row"><span class="lbl">恢复演练</span><span class="val">未接入审计</span></div>
        </div><div class="divider" style="margin:14px 0"></div><div class="callout">${UI.icon("info", 15)}<span>平台当前只监控服务健康，不伪造备份成功状态。备份结果请以主机备份任务和 slurmdbd 日志为准。</span></div>` })}
        ${UI.panel({ class: "span-4", title: "证书检查", sub: "未接入平台", body: `<div class="mini-list">
          <div class="mini-row"><span class="lbl">OOD Apache</span><span class="val">需在主机核验</span></div>
          <div class="mini-row"><span class="lbl">FreeIPA CA</span><span class="val">由 IPA CA 签发</span></div>
          <div class="mini-row"><span class="lbl">平台入口</span><span class="val">HTTP 内网入口</span></div>
        </div><div class="divider" style="margin:14px 0"></div><div class="callout">${UI.icon("info", 15)}<span>平台未读取证书到期日期；OOD/Dex 证书请通过主机 openssl/getcert 核验，避免展示静态日期造成误判。</span></div>` })}
        ${UI.panel({ class: "span-4", title: "最近审计事件", body: `<div class="mini-list">${auditRows}</div>` })}
      </div>

      <div class="grid-12">
        ${UI.panel({ class: "span-6", title: "集群信息", body: UI.kv([["集群名称", DB.CLUSTER.name], ["GPU 服务器", gpusOk ? `${DB.NODES.map((n) => n.name).join(" / ")} · ${DB.TOTALS.gpus} 卡` : (window.__GPU_EMPTY ? "GPU Agent 尚未上报" : "GPU 指标接口加载失败")], ["Slurm 版本", "21.08.5"], ["OOD 版本", "4.1.7"], ["身份源", "FreeIPA + Dex LDAP"], ["状态", `<span class="badge green">生产环境</span>`]]) })}
        ${UI.panel({ class: "span-6", title: "最近运维事件", body: `<div class="mini-list">${opsRows}</div>` })}
      </div>
    </div>`;
  };
})();











