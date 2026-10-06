/*
 * Fuzz- en invariantentests voor het financieel engine.
 *   node tests/engine.test.mjs
 * Faalt (exit 1) zodra één invariant ergens niet opgaat.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const E = require(join(ROOT, 'cockpit/app/engine.js'));
const dataset = JSON.parse(readFileSync(join(ROOT, 'cockpit/data/dataset.json'), 'utf8'));

let checks = 0, failures = 0;
function assert(cond, msg) { checks++; if (!cond) { failures++; if (failures <= 25) console.error('  ✗', msg); } }
const TOL = 1e-3; // euro's: ruim onder een cent-afwijking bij floating point

function invariants(res, label) {
  const cfg = res.config;
  let prevCash = cfg.opening.cash, prevEquity = res.equity0;
  for (const m of res.months) {
    const { bs, cf, pl, kpi } = m;
    assert(Math.abs(bs.check) < TOL, `${label} ${m.period}: balans sluit niet (${bs.check})`);
    assert(Math.abs(bs.totalAssets - bs.totalLiabEquity) < TOL, `${label} ${m.period}: activa ≠ passiva`);
    assert(Math.abs(cf.cashOpen - prevCash) < TOL, `${label} ${m.period}: kas-open ≠ vorige kas-eind`);
    assert(Math.abs(cf.cashOpen + cf.cfo + cf.cfi + cf.cff - cf.cashClose) < TOL, `${label} ${m.period}: kasstroomoverzicht telt niet op`);
    assert(Math.abs(cf.cashClose - bs.cash) < TOL, `${label} ${m.period}: kas uit kasstroom ≠ kas op balans`);
    assert(Math.abs(prevEquity + pl.netIncome + cf.dividend + cf.equityRaise - bs.equity) < TOL, `${label} ${m.period}: eigen vermogen rolt niet door`);
    assert(Math.abs(pl.revenue - pl.cogs - pl.grossProfit) < TOL, `${label} ${m.period}: brutowinst`);
    assert(Math.abs(pl.grossProfit - pl.opex - pl.ebitda) < TOL, `${label} ${m.period}: EBITDA`);
    assert(Math.abs(pl.ebitda - pl.dep - pl.ebit) < TOL, `${label} ${m.period}: EBIT`);
    assert(Math.abs(pl.ebit - pl.netInterest - pl.ebt) < TOL, `${label} ${m.period}: EBT`);
    assert(Math.abs(pl.ebt - pl.tax - pl.netIncome) < TOL, `${label} ${m.period}: nettowinst`);
    assert(pl.tax >= -TOL, `${label} ${m.period}: negatieve belasting`);
    assert(bs.rcf >= -TOL && bs.rcf <= cfg.rcfLimit + TOL, `${label} ${m.period}: RCF buiten limiet (${bs.rcf})`);
    assert(bs.termLoan >= -TOL, `${label} ${m.period}: negatieve termijnlening`);
    assert(bs.ppeNet >= -TOL && bs.inventory >= -TOL && bs.ar >= -TOL && bs.ap >= -TOL, `${label} ${m.period}: negatieve balanspost`);
    // kas onder minimum alleen als het krediet vol is
    if (bs.cash < cfg.minCash - TOL) assert(cfg.rcfLimit - bs.rcf < TOL, `${label} ${m.period}: kas onder minimum terwijl RCF nog ruimte heeft`);
    // kas boven minimum alleen als RCF 0 is (of exact op minimum)
    if (bs.rcf > TOL) assert(bs.cash <= cfg.minCash + TOL, `${label} ${m.period}: RCF uitstaand terwijl kas > minimum`);
    const lineRev = E.LINES.reduce((s, l) => s + m.byLine[l].revenue, 0);
    const chRev = E.CHANNELS.reduce((s, c) => s + m.byChannel[c].revenue, 0);
    const coRev = E.COUNTRIES.reduce((s, c) => s + m.byCountry[c].revenue, 0);
    assert(Math.abs(lineRev - pl.revenue) < TOL && Math.abs(chRev - pl.revenue) < TOL && Math.abs(coRev - pl.revenue) < TOL, `${label} ${m.period}: dimensies tellen niet op tot omzet`);
    assert(Math.abs(kpi.ccc - (kpi.dso + kpi.dio - kpi.dpo)) < 1e-9, `${label} ${m.period}: CCC`);
    prevCash = bs.cash; prevEquity = bs.equity;
  }
  // aggregaties: jaar = som van maanden; balans = laatste maand
  const years = E.aggregate(res.months, 'Y');
  for (const y of years) {
    const ms = res.months.filter(m => m.year === y.year);
    assert(Math.abs(y.pl.revenue - ms.reduce((s, m) => s + m.pl.revenue, 0)) < TOL, `${label} ${y.key}: jaaromzet ≠ som maanden`);
    assert(Math.abs(y.cf.cfo - ms.reduce((s, m) => s + m.cf.cfo, 0)) < TOL, `${label} ${y.key}: jaar-CFO ≠ som maanden`);
    assert(y.bs === ms[ms.length - 1].bs, `${label} ${y.key}: jaarbalans ≠ laatste maand`);
    assert(Math.abs(y.cf.cashClose - y.cf.cashOpen - y.cf.netCash) < TOL, `${label} ${y.key}: jaarkasstroom`);
  }
}

// 1. basisrun op de echte dataset
const t0 = Date.now();
const base = E.runScenario(dataset, dataset.scenarios.basis.assumptions);
invariants(base, 'basis');
for (const key of Object.keys(dataset.scenarios)) invariants(E.runScenario(dataset, dataset.scenarios[key].assumptions), key);
console.log(`scenario-runs: ${checks} checks, ${failures} fouten (${Date.now() - t0} ms)`);

// 2. fuzz: willekeurige aannames, inclusief extreme waarden
const r = E.rng(42);
const NFUZZ = Number(process.argv[2] || 3000);
const t1 = Date.now();
for (let i = 0; i < NFUZZ; i++) {
  const a = {
    volumeGrowth: r.normal(0.05, 0.25), priceIndex: r.normal(0.02, 0.05), materialIndex: r.normal(0.01, 0.08), fteGrowth: r.normal(0.05, 0.1), wageIndex: r.normal(0.03, 0.03),
    marketingPct: Math.max(0, r.normal(0.05, 0.03)), dso: Math.max(5, r.normal(48, 25)), dio: Math.max(5, r.normal(92, 50)), dpo: Math.max(5, r.normal(54, 25)),
    capexPerYear: Math.max(0, r.normal(5e6, 8e6)), dividendPct: Math.min(1, Math.max(0, r.normal(0.3, 0.4))), deExpansion: r() < 0.5, leaseBoost: r.normal(0.1, 0.2)
  };
  const res = E.runScenario(dataset, a, { detail: false });
  invariants(res, `fuzz#${i}`);
  if (failures > 25) break;
}
console.log(`fuzz: ${NFUZZ} willekeurige scenario's, ${checks} checks, ${failures} fouten (${Date.now() - t1} ms)`);

// 3. fuzz op maanddrivers zelf (volledig willekeurige bedrijfsvoering, incl. verliezen en kredietstress)
const t2 = Date.now();
for (let i = 0; i < 400; i++) {
  const cfg = E.defaultConfig(); cfg.months = 36; cfg.actualsUntil = '2024-12'; cfg.minCash = r() * 5e6; cfg.rcfLimit = cfg.opening.rcf + r() * 2e7;
  const drivers = [];
  for (let k = 0; k < 36; k++) {
    const d = JSON.parse(JSON.stringify(dataset.actualDrivers[k % dataset.actualDrivers.length]));
    for (let c = 0; c < E.NCELL; c++) d.units[c] *= Math.max(0, r.normal(1, 0.5));
    for (const l of E.LINES) { d.price[l] *= Math.max(0.2, r.normal(1, 0.3)); d.material[l] *= Math.max(0.2, r.normal(1, 0.3)); }
    d.dso = Math.max(0, r.normal(45, 30)); d.dio = Math.max(0, r.normal(90, 60)); d.dpo = Math.max(0, r.normal(50, 30));
    d.capex = Math.max(0, r.normal(5e5, 2e6)); d.dividend = r() < 0.1 ? r() * 5e6 : 0; d.equityRaise = r() < 0.05 ? r() * 1e7 : 0;
    d.termLoanDraw = r() < 0.05 ? r() * 2e7 : 0; d.termLoanRepay = r() * 6e5;
    d.oneOff = r() < 0.1 ? { cogs: r() * 2e6, opex: r() * 1e6, label: 'x' } : null;
    drivers.push(d);
  }
  const res = E.run(cfg, drivers, { detail: false });
  invariants(res, `driverfuzz#${i}`);
  if (failures > 25) break;
}
console.log(`driver-fuzz: 400 runs × 36 maanden, ${checks} checks, ${failures} fouten (${Date.now() - t2} ms)`);

// 4. Monte Carlo: determinisme en snelheid
const t3 = Date.now();
const mc1 = E.monteCarlo(dataset, dataset.scenarios.basis.assumptions, null, 10000, 123);
const mc2 = E.monteCarlo(dataset, dataset.scenarios.basis.assumptions, null, 10000, 123);
assert(mc1.ebitda.every((v, i) => v === mc2.ebitda[i]), 'Monte Carlo niet deterministisch bij gelijke seed');
const st = E.stats(mc1.ebitda);
assert(st.p10 <= st.p50 && st.p50 <= st.p90, 'kwantielen niet monotoon');
console.log(`monte carlo: 2×10000 runs in ${Date.now() - t3} ms; EBITDA ${mc1.targetYear} P10 ${(st.p10 / 1e6).toFixed(1)}M P50 ${(st.p50 / 1e6).toFixed(1)}M P90 ${(st.p90 / 1e6).toFixed(1)}M; covenantbreuk ${(mc1.breach / mc1.n * 100).toFixed(1)}%`);
const rec = E.monteCarlo(dataset, dataset.scenarios.recessie.assumptions, null, 2000, 7);
console.log(`monte carlo recessie: covenantbreuk ${(rec.breach / rec.n * 100).toFixed(1)}%, kasklem ${(rec.cashBreach / rec.n * 100).toFixed(1)}%`);

// 4b. hervatten: run in één keer == run in twee delen
{
  const cfg = dataset.config; const all = dataset.actualDrivers;
  const whole = E.run(cfg, all, { detail: false });
  const part1 = E.run(cfg, all.slice(0, 20), { detail: false });
  const part2 = E.run(cfg, all.slice(20), { detail: false, state: part1.state });
  for (let i = 0; i < all.length; i++) {
    const a = whole.months[i], b = i < 20 ? part1.months[i] : part2.months[i - 20];
    assert(a.period === b.period && Math.abs(a.bs.cash - b.bs.cash) < 1e-6 && Math.abs(a.pl.netIncome - b.pl.netIncome) < 1e-6 && Math.abs(a.kpi.leverage - b.kpi.leverage) < 1e-9, `hervatten wijkt af in ${a.period}`);
  }
  console.log('hervatten: identiek aan doorlopende run');
}

// 5. DCF: hogere WACC → lagere waarde; hogere groei → hogere waarde
const d1 = E.dcf(base, { wacc: 0.08, terminalGrowth: 0.02 }), d2 = E.dcf(base, { wacc: 0.10, terminalGrowth: 0.02 }), d3 = E.dcf(base, { wacc: 0.08, terminalGrowth: 0.03 });
assert(d1.ev > d2.ev, 'DCF: EV daalt niet bij hogere WACC');
assert(d3.ev > d1.ev, 'DCF: EV stijgt niet bij hogere eindgroei');
assert(Math.abs(d1.ev - d1.pvExplicit - d1.pvTv) < TOL, 'DCF: EV ≠ PV expliciet + PV eindwaarde');

console.log(`\nTOTAAL: ${checks} checks, ${failures} fouten`);
process.exit(failures ? 1 : 0);
