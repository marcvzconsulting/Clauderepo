/* Tab: Winst & verlies — marges, kostenstructuur, omzetmix, unit economics, budget 2026 en de volledige W&V per periode. */
(function () {
  'use strict';
  const H = window.HC;
  const GRAIN_WORD = { M: 'maand', Q: 'kwartaal', Y: 'jaar' };
  const MAX_COLS = 16;

  // Lokale helper: index.html kent geen span-5/span-7 en geen opmaak voor forecast-kopcellen.
  // Eenmalig toegevoegd vanuit dit tabblad; verzoek voor opname in core staat in het eindrapport (coreRequests).
  function ensureLocalCss() {
    if (document.getElementById('wv-local-css')) return;
    const st = document.createElement('style'); st.id = 'wv-local-css';
    st.textContent = '.span-7{grid-column:span 7}.span-5{grid-column:span 5}@media(max-width:1100px){.span-7,.span-5{grid-column:span 12}}'
      + 'table.data th .forecast{color:var(--muted);font-weight:500}';
    document.head.appendChild(st);
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
        const ser = model.series(grain);
        const fcIdx = ser.findIndex(p => !p.isActual);
        const fcFrom = fcIdx >= 0 ? fcIdx : null;
        const firstFc = E.addMonths(model.lastActualPeriod, 1);
        const perLabel = p => fmt.period(p.key, grain);
        const perLong = i => fmt.periodLong(ser[i].key, grain) + (ser[i].isActual ? '' : ' (forecast)');
        const gw = GRAIN_WORD[grain];

        // ---------- pagina-kop ----------
        const intro = 'Winst-en-verliesrekening per ' + gw + ', ' + fmt.monthLong(first.period) + ' t/m ' + fmt.monthLong(last.period)
          + (hasFc ? '; vanaf ' + fmt.monthLong(firstFc) + ' forecast volgens scenario ' + scLabel.toLowerCase() + '.' : '; uitsluitend actuals.');
        el.appendChild(h('div', { class: 'page-head' },
          h('div', null, h('h1', null, 'Winst & verlies'), h('p', null, intro)),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
            ui.chip(fmt.month(first.period) + ' – ' + fmt.month(last.period), 'actual'),
            hasFc ? ui.chip('Forecast: ' + scLabel, 'forecast') : null)));

        // ---------- KPI's over het bereik, vergeleken met de even lange periode ervoor ----------
        const n = inR.length;
        const idx0 = months.findIndex(m => m.period === first.period);
        const prevMs = idx0 >= n ? months.slice(idx0 - n, idx0) : null;
        const cur = model.sumMonths(inR, 'bereik');
        const prev = prevMs ? model.sumMonths(prevMs, 'vorig') : null;
        const prevLabel = prev ? 'vs. ' + (n === 1 ? fmt.month(prevMs[0].period) : fmt.month(prevMs[0].period) + ' – ' + fmt.month(prevMs[n - 1].period)) : null;
        const dl = (a, b) => prev ? ui.delta(a, b, { label: prevLabel }) : null;
        const dpp = (a, b) => prev ? ui.deltaPp(a, b, { label: prevLabel }) : null;
        const kpis = h('div', { class: 'kpi-row' });
        kpis.appendChild(ui.kpi({ label: 'Netto-omzet', value: fmt.eurM(cur.pl.revenue), delta: dl(cur.pl.revenue, prev && prev.pl.revenue), hint: n + (n === 1 ? ' maand' : ' maanden') + ' · ASP ' + fmt.eur(cur.kpi.asp, { full: true }) }));
        kpis.appendChild(ui.kpi({ label: 'Brutomarge %', value: fmt.pct(cur.kpi.grossMarginPct), delta: dpp(cur.kpi.grossMarginPct, prev && prev.kpi.grossMarginPct), hint: 'brutowinst ' + fmt.eurM(cur.pl.grossProfit) }));
        kpis.appendChild(ui.kpi({ label: 'EBITDA', value: fmt.eurM(cur.pl.ebitda), delta: dl(cur.pl.ebitda, prev && prev.pl.ebitda), hint: 'operationele kosten ' + fmt.eurM(cur.pl.opex) }));
        kpis.appendChild(ui.kpi({ label: 'EBITDA %', value: fmt.pct(cur.kpi.ebitdaPct), delta: dpp(cur.kpi.ebitdaPct, prev && prev.kpi.ebitdaPct), hint: 'EBIT ' + fmt.eurM(cur.pl.ebit) }));
        kpis.appendChild(ui.kpi({ label: 'Nettowinst', value: fmt.eurM(cur.pl.netIncome), delta: dl(cur.pl.netIncome, prev && prev.pl.netIncome), hint: 'na ' + fmt.eurM(cur.pl.tax) + ' VPB en ' + fmt.eurM(cur.pl.netInterest) + ' rente' }));
        kpis.appendChild(ui.kpi({ label: 'Eenheden', value: fmt.int(cur.kpi.units), delta: dl(cur.kpi.units, prev && prev.kpi.units), hint: 'verkochte e-bikes' }));
        el.appendChild(kpis);

        // ---------- rij 1: marges + kostenstructuur ----------
        const grid1 = h('div', { class: 'grid' });
        const marginChart = charts.line({
          x: ser.map(p => p.key), labels: ser.map(perLabel),
          series: [
            { name: 'Brutomarge %', values: ser.map(p => p.kpi.grossMarginPct), color: H.util.seriesColor(1) },
            { name: 'EBITDA %', values: ser.map(p => p.kpi.ebitdaPct), color: H.util.seriesColor(2) }
          ],
          forecastFrom: fcFrom, yFormat: fmt.pct, height: 250, baseline: 0, tooltipTitle: perLong, xLabel: 'Periode'
        });
        grid1.appendChild(ui.card({ span: 7, title: 'Marges per periode', subtitle: 'brutomarge en EBITDA-marge per ' + gw + (hasFc ? ' · gearceerd = forecast' : ''), body: ui.figure({ chart: marginChart }) }));

        const pctOf = (p, v) => p.pl.revenue > 0 ? v / p.pl.revenue : 0;
        const costDefs = [
          { name: 'Materiaal', f: pl => pl.materialCost },
          { name: 'Arbeid, vracht, garantie', f: pl => pl.laborCost + pl.freightCost + pl.warranty },
          { name: 'Personeel', f: pl => pl.personnelTotal },
          { name: 'Marketing', f: pl => pl.marketing },
          { name: 'Overige opex', f: pl => pl.housing + pl.it + pl.other + pl.oneOffOpex }
        ];
        const costChart = charts.bar({
          categories: ser.map(perLabel),
          series: costDefs.map((d, i) => ({ name: d.name, values: ser.map(p => pctOf(p, d.f(p.pl))), color: H.util.seriesColor(i + 1), format: v => fmt.pct(v, 1) })),
          stacked: true, yFormat: v => fmt.pct(v, 0), height: 250, labels: 'none', forecastFrom: fcFrom, tooltipTitle: perLong, xLabel: 'Periode'
        });
        const oneOffInRange = ser.some(p => p.pl.oneOffCogs > 0);
        grid1.appendChild(ui.card({ span: 5, title: 'Kostenstructuur', subtitle: 'kosten als % van de omzet per ' + gw, body: ui.figure({ chart: costChart, note: oneOffInRange ? 'Eenmalige kostprijsposten (terugroepactie) staan niet in de stapel; zie de W&V-tabel onderaan.' : null }) }));
        el.appendChild(grid1);

        // ---------- rij 2: omzet per dimensie + unit economics ----------
        const grid2 = h('div', { class: 'grid' });
        const dim = state.split || 'line'; const keys = H.util.dimKeys(dim); const field = H.util.dimField(dim);
        const mixChart = charts.bar({
          categories: ser.map(perLabel),
          series: keys.map((k, i) => ({ name: dim === 'country' ? H.util.countryName(k) : k, values: ser.map(p => p[field][k].revenue), color: H.util.seriesColor(i + 1) })),
          stacked: true, yFormat: fmt.eur, height: 260, labels: ser.length <= 8 ? 'all' : 'none', forecastFrom: fcFrom, tooltipTitle: perLong, xLabel: 'Periode'
        });
        const splitCtl = ui.segmented({ id: 'wv-split', label: 'Splitsing', value: dim, options: [{ value: 'line', label: 'Productlijn' }, { value: 'channel', label: 'Kanaal' }, { value: 'country', label: 'Land' }], onChange: v => H.state.set({ split: v }) });
        grid2.appendChild(ui.card({ span: 6, title: 'Omzet per ' + H.util.dimLabel(dim).toLowerCase(), subtitle: 'netto-omzet per ' + gw + ', gestapeld' + (hasFc ? ' · gearceerd = forecast' : ''), actions: splitCtl, body: ui.figure({ chart: mixChart }) }));

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
            { key: 'cpu', label: 'Kostprijs/fiets', align: 'num', format: eurFull },
            { key: 'margin', label: 'Marge/fiets', align: 'num', format: eurFull },
            { key: 'gm', label: 'Brutomarge', align: 'num', format: v => fmt.pct(v, 1) }
          ],
          rows: ueRows, footer: ueFoot, caption: 'Per fiets: gemiddelde verkoopprijs, kostprijs (materiaal, arbeid, vracht, garantie; excl. eenmalige posten) en marge.'
        });
        const ueChart = charts.bar({ categories: E.LINES, series: [{ name: 'Marge per fiets', values: ueRows.map(r => r.margin), color: H.util.seriesColor(1) }], horizontal: true, yFormat: eurFull, xLabel: 'Productlijn' });
        grid2.appendChild(ui.card({ span: 6, title: 'Unit economics per productlijn', subtitle: 'laatste twaalf maanden t/m ' + fmt.monthLong(model.lastActualPeriod) + ' · onafhankelijk van het gekozen bereik', body: [ueTable, ui.figure({ title: 'Marge per fiets', chart: ueChart })] }));
        el.appendChild(grid2);

        // ---------- rij 3: budget 2026 versus actual (YTD) ----------
        const has2026 = inR.some(m => m.year === 2026);
        if (has2026) {
          const bva = model.budgetVsActual().filter(x => x.actual);
          const sumB = f => bva.reduce((s, x) => s + f(x.budget.pl), 0), sumA = f => bva.reduce((s, x) => s + f(x.actual.pl), 0);
          const otherOpex = pl => pl.housing + pl.it + pl.other + pl.oneOffOpex;
          const vrows = [
            { label: 'Netto-omzet', f: pl => pl.revenue, cost: false, lvl: 'lvl0' },
            { label: 'Kostprijs omzet', f: pl => pl.cogs, cost: true, lvl: 'lvl1' },
            { label: 'Brutowinst', f: pl => pl.grossProfit, cost: false, lvl: 'key' },
            { label: 'Personeelskosten', f: pl => pl.personnelTotal, cost: true, lvl: 'lvl1' },
            { label: 'Marketing', f: pl => pl.marketing, cost: true, lvl: 'lvl1' },
            { label: 'Overige bedrijfskosten', f: otherOpex, cost: true, lvl: 'lvl1' },
            { label: 'EBITDA', f: pl => pl.ebitda, cost: false, lvl: 'key' }
          ].map(r => { const a = sumA(r.f), b = sumB(r.f); const v = r.cost ? b - a : a - b; return { label: r.label, actual: a, budget: b, variance: v, variancePct: b !== 0 ? v / Math.abs(b) : null, lvl: r.lvl, cost: r.cost }; });
          const ytdFrom = fmt.monthLong(bva[0].period).split(' ')[0], ytdTo = fmt.monthLong(bva[bva.length - 1].period).split(' ')[0];
          const vTable = ui.table({
            class: 'statement',
            columns: [
              { key: 'label', label: 'Post', class: 'label' },
              { key: 'actual', label: 'Actual', align: 'num', format: fmt.eurK },
              { key: 'budget', label: 'Budget', align: 'num', format: fmt.eurK },
              { key: 'variance', label: 'Afwijking (€)', align: 'num', format: v => fmt.signed(v, fmt.eurK), signColor: true },
              { key: 'variancePct', label: 'Afwijking (%)', align: 'num', format: v => fmt.signedPct(v, 1), signColor: true }
            ],
            rows: vrows, rowClass: r => r.lvl,
            caption: 'YTD 2026, ' + ytdFrom + ' t/m ' + ytdTo + ' · bedragen × € 1.000 · afwijking = actual − budget; bij kostenposten budget − actual, zodat een positieve afwijking altijd gunstig is.'
          });
          const g = k => vrows.find(r => r.label === k);
          const steps = [
            { label: 'Budget EBITDA', value: g('EBITDA').budget, type: 'total' },
            { label: 'Omzet', value: g('Netto-omzet').variance, type: 'delta' },
            { label: 'Kostprijs', value: g('Kostprijs omzet').variance, type: 'delta' },
            { label: 'Personeel', value: g('Personeelskosten').variance, type: 'delta' },
            { label: 'Marketing', value: g('Marketing').variance, type: 'delta' },
            { label: 'Overig', value: g('Overige bedrijfskosten').variance, type: 'delta' },
            { label: 'Actual EBITDA', value: g('EBITDA').actual, type: 'total' }
          ];
          const bridge = charts.waterfall({ steps, yFormat: fmt.eur, polarity: 'status', height: 280 });
          const eb = g('EBITDA');
          const grid3 = h('div', { class: 'grid' });
          grid3.appendChild(ui.card({ span: 6, title: 'Budget 2026 versus actual', subtitle: 'afwijkingsanalyse YTD, ' + ytdFrom + ' t/m ' + ytdTo + ' 2026', body: vTable, footer: 'Budget vastgesteld in november 2025. Groen = gunstig, rood = ongunstig.' }));
          grid3.appendChild(ui.card({ span: 6, title: 'EBITDA-brug budget → actual (YTD 2026)', subtitle: 'kostenstappen zijn zo getekend dat lagere kosten omhoog tellen', body: ui.figure({ chart: bridge }), footer: 'EBITDA YTD ' + fmt.eurM(eb.actual) + ' tegenover budget ' + fmt.eurM(eb.budget) + ': afwijking ' + fmt.signed(eb.variance, fmt.eur) + (eb.variancePct != null ? ' (' + fmt.signedPct(eb.variancePct, 1) + ')' : '') + '.' }));
          el.appendChild(grid3);
        } else {
          el.appendChild(ui.card({ title: 'Budget 2026 versus actual', subtitle: 'afwijkingsanalyse YTD', body: ui.note('De budgetanalyse verschijnt zodra het gekozen bereik maanden van 2026 bevat, bijvoorbeeld "YTD 2026", "Boekjaar 2026" of "2025–2027".'), class: 'flat' }));
        }

        // ---------- volledige W&V per periode ----------
        const cols = ser.length > MAX_COLS ? ser.slice(-MAX_COLS) : ser;
        const anyOneOffC = cols.some(p => p.pl.oneOffCogs !== 0), anyOneOffO = cols.some(p => p.pl.oneOffOpex !== 0);
        const R = (label, lvl, f, pct) => ({ label, lvl, pct: !!pct, values: cols.map(p => f(p)) });
        const stRows = [
          R('Netto-omzet', 'lvl0', p => p.pl.revenue),
          R('Materiaalkosten', 'lvl1', p => -p.pl.materialCost),
          R('Directe arbeid', 'lvl1', p => -p.pl.laborCost),
          R('Inkomende vracht', 'lvl1', p => -p.pl.freightCost),
          R('Garantiekosten', 'lvl1', p => -p.pl.warranty),
          anyOneOffC ? R('Eenmalige kostprijsposten', 'lvl1', p => -p.pl.oneOffCogs) : null,
          R('Kostprijs omzet', 'lvl0', p => -p.pl.cogs),
          R('Brutowinst', 'key', p => p.pl.grossProfit),
          R('Brutomarge %', 'lvl2', p => p.kpi.grossMarginPct, true)
        ].concat(E.DEPTS.map(d => R('Personeel ' + E.DEPT_LABELS[d], 'lvl1', p => -p.pl.personnel[d]))).concat([
          R('Marketing', 'lvl1', p => -p.pl.marketing),
          R('Huisvesting', 'lvl1', p => -p.pl.housing),
          R('IT & software', 'lvl1', p => -p.pl.it),
          R('Overige kosten', 'lvl1', p => -p.pl.other),
          anyOneOffO ? R('Eenmalige bedrijfskosten', 'lvl1', p => -p.pl.oneOffOpex) : null,
          R('Operationele kosten', 'lvl0', p => -p.pl.opex),
          R('EBITDA', 'key', p => p.pl.ebitda),
          R('EBITDA %', 'lvl2', p => p.kpi.ebitdaPct, true),
          R('Afschrijvingen', 'lvl1', p => -p.pl.dep),
          R('EBIT', 'lvl0', p => p.pl.ebit),
          R('Rentelasten netto', 'lvl1', p => -p.pl.netInterest),
          R('Resultaat voor belasting', 'lvl0', p => p.pl.ebt),
          R('Vennootschapsbelasting', 'lvl1', p => -p.pl.tax),
          R('Nettowinst', 'key', p => p.pl.netIncome)
        ]).filter(Boolean);
        const colLabel = p => {
          const base = perLabel(p);
          if (p.isActual) return base;
          const mixed = p.months.some(m => m.isActual);
          return h('span', { class: 'forecast' }, base + (mixed ? ' F*' : ' F'));
        };
        const stCols = [{ key: 'label', label: 'Post', class: 'label' }].concat(cols.map((p, i) => ({ value: r => r.values[i], label: colLabel(p), align: 'num', format: (v, r) => r.pct ? fmt.pct(v, 1) : fmt.eurK(v) })));
        const anyFc = cols.some(p => !p.isActual), anyMixed = cols.some(p => !p.isActual && p.months.some(m => m.isActual));
        const caption = h('span', null,
          'Bedragen × € 1.000; kosten als negatieve bedragen. ',
          ser.length > MAX_COLS ? 'Laatste ' + MAX_COLS + ' van ' + ser.length + ' periodes getoond; kies een kortere periode of grovere korrel in de filterbalk voor de rest. ' : null,
          anyFc ? [ui.chip('F = forecast, scenario ' + scLabel, 'forecast'), anyMixed ? ' F* = deels forecast' : null] : null);
        const stTable = ui.table({ class: 'statement', columns: stCols, rows: stRows, rowClass: r => r.lvl, caption });
        const csvBtn = ui.button('Download CSV', () => {
          const sep = ';';
          const cell = v => '"' + String(v).replace(/"/g, '""') + '"';
          const num = (v, pct) => pct ? String(Math.round(v * 10000) / 100).replace('.', ',') : String(Math.round(v));
          const head = ['Post'].concat(cols.map(p => perLabel(p) + (p.isActual ? '' : ' F'))).map(cell).join(sep);
          const lines = stRows.map(r => [cell(r.label + (r.pct ? ' (%)' : ''))].concat(r.values.map(v => num(v, r.pct))).join(sep));
          const csv = '﻿' + [head].concat(lines).join('\r\n');
          H.download('helder-wv-' + grain.toLowerCase() + '-' + range.from + '-' + range.to + '.csv', csv).catch(() => { csvBtn.lastChild.textContent = 'Download niet beschikbaar'; });
        }, { sm: true, icon: 'download', id: 'wv-csv' });
        el.appendChild(ui.card({ title: 'Winst-en-verliesrekening', subtitle: 'volledig overzicht per ' + gw + ' · ' + cols.length + ' kolommen', actions: csvBtn, body: stTable }));
      }
    }
  });
})();
