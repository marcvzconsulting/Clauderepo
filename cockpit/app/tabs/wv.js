/* Tab: Winst & verlies — marges, kostenstructuur, omzetmix, unit economics, budget 2026 en de volledige W&V per periode.
 * Lokale helpers (verzoeken voor opname in core staan in het eindrapport onder coreRequests): prevRange (vergelijkingsperiode
 * voor de KPI-rij), varianceBars (afwijkingsbalken rond een nullijn, met tabel-twin), tableNote (toelichting boven een
 * horizontaal scrollende tabel) en een beetje CSS (span-5/7, dekkende sticky cel bij hover). */
(function () {
  'use strict';
  const H = window.HC;
  const GRAIN_WORD = { M: 'maand', Q: 'kwartaal', Y: 'jaar' };
  const MAX_COLS = 16;       // maximaal aantal periodekolommen in de W&V-tabel
  const FC_TAIL = 4;         // forecastkolommen rechts van de laatste actual als het venster ingekort wordt
  const MATERIAL_PCT = 0.01; // |afwijking| onder 1 % van het budget: neutraal, geen statuskleur
  const MATERIAL_EUR = 1e5;  // idem in euro's als er geen budget is om tegen af te zetten

  function ensureLocalCss() {
    if (document.getElementById('wv-local-css')) return;
    const st = document.createElement('style'); st.id = 'wv-local-css';
    st.textContent = [
      '.span-7{grid-column:span 7}.span-5{grid-column:span 5}@media(max-width:1100px){.span-7,.span-5{grid-column:span 12}}',
      'table.data th .forecast{color:var(--muted);font-weight:500}',
      /* sticky eerste cel blijft dekkend bij hover (index.html: table.data tr:hover td is doorschijnend en wint op specificiteit) */
      '.statement tr:hover td:first-child{background:color-mix(in srgb,var(--accent-soft) 45%,var(--surface))}',
      '.statement tr.key:hover td:first-child{background:color-mix(in srgb,var(--accent-soft) 45%,var(--surface-2))}',
      /* afwijkingsbalken */
      '.wv-vb{display:flex;flex-direction:column;gap:8px}',
      '.wv-vb-row{display:grid;grid-template-columns:minmax(104px,1.2fr) minmax(0,2fr) auto;gap:10px;align-items:center;font-size:12.5px;border-radius:6px;outline:none}',
      '.wv-vb-row:focus-visible{box-shadow:0 0 0 2px var(--accent)}',
      '.wv-vb-label{color:var(--ink-2);line-height:1.25}',
      '.wv-vb-track{position:relative;height:20px}',
      '.wv-vb-zero{position:absolute;left:50%;top:0;bottom:0;width:1px;background:var(--line-2)}',
      '.wv-vb-bar{position:absolute;top:4px;height:12px;transition:filter .12s}',
      '.wv-vb-row:hover .wv-vb-bar{filter:brightness(1.08)}',
      '.wv-vb-bar.pos{left:50%;background:var(--good);border-radius:0 4px 4px 0}',
      '.wv-vb-bar.neg{right:50%;background:var(--critical);border-radius:4px 0 0 4px}',
      '.wv-vb-val{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;text-align:right}',
      '.wv-vb-pct{color:var(--muted);font-weight:500}',
      '@media(max-width:640px){.wv-vb-val{display:flex;flex-direction:column;align-items:flex-end;line-height:1.2}}',
      '.wv-tnote{font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:8px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center}'
    ].join('');
    document.head.appendChild(st);
  }

  /** Vergelijkingsperiode voor de KPI-rij (seizoensbedrijf): bereik ≤ 12 maanden → dezelfde maanden een jaar eerder;
   *  hele jaren → een even lang blok ervoor; anders geen vergelijking. */
  function prevRange(E, months, inR) {
    const n = inR.length; const idx0 = months.findIndex(m => m.period === inR[0].period);
    let mode = null, shift = 0;
    if (n <= 12) { mode = 'yoy'; shift = 12; } else if (n % 12 === 0) { mode = 'block'; shift = n; }
    const from = mode ? E.addMonths(inR[0].period, -shift) : null;
    const start = idx0 - shift;
    return { mode, n, from, to: from ? E.addMonths(from, n - 1) : null, ms: mode && start >= 0 ? months.slice(start, start + n) : null };
  }
  function rangeLabel(fmt, a, b, n) {
    const ya = a.slice(0, 4), yb = b.slice(0, 4);
    if (n === 1) return fmt.monthLong(a);
    if (n % 12 === 0 && a.slice(5) === '01') return ya === yb ? ya : ya + ' – ' + yb;
    if (ya === yb) return fmt.monthShort(a) + ' – ' + fmt.monthShort(b) + ' ' + ya;
    return fmt.monthShort(a) + ' ' + ya + ' – ' + fmt.monthShort(b) + ' ' + yb;
  }

  /** Afwijkingsbalken: één balk per post rond een nullijn; positief = gunstig. Geeft {el, legend, table()} voor ui.figure.
   *  rows: [{label, actual, budget, value, pct}] */
  function varianceBars(c, rows, ariaLabel) {
    const { h, fmt, ui, charts } = c;
    const maxAbs = Math.max(1, ...rows.map(r => Math.abs(r.value)));
    const el = h('div', { class: 'wv-vb', role: 'list', 'aria-label': ariaLabel });
    for (const r of rows) {
      const good = r.value >= 0;
      const bar = h('i', { class: 'wv-vb-bar ' + (good ? 'pos' : 'neg'), style: { width: (Math.abs(r.value) / maxAbs * 50).toFixed(1) + '%' } });
      const row = h('div', { class: 'wv-vb-row', role: 'listitem', tabindex: '0' },
        h('span', { class: 'wv-vb-label' }, r.label),
        h('div', { class: 'wv-vb-track' }, h('i', { class: 'wv-vb-zero' }), bar),
        h('span', { class: 'wv-vb-val' }, fmt.signed(r.value, fmt.eur), r.pct != null ? h('span', { class: 'wv-vb-pct' }, ' (' + fmt.signedPct(r.pct, 1) + ')') : null));
      const show = e => ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: r.label, rows: [
        { label: 'Actual', value: fmt.eur(r.actual) }, { label: 'Budget', value: fmt.eur(r.budget) },
        { key: good ? 'var(--good)' : 'var(--critical)', label: 'Afwijking', value: fmt.signed(r.value, fmt.eur) + (r.pct != null ? ' (' + fmt.signedPct(r.pct, 1) + ')' : '') }] }));
      row.addEventListener('pointerenter', show); row.addEventListener('pointermove', show); row.addEventListener('pointerleave', () => ui.tooltip.hide());
      row.addEventListener('focus', () => { const b = row.getBoundingClientRect(); show({ clientX: b.left + b.width / 2, clientY: b.top }); });
      row.addEventListener('blur', () => ui.tooltip.hide());
      el.appendChild(row);
    }
    return {
      el,
      legend: charts.legend([{ name: 'Gunstig', color: 'var(--good)' }, { name: 'Ongunstig', color: 'var(--critical)' }]),
      table: () => ui.table({ columns: [
        { key: 'label', label: 'Post' },
        { key: 'actual', label: 'Actual', align: 'num', format: fmt.eurK },
        { key: 'budget', label: 'Budget', align: 'num', format: fmt.eurK },
        { key: 'value', label: 'Afwijking (€)', align: 'num', format: v => fmt.signed(v, fmt.eurK), signColor: true },
        { key: 'pct', label: 'Afwijking (%)', align: 'num', format: v => fmt.signedPct(v, 1), signColor: true }
      ], rows })
    };
  }

  H.tabs.register({
    id: 'wv', label: 'Winst & verlies', short: 'W&V', order: 20, icon: 'pl',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E } = ctx;
      ensureLocalCss();
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
      root.appendChild(body);
      const draw = (c) => { H.clear(body); build(body, c); };
      draw(ctx);
      ctx.subscribe(draw);

      function build(el, c) {
        const state = c.state, range = c.range, grain = state.grain;
        const run = model.run(); const months = run.months;
        const sc = model.scenarios[state.scenarioKey] || model.scenarios.basis;
        const scLabel = sc.label + (Object.keys(state.overrides || {}).length ? ' (aangepast)' : '');
        const inR = months.filter(m => model.inRange(m, range));
        if (!inR.length) { el.appendChild(ui.note('Het gekozen bereik bevat geen maanden.', 'warning')); return; }
        const first = inR[0], last = inR[inR.length - 1];
        const hasFc = inR.some(m => !m.isActual);
        const fullFc = first.period > model.lastActualPeriod;
        const ser = model.series(grain);
        const fcIdx = ser.findIndex(p => !p.isActual);
        const fcFrom = fcIdx >= 0 ? fcIdx : null;
        const firstFc = E.addMonths(model.lastActualPeriod, 1);
        const perLabel = p => fmt.period(p.key, grain);
        const partialTxt = p => p.partial ? ' (' + p.n + ' mnd)' : ''; // kwartaal/jaar dat maar deels binnen het bereik valt
        const chartLabel = p => perLabel(p) + (p.partial ? '*' : '');
        const partialSub = ser.some(p => p.partial) ? ' · * = deel van de periode' : '';
        const perLong = i => fmt.periodLong(ser[i].key, grain) + partialTxt(ser[i]) + (ser[i].isActual ? '' : ' · forecast');
        const isMixed = p => !p.isActual && Array.isArray(p.months) && p.months.some(m => m.isActual); // periode met actual én forecast
        const gw = GRAIN_WORD[grain];
        const pct1 = v => fmt.pct(v, 1);

        // ---------- pagina-kop ----------
        const intro = 'Winst-en-verliesrekening per ' + gw + ', ' + fmt.monthLong(first.period) + ' t/m ' + fmt.monthLong(last.period)
          + (fullFc ? '; volledig forecast volgens scenario ' + scLabel + '.' : hasFc ? '; vanaf ' + fmt.monthLong(firstFc) + ' forecast volgens scenario ' + scLabel + '.' : '; uitsluitend actuals.');
        el.appendChild(h('div', { class: 'page-head' },
          h('div', null, h('h1', null, 'Winst & verlies'), h('p', null, intro)),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            ui.chip(fmt.month(first.period) + ' – ' + fmt.month(last.period), 'actual'),
            hasFc ? ui.chip('Forecast: ' + scLabel, 'forecast') : null)));

        // ---------- KPI's over het bereik, vergeleken met dezelfde maanden een jaar eerder (of een even lang blok hele jaren) ----------
        const n = inR.length;
        const pr = prevRange(E, months, inR);
        const cur = model.sumMonths(inR, 'bereik');
        const prev = pr.ms ? model.sumMonths(pr.ms, 'vorig') : null;
        const prevLabel = prev ? 'vs. ' + rangeLabel(fmt, pr.from, pr.to, n) : null;
        const dl = (a, b) => prev ? ui.delta(a, b, { label: prevLabel }) : null;
        const dpp = (a, b) => prev ? ui.deltaPp(a, b, { label: prevLabel }) : null;
        const fin = cur.pl.netInterest;
        const finTxt = Math.abs(fin) < 500 ? '' : ' en ' + fmt.eur(Math.abs(fin)) + (fin > 0 ? ' financiële lasten' : ' financiële baten');
        const kpis = h('div', { class: 'kpi-row' });
        kpis.appendChild(ui.kpi({ label: 'Netto-omzet', value: fmt.eur(cur.pl.revenue), delta: dl(cur.pl.revenue, prev && prev.pl.revenue), hint: n + (n === 1 ? ' maand' : ' maanden') + ' · ASP ' + fmt.eur(cur.kpi.asp, { full: true }) }));
        kpis.appendChild(ui.kpi({ label: 'Brutomarge %', value: fmt.pct(cur.kpi.grossMarginPct), delta: dpp(cur.kpi.grossMarginPct, prev && prev.kpi.grossMarginPct), hint: 'brutowinst ' + fmt.eur(cur.pl.grossProfit) }));
        kpis.appendChild(ui.kpi({ label: 'EBITDA', value: fmt.eur(cur.pl.ebitda), delta: dl(cur.pl.ebitda, prev && prev.pl.ebitda), hint: 'bedrijfskosten ' + fmt.eur(cur.pl.opex) }));
        kpis.appendChild(ui.kpi({ label: 'EBITDA %', value: fmt.pct(cur.kpi.ebitdaPct), delta: dpp(cur.kpi.ebitdaPct, prev && prev.kpi.ebitdaPct), hint: 'EBIT ' + fmt.eur(cur.pl.ebit) }));
        kpis.appendChild(ui.kpi({ label: 'Nettowinst', value: fmt.eur(cur.pl.netIncome), delta: dl(cur.pl.netIncome, prev && prev.pl.netIncome), hint: 'na ' + fmt.eur(cur.pl.tax) + ' VPB' + finTxt }));
        kpis.appendChild(ui.kpi({ label: 'Eenheden', value: fmt.int(cur.kpi.units), delta: dl(cur.kpi.units, prev && prev.kpi.units), hint: 'verkochte e-bikes' }));
        el.appendChild(kpis);
        if (!prev) {
          const modelStart = fmt.monthLong(months[0].period);
          const why = pr.mode === 'yoy' ? 'dezelfde maanden een jaar eerder (' + rangeLabel(fmt, pr.from, pr.to, n) + ') vallen vóór de start van het model (' + modelStart + ').'
            : pr.mode === 'block' ? 'het even lange blok ervoor (' + rangeLabel(fmt, pr.from, pr.to, n) + ') valt vóór de start van het model (' + modelStart + ').'
            : 'het bereik beslaat ' + n + ' maanden en is geen geheel aantal jaren. Deltas worden getoond voor bereiken tot twaalf maanden (tegenover dezelfde maanden een jaar eerder) en voor hele jaren (tegenover een even lang blok ervoor).';
          el.appendChild(h('div', { class: 'small muted' }, 'Geen vergelijkingsperiode in de KPI-rij: ' + why));
        }

        // ---------- rij 1: marges + kostenstructuur ----------
        const grid1 = h('div', { class: 'grid' });
        const marginChart = charts.line({
          x: ser.map(p => p.key), labels: ser.map(chartLabel),
          series: [
            { name: 'Brutomarge %', values: ser.map(p => p.kpi.grossMarginPct), color: H.util.seriesColor(1), format: pct1 },
            { name: 'EBITDA %', values: ser.map(p => p.kpi.ebitdaPct), color: H.util.seriesColor(2), format: pct1 }
          ],
          forecastFrom: fcFrom, yFormat: v => fmt.pct(v, 0), height: 250, baseline: 0, tooltipTitle: perLong, xLabel: 'Periode', endLabels: false
        });
        grid1.appendChild(ui.card({ span: 7, title: 'Marges per periode', subtitle: 'brutomarge en EBITDA-marge per ' + gw + (hasFc ? ' · gearceerd = forecast' : '') + partialSub, body: ui.figure({ chart: marginChart }) }));

        const pctOf = (p, v) => p.pl.revenue > 0 ? v / p.pl.revenue : 0;
        const anyOneOff = ser.some(p => p.pl.oneOffCogs + p.pl.oneOffOpex !== 0);
        const costDefs = [
          { name: 'Materiaalkosten', f: pl => pl.materialCost, color: H.util.seriesColor(1) },
          { name: 'Directe arbeid, vracht en garantie', f: pl => pl.laborCost + pl.freightCost + pl.warranty, color: H.util.seriesColor(2) },
          { name: 'Personeelskosten', f: pl => pl.personnelTotal, color: H.util.seriesColor(3) },
          { name: 'Marketing', f: pl => pl.marketing, color: H.util.seriesColor(4) },
          { name: 'Overige bedrijfskosten', f: pl => pl.housing + pl.it + pl.other, color: H.util.seriesColor(5) }
        ].concat(anyOneOff ? [{ name: 'Eenmalige posten', f: pl => pl.oneOffCogs + pl.oneOffOpex, color: 'var(--series-dim)' }] : []);
        const costChart = charts.bar({
          categories: ser.map(chartLabel),
          series: costDefs.map(d => ({ name: d.name, values: ser.map(p => pctOf(p, d.f(p.pl))), color: d.color, format: pct1 })),
          stacked: true, yFormat: v => fmt.pct(v, 0), height: 250, labels: 'none', forecastFrom: fcFrom, tooltipTitle: perLong, xLabel: 'Periode'
        });
        grid1.appendChild(ui.card({ span: 5, title: 'Kostenstructuur', subtitle: 'alle kosten in % van de omzet per ' + gw + ' · stapel = 100 % − EBITDA-marge' + partialSub, body: ui.figure({ chart: costChart }) }));
        el.appendChild(grid1);

        // ---------- rij 2: omzet per dimensie + marge per fiets ----------
        const grid2 = h('div', { class: 'grid' });
        const dim = state.split || 'line'; const keys = H.util.dimKeys(dim); const field = H.util.dimField(dim);
        const mixChart = charts.bar({
          categories: ser.map(chartLabel),
          series: keys.map((k, i) => ({ name: dim === 'country' ? H.util.countryName(k) : k, values: ser.map(p => p[field][k].revenue), color: H.util.seriesColor(i + 1) })),
          stacked: true, yFormat: fmt.eur, height: 260, labels: ser.length <= 8 ? 'all' : 'none', forecastFrom: fcFrom, tooltipTitle: perLong, xLabel: 'Periode'
        });
        const splitCtl = ui.segmented({ id: 'wv-split', label: 'Splitsing', value: dim, options: [{ value: 'line', label: 'Productlijn' }, { value: 'channel', label: 'Kanaal' }, { value: 'country', label: 'Land' }], onChange: v => H.state.set({ split: v }) });
        grid2.appendChild(ui.card({ span: 6, title: 'Omzet per ' + H.util.dimLabel(dim).toLowerCase(), subtitle: 'netto-omzet per ' + gw + ', gestapeld' + (hasFc ? ' · gearceerd = forecast' : '') + partialSub, actions: splitCtl, body: ui.figure({ chart: mixChart }) }));

        const ltm = model.ltm();
        const ueRows = E.LINES.map(l => {
          const b = ltm.byLine[l]; const u = b.units || 0; const asp = u > 0 ? b.revenue / u : 0; const cpu = u > 0 ? b.cogs / u : 0;
          return { line: l, units: u, revenue: b.revenue, asp, cpu, margin: asp - cpu, gm: b.revenue > 0 ? (b.revenue - b.cogs) / b.revenue : 0 };
        });
        const tu = ueRows.reduce((s, r) => s + r.units, 0), trv = ueRows.reduce((s, r) => s + r.revenue, 0), tcg = E.LINES.reduce((s, l) => s + ltm.byLine[l].cogs, 0);
        const ueFoot = { line: 'Totaal', units: tu, revenue: trv, asp: tu > 0 ? trv / tu : 0, cpu: tu > 0 ? tcg / tu : 0, margin: tu > 0 ? (trv - tcg) / tu : 0, gm: trv > 0 ? (trv - tcg) / trv : 0 };
        const eurFull = v => fmt.eur(v, { full: true });
        const ueTable = ui.table({
          columns: [
            { key: 'line', label: 'Productlijn' },
            { key: 'units', label: 'Eenheden', align: 'num', format: fmt.int },
            { key: 'revenue', label: 'Omzet', align: 'num', format: fmt.eurM },
            { key: 'asp', label: 'Gem. prijs', align: 'num', format: eurFull },
            { key: 'cpu', label: 'Kostprijs', align: 'num', format: eurFull },
            { key: 'margin', label: 'Marge', align: 'num', format: eurFull },
            { key: 'gm', label: 'Marge %', align: 'num', format: pct1 }
          ],
          rows: ueRows, footer: ueFoot
        });
        const ueChart = charts.bar({ categories: E.LINES, series: [{ name: 'Brutomarge %', values: ueRows.map(r => r.gm), color: H.util.seriesColor(1), format: pct1 }], horizontal: true, yFormat: v => fmt.pct(v, 0), xLabel: 'Productlijn' });
        grid2.appendChild(ui.card({ span: 6, title: 'Marge per fiets per productlijn', subtitle: 'laatste twaalf maanden t/m ' + fmt.monthLong(model.lastActualPeriod) + ' · onafhankelijk van het gekozen bereik',
          body: [ueTable, ui.figure({ title: 'Brutomarge per productlijn', subtitle: 'gemiddeld ' + pct1(ueFoot.gm) + ' over alle lijnen', chart: ueChart })],
          footer: 'Gemiddelde prijs, kostprijs en marge per verkochte fiets; kostprijs = materiaal, directe arbeid, inkomende vracht en garantie (excl. eenmalige posten).' }));
        el.appendChild(grid2);

        // ---------- rij 3: budget 2026 versus actual (YTD) ----------
        const has2026 = inR.some(m => m.year === 2026 && m.isActual);
        if (has2026) {
          const bva = model.budgetVsActual().filter(x => x.actual);
          const sumB = f => bva.reduce((s, x) => s + f(x.budget.pl), 0), sumA = f => bva.reduce((s, x) => s + f(x.actual.pl), 0);
          const otherOpex = pl => pl.housing + pl.it + pl.other;
          const hasOneOff = sumA(pl => pl.oneOffOpex) !== 0 || sumB(pl => pl.oneOffOpex) !== 0;
          const vrows = [
            { label: 'Netto-omzet', f: pl => pl.revenue, cost: false, lvl: 'lvl0' },
            { label: 'Kostprijs van de omzet', f: pl => pl.cogs, cost: true, lvl: 'lvl1' },
            { label: 'Brutowinst', f: pl => pl.grossProfit, cost: false, lvl: 'key', agg: true },
            { label: 'Personeelskosten', f: pl => pl.personnelTotal, cost: true, lvl: 'lvl1' },
            { label: 'Marketing', f: pl => pl.marketing, cost: true, lvl: 'lvl1' },
            { label: 'Overige bedrijfskosten', f: otherOpex, cost: true, lvl: 'lvl1' },
            hasOneOff ? { label: 'Eenmalige bedrijfskosten', f: pl => pl.oneOffOpex, cost: true, lvl: 'lvl1', oneOff: true } : null,
            { label: 'Bedrijfskosten', f: pl => pl.opex, cost: true, lvl: 'lvl0', agg: true },
            { label: 'EBITDA', f: pl => pl.ebitda, cost: false, lvl: 'key', agg: true }
          ].filter(Boolean).map(r => { const a = sumA(r.f), b = sumB(r.f); const v = r.cost ? b - a : a - b; return Object.assign({}, r, { actual: a, budget: b, variance: v, variancePct: b !== 0 ? v / Math.abs(b) : null }); });
          const g = k => vrows.find(r => r.label === k);
          const ytdFrom = fmt.monthLong(bva[0].period).split(' ')[0], ytdTo = fmt.monthLong(bva[bva.length - 1].period).split(' ')[0];
          const ytdText = ytdFrom + ' t/m ' + ytdTo + ' 2026';

          // samenvatting: KPI's + grootste afwijkingen (materialiteit: < 1 % van budget is neutraal)
          const rev = g('Netto-omzet'), eb = g('EBITDA');
          const sumKpis = h('div', { class: 'kpi-row' },
            ui.kpi({ label: 'Omzet YTD', value: fmt.eur(rev.actual), delta: ui.delta(rev.actual, rev.budget, { label: 'vs. budget ' + fmt.eur(rev.budget) }) }),
            ui.kpi({ label: 'EBITDA YTD', value: fmt.eur(eb.actual), delta: ui.delta(eb.actual, eb.budget, { label: 'vs. budget ' + fmt.eur(eb.budget) }) }));
          const oneOffLabels = bva.map(x => x.actual.kpi.oneOffLabel).filter(Boolean).map(s => s.replace(/\s*\(eenmalig\)/i, ''));
          const tone = r => (r.variancePct != null ? Math.abs(r.variancePct) < MATERIAL_PCT : Math.abs(r.variance) < MATERIAL_EUR) ? 'neutral' : r.variance >= 0 ? 'good' : 'critical';
          const top = vrows.filter(r => !r.agg).slice().sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)).slice(0, 3);
          const sigList = h('div', { class: 'list' }, top.map(r => {
            const t = tone(r); const good = r.variance >= 0;
            let desc = r.oneOff ? 'niet begroot' + (oneOffLabels.length ? ': ' + oneOffLabels.join('; ') : '') : r.cost ? (good ? 'lager dan begroot' : 'hoger dan begroot') : (good ? 'boven budget' : 'onder budget');
            if (t === 'neutral') desc += ' · binnen ' + fmt.pct(MATERIAL_PCT, 0) + ' van het budget';
            return h('div', { class: 'list-item' }, h('span', { class: 'chip' + (t === 'neutral' ? '' : ' ' + t) }, H.icon(t === 'good' ? 'check' : t === 'critical' ? 'warn' : 'flat', 12)),
              h('div', null, h('div', { class: 'title' }, r.label + ': ' + fmt.signed(r.variance, fmt.eur) + (r.variancePct != null ? ' (' + fmt.signedPct(r.variancePct, 1) + ')' : '')), h('div', { class: 'desc' }, desc)));
          }));
          const grid3 = h('div', { class: 'grid' });
          grid3.appendChild(ui.card({ span: 4, title: 'Budget 2026 in één oogopslag', subtitle: 'YTD ' + ytdText, body: [sumKpis, h('div', { class: 'eyebrow' }, 'Grootste afwijkingen'), sigList], footer: 'Budget vastgesteld in november 2025; vergelijking op basis van de maanden met actuals.' }));

          const vTable = ui.table({
            class: 'statement',
            columns: [
              { key: 'label', label: 'Post', class: 'label' },
              { key: 'actual', label: 'Actual', align: 'num', format: fmt.eurK },
              { key: 'budget', label: 'Budget', align: 'num', format: fmt.eurK },
              { key: 'variance', label: 'Afwijking (€)', align: 'num', format: v => fmt.signed(v, fmt.eurK), signColor: true },
              { key: 'variancePct', label: 'Afwijking (%)', align: 'num', format: v => fmt.signedPct(v, 1), signColor: true }
            ],
            rows: vrows, rowClass: r => r.lvl
          });
          grid3.appendChild(ui.card({ span: 8, title: 'Budget 2026 versus actual', subtitle: 'afwijkingsanalyse per post, YTD ' + ytdText, body: vTable,
            footer: 'Afwijking = actual − budget; bij kostenposten budget − actual, zodat een positieve afwijking altijd gunstig is. Groen = gunstig, rood = ongunstig.' }));
          el.appendChild(grid3);

          // brug (afwijkingsbalken per post) + maandbeeld
          const grid4 = h('div', { class: 'grid' });
          const bridge = varianceBars(c, vrows.filter(r => !r.agg).map(r => ({ label: r.label, actual: r.actual, budget: r.budget, value: r.variance, pct: r.variancePct })), 'EBITDA-brug budget naar actual');
          grid4.appendChild(ui.card({ span: 8, title: 'EBITDA-brug budget → actual (YTD 2026)', subtitle: 'afwijking per post; positief = gunstig voor de EBITDA', body: ui.figure({ chart: bridge }),
            footer: 'EBITDA YTD ' + fmt.eur(eb.actual) + ' tegenover budget ' + fmt.eur(eb.budget) + ': afwijking ' + fmt.signed(eb.variance, fmt.eur) + (eb.variancePct != null ? ' (' + fmt.signedPct(eb.variancePct, 1) + ')' : '') + '; de posten hierboven tellen op tot dit verschil.' }));
          const ebMonthly = charts.bar({
            categories: bva.map(x => fmt.monthShort(x.period)),
            series: [{ name: 'Budget', values: bva.map(x => x.budget.pl.ebitda), color: 'var(--series-dim)' }, { name: 'Actual', values: bva.map(x => x.actual.pl.ebitda), color: H.util.seriesColor(1) }],
            yFormat: fmt.eur, height: 250, labels: 'none', tooltipTitle: i => fmt.monthLong(bva[i].period), xLabel: 'Maand'
          });
          grid4.appendChild(ui.card({ span: 4, title: 'EBITDA per maand', subtitle: 'actual tegenover budget, 2026', body: ui.figure({ chart: ebMonthly }) }));
          el.appendChild(grid4);
        } else {
          el.appendChild(ui.card({ title: 'Budget 2026 versus actual', subtitle: 'afwijkingsanalyse YTD', body: ui.note('De budgetanalyse verschijnt zodra het gekozen bereik actuals van 2026 bevat, bijvoorbeeld "YTD 2026", "Boekjaar 2026", "Laatste 12 maanden" of "2025–2027".'), class: 'flat' }));
        }

        // ---------- volledige W&V per periode ----------
        // venster van maximaal MAX_COLS kolommen: rond de laatste actual (12 actual + 4 forecast) of, zonder actuals, de eerste kolommen
        let c0 = 0, c1 = ser.length, lastAct = -1;
        ser.forEach((p, i) => { if (p.isActual) lastAct = i; });
        if (ser.length > MAX_COLS) {
          if (lastAct >= 0) { c1 = Math.min(ser.length, lastAct + 1 + FC_TAIL); c0 = Math.max(0, c1 - MAX_COLS); c1 = c0 + MAX_COLS; } else { c0 = 0; c1 = MAX_COLS; }
        }
        const cols = ser.slice(c0, c1);
        const anyOneOffC = ser.some(p => p.pl.oneOffCogs !== 0), anyOneOffO = ser.some(p => p.pl.oneOffOpex !== 0);
        const R = (label, lvl, f, o) => Object.assign({ label, lvl, pct: false, dash: false, values: ser.map(f) }, o || {});
        const stRows = [
          R('Netto-omzet', 'lvl0', p => p.pl.revenue),
          R('Materiaalkosten', 'lvl1', p => -p.pl.materialCost),
          R('Directe arbeid', 'lvl1', p => -p.pl.laborCost),
          R('Inkomende vracht', 'lvl1', p => -p.pl.freightCost),
          R('Garantiekosten', 'lvl1', p => -p.pl.warranty),
          anyOneOffC ? R('Eenmalige kostprijsposten', 'lvl1', p => -p.pl.oneOffCogs, { dash: true }) : null,
          R('Kostprijs van de omzet', 'lvl0', p => -p.pl.cogs),
          R('Brutowinst', 'key', p => p.pl.grossProfit),
          R('Brutomarge %', 'lvl2', p => p.kpi.grossMarginPct, { pct: true })
        ].concat(E.DEPTS.map(d => R('Personeel ' + E.DEPT_LABELS[d], 'lvl2', p => -p.pl.personnel[d]))).concat([
          R('Personeelskosten', 'lvl1', p => -p.pl.personnelTotal),
          R('Marketing', 'lvl1', p => -p.pl.marketing),
          R('Huisvesting', 'lvl2', p => -p.pl.housing),
          R('IT & software', 'lvl2', p => -p.pl.it),
          R('Overige algemene kosten', 'lvl2', p => -p.pl.other),
          R('Overige bedrijfskosten', 'lvl1', p => -(p.pl.housing + p.pl.it + p.pl.other)),
          anyOneOffO ? R('Eenmalige bedrijfskosten', 'lvl1', p => -p.pl.oneOffOpex, { dash: true }) : null,
          R('Bedrijfskosten', 'lvl0', p => -p.pl.opex),
          R('EBITDA', 'key', p => p.pl.ebitda),
          R('EBITDA %', 'lvl2', p => p.kpi.ebitdaPct, { pct: true }),
          R('Afschrijvingen', 'lvl1', p => -p.pl.dep),
          R('EBIT', 'lvl0', p => p.pl.ebit),
          R('Financiële baten en lasten', 'lvl1', p => -p.pl.netInterest),
          R('Resultaat voor belastingen', 'lvl0', p => p.pl.ebt),
          R('Vennootschapsbelasting', 'lvl1', p => -p.pl.tax),
          R('Nettowinst', 'key', p => p.pl.netIncome)
        ]).filter(Boolean);
        const fcMark = p => p.isActual ? '' : isMixed(p) ? ' F*' : ' F';
        const colLabel = p => p.isActual ? perLabel(p) + partialTxt(p) : h('span', { class: 'forecast' }, perLabel(p) + fcMark(p) + partialTxt(p));
        const fmtCell = (v, r) => r.pct ? pct1(v) : (r.dash && v === 0 ? '–' : fmt.eurK(v));
        const stCols = [{ key: 'label', label: 'Post', class: 'label' }].concat(cols.map((p, i) => ({ value: r => r.values[c0 + i], label: colLabel(p), align: 'num', format: fmtCell })));
        const anyFc = cols.some(p => !p.isActual), anyMixed = cols.some(isMixed), anyPartial = cols.some(p => p.partial);
        const windowed = ser.length > MAX_COLS;
        const tnote = h('div', { class: 'wv-tnote' },
          h('span', null, 'Bedragen × € 1.000; kosten als negatieve bedragen' + ((anyOneOffC || anyOneOffO) ? '; – = nihil' : '') + '.'),
          windowed ? h('span', null, 'Getoond: ' + perLabel(cols[0]) + ' – ' + perLabel(cols[cols.length - 1]) + ', ' + cols.length + ' van ' + ser.length + ' periodes' + (lastAct >= 0 ? ' rond de laatste actual' : '') + '; de CSV bevat alle ' + ser.length + ' periodes.') : null,
          anyPartial ? h('span', null, '(n mnd) = periode valt maar gedeeltelijk binnen het gekozen bereik.') : null,
          anyFc ? ui.chip('F = forecast, scenario ' + scLabel, 'forecast') : null,
          anyMixed ? h('span', null, 'F* = deels forecast.') : null);
        const stTable = ui.table({ class: 'statement', columns: stCols, rows: stRows, rowClass: r => r.lvl });
        const csvBtn = ui.button('Download CSV', () => {
          const sep = ';';
          const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
          const num = (v, pct) => pct ? String(Math.round(v * 10000) / 100).replace('.', ',') : String(Math.round(v));
          const head = ['Post'].concat(ser.map(p => perLabel(p) + fcMark(p) + partialTxt(p))).map(cell).join(sep);
          const lines = stRows.map(r => [cell(r.label + (r.pct ? ' (%)' : ''))].concat(r.values.map(v => num(v, r.pct))).join(sep));
          const csv = '﻿' + [head].concat(lines).join('\r\n');
          H.download('helder-wv-' + grain.toLowerCase() + '-' + range.from + '-' + range.to + '.csv', csv).catch(() => { csvBtn.lastChild.textContent = 'Download niet beschikbaar'; });
        }, { sm: true, icon: 'download', id: 'wv-csv', title: 'Alle ' + ser.length + ' periodes van het gekozen bereik als CSV' });
        el.appendChild(ui.card({ title: 'Winst-en-verliesrekening', subtitle: 'volledig overzicht per ' + gw + ' · ' + cols.length + (windowed ? ' van ' + ser.length : '') + ' kolommen', actions: csvBtn, body: [tnote, stTable] }));
      }
    }
  });
})();
