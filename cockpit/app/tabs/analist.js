/* Tab: Analist — stel vragen aan Claude over het model (sample-capability in het Claude-artifact), met tools om scenario's door te rekenen.
   Buiten het artifact: modelgestuurde antwoorden op de voorbeeldvragen, zonder Claude. */
(function () {
  'use strict';
  const H = window.HC;

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

  // ---------- modelgestuurde antwoorden (zonder Claude) ----------
  function offlineAnswers(ctx) {
    const { model, fmt, E } = ctx;
    const run = model.run(); const months = run.months; const ltm = model.ltm(); const prior = model.priorLtm();
    const qs = E.aggregate(model.actualMonths(), 'Q');
    const q3 = qs.find(q => q.key === '2025-Q3'), q2 = qs.find(q => q.key === '2025-Q2'), q3p = qs.find(q => q.key === '2024-Q3');
    const y27 = model.year(2027); const fc = model.forecastMonths();
    const quarters27 = E.aggregate(fc.filter(m => m.year === 2027), 'Q');
    const minHeadroom = quarters27.reduce((a, q) => (model.config.covenantLeverageMax - q.kpi.leverage) < a.v ? { v: model.config.covenantLeverageMax - q.kpi.leverage, q } : a, { v: Infinity, q: null });
    const a = model.assumptions(); const altRun = model.run(Object.assign({}, a, { dso: a.dso - 10 })); const alt27 = E.aggregate(altRun.months, 'Y').find(y => y.year === 2027);
    const lines = E.LINES.map(l => ({ l, u: ltm.byLine[l].units, m: (ltm.byLine[l].revenue - ltm.byLine[l].cogs) / ltm.byLine[l].units, pct: (ltm.byLine[l].revenue - ltm.byLine[l].cogs) / ltm.byLine[l].revenue })).sort((p, q) => q.m - p.m);
    const ev25 = model.events.filter(e => e.period >= '2025-07' && e.period <= '2025-09');
    const zeroRun = model.run(Object.assign({}, a, { volumeGrowth: 0 })); const zeroYears = E.aggregate(zeroRun.months, 'Y'); const z27 = zeroYears.find(y => y.year === 2027), z29 = zeroYears.find(y => y.year === 2029), y29 = model.year(2029);
    const zeroFc = zeroRun.months.slice(model.actualCount); const zeroMin = zeroFc.reduce((p, m) => m.bs.cash < p.bs.cash ? m : p, zeroFc[0]); const zeroBreach = zeroFc.find(m => m.month % 3 === 0 && (!m.kpi.covenantLeverageOk || !m.kpi.covenantIcrOk));
    return [
      { q: 'Waarom daalde de brutomarge in Q3 2025?', a: `**Brutomarge Q3 2025: ${fmt.pct(q3.kpi.grossMarginPct)}** tegenover ${fmt.pct(q2.kpi.grossMarginPct)} in Q2 2025 en ${fmt.pct(q3p.kpi.grossMarginPct)} in Q3 2024.\n\n${ev25.map(e => '- **' + e.title + '** (' + fmt.monthLong(e.period) + '): ' + e.text).join('\n')}\n\nDe materiaalkosten per fiets lagen in Q3 2025 circa 9% hoger; omdat de prijsverhoging van 3% pas in oktober inging, kwam de klap volledig in het derde kwartaal terecht. In Q4 2025 herstelde de marge naar ${fmt.pct(qs.find(q => q.key === '2025-Q4').kpi.grossMarginPct)}.` },
      { q: 'Hoeveel ruimte zit er in 2027 onder de leverage-convenant?', a: `De convenant eist **netto schuld / EBITDA ≤ ${fmt.x(model.config.covenantLeverageMax)}**, getoetst per kwartaal op LTM-basis.\n\n${quarters27.map(q => '- ' + fmt.quarter(q.key) + ': ' + (q.kpi.netDebt < 0 ? 'netto kas ' + fmt.eurM(-q.kpi.netDebt) + ' (leverage niet van toepassing)' : fmt.x(q.kpi.leverage, 2) + ' bij netto schuld ' + fmt.eurM(q.kpi.netDebt) + ' en LTM-EBITDA ' + fmt.eurM(q.kpi.ltmEbitda))).join('\n')}\n\n${minHeadroom.q && minHeadroom.q.kpi.netDebt > 0 ? 'De krapste toets is ' + fmt.quarter(minHeadroom.q.key) + ' met ' + fmt.x(minHeadroom.v, 2) + ' ruimte: de LTM-EBITDA mag daar tot ' + fmt.eurM(minHeadroom.q.kpi.netDebt / model.config.covenantLeverageMax) + ' zakken voordat de grens wordt geraakt.' : 'In dit scenario heeft Helder in 2027 een netto kaspositie, zodat de leverage-convenant niet knelt. Het tabblad Risico toont hoe vaak dat in een Monte Carlo-simulatie anders uitpakt.'}` },
      { q: 'Wat is het effect van 10 dagen kortere DSO op de kas?', a: `Met DSO ${fmt.days(a.dso - 10)} in plaats van ${fmt.days(a.dso)} is dit het verschil in 2027 (scenario ${model.scenarios[H.state.get().scenarioKey].label.toLowerCase()}):\n\n- Kas eind 2027: **${fmt.eurM(alt27.bs.cash)}** tegenover ${fmt.eurM(y27.bs.cash)} (${fmt.signed(alt27.bs.cash - y27.bs.cash, fmt.eurM)})\n- Debiteuren eind 2027: ${fmt.eurM(alt27.bs.ar)} tegenover ${fmt.eurM(y27.bs.ar)}\n- Vrije kasstroom 2027: ${fmt.eurM(alt27.cf.fcf)} tegenover ${fmt.eurM(y27.cf.fcf)}\n- Netto rentelasten 2027: ${fmt.eurM(alt27.pl.netInterest)} tegenover ${fmt.eurM(y27.pl.netInterest)}\n\nTien dagen minder debiteuren maakt grofweg 10/30 × een maandomzet vrij; omdat het rekening-courantkrediet rente kost en kas rente oplevert, tikt het ook door in de winst. Verschuif de DSO-slider op het tabblad Scenario's om dit per maand te volgen.` },
      { q: 'Vat de financiële positie samen voor de raad van commissarissen.', a: `**Samenvatting per ${fmt.monthLong(model.lastActualPeriod)}**\n\n- Omzet LTM ${fmt.eurM(ltm.pl.revenue)} (${fmt.signedPct((ltm.pl.revenue - prior.pl.revenue) / prior.pl.revenue, 1)} op jaarbasis) met ${fmt.int(ltm.kpi.units)} verkochte e-bikes; Duitsland en lease groeien het hardst.\n- EBITDA LTM ${fmt.eurM(ltm.pl.ebitda)} (${fmt.pct(ltm.kpi.ebitdaPct)}), na een 2025 dat werd gedrukt door de terugroepactie en de celprijsspike; de brutomarge staat weer op ${fmt.pct(ltm.kpi.grossMarginPct)}.\n- Kas ${fmt.eurM(months[model.actualCount - 1].bs.cash)} en ${months[model.actualCount - 1].kpi.netDebt < 0 ? 'een netto kaspositie' : 'netto schuld ' + fmt.eurM(months[model.actualCount - 1].kpi.netDebt)}; beide convenanten ruim binnen de limiet; het rekening-courantkrediet is onbenut.\n- Forecast ${model.scenarios[H.state.get().scenarioKey].label.toLowerCase()}: omzet ${fmt.eurM(y27.pl.revenue)} en EBITDA ${fmt.eurM(y27.pl.ebitda)} in 2027; laagste kas in de forecast ${fmt.eurM(Math.min(...fc.map(m => m.bs.cash)))}.\n- Aandachtspunten: werkkapitaal door de Duitse dealertermijnen, celprijsvolatiliteit en de uitvoering van de ERP-migratie.` },
      { q: 'Wat gebeurt er met de kas als de volumegroei naar 0% gaat?', a: `Bij **0% volumegroei** (in plaats van ${fmt.signedPct(a.volumeGrowth, 1)} per jaar) in scenario ${model.scenarios[H.state.get().scenarioKey].label.toLowerCase()}:\n\n- EBITDA 2027: **${fmt.eurM(z27.pl.ebitda)}** tegenover ${fmt.eurM(y27.pl.ebitda)} (${fmt.signed(z27.pl.ebitda - y27.pl.ebitda, fmt.eurM)})\n- Kas eind 2027: ${fmt.eurM(z27.bs.cash)} tegenover ${fmt.eurM(y27.bs.cash)}; eind 2029: ${fmt.eurM(z29.bs.cash)} tegenover ${fmt.eurM(y29.bs.cash)}\n- Laagste kas in de forecast: ${fmt.eurM(zeroMin.bs.cash)} in ${fmt.monthLong(zeroMin.period)}${zeroMin.bs.rcf > 1 ? ' (RCF ' + fmt.eurM(zeroMin.bs.rcf) + ' getrokken)' : ''}\n- Convenanten: ${zeroBreach ? 'breuk in ' + fmt.monthLong(zeroBreach.period) : 'blijven binnen de limiet'}\n\nZonder groei blijven de vaste kosten (personeel, huisvesting, afschrijvingen) doorlopen terwijl de brutowinst niet meegroeit; wel komt er werkkapitaal vrij omdat debiteuren en voorraad niet meer hoeven mee te groeien. Verschuif de slider Volumegroei op het tabblad Scenario's om tussenstanden te zien.` },
      { q: 'Welke productlijn verdient het meest per fiets?', a: `Marge per fiets over de laatste twaalf maanden (omzet minus kostprijs, inclusief garantie):\n\n${lines.map((x, i) => (i + 1) + '. **' + x.l + '**: ' + fmt.eur(x.m, { full: true }) + ' per fiets (' + fmt.pct(x.pct) + ' brutomarge, ' + fmt.int(x.u) + ' stuks)').join('\n')}\n\nCargo levert absoluut het meest per fiets op, City het meest in totaal door het volume. De prijsmix per kanaal speelt mee: dealers kopen tegen 70% van de adviesprijs, de webshop levert de volle prijs maar vraagt marketing.` }
    ];
  }

  H.tabs.register({
    id: 'analist', label: 'Analist', short: 'Analist', order: 70, icon: 'chat',
    render(root, ctx) {
      const { model, fmt, h, ui, E } = ctx;
      root.appendChild(h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Analist'), h('p', null, 'Stel een vraag over de cijfers. De analist leest het volledige model (jaren, kwartalen, balans, gebeurtenissen en het actieve scenario) en kan wat-als-vragen zelf doorrekenen met het engine.'))));
      const grid = h('div', { class: 'grid' }); root.appendChild(grid);
      const chatCard = h('div', { class: 'span-8', style: { minWidth: 0 } }); grid.appendChild(chatCard);
      const side = h('div', { class: 'span-4', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 } }); grid.appendChild(side);

      const suggestions = ['Waarom daalde de brutomarge in Q3 2025?', 'Hoeveel ruimte zit er in 2027 onder de leverage-convenant?', 'Wat is het effect van 10 dagen kortere DSO op de kas?', 'Vat de financiële positie samen voor de raad van commissarissen.', 'Welke productlijn verdient het meest per fiets?', 'Wat gebeurt er met de kas als de volumegroei naar 0% gaat?'];
      let mode = 'wachten'; // wachten | claude | offline
      let sample = null, toolsOk = false;
      const turns = []; let busy = false, ctl = null;

      function instruction() {
        return 'Je bent de financieel analist van Helder E-Bikes B.V. (een fictief bedrijf; dit is een demonstratie). Je beantwoordt vragen van de CFO en het managementteam in het Nederlands: bondig, concreet en met cijfers uit de modelsamenvatting hieronder of uit tool-resultaten.\n' +
          'Regels: (1) gebruik uitsluitend cijfers uit de samenvatting of uit tools; verzin niets en zeg het als iets niet in het model zit; (2) bedragen in miljoenen met één decimaal (bijv. € 13,8M), percentages met één decimaal; (3) maak onderscheid tussen actual (t/m ' + fmt.monthLong(model.lastActualPeriod) + ') en forecast; (4) bij een wat-als-vraag gebruik je de tool bereken_scenario met de gewijzigde drivers en vergelijk je met het actieve scenario; pas de cockpit alleen aan met pas_scenario_toe als de gebruiker dat expliciet vraagt; (5) verwijs waar nuttig naar een tabblad (Overzicht, Winst & verlies, Balans & kasstroom, Scenario\'s, Risico, Waardering, Power BI); (6) maximaal ongeveer 200 woorden, in korte alinea\'s of opsommingen met **vet** voor de kernuitkomst; geen disclaimers, behalve hooguit één keer dat de data fictief is als dat ter zake doet. Vandaag is 6 oktober 2026.\n\n--- MODELSAMENVATTING ---\n' + model.digest();
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
        return {
          aannames: run.assumptions,
          jaren: years.map(y => ({ jaar: y.year + (y.isActual ? '' : y.months.some(m => m.isActual) ? ' (deels forecast)' : ' (forecast)'), omzet: Math.round(y.pl.revenue), eenheden: Math.round(y.kpi.units), brutomargePct: +(y.kpi.grossMarginPct * 100).toFixed(1), ebitda: Math.round(y.pl.ebitda), ebitdaPct: +(y.kpi.ebitdaPct * 100).toFixed(1), nettowinst: Math.round(y.pl.netIncome), cfo: Math.round(y.cf.cfo), capex: Math.round(-y.cf.capex), fcf: Math.round(y.cf.fcf), kasEind: Math.round(y.bs.cash), nettoSchuld: Math.round(y.kpi.netDebt), leverage: +y.kpi.leverage.toFixed(2), rentedekking: +Math.min(99, y.kpi.icr).toFixed(1), fte: Math.round(y.kpi.fte) })),
          laagsteKas: { bedrag: Math.round(Math.min(...fc.map(m => m.bs.cash))), maand: fc.reduce((a, m) => m.bs.cash < a.bs.cash ? m : a, fc[0]).period },
          eersteConvenantbreuk: breach ? breach.period : null
        };
      }
      const tools = [
        { name: 'bereken_scenario', description: 'Rekent de forecast (okt 2026 t/m 2029) opnieuw door met gewijzigde drivers en geeft jaarcijfers 2026–2029 terug (omzet, EBITDA, nettowinst, FCF, kas, netto schuld, leverage, rentedekking) plus laagste kas en eerste convenantbreuk. Niet-opgegeven drivers blijven zoals in het actieve scenario. Gebruik dit voor elke wat-als-vraag.', inputSchema: { type: 'object', properties: { volumeGrowth: { type: 'number', description: 'volumegroei per jaar als fractie, bijv. 0.08' }, priceIndex: { type: 'number', description: 'prijsindexatie per jaar, fractie' }, materialIndex: { type: 'number', description: 'stijging materiaalkosten per eenheid per jaar, fractie' }, fteGrowth: { type: 'number' }, wageIndex: { type: 'number' }, marketingPct: { type: 'number', description: 'marketing als fractie van omzet, bijv. 0.054' }, dso: { type: 'number', description: 'debiteurendagen' }, dio: { type: 'number', description: 'voorraaddagen' }, dpo: { type: 'number', description: 'crediteurendagen' }, capexPerYear: { type: 'number', description: 'investeringen per jaar in euro' }, dividendPct: { type: 'number', description: 'dividend als fractie van de winst van vorig jaar' }, deExpansion: { type: 'boolean' }, leaseBoost: { type: 'number' } } }, execute(input) { return summarize(model.run(assumptionTool(input || {}))); } },
        { name: 'pas_scenario_toe', description: 'Past de opgegeven drivers toe in de cockpit zelf, zodat alle tabbladen de nieuwe forecast tonen. Alleen gebruiken als de gebruiker daar expliciet om vraagt. Geeft de nieuwe jaarcijfers terug.', inputSchema: { type: 'object', properties: { volumeGrowth: { type: 'number' }, priceIndex: { type: 'number' }, materialIndex: { type: 'number' }, fteGrowth: { type: 'number' }, wageIndex: { type: 'number' }, marketingPct: { type: 'number' }, dso: { type: 'number' }, dio: { type: 'number' }, dpo: { type: 'number' }, capexPerYear: { type: 'number' }, dividendPct: { type: 'number' }, deExpansion: { type: 'boolean' }, leaseBoost: { type: 'number' } } }, execute(input) { const a = assumptionTool(input || {}); const s = H.state.get(); const base = Object.assign({}, E.defaultAssumptions(), model.scenarios[s.scenarioKey].assumptions); const ov = {}; for (const k in a) if (a[k] !== base[k]) ov[k] = a[k]; H.state.set({ overrides: ov }); return summarize(model.run(a)); } },
        { name: 'monte_carlo', description: 'Draait 2.000 Monte Carlo-simulaties rond het actieve scenario en geeft P10/P50/P90 van EBITDA in het doeljaar, de kans op convenantbreuk en de kans op een kasklem terug.', inputSchema: { type: 'object', properties: { doeljaar: { type: 'number', description: '2027 of 2028' } } }, execute(input) { const y = Number(input && input.doeljaar) === 2028 ? 2028 : 2027; const r = model.monteCarlo(2000, 20261006, null, { targetYear: y }); const st = E.stats(r.ebitda); const mc = E.stats(r.minCash); return { doeljaar: y, simulaties: r.n, ebitda: { p10: Math.round(st.p10), p50: Math.round(st.p50), p90: Math.round(st.p90) }, laagsteKas: { p10: Math.round(mc.p10), p50: Math.round(mc.p50) }, kansConvenantbreuk: +(r.breach / r.n).toFixed(3), kansKasklem: +(r.cashBreach / r.n).toFixed(3) }; } }
      ];

      // ---------- UI ----------
      const log = h('div', { class: 'chat-log', id: 'chat-log', 'aria-live': 'polite' });
      const status = h('div', { class: 'small muted', id: 'chat-status' });
      const input = h('textarea', { id: 'chat-input', placeholder: 'Bijvoorbeeld: wat gebeurt er met de kas als DIO naar 110 dagen gaat?', 'aria-label': 'Je vraag', rows: 2 });
      input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); } });
      const askBtn = ui.button('Vraag', () => send(input.value), { primary: true, icon: 'play', id: 'chat-ask' });
      const stopBtn = ui.button('Stop', () => { if (ctl) ctl.abort(); }, { icon: 'stop', id: 'chat-stop' }); stopBtn.hidden = true;
      const clearBtn = ui.button('Wis gesprek', () => { turns.length = 0; H.clear(log); welcome(); }, { ghost: true, sm: true, id: 'chat-clear' });
      const chips = h('div', { class: 'suggest' }, suggestions.map(q => h('button', { type: 'button', class: 'chip', onClick: () => send(q) }, q)));
      const chat = h('div', { class: 'chat' }, log, chips, h('div', { class: 'chat-input' }, input, h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, askBtn, stopBtn)), h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } }, status, clearBtn));
      chatCard.appendChild(ui.card({ title: 'Gesprek met de analist', subtitle: 'antwoorden komen uit het model, niet uit het geheugen van Claude', body: chat, id: 'chat-card' }));

      function bubble(role, content) { const b = h('div', { class: 'msg ' + role }); if (content instanceof Node) b.appendChild(content); else b.textContent = content; log.appendChild(b); log.scrollTop = log.scrollHeight; return b; }
      function welcome() {
        if (mode === 'claude') bubble('bot', renderMarkdown('Goedemiddag. Ik ken het volledige model van Helder E-Bikes: ' + E.aggregate(model.actualMonths(), 'Q').length + ' actuele kwartalen, de balans, de gebeurtenissen en het actieve scenario (**' + model.scenarios[H.state.get().scenarioKey].label + '**).' + (toolsOk ? ' Wat-als-vragen reken ik zelf door met het engine.' : '') + ' Kies een voorbeeldvraag of stel je eigen vraag.', h));
        else if (mode === 'offline') bubble('bot', renderMarkdown('In deze losse weergave is Claude niet verbonden. De **voorbeeldvragen** hieronder beantwoord ik rechtstreeks uit het model; eigen vragen kun je stellen in de Claude-weergave van deze cockpit.', h));
        else bubble('bot pending', 'Verbinding met Claude controleren…');
      }
      function setBusy(b) { busy = b; askBtn.disabled = b; stopBtn.hidden = !b; input.disabled = b; for (const c of chips.children) c.disabled = b; }

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
          status.textContent = 'Beantwoord in ' + Math.round((performance.now() - t0) / 1000) + ' s' + (res.truncated ? ' · antwoord afgekapt, vraag om minder tegelijk' : '') + (res.modelTierApplied && res.modelTierApplied !== 'default' ? ' · model: ' + res.modelTierApplied : '');
        } catch (e) {
          const code = e && e.code || 'upstream_error';
          if (e && e.text) { H.clear(b); b.classList.remove('pending'); b.appendChild(renderMarkdown(e.text, h)); turns.push({ role: 'assistant', content: e.text }); } else { b.remove(); turns.pop(); }
          if (code === 'cancelled') status.textContent = 'Gestopt.';
          else if (['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed'].includes(code)) { mode = 'offline'; status.textContent = 'Claude is voor deze weergave niet toegestaan; de voorbeeldvragen werken wel.'; }
          else if (code === 'rate_limited') status.textContent = 'Even te veel vragen tegelijk. Probeer het zo opnieuw.';
          else if (code === 'refused') { status.textContent = 'Claude heeft deze vraag niet beantwoord. Formuleer de vraag anders.'; }
          else if (code === 'prompt_too_large') status.textContent = 'Het gesprek is te lang geworden; wis het gesprek en vraag opnieuw.';
          else if (code === 'tools_unavailable') { toolsOk = false; status.textContent = 'Doorrekenen is hier niet beschikbaar; stel de vraag opnieuw voor een antwoord zonder berekening.'; }
          else status.textContent = 'Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.';
        } finally { setBusy(false); ctl = null; }
      }

      // ---------- zijpaneel ----------
      const know = h('div', { class: 'list' });
      const digestLen = model.digest().length;
      know.appendChild(h('div', { class: 'list-item' }, H.icon('check', 14), h('div', null, h('div', { class: 'title' }, 'Jaar- en kwartaalcijfers'), h('div', { class: 'desc' }, 'W&V, balans, kasstroom en KPI\'s van 2023 t/m 2029, inclusief het actieve scenario.'))));
      know.appendChild(h('div', { class: 'list-item' }, H.icon('check', 14), h('div', null, h('div', { class: 'title' }, 'Omzet per lijn, kanaal en land'), h('div', { class: 'desc' }, 'Plus budget 2026 versus actual en de ' + model.events.length + ' gebeurtenissen die de cijfers verklaren.'))));
      const toolsRow = h('div', { class: 'list-item' }, H.icon('info', 14), h('div', null, h('div', { class: 'title' }, 'Doorrekenen'), h('div', { class: 'desc', id: 'tools-desc' }, 'Wordt gecontroleerd…')));
      know.appendChild(toolsRow);
      side.appendChild(ui.card({ title: 'Wat de analist weet', subtitle: 'samenvatting van ' + fmt.int(digestLen) + ' tekens gaat met elke vraag mee', body: know, footer: 'De analist krijgt alleen deze samenvatting en de tool-resultaten; hij kan niet op internet en onthoudt niets tussen sessies.' }));
      const digestBox = h('pre', { class: 'code', id: 'digest', hidden: true, style: { maxHeight: '320px', overflow: 'auto', fontSize: '11px' } });
      const digestBtn = ui.button('Toon samenvatting', () => { digestBox.hidden = !digestBox.hidden; if (!digestBox.hidden) digestBox.textContent = model.digest(); digestBtn.lastChild.textContent = digestBox.hidden ? 'Toon samenvatting' : 'Verberg samenvatting'; }, { sm: true, icon: 'table', id: 'digest-toggle' });
      side.appendChild(ui.card({ title: 'Transparantie', subtitle: 'precies wat Claude te zien krijgt', body: [digestBtn, digestBox] }));
      side.appendChild(ui.note('Antwoorden lopen via het Claude-account van de kijker; de eerste vraag vraagt eenmalig om toestemming. Het bedrijf en alle cijfers zijn fictief.'));

      // ---------- capabilities ----------
      welcome();
      ctx.caps.onReady(async caps => {
        sample = caps.sample;
        if (!sample) { mode = 'offline'; }
        else {
          mode = 'claude';
          try { const lim = await sample.limits(); toolsOk = !!(lim && lim.tools); } catch (e) { toolsOk = false; }
        }
        const td = document.getElementById('tools-desc');
        if (td) td.textContent = mode === 'claude' ? (toolsOk ? 'Claude kan scenario\'s en een Monte Carlo-run zelf uitvoeren via het engine van deze pagina.' : 'Claude antwoordt op basis van de samenvatting; doorrekenen met tools is in deze weergave niet beschikbaar.') : 'Buiten de Claude-weergave worden alleen de voorbeeldvragen beantwoord, rechtstreeks uit het model.';
        H.clear(log); welcome();
      });
      ctx.subscribe(() => { /* scenario-wissel: samenvatting wordt per vraag vers opgebouwd; niets te herbouwen */ });
    }
  });
})();
