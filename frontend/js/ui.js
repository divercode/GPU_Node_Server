/* =========================================================
   UI helpers — icons, badges, cards, tables, toasts, modal
   ========================================================= */
(function () {
  const ICONS = {
    dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/>',
    catalog: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2"/>',
    jobs: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1.2"/><circle cx="4.5" cy="12" r="1.2"/><circle cx="4.5" cy="18" r="1.2"/>',
    monitor: '<path d="M3 12h3.6l2.2-6.4 4.2 12.8 2.4-6.4H21"/>',
    gpu: '<rect x="7" y="7" width="10" height="10" rx="2.4"/><path d="M9.5 3.5v3.5M14.5 3.5v3.5M9.5 17v3.5M14.5 17v3.5M3.5 9.5H7M3.5 14.5H7M17 9.5h3.5M17 14.5h3.5"/>',
    alert: '<path d="M12 3.6 21 19.4H3z"/><path d="M12 9.3v4.4"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>',
    usage: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
    users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.6 5.5-5.6s5.5 2.3 5.5 5.6"/><path d="M16 5.2a3 3 0 0 1 0 5.6M17.6 14.9c1.9.6 3.1 2.3 3.1 4.6"/>',
    rules: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.4"/><circle cx="9" cy="17" r="2.4"/>',
    audit: '<path d="M12 3 19.5 6v5.4c0 4.6-3.1 7.7-7.5 9.6-4.4-1.9-7.5-5-7.5-9.6V6z"/><path d="m9 12 2.1 2.1L15.4 9.9"/>',
    system: '<rect x="3.5" y="4" width="17" height="7" rx="2"/><rect x="3.5" y="13" width="17" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    download: '<path d="M12 4v10M8 10l4 4 4-4"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>',
    filter: '<path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    chevron: '<path d="M9 6l6 6-6 6"/>',
    "chevron-down": '<path d="M6 9l6 6 6-6"/>',
    "arrow-up": '<path d="M12 19V5M6 11l6-6 6 6"/>',
    "arrow-down": '<path d="M12 5v14M6 13l6 6 6-6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    "check-circle": '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.2 2.4 2.4 4.8-4.9"/>',
    alertCircle: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.8v4.8"/><circle cx="12" cy="16.2" r=".9" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 2"/>',
    zap: '<path d="M13 2.8 5.5 13.4H11l-1 7.8 8-11h-5.6z"/>',
    play: '<path d="M8 5.6v12.8l10-6.4z"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    terminal: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><path d="m7.5 9.5 3 2.5-3 2.5M12.5 15h4"/>',
    server: '<rect x="4" y="3.5" width="16" height="7" rx="2"/><rect x="4" y="13.5" width="16" height="7" rx="2"/><path d="M8 7h.01M8 17h.01"/>',
    cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 2.5v4M14 2.5v4M10 17.5v4M14 17.5v4M2.5 10h4M2.5 14h4M17.5 10h4M17.5 14h4"/>',
    memory: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 17v3M12 17v3M17 17v3M7 10.5h.01M12 10.5h.01M17 10.5h.01"/>',
    activity: '<path d="M3 12h4l2.5-6 4 12 2.5-6h5"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"/>',
    terminal2: '<path d="m7 8 4 4-4 4M13 16h4"/>',
    external: '<path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 6.5 8 6 8-6"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.4"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    database: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/><path d="M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.2 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.2-3.6-8.5S9.6 5.8 12 3.5z"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H10a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V10a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.6 1z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M17 6l2 2M19 4l2 2"/>',
    logout: '<path d="M14 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l-4-4 4-4M6 12h9"/>',
    userCheck: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.3 2.5-5.6 5.5-5.6 1 0 2 .3 2.8.8"/><path d="m15 17.5 2 2 4-4.5"/>'
  };

  const TONE = {
    cyan: { c: "rgba(34,211,238,.3)", s: "#22d3ee" },
    violet: { c: "rgba(139,92,246,.32)", s: "#a78bfa" },
    indigo: { c: "rgba(99,102,241,.32)", s: "#818cf8" },
    green: { c: "rgba(52,211,153,.3)", s: "#34d399" },
    amber: { c: "rgba(251,191,36,.3)", s: "#fbbf24" },
    red: { c: "rgba(248,113,113,.32)", s: "#f87171" },
    blue: { c: "rgba(96,165,250,.3)", s: "#60a5fa" }
  };

  const UI = {
    esc(value) {
      return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
    },
    icon(name, size) {
      return `<svg class="icon" width="${size || 18}" height="${size || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.info}</svg>`;
    },
    statusLabel(state) { return (window.DB && DB.STATUS_LABEL[state]) || UI.esc(state); },
    statusTone(state) { return (window.DB && DB.STATUS_TONE[state]) || "slate"; },
    badge(state, text) {
      return `<span class="badge ${UI.statusTone(state)}">${text || UI.statusLabel(state)}</span>`;
    },
    severity(sev) {
      const map = { critical: ["red", "严重"], warning: ["amber", "警告"], info: ["blue", "信息"] };
      const m = map[sev] || ["slate", UI.esc(sev)];
      return `<span class="badge ${m[0]}">${m[1]}</span>`;
    },
    avatar(name) { return `<span class="avatar">${UI.esc(String(name || "?").slice(0, 1))}</span>`; },
    kpi(cfg) {
      const tone = TONE[cfg.tone || "cyan"] || TONE.cyan;
      const delta = cfg.delta && cfg.dir !== "flat"
        ? `<span class="delta ${cfg.dir || "up"}">${cfg.dir === "down" ? UI.icon("arrow-down", 11) : UI.icon("arrow-up", 11)}${cfg.delta}</span>`
        : "";
      const valueHtml = cfg.count !== undefined
        ? `<span class="kpi-num" data-count="${cfg.count}" data-decimals="${cfg.decimals || 0}">0</span>`
        : cfg.value;
      return `<div class="kpi" style="--tone:${tone.c};--tone-solid:${tone.s}">
        <div class="kpi-top"><span class="kpi-label">${cfg.label}</span><span class="kpi-ic">${UI.icon(cfg.icon || "activity", 15)}</span></div>
        <div class="kpi-value">${valueHtml}${cfg.unit ? `<small>${cfg.unit}</small>` : ""}</div>
        <div class="kpi-sub">${cfg.foot || ""}</div>
        <div class="kpi-foot">${delta}${cfg.spark || ""}</div>
      </div>`;
    },
    pageHead(cfg) {
      return `<div class="page-head">
        <div>
          ${cfg.eyebrow ? `<div class="eyebrow"><span class="dot cyan"></span>${cfg.eyebrow}</div>` : ""}
          <h1>${cfg.title}</h1>
          ${cfg.sub ? `<div class="sub">${cfg.sub}</div>` : ""}
        </div>
        ${cfg.actions ? `<div class="page-actions">${cfg.actions}</div>` : ""}
      </div>`;
    },
    panel(cfg) {
      return `<section class="panel ${cfg.class || ""}">
        <div class="panel-head">
          <div>
            <div class="panel-title">${cfg.title}${cfg.tag ? `<span class="tag">${cfg.tag}</span>` : ""}</div>
            ${cfg.sub ? `<div class="panel-sub">${cfg.sub}</div>` : ""}
          </div>
          ${cfg.extra ? `<div class="panel-extra">${cfg.extra}</div>` : ""}
        </div>
        ${cfg.body || ""}
      </section>`;
    },
    chips(items, active, attr) {
      return `<div class="chip-row">${items.map((it) => `<button class="chip ${it.key === active ? "active" : ""}" ${attr || "data-chip"}="${it.key}">${it.label}${it.count !== undefined ? `<span class="count">${it.count}</span>` : ""}</button>`).join("")}</div>`;
    },
    tabs(items, active, attr) {
      return `<div class="tabs">${items.map((it) => `<button class="tab ${it.key === active ? "active" : ""}" ${attr || "data-tab"}="${it.key}">${it.label}${it.count !== undefined ? ` <span class="dim">${it.count}</span>` : ""}</button>`).join("")}</div>`;
    },
    hbar(label, value, max, display, color) {
      const pct = Math.max(2, Math.min(100, (value / max) * 100));
      const fill = color ? `background:linear-gradient(90deg,${color},${color}aa)` : "";
      return `<div class="hbar"><span class="nm">${label}</span><span class="track"><i style="width:${pct.toFixed(1)}%;${fill}"></i></span><span class="vl">${display}</span></div>`;
    },
    progress(pct, cls) {
      return `<span class="bar ${cls || ""}"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i></span>`;
    },
    table(head, rows, opts) {
      const o = opts || {};
      const body = Array.isArray(rows) ? rows.join("") : (rows || "");
      return `<div class="table-wrap"><table class="table ${o.cls || ""}">
        <thead><tr>${head.map((h) => `<th${h.cls ? ` class="${h.cls}"` : ""}>${h.label !== undefined ? h.label : h}</th>`).join("")}</tr></thead>
        <tbody>${body}</tbody>
      </table></div>`;
    },
    empty(text) { return `<div class="empty">${text || "暂无数据"}</div>`; },
    kv(rows) {
      return `<dl class="kv">${rows.map((r) => `<dt>${r[0]}</dt><dd class="${r[2] || ""}">${r[1]}</dd>`).join("")}</dl>`;
    },
    toast(msg, type) {
      const stack = document.getElementById("toasts");
      if (!stack) return;
      const text = String(msg == null ? "" : msg);
      // 同类提示不重复堆叠，最多保留 4 条，避免连续点击刷屏。
      if (Array.from(stack.querySelectorAll(".toast")).some((n) => n.textContent.trim() === text)) return;
      while (stack.children.length >= 4) stack.firstElementChild.remove();
      const t = type || "ok";
      const icons = { ok: "check-circle", warn: "alertCircle", err: "x", info: "info" };
      const el = document.createElement("div");
      el.className = "toast " + t;
      el.innerHTML = `<span class="t-ic">${UI.icon(icons[t] || "info", 14)}</span><div>${msg}</div>`;
      stack.appendChild(el);
      setTimeout(() => { el.style.opacity = "0"; el.style.transform = "translateY(10px)"; el.style.transition = "all .25s"; setTimeout(() => el.remove(), 260); }, 3400);
    },
    confirm(title, text, okText, cb) {
      const overlay = document.getElementById("modalOverlay");
      const modal = document.getElementById("modal");
      window.__modalOk = cb || null;
      window.__modalReturnFocus = document.activeElement;
      modal.innerHTML = `<div class="modal-icon">${UI.icon("alert", 22)}</div>
        <div class="modal-head"><h3>${UI.esc(title)}</h3><span class="badge red">高风险操作</span></div>
        <p>${UI.esc(text)}</p>
        <div class="modal-keys"><span><kbd>Esc</kbd> 取消</span><span><kbd>↵</kbd> 确认</span></div>
        <div class="modal-actions">
          <button class="btn" data-modal-cancel>取消</button>
          <button class="btn btn-danger" data-modal-ok>${UI.esc(okText || "确认")}</button>
        </div>`;
      overlay.hidden = false;
      setTimeout(() => { const b = modal.querySelector("[data-modal-ok]"); if (b) b.focus(); }, 30);
      if (window.syncOverlayLock) window.syncOverlayLock();
    },
    closeModal() {
      const overlay = document.getElementById("modalOverlay");
      if (overlay) overlay.hidden = true;
      window.__modalOk = null;
      if (window.__modalReturnFocus && window.__modalReturnFocus.focus) window.__modalReturnFocus.focus();
      window.__modalReturnFocus = null;
      if (window.syncOverlayLock) window.syncOverlayLock();
    },
    shortcuts() {
      const overlay = document.getElementById("modalOverlay");
      const modal = document.getElementById("modal");
      window.__modalOk = null;
      const rows = [
        ["命令面板", ["Ctrl", "K"]], ["个人设置", ["Ctrl", ","]],
        ["关闭浮层 / 弹窗", ["Esc"]], ["面板内选择", ["↑", "↓"]],
        ["确认 / 打开", ["Enter"]], ["浮层内切换焦点", ["Tab"]]
      ].map(([label, keys]) => `<div class="shortcut-row"><span>${label}</span><div class="shortcut-keys">${keys.map((k) => `<kbd>${k}</kbd>`).join("")}</div></div>`).join("");
      modal.innerHTML = `<div class="modal-icon info">${UI.icon("key", 21)}</div>
        <div class="modal-head"><h3>键盘快捷键</h3><span class="badge cyan">效率提示</span></div>
        <p>所有浮层支持 Esc 关闭，Tab 焦点限制在浮层内部；命令面板支持模糊搜索与方向键选择。</p>
        <div class="shortcut-list">${rows}</div>
        <div class="modal-actions"><button class="btn" data-modal-cancel>关闭</button></div>`;
      overlay.hidden = false;
      setTimeout(() => { const b = modal.querySelector("[data-modal-cancel]"); if (b) b.focus(); }, 30);
      if (window.syncOverlayLock) window.syncOverlayLock();
    }
  };

  window.UI = UI;
})();


