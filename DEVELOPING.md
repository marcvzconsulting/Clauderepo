# Helder CFO Cockpit — ontwikkelconventies

Dit document beschrijft hoe een tabblad van de cockpit gebouwd wordt. Lees eerst `cockpit/app/core.js`, `cockpit/app/charts.js`,
`cockpit/app/engine.js` en de referentie-tabs `cockpit/app/tabs/overzicht.js` en `cockpit/app/tabs/scenario.js`.

## Bestanden

```
cockpit/index.html          shell + alle CSS (design tokens, componentklassen) — NIET aanpassen vanuit een tab-taak
cockpit/app/engine.js       drie-statement model (pure JS, ook in Node)        — NIET aanpassen
cockpit/app/core.js         HC: fmt, h, state, model, ui, tabs, util            — NIET aanpassen
cockpit/app/charts.js       HCharts: line, bar, waterfall, histogram, tornado, sparkline, meter, heatTable — NIET aanpassen
cockpit/app/main.js         boot, filterbalk, capabilities, HC.download, HC.copyText
cockpit/app/tabs/<id>.js    één bestand per tabblad (dit is wat je bouwt)
cockpit/data/dataset.js     window.HELDER_DATA (gegenereerd; niet handmatig bewerken)
scripts/shot.mjs            screenshots + consolefouten: node scripts/shot.mjs <tab> --out <map>
tests/engine.test.mjs       invarianten/fuzz-tests van het engine
```

Als je iets in core/charts/index.html nodig hebt dat ontbreekt: bouw een lokale helper in je eigen tab-bestand en
vermeld het verzoek in je eindrapport onder `coreRequests`. Pas de gedeelde bestanden niet aan (andere agents werken er parallel mee).

## Tab-contract

```js
(function () {
  'use strict';
  const H = window.HC;
  H.tabs.register({
    id: 'wv', label: 'Winst & verlies', short: 'W&V', order: 20, icon: 'pl',
    render(root, ctx) {
      const { model, fmt, h, ui, charts, E, state, range } = ctx;
      // 1. statische delen (pagina-kop, besturingspaneel) één keer bouwen
      // 2. dynamische delen bouwen in een functie build(c) en die registreren:
      const body = h('div');  root.appendChild(body);
      const draw = c => { H.clear(body); build(body, c); };
      draw(ctx); ctx.subscribe(draw);   // draw wordt aangeroepen bij elke wijziging van HC.state (korrel, periode, scenario, overrides)
    }
  });
})();
```

- `ctx.state` = `{ grain:'M'|'Q'|'Y', preset, scenarioKey, overrides, split }`; `ctx.range` = `{from, to}` (YYYY-MM).
- Bestaande iconen: home, pl, balance, sliders, dice, value, chat, pbi, check, warn, info, up, down, flat, download, copy, sun, moon, play, stop, refresh, table, chart.

## Model-API (HC.model)

| Aanroep | Geeft |
|---|---|
| `model.run()` | volledige run voor de huidige aannames: `{ months[], periods[], maxCheck, state }` |
| `model.months()` / `model.actualMonths()` / `model.forecastMonths()` | maandobjecten |
| `model.series(grain)` | aggregatie per korrel **binnen het gekozen bereik** (gebruik dit voor periodetabellen en -grafieken) |
| `model.seriesAll(grain)` | aggregatie over de hele horizon |
| `model.ltm()`, `model.priorLtm()`, `model.year(2027)`, `model.ytd(2026)`, `model.ytdPrior(2026)` | pseudo-periodes (balans = laatste maand) |
| `model.sumMonths(ms, label)` | som van willekeurige maanden |
| `model.budgetMonths()` / `model.budgetVsActual()` | budget 2026 per maand (alleen W&V, byLine/byChannel/byCountry, kpi.units/fte) |
| `model.assumptions()` | huidige scenario-aannames |
| `model.monteCarlo(n, seed, unc, opts)` | gememoized Monte Carlo (zie engine.monteCarlo) |
| `model.dcf(params)` | `E.dcf(run, {wacc, terminalGrowth})` |
| `model.digest()` | compacte tekstsamenvatting (voor de analist) |
| `model.config` | `{ taxRate, minCash, rcfLimit, rcfRate, termLoanRate, covenantLeverageMax, covenantIcrMin, actualsUntil, ... }` |
| `model.events`, `model.scenarios`, `model.lastActualPeriod`, `model.actualCount` | |

Maandobject (`m`): `period, year, month, quarter, isActual, pl{revenue, cogs, materialCost, laborCost, freightCost, warranty, oneOffCogs, grossProfit, personnel{rd,sales,ops,ga}, personnelTotal, marketing, housing, it, other, oneOffOpex, opex, ebitda, dep, ebit, interestExp, interestInc, netInterest, ebt, tax, netIncome}`,
`bs{cash, ar, inventory, ppeGross, ppeAcc, ppeNet, totalAssets, ap, taxPayable, termLoan, rcf, totalLiab, equity, totalLiabEquity, check}`,
`cf{netIncome, dep, dAR, dInv, dAP, dTax, cfo, capex(negatief), cfi, tlDraw, tlRepay(neg), rcfDraw, rcfRepay(neg), dividend(neg), equityRaise, cff, netCash, cashOpen, cashClose, fcf, taxPaid}`,
`kpi{units, asp, grossMarginPct, ebitdaPct, dso, dio, dpo, ccc, fte, fteByDept, netDebt, ltmEbitda, ltmInterest, leverage, icr, covenantLeverageOk, covenantIcrOk, rcfHeadroom, lossCarryforward, oneOffLabel}`,
`byLine{City,Trek,Cargo:{units,revenue,cogs}}, byChannel{Dealers,Webshop,Lease:{units,revenue}}, byCountry{NL,DE,BE:{units,revenue}}, cells[27]`.
Geaggregeerde periode (uit `E.aggregate`) heeft dezelfde vorm plus `key, label, n, partial, months[]`; `kpi.fteAvg`.

Engine-helpers: `E.LINES, E.CHANNELS, E.COUNTRIES, E.DEPTS, E.DEPT_LABELS, E.aggregate(months,'M'|'Q'|'Y'), E.addMonths, E.monthDiff, E.stats(typedArray)→{mean,sd,p5,p10,p25,p50,p75,p90,p95,min,max,sorted}, E.histogram(sorted,bins), E.sensitivity(draws,'ebitda'), E.dcf(run,{wacc,terminalGrowth}), E.dcfGrid(run,waccs,growths), E.defaultUncertainty(), E.rng(seed)`.

## UI-API (HC.ui) en formattering (HC.fmt)

- `ui.card({span, title, subtitle, actions, body, footer, class})`, `ui.kpi({label, value, delta, hint, trend, hero})`, `ui.delta(cur, prev, {label, upIsGood, absolute})`, `ui.deltaPp(cur, prev, {label, upIsGood})`,
  `ui.chip(text, tone, icon)` (tone: good|warning|serious|critical|accent|actual|forecast), `ui.statusChip(ok, okText, badText)`, `ui.note(text, tone)`,
  `ui.button(label, onClick, {primary, sm, ghost, icon, id})`, `ui.segmented({id, label, value, options:[{value,label}], onChange})`, `ui.select({id, label, value, options, onChange, inline})`,
  `ui.slider({id, label, min, max, step, value, format, onInput, onChange, hint})`, `ui.toggle({id, label, value, onChange})`,
  `ui.table({columns:[{key|value(row), label, align:'num', format(v,row), signColor, class}], rows, caption, rowClass(row), footer, class})`,
  `ui.figure({title, subtitle, chart, legend, note})` — chart = resultaat van een HCharts-functie `{el, table(), legend}`; de figuur krijgt automatisch een Grafiek/Tabel-wissel (verplicht voor elke grafiek).
  `ui.tooltip.show(x, y, node)`, `ui.tooltip.content({title, rows:[{key:color,label,value}]})`, `ui.tooltip.hide()`.
- `fmt.eur(v)` → "€ 12,4M" / "€ 845k"; `fmt.eur(v,{full:true})` → "€ 1.234.567"; `fmt.eurM(v)`, `fmt.eurK(v)`, `fmt.pct(v, d)`, `fmt.pp(v)`, `fmt.x(v, d)`, `fmt.days(v)`, `fmt.int(v)`, `fmt.num(v, d)`,
  `fmt.signed(v, f)`, `fmt.signedPct(v, d)`, `fmt.month('2026-09')` → "sep 26", `fmt.monthLong`, `fmt.quarter('2026-Q3')` → "Q3 2026", `fmt.period(key, grain)`, `fmt.periodLong(key, grain)`, `fmt.date('2026-10-06')`.
- Kleuren: `H.util.seriesColor(i)`, `H.util.lineColor(name)`, `H.util.channelColor(name)`, `H.util.countryColor(name)` (vaste toewijzing: City/Dealers/NL = reeks 1, Trek/Webshop/DE = reeks 2, Cargo/Lease/BE = reeks 3). CSS-tokens: `var(--series-1..7)`, `var(--series-dim)`, `var(--seq-1..5)`, `var(--good|--warning|--serious|--critical)`, `var(--accent)`, `var(--ink|--ink-2|--muted|--line|--surface|--surface-2)`.
- Tabellen met financiële overzichten: `class: 'statement'` + rijklassen `lvl0|lvl1|lvl2|key|total|sub|forecast` (zie CSS). Eerste kolom is sticky.
- Download: `await H.download(filename, stringOrBlob)` (werkt in artifact via downloads-capability en als gewone download). Kopiëren: `await H.copyText(text)`.
- Capabilities (alleen in het Claude-artifact): `ctx.caps` = `{ isArtifact, ready, sample, downloads, onReady(fn) }`.

## Regels

1. **Nederlands** in alle UI-tekst (sentence case; "Netto-omzet", "Brutomarge", "Eigen vermogen", "Kasstroom uit operationele activiteiten"). Getallen via `fmt`, nooit `toFixed` of `toLocaleString` direct.
2. **Nooit `innerHTML` met data.** Bouw DOM met `h()`/`svg()`; tekst via tekstknopen.
3. **Elke grafiek via `ui.figure`** zodat er een tabelweergave is; legenda is er automatisch bij ≥ 2 reeksen; nooit twee y-assen; statuskleuren alleen voor goed/slecht; reeksen in vaste kleurvolgorde; dunne marks.
4. **Filters gelden overal**: korrel/periode/scenario uit `ctx.state` bepalen wat je toont (`model.series(state.grain)`); je mag per tab een extra besturingspaneel hebben (bijv. splitsing per dimensie of simulatie-instellingen), gebouwd met `ui.segmented`/`ui.slider`.
5. **Samenvatting vóór detail**: KPI-rij bovenaan, daarna grafieken, daarna tabellen. Forecast herkenbaar (chip `forecast`, gestippeld, gearceerde band).
6. **Mobiel**: alles in `.grid` met `span-*`; tabellen in `.table-wrap`; geen vaste breedtes > 100 %; test op 400 px (shot.mjs doet dat).
7. **Licht én donker**: alleen tokens gebruiken; geen letterlijke kleuren.
8. **Performance**: één `model.run()` per render; geen berekeningen in loops over DOM; Monte Carlo in een Web Worker (`cockpit/app/mc-worker.js`).
9. **Verifieer**: `node --check` op je bestand, daarna `node scripts/shot.mjs <id> --out <map>` → bekijk alle vier de PNG's (Read-tool) en los consolefouten, overflow en visuele problemen op vóór je klaar bent. Controleer minstens drie getoonde getallen tegen het engine (bijv. met `node -e` en `cockpit/data/dataset.json`).
10. **Fictief**: het bedrijf bestaat niet; waar relevant staat dat in een voetnoot, niet in elke kaart.
