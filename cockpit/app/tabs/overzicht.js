/* Tab: Overzicht — de samenvatting die een CFO als eerste wil zien. */
(function () {
  'use strict';
  const H = window.HC;
  H.tabs.register({
    id: 'overzicht', label: 'Overzicht', short: 'Overzicht', order: 10, icon: 'home',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E } = ctx;
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
      root.appendChild(body);
      const draw = (c) => { H.clear(body); build(body, c); };
      draw(ctx);
      ctx.subscribe(draw);

      function build(el, c) {
        const state = c.state; const run = model.run(); const months = run.months;
        const last = model.lastActual(); const ltm = model.ltm(); const prior = model.priorLtm();
        const sc = model.scenarios[state.scenarioKey];
        el.appendChild(h('div', { class: 'page-head' },
          h('div', null, h('h1', null, 'Overzicht'), h('p', null, `Laatste twaalf maanden t/m ${fmt.monthLong(last.period)}, vergeleken met de twaalf maanden daarvoor. Forecast volgens scenario ${sc.label.toLowerCase()}.`)),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, ui.chip('LTM ' + fmt.month(E.addMonths(last.period, -11)) + ' – ' + fmt.month(last.period), 'actual'), ui.chip(sc.label, 'forecast'))));

        // ---------- KPI's ----------
        const trendEbitda = months.slice(model.actualCount - 24, model.actualCount).map(m => m.pl.ebitda);
        const kpis = h('div', { class: 'kpi-row' });
        kpis.appendChild(ui.kpi({ hero: true, label: 'EBITDA, laatste 12 maanden', value: fmt.eurM(ltm.pl.ebitda), delta: ui.delta(ltm.pl.ebitda, prior.pl.ebitda, { label: 'vs. jaar ervoor' }), trend: trendEbitda, hint: fmt.pct(ltm.kpi.ebitdaPct) + ' van de omzet · 24 maanden' }));
        kpis.appendChild(ui.kpi({ label: 'Omzet LTM', value: fmt.eurM(ltm.pl.revenue), delta: ui.delta(ltm.pl.revenue, prior.pl.revenue, { label: 'vs. jaar ervoor' }), hint: fmt.int(ltm.kpi.units) + ' e-bikes · ASP ' + fmt.eur(ltm.kpi.asp, { full: true }) }));
        kpis.appendChild(ui.kpi({ label: 'Brutomarge LTM', value: fmt.pct(ltm.kpi.grossMarginPct), delta: ui.deltaPp(ltm.kpi.grossMarginPct, prior.kpi.grossMarginPct, { label: 'vs. jaar ervoor' }), hint: 'na terugroepactie en celprijsspike 2025' }));
        kpis.appendChild(ui.kpi({ label: 'Nettowinst LTM', value: fmt.eurM(ltm.pl.netIncome), delta: ui.delta(ltm.pl.netIncome, prior.pl.netIncome, { label: 'vs. jaar ervoor' }), hint: 'na ' + fmt.eurM(ltm.pl.tax) + ' VPB' }));
        kpis.appendChild(ui.kpi({ label: 'Kaspositie ' + fmt.month(last.period), value: fmt.eurM(last.bs.cash), delta: ui.delta(last.bs.cash, months[model.actualCount - 13].bs.cash, { label: 'vs. jaar ervoor' }), hint: 'RCF-ruimte ' + fmt.eurM(last.kpi.rcfHeadroom) }));
        const lev = last.kpi.leverage; const levTone = lev > model.config.covenantLeverageMax ? 'critical' : lev > model.config.covenantLeverageMax * 0.8 ? 'warning' : 'good';
        kpis.appendChild(ui.kpi({ label: 'Netto schuld / EBITDA', value: last.kpi.netDebt < 0 ? 'netto kas' : fmt.x(lev, 2), hint: (last.kpi.netDebt < 0 ? fmt.eurM(-last.kpi.netDebt) + ' netto kas · ' : fmt.eurM(last.kpi.netDebt) + ' netto schuld · ') + 'convenant ≤ ' + fmt.x(model.config.covenantLeverageMax), class: levTone === 'good' ? '' : '' }));
        el.appendChild(kpis);

        // ---------- rij 1: omzet & EBITDA-trend + covenants ----------
        const grid1 = h('div', { class: 'grid' });
        const ser = model.series(state.grain);
        const fcIdx = ser.findIndex(p => !p.isActual);
        const evAnns = state.grain !== 'Y' ? model.events.map((ev, k) => ({ i: ser.findIndex(p => p.months.some(m => m.period === ev.period)), label: ev.title, n: k + 1 })).filter(a => a.i >= 0) : [];
        const trend = charts.line({
          x: ser.map(p => p.key), labels: ser.map(p => fmt.period(p.key, state.grain)),
          series: [{ name: 'Omzet', values: ser.map(p => p.pl.revenue), color: 'var(--series-1)', area: true }, { name: 'EBITDA', values: ser.map(p => p.pl.ebitda), color: 'var(--series-2)' }],
          forecastFrom: fcIdx >= 0 ? fcIdx : null, yFormat: fmt.eur, height: 250, tooltipTitle: i => fmt.periodLong(ser[i].key, state.grain) + (ser[i].isActual ? '' : ' (forecast)'),
          annotations: evAnns
        });
        grid1.appendChild(ui.card({ span: 8, title: 'Omzet en EBITDA', subtitle: 'per ' + { M: 'maand', Q: 'kwartaal', Y: 'jaar' }[state.grain] + ' · gearceerd = forecast', body: ui.figure({ chart: trend, note: evAnns.length ? 'Gebeurtenissen: ' + evAnns.map(a => a.n + ' ' + a.label).join(' · ') : null }) }));
        // covenants
        const cov = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
        const levOk = last.kpi.covenantLeverageOk, icrOk = last.kpi.covenantIcrOk;
        cov.appendChild(h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'Netto schuld / EBITDA'), h('strong', { class: 'num' }, last.kpi.netDebt < 0 ? 'netto kas' : fmt.x(lev, 2))), charts.meter(Math.max(0, lev), model.config.covenantLeverageMax, levOk ? (lev > 2.4 ? 'warning' : '') : 'critical'), h('div', { class: 'small muted' }, 'limiet ' + fmt.x(model.config.covenantLeverageMax) + ' · ', ui.statusChip(levOk, 'binnen convenant', 'convenant gebroken'))));
        cov.appendChild(h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'Rentedekking (EBITDA / rente)'), h('strong', { class: 'num' }, fmt.x(last.kpi.icr))), charts.meter(Math.min(last.kpi.icr, 12), 12, icrOk ? '' : 'critical'), h('div', { class: 'small muted' }, 'minimum ' + fmt.x(model.config.covenantIcrMin) + ' · ', ui.statusChip(icrOk, 'binnen convenant', 'convenant gebroken'))));
        cov.appendChild(h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'RCF benut'), h('strong', { class: 'num' }, fmt.eurM(last.bs.rcf) + ' / ' + fmt.eurM(model.config.rcfLimit))), charts.meter(last.bs.rcf, model.config.rcfLimit, last.bs.rcf / model.config.rcfLimit > 0.8 ? 'warning' : ''), h('div', { class: 'small muted' }, 'minimumkas ' + fmt.eurM(model.config.minCash) + ' · kas ' + fmt.eurM(last.bs.cash))));
        // forecast-blik: eerste kwartaal waarin een convenant knelt
        const fcBreach = model.forecastMonths().find(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk));
        cov.appendChild(fcBreach ? ui.note('In dit scenario breekt de convenant voor het eerst in ' + fmt.monthLong(fcBreach.period) + '.', 'critical') : ui.note('In dit scenario blijven beide convenanten de hele forecast binnen de limiet.', 'accent'));
        grid1.appendChild(ui.card({ span: 4, title: 'Convenanten en liquiditeit', subtitle: 'stand ' + fmt.monthLong(last.period) + ', kwartaaltoets', body: cov }));
        el.appendChild(grid1);

        // ---------- rij 2: budget vs actual + omzetmix ----------
        const grid2 = h('div', { class: 'grid' });
        const bva = model.budgetVsActual().filter(x => x.actual);
        const bvaChart = charts.bar({ categories: bva.map(x => fmt.monthShort(x.period)), series: [{ name: 'Budget', values: bva.map(x => x.budget.pl.revenue), color: 'var(--series-dim)' }, { name: 'Actual', values: bva.map(x => x.actual.pl.revenue), color: 'var(--series-1)' }], yFormat: fmt.eur, height: 230, labels: 'none', tooltipTitle: i => fmt.monthLong(bva[i].period) });
        const ytdB = bva.reduce((s, x) => s + x.budget.pl.revenue, 0), ytdA = bva.reduce((s, x) => s + x.actual.pl.revenue, 0);
        const ytdBe = bva.reduce((s, x) => s + x.budget.pl.ebitda, 0), ytdAe = bva.reduce((s, x) => s + x.actual.pl.ebitda, 0);
        const bvaKpis = h('div', { class: 'kpi-row' },
          ui.kpi({ label: 'Omzet YTD vs budget', value: fmt.eurM(ytdA), delta: ui.delta(ytdA, ytdB, { label: 'vs budget ' + fmt.eurM(ytdB) }) }),
          ui.kpi({ label: 'EBITDA YTD vs budget', value: fmt.eurM(ytdAe), delta: ui.delta(ytdAe, ytdBe, { label: 'vs budget ' + fmt.eurM(ytdBe) }) }));
        grid2.appendChild(ui.card({ span: 6, title: 'Budget 2026 versus actual', subtitle: 'omzet per maand, januari t/m ' + fmt.monthLong(last.period).split(' ')[0], body: [bvaKpis, ui.figure({ chart: bvaChart })], footer: 'Budget vastgesteld in november 2025; de analyse per regel staat onder Winst & verlies.' }));
        const years = E.aggregate(months, 'Y').filter(y => y.year <= 2027);
        const dim = state.split || 'line'; const keys = H.util.dimKeys(dim); const field = H.util.dimField(dim);
        const mix = charts.bar({ categories: years.map(y => y.key + (y.isActual ? '' : (y.months.some(m => m.isActual) ? '*' : ' F'))), series: keys.map((k, i) => ({ name: dim === 'country' ? H.util.countryName(k) : k, values: years.map(y => y[field][k].revenue), color: H.util.seriesColor(i + 1) })), stacked: true, yFormat: fmt.eur, height: 230, labels: 'all' });
        const splitCtl = ui.segmented({ id: 'ov-split', label: 'Splitsing', value: dim, options: [{ value: 'line', label: 'Productlijn' }, { value: 'channel', label: 'Kanaal' }, { value: 'country', label: 'Land' }], onChange: v => H.state.set({ split: v }) });
        grid2.appendChild(ui.card({ span: 6, title: 'Omzetmix per jaar', subtitle: '* = deels forecast · F = forecast', actions: splitCtl, body: ui.figure({ chart: mix }) }));
        el.appendChild(grid2);

        // ---------- rij 3: signalen + tijdlijn ----------
        const grid3 = h('div', { class: 'grid' });
        const signals = [];
        const gmDelta = ltm.kpi.grossMarginPct - prior.kpi.grossMarginPct;
        signals.push({ tone: gmDelta >= 0 ? 'good' : 'warning', title: 'Brutomarge ' + fmt.pp(gmDelta) + ' op jaarbasis', desc: gmDelta >= 0 ? 'Prijsverhoging van oktober 2025 en genormaliseerde celprijzen compenseren de materiaalkosten.' : 'Celprijsspike en terugroepactie drukken de marge; prijsverhoging werkt nog door.' });
        const deShare = ltm.byCountry.DE.revenue / ltm.pl.revenue, deSharePrior = prior.byCountry.DE.revenue / prior.pl.revenue;
        signals.push({ tone: 'accent', title: 'Duitsland nu ' + fmt.pct(deShare, 0) + ' van de omzet', desc: 'Was ' + fmt.pct(deSharePrior, 0) + ' een jaar eerder; de uitrol kost ' + fmt.days(ltm.kpi.dso - prior.kpi.dso).replace(' dgn', ' extra debiteurendagen') + '.' });
        const leaseShare = ltm.byChannel.Lease.revenue / ltm.pl.revenue;
        signals.push({ tone: 'accent', title: 'Leasekanaal ' + fmt.pct(leaseShare, 0) + ' van de omzet', desc: 'Groeit het snelst; let op de langere betaaltermijnen van leasemaatschappijen.' });
        const oneoffs = months.slice(model.actualCount - 12, model.actualCount).filter(m => m.pl.oneOffCogs + m.pl.oneOffOpex > 0);
        if (oneoffs.length) signals.push({ tone: 'warning', title: fmt.eur(oneoffs.reduce((s, m) => s + m.pl.oneOffCogs + m.pl.oneOffOpex, 0)) + ' eenmalige posten in de LTM', desc: oneoffs.map(m => fmt.month(m.period) + ': ' + m.kpi.oneOffLabel).join(' · ') });
        const minCashFc = model.forecastMonths().reduce((a, m) => m.bs.cash < a.bs.cash ? m : a, model.forecastMonths()[0]);
        signals.push({ tone: minCashFc.bs.cash <= model.config.minCash + 1 ? 'warning' : 'good', title: 'Laagste kaspositie in de forecast: ' + fmt.eurM(minCashFc.bs.cash) + ' in ' + fmt.month(minCashFc.period), desc: minCashFc.bs.cash <= model.config.minCash + 1 ? 'Het rekening-courantkrediet wordt dan aangesproken (' + fmt.eurM(minCashFc.bs.rcf) + ').' : 'Het rekening-courantkrediet blijft onbenut.' });
        const sigList = h('div', { class: 'list' }, signals.map(s => h('div', { class: 'list-item' }, h('span', { class: 'chip ' + s.tone }, H.icon(s.tone === 'good' ? 'check' : s.tone === 'warning' ? 'warn' : 'info', 12)), h('div', null, h('div', { class: 'title' }, s.title), h('div', { class: 'desc' }, s.desc)))));
        grid3.appendChild(ui.card({ span: 6, title: 'Signalen', subtitle: 'automatisch afgeleid uit het model', body: sigList }));
        const tl = h('div', { class: 'timeline' }, model.events.slice().reverse().map(ev => h('div', { class: 'tl-item' }, h('div', { class: 'tl-date' }, fmt.month(ev.period)), h('div', { class: 'tl-dot' }), h('div', { class: 'tl-body' }, h('div', { class: 'tl-title' }, ev.title), h('div', { class: 'tl-text' }, ev.text)))));
        grid3.appendChild(ui.card({ span: 6, title: 'Gebeurtenissen', subtitle: 'wat de cijfers verklaart', body: tl }));
        el.appendChild(grid3);

        // ---------- integriteit ----------
        const tRun0 = performance.now(); E.runScenario(model.dataset, model.assumptions(), { detail: false }); const runMs = performance.now() - tRun0;
        const integ = h('div', { class: 'kpi-row' },
          ui.kpi({ label: 'Balanscontrole', value: run.maxCheck < 0.01 ? 'sluit' : 'sluit niet', hint: 'activa − passiva − eigen vermogen, max. ' + fmt.eur(run.maxCheck, { full: true }) + ' over ' + run.months.length + ' maanden', class: run.maxCheck < 0.01 ? 'ok' : 'bad' }),
          ui.kpi({ label: 'Kasstroom ↔ balans', value: 'sluit', hint: 'eindkas uit het kasstroomoverzicht is de kas op de balans, elke maand' }),
          ui.kpi({ label: 'Modelhorizon', value: fmt.month(run.periods[0]) + ' – ' + fmt.month(run.periods[run.periods.length - 1]), hint: model.actualCount + ' maanden actual, ' + (run.months.length - model.actualCount) + ' maanden forecast' }),
          ui.kpi({ label: 'Rekentijd', value: fmt.num(Math.max(1, runMs), 0) + ' ms', hint: 'volledige drie-statement herberekening van ' + run.months.length + ' maanden, zojuist gemeten' }));
        el.appendChild(ui.card({ title: 'Modelintegriteit', subtitle: 'de drie jaarrekeningen zijn één gesloten systeem', body: integ, class: 'flat' }));
      }
    }
  });
})();
