/* Tab: Analist — stel vragen aan Claude over het model (sample-capability in het Claude-artifact), met tools om scenario's door te rekenen.
   Buiten het artifact: modelgestuurde antwoorden op de voorbeeldvragen, zonder Claude. */
(function () {
  'use strict';
  const H = window.HC;
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || '';
  const WORKER_URL = SCRIPT_URL ? SCRIPT_URL.replace(/tabs\/analist\.js(\?.*)?$/, 'mc-worker.js') : 'app/mc-worker.js';
  const MC_SEED = 20261006;
  const MC_N = 2000;

  // ---------- veilige, minimale markdown-weergave (geen innerHTML) ----------
  function renderMarkdown(text, h) {
    const root = h('div', { class: 'md' });
    const lines = String(text || '').split('\n');
    let list = null, listType = null;
    const inline = (s) => {
      const frag = document.createDocumentFragment();
      const re = /(\*\*[^*]+\*\*|`[^`]+`)/g; let last = 0, m;
      while ((m = re.exec(s))) {
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        const tok = m[0];
        if (tok.startsWith('**')) frag.appendChild(h('strong', null, tok.slice(2, -2))); else frag.appendChild(h('code', { class: 'mono' }, tok.slice(1, -1)));
        last = m.index + tok.length;
      }
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      return frag;
    };
    const flush = () => { if (list) { root.appendChild(list); list = null; listType = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line), ol = /^\s*\d+[.)]\s+(.*)$/.exec(line), hd = /^\s*#{1,4}\s+(.*)$/.exec(line);
      if (ul || ol) { const type = ul ? 'ul' : 'ol'; if (!list || listType !== type) { flush(); list = h(type, { style: { margin: '4px 0 4px 18px', padding: 0 } }); listType = type; } list.appendChild(h('li', null, inline((ul || ol)[1]))); continue; }
      flush();
      if (hd) { root.appendChild(h('h4', { style: { margin: '8px 0 2px' } }, hd[1])); continue; }
      if (!line.trim()) { continue; }
      root.appendChild(h('p', { style: { margin: '0 0 6px' } }, inline(line)));
    }
    flush();
    return root;
  }

  // ---------- gedeelde helpers ----------
  /** scenario-label volgens de canon: 'Basis', 'Basis (aangepast)', 'Expansie DE' — nooit verkleind */
  function scLabel(model) { const s = H.state.get(); const sc = model.scenarios[s.scenarioKey] || model.scenarios.basis; return sc.label + (Object.keys(s.overrides || {}).length ? ' (aangepast)' : ''); }

  /** laagste kas in een reeks maanden. De kasvloer (minimumkas) geeft floating-point-ruis, dus er wordt op hele euro's vergeleken;
   *  bij gelijke stand telt de maand met de hoogste RCF-stand als de echte klem. → { cash, m, months, floor, contiguous } */
  function lowestCash(ms) {
    let best = null;
    for (const m of ms) { const c = Math.round(m.bs.cash); if (!best || c < best.c || (c === best.c && m.bs.rcf > best.m.bs.rcf)) best = { c, m }; }
    const months = ms.filter(m => Math.round(m.bs.cash) === best.c);
    const idx = months.map(m => ms.indexOf(m));
    return { cash: best.m.bs.cash, m: best.m, months, floor: months.length > 1, contiguous: idx.every((v, i) => i === 0 || v === idx[i - 1] + 1) };
  }
  /** zin bij lowestCash(): '€ 2,6M in juni 2028 (RCF € 0,8M getrokken)' of '€ 2,5M (minimumkas) van mei t/m juli 2027, RCF-piek € 3,1M in juni 2027' */
  function lowestCashText(fmt, lc) {
    const rcf = lc.m.bs.rcf;
    if (!lc.floor) return fmt.eurM(lc.cash) + ' in ' + fmt.monthLong(lc.m.period) + (rcf > 1 ? ' (RCF ' + fmt.eurM(rcf) + ' getrokken)' : '');
    const first = lc.months[0], last = lc.months[lc.months.length - 1];
    const span = lc.contiguous
      ? 'van ' + (first.year === last.year ? fmt.monthLong(first.period).replace(/ \d{4}$/, '') : fmt.monthLong(first.period)) + ' t/m ' + fmt.monthLong(last.period)
      : 'in ' + fmt.int(lc.months.length) + ' maanden (eerst ' + fmt.monthLong(first.period) + ')';
    return fmt.eurM(lc.cash) + ' (minimumkas) ' + span + (rcf > 1 ? ', RCF-piek ' + fmt.eurM(rcf) + ' in ' + fmt.monthLong(lc.m.period) : '');
  }

  /** Monte Carlo in de Web Worker (regel 8): één brok is bit-voor-bit gelijk aan engine.monteCarlo, dus het resultaat is identiek aan
   *  model.monteCarlo(). Terugval op de hoofdthread als er geen worker gemaakt kan worden; gememoized per aannames en doeljaar. */
  const mcCache = new Map();
  function monteCarloAsync(model, n, seed, opts, signal) {
    const key = model.assumptionsKey() + '|' + n + '|' + seed + '|' + JSON.stringify(opts);
    if (mcCache.has(key)) return Promise.resolve(mcCache.get(key));
    const sync = () => model.monteCarlo(n, seed, null, opts);
    if (typeof Worker !== 'function') return Promise.resolve(sync());
    return new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(WORKER_URL); } catch (e) { resolve(sync()); return; }
      let settled = false;
      const finish = (fn, v) => { if (settled) return; settled = true; try { w.terminate(); } catch (e) { /* al gestopt */ } fn(v); };
      if (signal) signal.addEventListener('abort', () => finish(reject, Object.assign(new Error('geannuleerd'), { cancelled: true })));
      w.onmessage = ev => { const m = ev.data || {}; if (m.type === 'part') { mcCache.set(key, m.part); finish(resolve, m.part); } else if (m.type === 'error') finish(reject, new Error(m.message)); };
      w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); finish(resolve, sync()); };
      w.postMessage({ id: 1, dataset: model.datasetForWorker(), assumptions: model.assumptions(), unc: null, n, seed, opts: Object.assign({}, opts, { chunks: 1 }) });
    });
  }

  // ---------- modelgestuurde antwoorden (zonder Claude) ----------
  function offlineAnswers(ctx) {
    const { model, fmt, E } = ctx;
    const run = model.run(); const months = run.months; const ltm = model.ltm(); const prior = model.priorLtm();
    const last = months[model.actualCount - 1];
    const sc = scLabel(model);
    const qs = E.aggregate(model.actualMonths(), 'Q');
    const q3 = qs.find(q => q.key === '2025-Q3'), q2 = qs.find(q => q.key === '2025-Q2'), q3p = qs.find(q => q.key === '2024-Q3'), q4 = qs.find(q => q.key === '2025-Q4');
    const matPerUnit = q => q.pl.materialCost / q.kpi.units;
    const y27 = model.year(2027); const fc = model.forecastMonths();
    const quarters27 = E.aggregate(fc.filter(m => m.year === 2027), 'Q');
    const minHeadroom = quarters27.reduce((a, q) => (model.config.covenantLeverageMax - q.kpi.leverage) < a.v ? { v: model.config.covenantLeverageMax - q.kpi.leverage, q } : a, { v: Infinity, q: null });
    const a = model.assumptions(); const altRun = model.run(Object.assign({}, a, { dso: a.dso - 10 })); const alt27 = E.aggregate(altRun.months, 'Y').find(y => y.year === 2027);
    const lines = E.LINES.map(l => ({ l, u: ltm.byLine[l].units, m: (ltm.byLine[l].revenue - ltm.byLine[l].cogs) / ltm.byLine[l].units, pct: (ltm.byLine[l].revenue - ltm.byLine[l].cogs) / ltm.byLine[l].revenue, tot: ltm.byLine[l].revenue - ltm.byLine[l].cogs })).sort((p, q) => q.m - p.m);
    const topTotal = lines.reduce((p, x) => x.tot > p.tot ? x : p, lines[0]);
    const ev25 = model.events.filter(e => e.period >= '2025-07' && e.period <= '2025-09');
    const zeroAlready = a.volumeGrowth === 0;
    const zeroRun = zeroAlready ? run : model.run(Object.assign({}, a, { volumeGrowth: 0 })); const zeroYears = E.aggregate(zeroRun.months, 'Y'); const z27 = zeroYears.find(y => y.year === 2027), z29 = zeroYears.find(y => y.year === 2029), y29 = model.year(2029);
    const zeroFc = zeroRun.months.slice(model.actualCount); const zeroLow = lowestCash(zeroFc); const zeroBreach = zeroFc.find(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk));
    const zeroHead = zeroAlready
      ? `De volumegroei staat in het actieve scenario ${sc} al op 0%; dit zijn de uitkomsten:\n\n- EBITDA 2027: **${fmt.eurM(z27.pl.ebitda)}**\n- Kas eind 2027: ${fmt.eurM(z27.bs.cash)}; eind 2029: ${fmt.eurM(z29.bs.cash)}\n`
      : `Bij **0% volumegroei** (in plaats van ${fmt.signedPct(a.volumeGrowth, 1)} per jaar) in scenario ${sc}:\n\n- EBITDA 2027: **${fmt.eurM(z27.pl.ebitda)}** tegenover ${fmt.eurM(y27.pl.ebitda)} (${fmt.signed(z27.pl.ebitda - y27.pl.ebitda, fmt.eurM)})\n- Kas eind 2027: ${fmt.eurM(z27.bs.cash)} tegenover ${fmt.eurM(y27.bs.cash)}; eind 2029: ${fmt.eurM(z29.bs.cash)} tegenover ${fmt.eurM(y29.bs.cash)}\n`;
    const covOk = last.kpi.covenantLeverageOk && last.kpi.covenantIcrOk;
    return [
      { q: 'Waarom daalde de brutomarge in Q3 2025?', a: `**Brutomarge Q3 2025: ${fmt.pct(q3.kpi.grossMarginPct)}** tegenover ${fmt.pct(q2.kpi.grossMarginPct)} in Q2 2025 en ${fmt.pct(q3p.kpi.grossMarginPct)} in Q3 2024.\n\n${ev25.map(e => '- **' + e.title + '** (' + fmt.monthLong(e.period) + '): ' + e.text).join('\n')}\n\nDe materiaalkosten per e-bike lagen in Q3 2025 ${fmt.pct(matPerUnit(q3) / matPerUnit(q2) - 1, 0)} hoger dan in Q2 2025; omdat de prijsverhoging van 3% pas in oktober inging, kwam de klap volledig in het derde kwartaal terecht. In Q4 2025 herstelde de brutomarge naar ${fmt.pct(q4.kpi.grossMarginPct)}.` },
      { q: 'Hoeveel ruimte zit er in 2027 onder de convenant nettoschuld / EBITDA?', a: `De convenant eist **nettoschuld / EBITDA ≤ ${fmt.x(model.config.covenantLeverageMax)}** (leverage), getoetst per kwartaal over de laatste twaalf maanden (LTM). Forecast 2027 volgens scenario ${sc}:\n\n${quarters27.map(q => '- ' + fmt.quarter(q.key) + ': ' + (q.kpi.netDebt < 0 ? 'nettokas ' + fmt.eurM(-q.kpi.netDebt) + ' (ratio niet van toepassing)' : fmt.x(q.kpi.leverage, 2) + ' bij nettoschuld ' + fmt.eurM(q.kpi.netDebt) + ' en EBITDA LTM ' + fmt.eurM(q.kpi.ltmEbitda))).join('\n')}\n\n${minHeadroom.q && minHeadroom.q.kpi.netDebt > 0 ? 'De krapste toets is ' + fmt.quarter(minHeadroom.q.key) + ' met ' + fmt.x(minHeadroom.v, 2) + ' ruimte: de EBITDA LTM mag daar tot ' + fmt.eurM(minHeadroom.q.kpi.netDebt / model.config.covenantLeverageMax) + ' zakken voordat de grens wordt geraakt.' : 'In dit scenario heeft Helder in 2027 een nettokaspositie, zodat de convenant nettoschuld / EBITDA niet knelt. Het tabblad Risico toont hoe vaak dat in een Monte Carlo-simulatie anders uitpakt.'}` },
      { q: 'Wat is het effect van 10 dagen kortere debiteurentermijn (DSO) op de kas?', a: `In scenario ${sc} is dit het verschil in 2027 met een debiteurentermijn (DSO) van ${fmt.days(a.dso - 10)} in plaats van de huidige ${fmt.days(a.dso)}:\n\n- Kas eind 2027: **${fmt.eurM(alt27.bs.cash)}** tegenover ${fmt.eurM(y27.bs.cash)} (${fmt.signed(alt27.bs.cash - y27.bs.cash, fmt.eurM)})\n- Debiteuren eind 2027: ${fmt.eurM(alt27.bs.ar)} tegenover ${fmt.eurM(y27.bs.ar)}\n- Vrije kasstroom 2027: ${fmt.eurM(alt27.cf.fcf)} tegenover ${fmt.eurM(y27.cf.fcf)}\n- Netto rentelasten 2027: ${fmt.eurM(alt27.pl.netInterest)} tegenover ${fmt.eurM(y27.pl.netInterest)}\n\nTien dagen minder debiteuren maakt grofweg 10/30 × een maandomzet vrij; omdat het rekening-courantkrediet rente kost en kas rente oplevert, tikt het ook door in de winst. Verschuif de slider Debiteurentermijn op het tabblad Scenario's om dit per maand te volgen.` },
      { q: 'Vat de financiële positie samen voor de raad van commissarissen.', a: `**Samenvatting per ${fmt.monthLong(model.lastActualPeriod)}**\n\n- Omzet LTM ${fmt.eurM(ltm.pl.revenue)} (${fmt.signedPct((ltm.pl.revenue - prior.pl.revenue) / prior.pl.revenue, 1)} vs. jaar ervoor) met ${fmt.int(ltm.kpi.units)} verkochte e-bikes; Duitsland en lease groeien het hardst.\n- EBITDA LTM ${fmt.eurM(ltm.pl.ebitda)} (EBITDA-marge ${fmt.pct(ltm.kpi.ebitdaPct)}), na een 2025 dat werd gedrukt door de terugroepactie en de celprijsspike; de brutomarge staat weer op ${fmt.pct(ltm.kpi.grossMarginPct)}.\n- Kas per ${fmt.monthLong(last.period)} ${fmt.eurM(last.bs.cash)} en ${last.kpi.netDebt < 0 ? 'een nettokaspositie' : 'nettoschuld ' + fmt.eurM(last.kpi.netDebt)}; ${covOk ? 'beide convenanten binnen de limiet' : 'convenantbreuk'}; ${last.bs.rcf > 1 ? 'RCF benut ' + fmt.eurM(last.bs.rcf) : 'het rekening-courantkrediet is onbenut'}.\n- Forecast ${sc}: omzet ${fmt.eurM(y27.pl.revenue)} en EBITDA ${fmt.eurM(y27.pl.ebitda)} in 2027; laagste kas in de forecast ${lowestCashText(fmt, lowestCash(fc))}.\n- Aandachtspunten: werkkapitaal door de Duitse dealertermijnen, celprijsvolatiliteit en de uitvoering van de ERP-migratie.` },
      { q: 'Wat gebeurt er met de kas als de volumegroei naar 0% gaat?', a: zeroHead + `- Laagste kas in de forecast: ${lowestCashText(fmt, zeroLow)}\n- Convenanten: ${zeroBreach ? 'convenantbreuk in ' + fmt.monthLong(zeroBreach.period) : 'blijven binnen de limiet'}\n\nZonder groei blijven de vaste kosten (personeel, huisvesting, afschrijvingen) doorlopen terwijl de brutowinst niet meegroeit; wel komt er werkkapitaal vrij omdat debiteuren en voorraad niet meer hoeven mee te groeien. Verschuif de slider Volumegroei op het tabblad Scenario's om tussenstanden te zien.` },
      { q: 'Welke productlijn verdient het meest per e-bike?', a: `Marge per e-bike over de laatste twaalf maanden (omzet minus kostprijs, inclusief garantie):\n\n${lines.map((x, i) => (i + 1) + '. **' + x.l + '**: ' + fmt.eur(x.m, { full: true }) + ' per e-bike (' + fmt.pct(x.pct) + ' brutomarge, ' + fmt.int(x.u) + ' e-bikes)').join('\n')}\n\n${topTotal.l === lines[0].l ? lines[0].l + ' levert zowel per e-bike als in totaal (' + fmt.eurM(topTotal.tot) + ' brutowinst) het meest op.' : lines[0].l + ' levert per e-bike het meest op, ' + topTotal.l + ' het meest in totaal (' + fmt.eurM(topTotal.tot) + ' brutowinst) door het volume.'} De prijsmix per kanaal speelt mee: dealers kopen tegen 70% van de adviesprijs, de webshop levert de volle prijs maar vraagt marketing.` }
    ];
  }

  H.tabs.register({
    id: 'analist', label: 'Analist', short: 'Analist', order: 70, icon: 'chat',
    render(root, ctx) {
      const { model, fmt, h, ui, E } = ctx;
      const headChips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      root.appendChild(h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Analist'), h('p', null, 'Stel een vraag over de cijfers. De analist leest het volledige model (jaren, kwartalen, balans, gebeurtenissen en het actieve scenario) en kan wat-als-vragen zelf doorrekenen met het engine. De filters korrel en periode gelden hier niet; het scenario wel.')),
        headChips));
      const syncHead = () => { H.clear(headChips); headChips.appendChild(ui.scenarioChip()); };
      syncHead();
      const grid = h('div', { class: 'grid' }); root.appendChild(grid);
      const chatCard = h('div', { class: 'span-8', style: { minWidth: 0 } }); grid.appendChild(chatCard);
      const side = h('div', { class: 'span-4', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } }); grid.appendChild(side);

      const suggestions = ['Waarom daalde de brutomarge in Q3 2025?', 'Hoeveel ruimte zit er in 2027 onder de convenant nettoschuld / EBITDA?', 'Wat is het effect van 10 dagen kortere debiteurentermijn (DSO) op de kas?', 'Vat de financiële positie samen voor de raad van commissarissen.', 'Welke productlijn verdient het meest per e-bike?', 'Wat gebeurt er met de kas als de volumegroei naar 0% gaat?'];
      let mode = 'wachten'; // wachten | claude | offline
      let sample = null, toolsOk = false;
      const turns = []; let busy = false, ctl = null;

      // ---------- UI-elementen die ook door de tools gebruikt worden ----------
      const log = h('div', { class: 'chat-log', id: 'chat-log', 'aria-live': 'polite' });
      const status = h('div', { class: 'small muted', id: 'chat-status' });
      const input = h('textarea', { id: 'chat-input', placeholder: 'Uw vraag', 'aria-label': 'Uw vraag', rows: 2 });

      function instruction() {
        return 'Je bent de financieel analist van Helder E-Bikes B.V. (een fictief bedrijf; dit is een demonstratie). Je beantwoordt vragen van de CFO en het managementteam in het Nederlands: bondig, concreet en met cijfers uit de modelsamenvatting hieronder of uit tool-resultaten.\n' +
          'Regels: (1) gebruik uitsluitend cijfers uit de samenvatting of uit tools; verzin niets en zeg het als iets niet in het model zit; (2) bedragen in miljoenen met één decimaal (bijv. € 13,8M), percentages met één decimaal; (3) maak onderscheid tussen actual (t/m ' + fmt.monthLong(model.lastActualPeriod) + ') en forecast; jaarlabels in tool-resultaten: * = deels forecast · F = forecast; (4) bij een wat-als-vraag gebruik je de tool bereken_scenario met de gewijzigde drivers en vergelijk je met het actieve scenario; pas de cockpit alleen aan met pas_scenario_toe als de gebruiker dat expliciet vraagt; (5) verwijs waar nuttig naar een tabblad (Overzicht, Winst & verlies, Balans & kasstroom, Scenario\'s, Risico, Waardering, Power BI); (6) maximaal ongeveer 200 woorden, in korte alinea\'s of opsommingen met **vet** voor de kernuitkomst; geen disclaimers, behalve hooguit één keer dat de data fictief is als dat ter zake doet; (7) termen: \'nettoschuld / EBITDA\' (niet \'leverage\'), \'rentedekking\', \'vrije kasstroom\', \'investeringen\', \'EBITDA LTM\', \'per e-bike\'; het actieve scenario heet \'' + scLabel(model) + '\'. Vandaag is 6 oktober 2026.\n\n--- MODELSAMENVATTING ---\n' + model.digest();
      }
      function assumptionTool(input) {
        const a = Object.assign({}, model.assumptions());
        const meta = H.util.assumptionMeta;
        for (const k in meta) { if (input[k] == null) continue; if (meta[k].type === 'bool') a[k] = !!input[k]; else { const v = Number(input[k]); if (isFinite(v)) a[k] = Math.max(meta[k].min, Math.min(meta[k].max, v)); } }
        return a;
      }
      function summarize(run) {
        const years = E.aggregate(run.months, 'Y').filter(y => y.year >= 2026);
        const fc = run.months.slice(model.actualCount);
        const breach = fc.find(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk));
        const lc = lowestCash(fc);
        return {
          aannames: run.assumptions,
          legenda: '* = deels forecast · F = forecast',
          jaren: years.map(y => ({ jaar: y.year + (y.isActual ? '' : y.months.some(m => m.isActual) ? '*' : ' F'), omzet: Math.round(y.pl.revenue), eenheden: Math.round(y.kpi.units), brutomargePct: +(y.kpi.grossMarginPct * 100).toFixed(1), ebitda: Math.round(y.pl.ebitda), ebitdaMargePct: +(y.kpi.ebitdaPct * 100).toFixed(1), nettowinst: Math.round(y.pl.netIncome), operationeleKasstroom: Math.round(y.cf.cfo), investeringen: Math.round(-y.cf.capex), vrijeKasstroom: Math.round(y.cf.fcf), kasEind: Math.round(y.bs.cash), nettoschuld: Math.round(y.kpi.netDebt), nettoschuldEbitda: +y.kpi.leverage.toFixed(2), rentedekking: +Math.min(99, y.kpi.icr).toFixed(1), fte: Math.round(y.kpi.fte) })),
          laagsteKas: { bedrag: Math.round(lc.cash), maand: lc.m.period, rcfGetrokken: Math.round(lc.m.bs.rcf), maandenOpMinimum: lc.months.length },
          eersteConvenantbreuk: breach ? breach.period : null
        };
      }
      const mcStatus = 'Monte Carlo-simulatie loopt…';
      const tools = [
        { name: 'bereken_scenario', description: 'Rekent de forecast (okt 2026 t/m 2029) opnieuw door met gewijzigde drivers en geeft jaarcijfers 2026–2029 terug (omzet, EBITDA, nettowinst, vrije kasstroom, kas, nettoschuld, nettoschuld / EBITDA, rentedekking) plus laagste kas en eerste convenantbreuk. Niet-opgegeven drivers blijven zoals in het actieve scenario. Gebruik dit voor elke wat-als-vraag.', inputSchema: { type: 'object', properties: { volumeGrowth: { type: 'number', description: 'volumegroei per jaar als fractie, bijv. 0.08' }, priceIndex: { type: 'number', description: 'prijsindexatie per jaar, fractie' }, materialIndex: { type: 'number', description: 'stijging materiaalkosten per eenheid per jaar, fractie' }, fteGrowth: { type: 'number' }, wageIndex: { type: 'number' }, marketingPct: { type: 'number', description: 'marketing als fractie van omzet, bijv. 0.054' }, dso: { type: 'number', description: 'debiteurentermijn in dagen (DSO)' }, dio: { type: 'number', description: 'voorraaddagen (DIO)' }, dpo: { type: 'number', description: 'crediteurentermijn in dagen (DPO)' }, capexPerYear: { type: 'number', description: 'investeringen per jaar in euro' }, dividendPct: { type: 'number', description: 'dividend als fractie van de winst van vorig jaar' }, deExpansion: { type: 'boolean' }, leaseBoost: { type: 'number' } } }, execute(input) { return summarize(model.run(assumptionTool(input || {}))); } },
        { name: 'pas_scenario_toe', description: 'Past de opgegeven drivers toe in de cockpit zelf, zodat alle tabbladen de nieuwe forecast tonen. Alleen gebruiken als de gebruiker daar expliciet om vraagt. Geeft de nieuwe jaarcijfers terug.', inputSchema: { type: 'object', properties: { volumeGrowth: { type: 'number' }, priceIndex: { type: 'number' }, materialIndex: { type: 'number' }, fteGrowth: { type: 'number' }, wageIndex: { type: 'number' }, marketingPct: { type: 'number' }, dso: { type: 'number' }, dio: { type: 'number' }, dpo: { type: 'number' }, capexPerYear: { type: 'number' }, dividendPct: { type: 'number' }, deExpansion: { type: 'boolean' }, leaseBoost: { type: 'number' } } }, execute(input) { const a = assumptionTool(input || {}); const s = H.state.get(); const base = Object.assign({}, E.defaultAssumptions(), model.scenarios[s.scenarioKey].assumptions); const ov = {}; for (const k in a) if (a[k] !== base[k]) ov[k] = a[k]; H.state.set({ overrides: ov }); return summarize(model.run(a)); } },
        { name: 'monte_carlo', description: 'Draait ' + fmt.int(MC_N) + ' Monte Carlo-simulaties rond het actieve scenario (in een Web Worker; duurt ongeveer een seconde) en geeft P10/P50/P90 van EBITDA in het doeljaar, de kans op convenantbreuk en de kans op een kasklem terug.', inputSchema: { type: 'object', properties: { doeljaar: { type: 'number', description: '2027 of 2028' } } },
          async execute(input, context) {
            const y = Number(input && input.doeljaar) === 2028 ? 2028 : 2027;
            log.dataset.busy = 'true'; status.textContent = mcStatus;
            try {
              const r = await monteCarloAsync(model, MC_N, MC_SEED, { targetYear: y }, context && context.signal);
              const st = E.stats(r.ebitda); const mc = E.stats(r.minCash);
              return { doeljaar: y, simulaties: r.n, ebitda: { p10: Math.round(st.p10), p50: Math.round(st.p50), p90: Math.round(st.p90) }, laagsteKas: { p10: Math.round(mc.p10), p50: Math.round(mc.p50) }, kansConvenantbreuk: +(r.breach / r.n).toFixed(3), kansKasklem: +(r.cashBreach / r.n).toFixed(3) };
            } finally { delete log.dataset.busy; if (status.textContent === mcStatus) status.textContent = ''; }
          } }
      ];

      // ---------- UI ----------
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
      const askBtn = ui.button('Vraag', () => send(input.value), { primary: true, icon: 'play', id: 'chat-ask' });
      const stopBtn = ui.button('Stop', () => { if (ctl) ctl.abort(); }, { icon: 'stop', id: 'chat-stop' }); stopBtn.hidden = true;
      const clearBtn = ui.button('Wis gesprek', () => { turns.length = 0; H.clear(log); welcome(); }, { ghost: true, sm: true, id: 'chat-clear' });
      // voorbeeldvragen: de .chip-klasse heeft white-space:nowrap en een <button> erft de UA-rand; beide hier overschreven zodat de knoppen
      // binnen de kaart wrappen (400 px) en als klikbaar ogen
      const chipStyle = { whiteSpace: 'normal', textAlign: 'left', maxWidth: '100%', border: '1px solid var(--line-2)', cursor: 'pointer' };
      const chips = h('div', { class: 'suggest' }, suggestions.map(q => h('button', { type: 'button', class: 'chip', style: chipStyle, onClick: () => send(q) }, q)));
      const hint = h('div', { class: 'small muted', id: 'chat-hint', hidden: true }, 'Enter = versturen · Shift+Enter = nieuwe regel');
      const chat = h('div', { class: 'chat' }, log, chips, h('div', { class: 'chat-input' }, input, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, askBtn, stopBtn)),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', flexWrap: 'wrap' } }, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 } }, hint, status), clearBtn));
      chatCard.appendChild(ui.card({ title: 'Gesprek met de analist', subtitle: 'antwoorden komen uit het model, niet uit het geheugen van Claude', body: chat, id: 'chat-card' }));

      function bubble(role, content) { const b = h('div', { class: 'msg ' + role }); if (content instanceof Node) b.appendChild(content); else b.textContent = content; log.appendChild(b); log.scrollTop = log.scrollHeight; return b; }
      function systemLine(text) { log.appendChild(h('div', { class: 'small muted', style: { alignSelf: 'center', textAlign: 'center', padding: '2px 8px' } }, text)); log.scrollTop = log.scrollHeight; }
      function welcome() {
        if (mode === 'claude') bubble('bot', renderMarkdown('Goedendag. Ik ken het volledige model van Helder E-Bikes: ' + fmt.int(E.aggregate(model.actualMonths(), 'Q').length) + ' kwartalen actuals (t/m ' + fmt.monthLong(model.lastActualPeriod) + '), de balans, de gebeurtenissen en het actieve scenario **' + scLabel(model) + '**.' + (toolsOk ? ' Wat-als-vragen reken ik zelf door met het engine.' : '') + ' Kies een voorbeeldvraag of stel uw eigen vraag.', h));
        else if (mode === 'offline') bubble('bot', renderMarkdown('In deze losse weergave is Claude niet verbonden. De **voorbeeldvragen** hieronder beantwoord ik rechtstreeks uit het model voor scenario **' + scLabel(model) + '**; eigen vragen kunt u stellen in de Claude-weergave van deze cockpit.', h));
        else bubble('bot pending', 'Verbinding met Claude controleren…');
      }
      function setBusy(b) { busy = b; askBtn.disabled = b; stopBtn.hidden = !b; input.disabled = b; for (const c of chips.children) { c.disabled = b; c.style.cursor = b ? 'default' : 'pointer'; } }

      async function send(q) {
        q = String(q || '').trim(); if (!q || busy) return;
        input.value = '';
        bubble('user', q);
        if (mode !== 'claude') {
          const hit = offlineAnswers(ctx).find(x => x.q === q);
          bubble('bot', hit ? renderMarkdown(hit.a, h) : renderMarkdown('Deze vraag kan ik buiten de Claude-weergave niet beantwoorden. Kies een van de voorbeeldvragen, of open de cockpit in Claude om vrij te vragen.', h));
          if (hit) log.lastChild.appendChild(h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Antwoord rechtstreeks uit het model, zonder Claude.'));
          return;
        }
        turns.push({ role: 'user', content: q });
        while (turns.length > 12) turns.shift();
        const b = bubble('bot pending', 'Denkt na…');
        setBusy(true); status.textContent = ''; ctl = new AbortController();
        const t0 = performance.now();
        try {
          const opts = { cache: false, signal: ctl.signal, modelTier: 'default', onText: ({ text }) => { b.classList.remove('pending'); H.clear(b); b.appendChild(renderMarkdown(text, h)); log.scrollTop = log.scrollHeight; } };
          if (toolsOk) opts.tools = tools;
          const res = await sample([{ role: 'user', content: instruction() }].concat(turns), opts);
          turns.push({ role: 'assistant', content: res.text });
          H.clear(b); b.classList.remove('pending'); b.appendChild(renderMarkdown(res.text, h));
          status.textContent = 'Beantwoord in ' + fmt.int(Math.round((performance.now() - t0) / 1000)) + ' s' + (res.truncated ? ' · antwoord afgekapt, vraag om minder tegelijk' : '') + (res.modelTierApplied && res.modelTierApplied !== 'default' ? ' · model: ' + res.modelTierApplied : '');
        } catch (e) {
          const code = e && e.code || 'upstream_error';
          if (e && e.text) { H.clear(b); b.classList.remove('pending'); b.appendChild(renderMarkdown(e.text, h)); turns.push({ role: 'assistant', content: e.text }); } else { b.remove(); turns.pop(); }
          if (code === 'cancelled') status.textContent = 'Gestopt.';
          else if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) { mode = 'offline'; applyModeCopy(); status.textContent = 'Claude is voor deze weergave niet toegestaan; de voorbeeldvragen werken wel.'; }
          else if (code === 'rate_limited') status.textContent = 'Even te veel vragen tegelijk. Probeer het zo opnieuw.';
          else if (code === 'refused') { status.textContent = 'Claude heeft deze vraag niet beantwoord. Formuleer de vraag anders.'; }
          else if (code === 'prompt_too_large') status.textContent = 'Het gesprek is te lang geworden; wis het gesprek en vraag opnieuw.';
          else if (code === 'tools_unavailable') { toolsOk = false; status.textContent = 'Doorrekenen is hier niet beschikbaar; stel de vraag opnieuw voor een antwoord zonder berekening.'; }
          else status.textContent = 'Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.';
        } finally { setBusy(false); ctl = null; }
      }

      // ---------- zijpaneel ----------
      const know = h('div', { class: 'list' });
      const knowSubText = () => 'samenvatting van ' + fmt.int(model.digest().length) + ' tekens gaat met elke vraag mee';
      const knowSub = h('span', null, knowSubText());
      know.appendChild(h('div', { class: 'list-item' }, H.icon('check', 14), h('div', null, h('div', { class: 'title' }, 'Jaar- en kwartaalcijfers'), h('div', { class: 'desc' }, 'W&V, balans, kasstroom en KPI\'s van 2023 t/m 2029, inclusief het actieve scenario.'))));
      know.appendChild(h('div', { class: 'list-item' }, H.icon('check', 14), h('div', null, h('div', { class: 'title' }, 'Omzet per lijn, kanaal en land'), h('div', { class: 'desc' }, 'Plus budget 2026 versus actual en de ' + fmt.int(model.events.length) + ' gebeurtenissen die de cijfers verklaren.'))));
      const toolsDesc = h('div', { class: 'desc', id: 'tools-desc' }, 'Wordt gecontroleerd…');
      know.appendChild(h('div', { class: 'list-item' }, H.icon('info', 14), h('div', null, h('div', { class: 'title' }, 'Doorrekenen'), toolsDesc)));
      side.appendChild(ui.card({ title: 'Wat de analist weet', subtitle: knowSub, body: know, footer: 'De analist krijgt alleen deze samenvatting en de tool-resultaten; hij kan niet op internet en onthoudt niets tussen sessies.' }));
      const digestBox = h('pre', { class: 'code wrap', id: 'digest', hidden: true, style: { maxHeight: '320px', overflow: 'auto', fontSize: '11px' } });
      const digestBtn = ui.button('Toon samenvatting', () => { digestBox.hidden = !digestBox.hidden; if (!digestBox.hidden) digestBox.textContent = model.digest(); digestBtn.lastChild.textContent = digestBox.hidden ? 'Toon samenvatting' : 'Verberg samenvatting'; digestBtn.setAttribute('aria-expanded', String(!digestBox.hidden)); }, { sm: true, icon: 'table', id: 'digest-toggle' });
      digestBtn.setAttribute('aria-expanded', 'false'); digestBtn.setAttribute('aria-controls', 'digest');
      const transSub = h('span', null, 'precies wat Claude te zien krijgt');
      side.appendChild(ui.card({ title: 'Transparantie', subtitle: transSub, body: [digestBtn, digestBox] }));
      const note = ui.note('Het bedrijf en alle cijfers zijn fictief.');
      side.appendChild(note);

      /** copy die van de weergave afhangt: in het Claude-artifact kan de kijker vrij vragen, daarbuiten alleen de voorbeeldvragen */
      function applyModeCopy() {
        if (mode === 'claude') {
          note.textContent = 'Antwoorden lopen via het Claude-account van de kijker; de eerste vraag vraagt eenmalig om toestemming. Het bedrijf en alle cijfers zijn fictief.';
          input.placeholder = 'Bijvoorbeeld: wat gebeurt er met de kas als de voorraaddagen (DIO) naar 110 gaan?';
          transSub.textContent = 'precies wat Claude te zien krijgt'; hint.hidden = false;
          toolsDesc.textContent = toolsOk ? 'Claude kan scenario\'s en een Monte Carlo-run zelf uitvoeren via het engine van deze pagina.' : 'Claude antwoordt op basis van de samenvatting; doorrekenen met tools is in deze weergave niet beschikbaar.';
        } else {
          note.textContent = 'In deze losse weergave beantwoordt de cockpit alleen de voorbeeldvragen, rechtstreeks uit het model. Het bedrijf en alle cijfers zijn fictief.';
          input.placeholder = 'Kies een voorbeeldvraag hierboven';
          transSub.textContent = 'wat Claude in de Claude-weergave te zien krijgt'; hint.hidden = true;
          toolsDesc.textContent = 'Buiten de Claude-weergave worden alleen de voorbeeldvragen beantwoord, rechtstreeks uit het model.';
        }
      }

      // ---------- capabilities ----------
      welcome();
      ctx.caps.onReady(async caps => {
        sample = caps.sample;
        if (!sample) { mode = 'offline'; }
        else {
          mode = 'claude';
          try { const lim = await sample.limits(); toolsOk = !!(lim && lim.tools); } catch (e) { toolsOk = false; }
        }
        applyModeCopy();
        H.clear(log); welcome();
      });

      // ---------- state-wijziging: korrel en periode doen hier niets; scenario en aannames wel ----------
      let stamp = scLabel(model) + '|' + model.assumptionsKey(); let prevLabel = scLabel(model);
      ctx.subscribe(() => {
        syncHead();
        const label = scLabel(model); const now = label + '|' + model.assumptionsKey();
        if (now === stamp) return;
        stamp = now;
        knowSub.textContent = knowSubText();
        if (!digestBox.hidden) digestBox.textContent = model.digest();
        if (log.querySelector('.msg.user')) systemLine(label !== prevLabel ? 'Scenario gewijzigd naar ' + label + '; eerdere antwoorden gelden voor ' + prevLabel + '.' : 'Aannames van ' + label + ' gewijzigd; eerdere antwoorden gelden voor de vorige aannames.');
        else { H.clear(log); welcome(); }
        prevLabel = label;
      });
    }
  });
})();
