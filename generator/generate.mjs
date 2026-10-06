/*
 * Genereert de volledig fictieve dataset van Helder E-Bikes B.V.
 * Deterministisch (seed) — zelfde invoer, zelfde cijfers, in de browser én in Power BI.
 *
 *   node generator/generate.mjs            → schrijft cockpit/data/dataset.js(.json) en powerbi/data/*.csv
 *   node generator/generate.mjs --summary  → print alleen de jaarsamenvatting
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const E = require(join(ROOT, 'cockpit/app/engine.js'));
const { LINES, CHANNELS, COUNTRIES, DEPTS, cellIndex, addMonths, monthOf, yearOf } = E;

const SEED = 7_2016; // oprichtingsjaar als knipoog
const r = E.rng(SEED);

const config = E.defaultConfig();
config.start = '2023-01';
config.months = 84;            // 2023-01 .. 2029-12
config.actualsUntil = '2026-09';
const N_ACT = E.monthDiff(config.start, config.actualsUntil) + 1; // 45

// ---------- basisparameters per jaar (fictief, maar realistisch voor een e-bike merk) ----------
const seasonBase = [0.62, 0.74, 1.05, 1.32, 1.38, 1.28, 1.05, 0.98, 1.02, 0.92, 0.78, 0.86]; // jan..dec, gem. ≈ 1
const seasonLine = { City: seasonBase, Trek: seasonBase.map((v, i) => v * [0.9, 0.95, 1.05, 1.1, 1.1, 1.05, 1.0, 1.0, 1.0, 0.95, 0.95, 0.95][i]), Cargo: seasonBase.map((v, i) => v * [1.05, 1.05, 1.0, 0.95, 0.95, 0.95, 1.0, 1.0, 1.05, 1.05, 1.0, 0.95][i]) };
function normSeason(arr) { const m = arr.reduce((a, b) => a + b, 0) / 12; return arr.map(v => v / m); }
for (const l of LINES) seasonLine[l] = normSeason(seasonLine[l]);

// jaarvolumes (totaal eenheden) en mix; 2026 is run-rate (deels forecast)
const annualUnits = { 2023: 31500, 2024: 35200, 2025: 39100, 2026: 42800 };
const lineMix = { 2023: { City: 0.60, Trek: 0.29, Cargo: 0.11 }, 2024: { City: 0.57, Trek: 0.30, Cargo: 0.13 }, 2025: { City: 0.55, Trek: 0.30, Cargo: 0.15 }, 2026: { City: 0.53, Trek: 0.30, Cargo: 0.17 } };
const channelMix = { 2023: { Dealers: 0.68, Webshop: 0.24, Lease: 0.08 }, 2024: { Dealers: 0.65, Webshop: 0.24, Lease: 0.11 }, 2025: { Dealers: 0.62, Webshop: 0.23, Lease: 0.15 }, 2026: { Dealers: 0.59, Webshop: 0.22, Lease: 0.19 } };
const countryMixStart = { NL: 0.76, DE: 0.12, BE: 0.12 };
function countryMix(ym) { // DE-expansie vanaf sep 2025: aandeel DE loopt op van 12% naar ~24% eind 2026
  const t = E.monthDiff('2025-09', ym);
  const de = t < 0 ? countryMixStart.DE + 0.015 * Math.max(0, E.monthDiff('2023-01', ym)) / 32 : countryMixStart.DE + 0.015 * 1 + Math.min(0.11, 0.0085 * (t + 1));
  const be = 0.12; const nl = 1 - de - be; return { NL: nl, DE: de, BE: be };
}

const listPrice = { 2023: { City: 2290, Trek: 3150, Cargo: 4690 }, 2024: { City: 2350, Trek: 3230, Cargo: 4790 }, 2025: { City: 2450, Trek: 3350, Cargo: 4950 }, 2026: { City: 2525, Trek: 3450, Cargo: 5100 } };
const channelFactor = { Dealers: 0.70, Webshop: 1.0, Lease: 0.88 };
const countryFactor = { NL: 1.0, DE: 1.03, BE: 1.0 };
const materialBase = { 2023: { City: 1090, Trek: 1470, Cargo: 2250 }, 2024: { City: 1070, Trek: 1440, Cargo: 2200 }, 2025: { City: 1060, Trek: 1430, Cargo: 2180 }, 2026: { City: 1105, Trek: 1490, Cargo: 2265 } };
const laborPerUnit = { 2023: 142, 2024: 147, 2025: 151, 2026: 157 };
const freightPerUnit = { 2023: 68, 2024: 62, 2025: 60, 2026: 61 };
const warrantyPct = 0.015;
const fteBase = { 2023: { rd: 30, sales: 38, ops: 46, ga: 21 }, 2024: { rd: 33, sales: 42, ops: 49, ga: 22 }, 2025: { rd: 36, sales: 48, ops: 52, ga: 24 }, 2026: { rd: 38, sales: 58, ops: 55, ga: 25 } };
const costPerFte = { 2023: { rd: 6900, sales: 6150, ops: 4950, ga: 6550 }, 2024: { rd: 7150, sales: 6350, ops: 5100, ga: 6750 }, 2025: { rd: 7400, sales: 6600, ops: 5300, ga: 7000 }, 2026: { rd: 7680, sales: 6850, ops: 5500, ga: 7270 } };
const marketingBase = { 2023: 0.047, 2024: 0.050, 2025: 0.052, 2026: 0.055 };
const housing = { 2023: 165000, 2024: 172000, 2025: 180000, 2026: 186000 };
const it = { 2023: 78000, 2024: 86000, 2025: 95000, 2026: 104000 };
const other = { 2023: 120000, 2024: 130000, 2025: 140000, 2026: 150000 };

function lerpYear(table, ym) { // interpoleer per maand tussen jaarwaarden (jan = jaarwaarde, glijdend naar volgend jaar)
  const y = yearOf(ym), m = monthOf(ym); const a = table[y], b = table[y + 1] || table[y];
  const f = (m - 1) / 12;
  if (typeof a === 'number') return a + (b - a) * f;
  const out = {}; for (const k in a) out[k] = a[k] + (b[k] - a[k]) * f; return out;
}

function makeDriver(ym, opt = {}) {
  const y = yearOf(ym), m = monthOf(ym);
  const noise = opt.noise !== false;
  const d = {
    units: new Array(E.NCELL).fill(0),
    price: Object.assign({}, lerpYear(listPrice, ym)),
    channelFactor: Object.assign({}, channelFactor),
    countryFactor: Object.assign({}, countryFactor),
    material: Object.assign({}, lerpYear(materialBase, ym)),
    laborPerUnit: lerpYear(laborPerUnit, ym),
    freightPerUnit: lerpYear(freightPerUnit, ym),
    warrantyPct,
    fte: Object.assign({}, lerpYear(fteBase, ym)),
    costPerFte: Object.assign({}, lerpYear(costPerFte, ym)),
    marketingPct: lerpYear(marketingBase, ym),
    housing: lerpYear(housing, ym), it: lerpYear(it, ym), other: lerpYear(other, ym),
    dso: 46, dio: 100, dpo: 52,
    capex: 180000,
    termLoanDraw: 0, termLoanRepay: 0, dividend: 0, equityRaise: 0,
    oneOff: null
  };
  // volumes per cel
  const unitsYear = lerpYear(annualUnits, ym);
  const lm = lerpYear(lineMix, ym), cm = lerpYear(channelMix, ym), com = countryMix(ym);
  for (let li = 0; li < 3; li++) for (let ci = 0; ci < 3; ci++) for (let co = 0; co < 3; co++) {
    const L = LINES[li], C = CHANNELS[ci], K = COUNTRIES[co];
    let u = unitsYear / 12 * seasonLine[L][m - 1] * lm[L] * cm[C] * com[K];
    if (noise) u *= Math.max(0.7, r.normal(1, 0.045));
    d.units[cellIndex(li, ci, co)] = Math.round(u);
  }
  // werkkapitaal-ontwikkeling: voorraadoverhang 2023 normaliseert
  const t0 = E.monthDiff('2023-01', ym);
  d.dio = Math.max(92, 138 - 3.2 * t0) + (noise ? r.normal(0, 2.5) : 0);
  d.dso = 46 + (noise ? r.normal(0, 1.8) : 0);
  d.dpo = 52 + (noise ? r.normal(0, 1.5) : 0);
  return d;
}

// ---------- actuals met geplante gebeurtenissen ----------
const events = [];
function addEvent(period, title, kind, text) { events.push({ period, title, kind, text }); }

const actualDrivers = [];
for (let i = 0; i < N_ACT; i++) {
  const ym = addMonths(config.start, i);
  const y = yearOf(ym), m = monthOf(ym);
  const d = makeDriver(ym);
  // 2023 H1: webshop-korting om voorraadoverhang weg te werken
  if (y === 2023 && m <= 6) { d.channelFactor.Webshop = 0.90; d.channelFactor.Dealers = 0.67; }
  if (y === 2023 && m >= 7 && m <= 9) { d.channelFactor.Webshop = 0.95; }
  // Jan 2024: termijnlening €20M voor nieuwe assemblagelijn; capex jan–aug 2024
  if (ym === '2024-01') { d.termLoanDraw = 20_000_000; }
  if (y === 2024 && m >= 1 && m <= 8) d.capex += 14_000_000 / 8;
  // aflossing vanaf feb 2025: 60 maanden
  if (E.monthDiff('2025-02', ym) >= 0) d.termLoanRepay = 20_000_000 / 60;
  // dividend in mei
  if (ym === '2024-05') d.dividend = 1_500_000;
  if (ym === '2025-05') d.dividend = 2_000_000;
  if (ym === '2026-05') d.dividend = 2_400_000;
  // Feb 2025: terugroepactie remsysteem Cargo
  if (ym === '2025-02') { d.oneOff = { cogs: 1_100_000, opex: 0, label: 'Terugroepactie Cargo-remmen' }; for (let ci = 0; ci < 3; ci++) for (let co = 0; co < 3; co++) d.units[cellIndex(2, ci, co)] = Math.round(d.units[cellIndex(2, ci, co)] * 0.62); }
  if (ym === '2025-03') { d.oneOff = { cogs: 400_000, opex: 120_000, label: 'Nazorg terugroepactie' }; for (let ci = 0; ci < 3; ci++) for (let co = 0; co < 3; co++) d.units[cellIndex(2, ci, co)] = Math.round(d.units[cellIndex(2, ci, co)] * 0.80); }
  if (ym === '2025-04') { for (let ci = 0; ci < 3; ci++) for (let co = 0; co < 3; co++) d.units[cellIndex(2, ci, co)] = Math.round(d.units[cellIndex(2, ci, co)] * 0.90); }
  // Jul–Sep 2025: celprijsspike batterijen (+9%), Q4 +4%, 2026 +1,5% structureel (zit in basis)
  if (y === 2025 && m >= 7 && m <= 9) for (const l of LINES) d.material[l] *= 1.09;
  if (y === 2025 && m >= 10) for (const l of LINES) d.material[l] *= 1.04;
  // Okt 2025: prijsverhoging +3% om celprijzen door te berekenen
  if (E.monthDiff('2025-10', ym) >= 0 && y === 2025) for (const l of LINES) d.price[l] *= 1.03;
  // DE-expansie vanaf sep 2025: extra sales-FTE, campagne, langere betaaltermijnen
  if (E.monthDiff('2025-09', ym) >= 0) { const k = Math.min(1, (E.monthDiff('2025-09', ym) + 1) / 6); d.fte.sales += 8 * k; d.dso += 6 * k; d.other += 25000 * k; }
  if (y === 2025 && m >= 10) d.marketingPct += 0.006; // Q4-campagne Duitsland
  // Jun 2026: ERP-migratie (eenmalig advies)
  if (ym === '2026-06') d.oneOff = { cogs: 0, opex: 350_000, label: 'ERP-migratie (eenmalig)' };
  // Apr–Jun 2026: sterk voorjaar (fiscale leaseregeling)
  if (y === 2026 && m >= 4 && m <= 6) for (let li = 0; li < 3; li++) for (let co = 0; co < 3; co++) d.units[cellIndex(li, 2, co)] = Math.round(d.units[cellIndex(li, 2, co)] * 1.12);
  actualDrivers.push(d);
}
addEvent('2023-03', 'Webshop-korting wegens voorraadoverhang', 'margin', 'Na de post-corona hausse lag er te veel voorraad: in H1 2023 werd de webshopprijs met 10% verlaagd en de dealerconditie verruimd. De brutomarge daalde, de voorraaddagen gingen van 138 naar onder de 100.');
addEvent('2024-01', 'Termijnlening €20M voor nieuwe assemblagelijn', 'financing', 'Een vijfjarige termijnlening (4,45%) financierde de nieuwe assemblagelijn in Eindhoven (capex €14M, jan–aug 2024). Aflossing €333k per maand vanaf februari 2025 na een jaar aflossingsvrij.');
addEvent('2025-02', 'Terugroepactie Cargo-remsysteem', 'oneoff', 'Een remkabelprobleem bij de Cargo-lijn leidde tot een terugroepactie: €1,5M eenmalige kosten (feb–mrt 2025) en 20–38% lagere Cargo-verkopen in februari t/m april.');
addEvent('2025-07', 'Celprijsspike batterijen', 'margin', 'Lithium-celprijzen stegen in Q3 2025 met 9%; de brutomarge zakte tijdelijk ruim 3 punten. Vanaf oktober werd 3% prijsverhoging doorgevoerd en in Q4 normaliseerde de inkoopprijs deels (+4%).');
addEvent('2025-09', 'Start Duitse uitrol', 'growth', 'Acht extra sales-FTE, een Q4-campagne en langere dealertermijnen (DSO +6 dagen). Het Duitse volume-aandeel loopt op van 13% naar ruim 20%.');
addEvent('2026-04', 'Sterk voorjaar door leaseregeling', 'growth', 'De fiscale leaseregeling joeg het leasekanaal in Q2 2026 12% boven trend.');
addEvent('2026-06', 'ERP-migratie: eenmalig €350k', 'oneoff', 'Eenmalige advieskosten voor de ERP-migratie drukken het resultaat van juni 2026.');

// ---------- Budget 2026 (opgesteld nov 2025: zonder ruis, met toen geldende aannames) ----------
const budgetDrivers = [];
for (let m = 1; m <= 12; m++) {
  const ym = '2026-' + String(m).padStart(2, '0');
  const d = makeDriver(ym, { noise: false });
  // budgetaannames: +12% volume t.o.v. 2025 (actueel ≈ +9,5%), celprijs blijft +4% (actueel +1,5%), marketing 5,5%
  const scale = (annualUnits[2025] * 1.12) / lerpYear(annualUnits, ym);
  for (let i = 0; i < E.NCELL; i++) d.units[i] = Math.round(d.units[i] * scale);
  for (const l of LINES) d.material[l] = materialBase[2025][l] * 1.04;
  d.fte.sales += 8; d.dso = 50; d.dio = 95; d.dpo = 52; d.capex = 4_500_000 / 12; d.marketingPct = 0.055;
  d.termLoanRepay = 20_000_000 / 60; if (m === 5) d.dividend = 2_400_000;
  budgetDrivers.push(d);
}

// ---------- draaien ----------
const actRun = E.run(config, actualDrivers);
const base = E.runScenario({ config, actualDrivers }, E.defaultAssumptions());
const budgetRun = E.run(config, actualDrivers.slice(0, 36).concat(budgetDrivers));
const budget2026 = budgetRun.months.slice(36, 48);

function money(x) { return (x / 1e6).toFixed(1).padStart(7) + 'M'; }
function pct(x) { return (x * 100).toFixed(1).padStart(5) + '%'; }
const years = E.aggregate(base.months, 'Y');
console.log('\nJaar   Omzet    Units   ASP   BM%    EBITDA   EBITDA%  NI       Kas     NettoSch  Lev   ICR   DSO DIO DPO  Check');
for (const y of years) {
  console.log(`${y.key}${y.isActual ? ' A' : (y.partial ? ' P' : ' F')} ${money(y.pl.revenue)} ${Math.round(y.kpi.units).toString().padStart(6)} ${Math.round(y.kpi.asp).toString().padStart(5)} ${pct(y.kpi.grossMarginPct)} ${money(y.pl.ebitda)} ${pct(y.kpi.ebitdaPct)} ${money(y.pl.netIncome)} ${money(y.bs.cash)} ${money(y.kpi.netDebt)} ${y.kpi.leverage.toFixed(2).padStart(5)} ${y.kpi.icr.toFixed(1).padStart(5)}  ${Math.round(y.kpi.dso)} ${Math.round(y.kpi.dio)} ${Math.round(y.kpi.dpo)}  ${y.bs.check.toExponential(1)}`);
}
console.log('max balanscheck (abs):', actRun.maxCheck.toExponential(2), '| forecast:', base.maxCheck.toExponential(2));
const b = E.aggregate(budget2026, 'Y')[0];
console.log(`Budget 2026: omzet ${money(b.pl.revenue)} BM ${pct(b.kpi.grossMarginPct)} EBITDA ${money(b.pl.ebitda)} (${pct(b.kpi.ebitdaPct)})`);
const q = E.aggregate(actRun.months, 'Q');
console.log('\nKwartalen (actual): ', q.map(x => `${x.key}: ${(x.pl.revenue / 1e6).toFixed(1)}M/${pct(x.kpi.grossMarginPct).trim()}/${(x.pl.ebitda / 1e6).toFixed(1)}M`).join(' | '));
const dc = E.dcf(base, { wacc: 0.09, terminalGrowth: 0.02 });
console.log(`\nDCF (WACC 9%, g 2%): EV ${money(dc.ev)} netto schuld ${money(dc.netDebt)} equity ${money(dc.equityValue)} EV/EBITDA ${dc.evToEbitda.toFixed(1)}x TV-aandeel ${pct(dc.tvShare)}`);

if (process.argv.includes('--summary')) process.exit(0);

// ---------- dataset wegschrijven ----------
const dataset = {
  meta: { company: 'Helder E-Bikes B.V.', city: 'Eindhoven', founded: 2016, currency: 'EUR', generatedAt: '2026-10-06', seed: SEED, actualsUntil: config.actualsUntil, note: 'Volledig fictieve dataset. Elk bedrag, elke naam en elke gebeurtenis is verzonnen voor demonstratiedoeleinden.' },
  config,
  dims: { lines: LINES, channels: CHANNELS, countries: COUNTRIES, depts: DEPTS, deptLabels: E.DEPT_LABELS },
  actualDrivers,
  budgetDrivers,
  events,
  scenarios: {
    basis: { label: 'Basis', description: 'Managementcase: 8% volumegroei, 2% prijsindexatie, Duitse uitrol doorzetten.', assumptions: E.defaultAssumptions() },
    recessie: { label: 'Recessie', description: 'Vraaguitval en prijsdruk: 4% krimp, geen indexatie, langere betaaltermijnen, Duitse uitrol gepauzeerd.', assumptions: Object.assign(E.defaultAssumptions(), { volumeGrowth: -0.04, priceIndex: 0.0, materialIndex: 0.03, fteGrowth: 0.0, wageIndex: 0.03, dso: 56, dio: 110, dpo: 50, capexPerYear: 2500000, dividendPct: 0.0, deExpansion: false, leaseBoost: 0.02 }) },
    expansie: { label: 'Expansie DE', description: 'Agressieve Duitse uitrol: 16% groei, 8% FTE-groei, hogere marketing, meer capex en werkkapitaal.', assumptions: Object.assign(E.defaultAssumptions(), { volumeGrowth: 0.16, priceIndex: 0.025, materialIndex: 0.01, fteGrowth: 0.08, wageIndex: 0.035, marketingPct: 0.062, dso: 54, dio: 98, dpo: 54, capexPerYear: 6500000, dividendPct: 0.15, deExpansion: true, leaseBoost: 0.15 }) },
    margefocus: { label: 'Margefocus', description: 'Minder groei, meer marge: inkoopprogramma, werkkapitaal strak, hoger dividend.', assumptions: Object.assign(E.defaultAssumptions(), { volumeGrowth: 0.05, priceIndex: 0.03, materialIndex: -0.02, fteGrowth: 0.02, wageIndex: 0.03, marketingPct: 0.045, dso: 42, dio: 80, dpo: 58, capexPerYear: 3500000, dividendPct: 0.45, deExpansion: true, leaseBoost: 0.08 }) }
  },
  budget2026: budget2026.map(m => ({ period: m.period, pl: m.pl, byLine: m.byLine, byChannel: m.byChannel, byCountry: m.byCountry, kpi: { units: m.kpi.units, fte: m.kpi.fte, dso: m.kpi.dso, dio: m.kpi.dio, dpo: m.kpi.dpo } }))
};
const json = JSON.stringify(dataset);
mkdirSync(join(ROOT, 'cockpit/data'), { recursive: true });
writeFileSync(join(ROOT, 'cockpit/data/dataset.json'), json);
writeFileSync(join(ROOT, 'cockpit/data/dataset.js'), '/* Gegenereerd door generator/generate.mjs — niet handmatig bewerken. Volledig fictieve data. */\nwindow.HELDER_DATA = ' + json + ';\n');
console.log('\ndataset.js geschreven:', (json.length / 1024).toFixed(0), 'KB');

// ---------- Power BI CSV's (star schema, lang formaat) ----------
const out = join(ROOT, 'powerbi/data'); mkdirSync(out, { recursive: true });
function csv(rows, cols) { const esc = v => { if (v == null) return ''; const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }; return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n'; }
function dateKey(ym) { return ym.replace('-', '') + '01'; }
function firstDay(ym) { return ym + '-01'; }

const scenarioRows = [{ ScenarioKey: 1, Scenario: 'Actual', Volgorde: 1 }, { ScenarioKey: 2, Scenario: 'Budget', Volgorde: 2 }, { ScenarioKey: 3, Scenario: 'Forecast', Volgorde: 3 }];
const lineRows = LINES.map((l, i) => ({ ProductlijnKey: i + 1, Productlijn: l, Segment: l === 'Cargo' ? 'Gezin & zakelijk' : (l === 'Trek' ? 'Recreatie' : 'Woon-werk'), Adviesprijs2026: listPrice[2026][l] }));
const channelRows = CHANNELS.map((c, i) => ({ KanaalKey: i + 1, Kanaal: c, Type: c === 'Webshop' ? 'Direct' : 'Indirect', Prijsfactor: channelFactor[c] }));
const countryRows = COUNTRIES.map((c, i) => ({ LandKey: i + 1, Land: c, Landnaam: { NL: 'Nederland', DE: 'Duitsland', BE: 'België' }[c], Regio: c === 'NL' ? 'Thuismarkt' : 'Export', ISO3166: c }));
const deptRows = DEPTS.map((d, i) => ({ AfdelingKey: i + 1, AfdelingCode: d, Afdeling: E.DEPT_LABELS[d] }));
// rekeningschema W&V (lang formaat) met tekenconventie: Opbrengst +, Kosten −
const accounts = [
  ['4000', 'Netto-omzet', 'Omzet', 'Omzet', 1, 10], ['5000', 'Materiaalkosten', 'Kostprijs omzet', 'Brutomarge', -1, 20], ['5100', 'Directe arbeid', 'Kostprijs omzet', 'Brutomarge', -1, 21], ['5200', 'Inkomende vracht', 'Kostprijs omzet', 'Brutomarge', -1, 22], ['5300', 'Garantiekosten', 'Kostprijs omzet', 'Brutomarge', -1, 23], ['5900', 'Eenmalige kostprijsposten', 'Kostprijs omzet', 'Brutomarge', -1, 24],
  ['6000', 'Personeel R&D', 'Personeelskosten', 'Operationele kosten', -1, 30], ['6010', 'Personeel Sales & Marketing', 'Personeelskosten', 'Operationele kosten', -1, 31], ['6020', 'Personeel Operations', 'Personeelskosten', 'Operationele kosten', -1, 32], ['6030', 'Personeel G&A', 'Personeelskosten', 'Operationele kosten', -1, 33],
  ['6100', 'Marketing', 'Overige bedrijfskosten', 'Operationele kosten', -1, 40], ['6200', 'Huisvesting', 'Overige bedrijfskosten', 'Operationele kosten', -1, 41], ['6300', 'IT & software', 'Overige bedrijfskosten', 'Operationele kosten', -1, 42], ['6400', 'Overige kosten', 'Overige bedrijfskosten', 'Operationele kosten', -1, 43], ['6900', 'Eenmalige bedrijfskosten', 'Overige bedrijfskosten', 'Operationele kosten', -1, 44],
  ['7000', 'Afschrijvingen', 'Afschrijvingen', 'Afschrijvingen', -1, 50], ['8000', 'Rentelasten', 'Financiële baten en lasten', 'Financieel', -1, 60], ['8010', 'Rentebaten', 'Financiële baten en lasten', 'Financieel', 1, 61], ['9000', 'Vennootschapsbelasting', 'Belastingen', 'Belastingen', -1, 70]
].map(a => ({ RekeningKey: Number(a[0]), Rekening: a[1], Rekeninggroep: a[2], Niveau1: a[3], Teken: a[4], Volgorde: a[5] }));
function plLines(m) { const p = m.pl; return { 4000: p.revenue, 5000: p.materialCost, 5100: p.laborCost, 5200: p.freightCost, 5300: p.warranty, 5900: p.oneOffCogs, 6000: p.personnel.rd, 6010: p.personnel.sales, 6020: p.personnel.ops, 6030: p.personnel.ga, 6100: p.marketing, 6200: p.housing, 6300: p.it, 6400: p.other, 6900: p.oneOffOpex, 7000: p.dep, 8000: p.interestExp, 8010: p.interestInc, 9000: p.tax }; }

const factSales = [], factPL = [], factBS = [], factCF = [], factKPI = [], factFte = [];
function pushMonth(m, scenarioKey, cells) {
  const dk = dateKey(m.period);
  if (cells) for (let i = 0; i < E.NCELL; i++) { const c = E.cellOf(i); factSales.push({ DatumKey: dk, ScenarioKey: scenarioKey, ProductlijnKey: c.li + 1, KanaalKey: c.ci + 1, LandKey: c.co + 1, Aantal: cells[i].units, Omzet: cells[i].revenue, Kostprijs: cells[i].cogs }); }
  const pl = plLines(m); for (const k in pl) factPL.push({ DatumKey: dk, ScenarioKey: scenarioKey, RekeningKey: Number(k), Bedrag: pl[k] });
  if (scenarioKey !== 2) {
    const b = m.bs; const bsPosts = { 'Liquide middelen': b.cash, 'Debiteuren': b.ar, 'Voorraden': b.inventory, 'Materiële vaste activa': b.ppeNet, 'Crediteuren': -b.ap, 'Belastingschuld': -b.taxPayable, 'Termijnlening': -b.termLoan, 'Rekening-courantkrediet': -b.rcf, 'Eigen vermogen': -b.equity };
    for (const k in bsPosts) factBS.push({ DatumKey: dk, ScenarioKey: scenarioKey, Balanspost: k, Bedrag: bsPosts[k] });
    const c = m.cf; const cfPosts = { 'Nettowinst': c.netIncome, 'Afschrijvingen': c.dep, 'Mutatie debiteuren': c.dAR, 'Mutatie voorraden': c.dInv, 'Mutatie crediteuren': c.dAP, 'Mutatie belastingschuld': c.dTax, 'Investeringen': c.capex, 'Opname termijnlening': c.tlDraw, 'Aflossing termijnlening': c.tlRepay, 'Mutatie RCF': c.rcfDraw + c.rcfRepay, 'Dividend': c.dividend, 'Kapitaalstorting': c.equityRaise };
    for (const k in cfPosts) factCF.push({ DatumKey: dk, ScenarioKey: scenarioKey, Kasstroompost: k, Bedrag: cfPosts[k] });
    factKPI.push({ DatumKey: dk, ScenarioKey: scenarioKey, DSO: m.kpi.dso, DIO: m.kpi.dio, DPO: m.kpi.dpo, NettoSchuld: m.kpi.netDebt, LTMEBITDA: m.kpi.ltmEbitda, Leverage: m.kpi.leverage, ICR: Math.min(99, m.kpi.icr), RCFHeadroom: m.kpi.rcfHeadroom, Eenmalig: m.kpi.oneOffLabel });
  }
  for (const d of DEPTS) factFte.push({ DatumKey: dk, ScenarioKey: scenarioKey, AfdelingKey: DEPTS.indexOf(d) + 1, FTE: m.kpi.fteByDept ? m.kpi.fteByDept[d] : 0 });
}
for (let i = 0; i < base.months.length; i++) { const m = base.months[i]; pushMonth(m, i < N_ACT ? 1 : 3, m.cells); }
for (const m of budget2026) pushMonth(m, 2, m.cells);

// datumtabel 2023-01-01 .. 2029-12-31 (maandniveau volstaat voor de feiten; dagniveau voor Power BI-tijdintelligentie)
const dateRows = [];
const NL_MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];
for (let d = new Date(Date.UTC(2023, 0, 1)); d <= new Date(Date.UTC(2029, 11, 31)); d.setUTCDate(d.getUTCDate() + 1)) {
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
  dateRows.push({ DatumKey: Number(`${y}${String(mo).padStart(2, '0')}${String(da).padStart(2, '0')}`), Datum: `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`, Jaar: y, Kwartaal: 'Q' + Math.ceil(mo / 3), JaarKwartaal: `${y}-Q${Math.ceil(mo / 3)}`, Maandnummer: mo, Maand: NL_MONTHS[mo - 1], MaandKort: NL_MONTHS[mo - 1].slice(0, 3), JaarMaand: `${y}-${String(mo).padStart(2, '0')}`, JaarMaandSort: y * 100 + mo, IsActual: `${y}-${String(mo).padStart(2, '0')}` <= config.actualsUntil ? 1 : 0 });
}
writeFileSync(join(out, 'DimDatum.csv'), csv(dateRows, ['DatumKey', 'Datum', 'Jaar', 'Kwartaal', 'JaarKwartaal', 'Maandnummer', 'Maand', 'MaandKort', 'JaarMaand', 'JaarMaandSort', 'IsActual']));
writeFileSync(join(out, 'DimScenario.csv'), csv(scenarioRows, ['ScenarioKey', 'Scenario', 'Volgorde']));
writeFileSync(join(out, 'DimProductlijn.csv'), csv(lineRows, ['ProductlijnKey', 'Productlijn', 'Segment', 'Adviesprijs2026']));
writeFileSync(join(out, 'DimKanaal.csv'), csv(channelRows, ['KanaalKey', 'Kanaal', 'Type', 'Prijsfactor']));
writeFileSync(join(out, 'DimLand.csv'), csv(countryRows, ['LandKey', 'Land', 'Landnaam', 'Regio', 'ISO3166']));
writeFileSync(join(out, 'DimAfdeling.csv'), csv(deptRows, ['AfdelingKey', 'AfdelingCode', 'Afdeling']));
writeFileSync(join(out, 'DimRekening.csv'), csv(accounts, ['RekeningKey', 'Rekening', 'Rekeninggroep', 'Niveau1', 'Teken', 'Volgorde']));
writeFileSync(join(out, 'FactVerkoop.csv'), csv(factSales, ['DatumKey', 'ScenarioKey', 'ProductlijnKey', 'KanaalKey', 'LandKey', 'Aantal', 'Omzet', 'Kostprijs']));
writeFileSync(join(out, 'FactWinstVerlies.csv'), csv(factPL, ['DatumKey', 'ScenarioKey', 'RekeningKey', 'Bedrag']));
writeFileSync(join(out, 'FactBalans.csv'), csv(factBS, ['DatumKey', 'ScenarioKey', 'Balanspost', 'Bedrag']));
writeFileSync(join(out, 'FactKasstroom.csv'), csv(factCF, ['DatumKey', 'ScenarioKey', 'Kasstroompost', 'Bedrag']));
writeFileSync(join(out, 'FactKPI.csv'), csv(factKPI, ['DatumKey', 'ScenarioKey', 'DSO', 'DIO', 'DPO', 'NettoSchuld', 'LTMEBITDA', 'Leverage', 'ICR', 'RCFHeadroom', 'Eenmalig']));
writeFileSync(join(out, 'FactFTE.csv'), csv(factFte, ['DatumKey', 'ScenarioKey', 'AfdelingKey', 'FTE']));
writeFileSync(join(out, 'Gebeurtenissen.csv'), csv(events.map(e => ({ DatumKey: dateKey(e.period), Titel: e.title, Soort: e.kind, Toelichting: e.text })), ['DatumKey', 'Titel', 'Soort', 'Toelichting']));
console.log('Power BI CSV\'s geschreven:', { FactVerkoop: factSales.length, FactWinstVerlies: factPL.length, FactBalans: factBS.length, FactKasstroom: factCF.length, FactKPI: factKPI.length, FactFTE: factFte.length, DimDatum: dateRows.length });
