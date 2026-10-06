/*
 * Tab: Waardering — DCF op de forecast van het actieve scenario, met gevoeligheidsmatrix en multiples-cross-check.
 * Het besturingspaneel (WACC, eindgroei) wordt één keer gebouwd en houdt lokale toestand; de resultaten herberekenen bij
 * elke slider-beweging én bij elke wijziging van de globale filters (scenario, overrides). Korrel en periode spelen geen rol:
 * een DCF gebruikt altijd de volledige forecasthorizon.
 */
(function () {
  'use strict';
  const H = window.HC;
  H.tabs.register({
    id: 'waardering', label: 'Waardering', short: 'Waardering', order: 60, icon: 'value',
    render(root, ctx) {
      const { model, fmt, h, svg, ui, charts, E } = ctx;
      const pct2 = v => fmt.num(v * 100, 2) + '%';
      const STEP = 0.0025;
      const valDate = model.config.actualsUntil;
      const WACCS = Array.from({ length: 9 }, (_, i) => Math.round((0.07 + i * 0.005) * 1e6) / 1e6);   // 7–11 %
      const GROWTHS = Array.from({ length: 5 }, (_, i) => Math.round((0.01 + i * 0.005) * 1e6) / 1e6); // 1–3 %
      // Fictieve beursgenoteerde peers (verzonnen namen, illustratieve multiples)
      const PEERS = [
        { name: 'Noorderwiel N.V.', profile: 'NL · premium e-bikes, dealers', multiple: 9.8 },
        { name: 'Velomobile Group', profile: 'BE/FR · lease en retail', multiple: 11.5 },
        { name: 'Rheinrad AG', profile: 'DE · fietsen en componenten', multiple: 7.5 },
        { name: 'Cyclus Holding', profile: 'NL · fietsenketen, service', multiple: 8.6 },
        { name: 'Pedalis Mobility plc', profile: 'UK · stedelijke mobiliteit', multiple: 10.2 }
      ];
      // ---- lokale toestand van dit tabblad (bewust niet in HC.state) ----
      let wacc = 0.09, growth = 0.02;

      // ---------- pagina-kop (eenmalig) ----------
      const headChips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      root.appendChild(h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Waardering'), h('p', null, `DCF op basis van de vrije kasstroom (FCFF) uit het actieve scenario; eindwaarde volgens Gordon-groei; waardering per ultimo ${fmt.monthLong(valDate)}.`)),
        headChips));
      const grid = h('div', { class: 'grid' }); root.appendChild(grid);

      // ---------- besturingspaneel (eenmalig gebouwd) ----------
      const panel = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
      const waccSl = ui.slider({ id: 'val-wacc', label: 'WACC', min: 0.06, max: 0.14, step: STEP, value: wacc, format: pct2, onInput: v => { wacc = v; build(); }, hint: 'gewogen gemiddelde vermogenskostenvoet · stap 0,25 pp' });
      const gSl = ui.slider({ id: 'val-g', label: 'Eindgroei', min: 0, max: 0.04, step: STEP, value: growth, format: pct2, onInput: v => { growth = v; build(); }, hint: 'eeuwigdurende groei van de FCFF na 2029 (Gordon-groei)' });
      const waccInput = waccSl.querySelector('input'), waccOut = waccSl.querySelector('output');
      panel.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, h('div', { class: 'eyebrow' }, 'Disconteringsparameters'), waccSl, gSl));

      // WACC-opbouw (illustratief): CAPM voor eigen vermogen, kostenvoet vreemd vermogen na belasting, 25 % schuld
      const B = { rf: 0.027, beta: 1.2, mrp: 0.055, kd: 0.0445, tax: model.config.taxRate, debtShare: 0.25 };
      const ke = B.rf + B.beta * B.mrp; const kdAfter = B.kd * (1 - B.tax);
      const waccCalc = (1 - B.debtShare) * ke + B.debtShare * kdAfter;
      const waccSnap = Math.round(waccCalc / STEP) * STEP;
      const buildRows = [
        { c: 'Risicovrije rente (10-jaars staatsobligatie)', v: pct2(B.rf) },
        { c: 'Bèta (relevered)', v: fmt.num(B.beta, 2) },
        { c: 'Marktrisicopremie', v: pct2(B.mrp) },
        { c: 'Kosten eigen vermogen (CAPM)', v: pct2(ke), key: true },
        { c: 'Kosten vreemd vermogen vóór belasting', v: pct2(B.kd) },
        { c: 'VPB-tarief (uit het model)', v: fmt.pct(B.tax, 1) },
        { c: 'Kosten vreemd vermogen na belasting', v: pct2(kdAfter), key: true },
        { c: 'Aandeel vreemd vermogen in de financiering', v: fmt.pct(B.debtShare, 0) }
      ];
      const buildTbl = ui.table({ columns: [{ key: 'c', label: 'Component', class: 'label' }, { key: 'v', label: 'Waarde', align: 'num' }], rows: buildRows, rowClass: r => r.key ? 'sub' : '', footer: { c: 'WACC (berekend)', v: pct2(waccCalc) } });
      const applyBtn = ui.button('Gebruik berekende WACC', () => {
        waccInput.value = String(waccSnap); const v = Number(waccInput.value);
        wacc = v; waccOut.textContent = pct2(v); build();
      }, { sm: true, icon: 'check', id: 'val-apply' });
      panel.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('div', { class: 'eyebrow' }, 'WACC-opbouw (illustratief)'), buildTbl,
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, applyBtn, h('span', { class: 'small muted' }, 'afgerond op de sliderstap: ' + pct2(waccSnap)))));
      panel.appendChild(ui.note('Alle inputs in deze opbouw zijn fictieve, illustratieve aannames; ze zijn niet ontleend aan marktdata. De sliders bepalen wat rechts wordt doorgerekend.'));
      grid.appendChild(ui.card({ span: 4, title: 'Disconteringsvoet en eindgroei', subtitle: 'instellingen van dit tabblad · korrel en periode zijn hier niet van invloed', body: panel }));

      // ---------- resultaten (herbouwd bij elke wijziging) ----------
      const results = h('div', { class: 'span-8', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } });
      grid.appendChild(results);

      // ---------- toelichting (eenmalig) ----------
      const expl = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '90ch' } },
        h('p', null, 'De waardering is een directe functie van het scenario: elke driver op het tabblad ', h('a', { href: '#scenario' }, "Scenario's"), ' (volumegroei, prijsindexatie, materiaalkosten, werkkapitaaldagen, investeringen) verandert de FCFF per jaar en daarmee de contante waarde die hier wordt getoond. Omdat de eindwaarde wordt afgeleid van de FCFF van 2029, werkt een hogere EBITDA-marge in het laatste forecastjaar meer dan evenredig door in de ondernemingswaarde; een recessiescenario doet het omgekeerde.'),
        h('p', null, 'Drie kanttekeningen. De expliciete periode is kort (een kwartaal plus drie jaar), waardoor het grootste deel van de waarde in de eindwaarde zit en de keuze van WACC en eindgroei zwaarder weegt dan de forecast zelf. De eindwaarde veronderstelt dat de FCFF van 2029 representatief is voor een stabiele toestand, terwijl investeringen en werkkapitaalmutaties in dat jaar nog groeigedreven zijn. En de discontering volgt de mid-year-conventie van het engine per jaar; er is geen verdere correctie voor het gebroken eerste jaar of voor seizoenspatronen binnen het jaar.'),
        h('p', { class: 'small muted' }, 'De netto schuld is de stand per de waarderingsdatum (termijnlening plus rekening-courantkrediet minus kas); latente belastingposities, leaseverplichtingen en overtollige kas zijn niet apart gewaardeerd. Helder E-Bikes en de genoemde peers zijn fictief.'));
      const explCard = ui.card({ span: 12, title: 'Hoe deze waardering beweegt', subtitle: 'en wat je er niet uit mag lezen', body: expl });
      grid.appendChild(explCard);

      // ---------- hulpfuncties ----------
      function median(arr) { const s = arr.slice().sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
      function linear(d0, d1, r0, r1) { return v => r0 + (v - d0) / (d1 - d0 || 1) * (r1 - r0); }
      function responsive(container, draw) {
        let last = 0;
        const render = () => { const w = Math.max(240, Math.floor(container.getBoundingClientRect().width || (container.parentElement && container.parentElement.getBoundingClientRect().width) || 600)); if (w === last) return; last = w; H.clear(container); container.appendChild(draw(w)); };
        if ('ResizeObserver' in window) { const ro = new ResizeObserver(() => render()); ro.observe(container); } else window.addEventListener('resize', render);
        requestAnimationFrame(render); setTimeout(render, 0);
        return container;
      }
      /** 'football field': horizontale bandbreedtes op één gedeelde €-as, met een gestippelde marker voor de DCF-basiswaarde */
      function footballField(o) {
        const rows = o.rows; const n = rows.length; const f = o.format || fmt.eur;
        const el = h('div', { class: 'chart' });
        responsive(el, width => {
          const vals = rows.flatMap(r => [r.min, r.mid, r.max]).concat([o.marker.value]).filter(v => isFinite(v));
          const t = charts.niceTicks(Math.min(0, ...vals), Math.max(...vals), 5);
          const rowH = 48; const pad = { l: 8, r: 8, t: 20, b: 24 };
          const W = width, Hh = pad.t + n * rowH + pad.b, x0 = pad.l, x1 = W - pad.r, y0 = pad.t, y1 = Hh - pad.b;
          const sx = linear(t.lo, t.hi, x0, x1);
          const rootEl = svg('svg', { viewBox: `0 0 ${W} ${Hh}`, width: W, height: Hh, role: 'img', 'aria-label': 'Bandbreedtes van de waardering per methode' });
          const g = svg('g', { class: 'grid' });
          t.ticks.forEach((v, k) => { g.appendChild(svg('line', { x1: sx(v), x2: sx(v), y1: y0, y2: y1 })); rootEl.appendChild(svg('text', { class: 'axis-label', x: sx(v), y: Hh - 6, 'text-anchor': k === 0 ? 'start' : k === t.ticks.length - 1 ? 'end' : 'middle' }, f(v))); });
          rootEl.appendChild(g);
          rootEl.appendChild(svg('line', { class: 'baseline', x1: sx(0), x2: sx(0), y1: y0, y2: y1 }));
          rows.forEach((r, i) => {
            const top = y0 + i * rowH;
            rootEl.appendChild(svg('text', { class: 'dlabel strong', x: x0, y: top + 12 }, r.label));
            rootEl.appendChild(svg('text', { class: 'dlabel', x: x1, y: top + 12, 'text-anchor': 'end' }, f(r.min) + ' – ' + f(r.max)));
            const xa = sx(Math.min(r.min, r.max)), xb = sx(Math.max(r.min, r.max));
            const bar = svg('rect', { class: 'mark', x: xa, y: top + 19, width: Math.max(2, xb - xa), height: 14, rx: 4, fill: 'var(--series-1)', tabindex: '0' });
            const tip = e => ui.tooltip.show(e.clientX, e.clientY, ui.tooltip.content({ title: r.label, rows: [{ label: 'Laag', value: f(r.min) }, { label: r.midLabel || 'Midden', value: f(r.mid) }, { label: 'Hoog', value: f(r.max) }] }));
            bar.addEventListener('pointerenter', tip); bar.addEventListener('pointermove', tip); bar.addEventListener('pointerleave', () => ui.tooltip.hide());
            bar.addEventListener('focus', () => { const rc = bar.getBoundingClientRect(); tip({ clientX: rc.left + rc.width / 2, clientY: rc.top }); }); bar.addEventListener('blur', () => ui.tooltip.hide());
            rootEl.appendChild(bar);
            if (isFinite(r.mid)) rootEl.appendChild(svg('line', { x1: sx(r.mid), x2: sx(r.mid), y1: top + 16, y2: top + 36, stroke: 'var(--ink-2)', 'stroke-width': 2, 'pointer-events': 'none' }));
          });
          // marker: DCF-basiswaarde over alle rijen
          const mx = sx(o.marker.value);
          rootEl.appendChild(svg('line', { x1: mx, x2: mx, y1: y0 - 4, y2: y1, stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
          const mlab = o.marker.label; const mw = charts.measure(mlab);
          rootEl.appendChild(svg('text', { class: 'ann-text', x: mx + mw + 6 > x1 ? mx - 5 : mx + 5, y: y0 - 8, 'text-anchor': mx + mw + 6 > x1 ? 'end' : 'start', fill: 'var(--ink)' }, mlab));
          return rootEl;
        });
        return {
          el,
          legend: charts.legend([{ name: 'Bandbreedte laag–hoog', color: 'var(--series-1)', kind: 'rect' }, { name: 'Midden (mediaan / basis)', color: 'var(--ink-2)', kind: 'line' }, { name: o.marker.legend || 'DCF-basiswaarde', color: 'var(--ink)', kind: 'dashed' }]),
          table: () => ui.table({ columns: [{ key: 'label', label: 'Methode', class: 'label' }, { key: 'min', label: 'Laag', align: 'num', format: f }, { key: 'mid', label: 'Midden', align: 'num', format: f }, { key: 'max', label: 'Hoog', align: 'num', format: f }, { key: 'midLabel', label: 'Midden is', class: 'label' }], rows, footer: { label: o.marker.legend || 'DCF-basiswaarde', mid: o.marker.value, midLabel: 'huidige sliders' } })
        };
      }

      function build() {
        const t0 = performance.now();
        const s = H.state.get(); const sc = model.scenarios[s.scenarioKey] || model.scenarios.basis;
        const custom = Object.keys(s.overrides || {}).length > 0;
        const run = model.run();
        const d = E.dcf(run, { wacc, terminalGrowth: growth });
        const eqGrid = E.dcfGrid(run, WACCS, GROWTHS);
        const years = E.aggregate(run.months, 'Y'); const y27 = years.find(y => y.year === 2027);
        const ebitda27 = y27 ? y27.pl.ebitda : NaN; const ev27x = ebitda27 > 0 ? d.ev / ebitda27 : NaN;
        const isBasis = s.scenarioKey === 'basis' && !custom;
        const baseD = isBasis ? null : E.dcf(model.run(Object.assign({}, E.defaultAssumptions(), model.scenarios.basis.assumptions)), { wacc, terminalGrowth: growth });
        const ri = WACCS.findIndex(w => Math.abs(w - wacc) < 1e-9), ci = GROWTHS.findIndex(g => Math.abs(g - growth) < 1e-9);
        const baseCell = ri >= 0 && ci >= 0 ? [ri, ci] : null;
        const isDebt = d.netDebt >= 0;

        // kop-chips
        H.clear(headChips);
        headChips.appendChild(ui.chip('Balans per ' + fmt.month(valDate), 'actual'));
        headChips.appendChild(ui.chip('Forecast: ' + sc.label, 'forecast'));
        if (custom) headChips.appendChild(ui.chip(Object.keys(s.overrides).length + ' driver(s) aangepast', 'accent'));

        H.clear(results);
        // ---------- KPI's ----------
        const dl = (cur, base) => baseD ? ui.delta(cur, base, { label: 'vs. basisscenario' }) : null;
        const kp = h('div', { class: 'kpi-row two' });
        kp.appendChild(ui.kpi({ label: 'Ondernemingswaarde (EV)', value: fmt.eurM(d.ev), delta: dl(d.ev, baseD && baseD.ev), hint: 'WACC ' + pct2(wacc) + ' · eindgroei ' + pct2(growth) }));
        kp.appendChild(ui.kpi({ label: isDebt ? 'Netto schuld' : 'Netto kas', value: fmt.eur(Math.abs(d.netDebt)), hint: 'termijnlening + RCF − kas per ' + fmt.month(valDate) }));
        kp.appendChild(ui.kpi({ label: 'Waarde eigen vermogen', value: fmt.eurM(d.equityValue), delta: dl(d.equityValue, baseD && baseD.equityValue), hint: isDebt ? 'EV − netto schuld' : 'EV + netto kas' }));
        kp.appendChild(ui.kpi({ label: 'Impliciete EV/EBITDA (LTM)', value: fmt.x(d.evToEbitda, 1), hint: 'LTM EBITDA ' + fmt.eurM(d.ltmEbitda) + ' t/m ' + fmt.month(valDate) }));
        kp.appendChild(ui.kpi({ label: 'Aandeel eindwaarde in EV', value: fmt.pct(d.tvShare, 0), hint: 'PV eindwaarde ' + fmt.eurM(d.pvTv) + ' van ' + fmt.eurM(d.ev) }));
        kp.appendChild(ui.kpi({ label: 'Impliciete EV/EBITDA 2027', value: fmt.x(ev27x, 1), hint: 'EBITDA 2027 ' + fmt.eurM(ebitda27) + ' (forecast)' }));
        results.appendChild(kp);
        results.appendChild(d.tvShare > 0.85
          ? ui.note(fmt.pct(d.tvShare, 0) + ' van de ondernemingswaarde zit in de eindwaarde: bij deze combinatie van WACC en eindgroei is de waardering vooral een uitspraak over de periode ná 2029, niet over de forecast zelf.', 'warning')
          : ui.note('De eindwaarde is ' + fmt.pct(d.tvShare, 0) + ' van de ondernemingswaarde; de expliciete periode (' + fmt.month(E.addMonths(valDate, 1)) + ' t/m dec 2029) draagt ' + fmt.eurM(d.pvExplicit) + ' bij.', 'accent'));

        const g2 = h('div', { class: 'grid' });
        // ---------- waterval ----------
        const wf = charts.waterfall({ steps: [
          { label: 'PV expliciete periode', value: d.pvExplicit, type: 'total' },
          { label: 'PV eindwaarde', value: d.pvTv, type: 'delta' },
          { label: 'Ondernemingswaarde', value: d.ev, type: 'total' },
          { label: isDebt ? 'Netto schuld' : 'Netto kas', value: -d.netDebt, type: 'delta' },
          { label: 'Waarde eigen vermogen', value: d.equityValue, type: 'total' }
        ], yFormat: fmt.eur, height: 270 });
        g2.appendChild(ui.card({ span: 12, title: 'Van kasstromen naar aandeelhouderswaarde', subtitle: 'contante waarden per ultimo ' + fmt.monthLong(valDate) + ' · scenario ' + sc.label.toLowerCase(), body: ui.figure({ chart: wf }) }));

        // ---------- FCFF-tabel ----------
        let elapsed = 0;
        const fcffRows = d.rows.map(r => {
          const start = E.addMonths(valDate, 1 + elapsed); const end = E.addMonths(start, r.months - 1); elapsed += r.months;
          return { label: r.months === 12 ? String(r.year) : r.year + ' (' + fmt.monthShort(start) + '–' + fmt.monthShort(end) + ')', ebitda: r.ebitda, ebit: r.ebit, nopat: r.nopat, dep: r.dep, capex: -r.capex, dNwc: -r.dNwc, fcff: r.fcff, df: r.df, pv: r.pv };
        });
        const tvDf = isFinite(d.tv) && d.tv !== 0 ? d.pvTv / d.tv : NaN;
        fcffRows.push({ label: 'Eindwaarde ultimo 2029', fcff: d.tv, df: tvDf, pv: d.pvTv, isTv: true });
        const eurCell = v => v == null ? '' : fmt.eurM(v);
        const fcffTbl = ui.table({ columns: [
          { key: 'label', label: 'Jaar', class: 'label' },
          { key: 'ebitda', label: 'EBITDA', align: 'num', format: eurCell }, { key: 'ebit', label: 'EBIT', align: 'num', format: eurCell }, { key: 'nopat', label: 'NOPAT', align: 'num', format: eurCell },
          { key: 'dep', label: 'Afschrijvingen', align: 'num', format: eurCell }, { key: 'capex', label: 'Investeringen', align: 'num', format: eurCell }, { key: 'dNwc', label: 'Mutatie werkkapitaal', align: 'num', format: eurCell },
          { key: 'fcff', label: 'FCFF', align: 'num', format: eurCell }, { key: 'df', label: 'Discontofactor', align: 'num', format: v => v == null ? '' : fmt.num(v, 2) }, { key: 'pv', label: 'Contante waarde', align: 'num', format: eurCell }
        ], rows: fcffRows, rowClass: r => r.isTv ? 'key' : 'forecast', footer: { label: 'Ondernemingswaarde', pv: d.ev },
          caption: 'NOPAT = EBIT × (1 − ' + fmt.pct(model.config.taxRate, 1) + ') · FCFF = NOPAT + afschrijvingen − investeringen − mutatie werkkapitaal · eindwaarde = FCFF 2029 × (1 + g) / (WACC − g), gedisconteerd per ultimo 2029' });
        g2.appendChild(ui.card({ span: 12, title: 'Vrije kasstroom per jaar en contante waarde', subtitle: 'expliciete periode ' + fmt.month(E.addMonths(valDate, 1)) + ' t/m dec 2029 · mid-year-discontering vanaf de waarderingsdatum', body: fcffTbl, footer: 'Werkkapitaal = debiteuren + voorraad − crediteuren; een negatieve mutatie is een vrijval die kas oplevert. Investeringen volgens de driver "Investeringen per jaar" van het scenario.' }));

        // ---------- gevoeligheid ----------
        const heat = charts.heatTable({ corner: 'WACC ↓  eindgroei →', rows: WACCS.map(w => fmt.pct(w, 1)), cols: GROWTHS.map(g => fmt.pct(g, 1)), values: eqGrid, format: fmt.eurM, base: baseCell });
        const flat = eqGrid.flat(); const gridMin = Math.min(...flat), gridMax = Math.max(...flat);
        g2.appendChild(ui.card({ span: 12, title: 'Gevoeligheid van de waarde van het eigen vermogen', subtitle: 'WACC 7–11% × eindgroei 1–3% · ' + (baseCell ? 'omlijnde cel = huidige instelling' : 'huidige instelling (' + pct2(wacc) + ' / ' + pct2(growth) + ') ligt buiten het raster'),
          body: ui.figure({ chart: heat, note: 'Bandbreedte ' + fmt.eurM(gridMin) + ' – ' + fmt.eurM(gridMax) + '; een verschil van 1 pp in de WACC weegt zwaarder dan 1 pp eindgroei zolang de WACC ruim boven de groei ligt.' }),
          footer: WACCS.length * GROWTHS.length + ' DCF-berekeningen in ' + Math.max(1, Math.round(performance.now() - t0)) + ' ms.' }));

        // ---------- multiples-cross-check ----------
        const mults = PEERS.map(p => p.multiple); const mMin = Math.min(...mults), mMax = Math.max(...mults), mMed = median(mults);
        const ltm = d.ltmEbitda;
        const peersTbl = ui.table({ columns: [{ key: 'name', label: 'Peer (fictief)' }, { key: 'profile', label: 'Profiel', class: 'label' }, { key: 'multiple', label: 'EV/EBITDA', align: 'num', format: v => fmt.x(v, 1) }], rows: PEERS.slice().sort((a, b) => b.multiple - a.multiple), footer: { name: 'Mediaan', profile: 'laagste ' + fmt.x(mMin, 1) + ' · hoogste ' + fmt.x(mMax, 1), multiple: mMed } });
        const xRows = [
          { label: 'EV/EBITDA peers', lo: mMin, mid: mMed, hi: mMax, f: v => fmt.x(v, 1) },
          { label: 'Impliciete EV op LTM EBITDA (' + fmt.eurM(ltm) + ')', lo: mMin * ltm, mid: mMed * ltm, hi: mMax * ltm, f: fmt.eurM },
          { label: 'Impliciete EV op EBITDA 2027 (' + fmt.eurM(ebitda27) + ')', lo: mMin * ebitda27, mid: mMed * ebitda27, hi: mMax * ebitda27, f: fmt.eurM }
        ];
        const xTbl = ui.table({ columns: [{ key: 'label', label: 'Maatstaf', class: 'label' }, { key: 'lo', label: 'Laag', align: 'num', format: (v, r) => r.f(v) }, { key: 'mid', label: 'Mediaan', align: 'num', format: (v, r) => r.f(v) }, { key: 'hi', label: 'Hoog', align: 'num', format: (v, r) => r.f(v) }], rows: xRows });
        const ff = footballField({
          rows: [
            { label: 'DCF (raster WACC 7–11%, g 1–3%)', min: gridMin + d.netDebt, mid: d.ev, max: gridMax + d.netDebt, midLabel: 'huidige sliders' },
            { label: 'Peers × LTM EBITDA', min: mMin * ltm, mid: mMed * ltm, max: mMax * ltm, midLabel: 'mediaan peers' },
            { label: 'Peers × EBITDA 2027', min: mMin * ebitda27, mid: mMed * ebitda27, max: mMax * ebitda27, midLabel: 'mediaan peers' }
          ],
          marker: { value: d.ev, label: 'DCF ' + fmt.eurM(d.ev), legend: 'DCF-basiswaarde (EV)' }, format: fmt.eur
        });
        const pos = (x, lo, hi) => x > hi ? 'boven' : x < lo ? 'onder' : 'binnen';
        const readOut = 'De DCF impliceert ' + fmt.x(d.evToEbitda, 1) + ' LTM EBITDA, ' + pos(d.evToEbitda, mMin, mMax) + ' de bandbreedte van de peers (' + fmt.x(mMin, 1) + '–' + fmt.x(mMax, 1) + '); op EBITDA 2027 is dat ' + fmt.x(ev27x, 1) + ', ' + pos(ev27x, mMin, mMax) + ' die bandbreedte. ' + (d.evToEbitda > mMax ? 'Het verschil is de groei die het scenario in de forecast veronderstelt: wie de DCF gelooft, betaalt vandaag voor de EBITDA van 2027 en later.' : 'De DCF en de multiples wijzen in dezelfde richting; het verschil zit in de groeiveronderstelling van het scenario.');
        g2.appendChild(ui.card({ span: 12, title: 'Cross-check met multiples van beursgenoteerde peers', subtitle: 'ondernemingswaarde per methode op één as · marker = DCF bij de huidige sliders',
          body: [ui.figure({ chart: ff, note: readOut }), h('div', { class: 'grid' }, h('div', { class: 'span-6', style: { minWidth: 0 } }, peersTbl), h('div', { class: 'span-6', style: { minWidth: 0 } }, xTbl))],
          footer: 'De peers en hun multiples zijn verzonnen voor deze demo; de DCF-bandbreedte is de gevoeligheidsmatrix hierboven plus de netto schuld (' + fmt.eur(d.netDebt) + ').' }));
        results.appendChild(g2);
      }
      build();
      ctx.subscribe(build);
    }
  });
})();
