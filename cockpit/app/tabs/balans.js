/* Tab: Balans & kasstroom — balans, kasstroomoverzicht, werkkapitaal, convenanten en schuldaflossing uit één gesloten drie-statement model. */
(function () {
  'use strict';
  const H = window.HC;
  const GRAIN_WORD = { M: 'maand', Q: 'kwartaal', Y: 'jaar' };
  const MAX_COLS = 16;        // maximum aantal periodekolommen in de overzichten
  const MAX_BARS = 36;        // meer maandstaven dan dit → samenstellingsgrafieken per kwartaal
  const LTM_MONTHS = 12;      // een LTM-convenanttoets vereist twaalf maanden historie

  /* Lokale hulpstijlen: sectie- en controlerijen voor de overzichten, kwartaaltoets, kleine feitenblokken. (verzoek voor core: zie eindrapport) */
  function ensureLocalStyle() {
    if (document.getElementById('balans-local-style')) return;
    const st = document.createElement('style'); st.id = 'balans-local-style';
    st.textContent = [
      '.statement tr.section td { font-weight: 600; color: var(--muted); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; padding-top: 10px; }',
      '.statement tr.check td { color: var(--muted); font-size: 11.5px; border-top: 1px solid var(--line-2); }',
      '.balans-scroll { max-height: 420px; overflow-y: auto; }',
      '.balans-qt table.data th:first-child, .balans-qt table.data td:first-child { position: sticky; left: 0; background: var(--surface); z-index: 1; }',
      '.balans-qt table.data th:first-child { z-index: 2; background: var(--surface-2); }',
      '.balans-qt .st-sm { display: none; margin-left: 6px; vertical-align: middle; }',
      '@media (max-width: 640px) { .balans-qt .st-sm { display: inline-flex; } .balans-qt table.data th:last-child, .balans-qt table.data td:last-child { display: none; } }',
      '.balans-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px 14px; }',
      '.balans-fact .f-label { font-size: 11.5px; color: var(--muted); }',
      '.balans-fact .f-value { font-weight: 600; font-variant-numeric: tabular-nums; }',
      '.balans-fact .f-sub { font-size: 11.5px; color: var(--ink-2); }',
      '.balans-bars { display: flex; flex-direction: column; gap: 5px; font-size: 12px; }',
      '.balans-bars .row { display: grid; grid-template-columns: minmax(96px, 124px) minmax(0, 1fr) 68px; gap: 8px; align-items: center; }',
      '.balans-bars .lbl { color: var(--ink-2); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
      '.balans-bars .track { position: relative; height: 16px; display: block; }',
      '.balans-bars .track i { position: absolute; top: -3px; bottom: -3px; width: 1px; background: var(--axis); }',
      '.balans-bars .track b { position: absolute; top: 2px; height: 12px; border-radius: 3px; }',
      '.balans-bars .val { font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; text-align: right; }',
      '.balans-bars .total .lbl, .balans-bars .total .val { font-weight: 600; color: var(--ink); }',
      '.balans-sched td .forecast { color: var(--muted); }'
    ].join('\n');
    document.head.appendChild(st);
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  /** percentage met twee decimalen (fmt.pct kent alleen 0 of 1 decimaal; verzoek voor core: zie eindrapport) */
  const pct2 = v => H.fmt.num(v * 100, 2) + '%';
  /** bedrag in duizenden euro's zonder eenheid (de eenheid staat één keer in de tabelkop) */
  const kEur = v => v == null || !isFinite(v) ? '' : H.fmt.num(Math.abs(v) < 500 ? 0 : v / 1000, 0);

  /** tabel-tweeling van de kasbrug: stap, bedrag, stand na de stap (alle stappen, ook nul) */
  function bridgeTable(steps, yFmt) {
    const fmt = H.fmt; let acc = 0;
    const rows = steps.map(s => { acc = s.type === 'total' ? s.value : acc + s.value; return Object.assign({ cum: acc }, s); });
    return H.ui.table({ columns: [{ key: 'label', label: 'Stap' }, { key: 'value', label: 'Bedrag', align: 'num', format: (v, r) => r.type === 'total' ? yFmt(v) : fmt.signed(v, yFmt) }, { key: 'cum', label: 'Stand', align: 'num', format: yFmt }], rows, rowClass: r => r.type === 'total' ? 'total' : '' });
  }
  /** smalle variant van de kasbrug: staafjeslijst zonder as (label · staaf vanaf nul · bedrag), leesbaar op 400 px; zelfde kleuren en legenda als charts.waterfall */
  function barList(steps, allSteps, yFmt) {
    const h = H.h, fmt = H.fmt, charts = window.HCharts;
    const vals = steps.map(s => s.value); const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals); const span = (hi - lo) || 1;
    const pct = v => (v - lo) / span * 100;
    const el = h('div', { class: 'balans-bars', role: 'list', 'aria-label': 'Kasbrug als staafjeslijst' });
    for (const s of steps) {
      const a = Math.min(0, s.value), b = Math.max(0, s.value);
      const color = s.type === 'total' ? 'var(--ink-2)' : s.value >= 0 ? 'var(--series-1)' : 'var(--series-2)';
      const text = s.type === 'total' ? yFmt(s.value) : fmt.signed(s.value, yFmt);
      el.appendChild(h('div', { class: 'row' + (s.type === 'total' ? ' total' : ''), role: 'listitem', title: s.label + ': ' + text },
        h('span', { class: 'lbl' }, s.chart || s.label),
        h('span', { class: 'track', 'aria-hidden': 'true' }, h('i', { style: { left: pct(0).toFixed(2) + '%' } }), h('b', { style: { left: pct(a).toFixed(2) + '%', width: Math.max(0.6, pct(b) - pct(a)).toFixed(2) + '%', background: color } })),
        h('span', { class: 'val' }, text)));
    }
    const legend = charts && charts.legend ? charts.legend([{ name: 'Toename', color: 'var(--series-1)' }, { name: 'Afname', color: 'var(--series-2)' }, { name: 'Totaal', color: 'var(--ink-2)' }]) : null;
    return { el, legend, table: () => bridgeTable(allSteps, yFmt) };
  }

  /** container die op basis van zijn eigen breedte de brede of de smalle variant toont (herbouwt alleen bij het passeren van de grens) */
  function adaptive(minWide, buildWide, buildNarrow) {
    const box = H.h('div', { style: { minWidth: 0 } });
    let mode = null;
    const apply = w => { if (!(w > 0)) return; const m = w >= minWide ? 'wide' : 'narrow'; if (m === mode) return; mode = m; H.clear(box); box.appendChild(m === 'wide' ? buildWide() : buildNarrow()); };
    if ('ResizeObserver' in window) { const ro = new ResizeObserver(entries => apply(entries[0].contentRect.width)); ro.observe(box); }
    else window.addEventListener('resize', () => apply(box.getBoundingClientRect().width));
    requestAnimationFrame(() => apply(box.getBoundingClientRect().width));
    return box;
  }

  /** botsingswacht voor x-aslabels: charts.js toetst de voorlaatste tegen het (rechts verankerde) laatste label op halve breedte en charts.bar dunt alleen op index uit;
   *  hier wordt na elke (her)tekening elk label verwijderd dat zijn behouden rechterbuur raakt, het laatste label blijft altijd staan (verzoek voor core: zie eindrapport) */
  function guardAxisLabels(chart) {
    const fix = () => {
      if (!chart.el.isConnected) return;
      const rows = new Map();
      for (const t of chart.el.querySelectorAll('svg text.axis-label')) { const k = t.getAttribute('y'); if (!rows.has(k)) rows.set(k, []); rows.get(k).push(t); }
      for (const row of rows.values()) {
        if (row.length < 2) continue;
        const rects = row.map(t => t.getBoundingClientRect());
        if (rects.some(r => !(r.width > 0))) continue;   // nog niet opgemaakt (verborgen): niets doen
        const order = row.map((t, i) => i).sort((a, b) => rects[a].left - rects[b].left);
        let keep = rects[order[order.length - 1]];
        for (let j = order.length - 2; j >= 0; j--) { const r = rects[order[j]]; if (r.right + 4 > keep.left) row[order[j]].remove(); else keep = r; }
      }
    };
    if ('MutationObserver' in window) new MutationObserver(fix).observe(chart.el, { childList: true });
    return chart;
  }

  H.tabs.register({
    id: 'balans', label: 'Balans & kasstroom', short: 'Balans', order: 30, icon: 'balance',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E } = ctx;
      ensureLocalStyle();
      const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '18px' } });
      root.appendChild(body);
      const draw = (c) => { H.clear(body); build(body, c); };
      draw(ctx);
      ctx.subscribe(draw);

      function build(el, c) {
        const state = c.state, grain = state.grain, range = c.range;
        const run = model.run(); const months = run.months;
        const inRange = months.filter(m => model.inRange(m, range));
        const ser = model.series(grain);
        if (!ser.length || !inRange.length) { el.appendChild(ui.note('Geen periodes in het gekozen bereik.')); return; }
        const last = ser[ser.length - 1];
        const cfg = model.config;
        const fcIdx = ser.findIndex(p => !p.isActual);
        const forecastFrom = fcIdx >= 0 ? fcIdx : null;
        // Forecastmarkering volgens de canon: '*' = deels forecast (actual én forecast in één periode), 'F' = forecast (gedempte tekst), '(n mnd)' = deel van de periode in het bereik
        const isMixed = p => !p.isActual && !!p.months && p.months.some(m => m.isActual); // maandperiodes hebben geen months[]
        const mark = p => isMixed(p) ? '*' : '';
        const fcMark = p => p.isActual || isMixed(p) ? '' : ' F';
        const partialTxt = p => p.partial ? ' (' + p.n + ' mnd)' : '';
        const perLabel = (p, g) => fmt.period(p.key, g || grain) + mark(p);                  // as- en tabellabel: 'Q3 2026', '2026*'
        const catLabel = (p, g) => perLabel(p, g) + fcMark(p);                                 // categorie-/rijlabel: 'Q4 2026 F', '2027 F'
        const rowLabel = (p, g) => catLabel(p, g) + partialTxt(p);                             // rijlabel in tabellen: '2027 F (9 mnd)'
        const perLong = (p, g) => fmt.periodLong(p.key, g || grain) + partialTxt(p) + (p.isActual ? '' : isMixed(p) ? ' (deels forecast)' : ' (forecast)');
        // één legendazin voor het hele tabblad, letterlijk zoals de canon: '* = deels forecast · F = forecast · (n mnd) = deel van de periode in het bereik'
        const legendSentence = (mixed, fc, partial) => [mixed ? '* = deels forecast' : null, fc ? 'F = forecast' : null, partial ? '(n mnd) = deel van de periode in het bereik' : null].filter(Boolean).join(' · ');
        const legendOf = list => legendSentence(list.some(isMixed), list.some(p => !p.isActual && !isMixed(p)), list.some(p => p.partial));
        const keys = ser.map(p => p.key), axisLabels = ser.map(p => perLabel(p));
        const tipTitle = i => perLong(ser[i]);
        const anyMixed = ser.some(isMixed);
        const markNote = anyMixed ? ' · * = deels forecast' : '';
        const fcSub = forecastFrom != null ? ' · gearceerd = forecast' : '';
        const firstM = inRange[0], lastM = inRange[inRange.length - 1];
        const rangeLabel = fmt.month(firstM.period) + ' – ' + fmt.month(lastM.period);
        const prev = months.find(m => m.period === E.addMonths(last.period, -12));
        const lastAct = months.filter(m => m.isActual).pop() || null;
        // LTM-grootheden (leverage, rentedekking) zijn pas toetsbaar met twaalf maanden historie; het engine annualiseert daarvoor op minder maanden
        const testable = p => E.monthDiff(months[0].period, p.period) >= LTM_MONTHS - 1;

        // ---------- paginakop ----------
        el.appendChild(h('div', { class: 'page-head' },
          h('div', null, h('h1', null, 'Balans & kasstroom'),
            h('p', null, `Balans en kasstroomoverzicht per ${GRAIN_WORD[grain]}: de stand aan het einde van elke periode in het gekozen bereik (${rangeLabel}). De liquide middelen volgen uit het kasstroomoverzicht en de balans sluit elke maand.`)),
          h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } }, ui.chip('Stand ' + fmt.month(last.period), last.isActual ? 'actual' : null), ui.scenarioChip())));

        // ---------- KPI's (einde bereik) ----------
        const bs = last.bs, kpi = last.kpi;
        const netDebt = kpi.netDebt; const isNetCash = netDebt < 0;
        const solv = bs.totalAssets > 0 ? bs.equity / bs.totalAssets : null;
        const wc = bs.ar + bs.inventory - bs.ap;
        const pv = prev ? { cash: prev.bs.cash, netDebt: prev.kpi.netDebt, equity: prev.bs.equity, solv: prev.bs.totalAssets > 0 ? prev.bs.equity / prev.bs.totalAssets : null, wc: prev.bs.ar + prev.bs.inventory - prev.bs.ap, ccc: prev.kpi.ccc } : null;
        const vsLabel = prev ? 'vs. ' + fmt.month(prev.period) : null;
        // delta van de netto-kas/schuld-tegel in de richting van het label: nettokas omhoog = goed, nettoschuld omhoog = slecht
        let ndDelta = null;
        if (pv) {
          ndDelta = isNetCash ? ui.delta(-netDebt, -pv.netDebt, { label: vsLabel, absolute: true, upIsGood: true, format: fmt.eurM })
            : ui.delta(netDebt, pv.netDebt, { label: vsLabel, absolute: true, upIsGood: false, format: fmt.eurM });
          const flipped = (pv.netDebt < 0) !== isNetCash && Math.abs(pv.netDebt) > 0.5;
          if (ndDelta && flipped) ndDelta.label = 'van ' + fmt.eurM(Math.abs(pv.netDebt)) + (pv.netDebt < 0 ? ' nettokas ' : ' nettoschuld ') + fmt.month(prev.period);
        }
        // een tegel met een forecaststand draagt de periode én 'F' in het label ('Liquide middelen dec 27 F'); de tag breekt als geheel af (vaste spaties)
        const perTag = ' ' + fmt.month(last.period).replace(/ /g, ' ') + (last.isActual ? '' : ' F');
        const kpis = h('div', { class: 'kpi-row' });
        kpis.appendChild(ui.kpi({ label: 'Liquide middelen' + perTag, value: fmt.eurM(bs.cash), delta: pv ? ui.delta(bs.cash, pv.cash, { label: vsLabel }) : null, hint: 'RCF-ruimte ' + fmt.eurM(kpi.rcfHeadroom) + ' · minimumkas ' + fmt.eurM(cfg.minCash) }));
        kpis.appendChild(ui.kpi({ label: (isNetCash ? 'Nettokas' : 'Nettoschuld') + perTag, value: fmt.eurM(Math.abs(netDebt)), delta: ndDelta,
          hint: isNetCash ? 'kas overtreft termijnlening en RCF (' + fmt.eurM(bs.termLoan + bs.rcf) + ')' : 'termijnlening ' + fmt.eurM(bs.termLoan) + ' + RCF ' + fmt.eurM(bs.rcf) + ' − kas' }));
        kpis.appendChild(ui.kpi({ label: 'Eigen vermogen' + perTag, value: fmt.eurM(bs.equity), delta: pv ? ui.delta(bs.equity, pv.equity, { label: vsLabel }) : null, hint: 'balanstotaal ' + fmt.eurM(bs.totalAssets) }));
        kpis.appendChild(ui.kpi({ label: 'Solvabiliteit' + perTag, value: fmt.pct(solv), delta: pv && pv.solv != null ? ui.deltaPp(solv, pv.solv, { label: vsLabel }) : null, hint: 'eigen vermogen / balanstotaal' }));
        kpis.appendChild(ui.kpi({ label: 'Werkkapitaal' + perTag, value: fmt.eurM(wc), delta: pv ? ui.delta(wc, pv.wc, { label: vsLabel, absolute: true, upIsGood: false, format: fmt.eurM }) : null, hint: 'debiteuren + voorraden − crediteuren' }));
        const cccDelta = pv ? (() => { const d = kpi.ccc - pv.ccc; const dir = Math.abs(d) < 0.5 ? 'flat' : d > 0 ? 'up' : 'down'; return { text: fmt.signed(d, fmt.days), dir, good: dir === 'flat' ? null : dir === 'down', label: vsLabel }; })() : null;
        kpis.appendChild(ui.kpi({ label: 'Kasconversiecyclus' + perTag, value: fmt.days(kpi.ccc), delta: cccDelta, hint: 'DSO ' + fmt.int(kpi.dso) + ' + DIO ' + fmt.int(kpi.dio) + ' − DPO ' + fmt.int(kpi.dpo) + ' dagen' }));
        el.appendChild(kpis);
        if (!last.isActual && lastAct) el.appendChild(h('p', { class: 'small muted', style: { margin: '-10px 0 0' } },
          'Stand per einde van het bereik (' + fmt.monthLong(last.period) + ', forecast); laatste actual ' + fmt.monthLong(lastAct.period) + ': kas ' + fmt.eurM(lastAct.bs.cash) + ', ' + (lastAct.kpi.netDebt < 0 ? 'nettokas ' : 'nettoschuld ') + fmt.eurM(Math.abs(lastAct.kpi.netDebt)) + '.'));

        // ---------- rij 1: kasbrug over het bereik ----------
        const grid1 = h('div', { class: 'grid' });
        const sumCf = key => inRange.reduce((s, m) => s + m.cf[key], 0);
        const cashOpen = firstM.cf.cashOpen, cashClose = lastM.cf.cashClose;
        // label = volledige naam (tabel), chart = korte naam onder de staaf (woorden ≤ ~70 px zodat ze niet overlappen)
        const steps = [
          { label: 'Kas begin', chart: 'Kas begin', value: cashOpen, type: 'total' },
          { label: 'Nettowinst', chart: 'Nettowinst', value: sumCf('netIncome'), type: 'delta' }, { label: 'Afschrijvingen', chart: 'Afschrijvingen', value: sumCf('dep'), type: 'delta' },
          { label: 'Mutatie debiteuren', chart: 'Mutatie debiteuren', value: sumCf('dAR'), type: 'delta' }, { label: 'Mutatie voorraden', chart: 'Mutatie voorraden', value: sumCf('dInv'), type: 'delta' },
          { label: 'Mutatie crediteuren', chart: 'Mutatie crediteuren', value: sumCf('dAP'), type: 'delta' }, { label: 'Mutatie belastingschuld', chart: 'Mutatie belastingen', value: sumCf('dTax'), type: 'delta' },
          { label: 'Investeringen', chart: 'Investeringen', value: sumCf('capex'), type: 'delta' },
          { label: 'Termijnlening (opname − aflossing)', chart: 'Termijnlening', value: sumCf('tlDraw') + sumCf('tlRepay'), type: 'delta' }, { label: 'Mutatie rekening-courantkrediet', chart: 'RCF', value: sumCf('rcfDraw') + sumCf('rcfRepay'), type: 'delta' },
          { label: 'Dividend', chart: 'Dividend', value: sumCf('dividend'), type: 'delta' },
          { label: 'Kapitaalstorting', chart: 'Kapitaalstorting', value: sumCf('equityRaise'), type: 'delta' },
          { label: 'Kas eind', chart: 'Kas eind', value: cashClose, type: 'total' }
        ];
        // de grafiek laat stappen zonder mutatie weg (geen lege staafjes); de tabel-tweeling toont alle stappen
        const chartSteps = steps.filter(s => s.type === 'total' || Math.abs(s.value) >= 0.5);
        const hiddenSteps = steps.length - chartSteps.length;
        const bridgeDiff = cashOpen + steps.filter(s => s.type === 'delta').reduce((s, x) => s + x.value, 0) - cashClose;
        const bridgeNote = 'Kas eind ' + fmt.eurM(cashClose) + ' is de post Liquide middelen op de balans van ' + fmt.monthLong(lastM.period) + '.' + (hiddenSteps ? ' Posten zonder mutatie (' + steps.filter(s => s.type === 'delta' && Math.abs(s.value) < 0.5).map(s => s.label.charAt(0).toLowerCase() + s.label.slice(1)).join(', ') + ') staan alleen in de tabel.' : '');
        const bridgeWide = () => { const wf = charts.waterfall({ steps: chartSteps.map(s => ({ label: s.chart, value: s.value, type: s.type })), yFormat: fmt.eur, height: 280, polarity: 'neutral', ariaLabel: 'Kasbrug ' + rangeLabel }); wf.table = () => bridgeTable(steps, fmt.eur); return ui.figure({ chart: wf, note: bridgeNote }); };
        const bridgeNarrow = () => ui.figure({ chart: barList(chartSteps, steps, fmt.eur), note: bridgeNote + ' Eerste en laatste staaf zijn standen, de overige mutaties.' });
        const measure = charts.measure || (t => t.length * 6.2);
        const bridgeMinW = Math.ceil((Math.max(...chartSteps.flatMap(s => s.chart.split(' ')).map(w => measure(w))) + 4) * chartSteps.length + 60);
        grid1.appendChild(ui.card({ span: 12, title: 'Kasbrug ' + rangeLabel, subtitle: 'som van ' + inRange.length + ' maanden · + = instroom, − = uitstroom · werkkapitaalmutaties als kaseffect',
          body: adaptive(bridgeMinW, bridgeWide, bridgeNarrow),
          footer: Math.abs(bridgeDiff) < 1 ? 'De brug sluit: kas begin plus alle mutaties is exact kas eind.' : 'Let op: de brug sluit niet (' + fmt.eur(bridgeDiff, { full: true }) + ' verschil).' }));
        el.appendChild(grid1);

        // ---------- rij 2: werkkapitaaldagen + kas & nettoschuld ----------
        const grid2 = h('div', { class: 'grid' });
        const daysChart = guardAxisLabels(charts.line({ x: keys, labels: axisLabels, series: [
          { name: 'Debiteurentermijn (DSO)', values: ser.map(p => p.kpi.dso), color: 'var(--series-1)' }, { name: 'Voorraaddagen (DIO)', values: ser.map(p => p.kpi.dio), color: 'var(--series-2)' },
          { name: 'Crediteurentermijn (DPO)', values: ser.map(p => p.kpi.dpo), color: 'var(--series-3)' }
        ], yFormat: fmt.days, yMin: 0, forecastFrom, endLabels: false, tooltipTitle: tipTitle, ariaLabel: 'Werkkapitaaldagen' }));
        // tabel-tweeling inclusief de kasconversiecyclus (in de grafiek alleen de drie componenten); de afkortingen zijn in de legenda geïntroduceerd
        daysChart.table = () => ui.table({ columns: [{ key: 'label', label: 'Periode' }, { key: 'dso', label: 'DSO', align: 'num', format: fmt.days }, { key: 'dio', label: 'DIO', align: 'num', format: fmt.days }, { key: 'dpo', label: 'DPO', align: 'num', format: fmt.days }, { key: 'ccc', label: 'CCC', align: 'num', format: fmt.days }],
          rows: ser.map(p => ({ label: rowLabel(p), dso: p.kpi.dso, dio: p.kpi.dio, dpo: p.kpi.dpo, ccc: p.kpi.ccc, isActual: p.isActual })), rowClass: r => r.isActual ? '' : 'forecast' });
        grid2.appendChild(ui.card({ span: 6, title: 'Werkkapitaaldagen', subtitle: 'stand einde periode · kasconversiecyclus (CCC = DSO + DIO − DPO) ' + fmt.days(kpi.ccc) + ' per ' + fmt.month(last.period) + fcSub + markNote, body: ui.figure({ chart: daysChart }),
          footer: 'Elke dag minder in de kasconversiecyclus maakt bij de huidige omzet circa ' + fmt.eur(model.ltm().pl.revenue / 365) + ' kas vrij. De CCC staat in de tabelweergave.' }));
        const cashLine = guardAxisLabels(charts.line({ x: keys, labels: axisLabels, series: [
          { name: 'Liquide middelen', values: ser.map(p => p.bs.cash), color: 'var(--series-1)' },
          { name: 'Nettoschuld', values: ser.map(p => p.kpi.netDebt), color: 'var(--series-2)' }
        ], baseline: 0, yFormat: fmt.eur, forecastFrom, endLabels: false, tooltipTitle: tipTitle, ariaLabel: 'Kas en nettoschuld' }));
        cashLine.table = () => ui.table({ columns: [{ key: 'label', label: 'Periode' }, { key: 'cash', label: 'Liquide middelen', align: 'num', format: fmt.eur }, { key: 'nd', label: 'Nettoschuld', align: 'num', format: fmt.eur }],
          rows: ser.map(p => ({ label: rowLabel(p), cash: p.bs.cash, nd: p.kpi.netDebt, isActual: p.isActual })), rowClass: r => r.isActual ? '' : 'forecast' });
        const minCashM = inRange.reduce((a, m) => m.bs.cash < a.bs.cash ? m : a, inRange[0]);
        const maxDebtM = inRange.reduce((a, m) => m.kpi.netDebt > a.kpi.netDebt ? m : a, inRange[0]);
        const maxRcfM = inRange.reduce((a, m) => m.bs.rcf > a.bs.rcf ? m : a, inRange[0]);
        const fact = (label, value, sub) => h('div', { class: 'balans-fact' }, h('div', { class: 'f-label' }, label), h('div', { class: 'f-value' }, value), h('div', { class: 'f-sub' }, sub));
        const facts = h('div', { class: 'balans-facts' },
          fact('Laagste kas in bereik', fmt.eurM(minCashM.bs.cash), fmt.monthLong(minCashM.period) + (minCashM.bs.cash <= cfg.minCash + 1 ? ' · op de minimumkas' : '')),
          fact('Hoogste nettoschuld', maxDebtM.kpi.netDebt < 0 ? 'nettokas' : fmt.eurM(maxDebtM.kpi.netDebt), fmt.monthLong(maxDebtM.period)),
          fact('RCF benut', fmt.eurM(maxRcfM.bs.rcf) + ' / ' + fmt.eurM(cfg.rcfLimit), maxRcfM.bs.rcf > 0.5 ? 'hoogste stand, ' + fmt.monthLong(maxRcfM.period) : 'onbenut in dit bereik'));
        grid2.appendChild(ui.card({ span: 6, title: 'Kas en nettoschuld', subtitle: 'stand einde periode · negatieve nettoschuld = nettokas' + fcSub + markNote, body: [ui.figure({ chart: cashLine }), facts],
          footer: 'Zakt de kas onder de minimumkas van ' + fmt.eurM(cfg.minCash) + ', dan trekt het model automatisch op het rekening-courantkrediet (limiet ' + fmt.eurM(cfg.rcfLimit) + ').' }));
        el.appendChild(grid2);

        // ---------- rij 3: convenanten ----------
        const grid3 = h('div', { class: 'grid' });
        const levOf = p => !testable(p) ? null : p.kpi.netDebt < 0 ? 0 : Math.min(p.kpi.leverage, 6);   // nettokas = 0x; weergave afgekapt op 6x
        const icrOf = p => !testable(p) ? null : clamp(p.kpi.icr, -5, 25);
        const refLine = (name, value) => ({ name, values: ser.map(() => value), color: 'var(--ink-2)', dashedFrom: 0 }); // neutrale, gestippelde drempel (geen statuskleur)
        const levLine = guardAxisLabels(charts.line({ x: keys, labels: axisLabels, series: [
          { name: 'Nettoschuld / EBITDA', values: ser.map(levOf), color: 'var(--series-1)' }, refLine('Limiet ' + fmt.x(cfg.covenantLeverageMax), cfg.covenantLeverageMax)
        ], yFormat: v => fmt.x(v, 1), height: 200, baseline: 0, forecastFrom, endLabels: false, tooltipTitle: tipTitle, ariaLabel: 'Nettoschuld gedeeld door EBITDA' }));
        const icrLine = guardAxisLabels(charts.line({ x: keys, labels: axisLabels, series: [
          { name: 'Rentedekking', values: ser.map(icrOf), color: 'var(--series-1)' }, refLine('Minimum ' + fmt.x(cfg.covenantIcrMin), cfg.covenantIcrMin)
        ], yFormat: v => fmt.x(v, 1), height: 200, baseline: 0, forecastFrom, endLabels: false, tooltipTitle: tipTitle, ariaLabel: 'Rentedekking' }));
        // legenda met gestippeld symbool voor de drempel (charts.line tekent alle reeksen als lijn in de legenda)
        if (charts.legend) {
          levLine.legend = charts.legend([{ name: 'Nettoschuld / EBITDA', color: 'var(--series-1)', kind: 'line' }, { name: 'Limiet ' + fmt.x(cfg.covenantLeverageMax), color: 'var(--ink-2)', kind: 'dashed' }]);
          icrLine.legend = charts.legend([{ name: 'Rentedekking', color: 'var(--series-1)', kind: 'line' }, { name: 'Minimum ' + fmt.x(cfg.covenantIcrMin), color: 'var(--ink-2)', kind: 'dashed' }]);
        }
        // tabel-tweelingen met de onafgekapte waarden en zonder de constante limietkolom
        const levTxt = p => !testable(p) ? 'n.v.t.' : p.kpi.netDebt < 0 ? 'nettokas' : fmt.x(p.kpi.leverage, 2);
        const icrTxt = p => !testable(p) ? 'n.v.t.' : fmt.x(p.kpi.icr, 1);
        levLine.table = () => ui.table({ columns: [{ key: 'label', label: 'Periode' }, { key: 'lev', label: 'Nettoschuld / EBITDA', align: 'num' }], rows: ser.map(p => ({ label: rowLabel(p), lev: levTxt(p), isActual: p.isActual })), rowClass: r => r.isActual ? '' : 'forecast' });
        icrLine.table = () => ui.table({ columns: [{ key: 'label', label: 'Periode' }, { key: 'icr', label: 'Rentedekking', align: 'num' }], rows: ser.map(p => ({ label: rowLabel(p), icr: icrTxt(p), isActual: p.isActual })), rowClass: r => r.isActual ? '' : 'forecast' });
        const qs = model.series('Q');
        const qRows = qs.map(q => { const t = testable(q); return { key: q.key, label: rowLabel(q, 'Q'), netDebt: q.kpi.netDebt, ltm: t ? q.kpi.ltmEbitda : null, lev: t ? q.kpi.leverage : null, icr: t ? q.kpi.icr : null, ok: t ? (q.kpi.covenantLeverageOk && q.kpi.covenantIcrOk) : null, isActual: q.isActual, partial: q.partial, mixed: isMixed(q) }; });
        // canon: 'binnen convenant' / 'convenantbreuk'; compact 'ok' / 'breuk' alleen onder de kolomkop 'Convenant' (op een smal scherm verhuist de chip naar de kwartaalkolom)
        const statusChip = (ok, sm) => ok == null ? ui.chip('n.v.t.', null, 'info') : ui.statusChip(ok, sm ? 'ok' : 'binnen convenant', sm ? 'breuk' : 'convenantbreuk');
        const qTable = ui.table({ columns: [
          { key: 'label', label: 'Kwartaal', format: (v, r) => h('span', null, v, h('span', { class: 'st-sm', title: 'Convenant' }, statusChip(r.ok, true))) },
          { key: 'netDebt', label: 'Nettoschuld', align: 'num', format: fmt.eurM },
          { key: 'ltm', label: 'EBITDA LTM', align: 'num', format: v => v == null ? '–' : fmt.eurM(v) },
          { key: 'lev', label: 'Nettoschuld / EBITDA', align: 'num', format: (v, r) => v == null ? '–' : r.netDebt < 0 ? 'nettokas' : fmt.x(v, 2) },
          { key: 'icr', label: 'Rentedekking', align: 'num', format: v => v == null ? '–' : fmt.x(v, 1) },
          { key: 'ok', label: 'Convenant', format: v => statusChip(v, false) }
        ], rows: qRows, rowClass: r => r.isActual ? '' : 'forecast' });
        qTable.classList.add('balans-qt');
        const capped = qRows.length > 16; if (capped) qTable.classList.add('balans-scroll');
        const tested = qRows.filter(r => r.ok != null), untested = qRows.length - tested.length;
        const breaches = qRows.filter(r => r.ok === false);
        const qFoot = [];
        qFoot.push(breaches.length ? 'Convenantbreuk in ' + breaches.length + ' van ' + tested.length + ' getoetste kwartalen; eerste in ' + fmt.quarter(breaches[0].key) + '.' : 'Alle ' + tested.length + ' getoetste kwartalen in het bereik blijven binnen beide convenanten.');
        if (untested) qFoot.push('n.v.t. = minder dan twaalf maanden historie, dus nog geen toets op EBITDA LTM (' + untested + (untested === 1 ? ' kwartaal' : ' kwartalen') + ').');
        const qLegend = legendOf(qs); if (qLegend) qFoot.push(qLegend);
        grid3.appendChild(ui.card({ span: 12, title: 'Convenanten', subtitle: 'nettoschuld / EBITDA ≤ ' + fmt.x(cfg.covenantLeverageMax) + ' en rentedekking ≥ ' + fmt.x(cfg.covenantIcrMin) + ' · kwartaaltoets op basis van EBITDA LTM' + fcSub + markNote,
          body: [
            h('div', { class: 'grid' },
              h('div', { class: 'span-6', style: { minWidth: 0 } }, ui.figure({ title: 'Nettoschuld / EBITDA', chart: levLine, note: 'nettokas = 0x · weergave afgekapt op 6x · gestippeld = limiet' + (ser.some(p => !testable(p)) ? ' · eerste twaalf maanden niet toetsbaar' : '') })),
              h('div', { class: 'span-6', style: { minWidth: 0 } }, ui.figure({ title: 'Rentedekking (EBITDA / rente)', chart: icrLine, note: 'weergave afgekapt op −5x en 25x · gestippeld = minimum' + (ser.some(p => !testable(p)) ? ' · eerste twaalf maanden niet toetsbaar' : '') }))),
            h('div', { class: 'eyebrow', style: { marginTop: '6px' } }, 'Kwartaaltoets ' + rangeLabel + (capped ? ' · ' + qRows.length + ' kwartalen, scrol voor alle rijen' : '')), qTable],
          footer: qFoot.join(' ') }));
        el.appendChild(grid3);

        // ---------- rij 4: samenstelling activa + financiering ----------
        const grid4 = h('div', { class: 'grid' });
        // meer dan MAX_BARS maandstaven worden onleesbaar: dan per kwartaal (de overzichten onderaan blijven per maand)
        const compQ = grain === 'M' && ser.length > MAX_BARS;
        const compSer = compQ ? E.aggregate(inRange, 'Q') : ser, compGrain = compQ ? 'Q' : grain;
        const compFc = compSer.findIndex(p => !p.isActual);
        // categorielabels volgens de canon ('Q4 2026 F', '2026*'); de tabel-tweeling van charts.bar gebruikt dezelfde labels
        const barOpts = { categories: compSer.map(p => catLabel(p, compGrain)), stacked: true, yFormat: fmt.eur, forecastFrom: compFc >= 0 ? compFc : null, tooltipTitle: i => perLong(compSer[i], compGrain), labels: compSer.length <= 8 ? 'all' : 'none', xLabel: 'Periode' };
        const assets = guardAxisLabels(charts.bar(Object.assign({}, barOpts, { ariaLabel: 'Samenstelling activa', series: [
          { name: 'Liquide middelen', values: compSer.map(p => p.bs.cash), color: 'var(--series-1)' },
          { name: 'Debiteuren', values: compSer.map(p => p.bs.ar), color: 'var(--series-2)' },
          { name: 'Voorraden', values: compSer.map(p => p.bs.inventory), color: 'var(--series-3)' },
          { name: 'Materiële vaste activa', values: compSer.map(p => p.bs.ppeNet), color: 'var(--series-4)' }
        ] })));
        const funding = guardAxisLabels(charts.bar(Object.assign({}, barOpts, { ariaLabel: 'Financiering', series: [
          { name: 'Crediteuren en belastingschuld', values: compSer.map(p => p.bs.ap + p.bs.taxPayable), color: 'var(--series-1)' },
          { name: 'Termijnlening', values: compSer.map(p => p.bs.termLoan), color: 'var(--series-2)' },
          { name: 'Rekening-courantkrediet', values: compSer.map(p => p.bs.rcf), color: 'var(--series-3)' },
          { name: 'Eigen vermogen', values: compSer.map(p => p.bs.equity), color: 'var(--series-4)' }
        ] })));
        const compLegend = legendSentence(compSer.some(isMixed), compSer.some(p => !p.isActual && !isMixed(p)), false);
        const compNote = (compQ ? ' · per kwartaal (meer dan ' + MAX_BARS + ' maanden in het bereik)' : '') + (compFc >= 0 ? ' · gearceerd = forecast' : '') + (compLegend ? ' · ' + compLegend : '');
        grid4.appendChild(ui.card({ span: 6, title: 'Samenstelling activa', subtitle: 'balanstotaal ' + fmt.eurM(bs.totalAssets) + ' per ' + fmt.monthLong(last.period) + compNote, body: ui.figure({ chart: assets }) }));
        grid4.appendChild(ui.card({ span: 6, title: 'Financiering', subtitle: 'schulden en eigen vermogen · solvabiliteit ' + fmt.pct(solv) + ' per ' + fmt.monthLong(last.period) + compNote, body: ui.figure({ chart: funding }) }));
        el.appendChild(grid4);

        // ---------- rij 5: aflossingsschema termijnlening ----------
        const years = E.aggregate(months, 'Y');
        let open = cfg.opening.termLoan || 0; const sched = [];
        for (const y of years) {
          const tlInt = y.months.reduce((s, m) => s + (m.bs.termLoan - m.cf.tlDraw - m.cf.tlRepay) * cfg.termLoanRate / 12, 0);
          sched.push({ year: y.key, open, draw: y.cf.tlDraw, repay: y.cf.tlRepay, close: y.bs.termLoan, tlInt, intTotal: y.pl.interestExp, isActual: y.isActual, mixed: isMixed(y), diff: open + y.cf.tlDraw + y.cf.tlRepay - y.bs.termLoan });
          open = y.bs.termLoan;
        }
        const schedRows = sched.filter(r => Math.abs(r.open) + Math.abs(r.draw) + Math.abs(r.close) > 0.5);
        const schedDropped = sched.filter(r => !schedRows.includes(r));
        const schedTable = ui.table({ columns: [
          { key: 'year', label: 'Jaar', format: (v, r) => r.isActual ? v : r.mixed ? v + '*' : h('span', null, v, h('span', { class: 'forecast' }, ' F')) },
          { key: 'open', label: 'Beginstand', align: 'num', format: kEur },
          { key: 'draw', label: 'Opname', align: 'num', format: kEur },
          { key: 'repay', label: 'Aflossing', align: 'num', format: kEur },
          { key: 'close', label: 'Eindstand', align: 'num', format: kEur },
          { key: 'tlInt', label: 'Rente termijnlening', align: 'num', format: kEur },
          { key: 'intTotal', label: 'Rentelasten totaal', align: 'num', format: kEur }
        ], rows: schedRows, rowClass: r => r.isActual ? '' : 'forecast', footer: schedRows.length ? { year: 'Totaal', open: null, draw: schedRows.reduce((s, r) => s + r.draw, 0), repay: schedRows.reduce((s, r) => s + r.repay, 0), close: null, tlInt: schedRows.reduce((s, r) => s + r.tlInt, 0), intTotal: schedRows.reduce((s, r) => s + r.intTotal, 0), isActual: true } : null });
        const loanEv = model.events.find(ev => ev.kind === 'financing') || model.events.find(ev => ev.period === '2024-01');
        const lastH = months[months.length - 1]; const firstRepay = months.find(m => m.cf.tlRepay < -0.5); const monthly = -lastH.cf.tlRepay;
        const remaining = lastH.bs.termLoan;
        const schedNotes = [];
        if (loanEv) schedNotes.push(ui.note(h('span', null, h('strong', null, fmt.monthLong(loanEv.period) + ' · ' + loanEv.title + '. '), loanEv.text), 'accent'));
        schedNotes.push(ui.note((firstRepay ? 'Aflossing gestart in ' + fmt.monthLong(firstRepay.period) + ' met ' + fmt.eurK(-firstRepay.cf.tlRepay) + ' per maand; rente ' + pct2(cfg.termLoanRate) + ' over de beginstand van elke maand. ' : '') +
          (remaining > 0.5 && monthly > 0.5 ? 'Eind ' + fmt.monthLong(lastH.period) + ' resteert ' + fmt.eurK(remaining) + '; de laatste termijn valt in ' + fmt.monthLong(E.addMonths(lastH.period, Math.ceil(remaining / monthly))) + '.' : remaining <= 0.5 ? 'De lening is binnen de modelhorizon volledig afgelost.' : '')));
        schedTable.classList.add('balans-sched');
        const schedLegend = legendSentence(schedRows.some(r => r.mixed), schedRows.some(r => !r.isActual && !r.mixed), false);
        // jaren zonder termijnlening staan niet in de tabel; hun rentelasten (alleen RCF) vallen dus buiten de totaalrij — zeg dat, zodat het totaal aansluit op de W&V
        const droppedInt = schedDropped.reduce((s, r) => s + r.intTotal, 0);
        const droppedNote = schedRows.length && schedDropped.length ? 'Totaal over ' + schedRows[0].year + '–' + schedRows[schedRows.length - 1].year + ' (jaren met een termijnlening); ' + schedDropped.map(r => r.year).join(', ') + (schedDropped.length > 1 ? ' hadden' : ' had') + (droppedInt > 500 ? ' alleen rente op het rekening-courantkrediet (' + fmt.eurK(droppedInt) + ').' : ' geen rentelasten.') : '';
        el.appendChild(ui.card({ title: 'Aflossingsschema termijnlening', subtitle: 'per boekjaar over de hele modelhorizon (onafhankelijk van de periodefilter) · bedragen × € 1.000', body: [schedTable, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, schedNotes)],
          footer: (sched.every(r => Math.abs(r.diff) < 1) ? 'Beginstand + opname − aflossing = eindstand in elk jaar. ' : 'Let op: het schema sluit niet in elk jaar. ') + 'Rentelasten totaal omvat ook de rente op het rekening-courantkrediet (' + pct2(cfg.rcfRate) + '). ' + (droppedNote ? droppedNote + ' ' : '') + schedLegend }));

        // ---------- rij 6: balans en kasstroomoverzicht per periode ----------
        const win = windowCols(ser);
        const cols = win.cols;
        const lastActualCol = cols.map(p => p.isActual).lastIndexOf(true);
        // kolomkop: actual gewoon, forecast als gedempte tekst met 'F' ('Q4 2026 F', '2026 F (3 mnd)'), deels forecast '2026*' — nooit een chip per kolom (gedeelde CSS: th .forecast)
        const colHead = p => p.isActual ? rowLabel(p) : h('span', { class: 'forecast' }, rowLabel(p));
        function statement(rows) {
          const columns = [{ key: 'label', label: '× € 1.000', class: 'label', format: (v, r) => r.node || v }]
            .concat(cols.map((p, i) => ({ value: r => r.values ? r.values[i] : null, label: colHead(p), align: 'num', format: (v, r) => v == null ? '' : (r.fmt || kEur)(v) })));
          const wrap = ui.table({ class: 'statement', columns, rows, rowClass: r => r.cls || '' });
          // op een smal scherm: begin bij de laatste actual-kolom (de kolom "nu"), de vaste eerste kolom blijft zichtbaar
          if (lastActualCol > 0) {
            // posities via getBoundingClientRect (offsetLeft is hier relatief aan body; de eerste kolom is sticky); relatief, dus herhaald aanroepen convergeert
            const snap = () => { if (!wrap.isConnected || wrap.scrollWidth <= wrap.clientWidth + 1) return; const ths = wrap.querySelectorAll('thead th'); const th = ths[lastActualCol + 1]; if (th) wrap.scrollLeft += th.getBoundingClientRect().left - wrap.getBoundingClientRect().left - ths[0].getBoundingClientRect().width; };
            requestAnimationFrame(snap);
            if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => requestAnimationFrame(snap));  // na het laden (of mislukken) van webfonts verschuift de lay-out nog
            setTimeout(snap, 400);
          }
          return wrap;
        }
        const B = (label, fn, cls) => ({ label, values: cols.map(p => fn(p.bs)), cls });
        const allClose = cols.every(p => Math.abs(p.bs.check) < 0.01);
        const balRows = [
          { label: 'Activa', cls: 'section' },
          B('Liquide middelen', b => b.cash, 'lvl1'), B('Debiteuren', b => b.ar, 'lvl1'), B('Voorraden', b => b.inventory, 'lvl1'), B('Materiële vaste activa', b => b.ppeNet, 'lvl1'),
          B('Totaal activa', b => b.totalAssets, 'key'),
          { label: 'Passiva', cls: 'section' },
          B('Crediteuren', b => b.ap, 'lvl1'), B('Belastingschuld', b => b.taxPayable, 'lvl1'), B('Termijnlening', b => b.termLoan, 'lvl1'), B('Rekening-courantkrediet (RCF)', b => b.rcf, 'lvl1'), B('Eigen vermogen', b => b.equity, 'lvl1'),
          B('Totaal passiva', b => b.totalLiabEquity, 'key'),
          { label: 'Controle: activa − passiva', node: h('span', null, 'Controle: activa − passiva ', ui.statusChip(allClose, 'sluit', 'sluit niet')), values: cols.map(p => p.bs.check), cls: 'check', fmt: v => fmt.eur(Math.abs(v) < 0.005 ? 0 : v, { full: true }) }
        ];
        const windowNote = ser.length > cols.length ? 'Toont ' + cols.length + ' van ' + ser.length + ' periodes (' + fmt.period(cols[0].key, grain) + ' – ' + fmt.period(cols[cols.length - 1].key, grain) + '); kies een grovere korrel of een korter bereik voor alle periodes. ' : '';
        const legendNote = legendOf(cols);
        el.appendChild(ui.card({ title: 'Balans per ' + GRAIN_WORD[grain], subtitle: 'stand einde periode', body: statement(balRows), footer: windowNote + 'De controle-rij is activa − (schulden + eigen vermogen) in euro\'s; die is elke maand nul. ' + legendNote }));
        const C = (label, fn, cls) => ({ label, values: cols.map(p => fn(p.cf)), cls });
        const cfRows = [
          C('Nettowinst', x => x.netIncome, 'lvl1'), C('Afschrijvingen', x => x.dep, 'lvl1'), C('Mutatie debiteuren', x => x.dAR, 'lvl1'), C('Mutatie voorraden', x => x.dInv, 'lvl1'), C('Mutatie crediteuren', x => x.dAP, 'lvl1'), C('Mutatie belastingschuld', x => x.dTax, 'lvl1'),
          C('Kasstroom uit operationele activiteiten', x => x.cfo, 'key'),
          C('Investeringen', x => x.capex, 'lvl1'),
          C('Kasstroom uit investeringsactiviteiten', x => x.cfi, 'key'),
          C('Opname termijnlening', x => x.tlDraw, 'lvl1'), C('Aflossing termijnlening', x => x.tlRepay, 'lvl1'), C('Mutatie rekening-courantkrediet', x => x.rcfDraw + x.rcfRepay, 'lvl1'), C('Dividend', x => x.dividend, 'lvl1'), C('Kapitaalstorting', x => x.equityRaise, 'lvl1'),
          C('Kasstroom uit financieringsactiviteiten', x => x.cff, 'key'),
          C('Nettokasstroom', x => x.netCash, 'lvl0'),
          C('Kas begin', x => x.cashOpen, 'lvl1'),
          C('Kas eind', x => x.cashClose, 'key'),
          C('Vrije kasstroom', x => x.fcf, 'lvl2')
        ];
        el.appendChild(ui.card({ title: 'Kasstroomoverzicht per ' + GRAIN_WORD[grain], subtitle: 'indirecte methode · mutaties werkkapitaal als kaseffect (+ = kas vrij)', body: statement(cfRows), footer: windowNote + 'Vrije kasstroom = kasstroom uit operationele activiteiten + investeringen. Kas eind is de post Liquide middelen op de balans. ' + legendNote }));
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
