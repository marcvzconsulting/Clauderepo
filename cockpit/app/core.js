/*
 * core.js — fundament van de cockpit: formattering, DOM-helper, state, model, UI-componenten, tab-registry.
 * Alles hangt onder window.HC. Tabs registreren zich via HC.tabs.register({...}).
 */
(function () {
  'use strict';
  const E = window.HelderEngine;
  const HC = window.HC = { version: '1.0.0' };

  // =====================================================================
  // Formattering (nl-NL)
  // =====================================================================
  const nf0 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MONTHS_SHORT = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const MONTHS_LONG = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
  const MINUS = '−';
  function fixMinus(s) { return s.replace(/^-/, MINUS).replace(/^€ -/, '€ ' + MINUS); }
  const fmt = {
    num(v, d) { if (v == null || !isFinite(v)) return '–'; const f = d === 1 ? nf1 : d === 2 ? nf2 : nf0; return fixMinus(f.format(v)); },
    int(v) { return fmt.num(Math.round(v || 0), 0); },
    /** euro, compact: € 12,4M / € 845k / € 320 */
    eur(v, opts) {
      opts = opts || {};
      if (v == null || !isFinite(v)) return '–';
      if (Math.abs(v) < 0.5) v = 0;
      const neg = v < 0; const a = Math.abs(v);
      let s;
      if (opts.full) s = nf0.format(Math.round(a));
      else if (a >= 1e9) s = nf1.format(a / 1e9) + ' mld';
      else if (a >= 1e6) s = (a >= 1e8 ? nf0 : nf1).format(a / 1e6) + 'M';
      else if (a >= 1e4) s = nf0.format(a / 1e3) + 'k';
      else if (a >= 1e3) s = nf1.format(a / 1e3) + 'k';
      else s = nf0.format(a);
      return (neg ? MINUS : '') + '€ ' + s;
    },
    eurM(v, d) { if (v == null || !isFinite(v)) return '–'; if (Math.abs(v) < (d === 0 ? 5e5 : 5e4)) v = 0; const neg = v < 0; return (neg ? MINUS : '') + '€ ' + (d === 0 ? nf0 : nf1).format(Math.abs(v) / 1e6) + 'M'; },
    eurK(v) { if (v == null || !isFinite(v)) return '–'; const neg = v < 0; return (neg ? MINUS : '') + '€ ' + nf0.format(Math.abs(v) / 1e3) + 'k'; },
    pct(v, d) { if (v == null || !isFinite(v)) return '–'; return fixMinus((d === 0 ? nf0 : d === 2 ? nf2 : nf1).format(v * 100)) + '%'; },
    pp(v, d) { if (v == null || !isFinite(v)) return '–'; const s = (d === 0 ? nf0 : nf1).format(Math.abs(v) * 100); return (v > 0 ? '+' : v < 0 ? MINUS : '±') + s + ' pp'; },
    x(v, d) { if (v == null || !isFinite(v)) return '–'; if (v > 50) return '> 50x'; return fixMinus((d === 2 ? nf2 : nf1).format(v)) + 'x'; },
    days(v) { if (v == null || !isFinite(v)) return '–'; return nf0.format(Math.round(v)) + ' dgn'; },
    fte(v) { return fmt.num(v, 0) + ' FTE'; },
    signed(v, f) { if (v == null || !isFinite(v)) return '–'; const s = (f || fmt.eur)(Math.abs(v)); return (v > 0 ? '+' : v < 0 ? MINUS : '±') + s; },
    signedPct(v, d) { if (v == null || !isFinite(v)) return '–'; return (v > 0 ? '+' : v < 0 ? MINUS : '±') + (d === 0 ? nf0 : nf1).format(Math.abs(v) * 100) + '%'; },
    month(ym) { if (!ym) return ''; const m = Number(ym.slice(5, 7)); return MONTHS_SHORT[m - 1] + ' ' + ym.slice(2, 4); },
    monthLong(ym) { if (!ym) return ''; const m = Number(ym.slice(5, 7)); return MONTHS_LONG[m - 1] + ' ' + ym.slice(0, 4); },
    monthShort(ym) { const m = Number(ym.slice(5, 7)); return MONTHS_SHORT[m - 1]; },
    quarter(q) { if (!q) return ''; const [y, k] = q.split('-'); return k + ' ' + y; },
    /** label van een periodesleutel per korrel */
    period(key, grain) { if (grain === 'M') return fmt.month(key); if (grain === 'Q') return fmt.quarter(key); return String(key); },
    periodLong(key, grain) { if (grain === 'M') return fmt.monthLong(key); if (grain === 'Q') return fmt.quarter(key).replace(/^Q(\d) /, 'kwartaal $1 '); return 'boekjaar ' + key; },
    date(iso) { const [y, m, d] = iso.split('-'); return Number(d) + ' ' + MONTHS_LONG[Number(m) - 1] + ' ' + y; },
    MINUS
  };
  HC.fmt = fmt;

  // =====================================================================
  // DOM-helper (tekst altijd via textContent — nooit innerHTML met data)
  // =====================================================================
  const SVG_NS = 'http://www.w3.org/2000/svg';
  function applyProps(el, props, isSvg) {
    if (!props) return;
    for (const k in props) {
      const v = props[k];
      if (v == null || v === false) continue;
      if (k === 'class' || k === 'className') { if (isSvg) el.setAttribute('class', v); else el.className = v; }
      else if (k === 'style' && typeof v === 'object') { for (const s in v) el.style[s] = v[s]; }
      else if (k === 'dataset') { for (const d in v) el.dataset[d] = v[d]; }
      else if (k.startsWith('on') && typeof v === 'function') { el.addEventListener(k.slice(2).toLowerCase(), v); }
      else if (k === 'html') { el.innerHTML = v; } // alleen voor vertrouwde, statische opmaak
      else if (!isSvg && k in el && k !== 'list' && k !== 'form' && typeof v !== 'object') { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  function append(el, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) { for (const c of child) append(el, c); return; }
    if (child instanceof Node) { el.appendChild(child); return; }
    el.appendChild(document.createTextNode(String(child)));
  }
  HC.h = function (tag, props) { const el = document.createElement(tag); applyProps(el, props, false); for (let i = 2; i < arguments.length; i++) append(el, arguments[i]); return el; };
  HC.svg = function (tag, props) { const el = document.createElementNS(SVG_NS, tag); applyProps(el, props, true); for (let i = 2; i < arguments.length; i++) append(el, arguments[i]); return el; };
  HC.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  HC.icon = function (name, size) {
    const paths = {
      home: '<path d="M3 11 12 3l9 8v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z"/>',
      pl: '<path d="M4 20V4m0 16h16"/><path d="m7 14 4-5 3 3 5-6"/>',
      balance: '<path d="M12 3v18M4 7h16M6 7l-3 7a3 3 0 0 0 6 0zM18 7l-3 7a3 3 0 0 0 6 0z"/>',
      sliders: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
      dice: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2"/><circle cx="16" cy="8" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="8" cy="16" r="1.2"/><circle cx="16" cy="16" r="1.2"/>',
      value: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/>',
      chat: '<path d="M4 5h16v11H9l-5 4z"/>',
      pbi: '<rect x="3" y="12" width="4" height="8"/><rect x="10" y="7" width="4" height="13"/><rect x="17" y="3" width="4" height="17"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      warn: '<path d="M12 3 2 20h20z"/><path d="M12 9v5M12 17h.01"/>',
      info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
      up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', flat: '<path d="M5 12h14"/>',
      download: '<path d="M12 4v11m-5-5 5 5 5-5M4 19h16"/>',
      copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
      moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
      play: '<path d="M7 5v14l11-7z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
      refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
      table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
      chart: '<path d="M4 19h16M7 16V9M12 16V5M17 16v-6"/>'
    };
    const s = size || 16;
    const el = HC.svg('svg', { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
    el.innerHTML = paths[name] || paths.info;
    return el;
  };

  // =====================================================================
  // State (globale filters) — set() → listeners → actieve tab rendert opnieuw
  // =====================================================================
  const PRESETS = {
    all: { label: 'Alles (2023–2029)', from: '2023-01', to: '2029-12' },
    actuals: { label: 'Actuals (2023–sep 2026)', from: '2023-01', to: '2026-09' },
    ltm: { label: 'Laatste 12 maanden', from: '2025-10', to: '2026-09' },
    ytd: { label: 'YTD 2026', from: '2026-01', to: '2026-09' },
    y2025: { label: 'Boekjaar 2025', from: '2025-01', to: '2025-12' },
    y2026: { label: 'Boekjaar 2026', from: '2026-01', to: '2026-12' },
    y2027: { label: 'Boekjaar 2027', from: '2027-01', to: '2027-12' },
    forecast: { label: 'Forecast (okt 2026–2029)', from: '2026-10', to: '2029-12' },
    recent: { label: '2025–2027', from: '2025-01', to: '2027-12' }
  };
  HC.PRESETS = PRESETS;
  function createStore(initial) {
    let state = Object.assign({}, initial);
    const subs = new Set();
    let scheduled = false;
    function emit() { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; for (const fn of Array.from(subs)) { try { fn(state); } catch (e) { console.error(e); } } }); }
    return {
      get() { return state; },
      set(patch) { state = Object.assign({}, state, typeof patch === 'function' ? patch(state) : patch); emit(); return state; },
      subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
    };
  }
  HC.state = createStore({ grain: 'Q', preset: 'recent', scenarioKey: 'basis', overrides: {}, split: 'line' });
  HC.state.range = function () { const s = HC.state.get(); return PRESETS[s.preset] || PRESETS.all; };

  // =====================================================================
  // Model: dataset + engine-runs (gememoized)
  // =====================================================================
  const model = HC.model = {
    E,
    dataset: null, config: null, actRun: null, cache: new Map(), mcCache: new Map(),
    init(dataset) {
      this.dataset = dataset; this.config = dataset.config;
      this.actRun = E.run(dataset.config, dataset.actualDrivers);
      dataset._actRun = this.actRun;
      this.actualCount = dataset.actualDrivers.length;
      this.lastActualPeriod = dataset.config.actualsUntil;
      this.events = dataset.events;
      this.scenarios = dataset.scenarios;
      this.budget2026 = dataset.budget2026;
    },
    /** huidige aannames: scenario + overrides */
    assumptions() { const s = HC.state.get(); const base = (this.scenarios[s.scenarioKey] || this.scenarios.basis).assumptions; return Object.assign({}, E.defaultAssumptions(), base, s.overrides || {}); },
    assumptionsKey(a) { return JSON.stringify(a || this.assumptions()); },
    /** volledige run (actuals + forecast) voor de huidige aannames */
    run(a) {
      a = a || this.assumptions(); const key = this.assumptionsKey(a);
      if (!this.cache.has(key)) { if (this.cache.size > 40) this.cache.clear(); this.cache.set(key, E.runScenario(this.dataset, a)); }
      return this.cache.get(key);
    },
    months(a) { return this.run(a).months; },
    actualMonths() { return this.actRun.months; },
    forecastMonths(a) { return this.run(a).months.slice(this.actualCount); },
    lastActual() { return this.actRun.months[this.actualCount - 1]; },
    inRange(m, range) { range = range || HC.state.range(); return m.period >= range.from && m.period <= range.to; },
    /** vergelijkingsbasis voor een bereik: ≤ 12 maanden → dezelfde maanden een jaar eerder (seizoensecht); anders het even lange blok ervoor. null als dat vóór de modelstart ligt. */
    prevRange(range, opts) {
      range = range || HC.state.range(); opts = opts || {};
      const len = E.monthDiff(range.from, range.to) + 1;
      const yoy = opts.yoy != null ? opts.yoy : len <= 12;
      const from = E.addMonths(range.from, yoy ? -12 : -len), to = E.addMonths(range.to, yoy ? -12 : -len);
      if (from < this.config.start) return null;
      const ms = this.months().filter(m => m.period >= from && m.period <= to);
      if (ms.length !== len) return null;
      const label = yoy ? (len === 1 ? fmt.month(from) : fmt.month(from) + ' – ' + fmt.month(to)) : 'periode ervoor (' + fmt.month(from) + ' – ' + fmt.month(to) + ')';
      return { from, to, months: ms, mode: yoy ? 'yoy' : 'prev', label, agg: this.sumMonths(ms, label) };
    },
    /** JSON-veilige dataset voor Web Workers (zonder gememoizede runs) */
    datasetForWorker() { const d = this.dataset; return { meta: d.meta, config: d.config, dims: d.dims, actualDrivers: d.actualDrivers, budgetDrivers: d.budgetDrivers, events: d.events, scenarios: d.scenarios }; },
    /** aggregatie per korrel binnen het gekozen bereik */
    series(grain, a, range) { grain = grain || HC.state.get().grain; const ms = this.months(a).filter(m => this.inRange(m, range)); return E.aggregate(ms, grain); },
    seriesAll(grain, a) { return E.aggregate(this.months(a), grain || HC.state.get().grain); },
    /** som van een willekeurige set maanden tot één pseudo-periode (balans = laatste maand) */
    sumMonths(ms, label) { if (!ms.length) return null; const agg = E.aggregate(ms.map(m => Object.assign({}, m, { year: 0, quarter: 'x' })), 'Y')[0]; agg.key = label; agg.label = label; agg.n = ms.length; agg.year = ms[ms.length - 1].year; agg.period = ms[ms.length - 1].period; agg.isActual = ms.every(m => m.isActual); agg.partial = false; return agg; },
    ltm(endPeriod) { const ms = this.months(); const idx = endPeriod ? ms.findIndex(m => m.period === endPeriod) : this.actualCount - 1; return this.sumMonths(ms.slice(Math.max(0, idx - 11), idx + 1), 'LTM'); },
    priorLtm(endPeriod) { const ms = this.months(); const idx = endPeriod ? ms.findIndex(m => m.period === endPeriod) : this.actualCount - 1; return this.sumMonths(ms.slice(Math.max(0, idx - 23), idx - 11), 'LTM-1'); },
    year(y, a) { return this.sumMonths(this.months(a).filter(m => m.year === y), String(y)); },
    ytd(y) { const ms = this.actualMonths().filter(m => m.year === y); return this.sumMonths(ms, 'YTD ' + y); },
    ytdPrior(y) { const cur = this.actualMonths().filter(m => m.year === y); const ms = this.actualMonths().filter(m => m.year === y - 1 && m.month <= cur.length); return this.sumMonths(ms, 'YTD ' + (y - 1)); },
    /** budget 2026 per maand (alleen W&V) en actual-vs-budget t/m laatste actual */
    budgetMonths() { return this.budget2026; },
    budgetVsActual() {
      const out = [];
      for (const b of this.budget2026) {
        const a = this.actRun.months.find(m => m.period === b.period);
        out.push({ period: b.period, budget: b, actual: a || null });
      }
      return out;
    },
    /** Monte Carlo gememoized per (aannames, n, seed) */
    monteCarlo(n, seed, unc, opts) {
      const a = this.assumptions(); const key = this.assumptionsKey(a) + '|' + n + '|' + seed + '|' + JSON.stringify(unc || {}) + '|' + JSON.stringify(opts || {});
      if (!this.mcCache.has(key)) { if (this.mcCache.size > 6) this.mcCache.clear(); this.mcCache.set(key, E.monteCarlo(this.dataset, a, unc, n, seed, opts)); }
      return this.mcCache.get(key);
    },
    dcf(params, a) { return E.dcf(this.run(a), params); },
    /** compacte samenvatting voor de analist (tekst, < 20 KB) */
    digest() {
      const years = E.aggregate(this.months(), 'Y');
      const lines = [];
      lines.push(`Bedrijf: ${this.dataset.meta.company}, ${this.dataset.meta.city}, opgericht ${this.dataset.meta.founded}. Fictieve demo-data. Actuals t/m ${fmt.monthLong(this.lastActualPeriod)}; daarna forecast volgens scenario "${(this.scenarios[HC.state.get().scenarioKey] || this.scenarios.basis).label}".`);
      lines.push('Aannames forecast: ' + JSON.stringify(this.assumptions()));
      lines.push('Covenants: nettoschuld/EBITDA ≤ ' + this.config.covenantLeverageMax + 'x, rentedekking ≥ ' + this.config.covenantIcrMin + 'x; RCF-limiet ' + fmt.eur(this.config.rcfLimit) + ', minimumkas ' + fmt.eur(this.config.minCash) + ', VPB ' + fmt.pct(this.config.taxRate));
      lines.push('\nJAREN (A=actual, F=forecast, P=deels actual): jaar | omzet | eenheden | ASP | brutomarge% | opex | EBITDA | EBITDA% | afschr | rente | nettowinst | CFO | capex | FCF | kas eind | nettoschuld | leverage | ICR | DSO/DIO/DPO | FTE');
      for (const y of years) lines.push(`${y.key}${y.isActual ? 'A' : (y.months.some(m => m.isActual) ? 'P' : 'F')} | ${fmt.eurM(y.pl.revenue)} | ${fmt.int(y.kpi.units)} | ${fmt.eur(y.kpi.asp, { full: true })} | ${fmt.pct(y.kpi.grossMarginPct)} | ${fmt.eurM(y.pl.opex)} | ${fmt.eurM(y.pl.ebitda)} | ${fmt.pct(y.kpi.ebitdaPct)} | ${fmt.eurM(y.pl.dep)} | ${fmt.eurM(y.pl.netInterest)} | ${fmt.eurM(y.pl.netIncome)} | ${fmt.eurM(y.cf.cfo)} | ${fmt.eurM(-y.cf.capex)} | ${fmt.eurM(y.cf.fcf)} | ${fmt.eurM(y.bs.cash)} | ${fmt.eurM(y.kpi.netDebt)} | ${fmt.x(y.kpi.leverage)} | ${fmt.x(y.kpi.icr)} | ${Math.round(y.kpi.dso)}/${Math.round(y.kpi.dio)}/${Math.round(y.kpi.dpo)} | ${Math.round(y.kpi.fte)}`);
      lines.push('\nKWARTALEN (actual): kwartaal | omzet | brutomarge% | EBITDA | EBITDA% | nettowinst | kas | eenmalig');
      for (const q of E.aggregate(this.actualMonths(), 'Q')) lines.push(`${q.key} | ${fmt.eurM(q.pl.revenue)} | ${fmt.pct(q.kpi.grossMarginPct)} | ${fmt.eurM(q.pl.ebitda)} | ${fmt.pct(q.kpi.ebitdaPct)} | ${fmt.eurM(q.pl.netIncome)} | ${fmt.eurM(q.bs.cash)} | ${q.months.map(m => m.kpi.oneOffLabel).filter(Boolean).join('; ') || '-'}`);
      lines.push('\nOMZET PER PRODUCTLIJN / KANAAL / LAND per jaar:');
      for (const y of years) lines.push(`${y.key}: lijnen ${E.LINES.map(l => l + ' ' + fmt.eurM(y.byLine[l].revenue) + ' (' + fmt.int(y.byLine[l].units) + ' st, marge ' + fmt.pct((y.byLine[l].revenue - y.byLine[l].cogs) / y.byLine[l].revenue) + ')').join(', ')}; kanalen ${E.CHANNELS.map(c => c + ' ' + fmt.eurM(y.byChannel[c].revenue)).join(', ')}; landen ${E.COUNTRIES.map(c => c + ' ' + fmt.eurM(y.byCountry[c].revenue)).join(', ')}`);
      const b = E.aggregate(this.budget2026.map(x => Object.assign({ year: 2026, quarter: '', isActual: false, bs: {}, cf: {}, kpi: { units: x.kpi.units, fte: x.kpi.fte, dso: x.kpi.dso, dio: x.kpi.dio, dpo: x.kpi.dpo } }, x)), 'Y')[0];
      lines.push(`\nBUDGET 2026 (vastgesteld nov 2025): omzet ${fmt.eurM(b.pl.revenue)}, brutomarge ${fmt.pct(b.pl.grossProfit / b.pl.revenue)}, EBITDA ${fmt.eurM(b.pl.ebitda)}. YTD 2026 actual t/m sep: omzet ${fmt.eurM(this.ytd(2026).pl.revenue)} vs budget ${fmt.eurM(this.budget2026.slice(0, 9).reduce((s, m) => s + m.pl.revenue, 0))}; EBITDA ${fmt.eurM(this.ytd(2026).pl.ebitda)} vs budget ${fmt.eurM(this.budget2026.slice(0, 9).reduce((s, m) => s + m.pl.ebitda, 0))}.`);
      lines.push('\nGEBEURTENISSEN:');
      for (const ev of this.events) lines.push(`${fmt.monthLong(ev.period)}: ${ev.title} — ${ev.text}`);
      const last = this.lastActual();
      lines.push(`\nBALANS ${fmt.monthLong(last.period)}: kas ${fmt.eurM(last.bs.cash)}, debiteuren ${fmt.eurM(last.bs.ar)}, voorraad ${fmt.eurM(last.bs.inventory)}, MVA ${fmt.eurM(last.bs.ppeNet)}, totaal activa ${fmt.eurM(last.bs.totalAssets)}; crediteuren ${fmt.eurM(last.bs.ap)}, belastingschuld ${fmt.eurM(last.bs.taxPayable)}, termijnlening ${fmt.eurM(last.bs.termLoan)}, RCF ${fmt.eurM(last.bs.rcf)}, eigen vermogen ${fmt.eurM(last.bs.equity)}. Balanscheck ${last.bs.check.toExponential(1)}.`);
      return lines.join('\n');
    }
  };

  // =====================================================================
  // UI-componenten
  // =====================================================================
  const h = HC.h;
  const ui = HC.ui = {};

  ui.card = function (o) {
    const el = h('section', { class: 'card ' + (o.class || '') + (o.span ? ' span-' + o.span : ''), id: o.id });
    if (o.title || o.actions) {
      el.appendChild(h('div', { class: 'card-head' },
        h('div', null, o.title ? h('h3', { class: 'card-title' }, o.title) : null, o.subtitle ? h('div', { class: 'card-sub' }, o.subtitle) : null),
        o.actions ? h('div', { class: 'card-actions' }, o.actions) : null));
    }
    el.appendChild(h('div', { class: 'card-body' }, o.body));
    if (o.footer) el.appendChild(h('div', { class: 'card-foot' }, o.footer));
    return el;
  };

  /** stat tile: {label, value, delta:{text, dir:'up'|'down'|'flat', good:bool}, trend:[numbers], hint, hero} */
  ui.kpi = function (o) {
    const el = h('div', { class: 'kpi' + (o.hero ? ' hero' : '') + (o.class ? ' ' + o.class : '') });
    el.appendChild(h('div', { class: 'kpi-label' }, o.label));
    el.appendChild(h('div', { class: 'kpi-value' }, o.value));
    if (o.delta) {
      const d = o.delta; const dir = d.dir || 'flat';
      const cls = dir === 'flat' ? 'flat' : (d.good === false ? 'down' : d.good === true ? 'up' : (dir === 'up' ? 'up' : 'down'));
      el.appendChild(h('div', { class: 'kpi-delta' }, h('span', { class: cls }, HC.icon(dir, 13), ' ', d.text), d.label ? h('span', { class: 'muted' }, d.label) : null));
    }
    if (o.trend && o.trend.length > 1 && window.HCharts) el.appendChild(h('div', { class: 'kpi-trend' }, HCharts.sparkline(o.trend, { width: 120, height: 28, forecastFrom: o.trendForecastFrom })));
    if (o.hint) el.appendChild(h('div', { class: 'kpi-hint' }, o.hint));
    return el;
  };
  /** delta-helper: huidig vs vorig → {text, dir, good} ; upIsGood default true */
  ui.delta = function (cur, prev, opts) {
    opts = opts || {};
    if (prev == null || !isFinite(prev) || prev === 0) return null;
    const diff = cur - prev; const rel = diff / Math.abs(prev);
    const dir = Math.abs(rel) < 0.0005 ? 'flat' : diff > 0 ? 'up' : 'down';
    const upIsGood = opts.upIsGood !== false;
    const text = opts.absolute ? fmt.signed(diff, opts.format || fmt.eur) : fmt.signedPct(rel, 1);
    return { text, dir, good: dir === 'flat' ? null : (dir === 'up') === upIsGood, label: opts.label };
  };
  ui.deltaPp = function (cur, prev, opts) { opts = opts || {}; if (prev == null) return null; const diff = cur - prev; const dir = Math.abs(diff) < 0.0005 ? 'flat' : diff > 0 ? 'up' : 'down'; const upIsGood = opts.upIsGood !== false; return { text: fmt.pp(diff), dir, good: dir === 'flat' ? null : (dir === 'up') === upIsGood, label: opts.label }; };

  ui.chip = function (text, tone, icon) { return h('span', { class: 'chip' + (tone ? ' ' + tone : '') }, icon ? HC.icon(icon, 12) : null, text); };
  ui.note = function (text, tone) { return h('div', { class: 'note' + (tone ? ' ' + tone : '') }, text); };
  ui.button = function (label, onClick, opts) { opts = opts || {}; return h('button', { class: 'btn' + (opts.primary ? ' primary' : '') + (opts.sm ? ' sm' : '') + (opts.ghost ? ' ghost' : ''), type: 'button', onClick, id: opts.id, title: opts.title, disabled: opts.disabled }, opts.icon ? HC.icon(opts.icon, 14) : null, label); };
  ui.segmented = function (o) {
    const el = h('div', { class: 'segmented', role: 'group', 'aria-label': o.label, id: o.id });
    for (const opt of o.options) el.appendChild(h('button', { type: 'button', 'aria-pressed': String(opt.value === o.value), onClick: () => { for (const b of el.children) b.setAttribute('aria-pressed', 'false'); event.currentTarget.setAttribute('aria-pressed', 'true'); o.onChange(opt.value); } }, opt.label));
    return el;
  };
  ui.select = function (o) {
    const sel = h('select', { class: 'input', id: o.id, 'aria-label': o.label, onChange: e => o.onChange(e.target.value) });
    for (const opt of o.options) sel.appendChild(h('option', { value: opt.value, selected: opt.value === o.value }, opt.label));
    return o.inline ? sel : h('div', { class: 'field' }, o.label && !o.hideLabel ? h('label', { for: o.id }, o.label) : null, sel);
  };
  /** slider: {id,label,min,max,step,value,format,onInput(value),onChange(value),hint} */
  ui.slider = function (o) {
    const out = h('output', { for: o.id }, o.format(o.value));
    const input = h('input', { type: 'range', id: o.id, min: o.min, max: o.max, step: o.step, value: o.value, 'aria-label': o.label,
      onInput: e => { const v = Number(e.target.value); out.textContent = o.format(v); if (o.onInput) o.onInput(v); },
      onChange: e => { const v = Number(e.target.value); if (o.onChange) o.onChange(v); } });
    return h('div', { class: 'slider' }, h('label', { for: o.id }, o.label), out, input, o.hint ? h('div', { class: 'slider-hint' }, o.hint) : null);
  };
  ui.toggle = function (o) { return h('label', { class: 'toggle' }, h('input', { type: 'checkbox', id: o.id, checked: !!o.value, onChange: e => o.onChange(e.target.checked) }), o.label); };

  /** tabel: {columns:[{key,label,align:'num'|'text',format,class}], rows:[obj], caption, rowClass(row), footer: row} */
  ui.table = function (o) {
    const table = h('table', { class: 'data ' + (o.class || '') });
    table.appendChild(h('thead', null, h('tr', null, o.columns.map(c => h('th', { class: (c.align === 'num' ? 'num ' : '') + (c.class || ''), scope: 'col' }, c.label)))));
    const tbody = h('tbody');
    const renderRow = (row, extraClass) => {
      const tr = h('tr', { class: ((o.rowClass && o.rowClass(row)) || '') + ' ' + (extraClass || '') });
      for (const c of o.columns) {
        const raw = typeof c.value === 'function' ? c.value(row) : row[c.key];
        const txt = c.format ? c.format(raw, row) : (raw == null ? '' : raw);
        let cls = c.align === 'num' ? 'num' : (c.class || '');
        if (c.signColor && typeof raw === 'number' && raw !== 0) cls += raw > 0 ? ' pos' : ' neg';
        tr.appendChild(h('td', { class: cls }, txt instanceof Node ? txt : String(txt)));
      }
      return tr;
    };
    for (const row of o.rows) tbody.appendChild(renderRow(row));
    if (o.footer) tbody.appendChild(renderRow(o.footer, 'total'));
    table.appendChild(tbody);
    const wrap = h('div', { class: 'table-wrap' + (o.maxHeight ? ' scroll' : ''), style: o.maxHeight ? { maxHeight: typeof o.maxHeight === 'number' ? o.maxHeight + 'px' : o.maxHeight } : null }, table);
    if (!o.caption) return wrap;
    const cap = h('div', { class: 'table-caption' }, o.caption);
    return h('div', { class: 'table-block' }, cap, wrap);
  };

  /** figuur met chart/tabel-wissel: {title, subtitle, chart:{el, table()}, legend, note} */
  ui.figure = function (o) {
    const body = h('div', { class: 'figure-body' });
    const chartEl = o.chart.el || o.chart;
    body.appendChild(chartEl);
    let tableEl = null, showingTable = false;
    const swap = () => { if (showingTable && !tableEl) tableEl = o.chart.table(); HC.clear(body); body.appendChild(showingTable ? tableEl : chartEl); if (toggle) { toggle.lastChild.textContent = showingTable ? 'Grafiek' : 'Tabel'; toggle.setAttribute('aria-pressed', String(showingTable)); toggle.setAttribute('aria-label', (showingTable ? 'Toon grafiek' : 'Toon tabel') + (o.title ? ': ' + o.title : '')); } };
    const toggle = o.chart.table ? ui.button('Tabel', () => { showingTable = !showingTable; swap(); }, { sm: true, ghost: true, icon: 'table', title: 'Wissel tussen grafiek en tabel' }) : null;
    if (toggle && o.initial === 'table') { showingTable = true; swap(); }
    const legend = o.legend || (o.chart.legend ? o.chart.legend : null);
    return h('figure', { class: 'figure' },
      (o.title || toggle || legend) ? h('div', { class: 'figure-head' }, h('div', null, o.title ? h('div', { class: 'figure-title' }, o.title) : null, o.subtitle ? h('div', { class: 'figure-sub' }, o.subtitle) : null), h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } }, legend, toggle)) : null,
      body,
      o.note ? h('figcaption', { class: 'figure-sub' }, o.note) : null);
  };

  ui.empty = function (text) { return h('div', { class: 'note' }, text); };
  ui.statusChip = function (ok, okText, badText) { return ui.chip(ok ? okText : badText, ok ? 'good' : 'critical', ok ? 'check' : 'warn'); };

  // tooltip (singleton)
  const tipEl = () => document.getElementById('tooltip');
  ui.tooltip = {
    show(x, y, content) {
      const t = tipEl(); if (!t) return; HC.clear(t); append(t, content); t.hidden = false;
      const r = t.getBoundingClientRect(); const vw = window.innerWidth, vh = window.innerHeight;
      let left = x + 14, top = y + 14;
      if (left + r.width > vw - 8) left = x - r.width - 14; if (left < 8) left = 8;
      if (top + r.height > vh - 8) top = y - r.height - 14; if (top < 8) top = 8;
      t.style.left = left + 'px'; t.style.top = top + 'px';
    },
    hide() { const t = tipEl(); if (t) t.hidden = true; },
    /** rijen: {title, rows:[{key:color, label, value}]} */
    content(o) { return h('div', null, o.title ? h('div', { class: 'tt-title' }, o.title) : null, (o.rows || []).map(r => h('div', { class: 'tt-row' }, h('span', null, r.key ? h('i', { class: 'tt-key', style: { background: r.key } }) : null, r.label), h('span', { class: 'tt-val' }, r.value)))); }
  };

  // =====================================================================
  // Tabs & router
  // =====================================================================
  const tabs = HC.tabs = { list: [], current: null, _unsub: null, _root: null };
  tabs.register = function (t) { tabs.list.push(t); tabs.list.sort((a, b) => a.order - b.order); };
  tabs.get = function (id) { return tabs.list.find(t => t.id === id); };
  tabs.go = function (id, opts) {
    const t = tabs.get(id) || tabs.list[0]; if (!t) return;
    if (location.hash.slice(1) !== t.id) { try { history.replaceState(null, '', '#' + t.id); } catch (e) { location.hash = t.id; } }
    tabs.current = t.id;
    try { localStorage.setItem('hc.tab', t.id); } catch (e) { /* geen opslag */ }
    for (const a of document.querySelectorAll('#nav a, #tabstrip a')) a.setAttribute('aria-current', a.dataset.tab === t.id ? 'page' : 'false');
    if (tabs._unsub) { tabs._unsub(); tabs._unsub = null; }
    const root = tabs._root; HC.clear(root);
    const section = h('section', { class: 'tab', id: 'tab-' + t.id, 'aria-label': t.label });
    root.appendChild(section);
    const ctx = tabs.context();
    const subs = [];
    ctx.subscribe = fn => { subs.push(fn); };
    try { t.render(section, ctx); } catch (e) { console.error(e); section.appendChild(ui.note('Dit tabblad kon niet worden weergegeven: ' + e.message, 'critical')); }
    tabs._unsub = HC.state.subscribe(() => { const c = tabs.context(); for (const fn of subs) { try { fn(c); } catch (e) { console.error(e); } } });
    if (!opts || !opts.keepScroll) window.scrollTo({ top: 0 });
    document.title = t.label + ' · Helder CFO Cockpit';
  };
  tabs.context = function () { return { model, state: HC.state.get(), range: HC.state.range(), fmt, h, svg: HC.svg, ui, charts: window.HCharts, E, icon: HC.icon, caps: HC.caps }; };
  tabs.rerender = function () { if (tabs.current) tabs.go(tabs.current, { keepScroll: true }); };

  // runtime-capabilities (Claude-artifact): worden in main.js gevuld
  HC.caps = { sample: null, downloads: null, ready: false, listeners: [], onReady(fn) { if (HC.caps.ready) fn(HC.caps); else HC.caps.listeners.push(fn); } };

  // kleine helpers voor tabs
  HC.util = {
    seriesColor(i) { return 'var(--series-' + (((i - 1) % 7) + 1) + ')'; },
    lineColor(name) { return 'var(--series-' + (E.LINES.indexOf(name) + 1) + ')'; },
    channelColor(name) { return 'var(--series-' + (E.CHANNELS.indexOf(name) + 1) + ')'; },
    countryColor(name) { return 'var(--series-' + (E.COUNTRIES.indexOf(name) + 1) + ')'; },
    dimLabel(dim) { return { line: 'Productlijn', channel: 'Kanaal', country: 'Land' }[dim] || dim; },
    dimKeys(dim) { return { line: E.LINES, channel: E.CHANNELS, country: E.COUNTRIES }[dim]; },
    dimField(dim) { return { line: 'byLine', channel: 'byChannel', country: 'byCountry' }[dim]; },
    countryName(c) { return { NL: 'Nederland', DE: 'Duitsland', BE: 'België' }[c] || c; },
    assumptionMeta: {
      volumeGrowth: { label: 'Volumegroei per jaar', min: -0.25, max: 0.35, step: 0.005, format: v => fmt.signedPct(v, 1) },
      priceIndex: { label: 'Prijsindexatie per jaar', min: -0.05, max: 0.10, step: 0.0025, format: v => fmt.signedPct(v, 1) },
      materialIndex: { label: 'Materiaalkosten per eenheid, per jaar', min: -0.10, max: 0.20, step: 0.0025, format: v => fmt.signedPct(v, 1) },
      fteGrowth: { label: 'FTE-groei per jaar', min: -0.15, max: 0.25, step: 0.005, format: v => fmt.signedPct(v, 1) },
      wageIndex: { label: 'Loonindexatie per jaar', min: 0, max: 0.10, step: 0.0025, format: v => fmt.signedPct(v, 1) },
      marketingPct: { label: 'Marketing (% van omzet)', min: 0.01, max: 0.12, step: 0.001, format: v => fmt.pct(v, 1) },
      dso: { label: 'Debiteurentermijn (DSO)', min: 20, max: 90, step: 1, format: v => fmt.days(v) },
      dio: { label: 'Voorraaddagen (DIO)', min: 40, max: 160, step: 1, format: v => fmt.days(v) },
      dpo: { label: 'Crediteurentermijn (DPO)', min: 20, max: 90, step: 1, format: v => fmt.days(v) },
      capexPerYear: { label: 'Investeringen per jaar', min: 0, max: 15e6, step: 250000, format: v => fmt.eur(v) },
      dividendPct: { label: 'Dividend (% van winst vorig jaar)', min: 0, max: 1, step: 0.05, format: v => fmt.pct(v, 0) },
      leaseBoost: { label: 'Extra groei leasekanaal per jaar', min: -0.10, max: 0.40, step: 0.01, format: v => fmt.signedPct(v, 0) },
      deExpansion: { label: 'Duitse uitrol doorzetten', type: 'bool' }
    }
  };
})();
