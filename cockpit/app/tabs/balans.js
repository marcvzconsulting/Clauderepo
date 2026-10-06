/* Tab: Balans & kasstroom — balans, kasstroomoverzicht, werkkapitaal, convenanten en schuldaflossing uit één gesloten drie-statement model. */
(function () {
  'use strict';
  const H = window.HC;
  const GRAIN_WORD = { M: 'maand', Q: 'kwartaal', Y: 'jaar' };
  const MAX_COLS = 16; // maximum aantal periodekolommen in de overzichten

  /* Lokale hulpstijlen: span-7/span-5 ontbreken in index.html; controle- en sectierijen voor de overzichten. (verzoek voor core: zie eindrapport) */
  function ensureLocalStyle() {
    if (document.getElementById('balans-local-style')) return;
    const st = document.createElement('style'); st.id = 'balans-local-style';
    st.textContent = [
      '.span-7 { grid-column: span 7; } .span-5 { grid-column: span 5; }',
      '@media (max-width: 1100px) { .span-7, .span-5 { grid-column: span 12; } }',
      '.statement tr.section td { font-weight: 600; color: var(--muted); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; padding-top: 10px; }',
      '.statement tr.check td { color: var(--muted); font-size: 11.5px; border-top: 1px solid var(--line-2); }',
      '.balans-scroll { max-height: 300px; overflow-y: auto; }',
      '.balans-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 14px; }',
      '.balans-fact .f-label { font-size: 11.5px; color: var(--muted); }',
      '.balans-fact .f-value { font-weight: 600; font-variant-numeric: tabular-nums; }',
      '.balans-fact .f-sub { font-size: 11.5px; color: var(--ink-2); }'
    ].join('\n');
    document.head.appendChild(st);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  H.tabs.register({
    id: 'balans', label: 'Balans & kasstroom', short: 'Balans', order: 30, icon: 'balance',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E } = ctx;
      ensureLocalStyle();
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
      root.appendChild(body);
      // op smalle schermen wordt de kasbrug samengevat; bij het passeren van de grens opnieuw tekenen
      const mq = window.matchMedia('(max-width: 640px)');
      const draw = (c) => { H.clear(body); build(body, c); };
      const onMq = () => { if (!body.isConnected) { if (mq.removeEventListener) mq.removeEventListener('change', onMq); return; } draw(H.tabs.context()); };
      if (mq.addEventListener) mq.addEventListener('change', onMq);
      draw(ctx);
      ctx.subscribe(draw);

      function build(el, c) {
        const state = c.state, grain = state.grain, range = c.range;
        const run = model.run(); const months = run.months;
        const inRange = months.filter(m => model.inRange(m, range));
        const ser = model.series(grain);
        if (!ser.length || !inRange.length) { el.appendChild(ui.note('Geen periodes in het gekozen bereik.')); return; }
        const last = ser[ser.length - 1];
        const sc = model.scenarios[state.scenarioKey] || model.scenarios.basis;
        const cfg = model.config;
        const fcIdx = ser.findIndex(p => !p.isActual);
        const forecastFrom = fcIdx >= 0 ? fcIdx : null;
        const compact = mq.matches;
        const pLabel = p => fmt.period(p.key, grain) + (p.partial ? '*' : '');
        const anyPartial = ser.some(p => p.partial);
        const keys = ser.map(p => p.key), labels = ser.map(pLabel);
        const tipTitle = i => fmt.periodLong(ser[i].key, grain) + (ser[i].partial ? ' (onvolledig)' : '') + (ser[i].isActual ? '' : ' (forecast)');
        const firstM = inRange[0], lastM = inRange[inRange.length - 1];
        const rangeLabel = fmt.month(firstM.period) + ' – ' + fmt.month(lastM.period);
        const prev = months.find(m => m.period === E.addMonths(last.period, -12));

        // ---------- paginakop ----------
        el.appendChild(h('div', { class: 'page-head' },
          h('div', null, h('h1', null, 'Balans en kasstroom'),
            h('p', null, `Balans en kasstroomoverzicht per ${GRAIN_WORD[grain]}: de stand aan het einde van elke periode in het gekozen bereik (${rangeLabel}). De kaspositie volgt uit het kasstroomoverzicht en de balans sluit elke maand.`)),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, ui.chip('Stand ' + fmt.monthLong(last.period), last.isActual ? 'actual' : 'forecast'), ui.chip(sc.label, 'forecast'))));

        // ---------- KPI's (einde bereik) ----------
        const bs = last.bs, kpi = last.kpi;
        const netDebt = kpi.netDebt; const isNetCash = netDebt < 0;
        const solv = bs.totalAssets > 0 ? bs.equity / bs.totalAssets : null;
        const wc = bs.ar + bs.inventory - bs.ap;
        const pv = prev ? { cash: prev.bs.cash, netDebt: prev.kpi.netDebt, equity: prev.bs.equity, solv: prev.bs.totalAssets > 0 ? prev.bs.equity / prev.bs.totalAssets : null, wc: prev.bs.ar + prev.bs.inventory - prev.bs.ap, ccc: prev.kpi.ccc } : null;
        const vsLabel = prev ? 'vs. ' + fmt.month(prev.period) : null;
        const kpis = h('div', { class: 'kpi-row' });
        kpis.appendChild(ui.kpi({ label: 'Liquide middelen', value: fmt.eurM(bs.cash), delta: pv ? ui.delta(bs.cash, pv.cash, { label: vsLabel }) : null, hint: 'RCF-ruimte ' + fmt.eurM(kpi.rcfHeadroom) + ' · minimumkas ' + fmt.eurM(cfg.minCash) }));
        kpis.appendChild(ui.kpi({ label: isNetCash ? 'Netto kas' : 'Netto schuld', value: fmt.eurM(Math.abs(netDebt)), delta: pv ? ui.delta(netDebt, pv.netDebt, { label: vsLabel, absolute: true, upIsGood: false, format: fmt.eurM }) : null,
          hint: isNetCash ? 'kas overtreft termijnlening en RCF (' + fmt.eurM(bs.termLoan + bs.rcf) + ')' : 'termijnlening ' + fmt.eurM(bs.termLoan) + ' + RCF ' + fmt.eurM(bs.rcf) + ' − kas' }));
        kpis.appendChild(ui.kpi({ label: 'Eigen vermogen', value: fmt.eurM(bs.equity), delta: pv ? ui.delta(bs.equity, pv.equity, { label: vsLabel }) : null, hint: 'balanstotaal ' + fmt.eurM(bs.totalAssets) }));
        kpis.appendChild(ui.kpi({ label: 'Solvabiliteit', value: fmt.pct(solv), delta: pv && pv.solv != null ? ui.deltaPp(solv, pv.solv, { label: vsLabel }) : null, hint: 'eigen vermogen / balanstotaal' }));
        kpis.appendChild(ui.kpi({ label: 'Werkkapitaal', value: fmt.eurM(wc), delta: pv ? ui.delta(wc, pv.wc, { label: vsLabel, absolute: true, upIsGood: false, format: fmt.eurM }) : null, hint: 'debiteuren + voorraden − crediteuren' }));
        const cccDelta = pv ? (() => { const d = kpi.ccc - pv.ccc; const dir = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down'; return { text: fmt.signed(d, fmt.days), dir, good: dir === 'flat' ? null : dir === 'down', label: vsLabel }; })() : null;
        kpis.appendChild(ui.kpi({ label: 'Kasconversiecyclus', value: fmt.days(kpi.ccc), delta: cccDelta, hint: 'DSO ' + fmt.int(kpi.dso) + ' + DIO ' + fmt.int(kpi.dio) + ' − DPO ' + fmt.int(kpi.dpo) + ' dagen' }));
        el.appendChild(kpis);

        // ---------- rij 1: kasbrug + werkkapitaaldagen ----------
        const grid1 = h('div', { class: 'grid' });
        const sumCf = key => inRange.reduce((s, m) => s + m.cf[key], 0);
        const cashOpen = firstM.cf.cashOpen, cashClose = lastM.cf.cashClose;
        const wcSteps = [['Mutatie debiteuren', sumCf('dAR')], ['Mutatie voorraden', sumCf('dInv')], ['Mutatie crediteuren', sumCf('dAP')], ['Mutatie belastingschuld', sumCf('dTax')]];
        const finSteps = [['Termijnlening', sumCf('tlDraw') + sumCf('tlRepay')], ['Rekening-courant', sumCf('rcfDraw') + sumCf('rcfRepay')], ['Dividend', sumCf('dividend')]];
        const eqRaise = sumCf('equityRaise'); if (Math.abs(eqRaise) > 0.5) finSteps.push(['Kapitaalstorting', eqRaise]);
        const steps = [{ label: 'Kas begin', value: cashOpen, type: 'total' }, { label: 'Nettowinst', value: sumCf('netIncome'), type: 'delta' }, { label: 'Afschrijvingen', value: sumCf('dep'), type: 'delta' }];
        if (compact) steps.push({ label: 'Werkkapitaal', value: wcSteps.reduce((s, x) => s + x[1], 0), type: 'delta' }); else for (const [l, v] of wcSteps) steps.push({ label: l, value: v, type: 'delta' });
        steps.push({ label: 'Investeringen', value: sumCf('capex'), type: 'delta' });
        if (compact) steps.push({ label: 'Financiering', value: finSteps.reduce((s, x) => s + x[1], 0), type: 'delta' }); else for (const [l, v] of finSteps) steps.push({ label: l, value: v, type: 'delta' });
        steps.push({ label: 'Kas eind', value: cashClose, type: 'total' });
        const bridgeDiff = cashOpen + steps.filter(s => s.type === 'delta').reduce((s, x) => s + x.value, 0) - cashClose;
        const bridge = charts.waterfall({ steps, yFormat: fmt.eur, height: 300, polarity: 'neutral', ariaLabel: 'Kasbrug ' + rangeLabel });
        grid1.appendChild(ui.card({ span: 7, title: 'Kasbrug ' + rangeLabel, subtitle: 'som van ' + inRange.length + ' maanden · + = instroom, − = uitstroom' + (compact ? ' · werkkapitaal en financiering samengevat' : ''),
          body: ui.figure({ chart: bridge, note: 'Kas eind ' + fmt.eurM(cashClose) + ' is de post Liquide middelen op de balans van ' + fmt.monthLong(lastM.period) + '.' }),
          footer: Math.abs(bridgeDiff) < 1 ? 'De brug sluit: kas begin plus alle mutaties is exact kas eind.' : 'Let op: de brug sluit niet (' + fmt.eur(bridgeDiff, { full: true }) + ' verschil).' }));
        const daysChart = charts.line({ x: keys, labels, series: [
          { name: 'DSO', values: ser.map(p => p.kpi.dso), color: 'var(--series-1)' }, { name: 'DIO', values: ser.map(p => p.kpi.dio), color: 'var(--series-2)' },
          { name: 'DPO', values: ser.map(p => p.kpi.dpo), color: 'var(--series-3)' }, { name: 'CCC', values: ser.map(p => p.kpi.ccc), color: 'var(--series-4)' }
        ], yFormat: fmt.days, yMin: 0, height: 300, forecastFrom, tooltipTitle: tipTitle, ariaLabel: 'Werkkapitaaldagen' });
        grid1.appendChild(ui.card({ span: 5, title: 'Werkkapitaaldagen', subtitle: 'stand einde periode · CCC = DSO + DIO − DPO', body: ui.figure({ chart: daysChart }) }));
        el.appendChild(grid1);

        // ---------- rij 2: kas & netto schuld + convenanten ----------
        const grid2 = h('div', { class: 'grid' });
        const cashLine = charts.line({ x: keys, labels, series: [
          { name: 'Liquide middelen', values: ser.map(p => p.bs.cash), color: 'var(--series-1)' },
          { name: 'Netto schuld', values: ser.map(p => p.kpi.netDebt), color: 'var(--series-2)' },
          { name: 'Minimumkas', values: ser.map(() => cfg.minCash), color: 'var(--series-dim)' }
        ], baseline: 0, yFormat: fmt.eur, height: 250, forecastFrom, tooltipTitle: tipTitle, ariaLabel: 'Kas en netto schuld' });
        const minCashM = inRange.reduce((a, m) => m.bs.cash < a.bs.cash ? m : a, inRange[0]);
        const maxDebtM = inRange.reduce((a, m) => m.kpi.netDebt > a.kpi.netDebt ? m : a, inRange[0]);
        const maxRcfM = inRange.reduce((a, m) => m.bs.rcf > a.bs.rcf ? m : a, inRange[0]);
        const fact = (label, value, sub) => h('div', { class: 'balans-fact' }, h('div', { class: 'f-label' }, label), h('div', { class: 'f-value' }, value), h('div', { class: 'f-sub' }, sub));
        const facts = h('div', { class: 'balans-facts' },
          fact('Laagste kas in bereik', fmt.eurM(minCashM.bs.cash), fmt.monthLong(minCashM.period) + (minCashM.bs.cash <= cfg.minCash + 1 ? ' · op de minimumkas' : '')),
          fact('Hoogste netto schuld', maxDebtM.kpi.netDebt < 0 ? 'netto kas' : fmt.eurM(maxDebtM.kpi.netDebt), fmt.monthLong(maxDebtM.period)),
          fact('RCF maximaal benut', fmt.eurM(maxRcfM.bs.rcf) + ' / ' + fmt.eurM(cfg.rcfLimit), maxRcfM.bs.rcf > 0.5 ? fmt.monthLong(maxRcfM.period) : 'onbenut in dit bereik'));
        grid2.appendChild(ui.card({ span: 6, title: 'Kas en netto schuld', subtitle: 'stand einde periode · negatieve netto schuld = netto kas', body: [ui.figure({ chart: cashLine }), facts],
          footer: 'Zakt de kas onder de minimumkas van ' + fmt.eurM(cfg.minCash) + ', dan trekt het model automatisch op het rekening-courantkrediet (limiet ' + fmt.eurM(cfg.rcfLimit) + ').' }));
        const levLine = charts.line({ x: keys, labels, series: [
          { name: 'Netto schuld / EBITDA', values: ser.map(p => clamp(p.kpi.leverage, -1, 6)), color: 'var(--series-1)' },
          { name: 'Limiet ' + fmt.x(cfg.covenantLeverageMax), values: ser.map(() => cfg.covenantLeverageMax), color: 'var(--critical)' }
        ], yFormat: v => fmt.x(v, 1), height: 170, baseline: 0, forecastFrom, endLabels: false, tooltipTitle: tipTitle, ariaLabel: 'Netto schuld gedeeld door EBITDA' });
        const icrLine = charts.line({ x: keys, labels, series: [
          { name: 'Rentedekking', values: ser.map(p => clamp(p.kpi.icr, -5, 25)), color: 'var(--series-1)' },
          { name: 'Minimum ' + fmt.x(cfg.covenantIcrMin), values: ser.map(() => cfg.covenantIcrMin), color: 'var(--critical)' }
        ], yFormat: v => fmt.x(v, 1), height: 170, baseline: 0, forecastFrom, endLabels: false, tooltipTitle: tipTitle, ariaLabel: 'Rentedekking' });
        const qs = model.series('Q');
        const qRows = qs.map(q => ({ label: fmt.quarter(q.key) + (q.partial ? '*' : ''), netDebt: q.kpi.netDebt, ltm: q.kpi.ltmEbitda, lev: q.kpi.leverage, icr: q.kpi.icr, ok: q.kpi.covenantLeverageOk && q.kpi.covenantIcrOk, isActual: q.isActual }));
        const qTable = ui.table({ columns: [
          { key: 'label', label: 'Kwartaal' },
          { key: 'netDebt', label: 'Netto schuld', align: 'num', format: fmt.eurM },
          { key: 'ltm', label: 'LTM EBITDA', align: 'num', format: fmt.eurM },
          { key: 'lev', label: 'Leverage', align: 'num', format: (v, r) => r.netDebt < 0 ? 'netto kas' : fmt.x(v, 2) },
          { key: 'icr', label: 'ICR', align: 'num', format: v => fmt.x(v, 1) },
          { key: 'ok', label: 'Status', format: v => ui.statusChip(v, 'binnen convenant', 'breuk') }
        ], rows: qRows, rowClass: r => r.isActual ? '' : 'forecast' });
        qTable.classList.add('balans-scroll');
        const breaches = qRows.filter(r => !r.ok);
        grid2.appendChild(ui.card({ span: 6, title: 'Convenanten', subtitle: 'netto schuld / LTM EBITDA ≤ ' + fmt.x(cfg.covenantLeverageMax) + ' en rentedekking ≥ ' + fmt.x(cfg.covenantIcrMin) + ' · kwartaaltoets',
          body: [ui.figure({ title: 'Netto schuld / EBITDA', chart: levLine, note: 'weergave afgekapt op −1x en 6x' }), ui.figure({ title: 'Rentedekking (EBITDA / rente)', chart: icrLine, note: 'weergave afgekapt op −5x en 25x' }),
            h('div', { class: 'eyebrow' }, 'Kwartaaltoets ' + rangeLabel), qTable],
          footer: breaches.length ? 'Convenantbreuk in ' + breaches.length + ' van ' + qRows.length + ' kwartalen; eerste in ' + breaches[0].label + '.' : 'Alle ' + qRows.length + ' kwartalen in het bereik blijven binnen beide convenanten.' + (anyPartial || qRows.some(r => r.label.endsWith('*')) ? ' * = onvolledig kwartaal.' : '') }));
        el.appendChild(grid2);

        // ---------- rij 3: samenstelling activa + financiering ----------
        const grid3 = h('div', { class: 'grid' });
        const barOpts = { categories: labels, stacked: true, yFormat: fmt.eur, height: 260, forecastFrom, tooltipTitle: tipTitle, labels: ser.length <= 8 ? 'all' : 'none' };
        const assets = charts.bar(Object.assign({}, barOpts, { ariaLabel: 'Samenstelling activa', series: [
          { name: 'Liquide middelen', values: ser.map(p => p.bs.cash), color: 'var(--series-1)' },
          { name: 'Debiteuren', values: ser.map(p => p.bs.ar), color: 'var(--series-2)' },
          { name: 'Voorraden', values: ser.map(p => p.bs.inventory), color: 'var(--series-3)' },
          { name: 'Materiële vaste activa', values: ser.map(p => p.bs.ppeNet), color: 'var(--series-4)' }
        ] }));
        const funding = charts.bar(Object.assign({}, barOpts, { ariaLabel: 'Financiering', series: [
          { name: 'Kortlopende schulden', values: ser.map(p => p.bs.ap + p.bs.taxPayable), color: 'var(--series-1)' },
          { name: 'Termijnlening', values: ser.map(p => p.bs.termLoan), color: 'var(--series-2)' },
          { name: 'Rekening-courantkrediet', values: ser.map(p => p.bs.rcf), color: 'var(--series-3)' },
          { name: 'Eigen vermogen', values: ser.map(p => p.bs.equity), color: 'var(--series-4)' }
        ] }));
        grid3.appendChild(ui.card({ span: 6, title: 'Samenstelling activa', subtitle: 'balanstotaal ' + fmt.eurM(bs.totalAssets) + ' per ' + fmt.monthLong(last.period), body: ui.figure({ chart: assets }) }));
        grid3.appendChild(ui.card({ span: 6, title: 'Financiering', subtitle: 'kortlopende schulden = crediteuren + belastingschuld · solvabiliteit ' + fmt.pct(solv), body: ui.figure({ chart: funding }) }));
        el.appendChild(grid3);

        // ---------- rij 4: aflossingsschema termijnlening ----------
        const years = E.aggregate(months, 'Y');
        let open = cfg.opening.termLoan || 0; const sched = [];
        for (const y of years) {
          const tlInt = y.months.reduce((s, m) => s + (m.bs.termLoan - m.cf.tlDraw - m.cf.tlRepay) * cfg.termLoanRate / 12, 0);
          sched.push({ year: y.key, open, draw: y.cf.tlDraw, repay: y.cf.tlRepay, close: y.bs.termLoan, tlInt, intTotal: y.pl.interestExp, isActual: y.isActual, mixed: !y.isActual && y.months.some(m => m.isActual), diff: open + y.cf.tlDraw + y.cf.tlRepay - y.bs.termLoan });
          open = y.bs.termLoan;
        }
        const schedRows = sched.filter(r => Math.abs(r.open) + Math.abs(r.draw) + Math.abs(r.close) > 0.5);
        const schedTable = ui.table({ columns: [
          { key: 'year', label: 'Jaar', format: (v, r) => r.isActual ? v : v + (r.mixed ? '*' : ' F') },
          { key: 'open', label: 'Beginstand', align: 'num', format: fmt.eurK },
          { key: 'draw', label: 'Opname', align: 'num', format: fmt.eurK },
          { key: 'repay', label: 'Aflossing', align: 'num', format: fmt.eurK },
          { key: 'close', label: 'Eindstand', align: 'num', format: fmt.eurK },
          { key: 'tlInt', label: 'Rente termijnlening', align: 'num', format: fmt.eurK },
          { key: 'intTotal', label: 'Rentelasten totaal', align: 'num', format: fmt.eurK }
        ], rows: schedRows, rowClass: r => r.isActual ? '' : 'forecast', footer: schedRows.length ? { year: 'Totaal', open: null, draw: schedRows.reduce((s, r) => s + r.draw, 0), repay: schedRows.reduce((s, r) => s + r.repay, 0), close: null, tlInt: schedRows.reduce((s, r) => s + r.tlInt, 0), intTotal: schedRows.reduce((s, r) => s + r.intTotal, 0), isActual: true } : null });
        const loanEv = model.events.find(ev => ev.kind === 'financing') || model.events.find(ev => ev.period === '2024-01');
        const lastH = months[months.length - 1]; const firstRepay = months.find(m => m.cf.tlRepay < -0.5); const monthly = -lastH.cf.tlRepay;
        const remaining = lastH.bs.termLoan;
        const schedNotes = [];
        if (loanEv) schedNotes.push(ui.note(h('span', null, h('strong', null, fmt.monthLong(loanEv.period) + ' · ' + loanEv.title + '. '), loanEv.text), 'accent'));
        schedNotes.push(ui.note((firstRepay ? 'Aflossing gestart in ' + fmt.monthLong(firstRepay.period) + ' met ' + fmt.eurK(-firstRepay.cf.tlRepay) + ' per maand; rente ' + fmt.pct(cfg.termLoanRate, 2) + ' over de beginstand van elke maand. ' : '') +
          (remaining > 0.5 && monthly > 0.5 ? 'Eind ' + fmt.month(lastH.period) + ' resteert ' + fmt.eurK(remaining) + '; de laatste termijn valt in ' + fmt.monthLong(E.addMonths(lastH.period, Math.ceil(remaining / monthly))) + '.' : remaining <= 0.5 ? 'De lening is binnen de modelhorizon volledig afgelost.' : '')));
        el.appendChild(ui.card({ title: 'Aflossingsschema termijnlening', subtitle: 'per boekjaar over de hele modelhorizon (onafhankelijk van de periodefilter) · bedragen × € 1.000', body: [schedTable, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, schedNotes)],
          footer: (sched.every(r => Math.abs(r.diff) < 1) ? 'Beginstand + opname − aflossing = eindstand in elk jaar. ' : 'Let op: het schema sluit niet in elk jaar. ') + 'Rentelasten totaal omvat ook de rente op het rekening-courantkrediet (' + fmt.pct(cfg.rcfRate, 2) + '). * = deels actual, F = forecast.' }));

        // ---------- rij 5: balans en kasstroomoverzicht per periode ----------
        const win = windowCols(ser);
        const cols = win.cols;
        const colHead = p => p.isActual ? pLabel(p) : h('span', null, pLabel(p), ' ', h('span', { class: 'chip forecast', style: { padding: '0 5px', fontSize: '10px', lineHeight: '1.4' }, title: 'forecast' }, 'F'));
        function statement(rows) {
          const columns = [{ key: 'label', label: '× € 1.000', class: 'label', format: (v, r) => r.node || v }]
            .concat(cols.map((p, i) => ({ value: r => r.values ? r.values[i] : null, label: colHead(p), align: 'num', format: (v, r) => v == null ? '' : (r.fmt || fmt.eurK)(v) })));
          return ui.table({ class: 'statement', columns, rows, rowClass: r => r.cls || '' });
        }
        const B = (label, fn, cls) => ({ label, values: cols.map(p => fn(p.bs)), cls });
        const allClose = cols.every(p => Math.abs(p.bs.check) < 0.01);
        const balRows = [
          { label: 'Activa', cls: 'section' },
          B('Liquide middelen', b => b.cash, 'lvl1'), B('Debiteuren', b => b.ar, 'lvl1'), B('Voorraden', b => b.inventory, 'lvl1'), B('Materiële vaste activa', b => b.ppeNet, 'lvl1'),
          B('Totaal activa', b => b.totalAssets, 'key'),
          { label: 'Passiva', cls: 'section' },
          B('Crediteuren', b => b.ap, 'lvl1'), B('Belastingschuld', b => b.taxPayable, 'lvl1'), B('Termijnlening', b => b.termLoan, 'lvl1'), B('Rekening-courantkrediet', b => b.rcf, 'lvl1'), B('Eigen vermogen', b => b.equity, 'lvl1'),
          B('Totaal passiva', b => b.totalLiabEquity, 'key'),
          { label: 'Controle: activa − passiva', node: h('span', null, 'Controle: activa − passiva ', ui.statusChip(allClose, 'sluit', 'sluit niet')), values: cols.map(p => p.bs.check), cls: 'check', fmt: v => fmt.eur(Math.abs(v) < 0.005 ? 0 : v, { full: true }) }
        ];
        const windowNote = win.start != null && ser.length > cols.length ? 'Toont ' + cols.length + ' van ' + ser.length + ' periodes (' + fmt.period(cols[0].key, grain) + ' – ' + fmt.period(cols[cols.length - 1].key, grain) + '); kies een grovere korrel of een korter bereik voor alle periodes. ' : '';
        const legendNote = 'F = forecast' + (cols.some(p => p.partial) ? ' · * = onvolledige periode' : '') + '.';
        el.appendChild(ui.card({ title: 'Balans per ' + GRAIN_WORD[grain], subtitle: 'stand einde periode · bedragen × € 1.000', body: statement(balRows), footer: windowNote + 'De controle-rij is activa − (schulden + eigen vermogen) in euro\'s; die is elke maand nul. ' + legendNote }));
        const C = (label, fn, cls) => ({ label, values: cols.map(p => fn(p.cf)), cls });
        const cfRows = [
          C('Nettowinst', x => x.netIncome, 'lvl1'), C('Afschrijvingen', x => x.dep, 'lvl1'), C('Mutatie debiteuren', x => x.dAR, 'lvl1'), C('Mutatie voorraden', x => x.dInv, 'lvl1'), C('Mutatie crediteuren', x => x.dAP, 'lvl1'), C('Mutatie belastingschuld', x => x.dTax, 'lvl1'),
          C('Kasstroom uit operationele activiteiten', x => x.cfo, 'key'),
          C('Investeringen', x => x.capex, 'lvl1'),
          C('Kasstroom uit investeringsactiviteiten', x => x.cfi, 'key'),
          C('Opname termijnlening', x => x.tlDraw, 'lvl1'), C('Aflossing termijnlening', x => x.tlRepay, 'lvl1'), C('Mutatie rekening-courant', x => x.rcfDraw + x.rcfRepay, 'lvl1'), C('Dividend', x => x.dividend, 'lvl1'), C('Kapitaalstorting', x => x.equityRaise, 'lvl1'),
          C('Kasstroom uit financieringsactiviteiten', x => x.cff, 'key'),
          C('Nettokasstroom', x => x.netCash, 'lvl0'),
          C('Kas begin', x => x.cashOpen, 'lvl1'),
          C('Kas eind', x => x.cashClose, 'key'),
          C('Vrije kasstroom', x => x.fcf, 'lvl2')
        ];
        el.appendChild(ui.card({ title: 'Kasstroomoverzicht per ' + GRAIN_WORD[grain], subtitle: 'indirecte methode · bedragen × € 1.000 · mutaties werkkapitaal als kaseffect (+ = kas vrij)', body: statement(cfRows), footer: windowNote + 'Vrije kasstroom = kasstroom uit operationele activiteiten + investeringen. Kas eind is de post Liquide middelen op de balans. ' + legendNote }));
      }

      /** venster van maximaal MAX_COLS kolommen: rond de laatste actual (12 actual + 4 forecast), anders begin of einde van het bereik */
      function windowCols(list) {
        const n = list.length; if (n <= MAX_COLS) return { cols: list, start: null };
        const la = list.map(p => p.isActual).lastIndexOf(true);
        let start; if (la < 0) start = 0; else if (la === n - 1) start = n - MAX_COLS; else start = Math.max(0, Math.min(n - MAX_COLS, la - (MAX_COLS - 5)));
        return { cols: list.slice(start, start + MAX_COLS), start };
      }
    }
  });
})();
