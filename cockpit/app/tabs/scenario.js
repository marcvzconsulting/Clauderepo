/* Tab: Scenario's — driver-based forecast met live sliders. Paginakop en besturingspaneel worden één keer gebouwd; de samenvatting (KPI-rij + convenantnoot) en de resultaten herberekenen bij elke beweging. */
(function () {
  'use strict';
  const H = window.HC;
  H.tabs.register({
    id: 'scenario', label: "Scenario's", short: "Scenario's", order: 40, icon: 'sliders',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E } = ctx;
      const meta = H.util.assumptionMeta;
      const cfg = model.config;
      const allMonths = model.months();
      const horizon = { from: E.addMonths(model.lastActualPeriod, 1), to: allMonths[allMonths.length - 1].period }; // vaste forecasthorizon: okt 26 – dec 29
      const FOCUS = 2027; // eerste volledige forecastjaar
      const MARK_NOTE = '* = deels forecast · F = forecast · gearceerd = forecast';
      const fcMark = y => y.isActual ? '' : y.months.some(m => m.isActual) ? '*' : ' F';
      const fLabel = txt => h('span', null, txt + ' ', h('span', { class: 'muted' }, 'F')); // 'Q4 2026 F' met gedempte F (rij-label)

      // ---------- paginakop (eenmalig; chips worden bij elke wijziging ververst) ----------
      const headChips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      root.appendChild(h('div', { class: 'page-head' },
        h('div', null, h('h1', null, "Scenario's"), h('p', null, 'Verschuif een driver en zie direct hoe winst-en-verliesrekening, balans, kasstroom en convenanten meebewegen. Elke beweging is een volledige herberekening van het drie-statement model over de forecast ' + fmt.month(horizon.from) + ' – ' + fmt.month(horizon.to) + '. De filters korrel en periode gelden hier niet; het scenario wel.')),
        headChips));
      const grid = h('div', { class: 'grid' }); root.appendChild(grid);
      // samenvatting (KPI-rij + convenantnoot) staat vóór het besturingspaneel, ook op mobiel (regel 5)
      const summary = h('div', { class: 'span-12', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } });
      grid.appendChild(summary);

      // ---------- besturingspaneel (eenmalig gebouwd) ----------
      const panel = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
      const sliders = {};
      const groups = [
        { title: 'Groei en prijs', keys: ['volumeGrowth', 'priceIndex', 'leaseBoost', 'deExpansion'] },
        { title: 'Kosten', keys: ['materialIndex', 'fteGrowth', 'wageIndex', 'marketingPct'] },
        { title: 'Werkkapitaal', keys: ['dso', 'dio', 'dpo'] },
        { title: 'Investeren en uitkeren', keys: ['capexPerYear', 'dividendPct'] }
      ];
      function currentAssumptions() { return model.assumptions(); }
      function setOverride(key, value) { const s = H.state.get(); const base = (model.scenarios[s.scenarioKey] || model.scenarios.basis).assumptions; const ov = Object.assign({}, s.overrides); if (Math.abs((base[key] === true ? 1 : base[key] === false ? 0 : base[key]) - (value === true ? 1 : value === false ? 0 : value)) < 1e-12) delete ov[key]; else ov[key] = value; H.state.set({ overrides: ov }); }
      const presetSel = ui.select({ id: 'sc-preset', label: 'Uitgangsscenario', value: H.state.get().scenarioKey, options: Object.keys(model.scenarios).map(k => ({ value: k, label: model.scenarios[k].label })), onChange: v => H.state.set({ scenarioKey: v, overrides: {} }) });
      const resetBtn = ui.button('Herstel scenario', () => H.state.set({ overrides: {} }), { sm: true, icon: 'refresh', id: 'sc-reset' });
      panel.appendChild(h('div', { style: { display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' } }, presetSel, resetBtn));
      const desc = h('div', { class: 'note', id: 'sc-desc' }); panel.appendChild(desc);
      const a0 = currentAssumptions();
      for (const g of groups) {
        const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div', { class: 'eyebrow' }, g.title));
        for (const key of g.keys) {
          const m = meta[key];
          if (m.type === 'bool') { const t = ui.toggle({ id: 'sl-' + key, label: m.label, value: !!a0[key], onChange: v => setOverride(key, v) }); sliders[key] = t.querySelector('input'); box.appendChild(t); continue; }
          const sl = ui.slider({ id: 'sl-' + key, label: m.label, min: m.min, max: m.max, step: m.step, value: a0[key], format: m.format, onInput: v => setOverride(key, v) });
          sliders[key] = sl.querySelector('input'); sliders[key]._out = sl.querySelector('output'); sliders[key]._fmt = m.format;
          box.appendChild(sl);
        }
        panel.appendChild(box);
      }
      grid.appendChild(ui.card({ span: 4, title: 'Drivers', subtitle: 'gelden voor de forecast vanaf ' + fmt.monthLong(horizon.from), body: panel }));

      // ---------- resultaten: grafieken en vergelijkingstabel (herbouwd bij elke wijziging) ----------
      const results = h('div', { class: 'span-8', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } });
      grid.appendChild(results);
      function syncPanel() {
        const s = H.state.get(); const a = currentAssumptions(); const sc = model.scenarios[s.scenarioKey];
        H.clear(headChips); headChips.appendChild(ui.rangeChip(horizon, 'Forecast')); headChips.appendChild(ui.scenarioChip());
        const sel = document.getElementById('sc-preset'); if (sel && sel.value !== s.scenarioKey) sel.value = s.scenarioKey;
        const n = Object.keys(s.overrides || {}).length;
        H.clear(desc); desc.appendChild(h('strong', null, sc.label + ': ')); desc.appendChild(document.createTextNode(sc.description)); if (n) desc.appendChild(h('div', { style: { marginTop: '4px' } }, ui.chip(n === 1 ? '1 driver aangepast' : n + ' drivers aangepast', 'accent')));
        for (const key in sliders) { const inp = sliders[key]; if (inp.type === 'checkbox') { if (inp.checked !== !!a[key]) inp.checked = !!a[key]; } else if (document.activeElement !== inp && Number(inp.value) !== a[key]) { inp.value = a[key]; inp._out.textContent = inp._fmt(a[key]); } else if (inp._out) inp._out.textContent = inp._fmt(a[key]); }
      }
      // kengetallen over de forecast van één run: laagste kas, hoogste nettoschuld / EBITDA en de kwartaaltoets van de convenanten
      const fcStats = run => {
        const f = run.months.slice(model.actualCount);
        // laagste kas: maanden op de minimumkas (binnen € 1) tellen als gelijk; dan wint de maand met de hoogste RCF-benutting (geen zwevendekommaruis in de maandkeuze)
        const minCash = f.reduce((m, x) => x.bs.cash < m.bs.cash - 1 || (Math.abs(x.bs.cash - m.bs.cash) <= 1 && x.bs.rcf > m.bs.rcf) ? x : m, f[0]);
        const maxLev = f.reduce((m, x) => x.kpi.leverage > m.kpi.leverage ? x : m, f[0]);
        const breach = f.find(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk)) || null;
        return { minCash, maxLev, breach };
      };
      const levText = m => m.kpi.netDebt < 0 ? 'nettokas' : fmt.x(m.kpi.leverage, 2); // tabellen en tegels: nettokas voluit, nooit een negatieve ratio
      function build() {
        const s = H.state.get(); const sc = model.scenarios[s.scenarioKey]; const a = currentAssumptions(); const run = model.run(a);
        const baseA = Object.assign({}, E.defaultAssumptions(), sc.assumptions); const baseRun = model.run(baseA);
        const custom = Object.keys(s.overrides || {}).length > 0;
        const years = E.aggregate(run.months, 'Y'); const baseYears = E.aggregate(baseRun.months, 'Y');
        const focusYear = years.find(y => y.year === FOCUS); const baseFocus = baseYears.find(y => y.year === FOCUS);
        const focusTag = FOCUS + fcMark(focusYear); // '2027 F'
        const { minCash, maxLev, breach } = fcStats(run);

        // ---- samenvatting ----
        H.clear(summary);
        const kp = h('div', { class: 'kpi-row' });
        const dl = (cur, base) => custom ? ui.delta(cur, base, { label: s.scenarioKey === 'basis' ? 'vs. basisscenario' : 'vs. ' + sc.label }) : null;
        kp.appendChild(ui.kpi({ label: 'Omzet ' + focusTag, value: fmt.eurM(focusYear.pl.revenue), delta: dl(focusYear.pl.revenue, baseFocus.pl.revenue), hint: fmt.int(focusYear.kpi.units) + ' verkochte e-bikes' }));
        kp.appendChild(ui.kpi({ label: 'EBITDA ' + focusTag, value: fmt.eurM(focusYear.pl.ebitda), delta: dl(focusYear.pl.ebitda, baseFocus.pl.ebitda), hint: 'EBITDA-marge ' + fmt.pct(focusYear.kpi.ebitdaPct) }));
        kp.appendChild(ui.kpi({ label: 'Nettowinst ' + focusTag, value: fmt.eurM(focusYear.pl.netIncome), delta: dl(focusYear.pl.netIncome, baseFocus.pl.netIncome), hint: focusYear.pl.tax > 5e4 ? 'na ' + fmt.eurM(focusYear.pl.tax) + ' VPB' : 'geen VPB verschuldigd' }));
        kp.appendChild(ui.kpi({ label: 'Vrije kasstroom ' + focusTag, value: fmt.eurM(focusYear.cf.fcf), delta: dl(focusYear.cf.fcf, baseFocus.cf.fcf), hint: 'operationele kasstroom − investeringen' }));
        kp.appendChild(ui.kpi({ label: 'Laagste kas in forecast', value: fmt.eurM(minCash.bs.cash), hint: fmt.monthLong(minCash.period) + (minCash.bs.rcf > 1 ? ' · RCF ' + fmt.eurM(minCash.bs.rcf) : ' · RCF onbenut') }));
        kp.appendChild(ui.kpi({ label: 'Hoogste nettoschuld / EBITDA', value: levText(maxLev), hint: fmt.monthLong(maxLev.period) + ' · limiet ' + fmt.x(cfg.covenantLeverageMax) }));
        summary.appendChild(kp);
        if (breach) {
          const parts = [];
          if (!breach.kpi.covenantLeverageOk) parts.push('nettoschuld / EBITDA ' + fmt.x(breach.kpi.leverage, 2) + ' boven limiet ' + fmt.x(cfg.covenantLeverageMax));
          if (!breach.kpi.covenantIcrOk) parts.push('rentedekking ' + fmt.x(breach.kpi.icr) + ' onder minimum ' + fmt.x(cfg.covenantIcrMin));
          summary.appendChild(ui.note('Convenantbreuk in ' + fmt.monthLong(breach.period) + ' (kwartaaltoets): ' + parts.join(' en ') + '. De bank kan dan heronderhandelen.', 'critical'));
        } else {
          summary.appendChild(ui.note('Beide convenanten (nettoschuld / EBITDA ≤ ' + fmt.x(cfg.covenantLeverageMax) + ', rentedekking ≥ ' + fmt.x(cfg.covenantIcrMin) + ') blijven de hele forecast binnen de limieten.', 'accent'));
        }

        // ---- grafieken: jaren 2024–2029 ----
        H.clear(results);
        const adjName = sc.label + ' (aangepast)';
        const yrs = years.filter(y => y.year >= 2024); const byrs = baseYears.filter(y => y.year >= 2024);
        const cats = yrs.map(y => y.key + fcMark(y));
        const fcIdx = yrs.findIndex(y => !y.isActual);
        const c1 = charts.bar({ categories: cats, series: (custom ? [{ name: sc.label, values: byrs.map(y => y.pl.ebitda), color: 'var(--series-dim)' }] : []).concat([{ name: custom ? adjName : 'EBITDA', values: yrs.map(y => y.pl.ebitda), color: 'var(--series-1)' }]), yFormat: fmt.eur, forecastFrom: fcIdx, labels: 'all', xLabel: 'Jaar' });
        const c2 = charts.line({ x: yrs.map(y => y.key), labels: cats, series: [{ name: 'Kas eind jaar', values: yrs.map(y => y.bs.cash), color: 'var(--series-1)' }, { name: 'Nettoschuld', values: yrs.map(y => y.kpi.netDebt), color: 'var(--series-2)' }].concat(custom ? [{ name: 'Kas eind jaar · ' + sc.label, values: byrs.map(y => y.bs.cash), color: 'var(--series-dim)' }] : []), forecastFrom: fcIdx, yFormat: fmt.eur, baseline: 0, xLabel: 'Jaar' });
        // convenant per kwartaal: dezelfde afbeelding als op Balans (nettokas = 0x, weergave afgekapt op 6x), limiet als neutrale stippellijn
        // venster: de laatste vier actual kwartalen plus de forecast (17 kwartalen; de kwartaallabels blijven zo ook op 400 px leesbaar)
        const qAll = E.aggregate(run.months, 'Q'); const qStart = Math.max(0, qAll.findIndex(q => !q.isActual) - 4);
        const qs = qAll.slice(qStart); const bqs = E.aggregate(baseRun.months, 'Q').slice(qStart);
        const levOf = q => q.kpi.netDebt < 0 ? 0 : Math.min(q.kpi.leverage, 6);
        const levFmt = v => v <= 0 ? 'nettokas' : v >= 6 ? '≥ 6x (afgekapt)' : fmt.x(v, 2);
        const qLabels = qs.map(q => fmt.quarter(q.key));
        const c3 = charts.line({ x: qs.map(q => q.key), labels: qLabels, series: [{ name: 'Nettoschuld / EBITDA', values: qs.map(levOf), color: 'var(--series-1)', format: levFmt }].concat(custom ? [{ name: sc.label, values: bqs.map(levOf), color: 'var(--series-dim)', format: levFmt }] : []), referenceLines: [{ value: cfg.covenantLeverageMax, label: 'Limiet ' + fmt.x(cfg.covenantLeverageMax) }], forecastFrom: qs.findIndex(q => !q.isActual), yFormat: v => fmt.x(v, 1), height: 200, baseline: 0, endLabels: false, tooltipTitle: i => fmt.periodLong(qs[i].key, 'Q'), ariaLabel: 'Nettoschuld gedeeld door EBITDA per kwartaal' });
        // eigen tabelweergave: de werkelijke ratio (niet afgekapt), nettokas voluit, geen limietkolom
        const covFig = { el: c3.el, legend: c3.legend, table: () => ui.table({
          caption: 'kwartaaltoets · limiet nettoschuld / EBITDA ≤ ' + fmt.x(cfg.covenantLeverageMax),
          columns: [{ key: 'label', label: 'Kwartaal' }, { key: 'lev', label: custom ? adjName : 'Nettoschuld / EBITDA', align: 'num' }].concat(custom ? [{ key: 'base', label: sc.label, align: 'num' }] : []),
          rows: qs.map((q, i) => ({ label: q.isActual ? qLabels[i] : fLabel(qLabels[i]), lev: levText(q), base: custom ? levText(bqs[i]) : '', fc: !q.isActual })),
          rowClass: r => r.fc ? 'forecast' : '' }) };
        const g2 = h('div', { class: 'grid' });
        g2.appendChild(ui.card({ span: 6, title: 'EBITDA per jaar', subtitle: MARK_NOTE, body: ui.figure({ chart: c1 }) }));
        g2.appendChild(ui.card({ span: 6, title: 'Kas en nettoschuld', subtitle: 'stand einde jaar · negatieve nettoschuld = nettokas · ' + MARK_NOTE, body: ui.figure({ chart: c2 }) }));
        g2.appendChild(ui.card({ span: 12, title: 'Convenant: nettoschuld / EBITDA per kwartaal', subtitle: 'nettoschuld / EBITDA LTM (leverage) per kwartaal, laatste vier actual kwartalen en de forecast · nettokas = 0x · weergave afgekapt op 6x · gestippeld = limiet ' + fmt.x(cfg.covenantLeverageMax) + ' · gearceerd = forecast', body: ui.figure({ chart: covFig }) }));
        results.appendChild(g2);

        // ---- scenario-vergelijking: scenario's als kolommen, kengetallen als rijen (past zonder scrollen naast het paneel) ----
        const cols = Object.keys(model.scenarios).map(k => { const r = k === s.scenarioKey ? baseRun : model.run(Object.assign({}, E.defaultAssumptions(), model.scenarios[k].assumptions)); return Object.assign({ key: k, label: model.scenarios[k].label, run: r, years: k === s.scenarioKey ? baseYears : E.aggregate(r.months, 'Y'), current: k === s.scenarioKey && !custom }, fcStats(r)); });
        if (custom) cols.push({ key: 'eigen', label: adjName, run, years, current: true, minCash, maxLev, breach });
        const metrics = [
          { label: 'Omzet ' + focusTag, get: c => c.years.find(y => y.year === FOCUS).pl.revenue, format: fmt.eurM },
          { label: 'EBITDA ' + focusTag, get: c => c.years.find(y => y.year === FOCUS).pl.ebitda, format: fmt.eurM },
          { label: 'EBITDA-marge ' + focusTag, get: c => c.years.find(y => y.year === FOCUS).kpi.ebitdaPct, format: v => fmt.pct(v, 1) },
          { label: 'Nettowinst ' + focusTag, get: c => c.years.find(y => y.year === FOCUS).pl.netIncome, format: fmt.eurM },
          { label: 'EBITDA 2029 F', get: c => c.years.find(y => y.year === 2029).pl.ebitda, format: fmt.eurM },
          { label: 'Laagste kas in forecast', get: c => c.minCash.bs.cash, format: fmt.eurM },
          { label: 'Hoogste nettoschuld / EBITDA', get: c => c.maxLev, format: levText },
          { label: 'Convenant', get: c => !c.breach, format: ok => ui.statusChip(ok, 'ok', 'breuk') }
        ];
        const rows = metrics.map(m => { const row = { label: m.label, _format: m.format }; for (const c of cols) row[c.key] = m.get(c); return row; });
        const cmp = ui.table({
          columns: [{ key: 'label', label: 'Kengetal' }].concat(cols.map(c => ({ key: c.key, label: c.current ? h('strong', null, c.label) : c.label, align: 'num', format: (v, row) => { const t = row._format(v); return c.current && !(t instanceof Node) ? h('strong', null, t) : t; } }))),
          rows });
        results.appendChild(ui.card({ title: "Alle scenario's naast elkaar", subtitle: 'elk scenario is een complete herberekening van ' + fmt.int(run.months.length) + ' maanden · laagste kas en hoogste nettoschuld / EBITDA over de forecast ' + fmt.month(horizon.from) + ' – ' + fmt.month(horizon.to) + ' · vet = actief scenario', body: cmp, footer: 'Elke wijziging van een driver herberekent alle ' + fmt.int(run.months.length) + ' maanden. Helder E-Bikes en de scenario\'s zijn fictief.' }));
      }
      const refresh = () => { syncPanel(); build(); };
      refresh();
      ctx.subscribe(refresh);
    }
  });
})();
