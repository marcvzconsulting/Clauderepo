/* Tab: Risico — Monte Carlo-simulatie van de forecast. De zeven onzekere drivers worden onafhankelijk getrokken rond het actieve
 * scenario; het rekenwerk draait in een Web Worker (cockpit/app/mc-worker.js) met voortgangsbalk, en valt terug op de hoofdthread
 * als er geen worker gemaakt kan worden. Resultaten worden gecachet op aannames + instellingen, zodat filterwissels niets herrekenen. */
(function () {
  'use strict';
  const H = window.HC;
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || '';
  const WORKER_URL = SCRIPT_URL ? SCRIPT_URL.replace(/tabs\/risico\.js(\?.*)?$/, 'mc-worker.js') : 'app/mc-worker.js';
  const DEFAULT_SEED = 20261006;
  const CHUNKS = 10;

  // onzekerheid per driver: sleutel in aannames, sleutel in E.defaultUncertainty(), slidergrenzen en eenheid van de standaardafwijking.
  // Labels komen uit H.util.assumptionMeta, zodat paneel en tornado dezelfde namen gebruiken als het scenario-tabblad.
  const DRIVERS = [
    { key: 'volumeGrowth', sd: 'volumeGrowthSd', min: 0, max: 0.15, step: 0.005, unit: 'pp' },
    { key: 'priceIndex', sd: 'priceIndexSd', min: 0, max: 0.05, step: 0.0025, unit: 'pp' },
    { key: 'materialIndex', sd: 'materialIndexSd', min: 0, max: 0.10, step: 0.005, unit: 'pp' },
    { key: 'wageIndex', sd: 'wageIndexSd', min: 0, max: 0.04, step: 0.0025, unit: 'pp' },
    { key: 'marketingPct', sd: 'marketingSd', min: 0, max: 0.02, step: 0.001, unit: 'pp' },
    { key: 'dso', sd: 'dsoSd', min: 0, max: 20, step: 1, unit: 'days' },
    { key: 'dio', sd: 'dioSd', min: 0, max: 30, step: 1, unit: 'days' }
  ];
  // dezelfde ondergrenzen als het engine hanteert bij het trekken
  const FLOORS = { marketingPct: 0.01, dso: 20, dio: 30 };
  // doelgrootheden van de tornado (liquiditeit = kas minus RCF-opname: de kaspositie zonder kredietfaciliteit, dus niet gevloerd op de minimumkas)
  const TARGETS = {
    ebitda: { seg: 'EBITDA', name: ty => 'EBITDA ' + ty },
    ni: { seg: 'Nettowinst', name: ty => 'nettowinst ' + ty },
    liq: { seg: 'Liquiditeit', name: () => 'de laagste liquiditeit (kas minus RCF)' }
  };

  // ---------- module-niveau: instellingen, cache en worker (blijven staan bij tabwissel) ----------
  const E0 = window.HelderEngine;
  const settings = { n: 5000, targetYear: 2027, seed: DEFAULT_SEED, unc: E0.defaultUncertainty(), tornadoTarget: 'ebitda' };
  const cache = new Map();
  const mc = { settings, cache, worker: null, workerOk: typeof Worker === 'function', forceMainThread: false, busy: null, seq: 0, lastInfo: null };
  H.risico = mc; // test-/debughaak

  // --- identiek aan mc-worker.js (voor de terugval op de hoofdthread) ---
  const KEYS = ['ebitda', 'revenue', 'minCash', 'maxLeverage', 'minIcr', 'netIncome', 'fcf'];
  function chunkSeed(seed, k) { const s = seed >>> 0; if (k === 0) return s; let x = (s ^ Math.imul(k, 0x9E3779B9)) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35) >>> 0; return (x ^ (x >>> 16)) >>> 0; }
  function chunkSizes(n, chunks) { const c = Math.max(1, Math.min(chunks || 10, n)); const out = []; for (let k = 0; k < c; k++) { const size = Math.floor(n * (k + 1) / c) - Math.floor(n * k / c); if (size > 0) out.push(size); } return out; }
  function chunkPlan(n, seed, opts) { const base = (seed == null ? DEFAULT_SEED : seed) >>> 0; const targetYear = (opts && opts.targetYear) || 2027; return chunkSizes(n, opts && opts.chunks).map((size, k) => ({ k, size, seed: chunkSeed(base, k), baseSeed: base, targetYear })); }
  function merge(parts, seed, targetYear) {
    const n = parts.reduce((s, p) => s + p.n, 0);
    const out = { n, seed, targetYear, breach: 0, cashBreach: 0, draws: new Array(n) };
    for (const k of KEYS) { const arr = new Float64Array(n); let off = 0; for (const p of parts) { arr.set(p[k], off); off += p.n; } out[k] = arr; }
    let i = 0; for (const p of parts) { out.breach += p.breach; out.cashBreach += p.cashBreach; for (let j = 0; j < p.n; j++) out.draws[i++] = p.draws[j]; }
    return out;
  }

  let datasetCopy = null;
  function jsonSafeDataset() { if (!datasetCopy) { datasetCopy = Object.assign({}, H.model.dataset); delete datasetCopy._actRun; } return datasetCopy; }
  function keyOf(req) { return JSON.stringify([req.assumptions, req.unc, req.n, req.seed, req.opts.targetYear]); }
  function cancelled() { const e = new Error('geannuleerd'); e.cancelled = true; return e; }

  function runInWorker(id, req, onProgress) {
    return new Promise((resolve, reject) => {
      let w = mc.worker;
      if (!w) { w = new Worker(WORKER_URL); mc.worker = w; }
      let settled = false;
      const finish = (fn, v) => { if (settled) return; settled = true; if (mc.busy && mc.busy.id === id) mc.busy = null; fn(v); };
      mc.busy = { id, cancel() { try { w.terminate(); } catch (e) { /* al gestopt */ } mc.worker = null; finish(reject, cancelled()); } };
      const parts = [];
      w.onmessage = ev => {
        const m = ev.data || {}; if (m.id !== id) return;
        if (m.type === 'part') { parts.push(m.part); onProgress(m.done, m.n, parts); }
        else if (m.type === 'done') { const res = merge(parts, req.seed >>> 0, req.opts.targetYear); res._workerMs = m.ms; finish(resolve, res); }
        else if (m.type === 'error') finish(reject, new Error(m.message));
      };
      w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); try { w.terminate(); } catch (e) { /* al gestopt */ } mc.worker = null; finish(reject, new Error((ev && ev.message) || 'worker kon niet geladen worden')); };
      w.postMessage({ id, dataset: jsonSafeDataset(), assumptions: req.assumptions, unc: req.unc, n: req.n, seed: req.seed, opts: req.opts });
    });
  }
  function runOnMain(id, req, onProgress) {
    const E = H.model.E;
    return new Promise((resolve, reject) => {
      const plan = chunkPlan(req.n, req.seed, req.opts); const parts = []; let k = 0, done = 0, stop = false;
      mc.busy = { id, cancel() { stop = true; if (mc.busy && mc.busy.id === id) mc.busy = null; reject(cancelled()); } };
      const step = () => {
        if (stop) return;
        try {
          const c = plan[k]; parts.push(E.monteCarlo(jsonSafeDataset(), req.assumptions, req.unc, c.size, c.seed, { targetYear: c.targetYear }));
          done += c.size; k++; onProgress(done, req.n, parts);
          if (k < plan.length) setTimeout(step, 0);
          else { if (mc.busy && mc.busy.id === id) mc.busy = null; resolve(merge(parts, plan[0].baseSeed, plan[0].targetYear)); }
        } catch (e) { if (mc.busy && mc.busy.id === id) mc.busy = null; reject(e); }
      };
      setTimeout(step, 0);
    });
  }
  /** simulate(req, onProgress) → Promise<{results, ms, cached, via}>; cache op aannames + instellingen */
  function simulate(req, onProgress) {
    const key = keyOf(req);
    if (cache.has(key)) { const r = cache.get(key); return Promise.resolve({ results: r, ms: r._ms, cached: true, via: r._via }); }
    if (mc.busy) mc.busy.cancel();
    const id = ++mc.seq; const t0 = performance.now();
    const useWorker = mc.workerOk && !mc.forceMainThread;
    let via = useWorker ? 'worker' : 'main';
    const p = useWorker
      ? runInWorker(id, req, onProgress).catch(e => { if (e && e.cancelled) throw e; console.warn('Monte Carlo: Web Worker niet beschikbaar, terugval op hoofdthread (' + e.message + ')'); mc.workerOk = false; via = 'main'; return runOnMain(id, req, onProgress); })
      : runOnMain(id, req, onProgress);
    return p.then(results => {
      results._ms = performance.now() - t0; results._via = via;
      if (cache.size >= 8) cache.delete(cache.keys().next().value);
      cache.set(key, results);
      return { results, ms: results._ms, cached: false, via };
    });
  }
  function nextSeed(s) { return (Math.imul(s >>> 0, 1664525) + 1013904223) >>> 0; }
  /** aantal elementen ≤ x in een gesorteerde reeks */
  function upperBound(sorted, x) { let lo = 0, hi = sorted.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= x) lo = mid + 1; else hi = mid; } return lo; }

  // ---------- lokale helpers ----------
  /** drivernaam zoals in het scenario-paneel, zonder 'per jaar' / 'per eenheid' */
  function driverLabel(key) { return H.util.assumptionMeta[key].label.replace(/,? per jaar$/, '').replace(/ per eenheid$/, ''); }
  /** eerste letter klein, behalve bij afkortingen (DSO, FTE) */
  function lcFirst(s) { return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  /** histogram waarbij `edge` (een limiet) precies op een klassegrens valt, zodat klassen aan weerszijden zuiver gekleurd kunnen worden */
  function alignedBins(E, sorted, bins, lo, hi, edge) {
    if (!(hi > lo)) hi = lo + 1;
    if (edge < lo - (hi - lo) || edge > hi + (hi - lo)) return E.histogram(sorted, bins, lo, hi); // limiet ver buiten beeld: gewone klassen
    const w = (hi - lo) / bins;
    const below = Math.max(0, Math.ceil((edge - lo) / w - 1e-9)), above = Math.max(0, Math.ceil((hi - edge) / w - 1e-9));
    if (!(below + above)) return E.histogram(sorted, bins, lo, hi);
    return E.histogram(sorted, below + above, edge - below * w, edge + above * w);
  }
  function linear(d0, d1, r0, r1) { const f = v => r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); f.invert = p => d0 + (p - r0) / (r1 - r0 || 1) * (d1 - d0); return f; }
  /** responsief hertekenen (zoals charts.js intern doet) */
  function respond(container, draw) {
    let last = 0;
    const render = () => { const w = Math.max(240, Math.floor(container.getBoundingClientRect().width || (container.parentElement && container.parentElement.getBoundingClientRect().width) || 600)); if (w === last) return; last = w; H.clear(container); container.appendChild(draw(w)); };
    if ('ResizeObserver' in window) new ResizeObserver(render).observe(container); else window.addEventListener('resize', render);
    requestAnimationFrame(render); setTimeout(render, 0);
    return container;
  }
  /**
   * Cumulatieve kansverdeling op een continue x-as met nette tickwaarden. charts.line kent alleen een categorie-as, waardoor de laatste
   * x-waarde niet altijd een label kreeg en labels bij smalle breedtes botsten; hier past het aantal ticks zich aan de gemeten tekstbreedte aan.
   * { sorted, scenario, quantity, xFormat, tickFormat, height, ariaLabel }
   */
  function cdfChart(o) {
    const h = H.h, svg = H.svg, fmt = H.fmt, ui = H.ui, C = window.HCharts;
    const sorted = o.sorted, n = sorted.length; const min = sorted[0], max = sorted[n - 1];
    const F = x => upperBound(sorted, x) / n;
    const xFmt = o.xFormat || fmt.eur, tickFmt = o.tickFormat || xFmt;
    const el = h('div', { class: 'chart' });
    respond(el, width => {
      const Hh = o.height || 214; const yTicks = [0, 0.25, 0.5, 0.75, 1];
      const pad = { l: Math.max(...yTicks.map(v => C.measure(fmt.pct(v, 0)))) + 10, r: 12, t: 16, b: 26 };
      const x0 = pad.l, x1 = width - pad.r, y0 = pad.t, y1 = Hh - pad.b;
      // fijn raster bepaalt het domein; gelabeld wordt elke k-de tick, geteld vanaf het einde zodat de laatste altijd een label heeft
      const t = C.niceTicks(min, max, 8);
      const labelW = Math.max(...t.ticks.map(v => C.measure(tickFmt(v)))) + 14;
      const k = Math.ceil(t.ticks.length / Math.max(2, Math.floor((x1 - x0) / labelW)));
      const sx = linear(t.lo, t.hi, x0, x1), sy = linear(0, 1, y1, y0);
      const root = svg('svg', { viewBox: `0 0 ${width} ${Hh}`, width, height: Hh, role: 'img', 'aria-label': o.ariaLabel || 'Cumulatieve kansverdeling' });
      const grid = svg('g', { class: 'grid' });
      for (const v of yTicks) { grid.appendChild(svg('line', { x1: x0, x2: x1, y1: sy(v), y2: sy(v) })); root.appendChild(svg('text', { x: x0 - 6, y: sy(v) + 4, 'text-anchor': 'end' }, fmt.pct(v, 0))); }
      root.appendChild(grid);
      root.appendChild(svg('line', { class: 'baseline', x1: x0, x2: x1, y1: sy(0), y2: sy(0) }));
      const last = t.ticks.length - 1;
      t.ticks.forEach((v, i) => { if ((last - i) % k) return; const w = C.measure(tickFmt(v)); const px = sx(v); const anchor = px - w / 2 < x0 ? 'start' : px + w / 2 > x1 ? 'end' : 'middle'; root.appendChild(svg('text', { class: 'axis-label', x: px, y: Hh - 8, 'text-anchor': anchor }, tickFmt(v))); });
      // curve: bemonsterd op 160 punten (de echte verdeling is een trapfunctie); vlak op 0% vóór het minimum en op 100% na het maximum
      const K = 160; let d = '';
      for (let i = 0; i <= K; i++) { const x = t.lo + (t.hi - t.lo) * i / K; d += (i ? 'L' : 'M') + sx(x).toFixed(1) + ',' + sy(F(x)).toFixed(1); }
      root.appendChild(svg('path', { d: d + `L${x1},${sy(0)} L${x0},${sy(0)} Z`, fill: 'var(--series-1)', opacity: 0.1 }));
      root.appendChild(svg('path', { d, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round' }));
      if (o.scenario != null && o.scenario >= t.lo && o.scenario <= t.hi) {
        const px = sx(o.scenario), p = F(o.scenario), py = sy(p);
        root.appendChild(svg('line', { x1: px, x2: px, y1: y1, y2: py, stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
        root.appendChild(svg('line', { x1: x0, x2: px, y1: py, y2: py, stroke: 'var(--ink-2)', 'stroke-width': 1, 'stroke-dasharray': '4 3' }));
        root.appendChild(svg('circle', { cx: px, cy: py, r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2 }));
        const right = px < x0 + (x1 - x0) * 0.6;
        root.appendChild(svg('text', { class: 'ann-text', x: px + (right ? 7 : -7), y: py + 4, 'text-anchor': right ? 'start' : 'end', fill: 'var(--ink-2)' }, 'scenario · ' + fmt.pct(p, 0)));
      }
      const hair = svg('line', { class: 'hair', x1: 0, x2: 0, y1: y0, y2: y1, visibility: 'hidden' }); root.appendChild(hair);
      const overlay = svg('rect', { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0), fill: 'transparent' });
      const show = e => {
        const r = root.getBoundingClientRect(); const x = Math.max(t.lo, Math.min(t.hi, sx.invert((e.clientX - r.left) * (width / r.width))));
        hair.setAttribute('x1', sx(x)); hair.setAttribute('x2', sx(x)); hair.setAttribute('visibility', 'visible');
        ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: o.quantity + ' ≤ ' + xFmt(x), rows: [{ key: 'var(--series-1)', label: 'Kans', value: fmt.pct(F(x), 1) }, { label: 'Simulaties', value: fmt.int(upperBound(sorted, x)) }] }));
      };
      overlay.addEventListener('pointermove', show); overlay.addEventListener('pointerenter', show);
      overlay.addEventListener('pointerleave', () => { hair.setAttribute('visibility', 'hidden'); ui.tooltip.hide(); });
      root.appendChild(overlay);
      return root;
    });
    const table = () => {
      const rows = C.niceTicks(min, max, 12).ticks.filter(v => v >= min && v <= max).map(x => ({ x, p: F(x), count: upperBound(sorted, x) }));
      if (o.scenario != null) rows.push({ x: o.scenario, p: F(o.scenario), count: upperBound(sorted, o.scenario), scenario: true });
      rows.sort((a, b) => a.x - b.x);
      return ui.table({ columns: [{ key: 'x', label: o.quantity + ' ≤', align: 'num', format: (v, r) => r.scenario ? xFmt(v) + ' (scenario)' : xFmt(v) }, { key: 'p', label: 'Kans', align: 'num', format: v => fmt.pct(v, 1) }, { key: 'count', label: 'Simulaties', align: 'num', format: fmt.int }], rows, rowClass: r => r.scenario ? 'key' : '' });
    };
    return { el, legend: null, table };
  }
  // tornado-items: één driver tegelijk op P10/P90, deterministisch herberekend; gememoized (identiek bij elke voorlopige hertekening)
  const tornadoMemo = { key: null, items: null };
  function tornadoItems(model, a0, unc, ty, target) {
    const key = JSON.stringify([a0, unc, ty, target]);
    if (tornadoMemo.key === key) return tornadoMemo.items;
    const meta = H.util.assumptionMeta;
    const value = a => {
      if (target === 'liq') return Math.min(...model.forecastMonths(a).map(m => m.bs.cash - m.bs.rcf));
      const y = model.year(ty, a); return target === 'ni' ? y.pl.netIncome : y.pl.ebitda;
    };
    const items = DRIVERS.map(d => {
      const sd = unc[d.sd]; const floor = FLOORS[d.key] != null ? FLOORS[d.key] : -Infinity;
      const loV = Math.max(floor, a0[d.key] - 1.28 * sd), hiV = Math.max(floor, a0[d.key] + 1.28 * sd);
      const low = value(Object.assign({}, a0, { [d.key]: loV })), high = value(Object.assign({}, a0, { [d.key]: hiV }));
      return { label: driverLabel(d.key), low, high, lowText: meta[d.key].format(loV), highText: meta[d.key].format(hiV), range: Math.abs(high - low) };
    }).sort((p, q) => q.range - p.range);
    tornadoMemo.key = key; tornadoMemo.items = items;
    return items;
  }

  H.tabs.register({
    id: 'risico', label: 'Risico', short: 'Risico', order: 50, icon: 'dice',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E } = ctx;
      const meta = H.util.assumptionMeta;
      const sdText = d => v => 'σ ' + (d.unit === 'days' ? fmt.days(v) : fmt.num(v * 100, 1) + ' pp');
      const figure = o => { const f = ui.figure(o); f.style.margin = '0'; return f; }; // <figure> heeft een browsermarge van 1em 40px die .figure niet reset
      const eurTick = v => Math.abs(v) >= 1e6 && Math.abs(v / 1e6 - Math.round(v / 1e6)) < 1e-9 ? fmt.eurM(v, 0) : fmt.eur(v); // hele miljoenen compact (astitels), rest met decimaal
      const pctR = p => fmt.pct(p, p > 0 && p < 0.01 ? 1 : 0); // kleine kansen met één decimaal, zodat 0,2% niet als 0% leest
      const page = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } }); root.appendChild(page);

      // ---------- paginakop ----------
      const headP = h('p', null, '');
      const headChips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      const statusChip = h('span', { class: 'chip', id: 'rk-state' }); // vaste plek voor 'voorlopig'/'definitief', zodat de resultaten niet verspringen
      const setStatus = (text, tone, icon) => { H.clear(statusChip); statusChip.className = 'chip ' + tone; statusChip.appendChild(H.icon(icon, 12)); statusChip.appendChild(document.createTextNode(text)); };
      setStatus('Nog niet gesimuleerd', 'forecast', 'info');
      page.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Risico'), headP), headChips));
      // samenvatting (KPI-rij) staat vóór het besturingspaneel, ook op mobiel
      const summary = h('div', { class: 'kpi-row', id: 'rk-summary' }); page.appendChild(summary);
      const grid = h('div', { class: 'grid' }); page.appendChild(grid);

      // ---------- besturingspaneel (eenmalig gebouwd) ----------
      const pending = Object.assign({}, settings.unc); // sliderwaarden tot "Simuleer"
      const panel = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
      const staleNote = h('div', { class: 'note', hidden: true }, 'Onzekerheid aangepast; klik op Simuleer om opnieuw te trekken.');
      const nSeg = ui.segmented({ id: 'rk-n', label: 'Aantal simulaties', value: settings.n, options: [1000, 5000, 10000, 20000].map(v => ({ value: v, label: fmt.int(v) })), onChange: v => { settings.n = v; applyPending(); refresh(); } });
      const ySeg = ui.segmented({ id: 'rk-year', label: 'Doeljaar', value: settings.targetYear, options: [2027, 2028].map(v => ({ value: v, label: String(v) })), onChange: v => { settings.targetYear = v; applyPending(); refresh(); } });
      panel.appendChild(h('div', { class: 'field' }, h('label', { for: 'rk-n' }, 'Aantal simulaties'), nSeg));
      panel.appendChild(h('div', { class: 'field' }, h('label', { for: 'rk-year' }, 'Doeljaar voor EBITDA, nettowinst en FCF'), ySeg));
      const slBox = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div', { class: 'eyebrow' }, 'Onzekerheid per driver (standaardafwijking)'));
      const hintEls = {};
      for (const d of DRIVERS) {
        const sl = ui.slider({ id: 'rk-sd-' + d.key, label: driverLabel(d.key), min: d.min, max: d.max, step: d.step, value: settings.unc[d.sd], format: sdText(d), hint: 'rond –', onInput: v => { pending[d.sd] = v; staleNote.hidden = !isStale(); } });
        hintEls[d.key] = sl.querySelector('.slider-hint');
        slBox.appendChild(sl);
      }
      panel.appendChild(slBox);
      panel.appendChild(staleNote);
      const btnSim = ui.button('Simuleer', () => { applyPending(); refresh(true); }, { primary: true, icon: 'play', id: 'rk-run' });
      const btnSeed = ui.button('Nieuwe trekking', () => { settings.seed = nextSeed(settings.seed); applyPending(); refresh(true); }, { icon: 'refresh', id: 'rk-seed' });
      panel.appendChild(h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } }, btnSim, btnSeed));
      const barFill = h('i'); const bar = h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': 'Voortgang simulatie' }, barFill);
      const status = h('div', { class: 'small muted num', id: 'rk-status' }, '');
      panel.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, bar, status));
      const foot = h('span', null, 'Nog niet gesimuleerd.');
      grid.appendChild(ui.card({ span: 4, title: 'Simulatie-instellingen', subtitle: 'drivers worden normaal verdeeld getrokken rond het actieve scenario', body: panel, footer: foot }));
      const results = h('div', { class: 'span-8', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } });
      grid.appendChild(results);

      function isStale() { return DRIVERS.some(d => Math.abs(pending[d.sd] - settings.unc[d.sd]) > 1e-12); }
      function applyPending() { settings.unc = Object.assign({}, pending); staleNote.hidden = true; }
      function request() { return { assumptions: model.assumptions(), unc: Object.assign({}, settings.unc), n: settings.n, seed: settings.seed, opts: { targetYear: settings.targetYear, chunks: CHUNKS } }; }
      function setProgress(done, n) { const p = n > 0 ? done / n : 0; barFill.style.width = (p * 100).toFixed(1) + '%'; bar.setAttribute('aria-valuenow', Math.round(p * 100)); status.textContent = fmt.int(done) + ' van ' + fmt.int(n) + ' simulaties'; }
      function syncHead(req) {
        const s = H.state.get(); const sc = model.scenarios[s.scenarioKey]; const custom = Object.keys(s.overrides || {}).length > 0;
        headP.textContent = fmt.int(req.n) + ' simulaties van de forecast waarbij zeven drivers onafhankelijk rond scenario ' + sc.label.toLowerCase() + (custom ? ' (aangepast)' : '') + ' variëren. Doeljaar ' + req.opts.targetYear + '; convenanten en kas worden over de hele forecast t/m 2029 getoetst. De filters korrel en periode gelden hier niet.';
        H.clear(headChips); headChips.appendChild(ui.chip(sc.label + (custom ? ' · aangepast' : ''), 'forecast')); headChips.appendChild(ui.chip('Doeljaar ' + req.opts.targetYear, 'accent')); headChips.appendChild(statusChip);
        for (const d of DRIVERS) if (hintEls[d.key]) hintEls[d.key].textContent = 'rond ' + meta[d.key].format(req.assumptions[d.key]);
      }
      function placeholderSummary(req) {
        H.clear(summary); const ty = req.opts.targetYear;
        for (const label of ['EBITDA ' + ty + ' · P10', 'EBITDA ' + ty + ' · P50', 'EBITDA ' + ty + ' · P90', 'Kans op verlies ' + ty, 'Kans op convenantbreuk', 'Kans op kasklem']) summary.appendChild(ui.kpi({ label, value: '–', hint: 'simulatie loopt' }));
      }

      // ---------- simulatie starten / resultaten tonen ----------
      let shownKey = null, wantedKey = null, lastBuild = null;
      function refresh(force) {
        const req = request(); const key = keyOf(req);
        syncHead(req);
        if (!force && key === shownKey) return;              // filterwissel (korrel/periode) raakt de simulatie niet
        if (mc.busy && key === wantedKey && !cache.has(key)) return; // loopt al
        wantedKey = key;
        if (!cache.has(key)) {
          btnSim.disabled = true; setProgress(0, req.n); setStatus('Voorlopig · 0 van ' + fmt.int(req.n), 'warning', 'refresh');
          if (results.children.length) { results.classList.add('fade'); summary.classList.add('fade'); }
          else { placeholderSummary(req); H.clear(results); results.appendChild(ui.note('De eerste simulatie loopt — ' + fmt.int(req.n) + ' volledige herberekeningen van het drie-statement model.', 'accent')); }
        }
        let lastPrelim = performance.now();
        const onProgress = (done, n, parts) => {
          setProgress(done, n);
          if (key !== wantedKey) return;
          setStatus('Voorlopig · ' + fmt.int(done) + ' van ' + fmt.int(n), 'warning', 'refresh');
          if (!parts || !parts.length || done >= n) return;
          if (performance.now() - lastPrelim < 400) return; // voorlopige verdeling hooguit elke 400 ms hertekenen
          lastPrelim = performance.now();
          try { build(merge(parts, req.seed >>> 0, req.opts.targetYear), req, { preliminary: true, done, n }); } catch (e) { console.error(e); }
        };
        simulate(req, onProgress).then(info => {
          if (key !== wantedKey) return; // inmiddels iets anders gevraagd
          btnSim.disabled = false; setProgress(info.results.n, info.results.n);
          shownKey = key; mc.lastInfo = info;
          setStatus('Definitief · ' + fmt.int(info.results.n) + ' simulaties', 'accent', 'check');
          build(info.results, req);
          H.clear(foot); foot.appendChild(document.createTextNode(fmt.int(info.results.n) + ' simulaties in ' + fmt.num(info.ms / 1000, 1) + ' s' + (info.cached ? ' (uit cache)' : '') + ' · trekking #' + info.results.seed + '.'));
          foot.title = (info.via === 'worker' ? 'Web Worker' : 'hoofdthread') + ' · ' + fmt.int(CHUNKS) + ' brokken · statistiek en grafieken opgebouwd in ' + fmt.num(info.buildMs || 1, 0) + ' ms';
        }).catch(e => {
          if (e && e.cancelled) return;
          console.error(e); btnSim.disabled = false; results.classList.remove('fade'); summary.classList.remove('fade');
          setStatus('Simulatie mislukt', 'critical', 'warn');
          H.clear(results); results.appendChild(ui.note('De simulatie is mislukt: ' + e.message, 'critical'));
        });
      }
      const rebuild = () => { if (lastBuild) build(lastBuild.res, lastBuild.req, lastBuild.opt); };

      function build(res, req, opt) {
        const t0 = performance.now();
        lastBuild = { res, req, opt };
        H.clear(summary); H.clear(results); summary.classList.remove('fade'); results.classList.remove('fade');
        const n = res.n, ty = req.opts.targetYear, cfg = model.config;
        const a0 = model.assumptions();
        const det = model.year(ty); const detEbitda = det.pl.ebitda;
        const fc = model.forecastMonths();
        const detMinCash = Math.min(...fc.map(m => m.bs.cash)); const detMaxLev = Math.max(...fc.map(m => m.kpi.leverage)); const detMinIcr = Math.min(...fc.map(m => m.kpi.icr));
        const S = { ebitda: E.stats(res.ebitda), ni: E.stats(res.netIncome), fcf: E.stats(res.fcf), minCash: E.stats(res.minCash), maxLev: E.stats(res.maxLeverage), minIcr: E.stats(res.minIcr) };
        const below = upperBound(S.ebitda.sorted, detEbitda - 1e-6); const pBelow = below / n;
        // convenant-ontleding per simulatie op maandbasis (laagste rentedekking / hoogste leverage over de hele forecast); de kwartaaltoets telt res.breach
        let nLoss = 0, nIcr = 0, nLevDef = 0, cUndef = 0, cBoth = 0, cIcr = 0, cLev = 0;
        for (let i = 0; i < n; i++) {
          if (res.netIncome[i] < 0) nLoss++;
          const icrLow = res.minIcr[i] < cfg.covenantIcrMin; const lv = res.maxLeverage[i]; const undef = lv >= 50; const levHigh = !undef && lv > cfg.covenantLeverageMax;
          if (icrLow) nIcr++; if (levHigh) nLevDef++;
          if (undef) cUndef++; else if (icrLow && levHigh) cBoth++; else if (icrLow) cIcr++; else if (levHigh) cLev++;
        }
        const cAny = cUndef + cBoth + cIcr + cLev;
        const pBreach = res.breach / n, pCash = res.cashBreach / n, pLoss = nLoss / n;
        const levFmt = v => v < 0 ? 'nettokas' : v >= 50 ? 'EBITDA ≤ 0' : fmt.x(v, 2); // engine geeft 99 als LTM-EBITDA ≤ 0 (leverage niet definieerbaar)
        const icrFmt = v => v >= 50 ? 'geen rente' : fmt.x(v, 1);                          // engine geeft 99 als er geen rentelast is
        const tone = p => p < 0.05 ? 'good' : p < 0.20 ? 'warning' : 'critical';
        const toneText = p => p < 0.05 ? 'laag' : p < 0.20 ? 'verhoogd' : 'hoog';
        const riskHint = (p, text) => [ui.chip(toneText(p), tone(p), p < 0.05 ? 'check' : 'warn'), ' ' + text];

        // ---------- KPI's (samenvatting, boven het paneel) ----------
        const medDiff = S.ebitda.p50 - detEbitda;
        summary.appendChild(ui.kpi({ label: 'EBITDA ' + ty + ' · P10', value: fmt.eurM(S.ebitda.p10), hint: 'één op de tien simulaties komt lager uit' }));
        summary.appendChild(ui.kpi({ label: 'EBITDA ' + ty + ' · P50', value: fmt.eurM(S.ebitda.p50), hint: 'mediaan · ' + (Math.abs(medDiff) < 5e4 ? 'gelijk aan de scenariowaarde ' + fmt.eurM(detEbitda) : fmt.eur(Math.abs(medDiff)) + (medDiff < 0 ? ' onder' : ' boven') + ' de scenariowaarde ' + fmt.eurM(detEbitda)) + ' · σ ' + fmt.eurM(S.ebitda.sd) }));
        summary.appendChild(ui.kpi({ label: 'EBITDA ' + ty + ' · P90', value: fmt.eurM(S.ebitda.p90), hint: 'één op de tien simulaties komt hoger uit' }));
        summary.appendChild(ui.kpi({ label: 'Kans op verlies ' + ty, value: pctR(pLoss), hint: riskHint(pLoss, fmt.int(nLoss) + ' simulaties met negatieve nettowinst · scenario ' + fmt.eurM(det.pl.netIncome)) }));
        summary.appendChild(ui.kpi({ label: 'Kans op convenantbreuk', value: pctR(pBreach), hint: riskHint(pBreach, fmt.int(res.breach) + ' simulaties op de kwartaaltoets · rentedekking onder ' + fmt.x(cfg.covenantIcrMin) + ' in ' + fmt.int(nIcr) + ', leverage boven ' + fmt.x(cfg.covenantLeverageMax) + ' in ' + fmt.int(nLevDef) + ' (overlap mogelijk)') }));
        summary.appendChild(ui.kpi({ label: 'Kans op kasklem', value: pctR(pCash), hint: riskHint(pCash, fmt.int(res.cashBreach) + ' simulaties · RCF van ' + fmt.eurM(cfg.rcfLimit) + ' volledig benut en kas onder ' + fmt.eurM(cfg.minCash)) }));

        // ---------- markeringslabels zonder botsing (charts.histogram zet labels blind naast de lijn) ----------
        const vw = window.innerWidth, rw = results.clientWidth || 800;
        const cardWidth = span => { const full = vw <= 640 || span === 12 || (vw <= 1100 && span >= 8); const frac = full ? 1 : span / 12; return (rw - 14 * (1 / frac - 1)) * frac; };
        const plotWidth = span => Math.max(240, cardWidth(span) - (vw <= 640 ? 24 : 32)) - 44; // kaartmarge, y-aslabels, rechtermarge
        function layoutMarkers(markers, lo, hi, span) {
          const plotW = plotWidth(span); const sx = x => (x - lo) / (hi - lo || 1) * plotW; const placed = [];
          const order = markers.map((m, i) => i).sort((p, q) => (markers[q].priority || 0) - (markers[p].priority || 0));
          for (const i of order) {
            const m = markers[i]; if (!m.label) continue;
            const px = sx(m.x); const w = charts.measure(m.label) + 4;
            const cands = (m.anchor === 'end' ? ['end', 'start'] : ['start', 'end']).map(a => ({ a, l: a === 'start' ? px + 3 : px + 3 - w, r: a === 'start' ? px + 3 + w : px + 3 }));
            const ok = cands.find(c => c.l >= -2 && c.r <= plotW + 10 && !placed.some(q => c.l < q[1] + 6 && c.r + 6 > q[0])); // minstens 6 px tussen labels
            if (ok) { m.anchor = ok.a; placed.push([ok.l, ok.r]); } else m.label = ''; // lijn blijft, label vervalt
          }
          return markers;
        }
        const pctAxis = v => fmt.pct(v, Math.abs(v * 100 - Math.round(v * 100)) < 1e-9 ? 0 : 1); // hele procenten zonder, overige met één decimaal

        // ---------- histogram EBITDA ----------
        const eb = S.ebitda; const bins = E.histogram(eb.sorted, 40);
        const hist = charts.histogram({ bins, xFormat: fmt.eur, height: 230, color: 'var(--series-1)', ariaLabel: 'Verdeling EBITDA ' + ty, markers: layoutMarkers([
          { x: eb.p10, label: 'P10', color: 'var(--ink-2)', dashed: true, anchor: 'start', priority: 2 },
          { x: eb.p50, label: 'P50', color: 'var(--ink-2)', dashed: true, anchor: eb.p50 <= detEbitda ? 'end' : 'start', priority: 3 },
          { x: eb.p90, label: 'P90', color: 'var(--ink-2)', dashed: true, anchor: 'end', priority: 1 },
          { x: detEbitda, label: 'scenario', color: 'var(--ink)', strong: true, anchor: detEbitda >= eb.p50 ? 'start' : 'end', priority: 4 }
        ], bins[0].x0, bins[bins.length - 1].x1, 8) });
        const g1 = h('div', { class: 'grid' });
        g1.appendChild(ui.card({ span: 8, title: 'Verdeling van EBITDA ' + ty, subtitle: fmt.int(n) + ' simulaties in 40 klassen · gestreept P10/P50/P90 · doorgetrokken = deterministische scenariowaarde ' + fmt.eurM(detEbitda), body: figure({ chart: hist, note: 'Spreiding P10–P90: ' + fmt.eurM(eb.p90 - eb.p10) + ' (' + fmt.pct((eb.p90 - eb.p10) / Math.abs(eb.p50 || 1), 0) + ' van de mediaan) · uitersten ' + fmt.eurM(eb.min) + ' tot ' + fmt.eurM(eb.max) + '.' }) }));

        // ---------- cumulatieve kans ----------
        const cdf = cdfChart({ sorted: eb.sorted, scenario: detEbitda, quantity: 'EBITDA', xFormat: fmt.eur, tickFormat: eurTick, height: 214, ariaLabel: 'Cumulatieve kansverdeling EBITDA ' + ty });
        g1.appendChild(ui.card({ span: 4, title: 'Cumulatieve kans', subtitle: 'kans dat EBITDA ' + ty + ' onder een bedrag blijft', body: figure({ chart: cdf, note: 'De stip markeert de scenariowaarde ' + fmt.eurM(detEbitda) + ': ' + fmt.pct(pBelow, 0) + ' van de simulaties komt daaronder uit (bij symmetrische onzekerheid rond 50%).' }) }));
        results.appendChild(g1);

        // ---------- tornado (doelgrootheid kiesbaar) ----------
        const tgt = TARGETS[settings.tornadoTarget] ? settings.tornadoTarget : 'ebitda';
        const tName = TARGETS[tgt].name(ty);
        const tItems = tornadoItems(model, a0, req.unc, ty, tgt);
        const tBase = tgt === 'ebitda' ? detEbitda : tgt === 'ni' ? det.pl.netIncome : Math.min(...fc.map(m => m.bs.cash - m.bs.rcf));
        const shown = tItems.filter(it => it.range >= 1), flat = tItems.filter(it => it.range < 1);
        const tornado = charts.tornado({ items: shown.length ? shown : tItems, base: tBase, xFormat: eurTick, lowLabel: 'Driver op P10', highLabel: 'Driver op P90' });
        const tgtSeg = ui.segmented({ id: 'rk-tgt', label: 'Doelgrootheid van de gevoeligheid', value: tgt, options: Object.keys(TARGETS).map(k => ({ value: k, label: TARGETS[k].seg })), onChange: v => { settings.tornadoTarget = v; rebuild(); } });
        const g2 = h('div', { class: 'grid' });
        g2.appendChild(ui.card({ span: 12, title: 'Gevoeligheid van ' + tName, subtitle: 'één driver tegelijk op zijn P10/P90 (±1,28 σ), de rest op scenariowaarde', body: [
          h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, h('span', { class: 'small muted' }, 'Doelgrootheid'), tgtSeg),
          figure({ chart: tornado, note: 'Afwijking t.o.v. het scenario (' + fmt.eurM(tBase) + ')' + (shown.length ? '; ' + lcFirst(shown[0].label) + ' weegt het zwaarst (' + fmt.eurM(shown[0].range) + ' tussen P10 en P90).' : '.') + (flat.length ? ' Geen effect op ' + tName + ': ' + flat.map(it => lcFirst(it.label)).join(' en ') + ' — werkkapitaal werkt alleen door in liquiditeit, rente en convenanten.' : '') })] }));
        results.appendChild(g2);

        // ---------- convenanten: ontleding van de breuk + laagste rentedekking in klassen ----------
        const parts = [
          { label: 'EBITDA ≤ 0 (beide)', count: cUndef },
          { label: 'ICR én leverage', count: cBoth },
          { label: 'Alleen ICR', count: cIcr },
          { label: 'Alleen leverage', count: cLev }
        ];
        const decomp = cAny > 0 ? figure({ chart: charts.bar({ categories: parts.map(p => p.label), series: [{ name: 'Aandeel van alle simulaties', values: parts.map(p => p.count / n), color: 'var(--series-1)' }], horizontal: true, yFormat: pctAxis, labels: 'all', rowHeight: 30, xLabel: 'Oorzaak', tooltipTitle: i => parts[i].label + ' · ' + fmt.int(parts[i].count) + ' simulaties', ariaLabel: 'Oorzaken van convenantbreuk' }), note: 'Per simulatie de laagste rentedekking en hoogste leverage over alle maanden (benadering); de kwartaaltoets telt ' + fmt.int(res.breach) + ' breuken' + (cAny === res.breach ? ', precies gelijk aan deze ontleding (' + fmt.int(cAny) + ').' : ', tegenover ' + fmt.int(cAny) + ' op maandbasis.') })
          : ui.note('Geen enkele simulatie breekt een convenant: de rentedekking blijft boven ' + fmt.x(cfg.covenantIcrMin) + ' en de leverage onder ' + fmt.x(cfg.covenantLeverageMax) + '.', 'accent');
        // laagste ICR per simulatie is sterk tweetoppig (ruim 90% binnen 0,4x van elkaar, de rest een lange staart onder nul): een histogram
        // ontaardt in één staaf, daarom klassen rond het convenant met directe labels
        const icS = S.minIcr; const covI = cfg.covenantIcrMin;
        const edges = [0, covI / 2, covI, 2 * covI, 4 * covI];
        const xnum = v => fmt.num(v, Number.isInteger(v) ? 0 : 1);
        const bandLabels = ['< 0x'].concat(edges.map((e, i) => i < edges.length - 1 ? xnum(e) + ' – ' + xnum(edges[i + 1]) + 'x' : '≥ ' + xnum(e) + 'x'));
        const cum = edges.map(e => upperBound(icS.sorted, e - 1e-9)); // aantal strikt onder elke grens
        const bandCounts = [cum[0]].concat(edges.map((e, i) => (i < edges.length - 1 ? cum[i + 1] : n) - cum[i]));
        const bandBad = [true].concat(edges.map((e, i) => i < edges.length - 1 && edges[i + 1] <= covI + 1e-9));
        const icrBands = charts.bar({ categories: bandLabels, series: [{ name: 'Aandeel van de simulaties', values: bandCounts.map(c => c / n), color: 'var(--series-1)' }], horizontal: true, colorBy: i => bandBad[i] ? 'var(--critical)' : 'var(--series-1)', yFormat: pctAxis, labels: 'all', rowHeight: 26, xLabel: 'Laagste rentedekking', tooltipTitle: i => 'Laagste rentedekking ' + bandLabels[i] + ' · ' + fmt.int(bandCounts[i]) + ' simulaties', ariaLabel: 'Laagste rentedekking per simulatie, in klassen' });
        const g3 = h('div', { class: 'grid' });
        g3.appendChild(ui.card({ span: 6, title: 'Waardoor breekt het convenant?', subtitle: 'ICR = rentedekking < ' + fmt.x(cfg.covenantIcrMin) + ' · leverage = nettoschuld/EBITDA > ' + fmt.x(cfg.covenantLeverageMax) + ' · LTM-EBITDA ≤ 0 breekt beide', body: decomp }));
        g3.appendChild(ui.card({ span: 6, title: 'Laagste rentedekking (ICR)', subtitle: 'per simulatie het dieptepunt van EBITDA / rente (LTM) t/m 2029 · convenant ≥ ' + fmt.x(covI), body: figure({ chart: icrBands, note: 'In ' + fmt.pct(nIcr / n, 0) + ' van de simulaties zakt de rentedekking op enig moment onder ' + fmt.x(covI) + ' (rood), in ' + fmt.pct(cum[0] / n, 0) + ' zelfs onder nul doordat de LTM-EBITDA negatief wordt. Mediaan van het dieptepunt ' + icrFmt(icS.p50) + ', laagste ' + icrFmt(icS.min) + '; scenario zelf ' + icrFmt(detMinIcr) + '.' }) }));
        results.appendChild(g3);

        // ---------- histogrammen leverage en kas ----------
        const levS = S.maxLev; const levDef = levS.sorted.filter(v => v < 50); const levUndef = n - levDef.length;
        const levLo = levDef.length ? levDef[0] : 0; const levHi = levDef.length ? Math.min(levDef[levDef.length - 1], Math.max(cfg.covenantLeverageMax * 1.5, E.quantile(levDef, 0.99))) : cfg.covenantLeverageMax * 1.5;
        const levBins = alignedBins(E, levDef.length ? levDef : [0], 30, levLo, Math.max(levHi, levLo + 0.1), cfg.covenantLeverageMax); for (const b of levBins) b.share = b.count / n; // aandeel t.o.v. álle simulaties
        const levTop = levBins[levBins.length - 1].x1; const levClipped = levDef.length - upperBound(levDef, levTop);
        const levMeanDef = levDef.length ? levDef.reduce((a, b) => a + b, 0) / levDef.length : NaN;
        const icDef = icS.sorted.filter(v => v < 50); const icUndef = n - icDef.length; const icMeanDef = icDef.length ? icDef.reduce((a, b) => a + b, 0) / icDef.length : NaN;
        const levHist = charts.histogram({ bins: levBins, xFormat: v => fmt.x(v, 1), height: 214, ariaLabel: 'Verdeling hoogste leverage', colorBin: b => b.x0 >= cfg.covenantLeverageMax - 1e-9 ? 'var(--critical)' : 'var(--series-1)', markers: layoutMarkers([
          { x: cfg.covenantLeverageMax, label: 'convenant', color: 'var(--ink)', strong: true, anchor: detMaxLev < cfg.covenantLeverageMax ? 'start' : 'end', priority: 2 }
        ].concat(detMaxLev >= 50 ? [] : [{ x: detMaxLev, label: 'scenario', color: 'var(--ink-2)', dashed: true, anchor: detMaxLev < cfg.covenantLeverageMax ? 'end' : 'start', priority: 1 }]), levBins[0].x0, levTop, 6) });
        const mcS = S.minCash; const cashLo = Math.max(mcS.min, E.quantile(mcS.sorted, 0.01)); const cashHi = Math.max(mcS.max, cfg.minCash + 1);
        const cashBins = alignedBins(E, mcS.sorted, 30, cashLo, cashHi, cfg.minCash);
        const atFloor = upperBound(mcS.sorted, cfg.minCash + 1) - upperBound(mcS.sorted, cfg.minCash - 1);
        const belowFloor = upperBound(mcS.sorted, cfg.minCash - 1);
        const cashClipped = upperBound(mcS.sorted, cashBins[0].x0 - 1e-6);
        const detTrough = fc.reduce((m, x) => x.bs.cash < m.bs.cash ? x : m, fc[0]); const scenAtFloor = Math.abs(detMinCash - cfg.minCash) < 1;
        const cashHist = charts.histogram({ bins: cashBins, xFormat: fmt.eur, height: 214, ariaLabel: 'Verdeling laagste kaspositie', colorBin: b => b.x1 <= cfg.minCash + 1e-6 ? 'var(--critical)' : 'var(--series-1)', markers: layoutMarkers([
          { x: cfg.minCash, label: 'minimumkas', color: 'var(--ink)', strong: true, anchor: detMinCash > cfg.minCash ? 'end' : 'start', priority: 2 }
        ].concat(scenAtFloor ? [] : [{ x: detMinCash, label: 'scenario', color: 'var(--ink-2)', dashed: true, anchor: detMinCash > cfg.minCash ? 'start' : 'end', priority: 1 }]), cashBins[0].x0, cashBins[cashBins.length - 1].x1, 6) });
        const g4 = h('div', { class: 'grid' });
        g4.appendChild(ui.card({ span: 6, title: 'Hoogste nettoschuld / EBITDA', subtitle: 'per simulatie de piek in de forecast · convenant ≤ ' + fmt.x(cfg.covenantLeverageMax), body: figure({ chart: levHist, note: 'In ' + fmt.pct(nLevDef / n, 0) + ' van de simulaties komt de leverage boven ' + fmt.x(cfg.covenantLeverageMax) + ' (rood); scenario zelf piekt op ' + levFmt(detMaxLev) + '.' + (levUndef > 0 ? ' In ' + fmt.int(levUndef) + ' simulaties (' + fmt.pct(levUndef / n, 0) + ') is de LTM-EBITDA op enig moment ≤ 0: leverage is dan niet definieerbaar en het convenant automatisch gebroken; die staan niet in dit histogram, wel in de ontleding hierboven.' : '') + (levClipped > 0 ? ' ' + fmt.int(levClipped) + ' uitschieters boven ' + fmt.x(levTop, 1) + ' zijn gebundeld in de laatste klasse.' : '') }) }));
        g4.appendChild(ui.card({ span: 6, title: 'Laagste kaspositie in de forecast', subtitle: 'per simulatie het dieptepunt t/m 2029 · minimumkas ' + fmt.eurM(cfg.minCash), body: figure({ chart: cashHist, note: 'In ' + fmt.pct(atFloor / n, 0) + ' van de simulaties blijft het dieptepunt precies op de minimumkas: het RCF is getrokken maar toereikend. ' + (belowFloor > 0 ? 'In ' + fmt.pct(belowFloor / n, 0) + ' is het RCF uitgeput en zakt de kas eronder (rood; laagste waarde ' + fmt.eur(mcS.min) + ').' : 'Het RCF raakt in geen enkele simulatie uitgeput.') + ' Scenario zelf: dieptepunt ' + fmt.eurM(detMinCash) + ' in ' + fmt.month(detTrough.period) + (detTrough.bs.rcf > 1 ? ' met ' + fmt.eurM(detTrough.bs.rcf) + ' RCF getrokken.' : ', RCF onbenut.') + (cashClipped > 0 ? ' ' + fmt.int(cashClipped) + ' waarden onder ' + fmt.eur(cashBins[0].x0) + ' zijn gebundeld in de eerste klasse.' : '') }) }));
        results.appendChild(g4);

        // ---------- percentieltabel ----------
        const pcts = [['P5', 'p5'], ['P10', 'p10'], ['P25', 'p25'], ['P50', 'p50'], ['P75', 'p75'], ['P90', 'p90'], ['P95', 'p95']];
        const rows = pcts.map(([label, k]) => ({ label, ebitda: S.ebitda[k], ni: S.ni[k], fcf: S.fcf[k], minCash: S.minCash[k], minIcr: S.minIcr[k], maxLev: S.maxLev[k] }));
        rows.push({ label: 'Gemiddelde', ebitda: S.ebitda.mean, ni: S.ni.mean, fcf: S.fcf.mean, minCash: S.minCash.mean, minIcr: icMeanDef, maxLev: levMeanDef, mean: true });
        const star = (undef) => undef > 0 ? '*' : '';
        const table = ui.table({ columns: [
          { key: 'label', label: 'Percentiel' },
          { key: 'ebitda', label: 'EBITDA ' + ty, align: 'num', format: fmt.eurM },
          { key: 'ni', label: 'Nettowinst ' + ty, align: 'num', format: fmt.eurM },
          { key: 'fcf', label: 'Vrije kasstroom ' + ty, align: 'num', format: fmt.eurM },
          { key: 'minCash', label: 'Laagste kas', align: 'num', format: fmt.eurM },
          { key: 'minIcr', label: 'Laagste ICR', align: 'num', format: (v, r) => icrFmt(v) + (r.mean ? star(icUndef) : '') },
          { key: 'maxLev', label: 'Max. leverage', align: 'num', format: (v, r) => levFmt(v) + (r.mean ? star(levUndef) : '') }
        ], rows, rowClass: r => r.mean ? '' : (r.label === 'P50' ? 'key' : ''), footer: { label: 'Scenario (deterministisch)', ebitda: detEbitda, ni: det.pl.netIncome, fcf: det.cf.fcf, minCash: detMinCash, minIcr: detMinIcr, maxLev: detMaxLev } });
        results.appendChild(ui.card({ title: 'Percentielen per uitkomst', subtitle: 'per kolom afzonderlijk gesorteerd · laagste kas, laagste rentedekking (ICR) en hoogste leverage over de hele forecast t/m 2029', body: [table,
          ui.note('Lees de percentielen als kansen: P10 betekent dat één op de tien simulaties lager uitkomt, P90 dat één op de tien hoger uitkomt. De zeven drivers worden onafhankelijk getrokken uit normale verdelingen rond het actieve scenario; samenhang tussen drivers (zoals vraaguitval én prijsdruk in een recessie) zit er niet in, waardoor de werkelijke spreiding eerder groter dan kleiner is.')],
          footer: (levUndef > 0 || icUndef > 0) ? '* gemiddelde zonder de ' + fmt.int(Math.max(levUndef, icUndef)) + ' simulaties waarin de waarde niet definieerbaar is (LTM-EBITDA ≤ 0 of geen rentelast).' : null }));
        const buildMs = performance.now() - t0;
        if (mc.lastInfo) mc.lastInfo.buildMs = buildMs;
        mc.lastBuildMs = buildMs;
      }

      refresh();
      ctx.subscribe(() => refresh());
    }
  });
})();
