/* =========================================================
   SVG chart helpers (dependency-free)
   Charts register their data in window.__charts so the shell
   can render a single hover tooltip for every chart.
   ========================================================= */
(function () {
  let seq = 0;
  const registry = {};
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function reset() {
    seq = 0;
    for (const k in registry) delete registry[k];
    window.__charts = registry;
  }
  reset();

  function reg(data) {
    const id = "chart-" + ++seq;
    registry[id] = data;
    return id;
  }

  function smooth(pts) {
    if (pts.length === 0) return "";
    if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  }

  function axisTicks(max, count) {
    const out = [];
    for (let i = 0; i <= count; i++) out.push((max / count) * i);
    return out;
  }

  function empty(message) {
    return `<div class="chart-empty"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 19V5M4 19h16"/><path d="M8 15l3.5-4 3 2.5L19 7"/></svg><b>暂无数据</b><small>${esc(message || "当前时间范围内没有可用指标")}</small></div>`;
  }

  function line(opts) {
    const labels = opts.labels || [];
    const series = opts.series || [];
    if (!series.length || !series.some((s) => (s.values || []).length)) return empty(opts.emptyText);
    const height = opts.height || 236;
    const W = 720, H = height, L = 46, R = 14, T = 16, B = 30;
    const iw = W - L - R, ih = H - T - B;
    const values = series.reduce((a, s) => a.concat(s.values || []), []);
    const rawMax = Math.max.apply(null, values.length ? values : [1]);
    const max = opts.yMax || Math.max(1, Math.ceil((rawMax * 1.16) / 10) * 10);
    const fmtY = opts.yFmt || ((v) => (v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v)));
    const x = (i) => (labels.length <= 1 ? L + iw / 2 : L + (i / (labels.length - 1)) * iw);
    const y = (v) => T + ih - (Math.max(0, Math.min(v, max)) / max) * ih;

    const defs = [];
    let shapes = "";
    series.forEach((s, si) => {
      const pts = (s.values || []).map((v, i) => [x(i), y(v)]);
      const path = smooth(pts);
      const color = s.color || "#22d3ee";
      if (opts.area !== false) {
        const gid = `ag-${seq}-${si}`;
        defs.push(`<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" style="stop-opacity:var(--chart-area,.28)"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>`);
        shapes += `<path class="series-area" d="${path} L${x(labels.length - 1).toFixed(1)},${(T + ih).toFixed(1)} L${x(0).toFixed(1)},${(T + ih).toFixed(1)} Z" fill="url(#${gid})"/>`;
      }
      shapes += `<path class="series-line" d="${path}" stroke="${color}"/>`;
      shapes += pts.map((p, i) => `<circle class="series-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.1" fill="${color}" stroke="#0b1220" stroke-width="1.4"><title>${esc(labels[i])} · ${esc(s.name)} ${esc(fmtY(s.values[i]))}${esc(opts.unit || "")}</title></circle>`).join("");
    });

    const grid = axisTicks(max, 4).map((v) => `<line class="grid-line" x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}"/><text class="axis-label" x="${L - 9}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtY(v))}</text>`).join("");
    const step = Math.max(1, Math.ceil(labels.length / 7));
    const xl = labels.map((lb, i) => (i % step === 0 || i === labels.length - 1) ? `<text class="axis-label" x="${x(i).toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(lb)}</text>` : "").join("");

    const id = reg({ labels, series, unit: opts.unit || "", fmt: fmtY, geo: { L, R, T, B, W, H }, stacked: false });
    return `<div class="chart" data-chart-id="${id}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "趋势图")}">
        <defs>${defs.join("")}</defs>${grid}<line class="chart-cursor" x1="${L}" y1="${T}" x2="${L}" y2="${T + ih}"/>${shapes}${xl}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>`;
  }

  function stacked(opts) {
    const labels = opts.labels || [];
    const series = opts.series || [];
    if (!series.length || !series.some((s) => (s.values || []).length)) return empty(opts.emptyText);
    const height = opts.height || 250;
    const W = 720, H = height, L = 46, R = 14, T = 14, B = 30;
    const iw = W - L - R, ih = H - T - B;
    const totals = labels.map((_, i) => series.reduce((a, s) => a + (s.values[i] || 0), 0));
    const max = opts.yMax || Math.max(1, Math.ceil((Math.max.apply(null, totals) * 1.15) / 10) * 10);
    const fmtY = opts.yFmt || ((v) => (v >= 1000 ? Math.round(v / 1000) + "k" : Math.round(v)));
    const y = (v) => T + ih - (v / max) * ih;
    const slot = iw / Math.max(1, labels.length);
    const bw = Math.max(3, Math.min(22, slot * 0.56));
    let bars = "";
    labels.forEach((lb, i) => {
      let base = 0;
      const cx = L + slot * i + slot / 2;
      series.forEach((s) => {
        const v = s.values[i] || 0;
        const h = (v / max) * ih;
        const yy = T + ih - base - h;
        bars += `<rect x="${(cx - bw / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="${Math.min(3, bw / 3).toFixed(1)}" fill="${s.color}" opacity=".88"><title>${esc(lb)} · ${esc(s.name)} ${esc(DB.fmt(v))}${esc(opts.unit || " GPU·h")}</title></rect>`;
        base += h;
      });
    });
    const grid = axisTicks(max, 4).map((v) => `<line class="grid-line" x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}"/><text class="axis-label" x="${L - 9}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end">${esc(fmtY(v))}</text>`).join("");
    const step = Math.max(1, Math.ceil(labels.length / 8));
    const xl = labels.map((lb, i) => (i % step === 0) ? `<text class="axis-label" x="${(L + slot * i + slot / 2).toFixed(1)}" y="${H - 9}" text-anchor="middle">${esc(lb)}</text>` : "").join("");
    const id = reg({ labels, series, unit: opts.unit || " GPU·h", fmt: DB.fmt, geo: { L, R, T, B, W, H }, stacked: true });
    return `<div class="chart" data-chart-id="${id}">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opts.aria || "堆叠柱状图")}">
        ${grid}${bars}${xl}
      </svg>
      <div class="chart-tip" hidden></div>
    </div>`;
  }

  function donut(segments, opts) {
    opts = opts || {};
    if (!segments || !segments.length) return empty(opts.emptyText);
    const o = opts || {};
    const size = o.size || 154, th = o.thickness || 16;
    const r = (size - th) / 2;
    const c = 2 * Math.PI * r;
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    let offset = 0;
    const rings = segments.map((s) => {
      const len = (s.value / total) * c;
      const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${th}" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})" stroke-linecap="butt"><title>${esc(s.label)} ${esc(DB.fmt(s.value))}</title></circle>`;
      offset += len;
      return el;
    }).join("");
    const center = o.center || "";
    return `<div class="donut-center" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(148,163,184,.14)" stroke-width="${th}"/>
        ${rings}
      </svg>
      ${center ? `<div class="dc-val">${center}</div>` : ""}
    </div>`;
  }

  function spark(values, opts) {
    const o = opts || {};
    const w = o.w || 110, h = o.h || 32;
    const vals = values && values.length ? values : [0, 1, 0];
    const max = Math.max.apply(null, vals), min = Math.min.apply(null, vals);
    const span = max - min || 1;
    const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)]);
    const d = smooth(pts);
    const color = o.color || "#22d3ee";
    const gid = "sp-" + ++seq;
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${d} L${w},${h} L0,${h} Z" fill="url(#${gid})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round"/>
    </svg>`;
  }

  function gauge(value, opts) {
    const o = opts || {};
    const size = o.size || 112;
    const th = o.thickness || 9;
    const r = (size - th) / 2;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, value));
    const len = (v / 100) * c;
    const color = o.color || (v > 90 ? "#f87171" : v > 75 ? "#fbbf24" : "#22d3ee");
    return `<div class="donut-center" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(148,163,184,.15)" stroke-width="${th}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${th}" stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${(c - len).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
      </svg>
      <div class="dc-val"><b style="font-size:20px">${Math.round(v)}<span style="font-size:10px;color:var(--muted)">%</span></b><small>${esc(o.label || "")}</small></div>
    </div>`;
  }

  function ring(value, opts) {
    const o = opts || {};
    const size = o.size || 58;
    const th = o.thickness || 6;
    const r = (size - th) / 2;
    const c = 2 * Math.PI * r;
    const v = Math.max(0, Math.min(100, value));
    const color = o.color || "#22d3ee";
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="rgba(148,163,184,.16)" stroke-width="${th}"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${th}" stroke-linecap="round" stroke-dasharray="${((v / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>`;
  }

  window.Charts = { reset, line, stacked, donut, spark, gauge, ring, empty };
})();
