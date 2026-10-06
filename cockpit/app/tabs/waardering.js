/*
 * Tab: Waardering — DCF op de forecast van het actieve scenario, met gevoeligheidsmatrix en multiples-cross-check.
 * Het besturingspaneel (WACC, eindgroei, normalisatie van de eindwaarde) wordt één keer per render gebouwd; de instellingen
 * leven buiten render() zodat ze een tabwissel binnen de sessie overleven. De resultaten herberekenen bij elke slider-beweging
 * én bij elke wijziging van de globale filters (scenario, overrides). Korrel en periode spelen geen rol: een DCF gebruikt
 * altijd de volledige forecasthorizon.
 */
(function () {
  'use strict';
  const H = window.HC;
  // ---- tab-lokale instellingen (bewust niet in HC.state; blijven staan bij een tabwissel) ----
  const S = { wacc: 0.09, growth: 0.02, normTv: false };
  const STEP_W = 0.0005;  // 0,05 pp: de berekende WACC uit de opbouw is dan een geldige sliderwaarde
  const STEP_G = 0.0025;  // 0,25 pp
  const WACCS = Array.from({ length: 9 }, (_, i) => Math.round((0.07 + i * 0.005) * 1e6) / 1e6);   // 7–11 %
  const GROWTHS = Array.from({ length: 5 }, (_, i) => Math.round((0.01 + i * 0.005) * 1e6) / 1e6); // 1–3 %
  const BASE_CELL = [4, 2]; // 9,0 % / 2,0 % — het midden van het raster
  // Fictieve beursgenoteerde peers (illustratieve multiples)
  const PEERS = [
    { name: 'Noorderwiel N.V.', profile: 'NL · premium e-bikes, dealers', multiple: 9.8 },
    { name: 'Velomobile Group', profile: 'BE/FR · lease en retail', multiple: 11.5 },
    { name: 'Rheinrad AG', profile: 'DE · fietsen en componenten', multiple: 7.5 },
    { name: 'Cyclus Holding', profile: 'NL · fietsenketen, service', multiple: 8.6 },
    { name: 'Pedalis Mobility plc', profile: 'UK · stedelijke mobiliteit', multiple: 10.2 }
  ];

  H.tabs.register({
    id: 'waardering', label: 'Waardering', short: 'Waardering', order: 60, icon: 'value',
    render(root, ctx) {
      const { model, fmt, h, svg, ui, charts, E } = ctx;
      const pct2 = v => fmt.num(v * 100, 2) + '%';
      const valDate = model.config.actualsUntil;
      const taxRate = model.config.taxRate;
      /** eurM zonder negatieve nul ("−€ 0,0M" bij −2k) — zie coreRequests */
      const eurM0 = v => v == null ? '' : fmt.eurM(Math.abs(v) < 5e4 ? 0 : v);

      // ---------- hulpfuncties ----------
      function median(arr) { const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
      /** ui.figure zonder de standaard browsermarge van <figure> (1em 40px) — index.html reset die niet; zie coreRequests */
      function figure(o) { const el = ui.figure(o); el.style.margin = '0'; return el; }
      function linear(d0, d1, r0, r1) { return v => r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); }
      function responsive(container, draw) {
        let last = 0;
        const render = () => { const w = Math.max(240, Math.floor(container.getBoundingClientRect().width || (container.parentElement && container.parentElement.getBoundingClientRect().width) || 600)); if (w === last) return; last = w; H.clear(container); container.appendChild(draw(w)); };
        if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => render()); ro.observe(container); } else window.addEventListener('resize', render);
        requestAnimationFrame(render); setTimeout(render, 0);
        return container;
      }
      /**
       * DCF van het engine, met optioneel een genormaliseerde eindwaarde: in het eindwaardejaar investeringen = afschrijvingen en
       * mutatie werkkapitaal = g × werkkapitaal ultimo (zie coreRequests: engine-optie). Zonder normalisatie identiek aan E.dcf.
       */
      function valuation(run, p) {
        const d = E.dcf(run, { wacc: p.wacc, terminalGrowth: p.growth });
        const rows = d.rows;
        const lastFull = rows.filter(r => r.months === 12).slice(-1)[0] || rows[rows.length - 1];
        const lastBs = run.months[run.months.length - 1].bs;
        const nwc = lastBs.ar + lastBs.inventory - lastBs.ap;
        const totalMonths = rows.reduce((s, r) => s + r.months, 0);
        const tvDf = Math.pow(1 + p.wacc, -(totalMonths / 12));
        const variant = fcff => {
          const tv = p.wacc > p.growth ? fcff * (1 + p.growth) / (p.wacc - p.growth) : NaN;
          const pvTv = tv * tvDf; const ev = d.pvExplicit + pvTv;
          return { fcff, tv, pvTv, ev, equityValue: ev - d.netDebt, tvShare: ev ? pvTv / ev : 0, valid: isFinite(tv) && tv > 0 && fcff > 0 };
        };
        const variants = { model: variant(lastFull.fcff), norm: variant(lastFull.nopat - p.growth * nwc) };
        const a = p.normTv ? variants.norm : variants.model;
        return Object.assign({}, d, {
          tv: a.tv, pvTv: a.pvTv, ev: a.ev, equityValue: a.equityValue, tvShare: a.tvShare,
          tvFcff: a.fcff, tvValid: a.valid, tvDf, nwc, totalMonths, tvYear: lastFull.year, lastFull, variants, normTv: !!p.normTv,
          evToEbitda: a.valid && a.ev > 0 && d.ltmEbitda > 0 ? a.ev / d.ltmEbitda : NaN
        });
      }
      /** 'football field': horizontale bandbreedtes op één gedeelde €-as, met (optioneel) een gestippelde marker voor de DCF-waarde */
      function footballField(o) {
        const rows = o.rows; const n = rows.length; const f = o.format || fmt.eur;
        const marker = o.marker && isFinite(o.marker.value) ? o.marker : null;
        const el = h('div', { class: 'chart' });
        const rangeTxt = r => f(r.min) + ' – ' + f(r.max);
        responsive(el, width => {
          const vals = rows.flatMap(r => [r.min, r.mid, r.max]).concat(marker ? [marker.value] : []).filter(v => isFinite(v));
          const t = charts.niceTicks(Math.min(0, ...vals), Math.max(...vals), 5);
          const pad = { l: 8, r: 8, t: 20, b: 24 };
          const W = width, x0 = pad.l, x1 = W - pad.r;
          // op smalle schermen botst de bandbreedtetekst met het rijlabel: zet hem dan onder de balk
          const stacked = rows.some(r => charts.measure(r.label) + charts.measure(rangeTxt(r)) + 16 > (x1 - x0));
          const rowH = stacked ? 62 : 48;
          const Hh = pad.t + n * rowH + pad.b, y0 = pad.t, y1 = Hh - pad.b;
          const sx = linear(t.lo, t.hi, x0, x1);
          const rootEl = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': 'Bandbreedtes van de waardering per methode' });
          const g = svg('g', { class: 'grid' });
          t.ticks.forEach((v, k) => { g.appendChild(svg('line', { x1: sx(v), x2: sx(v), y1: y0, y2: y1 })); rootEl.appendChild(svg('text', { class: 'axis-label', x: sx(v), y: Hh - 6, 'text-anchor': k === 0 ? 'start' : k === t.ticks.length - 1 ? 'end' : 'middle' }, f(v))); });
          rootEl.appendChild(g);
          rootEl.appendChild(svg('line', { class: 'baseline', x1: sx(0), x2: sx(0), y1: y0, y2: y1 }));
          rows.forEach((r, i) => {
            const top = y0 + i * rowH;
            rootEl.appendChild(svg('text', { class: 'dlabel strong', x: x0, y: top + 12 }, r.label));
            rootEl.appendChild(svg('text', { class: 'dlabel', x: x1, y: stacked ? top + 50 : top + 12, 'text-anchor': 'end' }, rangeTxt(r)));
            const xa = sx(Math.min(r.min, r.max)), xb = sx(Math.max(r.min, r.max));
            const bar = svg('rect', { class: 'mark', x: xa, y: top + 19, width: Math.max(2, xb - xa), height: 14, rx: 4, fill: 'var(--series-1)', tabindex: '0', role: 'img',
              'aria-label': r.label + ': ' + rangeTxt(r) + (isFinite(r.mid) ? ', midden ' + f(r.mid) + (r.midLabel ? ' (' + r.midLabel + ')' : '') : '') });
            const tip = e => ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: r.label, rows: [{ label: 'Laag', value: f(r.min) }, { label: r.midLabel ? 'Midden (' + r.midLabel + ')' : 'Midden', value: f(r.mid) }, { label: 'Hoog', value: f(r.max) }] }));
            bar.addEventListener('pointerenter', tip); bar.addEventListener('pointermove', tip); bar.addEventListener('pointerleave', () => ui.tooltip.hide());
            bar.addEventListener('focus', () => { const rc = bar.getBoundingClientRect(); tip({ clientX: rc.left + rc.width / 2, clientY: rc.top }); }); bar.addEventListener('blur', () => ui.tooltip.hide());
            rootEl.appendChild(bar);
            if (isFinite(r.mid)) rootEl.appendChild(svg('line', { x1: sx(r.mid), x2: sx(r.mid), y1: top + 16, y2: top + 36, stroke: 'var(--ink-2)', 'stroke-width': 2, 'pointer-events': 'none' }));
          });
          if (marker) {
            // marker: DCF-waarde, per rij alleen over de balkband getekend zodat hij nooit door een rijlabel loopt
            const mx = sx(marker.value);
            rows.forEach((r, i) => { const top = y0 + i * rowH; rootEl.appendChild(svg('line', { x1: mx, x2: mx, y1: top + 14, y2: top + 38, stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' })); });
            rootEl.appendChild(svg('line', { x1: mx, x2: mx, y1: y0 - 4, y2: y0 + 2, stroke: 'var(--ink)', 'stroke-width': 1.5, 'pointer-events': 'none' }));
            const mlab = marker.label; const mw = charts.measure(mlab);
            rootEl.appendChild(svg('text', { class: 'ann-text', x: mx + mw + 6 > x1 ? mx - 5 : mx + 5, y: y0 - 8, 'text-anchor': mx + mw + 6 > x1 ? 'end' : 'start', fill: 'var(--ink)' }, mlab));
          }
          return rootEl;
        });
        return {
          el,
          legend: charts.legend([{ name: 'Laag–hoog', color: 'var(--series-1)', kind: 'rect' }, { name: 'Midden', color: 'var(--ink-2)', kind: 'line' }].concat(marker ? [{ name: marker.legend || 'DCF-waarde', color: 'var(--ink)', kind: 'dashed' }] : [])),
          table: () => ui.table({ columns: [{ key: 'label', label: 'Methode', class: 'label' }, { key: 'min', label: 'Laag', align: 'num', format: f }, { key: 'mid', label: 'Midden', align: 'num', format: f }, { key: 'max', label: 'Hoog', align: 'num', format: f }, { key: 'midLabel', label: 'Midden is', class: 'label' }], rows,
            footer: marker ? { label: marker.legend || 'DCF-waarde', mid: marker.value, midLabel: 'huidige instelling' } : null })
        };
      }

      // ---------- pagina-kop (eenmalig) ----------
      const headChips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      root.appendChild(h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Waardering'), h('p', null, `DCF op basis van de vrije kasstroom (FCFF) uit het actieve scenario; eindwaarde volgens het Gordon-groeimodel; waardering per ultimo ${fmt.monthLong(valDate)}.`)),
        headChips));
      const grid = h('div', { class: 'grid' }); root.appendChild(grid);

      // ---------- raster: samenvatting eerst (regel 5), dan paneel + brug, FCFF-tabel, gevoeligheid + multiples, toelichting ----------
      const host = span => h('div', { class: 'span-' + span, style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } });
      const kpiRow = h('div', { class: 'kpi-row span-12' });
      const topHost = host(8), fcffHost = host(12), sensHost = host(6), multHost = host(6), explHost = host(12);
      grid.appendChild(kpiRow);

      // ---------- besturingspaneel (eenmalig gebouwd) ----------
      const panel = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
      const waccSl = ui.slider({ id: 'val-wacc', label: 'WACC', min: 0.06, max: 0.14, step: STEP_W, value: S.wacc, format: pct2, onInput: v => { S.wacc = v; build(); }, hint: 'gewogen gemiddelde vermogenskostenvoet · stap 0,05 pp' });
      const gSl = ui.slider({ id: 'val-g', label: 'Eindgroei', min: 0, max: 0.04, step: STEP_G, value: S.growth, format: pct2, onInput: v => { S.growth = v; build(); }, hint: 'eeuwigdurende groei van de FCFF na het laatste forecastjaar (Gordon-groeimodel) · stap 0,25 pp' });
      const normTg = ui.toggle({ id: 'val-norm', label: 'Genormaliseerde eindwaarde', value: S.normTv, onChange: v => { S.normTv = v; build(); } });
      const waccInput = waccSl.querySelector('input'), waccOut = waccSl.querySelector('output');
      panel.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div', { class: 'eyebrow' }, 'Disconteringsparameters'), waccSl, gSl, normTg,
        h('div', { class: 'small muted' }, 'in het eindwaardejaar: investeringen = afschrijvingen en mutatie werkkapitaal = eindgroei × werkkapitaal ultimo')));

      // WACC-opbouw (illustratief): CAPM voor eigen vermogen, kostenvoet vreemd vermogen na belasting, doelstructuur 25 % schuld
      const B = { rf: 0.027, beta: 1.2, mrp: 0.055, kd: model.config.termLoanRate, tax: taxRate, debtShare: 0.25 };
      const ke = B.rf + B.beta * B.mrp; const kdAfter = B.kd * (1 - B.tax);
      const waccCalc = (1 - B.debtShare) * ke + B.debtShare * kdAfter;
      const waccSnap = Math.round(Math.round(waccCalc / STEP_W) * STEP_W * 1e6) / 1e6;
      const snapNote = pct2(waccSnap) !== pct2(waccCalc) ? 'afgerond op de sliderstap: ' + pct2(waccSnap) : null;
      const d0 = valuation(model.run(Object.assign({}, E.defaultAssumptions(), model.scenarios.basis.assumptions)), { wacc: WACCS[BASE_CELL[0]], growth: GROWTHS[BASE_CELL[1]] });
      const buildRows = [
        { c: 'Risicovrije rente (10-jaars staatsobligatie)', v: pct2(B.rf) },
        { c: 'Bèta (relevered naar ' + fmt.pct(B.debtShare, 0) + ' schuld)', v: fmt.num(B.beta, 2) },
        { c: 'Marktrisicopremie', v: pct2(B.mrp) },
        { c: 'Kosten eigen vermogen (CAPM)', v: pct2(ke), key: true },
        { c: 'Kosten vreemd vermogen vóór belasting (termijnlening uit het model)', v: pct2(B.kd) },
        { c: 'VPB-tarief (uit het model)', v: fmt.pct(B.tax, 1) },
        { c: 'Kosten vreemd vermogen na belasting', v: pct2(kdAfter), key: true },
        { c: 'Aandeel vreemd vermogen (doelkapitaalstructuur)', v: fmt.pct(B.debtShare, 0) }
      ];
      const buildTbl = ui.table({ columns: [{ key: 'c', label: 'Component', class: 'label' }, { key: 'v', label: 'Waarde', align: 'num' }], rows: buildRows, rowClass: r => r.key ? 'sub' : '', footer: { c: 'WACC (berekend)', v: pct2(waccCalc) } });
      const applyBtn = ui.button('Gebruik berekende WACC (' + pct2(waccSnap) + ')', () => {
        waccInput.value = String(waccSnap); const v = Number(waccInput.value);
        S.wacc = v; waccOut.textContent = pct2(v); build();
      }, { sm: true, icon: 'check', id: 'val-apply' });
      panel.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { class: 'eyebrow' }, 'WACC-opbouw (illustratief)'), buildTbl,
        h('div', { class: 'small muted' }, 'Zonder size- of illiquiditeitsopslag. Feitelijke nettoschuld per ' + fmt.month(valDate) + ': ' + fmt.eur(d0.netDebt) + ', circa ' + fmt.pct(d0.netDebt / d0.ev, 1) + ' van de EV in het basisscenario; de ' + fmt.pct(B.debtShare, 0) + ' is een doelstructuur, feitelijk is Helder vrijwel schuldenvrij.'),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, applyBtn, snapNote ? h('span', { class: 'small muted' }, snapNote) : null)));
      panel.appendChild(ui.note('De sliders en de schakelaar bepalen wat in alle resultaten op dit tabblad wordt doorgerekend.'));
      grid.appendChild(ui.card({ span: 4, title: 'Disconteringsvoet en eindgroei', subtitle: 'instellingen van dit tabblad · korrel en periode zijn hier niet van invloed', body: panel }));
      grid.appendChild(topHost); grid.appendChild(fcffHost); grid.appendChild(sensHost); grid.appendChild(multHost); grid.appendChild(explHost);

      function build() {
        const t0 = performance.now();
        const s = H.state.get(); const sc = model.scenarios[s.scenarioKey] || model.scenarios.basis;
        const custom = Object.keys(s.overrides || {}).length > 0;
        const run = model.run();
        const p = { wacc: S.wacc, growth: S.growth, normTv: S.normTv };
        const d = valuation(run, p);
        const eqGrid = WACCS.map(w => GROWTHS.map(g => valuation(run, { wacc: w, growth: g, normTv: S.normTv }).equityValue));
        const years = E.aggregate(run.months, 'Y'); const y27 = years.find(y => y.year === 2027);
        const yTv = years.find(y => y.year === d.tvYear), yPrev = years.find(y => y.year === d.tvYear - 1);
        const revG = yTv && yPrev && yPrev.pl.revenue > 0 ? yTv.pl.revenue / yPrev.pl.revenue - 1 : NaN;
        const ebitda27 = y27 ? y27.pl.ebitda : NaN;
        const tvValid = d.tvValid; const tvYear = String(d.tvYear); const V = d.variants; const lf = d.lastFull;
        const ev27x = tvValid && d.ev > 0 && ebitda27 > 0 ? d.ev / ebitda27 : NaN;
        const isBasis = s.scenarioKey === 'basis' && !custom;
        const baseD = isBasis ? null : valuation(model.run(Object.assign({}, E.defaultAssumptions(), model.scenarios.basis.assumptions)), p);
        const ri = WACCS.findIndex(w => Math.abs(w - S.wacc) < 1e-9), ci = GROWTHS.findIndex(g => Math.abs(g - S.growth) < 1e-9);
        const baseCell = ri >= 0 && ci >= 0 ? [ri, ci] : null;
        const isDebt = d.netDebt >= 0;
        const explStart = E.addMonths(valDate, 1), explEnd = run.periods[run.periods.length - 1];
        const explLabel = fmt.monthLong(explStart) + ' t/m ' + fmt.monthLong(explEnd);
        const tvYears = fmt.num(d.totalMonths / 12, 2);

        // kop-chips
        H.clear(headChips);
        headChips.appendChild(ui.chip('Balans per ' + fmt.month(valDate), 'actual'));
        headChips.appendChild(ui.chip('Forecast: ' + sc.label, 'forecast'));
        if (custom) headChips.appendChild(ui.chip(Object.keys(s.overrides).length + ' driver(s) aangepast', 'accent'));
        if (S.normTv) headChips.appendChild(ui.chip('Genormaliseerde eindwaarde', 'accent'));

        H.clear(kpiRow); H.clear(topHost); H.clear(fcffHost); H.clear(sensHost); H.clear(multHost); H.clear(explHost);
        // ---------- KPI's (bovenaan, over de volle breedte) ----------
        const dl = (cur, base) => baseD ? ui.delta(cur, base, { label: 'vs. basisscenario' }) : null;
        kpiRow.appendChild(ui.kpi({ label: 'Ondernemingswaarde (EV)', value: fmt.eurM(d.ev), delta: dl(d.ev, baseD && baseD.ev), hint: 'WACC ' + pct2(S.wacc) + ' · eindgroei ' + pct2(S.growth) + (S.normTv ? ' · genormaliseerd' : '') + (tvValid ? '' : ' · niet betekenisvol') }));
        kpiRow.appendChild(ui.kpi({ label: isDebt ? 'Nettoschuld' : 'Nettokas', value: fmt.eur(Math.abs(d.netDebt)), hint: 'termijnlening + RCF − kas per ' + fmt.month(valDate) }));
        kpiRow.appendChild(ui.kpi({ label: 'Waarde eigen vermogen', value: fmt.eurM(d.equityValue), delta: dl(d.equityValue, baseD && baseD.equityValue), hint: isDebt ? 'EV − nettoschuld' : 'EV + nettokas' }));
        kpiRow.appendChild(ui.kpi({ label: 'Impliciete EV/EBITDA LTM', value: fmt.x(d.evToEbitda, 1), hint: 'LTM EBITDA ' + fmt.eurM(d.ltmEbitda) + ' t/m ' + fmt.month(valDate) }));
        kpiRow.appendChild(ui.kpi({ label: 'Aandeel eindwaarde in EV', value: tvValid ? fmt.pct(d.tvShare, 0) : '–', hint: tvValid ? 'PV eindwaarde ' + fmt.eurM(d.pvTv) + ' van ' + fmt.eurM(d.ev) : 'eindwaarde niet betekenisvol' }));
        kpiRow.appendChild(ui.kpi({ label: 'Impliciete EV/EBITDA 2027', value: fmt.x(ev27x, 1), hint: 'EBITDA 2027 ' + fmt.eurM(ebitda27) + ' (forecast)' + (ebitda27 > 0 ? '' : ' · negatief: geen multiple') }));

        // ---------- eindwaarde-signaal ----------
        topHost.appendChild(!tvValid
          ? ui.note('Eindwaarde niet betekenisvol: de FCFF waarop de eindwaarde rust (' + (S.normTv ? 'genormaliseerd, ' : '') + tvYear + ') is ' + fmt.eurM(d.tvFcff) + '; het Gordon-groeimodel vereist een positieve, stabiele kasstroom. Ondernemingswaarde, waarde eigen vermogen en de multiples hieronder zijn niet bruikbaar.', 'critical')
          : d.tvShare > 0.85
            ? ui.note(fmt.pct(d.tvShare, 0) + ' van de ondernemingswaarde zit in de eindwaarde: bij deze combinatie van WACC en eindgroei is de waardering vooral een uitspraak over de periode ná ' + tvYear + ', niet over de forecast zelf.', 'warning')
            : ui.note('De eindwaarde is ' + fmt.pct(d.tvShare, 0) + ' van de ondernemingswaarde; de expliciete periode (' + explLabel + ') draagt ' + fmt.eurM(d.pvExplicit) + ' bij.', 'accent'));

        // ---------- eindwaarde: model versus genormaliseerd ----------
        const cmpRows = [
          { label: 'FCFF ' + tvYear + ' uit het model', fcff: V.model.fcff, tv: V.model.tv, ev: V.model.ev, active: !S.normTv },
          { label: 'Genormaliseerd', fcff: V.norm.fcff, tv: V.norm.tv, ev: V.norm.ev, active: S.normTv }
        ];
        const cmpTbl = ui.table({ columns: [
          { key: 'label', label: 'Basis van de eindwaarde', class: 'label', format: (v, r) => r.active ? h('strong', null, v) : v },
          { key: 'fcff', label: 'FCFF eindwaarde', align: 'num', format: eurM0 }, { key: 'tv', label: 'Eindwaarde ' + tvYear, align: 'num', format: eurM0 }, { key: 'ev', label: 'EV', align: 'num', format: eurM0 }
        ], rows: cmpRows });
        const evDiff = V.norm.ev - V.model.ev;
        topHost.appendChild(ui.card({ title: 'Eindwaarde: model versus genormaliseerd',
          subtitle: 'in ' + tvYear + ': investeringen ' + fmt.eurM(lf.capex) + ' tegenover afschrijvingen ' + fmt.eurM(lf.dep) + ' · werkkapitaal' + (lf.dNwc >= 0 ? 'opbouw ' : 'vrijval ') + fmt.eurM(Math.abs(lf.dNwc)) + ' bij ' + fmt.signedPct(revG, 1) + ' omzetgroei',
          body: cmpTbl,
          footer: 'Genormaliseerd: investeringen = afschrijvingen (' + fmt.eurM(lf.dep) + '), mutatie werkkapitaal = ' + pct2(S.growth) + ' × ' + fmt.eurM(d.nwc) + ' werkkapitaal = ' + fmt.eurM(S.growth * d.nwc) + '. Verschil in ondernemingswaarde: ' + fmt.signed(evDiff, fmt.eurM) + (V.model.ev > 0 ? ' (' + fmt.signedPct(evDiff / V.model.ev, 1) + ')' : '') + ' · vet = actieve variant (schakelaar in het paneel).' }));

        // ---------- waterval ----------
        // vijf staven in een smalle kolom (mobiel): kortere categorielabels; de bedragen houden het compacte €-formaat
        const narrow = topHost.getBoundingClientRect().width < 520;
        const wf = charts.waterfall({ steps: [
          { label: narrow ? 'PV expliciet' : 'PV expliciete periode', value: d.pvExplicit, type: 'total' },
          { label: narrow ? 'PV eindw.' : 'PV eindwaarde', value: d.pvTv, type: 'delta' },
          { label: narrow ? 'EV' : 'Ondernemingswaarde', value: d.ev, type: 'total' },
          { label: isDebt ? (narrow ? 'Schuld' : 'Nettoschuld') : (narrow ? 'Kas' : 'Nettokas'), value: -d.netDebt, type: 'delta' },
          { label: narrow ? 'Eigen verm.' : 'Waarde eigen vermogen', value: d.equityValue, type: 'total' }
        ], yFormat: fmt.eur, height: 270 });
        topHost.appendChild(ui.card({ title: 'Van kasstromen naar aandeelhouderswaarde', subtitle: 'contante waarden per ultimo ' + fmt.monthLong(valDate) + ' · scenario ' + sc.label.toLowerCase(), body: figure({ chart: wf }) }));

        // ---------- FCFF-tabel ----------
        let elapsed = 0;
        const fcffRows = d.rows.map(r => {
          const start = E.addMonths(valDate, 1 + elapsed); const end = E.addMonths(start, r.months - 1); elapsed += r.months;
          return { label: r.months === 12 ? String(r.year) : r.year + ' (' + fmt.monthShort(start) + '–' + fmt.monthShort(end) + ')', ebitda: r.ebitda, ebit: r.ebit, nopat: r.nopat, dep: r.dep, capex: -r.capex, dNwc: -r.dNwc, fcff: r.fcff, df: r.df, pv: r.pv };
        });
        fcffRows.push({ label: 'Eindwaarde ultimo ' + tvYear + (S.normTv ? ' (genormaliseerd)' : ''), fcff: d.tv, df: d.tvDf, pv: d.pvTv, isTv: true });
        const formula = h('p', { class: 'small muted', style: { margin: '0' } },
          'NOPAT = EBIT × (1 − ' + fmt.pct(taxRate, 1) + ') · FCFF = NOPAT + afschrijvingen + investeringen + mutatie werkkapitaal (kolommen met teken: investeringen en werkkapitaalopbouw negatief, vrijval positief) · eindwaarde = FCFF ' + tvYear + (S.normTv ? ' genormaliseerd' : '') + ' × (1 + g) / (WACC − g), gedisconteerd per ultimo ' + tvYear + ' (' + tvYears + ' jaar).');
        const fcffTbl = ui.table({ class: 'statement', columns: [
          { key: 'label', label: 'Jaar', class: 'label' },
          { key: 'ebitda', label: 'EBITDA', align: 'num', format: eurM0 }, { key: 'ebit', label: 'EBIT', align: 'num', format: eurM0 }, { key: 'nopat', label: 'NOPAT', align: 'num', format: eurM0 },
          { key: 'dep', label: 'Afschrijvingen', align: 'num', format: eurM0 }, { key: 'capex', label: 'Investeringen', align: 'num', format: eurM0 }, { key: 'dNwc', label: 'Mutatie werkkapitaal', align: 'num', format: eurM0 },
          { key: 'fcff', label: 'FCFF', align: 'num', format: eurM0 }, { key: 'df', label: 'Disconteringsfactor', align: 'num', format: v => v == null ? '' : fmt.num(v, 2) }, { key: 'pv', label: 'Contante waarde', align: 'num', format: eurM0 }
        ], rows: fcffRows, rowClass: r => r.isTv ? 'key' : 'forecast', footer: { label: 'Ondernemingswaarde', pv: d.ev } });
        fcffHost.appendChild(ui.card({ title: 'Vrije kasstroom per jaar en contante waarde', subtitle: 'expliciete periode ' + explLabel + ' · jaren mid-year gedisconteerd, eindwaarde per ultimo ' + tvYear, body: [formula, fcffTbl],
          footer: 'Werkkapitaal = debiteuren + voorraad − crediteuren; een opbouw legt kas vast (negatief), een vrijval levert kas op (positief). Investeringen volgens de driver "Investeringen per jaar" van het scenario.' }));

        // ---------- gevoeligheid ----------
        // smalle kolom (mobiel): vijf kolommen "€ 191,5M" passen niet in 342 px; dan bedragen in € mln zonder valutateken
        const narrowSens = sensHost.getBoundingClientRect().width < 420;
        const heat = charts.heatTable({ corner: 'WACC', rows: WACCS.map(w => fmt.pct(w, 1)), cols: GROWTHS.map(g => fmt.pct(g, 1)), values: eqGrid, format: narrowSens ? v => fmt.num(v / 1e6, 0) : fmt.eurM, base: baseCell,
          caption: 'Waarde eigen vermogen' + (narrowSens ? ' in € mln' : '') + ' per WACC (rijen) en eindgroei (kolommen)' + (S.normTv ? ', genormaliseerde eindwaarde' : '') + '; huidige instelling ' + pct2(S.wacc) + ' / ' + pct2(S.growth) });
        const flat = eqGrid.flat(); const gridMin = Math.min(...flat), gridMax = Math.max(...flat);
        const ref = baseCell && baseCell[0] >= 2 && baseCell[1] <= GROWTHS.length - 3 ? baseCell : BASE_CELL;
        const refV = eqGrid[ref[0]][ref[1]]; const dW = eqGrid[ref[0] - 2][ref[1]] - refV; const dG = eqGrid[ref[0]][ref[1] + 2] - refV;
        const sensNote = 'Bandbreedte ' + fmt.eurM(gridMin) + ' – ' + fmt.eurM(gridMax) + '. Vanuit ' + pct2(WACCS[ref[0]]) + ' / ' + pct2(GROWTHS[ref[1]]) + ': 1 pp lagere WACC ' + fmt.signed(dW, fmt.eurM) + ', 1 pp hogere eindgroei ' + fmt.signed(dG, fmt.eurM) + '. '
          + (Math.abs(dW) >= Math.abs(dG) ? 'De WACC weegt zwaarder omdat hij ook de disconteringsfactoren van de expliciete periode en van de eindwaarde bepaalt; de eindgroei zit alleen in de eindwaarde.' : 'De eindgroei weegt hier zwaarder: zo dicht bij de WACC wordt de noemer van het Gordon-groeimodel klein.');
        sensHost.appendChild(ui.card({ title: 'Gevoeligheid van de waarde van het eigen vermogen', subtitle: 'WACC 7–11% in stappen van 0,5 pp, eindgroei 1–3% in stappen van 0,5 pp · ' + (baseCell ? 'omlijnde cel = huidige instelling' : 'huidige instelling (' + pct2(S.wacc) + ' / ' + pct2(S.growth) + ') valt tussen de rasterwaarden'),
          body: figure({ chart: heat, note: sensNote }),
          footer: WACCS.length * GROWTHS.length + ' DCF-berekeningen in ' + Math.max(1, Math.round(performance.now() - t0)) + ' ms.' }));

        // ---------- multiples-cross-check ----------
        const mults = PEERS.map(x => x.multiple); const mMin = Math.min(...mults), mMax = Math.max(...mults), mMed = median(mults);
        const ltm = d.ltmEbitda;
        const band = e => ({ lo: Math.min(mMin * e, mMax * e), mid: mMed * e, hi: Math.max(mMin * e, mMax * e) });
        const bLtm = band(ltm); const has27 = ebitda27 > 0; const b27 = has27 ? band(ebitda27) : null;
        const peersTbl = ui.table({ columns: [{ key: 'name', label: 'Peer (fictief)' }, { key: 'profile', label: 'Profiel', class: 'label' }, { key: 'multiple', label: 'EV/EBITDA', align: 'num', format: v => fmt.x(v, 1) }], rows: PEERS.slice().sort((a, b) => b.multiple - a.multiple), footer: { name: 'Mediaan', profile: 'laagste ' + fmt.x(mMin, 1) + ' · hoogste ' + fmt.x(mMax, 1), multiple: mMed } });
        const xRows = [
          { label: 'EV/EBITDA peers', lo: mMin, mid: mMed, hi: mMax, f: v => fmt.x(v, 1) },
          Object.assign({ label: 'Impliciete EV op LTM EBITDA (' + fmt.eurM(ltm) + ')', f: fmt.eurM }, bLtm),
          has27 ? Object.assign({ label: 'Impliciete EV op EBITDA 2027 (' + fmt.eurM(ebitda27) + ')', f: fmt.eurM }, b27)
            : { label: 'EBITDA 2027 (' + fmt.eurM(ebitda27) + ') is negatief: geen multiple', lo: null, mid: null, hi: null, f: () => '–' }
        ];
        const xTbl = ui.table({ columns: [{ key: 'label', label: 'Maatstaf', class: 'label' }, { key: 'lo', label: 'Laag', align: 'num', format: (v, r) => r.f(v) }, { key: 'mid', label: 'Mediaan', align: 'num', format: (v, r) => r.f(v) }, { key: 'hi', label: 'Hoog', align: 'num', format: (v, r) => r.f(v) }], rows: xRows });
        const ffRows = [];
        if (tvValid) ffRows.push({ label: 'DCF (WACC 7–11%, g 1–3%)', min: gridMin + d.netDebt, mid: eqGrid[BASE_CELL[0]][BASE_CELL[1]] + d.netDebt, max: gridMax + d.netDebt, midLabel: 'WACC ' + pct2(WACCS[BASE_CELL[0]]) + ' / g ' + pct2(GROWTHS[BASE_CELL[1]]) });
        ffRows.push({ label: 'Peers × LTM EBITDA', min: bLtm.lo, mid: bLtm.mid, max: bLtm.hi, midLabel: 'mediaan peers' });
        if (has27) ffRows.push({ label: 'Peers × EBITDA 2027', min: b27.lo, mid: b27.mid, max: b27.hi, midLabel: 'mediaan peers' });
        const ff = footballField({ rows: ffRows, marker: tvValid ? { value: d.ev, label: 'DCF ' + fmt.eurM(d.ev), legend: 'DCF bij huidige instelling (EV)' } : null, format: fmt.eur });
        const pos = (x, lo, hi) => !isFinite(x) ? null : x > hi ? 'boven' : x < lo ? 'onder' : 'binnen';
        let readOut;
        if (!tvValid || !isFinite(d.evToEbitda)) readOut = 'Zonder betekenisvolle DCF-waarde is er geen vergelijking met de peers mogelijk; pas het scenario of de disconteringsparameters aan.';
        else {
          readOut = 'De DCF impliceert ' + fmt.x(d.evToEbitda, 1) + ' LTM EBITDA, ' + pos(d.evToEbitda, mMin, mMax) + ' de bandbreedte van de peers (' + fmt.x(mMin, 1) + '–' + fmt.x(mMax, 1) + ')'
            + (isFinite(ev27x) ? '; op EBITDA 2027 is dat ' + fmt.x(ev27x, 1) + ', ' + pos(ev27x, mMin, mMax) + ' die bandbreedte. ' : '; op EBITDA 2027 (' + fmt.eurM(ebitda27) + ') is geen multiple af te leiden. ')
            + (d.evToEbitda > mMax ? 'Het verschil is de groei die het scenario in de forecast veronderstelt: wie de DCF gelooft, betaalt vandaag voor de EBITDA van 2027 en later.'
              : d.evToEbitda < mMin ? 'De markt zou op de huidige EBITDA meer betalen dan de kasstromen van dit scenario rechtvaardigen: de peers verdisconteren een herstel dat in deze forecast ontbreekt.'
                : 'De DCF en de multiples wijzen in dezelfde richting; het resterende verschil zit in de groeiveronderstelling van het scenario.');
        }
        multHost.appendChild(ui.card({ title: 'Cross-check met multiples van beursgenoteerde peers', subtitle: 'ondernemingswaarde per methode op één as' + (tvValid ? ' · marker = DCF bij de huidige instelling' : ' · geen DCF-rij: eindwaarde niet betekenisvol'),
          body: [figure({ chart: ff, note: readOut }), h('div', { class: 'eyebrow' }, 'Peers'), peersTbl, h('div', { class: 'eyebrow' }, 'Impliciete ondernemingswaarde Helder'), xTbl],
          footer: tvValid ? 'De DCF-bandbreedte is de gevoeligheidsmatrix (WACC 7–11%, g 1–3%) plus de nettoschuld (' + fmt.eur(d.netDebt) + ').' : 'De DCF-rij ontbreekt zolang de eindwaarde niet betekenisvol is.' }));

        // ---------- toelichting (data-gedreven, volgt het actieve scenario) ----------
        const capexTxt = lf.capex < lf.dep - 1 ? 'liggen de investeringen (' + fmt.eurM(lf.capex) + ', de vlakke driver van het scenario) onder de afschrijvingen (' + fmt.eurM(lf.dep) + ') – dat flatteert de eindwaarde'
          : lf.capex > lf.dep + 1 ? 'liggen de investeringen (' + fmt.eurM(lf.capex) + ') boven de afschrijvingen (' + fmt.eurM(lf.dep) + ') – dat drukt de eindwaarde'
            : 'zijn investeringen en afschrijvingen (' + fmt.eurM(lf.dep) + ') in evenwicht';
        const nwcTxt = lf.dNwc > 1 ? 'de werkkapitaalopbouw (' + fmt.eurM(-lf.dNwc) + ') hoort bij ' + fmt.signedPct(revG, 1) + ' omzetgroei, niet bij ' + pct2(S.growth) + ' eeuwigdurende groei'
          : lf.dNwc < -1 ? 'de werkkapitaalvrijval (' + fmt.signed(-lf.dNwc, fmt.eurM) + ') hoort bij ' + fmt.signedPct(revG, 1) + ' omzetontwikkeling en gaat niet eeuwig door'
            : 'het werkkapitaal in dat jaar vrijwel stabiel is';
        const expl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '90ch' } },
          h('p', null, 'De waardering is een directe functie van het scenario: elke driver op het tabblad ', h('a', { href: '#scenario' }, "Scenario's"), ' (volumegroei, prijsindexatie, materiaalkosten, werkkapitaaldagen, investeringen) verandert de FCFF per jaar en daarmee de contante waarde die hier wordt getoond. Omdat de eindwaarde wordt afgeleid van de FCFF van ' + tvYear + ', werkt een hogere EBITDA-marge in het laatste forecastjaar meer dan evenredig door in de ondernemingswaarde; een recessiescenario doet het omgekeerde.'),
          h('p', null, 'Drie kanttekeningen. (1) De expliciete periode is kort (' + explLabel + '), waardoor het grootste deel van de waarde in de eindwaarde zit en de keuze van WACC en eindgroei zwaarder weegt dan de forecast zelf. (2) De eindwaarde veronderstelt dat de FCFF van ' + tvYear + ' een stabiele toestand weergeeft, en dat is hij niet vanzelf: in ' + tvYear + ' ' + capexTxt + ', terwijl ' + nwcTxt + '; er is geen fade-periode. Genormaliseerd (investeringen = afschrijvingen, mutatie werkkapitaal = ' + pct2(S.growth) + ' × ' + fmt.eurM(d.nwc) + ' werkkapitaal) is de FCFF voor de eindwaarde ' + fmt.eurM(V.norm.fcff) + ' in plaats van ' + fmt.eurM(V.model.fcff) + '; de schakelaar in het paneel rekent daarmee door. (3) De expliciete jaren worden mid-year gedisconteerd (elk jaar halverwege, het gebroken eerste jaar naar rato), maar de eindwaarde wordt per ultimo ' + tvYear + ' gedisconteerd (' + tvYears + ' jaar), niet mid-year – bij de huidige WACC circa ' + fmt.pct(Math.sqrt(1 + S.wacc) - 1, 1) + ' conservatiever dan de strikte mid-year-variant. De belasting in de FCFF is ' + fmt.pct(taxRate, 1) + ' van EBIT, zonder de verliesverrekening die het model in de winst-en-verliesrekening wél toepast.'),
          h('p', { class: 'small muted' }, 'De nettoschuld is de stand per de waarderingsdatum (termijnlening plus rekening-courantkrediet minus kas); latente belastingposities, leaseverplichtingen en overtollige kas zijn niet apart gewaardeerd. Helder E-Bikes en de genoemde peers zijn fictief.'));
        explHost.appendChild(ui.card({ title: 'Hoe deze waardering beweegt', subtitle: 'en wat u er niet uit mag lezen', body: expl }));
      }
      build();
      ctx.subscribe(build);
    }
  });
})();
