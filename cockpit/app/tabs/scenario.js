/* Tab: Scenario's — driver-based forecast met live sliders. Het besturingspaneel wordt één keer gebouwd; de resultaten herberekenen bij elke beweging. */
(function () {
  'use strict';
  const H = window.HC;
  H.tabs.register({
    id: 'scenario', label: "Scenario's", short: "Scenario's", order: 40, icon: 'sliders',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E } = ctx;
      const meta = H.util.assumptionMeta;
      root.appendChild(h('div', { class: 'page-head' },
        h('div', null, h('h1', null, "Scenario's"), h('p', null, 'Verschuif een driver en zie direct hoe winst-en-verliesrekening, balans, kasstroom en convenanten meebewegen. Elke beweging is een volledige herberekening van het drie-statement model.'))));
      const grid = h('div', { class: 'grid' }); root.appendChild(grid);

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
      grid.appendChild(ui.card({ span: 4, title: 'Drivers', subtitle: 'gelden voor de forecast vanaf ' + fmt.monthLong(E.addMonths(model.lastActualPeriod, 1)), body: panel }));

      // ---------- resultaten (herbouwd bij elke wijziging) ----------
      const results = h('div', { class: 'span-8', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } });
      grid.appendChild(results);
      function syncPanel() {
        const s = H.state.get(); const a = currentAssumptions(); const sc = model.scenarios[s.scenarioKey];
        const sel = document.getElementById('sc-preset'); if (sel && sel.value !== s.scenarioKey) sel.value = s.scenarioKey;
        H.clear(desc); desc.appendChild(h('strong', null, sc.label + ': ')); desc.appendChild(document.createTextNode(sc.description)); if (Object.keys(s.overrides || {}).length) desc.appendChild(h('div', { style: { marginTop: '4px' } }, ui.chip(Object.keys(s.overrides).length + ' driver(s) aangepast', 'accent')));
        for (const key in sliders) { const inp = sliders[key]; if (inp.type === 'checkbox') { if (inp.checked !== !!a[key]) inp.checked = !!a[key]; } else if (document.activeElement !== inp && Number(inp.value) !== a[key]) { inp.value = a[key]; inp._out.textContent = inp._fmt(a[key]); } else if (inp._out) inp._out.textContent = inp._fmt(a[key]); }
      }
      function build() {
        const t0 = performance.now();
        const s = H.state.get(); const a = currentAssumptions(); const run = model.run(a);
        const baseA = Object.assign({}, E.defaultAssumptions(), model.scenarios[s.scenarioKey].assumptions); const baseRun = model.run(baseA);
        const custom = Object.keys(s.overrides || {}).length > 0;
        const years = E.aggregate(run.months, 'Y'); const baseYears = E.aggregate(baseRun.months, 'Y');
        const focusYear = years.find(y => y.year === 2027); const baseFocus = baseYears.find(y => y.year === 2027);
        const fc = run.months.slice(model.actualCount); const baseFc = baseRun.months.slice(model.actualCount);
        const minCash = fc.reduce((m, x) => x.bs.cash < m.bs.cash ? x : m, fc[0]); const maxLev = fc.reduce((m, x) => x.kpi.leverage > m.kpi.leverage ? x : m, fc[0]);
        const breach = fc.find(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk));
        H.clear(results);
        const kp = h('div', { class: 'kpi-row' });
        const dl = (cur, base, opts) => custom ? ui.delta(cur, base, Object.assign({ label: 'vs. ' + model.scenarios[s.scenarioKey].label.toLowerCase() }, opts || {})) : null;
        kp.appendChild(ui.kpi({ label: 'Omzet 2027', value: fmt.eurM(focusYear.pl.revenue), delta: dl(focusYear.pl.revenue, baseFocus.pl.revenue), hint: fmt.int(focusYear.kpi.units) + ' e-bikes' }));
        kp.appendChild(ui.kpi({ label: 'EBITDA 2027', value: fmt.eurM(focusYear.pl.ebitda), delta: dl(focusYear.pl.ebitda, baseFocus.pl.ebitda), hint: fmt.pct(focusYear.kpi.ebitdaPct) + ' marge' }));
        kp.appendChild(ui.kpi({ label: 'Nettowinst 2027', value: fmt.eurM(focusYear.pl.netIncome), delta: dl(focusYear.pl.netIncome, baseFocus.pl.netIncome) }));
        kp.appendChild(ui.kpi({ label: 'Vrije kasstroom 2027', value: fmt.eurM(focusYear.cf.fcf), delta: dl(focusYear.cf.fcf, baseFocus.cf.fcf), hint: 'CFO − capex' }));
        kp.appendChild(ui.kpi({ label: 'Laagste kas in forecast', value: fmt.eurM(minCash.bs.cash), hint: fmt.monthLong(minCash.period) + (minCash.bs.rcf > 1 ? ' · RCF ' + fmt.eurM(minCash.bs.rcf) : ' · RCF onbenut') }));
        kp.appendChild(ui.kpi({ label: 'Hoogste leverage', value: maxLev.kpi.netDebt < 0 ? 'netto kas' : fmt.x(maxLev.kpi.leverage, 2), hint: fmt.monthLong(maxLev.period) + ' · limiet ' + fmt.x(model.config.covenantLeverageMax), class: '' }));
        results.appendChild(kp);
        results.appendChild(breach ? ui.note('Convenantbreuk in ' + fmt.monthLong(breach.period) + ': ' + (breach.kpi.covenantLeverageOk ? 'rentedekking ' + fmt.x(breach.kpi.icr) + ' onder minimum ' + fmt.x(model.config.covenantIcrMin) : 'netto schuld / EBITDA ' + fmt.x(breach.kpi.leverage, 2) + ' boven limiet ' + fmt.x(model.config.covenantLeverageMax)) + '. De bank kan dan heronderhandelen.', 'critical') : ui.note('Beide convenanten (netto schuld/EBITDA ≤ ' + fmt.x(model.config.covenantLeverageMax) + ', rentedekking ≥ ' + fmt.x(model.config.covenantIcrMin) + ') blijven de hele forecast binnen de limiet.', 'accent'));

        // charts: jaren 2024–2029
        const yrs = years.filter(y => y.year >= 2024); const byrs = baseYears.filter(y => y.year >= 2024);
        const cats = yrs.map(y => y.key + (y.isActual ? '' : y.months.some(m => m.isActual) ? '*' : ' F'));
        const fcFrom = yrs.findIndex(y => !y.isActual);
        const c1 = charts.bar({ categories: cats, series: (custom ? [{ name: model.scenarios[s.scenarioKey].label, values: byrs.map(y => y.pl.ebitda), color: 'var(--series-dim)' }] : []).concat([{ name: custom ? 'Aangepast' : 'EBITDA', values: yrs.map(y => y.pl.ebitda), color: 'var(--series-1)' }]), yFormat: fmt.eur, height: 220, forecastFrom: fcFrom, labels: 'all' });
        const c2 = charts.line({ x: yrs.map(y => y.key), labels: cats, series: [{ name: 'Kas (eind jaar)', values: yrs.map(y => y.bs.cash), color: 'var(--series-1)' }, { name: 'Netto schuld', values: yrs.map(y => y.kpi.netDebt), color: 'var(--series-2)' }].concat(custom ? [{ name: 'Kas · ' + model.scenarios[s.scenarioKey].label, values: byrs.map(y => y.bs.cash), color: 'var(--series-dim)' }] : []), forecastFrom: fcFrom, yFormat: fmt.eur, height: 220, baseline: 0 });
        const qs = E.aggregate(run.months, 'Q').filter(q => q.year >= 2025); const bqs = E.aggregate(baseRun.months, 'Q').filter(q => q.year >= 2025);
        const c3 = charts.line({ x: qs.map(q => q.key), labels: qs.map(q => fmt.quarter(q.key)), series: [{ name: 'Netto schuld / EBITDA', values: qs.map(q => Math.max(-1, Math.min(6, q.kpi.leverage))), color: 'var(--series-1)' }, { name: 'Limiet', values: qs.map(() => model.config.covenantLeverageMax), color: 'var(--critical)' }].concat(custom ? [{ name: model.scenarios[s.scenarioKey].label, values: bqs.map(q => Math.max(-1, Math.min(6, q.kpi.leverage))), color: 'var(--series-dim)' }] : []), forecastFrom: qs.findIndex(q => !q.isActual), yFormat: v => fmt.x(v, 1), height: 200, baseline: 0, endLabels: false });
        const g2 = h('div', { class: 'grid' });
        g2.appendChild(ui.card({ span: 6, title: 'EBITDA per jaar', subtitle: '* deels actual · F forecast', body: ui.figure({ chart: c1 }) }));
        g2.appendChild(ui.card({ span: 6, title: 'Kas en netto schuld', subtitle: 'stand einde jaar · negatieve netto schuld = netto kas', body: ui.figure({ chart: c2 }) }));
        g2.appendChild(ui.card({ span: 12, title: 'Convenant: netto schuld / EBITDA per kwartaal', subtitle: 'LTM-basis · rode lijn is de bancaire limiet', body: ui.figure({ chart: c3 }) }));
        results.appendChild(g2);

        // scenario-vergelijking
        const rows = Object.keys(model.scenarios).map(k => { const r = model.run(Object.assign({}, E.defaultAssumptions(), model.scenarios[k].assumptions)); const ys = E.aggregate(r.months, 'Y'); const y27 = ys.find(y => y.year === 2027), y29 = ys.find(y => y.year === 2029); const f = r.months.slice(model.actualCount); const mc = Math.min(...f.map(m => m.bs.cash)); const ml = Math.max(...f.map(m => m.kpi.leverage)); const br = f.some(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk)); return { key: k, label: model.scenarios[k].label, rev27: y27.pl.revenue, ebitda27: y27.pl.ebitda, margin27: y27.kpi.ebitdaPct, ni27: y27.pl.netIncome, rev29: y29.pl.revenue, ebitda29: y29.pl.ebitda, minCash: mc, maxLev: ml, breach: br, current: k === s.scenarioKey && !custom }; });
        if (custom) rows.push({ key: 'eigen', label: 'Aangepast (huidig)', rev27: focusYear.pl.revenue, ebitda27: focusYear.pl.ebitda, margin27: focusYear.kpi.ebitdaPct, ni27: focusYear.pl.netIncome, rev29: years.find(y => y.year === 2029).pl.revenue, ebitda29: years.find(y => y.year === 2029).pl.ebitda, minCash: minCash.bs.cash, maxLev: maxLev.kpi.leverage, breach: !!breach, current: true });
        const cmp = ui.table({ columns: [
          { key: 'label', label: 'Scenario', format: (v, r) => r.current ? h('strong', null, v) : v },
          { key: 'rev27', label: 'Omzet 2027', align: 'num', format: fmt.eurM }, { key: 'ebitda27', label: 'EBITDA 2027', align: 'num', format: fmt.eurM }, { key: 'margin27', label: 'Marge', align: 'num', format: v => fmt.pct(v, 1) }, { key: 'ni27', label: 'Nettowinst 2027', align: 'num', format: fmt.eurM },
          { key: 'ebitda29', label: 'EBITDA 2029', align: 'num', format: fmt.eurM }, { key: 'minCash', label: 'Laagste kas', align: 'num', format: fmt.eurM }, { key: 'maxLev', label: 'Max. leverage', align: 'num', format: v => v < 0 ? 'netto kas' : fmt.x(v, 2) },
          { key: 'breach', label: 'Convenant', format: v => ui.statusChip(!v, 'ok', 'breuk') }
        ], rows, rowClass: r => r.current ? 'key' : '' });
        results.appendChild(ui.card({ title: 'Alle scenario\'s naast elkaar', subtitle: 'elk scenario is een complete herberekening van 84 maanden', body: cmp, footer: 'Berekend in ' + Math.max(1, Math.round(performance.now() - t0)) + ' ms, inclusief alle grafieken.' }));
      }
      const refresh = () => { syncPanel(); build(); };
      refresh();
      ctx.subscribe(refresh);
    }
  });
})();
