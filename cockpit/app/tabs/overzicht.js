/* Tab: Overzicht — de samenvatting die een CFO als eerste wil zien. */
(function () {
  'use strict';
  const H = window.HC;
  const GRAIN_WORD = { M: 'maand', Q: 'kwartaal', Y: 'jaar' };
  const DIM_WORD = { line: 'productlijn', channel: 'kanaal', country: 'land' };
  H.tabs.register({
    id: 'overzicht', label: 'Overzicht', short: 'Overzicht', order: 10, icon: 'home',
    render(root, ctx) {
      const { model, fmt, h, svg, ui, charts, E } = ctx;
      // Lokale lay-outregel (verzoek voor index.html): op een smal scherm staat de hero-tegel naast een gewone tegel,
      // zodat de zes tegels als 2+2+2 vallen en 'Nettoschuld / EBITDA' niet alleen op een rij overblijft.
      root.appendChild(h('style', null, '@media (max-width: 640px) { #tab-overzicht .kpi-row.hero-row .kpi.hero { grid-column: auto; } }'));
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
      root.appendChild(body);
      let runMs = null; // rekentijd van de laatste echte herberekening (zie build)
      const nowrap = s => h('span', { style: { whiteSpace: 'nowrap' } }, s);
      const statusValue = (ok, okText, badText) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', color: ok ? 'var(--good-ink)' : 'var(--critical-ink)' } }, H.icon(ok ? 'check' : 'warn', 18), ok ? okText : badText);
      const draw = (c) => { H.clear(body); build(body, c); };
      draw(ctx);
      ctx.subscribe(draw);

      function build(el, c) {
        const state = c.state; const grain = state.grain; const gw = GRAIN_WORD[grain];
        // één model.run() per render; als die niet uit de cache komt is dit meteen de gemeten rekentijd
        const t0 = performance.now(); const run = model.run(); const dt = performance.now() - t0;
        if (dt >= 0.5) runMs = dt;
        if (runMs == null) { const t1 = performance.now(); E.runScenario(model.dataset, model.assumptions(), { detail: false }); runMs = performance.now() - t1; } // eenmalig bij het openen, als de run al gememoized was
        const months = run.months;
        const last = model.lastActual(); const ltm = model.ltm(); const prior = model.priorLtm();
        const sc = model.scenarios[state.scenarioKey] || model.scenarios.basis;
        const scLabel = sc.label + (Object.keys(state.overrides || {}).length ? ' (aangepast)' : '');
        el.appendChild(h('div', { class: 'page-head' },
          h('div', null, h('h1', null, 'Overzicht'), h('p', null, 'Laatste twaalf maanden t/m ' + fmt.monthLong(last.period) + ', vergeleken met de twaalf maanden daarvoor. Forecast volgens scenario ' + scLabel + '. Korrel en periode gelden hier alleen voor de grafiek Omzet en EBITDA.')),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, ui.rangeChip({ from: E.addMonths(last.period, -11), to: last.period }, 'LTM'), ui.scenarioChip())));

        // ---------- KPI's ----------
        const trendEbitda = months.slice(model.actualCount - 24, model.actualCount).map(m => m.pl.ebitda);
        const kpis = h('div', { class: 'kpi-row hero-row' });
        kpis.appendChild(ui.kpi({ hero: true, label: 'EBITDA LTM', value: fmt.eurM(ltm.pl.ebitda), delta: ui.delta(ltm.pl.ebitda, prior.pl.ebitda, { label: 'vs. jaar ervoor' }), trend: trendEbitda, hint: 'EBITDA-marge ' + fmt.pct(ltm.kpi.ebitdaPct) + ' · trend 24 maanden' }));
        kpis.appendChild(ui.kpi({ label: 'Omzet LTM', value: fmt.eurM(ltm.pl.revenue), delta: ui.delta(ltm.pl.revenue, prior.pl.revenue, { label: 'vs. jaar ervoor' }), hint: h('span', null, fmt.int(ltm.kpi.units) + ' verkochte ', nowrap('e-bikes'), ' · gem. prijs ', nowrap(fmt.eur(ltm.kpi.asp, { full: true }))) }));
        kpis.appendChild(ui.kpi({ label: 'Brutomarge LTM', value: fmt.pct(ltm.kpi.grossMarginPct), delta: ui.deltaPp(ltm.kpi.grossMarginPct, prior.kpi.grossMarginPct, { label: 'vs. jaar ervoor' }), hint: 'na terugroepactie en celprijsspike 2025' }));
        kpis.appendChild(ui.kpi({ label: 'Nettowinst LTM', value: fmt.eurM(ltm.pl.netIncome), delta: ui.delta(ltm.pl.netIncome, prior.pl.netIncome, { label: 'vs. jaar ervoor' }), hint: 'na ' + fmt.eurM(ltm.pl.tax) + ' VPB' }));
        kpis.appendChild(ui.kpi({ label: 'Kas ' + fmt.month(last.period), value: fmt.eurM(last.bs.cash), delta: ui.delta(last.bs.cash, months[model.actualCount - 13].bs.cash, { label: 'vs. jaar ervoor' }), hint: 'RCF-ruimte ' + fmt.eurM(last.kpi.rcfHeadroom) }));
        const lev = last.kpi.leverage; const levMax = model.config.covenantLeverageMax;
        kpis.appendChild(ui.kpi({ label: 'Nettoschuld / EBITDA', value: last.kpi.netDebt < 0 ? 'nettokas' : fmt.x(lev, 2), hint: (last.kpi.netDebt < 0 ? fmt.eurM(-last.kpi.netDebt) + ' nettokas · ' : fmt.eurM(last.kpi.netDebt) + ' nettoschuld · ') + 'convenant ≤ ' + fmt.x(levMax) }));
        el.appendChild(kpis);

        // ---------- rij 1: omzet & EBITDA-trend + convenanten ----------
        const grid1 = h('div', { class: 'grid' });
        const ser = model.series(grain);
        const fcIdx = ser.findIndex(p => !p.isActual);
        const isMixed = p => !p.isActual && !!p.months && p.months.some(m => m.isActual); // actual én forecast in één periode
        const partialTxt = p => p.partial ? ' (' + p.n + ' mnd)' : '';
        const mark = p => isMixed(p) ? '*' : '';
        const anyMixed = ser.some(isMixed), anyPartial = ser.some(p => p.partial);
        // gebeurtenissen: markers die op dezelfde (of bij een dichte maandreeks vrijwel dezelfde) x vallen worden samengevoegd tot '4·5'
        const evAnns = [];
        if (grain !== 'Y') {
          const mergeGap = Math.floor(ser.length / 40);
          model.events.forEach((ev, k) => {
            const i = ser.findIndex(p => p.months.some(m => m.period === ev.period)); if (i < 0) return;
            const prev = evAnns.length ? evAnns[evAnns.length - 1] : null;
            if (prev && i - prev.i <= mergeGap) { prev.n += '·' + (k + 1); prev.label += ' en ' + ev.title; } else evAnns.push({ i, n: String(k + 1), label: ev.title });
          });
        }
        const trend = charts.line({
          x: ser.map(p => p.key), labels: ser.map(p => fmt.period(p.key, grain) + mark(p) + partialTxt(p)),
          series: [{ name: 'Omzet', values: ser.map(p => p.pl.revenue), color: 'var(--series-1)', area: true }, { name: 'EBITDA', values: ser.map(p => p.pl.ebitda), color: 'var(--series-2)' }],
          forecastFrom: fcIdx >= 0 ? fcIdx : null, yFormat: fmt.eur, tooltipTitle: i => fmt.periodLong(ser[i].key, grain) + partialTxt(ser[i]) + (ser[i].isActual ? '' : isMixed(ser[i]) ? ' (deels forecast)' : ' (forecast)'),
          annotations: evAnns, ariaLabel: 'Omzet en EBITDA per ' + gw
        });
        // Samengevoegde markers ('4·5') passen niet in de cirkel (r 7,5) die charts.line tekent: vervang die cirkel door een pil op maat,
        // ook na elke responsive hertekening (de container wordt dan leeggemaakt en opnieuw gevuld). Verzoek voor charts.js: marker op maat van het label.
        if (evAnns.some(a => a.n.length > 1)) {
          const pillify = () => trend.el.querySelectorAll('circle[stroke="var(--ink-2)"]').forEach(c => {
            const t = c.nextElementSibling; if (!t || t.tagName !== 'text' || t.textContent.length <= 1) return;
            const w = charts.measure(t.textContent, '600 9.5px "IBM Plex Sans", system-ui, sans-serif') + 8; const cx = Number(c.getAttribute('cx')), cy = Number(c.getAttribute('cy'));
            c.replaceWith(svg('rect', { x: cx - w / 2, y: cy - 7.5, width: w, height: 15, rx: 7.5, fill: 'var(--surface)', stroke: 'var(--ink-2)', 'stroke-width': 1 }));
          });
          new MutationObserver(pillify).observe(trend.el, { childList: true });
        }
        // tabel-tweeling met de canonieke markering: 'Q4 2026 F', '2026*', '(n mnd)' en rijklasse forecast
        trend.table = () => ui.table({ columns: [{ key: 'label', label: 'Periode' }, { key: 'rev', label: 'Omzet', align: 'num', format: fmt.eur }, { key: 'ebitda', label: 'EBITDA', align: 'num', format: fmt.eur }],
          rows: ser.map(p => ({ label: fmt.period(p.key, grain) + (isMixed(p) ? '*' : p.isActual ? '' : ' F') + partialTxt(p), rev: p.pl.revenue, ebitda: p.pl.ebitda, isActual: p.isActual })), rowClass: r => r.isActual ? '' : 'forecast' });
        const trendSub = 'per ' + gw + ' · gearceerd = forecast' + (anyMixed ? ' · * = deels forecast' : '') + (anyPartial ? ' · (n mnd) = deel van de periode in het bereik' : '');
        grid1.appendChild(ui.card({ span: 8, title: 'Omzet en EBITDA', subtitle: trendSub, body: ui.figure({ chart: trend, note: evAnns.length ? 'Gebeurtenissen: ' + evAnns.map(a => a.n + ' ' + a.label).join(' · ') : null }) }));
        // convenanten
        const cov = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } });
        const levOk = last.kpi.covenantLeverageOk, icrOk = last.kpi.covenantIcrOk; const icr = last.kpi.icr, icrScale = 12;
        const levMeter = charts.meter(Math.max(0, lev), levMax, levOk ? (lev > levMax * 0.8 ? 'warning' : '') : 'critical');
        levMeter.setAttribute('aria-label', 'Nettoschuld / EBITDA, limiet ' + fmt.x(levMax)); levMeter.setAttribute('aria-valuetext', last.kpi.netDebt < 0 ? 'nettokas' : fmt.x(lev, 2));
        const icrMeter = charts.meter(Math.min(icr, icrScale), icrScale, icrOk ? '' : 'critical');
        icrMeter.setAttribute('aria-label', 'Rentedekking, minimum ' + fmt.x(model.config.covenantIcrMin)); icrMeter.setAttribute('aria-valuenow', icr); icrMeter.setAttribute('aria-valuemax', Math.max(icrScale, icr)); icrMeter.setAttribute('aria-valuetext', fmt.x(icr));
        const rcfMeter = charts.meter(last.bs.rcf, model.config.rcfLimit, last.bs.rcf / model.config.rcfLimit > 0.8 ? 'warning' : '');
        rcfMeter.setAttribute('aria-label', 'RCF benut, limiet ' + fmt.eurM(model.config.rcfLimit)); rcfMeter.setAttribute('aria-valuetext', fmt.eurM(last.bs.rcf));
        cov.appendChild(h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'Nettoschuld / EBITDA'), h('strong', { class: 'num' }, last.kpi.netDebt < 0 ? 'nettokas' : fmt.x(lev, 2))), levMeter, h('div', { class: 'small muted' }, 'limiet ' + fmt.x(levMax) + ' · ', ui.statusChip(levOk, 'binnen convenant', 'convenantbreuk'))));
        cov.appendChild(h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'Rentedekking (EBITDA / rente)'), h('strong', { class: 'num' }, fmt.x(icr))), icrMeter, h('div', { class: 'small muted' }, 'minimum ' + fmt.x(model.config.covenantIcrMin) + ' · ', ui.statusChip(icrOk, 'binnen convenant', 'convenantbreuk'))));
        cov.appendChild(h('div', null, h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', null, 'RCF benut'), h('strong', { class: 'num' }, fmt.eurM(last.bs.rcf) + ' / ' + fmt.eurM(model.config.rcfLimit))), rcfMeter, h('div', { class: 'small muted' }, 'minimumkas ' + fmt.eurM(model.config.minCash) + ' · kas ' + fmt.eurM(last.bs.cash))));
        // forecast-blik: eerste kwartaal waarin een convenant knelt
        const fcBreach = model.forecastMonths().find(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk));
        cov.appendChild(fcBreach ? ui.note('In dit scenario breekt de convenant voor het eerst in ' + fmt.monthLong(fcBreach.period) + '.', 'critical') : ui.note('In dit scenario blijven beide convenanten de hele forecast binnen de limiet.', 'accent'));
        grid1.appendChild(ui.card({ span: 4, title: 'Convenanten en liquiditeit', subtitle: 'stand ' + fmt.monthLong(last.period) + ', kwartaaltoets', body: cov }));
        el.appendChild(grid1);

        // ---------- rij 2: budget vs actual + omzetmix ----------
        const grid2 = h('div', { class: 'grid' });
        const bva = model.budgetVsActual().filter(x => x.actual);
        const bvaChart = charts.bar({ categories: bva.map(x => fmt.monthShort(x.period)), series: [{ name: 'Budget', values: bva.map(x => x.budget.pl.revenue), color: 'var(--series-dim)' }, { name: 'Actual', values: bva.map(x => x.actual.pl.revenue), color: 'var(--series-1)' }], yFormat: fmt.eur, height: 200, labels: 'none', tooltipTitle: i => fmt.monthLong(bva[i].period), ariaLabel: 'Omzet per maand: budget 2026 versus actual' });
        const ytdB = bva.reduce((s, x) => s + x.budget.pl.revenue, 0), ytdA = bva.reduce((s, x) => s + x.actual.pl.revenue, 0);
        const ytdBe = bva.reduce((s, x) => s + x.budget.pl.ebitda, 0), ytdAe = bva.reduce((s, x) => s + x.actual.pl.ebitda, 0);
        const bvaKpis = h('div', { class: 'kpi-row' },
          ui.kpi({ label: 'Omzet YTD', value: fmt.eurM(ytdA), delta: ui.delta(ytdA, ytdB, { label: 'vs. budget ' + fmt.eurM(ytdB) }) }),
          ui.kpi({ label: 'EBITDA YTD', value: fmt.eurM(ytdAe), delta: ui.delta(ytdAe, ytdBe, { label: 'vs. budget ' + fmt.eurM(ytdBe) }) }));
        grid2.appendChild(ui.card({ span: 6, title: 'Budget 2026 versus actual', subtitle: 'omzet per maand, januari t/m ' + fmt.monthLong(last.period), body: [bvaKpis, ui.figure({ chart: bvaChart })], footer: 'Budget vastgesteld in november 2025; de analyse per regel staat onder Winst & verlies.' }));
        const years = E.aggregate(months, 'Y').filter(y => y.year <= 2027);
        const dim = state.split || 'line'; const keys = H.util.dimKeys(dim); const field = H.util.dimField(dim);
        const yFc = years.findIndex(y => !y.isActual);
        const mix = charts.bar({ categories: years.map(y => y.key + (y.isActual ? '' : (isMixed(y) ? '*' : ' F'))), series: keys.map((k, i) => ({ name: dim === 'country' ? H.util.countryName(k) : k, values: years.map(y => y[field][k].revenue), color: H.util.seriesColor(i + 1) })), stacked: true, yFormat: fmt.eur, height: 200, labels: 'all', forecastFrom: yFc >= 0 ? yFc : null, ariaLabel: 'Omzetmix per jaar per ' + DIM_WORD[dim] });
        const splitCtl = ui.segmented({ id: 'ov-split', label: 'Splitsing', value: dim, options: [{ value: 'line', label: 'Productlijn' }, { value: 'channel', label: 'Kanaal' }, { value: 'country', label: 'Land' }], onChange: v => H.state.set({ split: v }) });
        grid2.appendChild(ui.card({ span: 6, title: 'Omzetmix per jaar', subtitle: 'boekjaren ' + years[0].key + ' t/m ' + years[years.length - 1].key + ' · gearceerd = forecast · * = deels forecast · F = forecast', actions: splitCtl, body: ui.figure({ chart: mix }) }));
        el.appendChild(grid2);

        // ---------- rij 3: signalen + tijdlijn ----------
        const grid3 = h('div', { class: 'grid' });
        const signals = [];
        const gmDelta = ltm.kpi.grossMarginPct - prior.kpi.grossMarginPct;
        signals.push({ tone: gmDelta >= 0 ? 'good' : 'warning', title: 'Brutomarge ' + fmt.pp(gmDelta) + ' op jaarbasis', desc: fmt.pct(ltm.kpi.grossMarginPct) + ' vs. ' + fmt.pct(prior.kpi.grossMarginPct) + ' een jaar eerder; ' + (gmDelta >= 0 ? 'prijsverhoging van oktober 2025 en genormaliseerde celprijzen compenseren de materiaalkosten.' : 'celprijsspike en terugroepactie drukken de marge; de prijsverhoging werkt nog door.') });
        const deShare = ltm.byCountry.DE.revenue / ltm.pl.revenue, deSharePrior = prior.byCountry.DE.revenue / prior.pl.revenue;
        const dDso = Math.round(ltm.kpi.dso - prior.kpi.dso);
        const dsoTxt = dDso > 0 ? 'de uitrol kost ' + fmt.int(dDso) + (dDso === 1 ? ' extra debiteurendag' : ' extra debiteurendagen') : dDso < 0 ? 'de debiteurentermijn daalde met ' + fmt.int(-dDso) + (dDso === -1 ? ' dag' : ' dagen') : 'de debiteurentermijn bleef gelijk';
        signals.push({ tone: 'accent', title: 'Duitsland nu ' + fmt.pct(deShare, 0) + ' van de omzet', desc: 'Was ' + fmt.pct(deSharePrior, 0) + ' een jaar eerder; ' + dsoTxt + '.' });
        const leaseShare = ltm.byChannel.Lease.revenue / ltm.pl.revenue;
        const chGrowth = E.CHANNELS.map(k => ({ k, g: prior.byChannel[k].revenue > 0 ? ltm.byChannel[k].revenue / prior.byChannel[k].revenue - 1 : null })).filter(x => x.g != null).sort((a, b) => b.g - a.g);
        const leaseG = chGrowth.find(x => x.k === 'Lease'); const fastest = chGrowth[0];
        const leaseTxt = !leaseG ? '' : 'Groeit ' + fmt.signedPct(leaseG.g, 0) + ' vs. jaar ervoor' + (fastest.k === 'Lease' ? ', het snelst van de drie kanalen' : '; ' + fastest.k + ' groeit sneller (' + fmt.signedPct(fastest.g, 0) + ')') + '; ';
        signals.push({ tone: 'accent', title: 'Leasekanaal ' + fmt.pct(leaseShare, 0) + ' van de omzet', desc: leaseTxt + (leaseTxt ? 'let' : 'Let') + ' op de langere betaaltermijnen van leasemaatschappijen.' });
        const oneoffs = months.slice(model.actualCount - 12, model.actualCount).filter(m => m.pl.oneOffCogs + m.pl.oneOffOpex > 0);
        if (oneoffs.length) signals.push({ tone: 'warning', title: fmt.eur(oneoffs.reduce((s, m) => s + m.pl.oneOffCogs + m.pl.oneOffOpex, 0)) + ' eenmalige posten in de laatste twaalf maanden', desc: oneoffs.map(m => fmt.month(m.period) + ': ' + m.kpi.oneOffLabel).join(' · ') });
        const minCashFc = model.forecastMonths().reduce((a, m) => m.bs.cash < a.bs.cash ? m : a, model.forecastMonths()[0]);
        signals.push({ tone: minCashFc.bs.cash <= model.config.minCash + 1 ? 'warning' : 'good', title: 'Laagste kas in forecast: ' + fmt.eurM(minCashFc.bs.cash) + ' in ' + fmt.month(minCashFc.period), desc: minCashFc.bs.cash <= model.config.minCash + 1 ? 'Het rekening-courantkrediet wordt dan aangesproken (' + fmt.eurM(minCashFc.bs.rcf) + ').' : 'Het rekening-courantkrediet blijft onbenut.' });
        const sigList = h('div', { class: 'list' }, signals.map(s => h('div', { class: 'list-item' }, h('span', { class: 'chip ' + s.tone }, H.icon(s.tone === 'good' ? 'check' : s.tone === 'warning' ? 'warn' : 'info', 12)), h('div', null, h('div', { class: 'title' }, s.title), h('div', { class: 'desc' }, s.desc)))));
        grid3.appendChild(ui.card({ span: 6, title: 'Signalen', subtitle: 'automatisch afgeleid uit het model', body: sigList }));
        // tijdlijn: genummerd zoals de markers in de grafiek Omzet en EBITDA
        const tl = h('div', { class: 'timeline' }, model.events.map((ev, k) => h('div', { class: 'tl-item' }, h('div', { class: 'tl-date' }, fmt.month(ev.period)), h('div', { class: 'tl-dot' }), h('div', { class: 'tl-body' }, h('div', { class: 'tl-title' }, h('span', { class: 'muted', style: { fontVariantNumeric: 'tabular-nums' } }, (k + 1) + ' '), ev.title), h('div', { class: 'tl-text' }, ev.text)))).reverse());
        grid3.appendChild(ui.card({ span: 6, title: 'Gebeurtenissen', subtitle: 'wat de cijfers verklaart · genummerd zoals in de grafiek Omzet en EBITDA', body: tl }));
        el.appendChild(grid3);

        // ---------- integriteit ----------
        const cfDiff = months.reduce((a, m) => Math.max(a, Math.abs(m.cf.cashClose - m.bs.cash)), 0);
        const bsOk = run.maxCheck < 0.01, cfOk = cfDiff < 0.01;
        const firstP = run.periods[0], lastP = run.periods[run.periods.length - 1];
        const integ = h('div', { class: 'kpi-row' },
          ui.kpi({ label: 'Balanscontrole', value: statusValue(bsOk, 'sluit', 'sluit niet'), hint: 'activa − passiva − eigen vermogen, max. ' + fmt.eur(run.maxCheck, { full: true }) + ' over ' + months.length + ' maanden' }),
          ui.kpi({ label: 'Kasstroom ↔ balans', value: statusValue(cfOk, 'sluit', 'sluit niet'), hint: 'max. ' + fmt.eur(cfDiff, { full: true }) + ' verschil tussen eindkas en balanskas over ' + months.length + ' maanden' }),
          ui.kpi({ label: 'Modelhorizon', value: firstP.slice(0, 4) + ' – ' + lastP.slice(0, 4), hint: fmt.month(firstP) + ' – ' + fmt.month(lastP) + ' · ' + model.actualCount + ' maanden actual, ' + (months.length - model.actualCount) + ' maanden forecast' }),
          ui.kpi({ label: 'Rekentijd', value: fmt.num(Math.max(1, runMs), 0) + ' ms', hint: 'volledige drie-statement herberekening van ' + months.length + ' maanden, laatst gemeten' }));
        el.appendChild(ui.card({ title: 'Modelintegriteit', subtitle: 'winst-en-verliesrekening, balans en kasstroomoverzicht vormen één gesloten systeem', body: integ, class: 'flat' }));
      }
    }
  });
})();
