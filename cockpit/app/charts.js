/*
 * charts.js — SVG-chartprimitieven voor de cockpit (geen externe bibliotheek).
 * Elke chart geeft { el, table(), legend } terug; HC.ui.figure() maakt er een figuur met Grafiek/Tabel-wissel van.
 * Specs: dunne marks (≤ 24 px), 4 px afgeronde data-einden, 2 px oppervlaktegap, hairline-grid, tooltips op elk mark,
 * tekst in tekstkleuren (nooit in reekskleur), legenda bij ≥ 2 reeksen.
 */
(function () {
  'use strict';
  const H = window.HC, h = H.h, svg = H.svg, fmt = H.fmt, ui = H.ui;
  const C = window.HCharts = {};
  const FONT = '11px "IBM Plex Sans", system-ui, sans-serif';
  let canvasCtx = null;
  function measure(text, font) { if (!canvasCtx) { canvasCtx = document.createElement('canvas').getContext('2d'); } canvasCtx.font = font || FONT; return canvasCtx.measureText(String(text)).width; }
  C.measure = measure;

  // ---------- schalen ----------
  function niceStep(span, count) {
    const raw = span / Math.max(1, count); const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    const norm = raw / mag; const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
    return step * mag;
  }
  function niceTicks(min, max, count) {
    if (min === max) { max = min + 1; }
    const step = niceStep(max - min, count || 5);
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const ticks = []; for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v / step) * step);
    return { lo, hi, step, ticks };
  }
  C.niceTicks = niceTicks;
  function linear(d0, d1, r0, r1) { const f = v => r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); f.invert = p => d0 + (p - r0) / (r1 - r0 || 1) * (d1 - d0); return f; }

  // ---------- responsief hertekenen ----------
  function responsive(container, draw) {
    let last = 0;
    const render = () => { const w = Math.max(240, Math.floor(container.getBoundingClientRect().width || container.parentElement && container.parentElement.getBoundingClientRect().width || 600)); if (w === last) return; last = w; H.clear(container); container.appendChild(draw(w)); };
    if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => render()); ro.observe(container); }
    else window.addEventListener('resize', render);
    requestAnimationFrame(render);
    setTimeout(render, 0);
    return container;
  }
  function roundedBarPath(x, y, w, hgt, r, dir) { // dir: 'up' (afgerond boven), 'down', 'right', 'left'
    r = Math.min(r, Math.abs(w) / 2, Math.abs(hgt) / 2); if (hgt <= 0 || w <= 0) return '';
    if (dir === 'up') return `M${x},${y + hgt} V${y + r} a${r},${r} 0 0 1 ${r},-${r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + hgt} Z`;
    if (dir === 'down') return `M${x},${y} V${y + hgt - r} a${r},${r} 0 0 0 ${r},${r} H${x + w - r} a${r},${r} 0 0 0 ${r},-${r} V${y} Z`;
    if (dir === 'right') return `M${x},${y} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${y + hgt - r} a${r},${r} 0 0 1 -${r},${r} H${x} Z`;
    return `M${x + w},${y} H${x + r} a${r},${r} 0 0 0 -${r},${r} V${y + hgt - r} a${r},${r} 0 0 0 ${r},${r} H${x + w} Z`;
  }
  function legend(items) { // items: [{name, color, kind:'rect'|'line'|'dashed'}]
    if (!items || items.length < 2) return null;
    return h('div', { class: 'legend' }, items.map(it => h('span', { class: 'legend-item' }, h('i', { class: 'legend-swatch ' + (it.kind || 'rect'), style: { background: it.kind === 'dashed' ? 'none' : it.color, color: it.color } }), it.name)));
  }
  C.legend = legend;
  function textFits(label, width, pad) { return measure(label) + 2 * (pad == null ? 6 : pad) <= width; }
  function mark(el) { el.classList.add('mark'); return el; }
  function hoverable(el, onEnter, onMove, onLeave) {
    el.addEventListener('pointerenter', e => { el.classList.add('lift'); onEnter(e); });
    el.addEventListener('pointermove', e => onMove(e));
    el.addEventListener('pointerleave', () => { el.classList.remove('lift'); onLeave(); });
    el.setAttribute('tabindex', '0');
    el.addEventListener('focus', e => { const r = el.getBoundingClientRect(); onEnter({ clientX: r.left + r.width / 2, clientY: r.top }); });
    el.addEventListener('blur', () => onLeave());
  }

  // =====================================================================
  // Lijngrafiek
  // =====================================================================
  /**
   * C.line({ x:[keys], labels:[strings], series:[{name, values:[], color, area, dashedFrom}], yFormat, height, forecastFrom, annotations:[{i,label}], baseline, yMin, yMax, markersAt:[i], tooltipTitle(i) })
   */
  C.line = function (o) {
    const height = o.height || 240;
    const series = o.series.filter(s => s.values.some(v => v != null));
    const n = o.x.length;
    const el = h('div', { class: 'chart' });
    responsive(el, width => {
      const pad = { l: 8, r: 10, t: 14, b: 26 };
      const allVals = series.flatMap(s => s.values).filter(v => v != null && isFinite(v));
      let vmin = Math.min(o.yMin != null ? o.yMin : Infinity, ...allVals), vmax = Math.max(o.yMax != null ? o.yMax : -Infinity, ...allVals);
      if (o.baseline != null) { vmin = Math.min(vmin, o.baseline); vmax = Math.max(vmax, o.baseline); }
      const refLines = (o.referenceLines || []).filter(r => r && isFinite(r.value));
      for (const r of refLines) { vmin = Math.min(vmin, r.value); vmax = Math.max(vmax, r.value); }
      const wantEndLabels = series.length <= 3 && o.endLabels !== false;
      if (wantEndLabels) { let w = 0; for (const s of series) { let i = s.values.length - 1; while (i >= 0 && s.values[i] == null) i--; if (i >= 0) w = Math.max(w, measure((s.format || o.yFormat || fmt.eur)(s.values[i]))); } pad.r = Math.max(pad.r, w + 12); }
      if (refLines.length) pad.r = Math.max(pad.r, Math.max(...refLines.map(r => measure(r.label || ''))) + 12);
      if (vmin > 0 && o.zero !== false) vmin = 0;
      if (vmax < 0 && o.zero !== false) vmax = 0;
      const t = niceTicks(vmin, vmax, 5);
      const yFmt = o.yFormat || fmt.eur;
      const tickW = Math.max(...t.ticks.map(v => measure(yFmt(v)))) + 8;
      pad.l = Math.max(pad.l, tickW);
      const W = width, Hh = height, x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = Hh - pad.b;
      const sx = linear(0, Math.max(1, n - 1), x0, x1), sy = linear(t.lo, t.hi, y1, y0);
      const root = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': o.ariaLabel || 'Lijngrafiek' });
      if (o.forecastFrom != null && o.forecastFrom < n) {
        const fx = sx(Math.max(0, o.forecastFrom - 0.5));
        root.appendChild(svg('rect', { class: 'fc-band', x: fx, y: y0, width: x1 - fx, height: y1 - y0 }));
        root.appendChild(svg('text', { class: 'ann-text', x: x1, y: y0 - 4, 'text-anchor': 'end' }, 'forecast'));
      }
      const grid = svg('g', { class: 'grid' });
      for (const v of t.ticks) { grid.appendChild(svg('line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v) })); root.appendChild(svg('text', { x: x0 - 6, y: sy(v) + 4, 'text-anchor': 'end' }, yFmt(v))); }
      root.appendChild(grid);
      if (o.baseline != null) root.appendChild(svg('line', { class: 'baseline', x1: x0, x2: x1, y1: sy(o.baseline), y2: sy(o.baseline) }));
      // x-labels: dun uit zodat ze niet overlappen
      const labels = o.labels || o.x;
      const maxLabels = Math.max(2, Math.floor((x1 - x0) / 56));
      const every = Math.ceil(n / maxLabels);
      const labelIdx = []; for (let i = 0; i < n; i += every) labelIdx.push(i);
      if (n > 1 && labelIdx[labelIdx.length - 1] !== n - 1) { if (n - 1 - labelIdx[labelIdx.length - 1] < Math.max(1, every / 2)) labelIdx.pop(); labelIdx.push(n - 1); }
      for (const i of labelIdx) root.appendChild(svg('text', { class: 'axis-label', x: sx(i), y: Hh - 8, 'text-anchor': i === 0 ? 'start' : (i === n - 1 ? 'end' : 'middle') }, labels[i]));
      for (const r of refLines) { root.appendChild(svg('line', { x1: x0, x2: x1, y1: sy(r.value), y2: sy(r.value), stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '4 3' })); if (r.label) root.appendChild(svg('text', { class: 'dlabel', x: x1 + 4, y: sy(r.value) + 4 }, r.label)); }
      const anns = (o.annotations || []).filter(a => a.i >= 0 && a.i < n);
      anns.forEach((a, k) => { root.appendChild(svg('line', { class: 'ann-line', x1: sx(a.i), x2: sx(a.i), y1: y0 + 10, y2: y1 })); root.appendChild(svg('circle', { cx: sx(a.i), cy: y0 + 2, r: 7.5, fill: 'var(--surface)', stroke: 'var(--ink-2)', 'stroke-width': 1 })); root.appendChild(svg('text', { x: sx(a.i), y: y0 + 5.5, 'text-anchor': 'middle', style: 'font-size:9.5px;font-weight:600', fill: 'var(--ink)' }, String(a.n != null ? a.n : k + 1))); });
      // reeksen
      series.forEach((s, si) => {
        const color = s.color || H.util.seriesColor(si + 1);
        const pts = s.values.map((v, i) => v == null || !isFinite(v) ? null : [sx(i), sy(v)]);
        const seg = (from, to, dashed) => { let d = ''; let started = false; for (let i = from; i < to; i++) { const p = pts[i]; if (!p) { started = false; continue; } d += (started ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); started = true; } if (!d) return null; return svg('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': dashed ? '5 4' : null }); };
        if (s.area) { let d = ''; let started = false; let firstX = null, lastX = null; for (let i = 0; i < n; i++) { const p = pts[i]; if (!p) continue; if (firstX == null) firstX = p[0]; lastX = p[0]; d += (started ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); started = true; } if (d) { d += `L${lastX},${sy(Math.max(t.lo, Math.min(0, t.hi)))} L${firstX},${sy(Math.max(t.lo, Math.min(0, t.hi)))} Z`; root.appendChild(svg('path', { d, fill: color, opacity: 0.1 })); } }
        const split = s.dashedFrom != null ? s.dashedFrom : (o.forecastFrom != null ? o.forecastFrom : n);
        const solid = seg(0, Math.min(n, split + 1), false); if (solid) root.appendChild(solid);
        const dashed = seg(Math.max(0, split), n, true); if (dashed && split < n) root.appendChild(dashed);
        // eindpunt
        for (let i = n - 1; i >= 0; i--) { if (pts[i]) { root.appendChild(svg('circle', { cx: pts[i][0], cy: pts[i][1], r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 })); break; } }
        if (o.markersAt) for (const i of o.markersAt) if (pts[i]) root.appendChild(svg('circle', { cx: pts[i][0], cy: pts[i][1], r: 4, fill: color, stroke: 'var(--surface)', 'stroke-width': 2 }));
      });
      // eindlabels (selectief): alleen bij ≤ 3 reeksen
      if (wantEndLabels) {
        const used = refLines.map(r => sy(r.value));
        series.forEach((s, si) => { let i = n - 1; while (i >= 0 && (s.values[i] == null)) i--; if (i < 0) return; const y = sy(s.values[i]); if (used.some(u => Math.abs(u - y) < 12)) return; used.push(y); const txt = (s.format || yFmt)(s.values[i]); root.appendChild(svg('text', { class: 'dlabel', x: sx(i) + 8, y: y + 4 }, txt)); });
      }
      // crosshair + tooltip
      const hair = svg('line', { class: 'hair', x1: 0, x2: 0, y1: y0, y2: y1, visibility: 'hidden' });
      root.appendChild(hair);
      const overlay = svg('rect', { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0), fill: 'transparent' });
      const show = (e) => {
        const r = root.getBoundingClientRect(); const px = (e.clientX - r.left) * (W / r.width);
        let i = Math.round(sx.invert(px)); i = Math.max(0, Math.min(n - 1, i));
        hair.setAttribute('x1', sx(i)); hair.setAttribute('x2', sx(i)); hair.setAttribute('visibility', 'visible');
        ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: o.tooltipTitle ? o.tooltipTitle(i) : labels[i], rows: series.map((s, si) => ({ key: s.color || H.util.seriesColor(si + 1), label: s.name, value: s.values[i] == null ? '–' : (s.format || yFmt)(s.values[i]) })).concat(anns.filter(a => a.i === i).map((a, k) => ({ label: 'Gebeurtenis ' + (a.n != null ? a.n : anns.indexOf(a) + 1), value: a.label }))) }));
      };
      overlay.addEventListener('pointermove', show); overlay.addEventListener('pointerenter', show);
      overlay.addEventListener('pointerleave', () => { hair.setAttribute('visibility', 'hidden'); ui.tooltip.hide(); });
      root.appendChild(overlay);
      return root;
    });
    return {
      el,
      legend: legend(series.map((s, si) => ({ name: s.name, color: s.color || H.util.seriesColor(si + 1), kind: 'line' }))),
      table: () => ui.table({ columns: [{ key: 'label', label: o.xLabel || 'Periode' }].concat(series.map((s, si) => ({ key: 'v' + si, label: s.name, align: 'num', format: v => v == null ? '–' : (s.format || o.yFormat || fmt.eur)(v) }))), rows: o.x.map((k, i) => { const r = { label: (o.labels || o.x)[i] }; series.forEach((s, si) => { r['v' + si] = s.values[i]; }); return r; }) })
    };
  };

  // =====================================================================
  // Staafgrafiek (verticaal/horizontaal, gegroepeerd/gestapeld)
  // =====================================================================
  /**
   * C.bar({ categories:[str], series:[{name, values:[], color}], stacked, horizontal, yFormat, height, labels:'auto'|'none'|'all', markers:[{index, value, label}], forecastFrom, colorBy:(ci,si)=>color, rowHeight })
   */
  C.bar = function (o) {
    const series = o.series; const cats = o.categories; const n = cats.length; const ns = series.length;
    const el = h('div', { class: 'chart' });
    const yFmt = o.yFormat || fmt.eur;
    const stacked = !!o.stacked && ns > 1;
    const horizontal = !!o.horizontal;
    responsive(el, width => {
      const totals = cats.map((c, i) => stacked ? series.reduce((s, sr) => s + Math.max(0, sr.values[i] || 0), 0) : Math.max(...series.map(sr => sr.values[i] || 0)));
      const negTotals = cats.map((c, i) => stacked ? series.reduce((s, sr) => s + Math.min(0, sr.values[i] || 0), 0) : Math.min(0, ...series.map(sr => sr.values[i] || 0)));
      let vmax = Math.max(0, ...totals, ...(o.markers || []).map(m => m.value)); let vmin = Math.min(0, ...negTotals);
      if (o.yMax != null) vmax = Math.max(vmax, o.yMax);
      const t = niceTicks(vmin, vmax, horizontal ? 4 : 5);
      const catLabelW = horizontal ? Math.min(180, Math.max(...cats.map(c => measure(c))) + 12) : 0;
      const pad = horizontal ? { l: catLabelW + 4, r: 56, t: 6, b: 22 } : { l: Math.max(...t.ticks.map(v => measure(yFmt(v)))) + 10, r: 8, t: 14, b: 24 };
      const rowH = o.rowHeight || (ns > 1 && !stacked ? 16 * ns + 10 : 28);
      const Hh = horizontal ? pad.t + pad.b + n * rowH : (o.height || 240);
      const W = width, x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = Hh - pad.b;
      const root = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': o.ariaLabel || 'Staafgrafiek' });
      const val = horizontal ? linear(t.lo, t.hi, x0, x1) : linear(t.lo, t.hi, y1, y0);
      const band = horizontal ? linear(0, n, y0, y1) : linear(0, n, x0, x1);
      const bw = (horizontal ? (y1 - y0) : (x1 - x0)) / n; // bandbreedte
      const inner = Math.min(stacked || ns === 1 ? 24 : 14, bw * (stacked || ns === 1 ? 0.6 : 0.7 / ns));
      const gap = 2;
      const grid = svg('g', { class: 'grid' });
      const tickW = Math.max(...t.ticks.map(v => measure(yFmt(v)))) + 12; const tickEvery = horizontal ? Math.max(1, Math.ceil(t.ticks.length / Math.max(2, Math.floor((x1 - x0) / tickW)))) : 1;
      t.ticks.forEach((v, ti) => {
        if (horizontal) { grid.appendChild(svg('line', { x1: val(v), x2: val(v), y1: y0, y2: y1 })); if (ti % tickEvery === 0) root.appendChild(svg('text', { class: 'axis-label', x: val(v), y: Hh - 6, 'text-anchor': 'middle' }, yFmt(v))); }
        else { grid.appendChild(svg('line', { x1: x0, x2: x1, y1: val(v), y2: val(v) })); root.appendChild(svg('text', { x: x0 - 6, y: val(v) + 4, 'text-anchor': 'end' }, yFmt(v))); }
      });
      root.appendChild(grid);
      // basislijn
      if (horizontal) root.appendChild(svg('line', { class: 'baseline', x1: val(0), x2: val(0), y1: y0, y2: y1 })); else root.appendChild(svg('line', { class: 'baseline', x1: x0, x2: x1, y1: val(0), y2: val(0) }));
      if (o.forecastFrom != null && !horizontal && o.forecastFrom < n) { const fx = band(o.forecastFrom); root.appendChild(svg('rect', { class: 'fc-band', x: fx, y: y0, width: x1 - fx, height: y1 - y0 })); root.appendChild(svg('text', { class: 'ann-text', x: fx + 4, y: y0 - 3 }, 'forecast')); }
      // categorie-labels
      const maxLabels = horizontal ? n : Math.max(1, Math.floor((x1 - x0) / 44)); const every = Math.ceil(n / maxLabels);
      for (let i = 0; i < n; i++) {
        if (horizontal) root.appendChild(svg('text', { class: 'axis-label', x: x0 - 6, y: band(i + 0.5) + 4, 'text-anchor': 'end' }, cats[i]));
        else if (i % every === 0) root.appendChild(svg('text', { class: 'axis-label', x: band(i + 0.5), y: Hh - 8, 'text-anchor': 'middle' }, o.labelsShort ? o.labelsShort[i] : cats[i]));
      }
      // marks
      for (let i = 0; i < n; i++) {
        let posAcc = 0, negAcc = 0;
        for (let si = 0; si < ns; si++) {
          const v = series[si].values[i]; if (v == null || !isFinite(v)) continue;
          const color = o.colorBy ? o.colorBy(i, si, v) : (series[si].color || H.util.seriesColor(si + 1));
          let a, b; // waarde-interval
          if (stacked) { if (v >= 0) { a = posAcc; b = posAcc + v; posAcc = b; } else { a = negAcc + v; b = negAcc; negAcc = a; } } else { a = Math.min(0, v); b = Math.max(0, v); }
          const center = band(i + 0.5) + (stacked || ns === 1 ? 0 : (si - (ns - 1) / 2) * (inner + 3));
          let p;
          if (horizontal) {
            const xA = val(a), xB = val(b); const gL = (stacked && a !== 0) ? gap : 0, gR = (stacked && b !== posAcc && v >= 0) ? 0 : 0;
            const w = Math.max(0, xB - xA - gL - gR); const isEnd = !stacked || (v >= 0 ? b === posAcc : a === negAcc);
            p = svg('path', { d: w > 0 ? roundedBarPath(xA + gL, center - inner / 2, w, inner, isEnd ? 4 : 0, v >= 0 ? 'right' : 'left') : '', fill: color });
          } else {
            const yA = val(b), yB = val(a); const gT = (stacked && v < 0 && b !== 0) ? gap : 0, gB = (stacked && v >= 0 && a !== 0) ? gap : 0;
            const hh = Math.max(0, yB - yA - gT - gB); const isEnd = !stacked || (v >= 0 ? b === posAcc : a === negAcc);
            p = svg('path', { d: hh > 0 ? roundedBarPath(center - inner / 2, yA + gT, inner, hh, isEnd ? 4 : 0, v >= 0 ? 'up' : 'down') : '', fill: color });
          }
          mark(p);
          const idx = i, sidx = si;
          hoverable(p, e => tip(e, idx, sidx), e => tip(e, idx, sidx), () => ui.tooltip.hide());
          root.appendChild(p);
        }
        // directe labels: horizontaal altijd aan het einde; verticaal alleen bij weinig categorieën
        const total = stacked ? posAcc : Math.max(...series.map(s => s.values[i] || 0));
        const labelMode = o.labels || 'auto';
        if (labelMode !== 'none' && (labelMode === 'all' || horizontal || n <= 8)) {
          const txt = yFmt(stacked ? total : (ns === 1 ? series[0].values[i] : total));
          if (horizontal) root.appendChild(svg('text', { class: 'dlabel', x: val(Math.max(0, total)) + 6, y: band(i + 0.5) + 4 }, txt));
          else if (ns === 1 || stacked) { const v = stacked ? total : series[0].values[i]; if (v != null) root.appendChild(svg('text', { class: 'dlabel', x: band(i + 0.5), y: val(Math.max(0, v)) - 5, 'text-anchor': 'middle' }, txt)); }
        }
      }
      if (o.markers) for (const m of o.markers) {
        if (horizontal) { const x = val(m.value), y = band(m.index + 0.5); root.appendChild(svg('line', { x1: x, x2: x, y1: y - inner / 2 - 3, y2: y + inner / 2 + 3, stroke: 'var(--ink)', 'stroke-width': 2 })); }
        else { const y = val(m.value), x = band(m.index + 0.5); root.appendChild(svg('line', { x1: x - inner / 2 - 4, x2: x + inner / 2 + 4, y1: y, y2: y, stroke: 'var(--ink)', 'stroke-width': 2 })); }
      }
      function tip(e, i, si) { ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: (o.tooltipTitle ? o.tooltipTitle(i) : cats[i]), rows: series.map((s, k) => ({ key: s.color || H.util.seriesColor(k + 1), label: s.name, value: s.values[i] == null ? '–' : (s.format || yFmt)(s.values[i]) })).concat(o.markers ? o.markers.filter(m => m.index === i).map(m => ({ label: m.label, value: yFmt(m.value) })) : []) })); }
      return root;
    });
    return {
      el,
      legend: legend(series.map((s, si) => ({ name: s.name, color: s.color || H.util.seriesColor(si + 1), kind: 'rect' })).concat(o.markers && o.markers.length ? [{ name: o.markers[0].label, color: 'var(--ink)', kind: 'line' }] : [])),
      table: () => ui.table({ columns: [{ key: 'label', label: o.xLabel || 'Categorie' }].concat(series.map((s, si) => ({ key: 'v' + si, label: s.name, align: 'num', format: v => v == null ? '–' : (s.format || yFmt)(v) }))).concat(o.markers ? [{ key: 'm', label: o.markers[0].label, align: 'num', format: v => v == null ? '–' : yFmt(v) }] : []), rows: cats.map((c, i) => { const r = { label: c }; series.forEach((s, si) => { r['v' + si] = s.values[i]; }); if (o.markers) { const m = o.markers.find(x => x.index === i); r.m = m ? m.value : null; } return r; }) })
    };
  };

  // =====================================================================
  // Waterval (brug)
  // =====================================================================
  /** C.waterfall({ steps:[{label, value, type:'total'|'delta', color?}], yFormat, height, polarity:'neutral'|'status' }) */
  C.waterfall = function (o) {
    const steps = o.steps; const n = steps.length; const yFmt = o.yFormat || fmt.eur;
    const el = h('div', { class: 'chart' });
    // cumulatief
    const runs = []; let acc = 0;
    for (const s of steps) { if (s.type === 'total') { runs.push({ a: 0, b: s.value }); acc = s.value; } else { runs.push({ a: acc, b: acc + s.value }); acc += s.value; } }
    responsive(el, width => {
      const vals = runs.flatMap(r => [r.a, r.b]); const t = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 5);
      const pad = { l: Math.max(...t.ticks.map(v => measure(yFmt(v)))) + 10, r: 8, t: 14, b: 40 };
      const W = width, Hh = o.height || 260, x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = Hh - pad.b;
      const sy = linear(t.lo, t.hi, y1, y0), band = linear(0, n, x0, x1); const bw = (x1 - x0) / n; const inner = Math.min(28, bw * 0.62);
      const root = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': o.ariaLabel || 'Watervalgrafiek' });
      const grid = svg('g', { class: 'grid' }); for (const v of t.ticks) { grid.appendChild(svg('line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v) })); root.appendChild(svg('text', { x: x0 - 6, y: sy(v) + 4, 'text-anchor': 'end' }, yFmt(v))); } root.appendChild(grid);
      root.appendChild(svg('line', { class: 'baseline', x1: x0, x2: x1, y1: sy(0), y2: sy(0) }));
      steps.forEach((s, i) => {
        const r = runs[i]; const cx = band(i + 0.5); const top = sy(Math.max(r.a, r.b)), bot = sy(Math.min(r.a, r.b));
        const color = s.color || (s.type === 'total' ? 'var(--ink-2)' : (o.polarity === 'status' ? (s.value >= 0 ? 'var(--good)' : 'var(--critical)') : (s.value >= 0 ? 'var(--series-1)' : 'var(--series-dim)')));
        const p = svg('path', { d: roundedBarPath(cx - inner / 2, top, inner, Math.max(1, bot - top), 4, s.type === 'total' || s.value >= 0 ? 'up' : 'down'), fill: color });
        mark(p); hoverable(p, e => tip(e, i), e => tip(e, i), () => ui.tooltip.hide()); root.appendChild(p);
        if (i < n - 1) root.appendChild(svg('line', { x1: cx + inner / 2, x2: band(i + 1.5) - inner / 2, y1: sy(r.b), y2: sy(r.b), stroke: 'var(--line-2)', 'stroke-width': 1 }));
        const lbl = (s.type === 'total' ? yFmt(s.value) : fmt.signed(s.value, yFmt));
        const showLbl = o.labels === 'none' ? false : (o.labels === 'auto' ? measure(lbl) + 4 <= bw : true);
        if (showLbl) root.appendChild(svg('text', { class: 'dlabel' + (s.type === 'total' ? ' strong' : ''), x: cx, y: top - 5, 'text-anchor': 'middle' }, lbl));
        // categorielabel, zo nodig over twee regels
        const words = s.label.split(' '); const lines = []; let cur = '';
        for (const w of words) { if (measure(cur + ' ' + w) > bw - 4 && cur) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; } lines.push(cur);
        lines.slice(0, 2).forEach((ln, k) => root.appendChild(svg('text', { class: 'axis-label', x: cx, y: y1 + 13 + k * 12, 'text-anchor': 'middle' }, ln)));
      });
      function tip(e, i) { const s = steps[i]; ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: s.label, rows: [{ label: s.type === 'total' ? 'Totaal' : 'Mutatie', value: s.type === 'total' ? yFmt(s.value) : fmt.signed(s.value, yFmt) }].concat(s.type === 'total' ? [] : [{ label: 'Stand na', value: yFmt(runs[i].b) }]) })); }
      return root;
    });
    return { el, legend: null, table: () => ui.table({ columns: [{ key: 'label', label: 'Stap' }, { key: 'value', label: 'Bedrag', align: 'num', format: (v, r) => r.type === 'total' ? yFmt(v) : fmt.signed(v, yFmt) }, { key: 'cum', label: 'Stand', align: 'num', format: yFmt }], rows: steps.map((s, i) => Object.assign({ cum: runs[i].b }, s)) }) };
  };

  // =====================================================================
  // Histogram (Monte Carlo)
  // =====================================================================
  /** C.histogram({ bins:[{x0,x1,count,share}], xFormat, markers:[{x,label,color}], height, color }) */
  C.histogram = function (o) {
    const bins = o.bins; const n = bins.length; const xFmt = o.xFormat || fmt.eur;
    const el = h('div', { class: 'chart' });
    responsive(el, width => {
      const maxShare = Math.max(...bins.map(b => b.share)); const t = niceTicks(0, maxShare, 4);
      const pad = { l: Math.max(...t.ticks.map(v => measure(fmt.pct(v, 0)))) + 10, r: 8, t: 34, b: 26 };
      const W = width, Hh = o.height || 220, x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = Hh - pad.b;
      const lo = bins[0].x0, hi = bins[n - 1].x1; const sx = linear(lo, hi, x0, x1), sy = linear(0, t.hi, y1, y0);
      const root = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': o.ariaLabel || 'Histogram' });
      const grid = svg('g', { class: 'grid' }); for (const v of t.ticks) { grid.appendChild(svg('line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v) })); root.appendChild(svg('text', { x: x0 - 6, y: sy(v) + 4, 'text-anchor': 'end' }, fmt.pct(v, 0))); } root.appendChild(grid);
      root.appendChild(svg('line', { class: 'baseline', x1: x0, x2: x1, y1: sy(0), y2: sy(0) }));
      const xt = niceTicks(lo, hi, 6); for (const v of xt.ticks) if (v >= lo && v <= hi) root.appendChild(svg('text', { class: 'axis-label', x: sx(v), y: Hh - 8, 'text-anchor': 'middle' }, xFmt(v)));
      bins.forEach((b, i) => {
        const xa = sx(b.x0) + 1, xb = sx(b.x1) - 1; const top = sy(b.share);
        const color = o.colorBin ? o.colorBin(b, i) : (o.color || 'var(--series-1)');
        const p = svg('path', { d: roundedBarPath(xa, top, Math.max(1, xb - xa), Math.max(0, y1 - top), 2, 'up'), fill: color }); mark(p);
        hoverable(p, e => tip(e, i), e => tip(e, i), () => ui.tooltip.hide()); root.appendChild(p);
      });
      if (o.markers) {
        const ms = o.markers.filter(m => m.x >= lo && m.x <= hi).map(m => Object.assign({}, m, { px: sx(m.x), w: measure(m.label || '') })).sort((a, b) => a.px - b.px);
        const rows = [-Infinity, -Infinity];
        for (const m of ms) {
          root.appendChild(svg('line', { x1: m.px, x2: m.px, y1: y0 - 2, y2: y1, stroke: m.color || 'var(--ink)', 'stroke-width': m.strong ? 2 : 1, 'stroke-dasharray': m.dashed ? '4 3' : null }));
          if (!m.label) continue;
          let anchor = m.anchor || 'start'; let start = anchor === 'end' ? m.px - 3 - m.w : m.px + 3;
          if (start + m.w > x1) { anchor = 'end'; start = m.px - 3 - m.w; }
          let row = 0; if (start < rows[0] + 6) { row = 1; if (start < rows[1] + 6) { row = 0; } }
          rows[row] = start + m.w;
          root.appendChild(svg('text', { class: 'ann-text', x: anchor === 'end' ? m.px - 3 : m.px + 3, y: y0 - 6 - row * 11, 'text-anchor': anchor, fill: 'var(--ink-2)' }, m.label));
        }
      }
      function tip(e, i) { const b = bins[i]; ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: xFmt(b.x0) + ' – ' + xFmt(b.x1), rows: [{ label: 'Aandeel', value: fmt.pct(b.share, 1) }, { label: 'Simulaties', value: fmt.int(b.count) }] })); }
      return root;
    });
    return { el, legend: null, table: () => ui.table({ columns: [{ key: 'x0', label: 'Van', align: 'num', format: xFmt }, { key: 'x1', label: 'Tot', align: 'num', format: xFmt }, { key: 'count', label: 'Simulaties', align: 'num', format: fmt.int }, { key: 'share', label: 'Aandeel', align: 'num', format: v => fmt.pct(v, 1) }], rows: bins }) };
  };

  // =====================================================================
  // Tornado (gevoeligheid)
  // =====================================================================
  /** C.tornado({ items:[{label, low, high, base}], xFormat, height }) — low/high = resultaat bij lage/hoge driverwaarde */
  C.tornado = function (o) {
    const base0 = o.base != null ? o.base : 0;
    const items = o.skipZero === false ? o.items : o.items.filter(it => Math.abs(it.low - base0) > 1e-9 || Math.abs(it.high - base0) > 1e-9); const n = items.length; const xFmt = o.xFormat || fmt.eur;
    const el = h('div', { class: 'chart' });
    responsive(el, width => {
      const base = o.base != null ? o.base : 0;
      const vals = items.flatMap(it => [it.low - base, it.high - base]); const ext = Math.max(1, ...vals.map(Math.abs));
      const t = niceTicks(-ext, ext, 4);
      const labelW = Math.min(200, Math.max(...items.map(it => measure(it.label))) + 10);
      const pad = { l: labelW + 6, r: 10, t: 8, b: 24 }; const rowH = 26;
      const W = width, Hh = pad.t + pad.b + n * rowH, x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = Hh - pad.b;
      const sx = linear(t.lo, t.hi, x0, x1), band = linear(0, n, y0, y1);
      const root = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': 'Tornadodiagram' });
      const grid = svg('g', { class: 'grid' }); const tw = Math.max(...t.ticks.map(v => measure(fmt.signed(v, xFmt)))) + 12; const tEvery = Math.max(1, Math.ceil(t.ticks.length / Math.max(2, Math.floor((x1 - x0) / tw))));
      t.ticks.forEach((v, ti) => { grid.appendChild(svg('line', { x1: sx(v), x2: sx(v), y1: y0, y2: y1 })); if (ti % tEvery === 0) root.appendChild(svg('text', { class: 'axis-label', x: sx(v), y: Hh - 6, 'text-anchor': 'middle' }, Math.abs(v) < 1e-9 ? xFmt(0) : fmt.signed(v, xFmt))); }); root.appendChild(grid);
      root.appendChild(svg('line', { class: 'baseline', x1: sx(0), x2: sx(0), y1: y0, y2: y1 }));
      items.forEach((it, i) => {
        const cy = band(i + 0.5); root.appendChild(svg('text', { class: 'axis-label', x: x0 - 6, y: cy + 4, 'text-anchor': 'end' }, it.label));
        for (const [v, color, lbl] of [[it.low - base, 'var(--series-dim)', o.lowLabel || 'laag'], [it.high - base, 'var(--series-1)', o.highLabel || 'hoog']]) {
          const xa = Math.min(sx(0), sx(v)), xb = Math.max(sx(0), sx(v)); if (xb - xa < 0.5) continue;
          const p = svg('path', { d: roundedBarPath(xa, cy - 8, xb - xa, 16, 4, v >= 0 ? 'right' : 'left'), fill: color }); mark(p);
          hoverable(p, e => ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: it.label, rows: [{ label: lbl + (it.lowText && lbl === (o.lowLabel || 'laag') ? ' (' + it.lowText + ')' : it.highText && lbl === (o.highLabel || 'hoog') ? ' (' + it.highText + ')' : ''), value: fmt.signed(v, xFmt) }] })), () => { }, () => ui.tooltip.hide());
          root.appendChild(p);
        }
      });
      return root;
    });
    return { el, legend: legend([{ name: o.lowLabel || 'Lage waarde', color: 'var(--series-dim)' }, { name: o.highLabel || 'Hoge waarde', color: 'var(--series-1)' }]), table: () => ui.table({ columns: [{ key: 'label', label: 'Driver' }, { key: 'low', label: o.lowLabel || 'Laag', align: 'num', format: xFmt }, { key: 'high', label: o.highLabel || 'Hoog', align: 'num', format: xFmt }], rows: items }) };
  };

  // =====================================================================
  // Sparkline, meter, heat-tabel
  // =====================================================================
  C.sparkline = function (values, o) {
    o = o || {}; const W = o.width || 120, Hh = o.height || 28; const n = values.length;
    const vmin = Math.min(...values), vmax = Math.max(...values); const sx = linear(0, n - 1, 1, W - 1), sy = linear(vmin, vmax === vmin ? vmin + 1 : vmax, Hh - 3, 3);
    const root = svg('svg', { class: 'spark', viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, 'aria-hidden': 'true' });
    const split = o.forecastFrom != null ? o.forecastFrom : n;
    let d = '', d2 = '';
    values.forEach((v, i) => { const s = (i === 0 ? 'M' : 'L') + sx(i).toFixed(1) + ',' + sy(v).toFixed(1); if (i <= split) d += s; if (i >= split) d2 += (i === split ? 'M' : 'L') + sx(i).toFixed(1) + ',' + sy(v).toFixed(1); });
    root.appendChild(svg('path', { d, fill: 'none', stroke: o.color || 'var(--series-dim)', 'stroke-width': 1.5 }));
    if (split < n - 1) root.appendChild(svg('path', { d: d2, fill: 'none', stroke: o.color || 'var(--series-dim)', 'stroke-width': 1.5, 'stroke-dasharray': '3 2' }));
    root.appendChild(svg('circle', { cx: sx(n - 1), cy: sy(values[n - 1]), r: 2.5, fill: 'var(--accent)' }));
    return root;
  };
  /** meter: value/max met status-kleur via tone */
  C.meter = function (value, max, tone) { const pct = Math.max(0, Math.min(1, max > 0 ? value / max : 0)); return h('div', { class: 'meter ' + (tone || ''), role: 'meter', 'aria-valuenow': value, 'aria-valuemax': max }, h('i', { style: { width: (pct * 100).toFixed(1) + '%' } })); };
  /** heat-tabel: rows × cols, één groene ramp op magnitude */
  C.heatTable = function (o) {
    const vals = o.values.flat().filter(v => isFinite(v)); const lo = Math.min(...vals), hi = Math.max(...vals);
    const ramp = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];
    const table = h('table', { class: 'data heat' });
    if (o.caption) table.appendChild(h('caption', null, o.caption));
    table.appendChild(h('thead', null, h('tr', null, h('th', null, o.corner || ''), o.cols.map(c => h('th', { class: 'num' }, c)))));
    const tb = h('tbody');
    o.values.forEach((row, ri) => tb.appendChild(h('tr', null, h('th', { scope: 'row' }, o.rows[ri]), row.map((v, ci) => { const k = hi > lo ? Math.min(4, Math.floor((v - lo) / (hi - lo) * 5)) : 2; const isBase = o.base && o.base[0] === ri && o.base[1] === ci; return h('td', { class: 'cell', style: { background: ramp[k], color: k >= 3 ? 'var(--surface)' : 'var(--ink)', fontWeight: isBase ? 700 : 400, outline: isBase ? '2px solid var(--ink)' : 'none', outlineOffset: '-2px' } }, o.format(v)); }))));
    table.appendChild(tb);
    return h('div', { class: 'table-wrap' }, table);
  };
})();
