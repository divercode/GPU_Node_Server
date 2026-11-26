/* =========================================================
   App shell: navigation, hash router, filters, palette,
   drawer, chart tooltips and small prototype interactions.
   ========================================================= */
(function () {
  const UI = window.UI, DB = window.DB, Charts = window.Charts;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));

  // 公用前端 + 独立后端：单页前端通过 API 前缀访问不同集群，
  // 注意 fetch 包装必须在任何 API 请求之前安装。
  const CLUSTER_KEY = "hpc-cluster";
  const clusterList = () => (DB.CLUSTERS || []).filter((c) => c && c.name);
  const savedCluster = (() => { try { return localStorage.getItem(CLUSTER_KEY) || ""; } catch (e) { return ""; } })();
  const activeCluster = clusterList().find((c) => c.name === savedCluster) || clusterList()[0] || { name: DB.CLUSTER.name, apiPrefix: "" };
  const API_PREFIX = activeCluster.apiPrefix || "";
  window.__ACTIVE_CLUSTER = activeCluster;
  window.__OBS_HOST = activeCluster.host || "192.168.112.230";
  window.__OOD_HOST = activeCluster.oodHost || activeCluster.host || "192.168.112.230";
  try {
    DB.CLUSTER.name = activeCluster.name;
    if (activeCluster.env) DB.CLUSTER.env = activeCluster.env;
    (DB.NODES || []).forEach((n) => { if (activeCluster.host) n.ip = activeCluster.host; });
  } catch (e) { /* ignore */ }
  window.__API_PREFIX = API_PREFIX;
  const crumbCluster = document.querySelector("#crumbCluster");
  if (crumbCluster) crumbCluster.textContent = activeCluster.name;
  const initialClusterName = document.querySelector("#clusterSwitcher .cp-text b");
  if (initialClusterName) initialClusterName.textContent = activeCluster.name;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    if (typeof input === "string" && input.startsWith("/api/")) input = API_PREFIX + input;
    return nativeFetch(input, init);
  };

  const NAV = [
    { group: "总览", items: [{ id: "entrance", label: "统一入口", icon: "globe" }, { id: "dashboard", label: "工作台", icon: "dashboard" }] },
    { group: "资源与作业", items: [{ id: "catalog", label: "资源目录", icon: "catalog", roles: ["admin", "ops", "pi", "user"] }, { id: "jobs", label: "作业中心", icon: "jobs", roles: ["admin", "ops", "pi", "user"] }] },
    { group: "监控", items: [
      { id: "monitor", label: "集群总览", icon: "monitor", roles: ["admin", "ops", "auditor"] },
      { id: "gpus", label: "GPU 监控", icon: "gpu", roles: ["admin", "ops"] },
      { id: "alerts", label: "告警中心", icon: "alert", roles: ["admin", "ops", "auditor"] }
    ] },
    { group: "计量", items: [{ id: "usage", label: "资源用量", icon: "usage", roles: ["admin", "ops", "pi", "user", "auditor"] }] },
    { group: "管理", items: [
      { id: "users", label: "用户与账户", icon: "users", roles: ["admin", "ops"] },
      { id: "rules", label: "告警规则", icon: "rules", roles: ["admin", "ops"] },
      { id: "audit", label: "审计日志", icon: "audit", roles: ["admin", "ops", "auditor"] },
      { id: "system", label: "系统状态", icon: "system", roles: ["admin", "ops"] }
    ] }
  ];
  const ROLE_LABEL = { admin: "平台管理员", ops: "运维人员", pi: "课题组负责人", user: "普通用户", auditor: "审计只读" };
  const ROUTE_ROLES = {
    entrance: ["admin", "ops", "pi", "user", "auditor"],
    dashboard: ["admin", "ops", "pi", "user", "auditor"],
    catalog: ["admin", "ops", "pi", "user"],
    jobs: ["admin", "ops", "pi", "user"],
    monitor: ["admin", "ops", "auditor"],
    gpus: ["admin", "ops"],
    alerts: ["admin", "ops", "auditor"],
    rules: ["admin", "ops"],
    usage: ["admin", "ops", "pi", "user", "auditor"],
    users: ["admin", "ops"],
    audit: ["admin", "ops", "auditor"],
    system: ["admin", "ops"]
  };
  let ME = null;
  function roles() {
    return ME && ME.roles && ME.roles.length ? ME.roles : ["admin", "ops", "pi", "user", "auditor"];
  }
  function can(route) {
    if (!ME) return true;
    const allowed = ROUTE_ROLES[route] || ["admin"];
    return allowed.some((r) => roles().includes(r));
  }
  const TITLES = {
    entrance: "统一入口", dashboard: "工作台", catalog: "资源目录", jobs: "作业中心", monitor: "集群总览", gpus: "GPU 监控",
    alerts: "告警中心", rules: "告警规则", usage: "资源用量",
    users: "用户与账户", audit: "审计日志", system: "系统状态"
  };
  const ACTIONS = [
    { label: "提交作业", hint: "资源目录 · 快速提交", icon: "plus", go: "#/catalog" },
    { label: "切换主题", hint: "深色 / 浅色", icon: "rules", act: "theme" },
    { label: "导出日报", hint: "导出当前集群日报", icon: "download", act: "export-daily" },
    { label: "告警中心", hint: "查看未恢复告警", icon: "alert", go: "#/alerts" },
    { label: "系统状态", hint: "平台自监控", icon: "system", go: "#/system" }
  ];
  function scopedStorageKey(base) {
    const cluster = (window.__ACTIVE_CLUSTER && window.__ACTIVE_CLUSTER.name) || "GPU-Prod-01";
    const user = (window.__ME && window.__ME.username) || "anonymous";
    return `${base}:${cluster}:${user}`;
  }
  function jobHistoryKey() { return scopedStorageKey("hpc-job-history"); }
  function jobTemplateKey() { return scopedStorageKey("hpc-job-template"); }

  const view = $("#view");
  let progressTimer = null;
  function startProgress() {
    const bar = $("#routeProgress");
    if (!bar) return;
    clearTimeout(progressTimer);
    bar.classList.add("on");
    bar.style.opacity = "1";
    bar.style.width = "14%";
    requestAnimationFrame(() => { bar.style.width = "66%"; });
  }
  function finishProgress() {
    const bar = $("#routeProgress");
    if (!bar) return;
    clearTimeout(progressTimer);
    bar.style.width = "100%";
    progressTimer = setTimeout(() => {
      bar.style.opacity = "0";
      progressTimer = setTimeout(() => { bar.style.width = "0"; bar.classList.remove("on"); }, 320);
    }, 130);
  }
  const drawer = $("#drawer");
  const drawerOverlay = $("#drawerOverlay");

  /* ---------------- sidebar ---------------- */
  function renderNav() {
    const nav = $("#nav");
    if (!nav) return;
    nav.innerHTML = NAV.map((g) => {
      const items = g.items.filter((it) => !it.roles || !ME || it.roles.some((r) => roles().includes(r)));
      if (!items.length) return "";
      return `<div class="nav-group">${g.group}</div>` + items.map((it) => {
        const badge = it.id === "alerts" ? DB.TOTALS.criticalAlerts : it.badge;
        return `<a class="nav-item" href="#/${it.id}" data-nav="${it.id}" title="${it.label}">${UI.icon(it.icon, 18)}<span class="label">${it.label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ""}</a>`;
      }).join("");
    }).join("");
  }

  function setActive(route) {
    const target = route === "jobs" ? "jobs" : route;
    $$(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.nav === target));
    $$(".mobile-tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.mobile === target));
  }

  /* ---------------- router ---------------- */
  function parse() {
    const h = (location.hash || "#/dashboard").replace(/^#\/?/, "");
    const parts = h.split("/").filter(Boolean);
    return { route: parts[0] || "dashboard", param: parts[1] || "" };
  }

  function skeletonPage() {
    const cards = Array.from({ length: 6 }).map(() => `<div class="panel skeleton-panel">
      <div class="skeleton" style="width:42%;height:11px"></div>
      <div class="skeleton" style="width:58%;height:28px;margin:15px 0 12px"></div>
      <div class="skeleton" style="width:34%;height:10px"></div>
    </div>`).join("");
    return `<div class="page">
      <div class="page-head"><div>
        <div class="skeleton" style="width:132px;height:11px;margin-bottom:13px"></div>
        <div class="skeleton" style="width:min(280px,60vw);height:32px;margin-bottom:11px"></div>
        <div class="skeleton" style="width:min(520px,78vw);height:13px"></div>
      </div></div>
      <div class="kpi-grid">${cards}</div>
      <div class="grid-12">
        <div class="span-8 panel"><div class="skeleton" style="width:150px;height:12px;margin-bottom:16px"></div><div class="skeleton" style="height:252px"></div></div>
        <div class="span-4 panel"><div class="skeleton" style="width:104px;height:12px;margin-bottom:16px"></div><div class="skeleton" style="height:252px"></div></div>
      </div>
    </div>`;
  }

  function updateChromeStats() {
    const util = DB.TOTALS.utilization || 0;
    const label = $("#sideUtilVal");
    if (label) label.textContent = util + "%";
    const bar = $("#sideUtilBar");
    if (bar) bar.style.width = util + "%";
  }

  let lastViewKey = "";

  function morphDom(oldNode, newNode) {
    if (!oldNode || !newNode) return;
    if (oldNode.nodeType !== newNode.nodeType || oldNode.nodeName !== newNode.nodeName) {
      if (oldNode.parentNode) oldNode.parentNode.replaceChild(newNode.cloneNode(true), oldNode);
      return;
    }
    if (oldNode.nodeType === 3) {
      if (oldNode.nodeValue !== newNode.nodeValue) oldNode.nodeValue = newNode.nodeValue;
      return;
    }
    if (oldNode.nodeType !== 1) return;
    // 属性就地更新，避免整页重绘。
    const oldAttrs = Array.from(oldNode.attributes || []);
    const newAttrs = Array.from(newNode.attributes || []);
    const newNames = new Set(newAttrs.map((a) => a.name));
    oldAttrs.forEach((a) => { if (!newNames.has(a.name)) oldNode.removeAttribute(a.name); });
    newAttrs.forEach((a) => {
      if (oldNode.getAttribute(a.name) !== a.value) oldNode.setAttribute(a.name, a.value);
    });
    // 子节点按位置做轻量 diff；页面结构通常稳定，保留已有 DOM 与事件监听。
    const oldKids = Array.from(oldNode.childNodes);
    const newKids = Array.from(newNode.childNodes);
    const count = Math.max(oldKids.length, newKids.length);
    for (let i = 0; i < count; i++) {
      const oldKid = oldKids[i];
      const newKid = newKids[i];
      if (!oldKid && newKid) oldNode.appendChild(newKid.cloneNode(true));
      else if (oldKid && !newKid) oldNode.removeChild(oldKid);
      else morphDom(oldKid, newKid);
    }
  }

  function render(soft) {
    const { route, param } = parse();
    if (!can(route)) {
      location.hash = "#/dashboard";
      return;
    }
    const viewKey = route + "|" + param;
    if (!soft) startProgress();
    let html = "", title = TITLES[route] || "工作台", active = route;
    try {
      const demoParam = new URLSearchParams(location.search).get("demo");
      if (demoParam === "error") throw new Error("演示：组件数据加载超时（error-demo）");
      if (demoParam === "loading") html = skeletonPage();
      else if (route === "dashboard") html = Pages.dashboard();
      else if (route === "entrance") html = Pages.entrance();
      else if (route === "catalog") html = Pages.catalog();
      else if (route === "jobs" && param) { html = Pages.jobDetail(param); title = "作业详情"; active = "jobs"; }
      else if (route === "jobs") html = Pages.jobs();
      else if (route === "monitor") html = Pages.monitor();
      else if (route === "gpus") html = Pages.gpus();
      else if (route === "alerts") html = Pages.alerts();
      else if (route === "rules") html = Pages.rules();
      else if (route === "usage") html = Pages.usage();
      else if (route === "users") html = Pages.users();
      else if (route === "audit") html = Pages.audit();
      else if (route === "system") html = Pages.system();
      else html = notFound();
    } catch (err) {
      console.error(err);
      soft = false;
      html = `<div class="page"><div class="error-state">
        <div class="es-icon">${UI.icon("alertCircle", 28)}</div>
        <h2>页面加载失败</h2>
        <p>该页面渲染时发生异常。可以重新加载；若问题持续，请保留下方错误信息并联系平台管理员。</p>
        <div class="row gap-8"><button class="btn btn-primary" data-action="refresh">${UI.icon("refresh", 15)}重新加载</button><button class="btn" data-goto="#/dashboard">返回工作台</button></div>
        <div class="error-meta">${route} · ${String(err && err.message || err)}</div>
      </div></div>`;
    }
    if (soft && viewKey === lastViewKey && view.firstElementChild) {
      // 轮询/SSE 刷新：只更新变化的文本、属性和节点，保留滚动位置和页面 DOM。
      const tpl = document.createElement("template");
      tpl.innerHTML = html;
      const fresh = tpl.content.firstElementChild;
      if (fresh) {
        morphDom(view.firstElementChild, fresh);
        $("#crumb").textContent = title;
        setActive(active);
        settleCounts();
        updateChromeStats();
        return;
      }
    }
    Charts.reset();
    view.innerHTML = html;
    lastViewKey = viewKey;
    if (route === "system") setTimeout(hydrateIpStatus, 0);
    $("#crumb").textContent = title;
    setActive(active);
    document.title = title + " · 星轨算力";
    window.scrollTo({ top: 0, behavior: "instant" });
    bind();
    animateCounts();
    updateChromeStats();
    finishProgress();
  }

  function settleCounts() {
    $$("[data-count]").forEach((el) => {
      const target = parseFloat(el.dataset.count);
      const dec = parseInt(el.dataset.decimals || "0", 10);
      if (isFinite(target)) el.textContent = target.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    });
  }

  function animateCounts() {
    if (document.documentElement.classList.contains("no-anim")) {
      settleCounts();
      return;
    }
    $$("[data-count]").forEach((el) => {
      const target = parseFloat(el.dataset.count);
      if (!isFinite(target)) return;
      const dec = parseInt(el.dataset.decimals || "0", 10);
      const t0 = performance.now();
      const dur = 760;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * e).toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function notFound() {
    return `<div class="page"><div class="panel">
      <div class="panel-title">页面不存在</div>
      <div class="panel-sub">请从左侧导航选择一个模块。</div>
      <div style="margin-top:14px"><a class="btn btn-primary" href="#/dashboard">返回工作台</a></div>
    </div></div>`;
  }

  function syncOverlayLock() {
    const drawerOpen = drawer.classList.contains("open");
    const modalOpen = !$("#modalOverlay").hidden;
    const palOpen = !$("#paletteOverlay").hidden;
    document.body.classList.toggle("overlay-open", drawerOpen || modalOpen || palOpen);
  }
  window.syncOverlayLock = syncOverlayLock;

  /* ---------------- drawer ---------------- */
  let drawerReturnFocus = null;
  function openDrawer(html) {
    if (!html) {
      UI.toast("数据已变化，请刷新后重试", "warn");
      return;
    }
    drawerReturnFocus = document.activeElement;
    drawer.innerHTML = html;
    drawer.classList.add("open");
    drawerOverlay.classList.add("open");
    syncOverlayLock();
    setTimeout(() => { const b = $(".drawer-close"); if (b) b.focus(); }, 70);
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    drawerOverlay.classList.remove("open");
    syncOverlayLock();
    if (drawerReturnFocus && drawerReturnFocus.focus) drawerReturnFocus.focus();
    drawerReturnFocus = null;
  }

  function openSettingsDrawer() {
    const me = window.__ME || {};
    const role = me.role_label || me.primary_role || "普通用户";
    const theme = document.documentElement.dataset.theme || "dark";
    const settings = (() => {
      try { return JSON.parse(localStorage.getItem("hpc-user-settings") || "{}"); } catch (e) { return {}; }
    })();
    const notifyOn = settings.notify !== false;
    openDrawer(`<div class="drawer-head" style="border-top:3px solid var(--cyan)">
      <div><div class="eyebrow">账户 · 个人设置</div><h3>${UI.esc(me.display_name || me.username || "个人设置")}</h3><div class="drawer-sub">${UI.esc(me.email || me.username || "")} · ${UI.esc(role)}</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body">
      ${UI.panel({ title: "账户信息", sub: "身份由 FreeIPA / Dex 管理", body: `<div class="mini-list">
        <div class="mini-row"><span class="lbl">登录名</span><span class="val">${UI.esc(me.username || "—")}</span></div>
        <div class="mini-row"><span class="lbl">显示名</span><span class="val">${UI.esc(me.display_name || "—")}</span></div>
        <div class="mini-row"><span class="lbl">角色</span><span class="val">${UI.esc(role)}</span></div>
        <div class="mini-row"><span class="lbl">认证方式</span><span class="val">${UI.esc(me.auth_mode === "proxy" ? "OIDC / FreeIPA" : "本地认证")}</span></div>
        <div class="mini-row"><span class="lbl">邮箱</span><span class="val">${UI.esc(me.email || "—")}</span></div>
      </div>` })}
      <div style="height:14px"></div>
      ${UI.panel({ title: "外观", sub: "立即生效并保存到当前浏览器", body: `<div class="row gap-8">
        <button class="btn ${theme === "dark" ? "btn-primary" : ""}" data-settings-theme="dark">深色主题</button>
        <button class="btn ${theme === "light" ? "btn-primary" : ""}" data-settings-theme="light">浅色主题</button>
      </div>` })}
      <div style="height:14px"></div>
      ${UI.panel({ title: "通知偏好", sub: "仅影响当前浏览器", body: `<label class="row gap-8" style="cursor:pointer"><input type="checkbox" id="settingsNotify" ${notifyOn ? "checked" : ""}/><span>显示高优先级告警提醒</span></label>` })}
      <div class="row gap-8" style="margin-top:18px">
        <button class="btn btn-primary" data-action="save-settings">${UI.icon("check", 15)}保存设置</button>
        <button class="btn" data-drawer-close>取消</button>
      </div>
    </div>`);
  }

  function saveUserSettings() {
    const theme = document.documentElement.dataset.theme || "dark";
    const notify = !!(document.getElementById("settingsNotify") && document.getElementById("settingsNotify").checked);
    try { localStorage.setItem("hpc-user-settings", JSON.stringify({ theme, notify })); } catch (e) { /* ignore */ }
    try { localStorage.setItem("hpc-theme", theme); } catch (e) { /* ignore */ }
    closeDrawer();
    UI.toast("个人设置已保存", "ok");
  }

  function openApiTokenInfo() {
    openDrawer(`<div class="drawer-head" style="border-top:3px solid var(--violet)">
      <div><div class="eyebrow">账户 · API Token</div><h3>API Token</h3><div class="drawer-sub">平台当前使用 OIDC / FreeIPA 会话，不开放个人长期 Token。</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body"><div class="callout">${UI.icon("lock", 15)}<span>如需程序化访问，请联系平台管理员在 FreeIPA 中创建服务账号，或使用 OIDC 客户端凭据。</span></div></div>`);
  }

  function openRunbook() {
    const health = DB.HEALTH || [];
    const rows = health.length ? health.map((h) => `<div class="mini-row">
      <span class="lbl">${UI.esc(h.name)}</span>
      <span class="val" style="color:${h.status === "warn" ? "var(--amber)" : "var(--green)"}">${h.status === "warn" ? "需要处理" : "正常"} · ${h.latency} ms</span>
    </div>`).join("") : `<div class="mini-row"><span class="lbl">暂无组件数据</span><span class="val">—</span></div>`;
    openDrawer(`<div class="drawer-head" style="border-top:3px solid var(--cyan)">
      <div><div class="eyebrow">管理 · 系统状态</div><h3>平台 Runbook</h3><div class="drawer-sub">按当前健康检查结果排序的排障入口</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body">
      ${UI.panel({ title: "组件健康", sub: "最近一次探测", body: `<div class="mini-list">${rows}</div>` })}
      <div class="divider" style="margin:14px 0"></div>
      <div class="panel-sub">常用检查命令</div>
      <pre style="white-space:pre-wrap;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:12px;font:11px/1.8 var(--mono);color:var(--text-2);margin-top:8px">systemctl status starrail-agent
curl -s http://127.0.0.1:8080/api/v1/health
nvidia-smi
squeue
journalctl -u starrail-agent -n 100</pre>
      <div class="divider" style="margin:14px 0"></div>
      <div class="callout">${UI.icon("info", 15)}<span>“重新检测”会实时请求后端健康接口；如果某个组件显示“需要处理”，先检查对应服务和端口。</span></div>
    </div>`);
  }

  /* ---------------- command palette ---------------- */
  let paletteIndex = 0, paletteItems = [];
  function paletteData() {
    const nav = NAV.flatMap((g) => g.items.filter((it) => can(it.id)).map((it) => ({ label: it.label, hint: g.group, icon: it.icon, go: "#/" + it.id, group: "页面" })));
    const canExportDaily = !ME || (ME.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
    const acts = ACTIONS.filter((a) => {
      if (a.act === "export-daily") return canExportDaily;
      return !a.go || can(a.go.replace(/^#\//, ""));
    });
    return nav.concat(acts.map((a) => ({ ...a, group: "操作" })));
  }
  function openPalette() {
    $("#paletteOverlay").hidden = false;
    $("#paletteInput").value = "";
    renderPalette("");
    syncOverlayLock();
    setTimeout(() => $("#paletteInput").focus(), 20);
  }
  function closePalette() { $("#paletteOverlay").hidden = true; syncOverlayLock(); }
  function renderPalette(q) {
    const query = q.trim().toLowerCase();
    paletteItems = paletteData().filter((it) => !query || (it.label + " " + (it.hint || "")).toLowerCase().includes(query));
    paletteIndex = 0;
    if (!paletteItems.length) {
      $("#paletteList").innerHTML = `<div class="empty" style="border:0"><div style="margin-bottom:6px">${UI.icon("search", 20)}</div>没有匹配的页面或操作<br><span class="tiny dim">试试：GPU、作业、主题</span></div>`;
      return;
    }
    let html = "", lastGroup = "";
    paletteItems.forEach((it, i) => {
      if (it.group !== lastGroup) { html += `<div class="palette-group">${it.group}</div>`; lastGroup = it.group; }
      html += `<div class="palette-item ${i === 0 ? "active" : ""}" data-index="${i}">
        <span class="pi-ic">${UI.icon(it.icon || "search", 15)}</span><span class="pi-t"><b>${it.label}</b><small>${it.hint || ""}</small></span>
        <span class="tiny dim">${it.group === "页面" ? "↵" : "执行"}</span>
      </div>`;
    });
    $("#paletteList").innerHTML = html;
  }
  function runPaletteItem(it) {
    closePalette();
    if (it.go) {
      if (location.hash === it.go) render();
      else location.hash = it.go;
    } else if (it.act === "theme") toggleTheme();
    else if (it.act === "export-daily") exportCurrentView("dashboard");
    else if (it.act === "export") exportCurrentView();
  }

  /* ---------------- popovers (notifications / account) ---------------- */
  function makePopover(id, html) {
    const el = document.createElement("div");
    el.className = "popover";
    el.id = id;
    el.innerHTML = html;
    el.addEventListener("click", (e) => { if (e.target.closest("[data-action],[data-goto]")) closePopovers(); });
    document.body.appendChild(el);
    return el;
  }
  function closePopovers() { $$(".popover").forEach((p) => p.classList.remove("open")); }
  function togglePopover(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const open = !el.classList.contains("open");
    closePopovers();
    if (open) el.classList.add("open");
  }
  function readAlertsKey() {
    const cluster = (window.__ACTIVE_CLUSTER && window.__ACTIVE_CLUSTER.name) || "GPU-Prod-01";
    const user = (window.__ME && window.__ME.username) || "anonymous";
    return `hpc-read-alerts:${cluster}:${user}`;
  }
  let readAlertIds = new Set();
  let readAlertsLoadedFor = null;
  function loadReadAlerts() {
    readAlertsLoadedFor = readAlertsKey();
    try { readAlertIds = new Set(JSON.parse(localStorage.getItem(readAlertsLoadedFor) || "[]").map(String)); } catch (e) { readAlertIds = new Set(); }
  }
  loadReadAlerts();
  function saveReadAlerts() {
    try { localStorage.setItem(readAlertsKey(), JSON.stringify([...readAlertIds].slice(-500))); } catch (e) { /* ignore */ }
  }
  function notifyCriticalEnabled() {
    try {
      const settings = JSON.parse(localStorage.getItem("hpc-user-settings") || "{}");
      return settings.notify !== false;
    } catch (e) { return true; }
  }
  function notifAlerts() {
    return notifyCriticalEnabled() ? DB.ALERTS : DB.ALERTS.filter((a) => a.sev !== "critical");
  }
  function unreadAlertCount() {
    return notifAlerts().filter((a) => !readAlertIds.has(String(a.id))).length;
  }
  function notifHTML() {
    const alerts = notifAlerts().slice(0, 4).map((a) => {
      const ic = a.sev === "critical" ? "alert" : a.sev === "warning" ? "alertCircle" : "info";
      const read = readAlertIds.has(String(a.id));
      return `<div class="pop-item ${read ? "read" : "unread"}" data-goto="#/alerts">
        <span class="pop-ic ${a.sev}">${UI.icon(ic, 13)}</span>
        <div class="pop-main"><b>${UI.esc(a.title)}</b><small>${UI.esc(a.node)} · ${DB.ago(a.time)} · ${UI.statusLabel(a.state)}</small></div>
        <span class="pop-time">${DB.ago(a.time)}</span>
      </div>`;
    }).join("");
    const unreadCount = unreadAlertCount();
    return `<div class="pop-head"><span class="pop-title">${UI.icon("alert", 15)}通知 <span class="pop-unread" id="notifUnread">${unreadCount}</span></span><span class="tiny dim">最近 24h</span></div>
      <div class="pop-tabs"><button class="pop-tab active" data-notif-tab="all">全部</button><button class="pop-tab" data-notif-tab="unread">未读 <span class="count">${unreadCount}</span></button></div>
      <div class="pop-list" id="notifList">${alerts || `<div class="pop-empty">${notifyCriticalEnabled() ? "暂无真实告警" : "高优先级告警提醒已关闭"}</div>`}</div>
      <div class="pop-foot"><button class="btn btn-sm btn-ghost" data-goto="#/alerts">查看全部告警</button><button class="btn btn-sm" id="notifMarkAll">全部标记已读</button></div>`;
  }
  function bindNotifEvents(notif) {
    $$("[data-notif-tab]", notif).forEach((b) => b.addEventListener("click", () => {
      $$("[data-notif-tab]", notif).forEach((x) => x.classList.toggle("active", x === b));
      const unreadOnly = b.dataset.notifTab === "unread";
      $$(".pop-item", notif).forEach((it) => { it.style.display = !unreadOnly || it.classList.contains("unread") ? "" : "none"; });
    }));
    const markAll = document.getElementById("notifMarkAll");
    if (markAll) markAll.addEventListener("click", () => {
      DB.ALERTS.forEach((a) => readAlertIds.add(String(a.id)));
      saveReadAlerts();
      const bell = document.getElementById("bellBtn");
      if (bell) bell.classList.toggle("has-dot", unreadAlertCount() > 0);
      refreshNotificationPopover();
      UI.toast("通知已全部标记为已读", "info");
    });
  }
  function refreshNotificationPopover() {
    const notif = document.getElementById("notifPop");
    if (!notif) return;
    const wasOpen = notif.classList.contains("open");
    notif.innerHTML = notifHTML();
    bindNotifEvents(notif);
    if (wasOpen) notif.classList.add("open");
  }
  function initPopovers() {
    makePopover("notifPop", notifHTML());
    makePopover("userPop", `<div class="pop-menu">
      <div class="pop-profile">
        <span class="avatar pop-avatar" id="popAvatar">林</span>
        <div class="pp-main"><b><span id="popName">林予安</span> <span class="badge cyan" id="popRole" style="height:18px;font-size:9px">平台管理员</span></b><small id="popEmail">linya@hpc.local · 平台组</small><span class="pp-online"><i></i><span id="popSession">会话</span></span></div>
      </div>
      <div class="pp-quota"><div class="between tiny dim"><span>近 30 天 GPU·h</span><span id="popGpuHours">${DB.fmt(DB.TOTALS.gpuHoursMonth)}</span></div><div class="bar"><i id="popUtilBar" style="width:${DB.TOTALS.utilization}%"></i></div><div class="between tiny" style="color:var(--dim)"><span id="popUtilLabel">GPU 分配率</span><span id="popUtilPct">${DB.TOTALS.utilization}%</span></div></div>
      <div class="pop-section-label">账户</div>
      <button class="pop-menu-item" data-action="settings">${UI.icon("settings", 16)}个人设置<span class="shortcut">Ctrl ,</span></button>
      <button class="pop-menu-item" data-action="token-info">${UI.icon("key", 16)}API Token</button>
      <button class="pop-menu-item" data-goto="#/audit">${UI.icon("audit", 16)}审计日志</button>
      <div class="pop-section-label">偏好</div>
      <button class="pop-menu-item" data-action="theme">${UI.icon("monitor", 16)}切换主题<span class="shortcut">深 / 浅</span></button>
      <button class="pop-menu-item" data-action="shortcuts">${UI.icon("terminal", 16)}键盘快捷键<span class="shortcut">?</span></button>
      <button class="pop-menu-item" data-action="settings">${UI.icon("alert", 16)}通知设置</button>
      <div class="pop-menu-foot"><span>v0.4 · 生产环境</span><button class="btn btn-sm btn-ghost" data-action="logout">${UI.icon("logout", 14)}退出登录</button></div>
    </div>`);
    const notif = document.getElementById("notifPop");
    if (notif) bindNotifEvents(notif);
  }

  /* ---------------- theme & sidebar ---------------- */
  function toggleTheme() {
    const html = document.documentElement;
    const next = html.dataset.theme === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    try { localStorage.setItem("hpc-theme", next); } catch (e) { /* ignore */ }
    UI.toast(next === "dark" ? "已切换到深色主题" : "已切换到浅色主题", "info");
  }

  function refreshEmpties() {
    const jobEmpty = $("#jobEmpty");
    if (jobEmpty) {
      jobEmpty.hidden = $$("tbody tr[data-goto]").some((r) => r.style.display !== "none");
      const pager = $("#jobsPager");
      if (pager) pager.hidden = !jobEmpty.hidden;
    }
    const nodeEmpty = $("#nodeEmpty");
    if (nodeEmpty) nodeEmpty.hidden = $$("tbody tr[data-node-state]").some((r) => r.style.display !== "none");
    const alertEmpty = $("#alertEmpty");
    if (alertEmpty) alertEmpty.hidden = $$(".alert-item, .tl-row").some((el) => el.style.display !== "none");
    const auditEmpty = $("#auditEmpty");
    if (auditEmpty) auditEmpty.hidden = $$(".audit-row").some((el) => el.style.display !== "none");
  }

  /* ---------------- filters ---------------- */
  function applyGpuFilter() {
    const groups = $("#gpuGroups"), gridWrap = $("#gpuGridWrap");
    const scope = groups && !groups.hidden ? groups : (gridWrap || document);
    if (!$(".gpu-card", scope)) return;
    const activeChip = $('[data-gpu-state].active');
    const state = activeChip ? activeChip.dataset.gpuState : "all";
    const q = ($("#gpuSearch") && $("#gpuSearch").value || "").trim().toLowerCase();
    const part = ($("#gpuPartition") && $("#gpuPartition").value) || "all";
    const model = ($("#gpuModel") && $("#gpuModel").value) || "all";
    const visible = new Set();
    $$(".gpu-card", scope).forEach((card) => {
      const okState = state === "all" || card.dataset.state === state;
      const okPart = part === "all" || card.dataset.partition === part;
      const okModel = model === "all" || card.dataset.model === model;
      const okQ = !q || (card.dataset.text || "").toLowerCase().includes(q);
      const show = okState && okPart && okModel && okQ;
      card.style.display = show ? "" : "none";
      if (show) visible.add(card.dataset.gpu);
    });
    const n = visible.size;
    const c = $("#gpuCount");
    if (c) c.textContent = n;
    const empty = $("#gpuEmpty");
    if (empty) empty.hidden = n > 0;
    try {
      const prefs = JSON.parse(localStorage.getItem("hpc-gpu-prefs") || "{}");
      prefs.state = state;
      localStorage.setItem("hpc-gpu-prefs", JSON.stringify(prefs));
    } catch (e) { /* ignore */ }
    $$(".gpu-group").forEach((grp) => {
      const has = $$(".gpu-card", grp).some((card) => card.style.display !== "none");
      grp.hidden = !has;
    });
  }
  function applyNodeFilter() {
    const active = $("[data-node-state].active");
    const key = active ? active.dataset.nodeState : "all";
    const input = $("#nodeSearch");
    const q = (input && input.value || "").trim().toLowerCase();
    $$("tbody tr[data-node-state]").forEach((row) => {
      const okState = key === "all" || row.dataset.nodeState === key;
      const okQ = !q || (row.dataset.text || "").toLowerCase().includes(q);
      row.style.display = okState && okQ ? "" : "none";
    });
    refreshEmpties();
  }
  function applyRowFilter(selector, chipAttr, dataAttr) {
    const active = $("[" + chipAttr + "].active");
    const key = active ? active.getAttribute(chipAttr) : "all";
    $$(selector).forEach((row) => {
      const st = row.getAttribute(dataAttr) || "";
      row.style.display = key === "all" || key === "" || st === key ? "" : "none";
    });
    refreshEmpties();
  }
  function bindSearch(input, selector) {
    const el = $(input);
    if (!el) return;
    el.addEventListener("input", () => {
      const q = el.value.trim().toLowerCase();
      $$(selector).forEach((row) => {
        const text = (row.dataset.text || row.textContent || "").toLowerCase();
        row.style.display = !q || text.includes(q) ? "" : "none";
      });
      refreshEmpties();
      if (selector === ".gpu-card") applyGpuFilter();
    });
  }

  function applyJobFilters() {
    const q = (($("#jobSearch") && $("#jobSearch").value) || "").trim().toLowerCase();
    const stateEl = $("[data-job-state].active");
    const state = stateEl ? stateEl.dataset.jobState : "all";
    const partition = ($("#jobPartition") && $("#jobPartition").value) || "all";
    $$("#view tbody tr[data-partition]").forEach((row) => {
      const text = (row.dataset.text || row.textContent || "").toLowerCase();
      const okQuery = !q || text.includes(q);
      const okState = state === "all" || row.dataset.state === state;
      const okPartition = partition === "all" || row.dataset.partition === partition;
      row.style.display = okQuery && okState && okPartition ? "" : "none";
    });
    refreshEmpties();
  }

  function applyAlertFilters() {
    const q = (($("#alertSearch") && $("#alertSearch").value) || "").trim().toLowerCase();
    const filterEl = $("[data-alert-filter].active");
    const key = filterEl ? filterEl.dataset.alertFilter : "all";
    $$(".alert-item, .tl-row").forEach((item) => {
      const text = (item.textContent || "").toLowerCase();
      const resolved = item.classList.contains("resolved") || text.includes("已恢复");
      const okQuery = !q || text.includes(q);
      const okState = key === "critical" ? text.includes("严重") && !resolved
        : key === "warning" ? text.includes("警告") && !resolved
        : key === "resolved" ? resolved
        : true;
      item.style.display = okQuery && okState ? "" : "none";
    });
    refreshEmpties();
  }

  function applyUserFilters() {
    const q = (($("#userSearch") && $("#userSearch").value) || "").trim().toLowerCase();
    const roleEl = $("[data-user-role].active");
    const role = roleEl ? roleEl.dataset.userRole : "all";
    let visible = 0;
    $$(".users-table tbody tr[data-role]").forEach((row) => {
      const text = (row.dataset.text || row.textContent || "").toLowerCase();
      const okQuery = !q || text.includes(q);
      const okRole = role === "all" || row.dataset.role === role;
      const show = okQuery && okRole;
      row.style.display = show ? "" : "none";
      if (show) visible += 1;
    });
    const empty = $("#userEmpty");
    if (empty) empty.hidden = visible > 0;
  }

  function applyAuditFilters() {
    const q = (($("#auditSearch") && $("#auditSearch").value) || "").trim().toLowerCase();
    const filterEl = $("[data-audit-filter].active");
    const key = filterEl ? filterEl.dataset.auditFilter : "all";
    $$(".audit-row").forEach((row) => {
      const text = (row.textContent || "").toLowerCase();
      const okQuery = !q || text.includes(q);
      const okKind = key === "write" ? /操作|写入|提交|取消|删除|修改|作业/.test(text)
        : key === "auth" ? /登录|认证|会话/.test(text)
        : key === "config" ? /配置|规则/.test(text)
        : true;
      row.style.display = okQuery && okKind ? "" : "none";
    });
    refreshEmpties();
  }

  /* ---------------- chart tooltips ---------------- */
  function bindCharts() {
    $$(".chart[data-chart-id]").forEach((el) => {
      const data = window.__charts[el.dataset.chartId];
      if (!data) return;
      const tip = $(".chart-tip", el);
      if (!tip) return;
      el.addEventListener("mousemove", (ev) => {
        const rect = el.getBoundingClientRect();
        if (!rect.width) return;
        const vx = ((ev.clientX - rect.left) / rect.width) * data.geo.W;
        const span = data.geo.W - data.geo.L - data.geo.R;
        let idx = Math.round(((vx - data.geo.L) / span) * (data.labels.length - 1));
        idx = Math.max(0, Math.min(data.labels.length - 1, idx));
        const px = rect.width * ((data.geo.L + (data.labels.length <= 1 ? span / 2 : (idx / (data.labels.length - 1)) * span)) / data.geo.W);
        tip.innerHTML = `<div class="tt">${data.labels[idx]}</div>` + data.series.map((s) =>
          `<div class="tr"><span class="sw" style="background:${s.color}"></span><span>${s.name}</span><b style="margin-left:auto;padding-left:14px">${data.fmt(s.values[idx])}${data.unit || ""}</b></div>`
        ).join("");
        tip.hidden = false;
        const tw = tip.offsetWidth;
        let left = Math.max(tw / 2 + 4, Math.min(rect.width - tw / 2 - 4, px));
        tip.style.left = left + "px";
        tip.style.top = Math.max(54, ev.clientY - rect.top - 10) + "px";
        const cursor = el.querySelector(".chart-cursor");
        if (cursor) {
          const span = data.geo.W - data.geo.L - data.geo.R;
          const gx = data.geo.L + (data.labels.length <= 1 ? span / 2 : (idx / (data.labels.length - 1)) * span);
          cursor.setAttribute("x1", gx.toFixed(1));
          cursor.setAttribute("x2", gx.toFixed(1));
          cursor.style.display = "";
        }
      });
      el.addEventListener("mouseleave", () => {
        tip.hidden = true;
        const cursor = el.querySelector(".chart-cursor");
        if (cursor) cursor.style.display = "none";
      });
    });
  }

  /* ---------------- binds ---------------- */
  function bind() {
    bindCharts();
    bindSearch("#gpuSearch", ".gpu-card");
    const auditSearch = $("#auditSearch");
    if (auditSearch) auditSearch.addEventListener("input", applyAuditFilters);
    const userSearch = $("#userSearch");
    if (userSearch) userSearch.addEventListener("input", applyUserFilters);
    const alertSearch = $("#alertSearch");
    if (alertSearch) alertSearch.addEventListener("input", applyAlertFilters);

    const gpuSearch = $("#gpuSearch"); if (gpuSearch) gpuSearch.addEventListener("input", applyGpuFilter);
    ["#gpuPartition", "#gpuModel"].forEach((s) => { const el = $(s); if (el) el.addEventListener("change", applyGpuFilter); });
    const jobPartition = $("#jobPartition");
    if (jobPartition) jobPartition.addEventListener("change", applyJobFilters);
    const jobSearch = $("#jobSearch");
    if (jobSearch) jobSearch.addEventListener("input", applyJobFilters);

    $$('[data-gpu-state]').forEach((b) => b.addEventListener("click", () => {
      $$('[data-gpu-state]').forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      applyGpuFilter();
    }));
    $$('[data-job-state]').forEach((b) => b.addEventListener("click", () => {
      $$('[data-job-state]').forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      applyJobFilters();
    }));
    $$('[data-node-state]').forEach((b) => b.addEventListener("click", () => {
      $$('[data-node-state]').forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      applyNodeFilter();
    }));
    $$('[data-user-role]').forEach((b) => b.addEventListener("click", () => {
      $$('[data-user-role]').forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      applyUserFilters();
    }));
    const nodeSearch = $("#nodeSearch");
    if (nodeSearch) nodeSearch.addEventListener("input", applyNodeFilter);
    $$('[data-log-filter]').forEach((b) => b.addEventListener("click", () => {
      $$('[data-log-filter]').forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      const key = b.dataset.logFilter;
      $$(".log-line").forEach((line) => { line.hidden = key !== "all" && line.dataset.level !== key; });
    }));

    $$("[data-tab-group][data-tab-target]").forEach((btn) => btn.addEventListener("click", () => {
      const g = btn.dataset.tabGroup;
      $$(`[data-tab-group="${g}"][data-tab-target]`).forEach((x) => x.classList.toggle("active", x === btn));
      $$(`[data-tab-panel="${g}"]`).forEach((p) => { p.hidden = p.dataset.panel !== btn.dataset.tabTarget; });
    }));
    $$("[data-alert-view]").forEach((b) => b.addEventListener("click", () => {
      $$("[data-alert-view]").forEach((x) => x.classList.toggle("active", x === b));
      const v = b.dataset.alertView;
      const list = $("#alertList"), tl = $("#alertTimeline");
      if (list) list.hidden = v !== "list";
      if (tl) tl.hidden = v !== "timeline";
    }));
    bindSortableTables();
    bindJobSelection();
    refreshEmpties();

    $$('[data-tab]').forEach((b) => b.addEventListener("click", () => {
      $$('[data-tab]').forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      UI.toast("已切换视图", "info");
    }));

    $$("[data-tab-group]").forEach((btn) => btn.addEventListener("click", () => {
      const group = btn.dataset.tabGroup;
      const target = btn.dataset.tabTarget;
      $$(`[data-tab-group="${group}"]`).forEach((x) => x.classList.toggle("active", x === btn));
      $$(`[data-tab-panel="${group}"]`).forEach((panel) => { panel.hidden = panel.dataset.panel !== target; });
    }));

    $$("[data-log-filter]").forEach((chip) => chip.addEventListener("click", () => {
      $$("[data-log-filter]").forEach((x) => x.classList.toggle("active", x === chip));
      const key = chip.dataset.logFilter;
      $$(".log-view .log-line").forEach((line) => {
        const level = line.classList.contains("warn") ? "warn" : line.classList.contains("err") ? "err" : "info";
        line.hidden = key !== "all" && level !== key;
      });
    }));

    const form = $("#submitForm");
    if (form) {
      const range = $("#gpuRange"), part = $("#submitPartition"), time = $("#submitTime");
      const hoursMap = { "1h": 1, "4h": 4, "12h": 12, "24h": 24, "72h": 72 };
      const refreshEstimate = () => {
        const p = DB.PARTITIONS.find((x) => x.id === (part && part.value)) || DB.PARTITIONS[0];
        const stat = DB.PARTITION_STATS.find((x) => x.id === p.id);
        const n = range ? +range.value : 1;
        const h = hoursMap[time && time.value] || 1;
        if ($("#gpuOut")) $("#gpuOut").textContent = n + " 卡";
        if ($("#estHoursBig")) $("#estHoursBig").textContent = String(n * h);
        if ($("#estHours")) $("#estHours").textContent = String(n * h);
        if ($("#estQueue")) $("#estQueue").textContent = "未采集";
        if ($("#estGpuCount")) $("#estGpuCount").textContent = n + " 卡";
        $$("[data-gpu-preset]", form).forEach((b) => b.classList.toggle("active", +b.dataset.gpuPreset === n));
      };
      if (range) range.addEventListener("input", refreshEstimate);
      if (part) part.addEventListener("change", refreshEstimate);
      if (time) time.addEventListener("change", refreshEstimate);
      $$("[data-gpu-preset]", form).forEach((b) => b.addEventListener("click", () => {
        if (range) { range.value = b.dataset.gpuPreset; refreshEstimate(); }
      }));
      refreshEstimate();
      try {
        const tpl = JSON.parse(localStorage.getItem(jobTemplateKey()) || "null");
        if (tpl) {
          ["name", "partition", "gpus", "time", "image", "command"].forEach((key) => {
            const field = form.elements.namedItem(key);
            if (field && tpl[key] !== undefined && tpl[key] !== null) field.value = tpl[key];
          });
          refreshEstimate();
        }
      } catch (e) { /* ignore */ }
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const submitBtn = form.querySelector('button[type="submit"]');
        const payload = {
          name: String(fd.get("name") || "").trim(),
          partition: String(fd.get("partition") || "gpu"),
          gpus: Number(fd.get("gpus") || 1),
          time: String(fd.get("time") || "1h"),
          image: String(fd.get("image") || ""),
          command: String(fd.get("command") || "").trim(),
        };
        if (!payload.name) return UI.toast("请填写作业名称", "err");
        if (!payload.command) return UI.toast("请填写运行命令", "err");
        if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add("loading"); }
        try {
          const res = await apiWrite("/api/v1/jobs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            UI.toast((body && body.message) || "作业提交失败，请稍后重试", "err");
            return;
          }
          const submitted = body.data || body;
          const requestId = submitted.request_id || "";
          try {
            const history = JSON.parse(localStorage.getItem(jobHistoryKey()) || "[]");
            const next = [{ ...payload, ts: Date.now() }].concat(Array.isArray(history) ? history : [])
              .filter((item, index, arr) => arr.findIndex((x) => x.name === item.name) === index)
              .slice(0, 20);
            localStorage.setItem(jobHistoryKey(), JSON.stringify(next));
          } catch (e) { /* ignore */ }
          UI.toast("已提交 Slurm 队列，正在等待 JobId", "ok");
          const started = Date.now();
          let finalResult = null;
          let jobSeen = false;
          while (Date.now() - started < 15000) {
            await new Promise((r) => setTimeout(r, 1000));
            if (requestId) {
              try {
                const resultRes = await fetch(`/api/v1/jobs/submissions/${encodeURIComponent(requestId)}`, { cache: "no-store" });
                if (resultRes.ok) {
                  finalResult = await resultRes.json();
                  const resultData = finalResult.data || finalResult;
                  if (resultData && resultData.ok === false) {
                    UI.toast("Slurm 提交失败：" + (resultData.error || "未知错误"), "err");
                    return;
                  }
                  if (resultData && resultData.slurm_job_id) {
                    UI.toast("Slurm 已接收作业 #" + resultData.slurm_job_id, "ok");
                    break;
                  }
                }
              } catch (e) { /* result pending */ }
            }
            try {
              const jobsRes = await fetch("/api/v1/jobs", { cache: "no-store" });
              if (jobsRes.ok) {
                const jobsBody = await jobsRes.json();
                hydrateJobs(((jobsBody.data || jobsBody).jobs) || []);
                if (DB.JOBS.some((j) => j.name === payload.name
                    || (j.name && payload.name.startsWith(j.name))
                    || (j.name && j.name.startsWith(payload.name.slice(0, 15))))) {
                  jobSeen = true;
                  break;
                }
              }
            } catch (e) { /* retry */ }
          }
          if (finalResult && (finalResult.data || finalResult).ok === false) return;
          if (finalResult || jobSeen) {
            location.hash = "#/jobs";
            render(true);
          } else {
            UI.toast("提交请求已发送，但暂未收到 Slurm 结果，请稍后在作业中心确认", "warn");
          }
        } catch (err) {
          UI.toast("提交失败：无法连接后端", "err");
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove("loading"); }
        }
      });
    }

    const gpuSort = $("#gpuSort");
    if (gpuSort) {
      const grid = $("#gpuGrid");
      const part = $("#gpuPartition"), model = $("#gpuModel"), reset = $("#gpuReset");
      let prefs = null;
      try { prefs = JSON.parse(localStorage.getItem("hpc-gpu-prefs") || "null"); } catch (e) { prefs = null; }
      if (prefs) {
        if (prefs.sort) gpuSort.value = prefs.sort;
        if (part && prefs.partition) part.value = prefs.partition;
        if (model && prefs.model) model.value = prefs.model;
        if (prefs.state) $$("[data-gpu-state]").forEach((b) => b.classList.toggle("active", b.dataset.gpuState === prefs.state));
      }
      const applyGpuSort = () => {
        const v = gpuSort.value;
        const rank = { error: 0, drain: 1, allocated: 2, idle: 3 };
        $$(".gpu-grid").forEach((grid) => {
          const cards = $$(".gpu-card", grid);
          cards.sort((a, b) => {
            if (v === "util") return (+b.dataset.util || 0) - (+a.dataset.util || 0);
            if (v === "mem") return (+b.dataset.mem || 0) - (+a.dataset.mem || 0);
            if (v === "node") return (a.dataset.node || "").localeCompare(b.dataset.node || "");
            return (rank[a.dataset.state] - rank[b.dataset.state]) || (a.dataset.node || "").localeCompare(b.dataset.node || "");
          });
          cards.forEach((c) => grid.appendChild(c));
        });
        applyGpuFilter();
        if (reset) reset.hidden = gpuSort.value === "state" && (!part || part.value === "all") && (!model || model.value === "all");
        try { localStorage.setItem("hpc-gpu-prefs", JSON.stringify({ sort: gpuSort.value, partition: part ? part.value : "all", model: model ? model.value : "all" })); } catch (e) { /* ignore */ }
      };
      gpuSort.addEventListener("change", () => { applyGpuSort(); UI.toast("排序已应用", "info"); });
      [part, model].forEach((el) => { if (el) el.addEventListener("change", applyGpuSort); });
      if (reset) reset.addEventListener("click", () => {
        gpuSort.value = "state";
        if (part) part.value = "all";
        if (model) model.value = "all";
        $$("[data-gpu-state]").forEach((b) => b.classList.toggle("active", b.dataset.gpuState === "all"));
        applyGpuSort();
        UI.toast("已重置 GPU 筛选", "info");
      });
      applyGpuSort();
    }

    $$("[data-gpu-view]").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.gpuView;
      try { localStorage.setItem("hpc-gpu-view", v); } catch (e) { /* ignore */ }
      UI.toast(v === "group" ? "已切换为按分区分组" : "已切换为卡片视图", "info");
      render();
    }));
    $$("[data-gpu-state-jump]").forEach((b) => b.addEventListener("click", () => {
      const chip = $(`[data-gpu-state="${b.dataset.gpuStateJump}"]`);
      if (chip) chip.click();
    }));

    // GPU cards open the detail drawer
    $$(".gpu-card").forEach((card) => {
      card.addEventListener("click", () => openDrawer(Pages.gpuDrawer(card.dataset.gpu)));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDrawer(Pages.gpuDrawer(card.dataset.gpu)); }
      });
    });
    $$("#drawer [data-goto]").forEach((el) => el.addEventListener("click", () => closeDrawer()));
  }

  function bindSortableTables() {
    $$(".jobs-table table, .users-table table").forEach((table) => {
      const tbody = table.querySelector("tbody");
      if (!tbody) return;
      const ths = $$("thead th", table);
      ths.forEach((th, i) => {
        if (i === ths.length - 1 || th.querySelector("input")) return;
        th.classList.add("sortable");
        th.dataset.sortIndex = String(i);
        th.addEventListener("click", () => {
          const asc = th.dataset.dir !== "asc";
          ths.forEach((x) => { if (x !== th) { x.dataset.dir = ""; x.classList.remove("asc", "desc"); } });
          th.dataset.dir = asc ? "asc" : "desc";
          th.classList.toggle("asc", asc);
          th.classList.toggle("desc", !asc);
          const read = (row) => {
            const cell = row.children[i];
            const txt = (cell ? cell.textContent : "").trim();
            const num = parseFloat(txt.replace(/[^\d.-]/g, ""));
            return { txt, num: isFinite(num) ? num : null };
          };
          const rows = $$("tr", tbody).sort((a, b) => {
            const A = read(a), B = read(b);
            if (A.num !== null && B.num !== null) return asc ? A.num - B.num : B.num - A.num;
            return asc ? A.txt.localeCompare(B.txt) : B.txt.localeCompare(A.txt);
          });
          rows.forEach((r) => tbody.appendChild(r));
          UI.toast("已按「" + th.textContent.trim().replace(/[⇅↑↓]/g, "") + "」排序", "info");
        });
      });
    });
  }

  function refreshJobChipCounts() {
    ["all", "running", "pending", "completed", "failed", "cancelled"].forEach((k) => {
      const el = $(`[data-job-state="${k}"] .count`);
      if (!el) return;
      el.textContent = k === "all" ? DB.JOBS.length : DB.JOBS.filter((j) => j.state === k).length;
    });
  }

  function bindJobSelection() {
    const bar = $("#jobBulkBar");
    if (!bar) return;
    const checks = $$(".job-check");
    const update = () => {
      const selected = checks.filter((c) => c.checked);
      const count = $("#jobSelCount");
      if (count) count.textContent = selected.length;
      bar.hidden = selected.length === 0;
      const all = $("#jobSelectAll");
      if (all) {
        const visible = checks.filter((c) => c.closest("tr").style.display !== "none");
        all.checked = visible.length > 0 && visible.every((c) => c.checked);
        all.indeterminate = !all.checked && visible.some((c) => c.checked);
      }
    };
    checks.forEach((c) => {
      c.addEventListener("click", (e) => e.stopPropagation());
      c.addEventListener("change", update);
    });
    const all = $("#jobSelectAll");
    if (all) all.addEventListener("change", () => {
      checks.filter((c) => c.closest("tr").style.display !== "none").forEach((c) => { c.checked = all.checked; });
      update();
    });
    const clear = $("#jobSelClear");
    if (clear) clear.addEventListener("click", () => {
      checks.forEach((c) => { c.checked = false; });
      if (all) all.checked = false;
      update();
    });
    const bulkBtns = $$("[data-bulk]", bar);
    const runBulk = async (kind) => {
      const selected = checks.filter((c) => c.checked);
      if (!selected.length) return;
      if (kind === "cancel") {
        UI.confirm(`取消 ${selected.length} 个作业`, "将向 Slurm 发送 scancel，运行中作业会释放 GPU、排队作业会从队列移除。该操作会写入审计，取消后不可恢复。", "确认取消", async () => {
          let ok = 0, failed = 0;
          for (const c of selected) {
            try {
              const res = await apiWrite(`/api/v1/jobs/${encodeURIComponent(c.value)}/cancel`, { method: "POST" });
              if (res.ok) ok++; else failed++;
            } catch (e) { failed++; }
          }
          selected.forEach((c) => { c.checked = false; });
          update();
          UI.toast(`已提交取消：成功 ${ok} 个${failed ? `，失败 ${failed} 个` : ""}`, failed ? "warn" : "ok");
          try {
            const jobsRes = await fetch("/api/v1/jobs", { cache: "no-store" });
            if (jobsRes.ok) hydrateJobs(((await jobsRes.json()).data || {}).jobs);
          } catch (e) { /* ignore */ }
          render(true);
        });
        return;
      }
      if (kind === "export") {
        const selectedJobs = selected.map((c) => DB.JOBS.find((j) => String(j.id) === String(c.value))).filter(Boolean);
        const header = ["Job ID", "名称", "用户", "账户", "分区", "GPU", "状态", "运行秒数"];
        const csv = [header, ...selectedJobs.map((j) => [j.id, j.name, j.user, j.account, j.partition, j.gpus, j.state, j.elapsed])]
          .map((row) => row.map(csvCell).join(",")).join("\r\n");
        downloadTextFile(`starrail-selected-jobs-${new Date().toISOString().slice(0, 10)}.csv`, csv);
        UI.toast(`已导出 ${selectedJobs.length} 个作业`, "ok");
        selected.forEach((c) => { c.checked = false; });
        update();
        return;
      }
    };
    bulkBtns.forEach((b) => b.addEventListener("click", () => runBulk(b.dataset.bulk)));
    update();
  }

  function btnLoading(btn, ms, done) {
    if (!btn || btn.classList.contains("loading")) return;
    btn.classList.add("loading");
    btn.disabled = true;
    setTimeout(() => {
      btn.classList.remove("loading");
      btn.disabled = false;
      if (done) done();
    }, ms);
  }

  /* ---------------- global click handling ---------------- */
  document.addEventListener("click", (e) => {
    const themeBtn = e.target.closest("[data-settings-theme]");
    if (themeBtn) {
      const next = themeBtn.dataset.settingsTheme;
      if (next === "dark" || next === "light") {
        document.documentElement.dataset.theme = next;
        $$("[data-settings-theme]").forEach((b) => b.classList.toggle("btn-primary", b.dataset.settingsTheme === next));
      }
      return;
    }
    const goto = e.target.closest("[data-goto]");
    if (goto && !e.target.closest("[data-action]")) {
      e.preventDefault();
      const to = goto.dataset.goto;
      if (goto.closest("#drawer")) closeDrawer();
      if (location.hash === to) render(); else location.hash = to;
      document.body.classList.remove("nav-open");
      return;
    }
    const act = e.target.closest("[data-action]");
    if (act) {
      const a = act.dataset.action;
      if (a === "logout") { location.href = "/logout"; }
      else if (a === "settings") openSettingsDrawer();
      else if (a === "token-info") openApiTokenInfo();
      else if (a === "save-settings") saveUserSettings();
      else if (a === "refresh-users") {        btnLoading(act, 400, () => {
          fetch("/api/v1/users", { cache: "no-store" })
            .then((res) => res.ok ? res.json() : Promise.reject(new Error("users")))
            .then((body) => {
              window.__LDAP_OK = true;
              hydrateUsers(((body.data || body).users) || []);
              render(true);
              UI.toast("用户目录已同步", "ok");
            })
            .catch(() => { window.__LDAP_OK = false; UI.toast("用户目录同步失败，请稍后重试", "err"); });
        });
      }
      else if (a === "jobs-more") {
        const active = $("[data-job-state].active");
        const state = active ? active.dataset.jobState : "all";
        const search = ($("#jobSearch") && $("#jobSearch").value) || "";
        const partition = ($("#jobPartition") && $("#jobPartition").value) || "all";
        window.__JOBS_LIMIT = Math.max(18, Number(window.__JOBS_LIMIT) || 18) + 18;
        render(true);
        const chip = $(`[data-job-state="${state}"]`);
        if (chip) { $$("[data-job-state]").forEach((x) => x.classList.remove("active")); chip.classList.add("active"); }
        if ($("#jobSearch")) $("#jobSearch").value = search;
        if ($("#jobPartition")) $("#jobPartition").value = partition;
        applyJobFilters();
      }
      else if (a === "audit-more") {
        const active = $("[data-audit-filter].active");
        const key = active ? active.dataset.auditFilter : "all";
        const search = ($("#auditSearch") && $("#auditSearch").value) || "";
        window.__AUDIT_LIMIT = Math.max(16, Number(window.__AUDIT_LIMIT) || 16) + 16;
        render(true);
        const chip = $(`[data-audit-filter="${key}"]`);
        if (chip) { $$("[data-audit-filter]").forEach((x) => x.classList.remove("active")); chip.classList.add("active"); }
        if ($("#auditSearch")) $("#auditSearch").value = search;
        applyAuditFilters();
      }
      else if (a === "runbook") openRunbook();
      else if (a === "export") exportCurrentView();
      else if (a === "export-daily") exportCurrentView("dashboard");
      else if (a === "refresh") btnLoading(act, 250, async () => {
        await syncLiveData(true);
        render(true);
        UI.toast(window.__API_ONLINE === false ? "刷新失败：无法连接后端" : "已刷新当前数据", window.__API_ONLINE === false ? "err" : "info");
      });
      else if (a === "submit-job") {
        const part = act.dataset.partition || "";
        if (location.hash !== "#/catalog") location.hash = "#/catalog";
        setTimeout(() => {
          const sel = $("#submitPartition");
          if (sel && part) sel.value = part;
          const form = $("#submitForm");
          if (form) form.scrollIntoView({ behavior: "smooth", block: "center" });
          const nameInput = $("#submitForm input[name=\"name\"]");
          if (nameInput) nameInput.focus();
        }, 120);
        UI.toast(part ? `已定位到快速提交，分区 ${part}` : "已定位到快速提交表单，请填写作业参数", "info");
      }
      else if (a === "recheck-system") {
        btnLoading(act, 450, () => {
          fetch("/api/v1/system/status", { cache: "no-store" })
            .then((res) => res.ok ? res.json() : Promise.reject(new Error("status")))
            .then((body) => {
              const data = body.data || body;
              window.__DATA_OK.system = true;
              hydrateHealth(data.components);
              render(true);
              UI.toast("系统状态已重新检测", "ok");
            })
            .catch(() => { window.__DATA_OK.system = false; UI.toast("系统状态检测失败，请稍后重试", "err"); });
        });
      }
      else if (a === "resource-info") openResourceInfo();
      else if (a === "usage-definition") openUsageDefinition();
      else if (a === "save-template") saveJobTemplate();
      else if (a === "retry-job") {
        let history = [];
        try { history = JSON.parse(localStorage.getItem(jobHistoryKey()) || "[]"); } catch (e) { history = []; }
        const name = act.dataset.name || "";
        const config = (Array.isArray(history) ? history : []).find((item) =>
          item && (item.name === name || (name && item.name && name.startsWith(item.name))));
        if (!config) {
          UI.toast("当前浏览器没有该作业的原始提交参数，无法重跑", "warn");
        } else {
          try { localStorage.setItem(jobTemplateKey(), JSON.stringify(config)); } catch (e) { /* ignore */ }
          location.hash = "#/catalog";
          UI.toast("已载入原作业参数，请确认后重新提交", "info");
        }
      }
      else if (a === "download-job-log") downloadJobLog();
      else if (a === "copy-gpu") {
        const value = act.dataset.copy || "";
        if (!value) return;
        const done = () => UI.toast("GPU UUID 已复制", "ok");
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(value).then(done).catch(() => UI.toast("复制失败，请手动选择 UUID", "err"));
        } else {
          const ta = document.createElement("textarea");
          ta.value = value;
          ta.style.cssText = "position:fixed;opacity:0";
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand("copy"); done(); } catch (e) { UI.toast("复制失败，请手动选择 UUID", "err"); }
          ta.remove();
        }
      }
      else if (a === "rule-drawer") openDrawer(Pages.ruleDrawer(act.dataset.id));
      else if (a === "user-drawer") openDrawer(Pages.userDrawer(act.dataset.user));
      else if (a === "shortcuts") UI.shortcuts();
      else if (a === "cancel-job") {
        const id = act.dataset.id;
        const targetJob = DB.jobById(id) || DB.JOBS.find((j) => String(j.id) === String(id));
        const queued = targetJob && targetJob.state === "pending";
        UI.confirm("取消作业 #" + id, queued
          ? "该作业仍在 Slurm 队列中排队，取消将从队列移除并写入审计，取消后不可恢复。"
          : "将向 Slurm 发送 scancel，并释放占用的 GPU。该操作会写入审计，取消后不可恢复。", "确认取消", async () => {
          try {
            const res = await apiWrite(`/api/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              UI.toast((body && body.message) || "取消失败，请稍后重试", "err");
              return;
            }
          } catch (err) {
            UI.toast("取消失败：无法连接后端", "err");
            return;
          }
          const job = DB.jobById(id);
          if (job) job.state = "cancelled";
          UI.toast("作业 #" + id + " 已取消（已写入审计）", "warn");
          const row = act.closest("tr");
          if (row && $("#jobBulkBar")) {
            row.classList.add("row-flash");
            const badge = row.querySelector("td:nth-child(9) .badge");
            if (badge) { badge.className = "badge slate"; badge.textContent = "已取消"; }
            const cancelBtn = row.querySelector('[data-action="cancel-job"]');
            if (cancelBtn) cancelBtn.remove();
            refreshJobChipCounts();
            const active = $("[data-job-state].active");
            const key = active ? active.dataset.jobState : "all";
            if (key !== "all" && key !== "cancelled") row.style.display = "none";
          } else {
            setTimeout(render, 300);
          }
        });
      } else if (a === "ack-alert") {
        const id = act.dataset.id;
        UI.confirm("确认告警 " + id, "确认后告警会写入 PostgreSQL 审计链，并同步到告警中心。", "确认告警", async () => {
          try {
            const res = await apiWrite(`/api/v1/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
              UI.toast((body && body.message) || "确认失败，请稍后重试", "err");
              return;
            }
          } catch (err) {
            UI.toast("确认失败：无法连接后端", "err");
            return;
          }
          const alert = DB.ALERTS.find((x) => x.id === id);
          if (alert) alert.state = "acked";
          UI.toast(`告警 ${id} 已确认（已写入审计）`, "ok");
          render();
        });
      } else if (a === "verify-audit") {
        fetch("/api/v1/audit/verify", { cache: "no-store", credentials: "same-origin" }).then(async (res) => {
          const body = await res.json().catch(() => ({}));
          if (!res.ok) return UI.toast((body && body.message) || "校验失败", "err");
          const data = body.data || {};
          if (data.valid) UI.toast(`哈希链正常：已校验 ${data.checked} 条事件`, "ok");
          else UI.toast(`哈希链断裂：${data.broken_at || "未知位置"}`, "err");
        }).catch(() => UI.toast("校验失败：无法连接后端", "err"));
      } else if (a === "theme") toggleTheme();
      else UI.toast("未知操作：" + a, "err");
      return;
    }
    const close = e.target.closest("[data-drawer-close]");
    if (close) closeDrawer();
    const range = e.target.closest("[data-range]");
    if (range) {
      $$("[data-range]").forEach((x) => x.classList.remove("active"));
      range.classList.add("active");
      UI.toast("时间范围已切换：" + range.dataset.range, "info");
      return;
    }
    const chip = e.target.closest("[data-chip]");
    if (chip) { $$("[data-chip]").forEach((x) => x.classList.remove("active")); chip.classList.add("active"); }
    const scope = e.target.closest("[data-scope]");
    if (scope) {
      $$("[data-scope]").forEach((x) => x.classList.remove("active"));
      scope.classList.add("active");
      const key = scope.dataset.scope || "global";
      window.__USAGE_SCOPE = key;
      fetch("/api/v1/usage?scope=" + encodeURIComponent(key), { cache: "no-store" })
        .then((res) => res.ok ? res.json() : Promise.reject(new Error("usage")))
        .then((body) => {
          hydrateUsage((body.data || body));
          render(true);
          UI.toast("已切换用量范围：" + scope.textContent, "info");
        })
        .catch(() => UI.toast("用量数据加载失败，请稍后重试", "err"));
    }
    const alertFilter = e.target.closest("[data-alert-filter]");
    if (alertFilter) {
      $$("[data-alert-filter]").forEach((x) => x.classList.remove("active"));
      alertFilter.classList.add("active");
      applyAlertFilters();
    }
    const auditFilter = e.target.closest("[data-audit-filter]");
    if (auditFilter) {
      $$("[data-audit-filter]").forEach((x) => x.classList.remove("active"));
      auditFilter.classList.add("active");
      applyAuditFilters();
    }
  });

  /* ---------------- palette events ---------------- */
  $("#searchBtn").addEventListener("click", openPalette);
  $("#paletteInput").addEventListener("input", (e) => renderPalette(e.target.value));
  $("#paletteInput").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      paletteIndex = (paletteIndex + (e.key === "ArrowDown" ? 1 : -1) + paletteItems.length) % Math.max(1, paletteItems.length);
      $$(".palette-item").forEach((el, i) => el.classList.toggle("active", i === paletteIndex));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (paletteItems[paletteIndex]) runPaletteItem(paletteItems[paletteIndex]);
    } else if (e.key === "Escape") closePalette();
  });
  $("#paletteList").addEventListener("click", (e) => {
    const item = e.target.closest(".palette-item");
    if (item && paletteItems[+item.dataset.index]) runPaletteItem(paletteItems[+item.dataset.index]);
  });
  $("#paletteOverlay").addEventListener("click", (e) => { if (e.target === $("#paletteOverlay")) closePalette(); });

  /* ---------------- modal ---------------- */
  $("#modalOverlay").addEventListener("click", (e) => {
    if (e.target === $("#modalOverlay") || e.target.closest("[data-modal-cancel]")) { UI.closeModal(); return; }
    if (e.target.closest("[data-modal-ok]")) {
      const cb = window.__modalOk;
      UI.closeModal();
      if (cb) cb();
    }
  });

  /* ---------------- drawer close ---------------- */
  drawerOverlay.addEventListener("click", closeDrawer);

  /* ---------------- keyboard ---------------- */
  document.addEventListener("keydown", (e) => {
    const typing = e.target && ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === ",") { e.preventDefault(); openSettingsDrawer(); return; }
    if (!typing && e.key === "?" && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); UI.shortcuts(); return; }
    if (e.key === "Escape") {
      if (!$("#paletteOverlay").hidden) closePalette();
      if (drawer.classList.contains("open")) closeDrawer();
      if (!$("#modalOverlay").hidden) UI.closeModal();
      closePopovers();
    }
    if (e.key === "Tab") {
      const scope = !$("#modalOverlay").hidden ? $("#modal")
        : drawer.classList.contains("open") ? drawer
        : !$("#paletteOverlay").hidden ? $(".palette") : null;
      if (!scope) return;
      const focusables = $$("a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])", scope)
        .filter((el) => el.offsetParent !== null && !el.hidden);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  function bindScrollChrome() {
    const topbar = $(".topbar");
    if (!topbar) return;
    const onScroll = () => topbar.classList.toggle("scrolled", window.scrollY > 10);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------------- chrome controls ---------------- */
  $("#themeBtn").addEventListener("click", toggleTheme);
  $("#refreshBtn").addEventListener("click", (e) => {
    btnLoading(e.currentTarget, 250, async () => {
      await syncLiveData(true);
      if (window.__API_ONLINE === false) UI.toast("刷新失败：无法连接后端", "err");
      else UI.toast("已刷新集群数据", "info");
      render(true);
    });
  });
  $("#bellBtn").addEventListener("click", (e) => { e.stopPropagation(); refreshNotificationPopover(); togglePopover("notifPop"); });
  $("#userMenu").addEventListener("click", (e) => { e.stopPropagation(); togglePopover("userPop"); });
  const clusterSwitcher = $("#clusterSwitcher");
  const clusterNameEl = $("#clusterSwitcher .cp-text b");
  if (clusterNameEl) clusterNameEl.textContent = activeCluster.name;
  if (clusterSwitcher) clusterSwitcher.addEventListener("click", () => {
    const list = clusterList();
    if (list.length < 2) {
      UI.toast("当前只配置了一个集群", "info");
      return;
    }
    const currentName = (window.__ACTIVE_CLUSTER && window.__ACTIVE_CLUSTER.name) || (DB.CLUSTER && DB.CLUSTER.name) || "";
    let idx = list.findIndex((c) => c.name === currentName);
    const next = list[(idx + 1) % list.length];
    try { localStorage.setItem(CLUSTER_KEY, next.name); } catch (e) { /* ignore */ }
    UI.toast(`正在切换到 ${next.name}…`, "info");
    setTimeout(() => location.reload(), 250);
  });
  document.addEventListener("click", (e) => {
    if (e.target.closest(".popover") || e.target.closest("#bellBtn") || e.target.closest("#userMenu")) return;
    closePopovers();
  });
  $("#collapseBtn").addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
    try { localStorage.setItem("hpc-sidebar", document.body.classList.contains("sidebar-collapsed") ? "1" : "0"); } catch (e) { /* ignore */ }
  });
  $("#menuBtn").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  window.addEventListener("hashchange", () => { document.body.classList.remove("nav-open"); render(); });

  /* ---------------- identity / backend sync ---------------- */
  function updateUserPopMetrics() {
    const privileged = !ME || (ME.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
    const personalHours = (DB.ACCOUNTS || []).reduce((sum, a) => sum + Number(a.usage || 0), 0);
    const hours = $("#popGpuHours");
    if (hours) hours.textContent = DB.fmt(privileged ? DB.TOTALS.gpuHoursMonth : personalHours);
    const label = $("#popUtilLabel");
    if (label) label.textContent = privileged ? "GPU 分配率" : "个人用量";
    const pct = $("#popUtilPct");
    if (pct) pct.textContent = privileged ? DB.TOTALS.utilization + "%" : "本人";
    const bar = $("#popUtilBar");
    if (bar) bar.style.width = privileged ? DB.TOTALS.utilization + "%" : "0%";
  }
  function applyIdentity(me) {
    if (!me) return;
    ME = me;
    window.__ME = me;
    window.__CSRF = me.csrf || "";
    if (readAlertsLoadedFor !== readAlertsKey()) {
      loadReadAlerts();
      const b = $("#bellBtn");
      if (b) b.classList.toggle("has-dot", unreadAlertCount() > 0);
      refreshNotificationPopover();
    }
    const initial = (me.display_name || me.username || "?").slice(0, 1);
    const set = (sel, value) => { const el = $(sel); if (el) el.textContent = value; };
    set("#userAvatar", initial);
    set("#userName", me.display_name || me.username);
    set("#userRole", me.role_label || ROLE_LABEL[me.primary_role] || me.primary_role);
    set("#popAvatar", initial);
    set("#popName", me.display_name || me.username);
    set("#popRole", me.role_label || ROLE_LABEL[me.primary_role] || me.primary_role);
    set("#popEmail", `${me.email || me.username} · ${me.account || (me.groups || []).join(" / ") || "未分组"}`);
    set("#popSession", me.auth_mode === "proxy" ? "OIDC 会话" : "本地会话");
    const badge = $("#popRole");
    if (badge) {
      badge.className = "badge " + (me.primary_role === "admin" ? "cyan" : me.primary_role === "ops" ? "blue" : me.primary_role === "pi" ? "violet" : me.primary_role === "auditor" ? "amber" : "slate");
    }
    const bell = $("#bellBtn");
    const privileged = (me.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
    if (bell) bell.style.display = privileged ? "" : "none";
    const sideUtil = $(".side-util");
    if (sideUtil) sideUtil.style.display = privileged ? "" : "none";
    $$("#mobileTabbar [data-mobile]").forEach((a) => {
      a.style.display = privileged || ["dashboard", "catalog", "jobs", "usage"].includes(a.dataset.mobile) ? "" : "none";
    });
    const auditEntry = $('#userPop [data-goto="#/audit"]');
    if (auditEntry) auditEntry.style.display = privileged ? "" : "none";
    updateUserPopMetrics();
    renderNav();
  }

  /* ---------------- backend data hydration ---------------- */
  function hydrateJobs(rows) {
    if (!Array.isArray(rows)) return false;
    DB.JOBS.length = 0;
    rows.forEach((j) => {
      DB.JOBS.push({
        id: j.id,
        name: j.name || "未命名作业",
        user: j.user_display || j.user || j.username || j.owner || "未知用户",
        username: j.username || j.owner || "",
        uid: j.uid || 0,
        account: j.account || "",
        accountId: j.accountId || j.account_id || "",
        partition: j.partition || "gpu",
        gpus: Number(j.gpus || 1),
        nodes: Number(j.nodes || 1),
        qos: j.qos || "normal",
        image: j.image || "",
        state: j.state || "pending",
        progress: Number(j.progress || 0),
        elapsed: Number(j.elapsed || 0),
        wait: Number(j.wait || 0),
        submitted: Number(j.submitted || 0),
        started: j.started || null,
        priority: j.priority === null || j.priority === undefined ? null : Number(j.priority),
        exitCode: j.exitCode === undefined ? null : j.exitCode,
        logTail: Array.isArray(j.log_tail) ? j.log_tail : []
      });
    });
    // 重新把运行中作业映射到分配的 GPU；未知关联不再指向已不存在的作业。
    const allocated = DB.GPUS.filter((g) => g.state === "allocated");
    allocated.forEach((g) => { g.jobId = null; g.user = null; });
    let idx = 0;
    DB.JOBS.filter((j) => j.state === "running").forEach((job) => {
      for (let k = 0; k < job.gpus && idx < allocated.length; k++) {
        allocated[idx].jobId = job.id;
        allocated[idx].user = job.user;
        idx++;
      }
    });
    DB.TOTALS.runningJobs = DB.JOBS.filter((j) => j.state === "running").length;
    DB.TOTALS.pendingJobs = DB.JOBS.filter((j) => j.state === "pending").length;
    return true;
  }

  function hydrateAlerts(rows) {
    if (!Array.isArray(rows)) return false;
    DB.ALERTS.length = 0;
    rows.forEach((a, i) => {
      DB.ALERTS.push({
        id: a.id,
        sev: a.sev || a.severity || "info",
        title: a.title || "未命名告警",
        node: a.node || a.server || "—",
        gpu: a.gpu || "—",
        jobId: a.jobId || null,
        desc: a.desc || a.title || "",
        rule: a.rule || "—",
        mins: Number(a.mins || 0),
        time: Number(a.time || 0),
        state: a.state || "firing"
      });
    });
    DB.TOTALS.criticalAlerts = DB.ALERTS.filter((a) => a.sev === "critical" && a.state !== "resolved").length;
    const bell = $("#bellBtn");
    if (bell) bell.classList.toggle("has-dot", unreadAlertCount() > 0);
    refreshNotificationPopover();
    return true;
  }

  function hydrateUsage(data) {
    if (!data || !Array.isArray(data.labels) || !Array.isArray(data.series)) return false;
    DB.USAGE_LABELS.length = 0;
    DB.USAGE_LABELS.push(...data.labels);
    if (Array.isArray(data.accounts)) {
      DB.ACCOUNTS.length = 0;
      DB.USAGE_SERIES.length = 0;
      data.accounts.forEach((a, i) => {
        DB.ACCOUNTS.push({
          id: a.id, name: a.name || a.id, pi: a.pi || "", members: Number(a.members || 0),
          model: a.model || DB.GPU_MODEL, quota: a.quota || [0, 0],
          usage: Number(a.gpu_hours || a.usage || 0), color: a.color || "#22d3ee",
        });
        const s = (data.series || []).find((x) => x.id === a.id) || (data.series || [])[i] || { values: [] };
        DB.USAGE_SERIES.push({ id: a.id, name: a.name || a.id, color: s.color || a.color || "#22d3ee", values: s.values || [] });
      });
    } else {
      DB.USAGE_SERIES.forEach((s) => { s.values = []; });
      DB.ACCOUNTS.forEach((a) => { a.usage = 0; });
    }
    DB.TOTAL_USAGE = Number(data.gpu_hours || 0) || data.series.reduce((acc, s) => acc + (s.values || []).reduce((a, b) => a + b, 0), 0);
    DB.TOTALS.gpuHoursMonth = DB.TOTAL_USAGE;
    DB.TOTALS.topAccounts = DB.ACCOUNTS.slice().sort((a, b) => b.usage - a.usage).map((a) => ({ ...a }));
    return true;
  }

  function hydrateUsers(rows) {
    if (!Array.isArray(rows)) return false;
    DB.USERS.length = 0;
    rows.forEach((u) => {
      DB.USERS.push({
        username: u.username || "",
        uid: u.uid || 0,
        name: u.name || u.display_name || u.username || "未命名",
        role: u.role || (u.roles || [])[0] || "user",
        group: u.group || u.account || "",
        groups: Array.isArray(u.groups) ? u.groups : [],
        email: u.email || "",
        status: u.status || "active",
        quota: Array.isArray(u.quota) ? u.quota : [0, 0],
        last: Number(u.last || 0)
      });
    });
    return true;
  }

  function hydrateRules(rows) {
    if (!Array.isArray(rows)) return false;
    DB.RULES.length = 0;
    rows.forEach((r) => {
      DB.RULES.push({
        id: r.id || r.name || "rule",
        name: r.name || r.id || "Prometheus Rule",
        expr: r.expr || "",
        sev: r.sev || "warning",
        dur: r.dur || "0s",
        on: r.on !== false,
        ver: r.ver || "ok",
        updated: r.updated || "",
        group: r.group || "",
        file: r.file || "",
        description: r.description || "",
        state: r.state || "inactive",
      });
    });
    return true;
  }

  function hydrateAudit(rows) {
    if (!Array.isArray(rows)) return false;
    DB.AUDIT.length = 0;
    rows.forEach((a) => {
      DB.AUDIT.push({
        id: a.id,
        action: a.action || "操作",
        detail: a.detail || "",
        object: a.object || "",
        actor: a.actor || "系统",
        role: a.role || "user",
        ip: a.ip || "—",
        mins: Number(a.mins || 0),
        ts: a.ts || "",
        ok: a.ok !== false
      });
    });
    return true;
  }

  function hydrateHealth(components) {
    if (!Array.isArray(components)) return false;
    DB.HEALTH.length = 0;
    components.forEach((c) => {
      DB.HEALTH.push({
        name: c.name,
        role: c.role || "",
        status: c.status || "ok",
        latency: Number(c.latency || 0),
        uptime: c.uptime || "—",
        detail: c.detail || ""
      });
    });
    return true;
  }

  async function hydrateIpStatus() {
    const el = $("#ipStatusBody");
    if (!el) return;
    try {
      const res = await fetch("/api/v1/system/ip-status", { cache: "no-store" });
      if (!res.ok) throw new Error("ip-status " + res.status);
      const body = await res.json();
      const data = body.data || {};
      const clusters = Object.values((data.registry || {}).clusters || {});
      const alerts = data.alerts || [];
      const rows = clusters.map((c) => `<div class="mini-row"><span class="lbl">${UI.esc(c.name)}</span><span class="val ${c.healthy ? "" : "bad"}">${UI.esc(c.ip || "—")}:${UI.esc(c.port)} · ${c.healthy ? "正常" : "不可达"}</span></div>`).join("");
      const alertRows = alerts.slice(-3).reverse().map((a) => `<div class="mini-row"><span class="lbl">${UI.esc(a.time || "")}</span><span class="val">${UI.esc(a.message || "")}</span></div>`).join("");
      el.innerHTML = (rows || '<div class="mini-row"><span class="lbl">暂无 IP 记录</span><span class="val">—</span></div>')
        + (alertRows ? '<div class="divider" style="margin:10px 0"></div>' + alertRows : "");
    } catch (err) {
      el.innerHTML = '<div class="mini-row"><span class="lbl">IP 状态不可用</span><span class="val bad">无法读取</span></div>';
    }
  }

  function hydrateTrend(data) {
    if (!data || !Array.isArray(data.labels) || !Array.isArray(data.points)) return false;
    DB.TREND_LABELS.length = 0;
    DB.TREND.length = 0;
    data.labels.forEach((label) => DB.TREND_LABELS.push(label));
    data.points.forEach((point) => {
      DB.TREND.push({
        label: "",
        util: Number(point.util || 0)
      });
    });
    return true;
  }

  function clearLiveBusinessData() {
    window.__LDAP_OK = null;
    window.__DATA_OK = {};
    DB.JOBS.length = 0;
    DB.ALERTS.length = 0;
    DB.AUDIT.length = 0;
    DB.RULES.length = 0;
    DB.USERS.length = 0;
    DB.HEALTH.length = 0;
    DB.ACCOUNTS.length = 0;
    DB.USAGE_LABELS.length = 0;
    DB.USAGE_SERIES.length = 0;
    DB.TOTAL_USAGE = 0;
    DB.TOTALS.criticalAlerts = 0;
    DB.TOTALS.runningJobs = 0;
    DB.TOTALS.pendingJobs = 0;
    DB.TOTALS.gpuHoursMonth = 0;
    DB.TOTALS.topAccounts = [];
    DB.TOTALS.allocated = 0;
    DB.TOTALS.idle = DB.GPUS.length;
    DB.TOTALS.error = 0;
    DB.TOTALS.drain = 0;
    DB.TOTALS.utilization = 0;
    DB.TOTALS.gpus = DB.GPUS.length;
    DB.TOTALS.nodes = DB.NODES.length;
    DB.TOTALS.gpuServers = new Set(DB.GPUS.map((g) => g.node)).size;
    DB.GPUS.forEach((g) => {
      g.state = "idle";
      g.util = 0;
      g.memUsed = 0;
      g.temp = 0;
      g.power = 0;
      g.jobId = null;
      g.user = null;
    });
    DB.NODES.forEach((node) => { node.util = 0; node.gpuUsed = 0; node.state = "online"; });
    (DB.PARTITION_STATS || []).forEach((p) => {
      p.pending = 0;
      p.used = 0;
      p.error = 0;
      p.idle = DB.GPUS.filter((g) => g.partition === p.id).length;
      p.drain = 0;
    });
    updateUserPopMetrics();
    const bell = $("#bellBtn");
    if (bell) bell.classList.remove("has-dot");
    refreshNotificationPopover();
  }

  async function hydrateBusinessData(canSeeGpus) {
    const liveMode = !new URLSearchParams(location.search).get("demo");
    if (liveMode) clearLiveBusinessData();
    try {
      const jobRes = await fetch("/api/v1/jobs", { cache: "no-store" });
      window.__DATA_OK.jobs = jobRes.ok;
      if (jobRes.ok) {
        const body = await jobRes.json();
        hydrateJobs((body.data || body).jobs);
      }
      if (canSeeGpus) {
        const alertRes = await fetch("/api/v1/alerts", { cache: "no-store" });
        window.__DATA_OK.alerts = alertRes.ok;
        if (alertRes.ok) {
          const body = await alertRes.json();
          hydrateAlerts((body.data || body).alerts);
        }
      }
      const requestedScope = window.__USAGE_SCOPE;
      let usageScope = canSeeGpus ? "global" : "self";
      if (requestedScope === "self") usageScope = "self";
      else if (requestedScope === "group") usageScope = "self";
      else if (requestedScope === "global" && canSeeGpus) usageScope = "global";
      const usageRes = await fetch("/api/v1/usage?scope=" + usageScope, { cache: "no-store" });
      window.__DATA_OK.usage = usageRes.ok;
      if (usageRes.ok) {
        const body = await usageRes.json();
        hydrateUsage(body.data || body);
      }

      const roleList = (ME && ME.roles) || [];
      if (roleList.some((r) => ["admin", "ops"].includes(r))) {
        const [usersRes, systemRes, rulesRes] = await Promise.all([
          fetch("/api/v1/users", { cache: "no-store" }),
          fetch("/api/v1/system/status", { cache: "no-store" }),
          fetch("/api/v1/rules", { cache: "no-store" })
        ]);
        if (usersRes.ok) hydrateUsers(((await usersRes.json()).data || {}).users);
        window.__LDAP_OK = usersRes.ok;
        window.__DATA_OK.users = usersRes.ok;
        if (systemRes.ok) hydrateHealth(((await systemRes.json()).data || {}).components);
        window.__DATA_OK.system = systemRes.ok;
        if (rulesRes.ok) hydrateRules(((await rulesRes.json()).data || {}).rules);
        else DB.RULES.length = 0;
        window.__DATA_OK.rules = rulesRes.ok;
        if (canSeeGpus) {
          const trendRes = await fetch("/api/v1/trend?range=24h", { cache: "no-store" });
          window.__DATA_OK.trend = trendRes.ok;
          if (trendRes.ok) hydrateTrend((await trendRes.json()).data || {});
        }
      }
      if (roleList.some((r) => ["admin", "ops", "auditor"].includes(r))) {
        const auditRes = await fetch("/api/v1/audit", { cache: "no-store" });
        window.__DATA_OK.audit = auditRes.ok;
        if (auditRes.ok) hydrateAudit(((await auditRes.json()).data || {}).events);
      }
    } catch (e) { /* 保留已加载的真实数据，失败状态由 __DATA_OK 标记 */ }
  }

  function csvCell(value) {
    let text = value === null || value === undefined ? "" : String(value);
    // 防止 CSV/Excel 公式注入：以 = + - @ 开头的文本前置单引号。
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function downloadTextFile(filename, text, mime) {
    const blob = new Blob(["\ufeff" + text], { type: mime || "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCurrentView(forceRoute) {
    const route = forceRoute || parse().route;
    const searchOf = (selector) => { const el = $(selector); return el ? (el.value || "").trim().toLowerCase() : ""; };
    const activeKey = (selector, attr) => { const el = $(selector + ".active"); return el ? (el.dataset[attr] || "all") : "all"; };
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    let name = route;
    let header = [];
    let rows = [];
    if (route === "dashboard") {
      name = "daily-report";
      header = ["指标", "数值"];
      rows = [
        ["集群", DB.CLUSTER.name],
        ["节点数", DB.TOTALS.nodes],
        ["GPU 总数", DB.TOTALS.gpus],
        ["已分配 GPU", DB.TOTALS.allocated],
        ["GPU 分配率", DB.TOTALS.utilization + "%"],
        ["运行作业", DB.TOTALS.runningJobs],
        ["排队作业", DB.TOTALS.pendingJobs],
        ["严重告警", DB.TOTALS.criticalAlerts],
        ["近 30 天 GPU·h", DB.TOTALS.gpuHoursMonth],
        ["生成时间", new Date().toISOString()],
      ];
    } else if (route === "jobs") {
      name = "jobs";
      const q = searchOf("#jobSearch");
      const state = activeKey("[data-job-state]", "jobState");
      const partition = ($("#jobPartition") && $("#jobPartition").value) || "all";
      header = ["Job ID", "名称", "用户", "账户", "分区", "GPU", "状态", "提交时间", "运行秒数"];
      rows = DB.JOBS.filter((j) => {
        const text = [j.id, j.name, j.user, j.account, j.partition].join(" ").toLowerCase();
        return (!q || text.includes(q)) && (state === "all" || j.state === state)
          && (partition === "all" || j.partition === partition);
      }).map((j) => [j.id, j.name, j.user, j.account, j.partition, j.gpus, j.state, j.submitted ? new Date(j.submitted).toISOString() : "", j.elapsed]);
    } else if (route === "audit") {
      name = "audit";
      const q = searchOf("#auditSearch");
      const kind = activeKey("[data-audit-filter]", "auditFilter");
      header = ["事件 ID", "时间", "操作", "详情", "对象", "操作者", "角色", "IP", "成功"];
      rows = DB.AUDIT.filter((a) => {
        const text = [a.id, a.action, a.detail, a.object, a.actor, a.role, a.ip].join(" ").toLowerCase();
        const okKind = kind === "write" ? /操作|写入|提交|取消|删除|修改|作业/.test(text)
          : kind === "auth" ? /登录|认证|会话/.test(text)
          : kind === "config" ? /配置|规则/.test(text)
          : true;
        return (!q || text.includes(q)) && okKind;
      }).map((a) => {
        const at = a.ts ? new Date(a.ts) : new Date(Date.now() - Number(a.mins || 0) * 60000);
        return [a.id, isNaN(at.getTime()) ? "时间未知" : at.toLocaleString("zh-CN", { hour12: false }), a.action, a.detail, a.object, a.actor, a.role, a.ip, a.ok ? "是" : "否"];
      });
    } else if (route === "users") {
      name = "users";
      const q = searchOf("#userSearch");
      const role = activeKey("[data-user-role]", "userRole");
      header = ["用户名", "显示名", "UID", "组", "角色", "邮箱", "状态"];
      rows = DB.USERS.filter((u) => {
        const text = [u.username, u.name, u.uid, u.group, u.role, u.email, u.status].join(" ").toLowerCase();
        return (!q || text.includes(q)) && (role === "all" || u.role === role);
      }).map((u) => [u.username, u.name, u.uid, u.group, u.role, u.email, u.status]);
    } else if (route === "gpus") {
      name = "gpus";
      const q = searchOf("#gpuSearch");
      const state = activeKey("[data-gpu-state]", "gpuState");
      const partition = ($("#gpuPartition") && $("#gpuPartition").value) || "all";
      const model = ($("#gpuModel") && $("#gpuModel").value) || "all";
      header = ["节点", "GPU", "型号", "状态", "利用率%", "温度℃", "功耗W", "显存使用MB", "显存总量MB", "作业"];
      rows = DB.GPUS.filter((g) => {
        const text = [g.uuid, g.node, g.model, g.partition].join(" ").toLowerCase();
        return (!q || text.includes(q)) && (state === "all" || g.state === state)
          && (partition === "all" || g.partition === partition) && (model === "all" || g.model === model);
      }).map((g) => [g.node, g.index, g.model, g.state, g.util, g.temp, g.power, g.memUsed, g.memTotal, g.jobId || ""]);
    } else if (route === "alerts") {
      name = "alerts";
      const q = searchOf("#alertSearch");
      const filter = activeKey("[data-alert-filter]", "alertFilter");
      header = ["告警 ID", "级别", "标题", "节点", "GPU", "状态", "时间", "描述"];
      rows = DB.ALERTS.filter((a) => {
        const text = [a.id, a.sev, a.title, a.node, a.gpu, a.state, a.desc].join(" ").toLowerCase();
        const resolved = a.state === "resolved";
        const okFilter = filter === "critical" ? a.sev === "critical" && !resolved
          : filter === "warning" ? a.sev === "warning" && !resolved
          : filter === "resolved" ? resolved
          : true;
        return (!q || text.includes(q)) && okFilter;
      }).map((a) => [a.id, a.sev, a.title, a.node, a.gpu, a.state, a.time ? new Date(a.time).toISOString() : "", a.desc]);
    } else if (route === "usage") {
      name = "usage";
      header = ["Slurm 账户", "GPU·h"];
      rows = DB.ACCOUNTS.map((a) => [a.name, a.usage]);
    } else {
      name = "nodes";
      const q = searchOf("#nodeSearch");
      const state = activeKey("[data-node-state]", "nodeState");
      header = ["节点", "分区", "GPU 使用", "利用率%", "温度℃", "状态", "模型"];
      rows = DB.NODES.filter((n) => {
        const text = [n.name, n.partition, n.state, n.model].join(" ").toLowerCase();
        return (!q || text.includes(q)) && (state === "all" || n.state === state);
      }).map((n) => {
        const list = DB.GPUS.filter((g) => g.node === n.name);
        const used = list.filter((g) => g.state === "allocated").length;
        return [n.name, n.partition, `${used}/${list.length || n.gpus || 0}`, n.util, n.temp, n.state, n.model];
      });
    }
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadTextFile(`starrail-${name}-${stamp}.csv`, csv);
    UI.toast(`已导出 ${rows.length} 条 ${name} 数据`, "ok");
  }

  function openResourceInfo() {
    openDrawer(`<div class="drawer-head" style="border-top:3px solid var(--cyan)">
      <div><div class="eyebrow">资源与作业 · 资源目录</div><h3>集群资源说明</h3><div class="drawer-sub">任务通过 Slurm 提交到真实 GPU 节点</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body">
      ${UI.panel({ title: "调度资源", body: `<div class="mini-list">
        <div class="mini-row"><span class="lbl">GPU 服务器</span><span class="val">${DB.NODES.length} 台</span></div>
        <div class="mini-row"><span class="lbl">GPU 总数</span><span class="val">${window.__GPU_EMPTY ? "GPU Agent 未上报" : DB.TOTALS.gpus + " 卡"}</span></div>
        <div class="mini-row"><span class="lbl">Slurm 分区</span><span class="val">gpu</span></div>
        <div class="mini-row"><span class="lbl">Slurm Account</span><span class="val">platform</span></div>
        <div class="mini-row"><span class="lbl">单作业 GPU</span><span class="val">1 - 8 卡</span></div>
        <div class="mini-row"><span class="lbl">最长运行时长</span><span class="val">1h / 4h / 12h / 24h / 72h</span></div>
      </div>` })}
      <div class="divider" style="margin:14px 0"></div>
      <div class="callout">${UI.icon("info", 15)}<span>“快速提交”会以当前 FreeIPA 身份调用 sbatch；提交成功后作业中心显示真实 Slurm JobId。镜像字段仅作为作业元数据记录，运行命令在 GPU 节点上执行。</span></div>
    </div>`);
  }

  function saveJobTemplate() {
    const form = $("#submitForm");
    if (!form) return;
    const fd = new FormData(form);
    const template = {
      name: String(fd.get("name") || ""),
      partition: String(fd.get("partition") || "gpu"),
      gpus: Number(fd.get("gpus") || 1),
      time: String(fd.get("time") || "1h"),
      image: String(fd.get("image") || ""),
      command: String(fd.get("command") || ""),
    };
    try { localStorage.setItem(jobTemplateKey(), JSON.stringify(template)); } catch (e) { /* ignore */ }
    UI.toast("作业模板已保存到当前浏览器", "ok");
  }

  function downloadJobLog() {
    const jobId = parse().param;
    const job = jobId ? DB.jobById(jobId) : null;
    const view = $(".log-view");
    let text = view ? view.innerText : "";
    if (!text.trim() && job) text = `作业 ${job.id} ${job.name} 当前状态：${UI.statusLabel(job.state)}`;
    if (!text.trim()) return UI.toast("当前没有可下载的日志", "warn");
    downloadTextFile(`starrail-job-${job ? job.id : "log"}.log`, text, "text/plain;charset=utf-8");
    UI.toast("作业日志已下载", "ok");
  }

  function openUsageDefinition() {
    openDrawer(`<div class="drawer-head" style="border-top:3px solid var(--cyan)">
      <div><div class="eyebrow">计量 · 资源用量</div><h3>统计口径</h3><div class="drawer-sub">GPU·h 与作业数据的计算方式</div></div>
      <button class="icon-btn drawer-close" data-drawer-close aria-label="关闭">${UI.icon("close", 16)}</button>
    </div>
    <div class="drawer-body">
      ${UI.panel({ title: "GPU·h", body: `<div class="mini-list">
        <div class="mini-row"><span class="lbl">计算公式</span><span class="val">GPU 数量 × 运行小时</span></div>
        <div class="mini-row"><span class="lbl">数据来源</span><span class="val">Slurm 作业 elapsed</span></div>
        <div class="mini-row"><span class="lbl">统计窗口</span><span class="val">近 30 天</span></div>
        <div class="mini-row"><span class="lbl">空闲资源</span><span class="val">不计入用量</span></div>
      </div>` })}
      <div class="divider" style="margin:14px 0"></div>
      <div class="callout">${UI.icon("info", 15)}<span>用量按已完成/运行中作业的 GPU 数量与实际运行时长汇总；排队和取消作业不计入 GPU·h。真实数据由各集群 Slurm agent 上报。</span></div>
    </div>`);
  }

  async function ensureCsrf() {
    if (window.__CSRF) return true;
    try {
      const res = await fetch("/api/v1/me", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) return false;
      const body = await res.json();
      applyIdentity(body.data || body);
      return !!window.__CSRF;
    } catch (e) { return false; }
  }

  async function apiWrite(path, options) {
    await ensureCsrf();
    const opts = Object.assign({}, options || {});
    const headers = Object.assign({}, opts.headers || {});
    if (window.__CSRF) headers["X-CSRF-Token"] = window.__CSRF;
    headers["X-Requested-With"] = "XMLHttpRequest";
    opts.headers = headers;
    opts.credentials = "same-origin";
    const res = await fetch(path, opts);
    const contentType = res.headers.get("content-type") || "";
    // 会话过期时 oauth2-proxy 会把写请求重定向到登录页，fetch 得到的是 200 HTML。
    // 不能把它当作写操作成功，否则前端会误报“已取消/已提交”。
    if (res.redirected || contentType.includes("text/html")) {
      setTimeout(() => {
        if (!location.pathname.startsWith("/oauth2/")) {
          location.href = "/oauth2/sign_in?rd=" + encodeURIComponent(location.pathname + location.search + location.hash);
        }
      }, 800);
      return new Response(JSON.stringify({ code: "AUTH_REQUIRED", message: "会话已过期，请重新登录" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    return res;
  }
  window.apiWrite = apiWrite;

  let syncBusy = false;
  let livePollTimer = null;
  let liveStream = null;
  let lastStreamSync = 0;
  let authWatchTimer = null;
  let streamRetryTimer = null;
  function shouldLiveRender() {
    const route = parse().route;
    if (!["dashboard", "monitor", "gpus", "alerts", "jobs"].includes(route)) return false;
    if (document.visibilityState === "hidden") return false;
    if (drawer && drawer.classList.contains("open")) return false;
    if ($("#modalOverlay") && !$("#modalOverlay").hidden) return false;
    if ($("#paletteOverlay") && !$("#paletteOverlay").hidden) return false;
    if ($(".popover.open")) return false;
    if (route === "jobs") {
      const bulkBar = $("#jobBulkBar");
      if (bulkBar && !bulkBar.hidden) return false;
      if ($$(".job-check").some((c) => c.checked)) return false;
    }
    const activeFilters = $$('[data-job-state].active, [data-alert-filter].active, [data-gpu-state].active, [data-node-state].active')
      .filter((el) => (el.dataset.jobState || el.dataset.alertFilter || el.dataset.gpuState || el.dataset.nodeState) !== "all");
    if (activeFilters.length) return false;
    const jobPart = $("#jobPartition");
    if (jobPart && jobPart.value !== "all") return false;
    const searching = ["#jobSearch", "#alertSearch", "#gpuSearch", "#nodeSearch", "#auditSearch", "#userSearch"]
      .some((selector) => { const input = $(selector); return input && input.value.trim(); });
    if (searching) return false;
    if ($('[data-alert-view="timeline"].active')) return false;
    const el = document.activeElement;
    if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return false;
    return true;
  }
  function startAuthWatchdog() {
    if (authWatchTimer) return;
    authWatchTimer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/v1/me", { cache: "no-store", credentials: "same-origin" });
        if (res.status === 401) {
          const next = encodeURIComponent(location.pathname + location.hash);
          const mode = (window.__ME && window.__ME.auth_mode) || "proxy";
          location.href = mode === "local" ? "/login?next=" + next : "/oauth2/sign_in?rd=" + next;
        }
      } catch (e) { /* 网络抖动交给常规离线处理 */ }
    }, 30000);
  }

  function startLivePolling(intervalMs = 3000) {
    if (new URLSearchParams(location.search).get("demo")) return;
    if (livePollTimer) { clearInterval(livePollTimer); livePollTimer = null; }
    livePollTimer = setInterval(() => {
      if (document.visibilityState === "visible") syncLiveData(true);
    }, intervalMs);
  }
  function startEventStream() {
    if (new URLSearchParams(location.search).get("demo")) return;
    if (!window.EventSource) { startLivePolling(); return; }
    if (liveStream || streamRetryTimer) return;
    try {
      liveStream = new EventSource((window.__API_PREFIX || "") + "/api/v1/stream/events", { withCredentials: true });
      lastStreamSync = Date.now();
      liveStream.onopen = () => {
        if (streamRetryTimer) { clearTimeout(streamRetryTimer); streamRetryTimer = null; }
        window.__LIVE_MODE = "sse";
        setApiStatus(true);
        // SSE 只覆盖 GPU/作业/告警；趋势、用户、系统等仍需要慢速 REST 刷新。
        startLivePolling(15000);
      };
      liveStream.addEventListener("snapshot", (event) => {
        // SSE 直接应用快照，不再触发额外 REST 请求；轮询仅作为回退。
        if (syncBusy) return;
        try {
          const payload = JSON.parse(event.data || "{}");
          syncBusy = true;
          applyStreamSnapshot(payload);
        } catch (e) {
          // 忽略单条损坏事件，等待下一次快照
        } finally {
          syncBusy = false;
        }
      });
      liveStream.onerror = () => {
        setApiStatus(false);
        window.__LIVE_MODE = "poll-fallback";
        startLivePolling();
        try { liveStream.close(); } catch (e) { /* ignore */ }
        liveStream = null;
        if (!streamRetryTimer) {
          streamRetryTimer = setTimeout(() => {
            streamRetryTimer = null;
            startEventStream();
          }, 30000);
        }
      };
    } catch (e) {
      startLivePolling();
    }
  }

  function applyStreamSnapshot(data) {
    const gpuMap = new Map((data.gpus || []).map((g) => [g.server + "#" + g.index, g]));
    DB.GPUS.forEach((g) => {
      const live = gpuMap.get(g.node + "#" + g.index);
      if (!live) return;
      if (live.temperature_c != null) g.temp = Math.round(live.temperature_c);
      if (live.power_w != null) g.power = Math.round(live.power_w);
      if (live.utilization_pct != null) g.util = Math.round(live.utilization_pct);
      if (live.memory_total_mb) g.memUsed = Math.round((live.memory_used_mb / live.memory_total_mb) * 100);
      if (live.xid) g.xid = live.xid;
      if (live.state) g.state = live.state;
    });
    DB.NODES.forEach((node) => {
      const list = DB.GPUS.filter((g) => g.node === node.name);
      if (!list.length) return;
      node.util = Math.round(list.reduce((a, g) => a + g.util, 0) / list.length);
      node.temp = Math.round(list.reduce((a, g) => a + g.temp, 0) / list.length);
      const st = list.map((g) => g.state);
      node.state = st.includes("error") ? "degraded" : st.includes("drain") ? "drain" : "online";
    });
    const count = (s) => DB.GPUS.filter((g) => g.state === s).length;
    DB.TOTALS.allocated = count("allocated");
    DB.TOTALS.idle = count("idle");
    DB.TOTALS.error = count("error");
    DB.TOTALS.drain = count("drain");
    DB.TOTALS.utilization = Math.round((DB.TOTALS.allocated / Math.max(1, DB.GPUS.length)) * 1000) / 10;
    if (Array.isArray(data.jobs)) hydrateJobs(data.jobs);
    if (Array.isArray(data.alerts)) hydrateAlerts(data.alerts);
    updateUserPopMetrics();
    if (shouldLiveRender()) {
      const y = window.scrollY;
      render(true);
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
    }
  }

  function setApiStatus(online) {
    const wasOffline = window.__API_ONLINE === false;
    window.__API_ONLINE = online;
    if (!online && !wasOffline && !window.__DATA_LIVE && !new URLSearchParams(location.search).get("demo")) {
      clearLiveBusinessData();
      if (window.__APP_BOOTED) render(true);
    }
    if (online && wasOffline && window.__APP_BOOTED) render(true);
    let banner = document.getElementById("apiOfflineBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "apiOfflineBanner";
      banner.style.cssText = "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:9999;padding:7px 14px;border-radius:8px;background:#7f1d1d;color:#fecaca;font-size:12px;box-shadow:0 4px 16px rgba(0,0,0,.35)";
      document.body.appendChild(banner);
    }
    banner.textContent = window.__DATA_LIVE
      ? "API 离线 · 实时数据不可用，页面仅显示最近已知快照"
      : "API 离线 · 尚无可用数据，正在自动重试";
    banner.hidden = online;
    const svcState = $("#svcState");
    if (svcState) {
      svcState.textContent = online ? "平台服务在线" : "平台服务异常";
      svcState.style.color = online ? "" : "var(--red)";
    }
    const liveText = $("#livePillText");
    if (liveText) liveText.textContent = online ? (window.__LIVE_MODE === "poll-fallback" ? "轮询" : "实时") : "离线";
    const livePill = $("#livePill");
    if (livePill) livePill.style.opacity = online ? "" : "0.6";
    $$(".live-pill").forEach((el) => {
      el.innerHTML = "<i></i>" + (online
        ? (window.__LIVE_MODE === "poll-fallback" ? "轮询数据 · 3s 更新" : "实时数据 · 3s 更新")
        : "数据离线");
    });
    $$("[data-live-delta]").forEach((el) => {
      el.textContent = online ? (window.__LIVE_MODE === "poll-fallback" ? "轮询" : "实时") : "离线快照";
    });
    const small = $("#clusterSwitcher .cp-text small");
    if (small) {
      const current = small.textContent || "";
      small.textContent = online
        ? current.replace(/API (在线|离线)/, "API 在线")
        : current.replace(/API (在线|离线)/, "API 离线");
    }
  }

  let bootLoadingHidden = false;
  function hideBootLoading() {
    if (bootLoadingHidden) return;
    bootLoadingHidden = true;
    const el = document.getElementById("bootLoading");
    if (!el) return;
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 160);
  }

  async function syncLiveData(silent) {
    if (!/^https?:$/.test(location.protocol) || syncBusy) return;
    syncBusy = true;
    let healthTimer = null;
    try {
      const controller = new AbortController();
      healthTimer = setTimeout(() => controller.abort(), 3500);
      const healthRes = await fetch("/api/v1/health", { cache: "no-store", signal: controller.signal });
      clearTimeout(healthTimer);
      healthTimer = null;
      if (!healthRes.ok) {
        setApiStatus(false);
        return;
      }
      const healthType = healthRes.headers.get("content-type") || "";
      if (healthRes.redirected || !healthType.includes("application/json")) {
        setApiStatus(false);
        // 只跳转真正的登录页；fetch 可能跟随 OAuth 后落到 /api/ 接口，
        // 不能把接口 JSON 当成页面地址导航。
        const target = healthRes.url || "";
        if (/\/(oauth2\/sign_in|dex\/auth|\/login)([?#]|$)/.test(target) && !target.includes("/api/")) {
          location.href = target;
        }
        return;
      }
      const healthBody = await healthRes.json();
      const health = healthBody.data || healthBody;

      const meRes = await fetch("/api/v1/me", { cache: "no-store" });
      if (meRes.status === 401) {
        const next = encodeURIComponent(location.pathname + location.hash);
        location.href = health.auth_mode === "local" ? "/login?next=" + next : "/oauth2/sign_in?rd=" + next;
        return;
      }
      if (meRes.ok) {
        const meBody = await meRes.json();
        applyIdentity(meBody.data || meBody);
        if (!can(parse().route)) {
          location.hash = "#/dashboard";
          return;
        }
      }

      let merged = 0;
      let gpuRecovered = false;
      const canSeeGpus = !ME || (ME.roles || []).some((r) => ["admin", "ops", "auditor"].includes(r));
      window.__DATA_OK = window.__DATA_OK || {};
      window.__GPU_EMPTY = false;
      const gpuRes = canSeeGpus ? await fetch("/api/v1/gpus", { cache: "no-store" }) : null;
      const gpusOk = gpuRes ? gpuRes.ok : null;
      if (gpuRes && gpuRes.ok) {
        const gpuBody = await gpuRes.json();
        const payload = gpuBody.data || gpuBody;
        const gpuList = payload.gpus || [];
        if (!gpuList.length) {
          // Agent 尚未上报：不能展示静态或模拟 GPU 指标。
          window.__GPU_EMPTY = true;
          DB.GPUS.length = 0;
          DB.TOTALS.gpus = 0;
          DB.TOTALS.gpuServers = 0;
          DB.TOTALS.allocated = 0;
          DB.TOTALS.idle = 0;
          DB.TOTALS.error = 0;
          DB.TOTALS.drain = 0;
          DB.TOTALS.utilization = 0;
          DB.NODES.forEach((node) => { node.util = 0; node.temp = 0; node.gpuUsed = 0; });
          DB.PARTITION_STATS.forEach((p) => { p.total = 0; p.used = 0; p.error = 0; });
        } else {
          if (DB.GPUS.length === 0) {
            // Agent 恢复上报后重建 GPU 行，否则空状态清空过的 DB.GPUS 永远不会恢复。
            gpuRecovered = true;
            const specs = DB.MODELS || {};
            gpuList.forEach((g) => {
              const node = DB.NODES.find((n) => n.name === (g.server || ""));
              const model = g.model || (node && node.model) || DB.GPU_MODEL;
              const spec = specs[model] || specs[DB.GPU_MODEL] || { mem: 0, tdp: 0, arch: "" };
              DB.GPUS.push({
                uuid: g.uuid || "", node: g.server || "gpu-01", index: Number(g.index) || 0,
                partition: node ? node.partition : "gpu", model, spec, state: g.state || "idle",
                util: Math.round(g.utilization_pct || 0), temp: Math.round(g.temperature_c || 0),
                power: Math.round(g.power_w || 0),
                memUsed: g.memory_total_mb ? Math.round((g.memory_used_mb / g.memory_total_mb) * 100) : 0,
                jobId: g.jobId || null, user: null, xid: g.xid || null
              });
            });
            DB.TOTALS.gpus = DB.GPUS.length;
            DB.TOTALS.gpuServers = new Set(DB.GPUS.map((g) => g.node)).size;
          }
          const map = new Map(gpuList.map((g) => [g.server + "#" + g.index, g]));
        DB.GPUS.forEach((g) => {
          const live = map.get(g.node + "#" + g.index);
          if (!live) return;
          merged++;
          if (live.temperature_c != null) g.temp = Math.round(live.temperature_c);
          if (live.power_w != null) g.power = Math.round(live.power_w);
          if (live.utilization_pct != null) g.util = Math.round(live.utilization_pct);
          if (live.memory_total_mb) g.memUsed = Math.round((live.memory_used_mb / live.memory_total_mb) * 100);
          if (live.xid) g.xid = live.xid;
          if (live.state) g.state = live.state;
        });
        DB.NODES.forEach((node) => {
          const list = DB.GPUS.filter((g) => g.node === node.name);
          if (!list.length) return;
          node.util = Math.round(list.reduce((a, g) => a + g.util, 0) / list.length);
          node.temp = Math.round(list.reduce((a, g) => a + g.temp, 0) / list.length);
          const st = list.map((g) => g.state);
          node.state = st.includes("error") ? "degraded" : st.includes("drain") ? "drain" : "online";
        });
        const count = (s) => DB.GPUS.filter((g) => g.state === s).length;
        DB.TOTALS.allocated = count("allocated");
        DB.TOTALS.idle = count("idle");
        DB.TOTALS.error = count("error");
        DB.TOTALS.drain = count("drain");
        DB.TOTALS.utilization = Math.round((DB.TOTALS.allocated / Math.max(1, DB.GPUS.length)) * 1000) / 10;
        if (Array.isArray(DB.PARTITION_STATS)) {
          DB.PARTITION_STATS.forEach((p) => {
            const list = DB.GPUS.filter((g) => g.partition === p.id);
            p.total = list.length;
            p.used = list.filter((g) => g.state === "allocated").length;
            p.error = list.filter((g) => g.state === "error").length;
            p.pending = DB.JOBS.filter((j) => j.state === "pending" && j.partition === p.id).length;
          });
        }
      }
      }

      await hydrateBusinessData(canSeeGpus);
      window.__DATA_OK.gpus = gpusOk;
      window.__DATA_LIVE = true;
      updateUserPopMetrics();
      startEventStream();
      const small = $("#clusterSwitcher .cp-text small");
      if (small) small.textContent = window.__GPU_EMPTY ? "自用 · GPU 未上报 · API 在线" : `自用 · ${health.gpu_count} 卡 · API 在线`;
      setApiStatus(true);
      hideBootLoading();
      const strip = $("#apiStrip");
      if (strip) strip.textContent = "API 在线";
      if (!new URLSearchParams(location.search).get("demo") && (merged || ME)) {
        if (gpuRecovered || !silent || shouldLiveRender()) {
          const y = window.scrollY;
          render(true);
          requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "instant" }));
        }
      }
    } catch (e) {
      setApiStatus(false);
      hideBootLoading();
      if (!new URLSearchParams(location.search).get("demo")) startLivePolling();
      const strip = $("#apiStrip");
      if (strip) strip.textContent = "API 离线";
      if (!silent) UI.toast("后端连接失败，显示的数据可能不是最新", "err");
    }
    finally {
      if (healthTimer) clearTimeout(healthTimer);
      syncBusy = false;
    }
  }

  /* ---------------- boot ---------------- */
  bindScrollChrome();
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("noanim") === "1" || navigator.webdriver) document.documentElement.classList.add("no-anim");
    const themeParam = params.get("theme");
    const theme = themeParam || localStorage.getItem("hpc-theme");
    if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
    if (localStorage.getItem("hpc-sidebar") === "1") document.body.classList.add("sidebar-collapsed");
  } catch (e) { /* ignore */ }

  renderNav();
  try {
    const depth = sessionStorage.getItem("hpc-depth");
    if (depth && /^#\/[a-z0-9/_-]*$/i.test(depth) && !location.hash) {
      sessionStorage.removeItem("hpc-depth");
      history.replaceState(null, "", location.pathname + depth);
    }
  } catch (e) { /* ignore */ }
  initPopovers();
  const initialBell = $("#bellBtn");
  if (initialBell) initialBell.classList.toggle("has-dot", unreadAlertCount() > 0);
  render();
  window.__APP_BOOTED = true;
  ensureCsrf();
  setTimeout(syncLiveData, 500);
  setTimeout(() => {
    if (!window.__DATA_LIVE && !new URLSearchParams(location.search).get("demo")) {
      // 后端长时间无响应时也不能把种子数据当作真实数据展示。
      clearLiveBusinessData();
      DB.GPUS.length = 0;
      window.__GPU_EMPTY = true;
      DB.TOTALS.gpus = 0;
      DB.TOTALS.gpuServers = 0;
      DB.TOTALS.allocated = 0;
      DB.TOTALS.idle = 0;
      DB.TOTALS.error = 0;
      DB.TOTALS.utilization = 0;
      setApiStatus(false);
      if (window.__APP_BOOTED) render(true);
    }
    hideBootLoading();
  }, 8000);
  startAuthWatchdog();
  try {
    const demo = new URLSearchParams(location.search).get("demo");
    if (demo === "notif" || demo === "user") setTimeout(() => togglePopover(demo === "user" ? "userPop" : "notifPop"), 450);
    if (demo === "notifread") setTimeout(() => {
      togglePopover("notifPop");
      setTimeout(() => { const b = $("#notifMarkAll"); if (b) b.click(); }, 350);
    }, 450);
    if (demo === "shortcuts") setTimeout(() => UI.shortcuts(), 500);
    if (demo === "drawer") setTimeout(() => {
      const g = DB.GPUS.find((x) => x.state === "allocated") || DB.GPUS[0];
      openDrawer(Pages.gpuDrawer(g.uuid));
    }, 450);
    if (demo === "palette") setTimeout(openPalette, 450);
    if (demo === "ruledrawer") setTimeout(() => openDrawer(Pages.ruleDrawer("R-01")), 450);
    if (demo === "userdrawer") setTimeout(() => {
      const u = DB.USERS.find((x) => DB.JOBS.some((j) => j.user === x.name)) || DB.USERS[0];
      openDrawer(Pages.userDrawer(u.name));
    }, 450);
    if (demo === "sort") setTimeout(() => {
      const th = $(".jobs-table th.sortable[data-sort-index='5']") || $(".jobs-table th.sortable");
      if (th) th.click();
    }, 600);
    if (demo === "gpusort") setTimeout(() => {
      const s = $("#gpuSort");
      if (s) { s.value = "util"; s.dispatchEvent(new Event("change", { bubbles: true })); }
    }, 550);
    if (demo === "chartempty") setTimeout(() => {
      const chart = $("#view .chart");
      if (chart) chart.outerHTML = Charts.empty("最近 24 小时无采样数据");
    }, 550);
    if (demo === "timeline") setTimeout(() => {
      const b = $("[data-alert-view='timeline']");
      if (b) b.click();
    }, 550);
    if (demo === "gpugroup") setTimeout(() => {
      const b = $("[data-gpu-view='group']");
      if (b) b.click();
    }, 550);
    if (demo === "bulk") setTimeout(() => {
      $$(".job-check").slice(0, 3).forEach((c) => {
        c.checked = true;
        c.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }, 550);
    if (demo === "bulkconfirm") setTimeout(() => {
      $$(".job-check").slice(0, 3).forEach((c) => {
        c.checked = true;
        c.dispatchEvent(new Event("change", { bubbles: true }));
      });
      setTimeout(() => {
        const b = $("[data-bulk='cancel']");
        if (b) b.click();
      }, 320);
    }, 500);
    if (demo === "bulkcancel") setTimeout(() => {
      $$(".job-check").slice(0, 3).forEach((c) => {
        c.checked = true;
        c.dispatchEvent(new Event("change", { bubbles: true }));
      });
      setTimeout(() => {
        const b = $("[data-bulk='cancel']");
        if (b) b.click();
        setTimeout(() => { const ok = $("[data-modal-ok]"); if (ok) ok.click(); }, 320);
      }, 300);
    }, 500);
    if (demo === "btnloading") setTimeout(() => {
      const r = $("#refreshBtn");
      if (r) { r.classList.add("loading"); r.disabled = true; }
      const ex = $('[data-action="export"]');
      if (ex) { ex.classList.add("loading"); ex.disabled = true; }
    }, 400);
    if (demo === "gpuerror") setTimeout(() => {
      const g = $("[data-gpu-view='group']");
      if (g) g.click();
      setTimeout(() => { const j = $(".ggh-state.bad"); if (j) j.click(); }, 480);
    }, 450);
    if (demo === "singlecancel") setTimeout(() => {
      const b = $('[data-action="cancel-job"]');
      if (b) {
        b.click();
        setTimeout(() => { const ok = $("[data-modal-ok]"); if (ok) ok.click(); }, 300);
      }
    }, 500);
    if (demo === "joblogs" || demo === "jobgpu") setTimeout(() => {
      const target = demo === "joblogs" ? "logs" : "gpus";
      const btn = $(`[data-tab-group="job"][data-tab-target="${target}"]`);
      if (btn) btn.click();
    }, 600);
    if (demo === "estimate") setTimeout(() => {
      const form = $("#submitForm");
      if (!form) return;
      const r = $("#gpuRange"), p = $("#submitPartition"), t = $("#submitTime");
      if (r) r.value = "4"; if (p) p.value = "gpu"; if (t) t.value = "12h";
      [r, p, t].forEach((el) => {
        if (!el) return;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }, 550);
    if (demo === "empty") setTimeout(() => {
      ["#jobSearch", "#gpuSearch", "#alertSearch", "#nodeSearch", "#auditSearch"].forEach((sel) => {
        const el = $(sel);
        if (el) { el.value = "zzz-no-match"; el.dispatchEvent(new Event("input", { bubbles: true })); }
      });
    }, 450);
    if (new URLSearchParams(location.search).get("debug") === "layout") {
      setTimeout(() => {
        const wide = [];
        $$("body *").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 1 && r.width > 0 && wide.length < 10) {
            wide.push((el.tagName + "." + (typeof el.className === "string" ? el.className : "")).slice(0, 52) + " w=" + Math.round(r.width) + " right=" + Math.round(r.right));
          }
        });
        const box = document.createElement("div");
        box.style.cssText = "position:fixed;left:0;top:0;z-index:9999;background:#000;color:#0f0;font:11px monospace;padding:8px;white-space:pre;max-width:100%";
        box.textContent = "inner=" + window.innerWidth + " docScroll=" + document.documentElement.scrollWidth + " bodyScroll=" + document.body.scrollWidth + "\n" + wide.join("\n");
        document.body.appendChild(box);
      }, 700);
    }
  } catch (e) { /* ignore */ }
})();





