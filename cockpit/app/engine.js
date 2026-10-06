/*
 * Helder E-Bikes — financieel engine (drie-statement model)
 * Pure, dependency-vrije module. Werkt in de browser (window.HelderEngine) en in Node (module.exports).
 *
 * Conventies
 *  - Alle bedragen in euro's, alle periodes maandelijks ('YYYY-MM').
 *  - Rente wordt berekend over openingsbalansen (geen circulariteit).
 *  - De kaspositie volgt uit het kasstroomoverzicht; de balans sluit per constructie.
 *  - RCF (rekening-courantkrediet) wordt automatisch getrokken bij kas < minimumkas en afgelost bij overschot.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HelderEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LINES = ['City', 'Trek', 'Cargo'];
  const CHANNELS = ['Dealers', 'Webshop', 'Lease'];
  const COUNTRIES = ['NL', 'DE', 'BE'];
  const DEPTS = ['rd', 'sales', 'ops', 'ga'];
  const DEPT_LABELS = { rd: 'R&D', sales: 'Sales & Marketing', ops: 'Operations', ga: 'G&A' };
  const NCELL = LINES.length * CHANNELS.length * COUNTRIES.length;

  function cellIndex(li, ci, co) { return (li * CHANNELS.length + ci) * COUNTRIES.length + co; }
  function cellOf(idx) {
    const co = idx % COUNTRIES.length;
    const ci = Math.floor(idx / COUNTRIES.length) % CHANNELS.length;
    const li = Math.floor(idx / (COUNTRIES.length * CHANNELS.length));
    return { line: LINES[li], channel: CHANNELS[ci], country: COUNTRIES[co], li, ci, co };
  }

  // ---------- periodes ----------
  function addMonths(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    const yy = Math.floor(t / 12), mm = (t % 12) + 1;
    return yy + '-' + String(mm).padStart(2, '0');
  }
  function monthDiff(a, b) { // b - a in maanden
    const [ya, ma] = a.split('-').map(Number); const [yb, mb] = b.split('-').map(Number);
    return (yb * 12 + mb) - (ya * 12 + ma);
  }
  function periods(start, n) { const out = []; for (let i = 0; i < n; i++) out.push(addMonths(start, i)); return out; }
  function yearOf(ym) { return Number(ym.slice(0, 4)); }
  function monthOf(ym) { return Number(ym.slice(5, 7)); }
  function quarterOf(ym) { return yearOf(ym) + '-Q' + (Math.floor((monthOf(ym) - 1) / 3) + 1); }

  // ---------- deterministische PRNG (mulberry32) ----------
  function rng(seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.normal = function (mu, sigma) { // Box-Muller
      let u = 0, v = 0; while (u === 0) u = next(); while (v === 0) v = next();
      return mu + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.triangular = function (lo, mode, hi) {
      const u = next(); const f = (mode - lo) / (hi - lo);
      return u < f ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    };
    return next;
  }

  // ---------- hulpfuncties ----------
  function sum(arr) { let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i]; return s; }
  function avgLast(arr, n) { // gemiddelde van laatste n (of minder als nog niet beschikbaar)
    const k = Math.min(n, arr.length); if (k === 0) return 0;
    let s = 0; for (let i = arr.length - k; i < arr.length; i++) s += arr[i]; return s / k;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /**
   * Een maand-driver beschrijft alles wat het bedrijf die maand "doet".
   * {
   *   units: number[27]           verkochte eenheden per cel (lijn×kanaal×land)
   *   price: {City,Trek,Cargo}    adviesprijs excl. btw per lijn
   *   channelFactor: {Dealers,Webshop,Lease}   prijsfactor per kanaal
   *   countryFactor: {NL,DE,BE}
   *   material: {City,Trek,Cargo} materiaalkosten per eenheid
   *   laborPerUnit, freightPerUnit, warrantyPct
   *   fte: {rd,sales,ops,ga}, costPerFte: {rd,sales,ops,ga} (per maand)
   *   marketingPct, housing, it, other
   *   dso, dio, dpo
   *   capex, termLoanDraw, termLoanRepay, dividend, equityRaise
   *   oneOff: {cogs, opex, label}
   * }
   */

  function defaultConfig() {
    return {
      start: '2023-01',
      months: 84,
      actualsUntil: '2026-09',
      taxRate: 0.258,
      minCash: 2500000,
      rcfLimit: 15000000,
      rcfRate: 0.0625,
      termLoanRate: 0.0445,
      cashRate: 0.02,
      depYears: 7,
      covenantLeverageMax: 3.0,
      covenantIcrMin: 4.0,
      opening: {
        cash: 6000000, ar: 9400000, inventory: 17200000,
        ppeGross: 26000000, ppeAccDep: 14000000,
        ap: 7300000, taxPayable: 350000, termLoan: 0, rcf: 4000000,
        equity: 0 // wordt sluitend gemaakt in run()
      },
      priorRevenue: [6600000, 5900000],
      priorCogs: [4500000, 4050000],
      priorPayables: [5600000, 5100000],
      lossCarryforward: 0
    };
  }

  function cellRevenueUnit(d, li, ci, co) {
    return d.price[LINES[li]] * d.channelFactor[CHANNELS[ci]] * (d.countryFactor ? d.countryFactor[COUNTRIES[co]] : 1);
  }

  /**
   * run(config, drivers[]) → { periods, months: [...], annual: {...}, check }
   * Elke maand bevat W&V, balans, kasstroom, KPI's en celdetail.
   */
  function openingState(config) {
    const o = config.opening;
    const ppeNet0 = o.ppeGross - o.ppeAccDep;
    const assets0 = o.cash + o.ar + o.inventory + ppeNet0;
    const liab0 = o.ap + o.taxPayable + o.termLoan + o.rcf;
    return {
      cash: o.cash, ar: o.ar, inv: o.inventory, ppeGross: o.ppeGross, ppeAcc: o.ppeAccDep,
      ap: o.ap, taxPay: o.taxPayable, tl: o.termLoan, rcf: o.rcf, equity: assets0 - liab0, equity0: assets0 - liab0,
      lcf: config.lossCarryforward || 0,
      revHist: config.priorRevenue.slice(), cogsHist: config.priorCogs.slice(), payHist: config.priorPayables.slice(),
      ebitdaHist: [], interestHist: [], index: 0
    };
  }
  function snapshotState(st) {
    return { cash: st.cash, ar: st.ar, inv: st.inv, ppeGross: st.ppeGross, ppeAcc: st.ppeAcc, ap: st.ap, taxPay: st.taxPay, tl: st.tl, rcf: st.rcf, equity: st.equity, equity0: st.equity0, lcf: st.lcf,
      revHist: st.revHist.slice(-3), cogsHist: st.cogsHist.slice(-3), payHist: st.payHist.slice(-3), ebitdaHist: st.ebitdaHist.slice(-12), interestHist: st.interestHist.slice(-12), index: st.index };
  }

  /**
   * run(config, drivers, opts)
   *   opts.detail  (default true)  — celdetail per maand meenemen
   *   opts.state   (optioneel)     — hervatten vanaf een eerder teruggegeven `state` (drivers zijn dan de vervolgmaanden)
   */
  function run(config, drivers, opts) {
    opts = opts || {};
    const detail = opts.detail !== false;
    const n = drivers.length;
    const st = opts.state ? snapshotState(opts.state) : openingState(config);
    const startIndex = st.index;
    const per = [];
    for (let i = 0; i < n; i++) per.push(addMonths(config.start, startIndex + i));
    const equity0 = st.equity0;

    let cash = st.cash, ar = st.ar, inv = st.inv, ppeGross = st.ppeGross, ppeAcc = st.ppeAcc;
    let ap = st.ap, taxPay = st.taxPay, tl = st.tl, rcf = st.rcf, equity = st.equity;
    let lcf = st.lcf;
    const revHist = st.revHist, cogsHist = st.cogsHist, payHist = st.payHist;
    const ebitdaHist = st.ebitdaHist, interestHist = st.interestHist;
    const months = new Array(n);
    const depMonths = config.depYears * 12;
    let maxCheck = 0;

    for (let i = 0; i < n; i++) {
      const d = drivers[i];
      const ym = per[i];
      // --- omzet & COGS per cel ---
      let revenue = 0, unitsTotal = 0, materialCost = 0, laborCost = 0, freightCost = 0;
      const cells = detail ? new Array(NCELL) : null;
      const lean = !!opts.collect; // alleen kerncijfers verzamelen (Monte Carlo)
      const byLine = lean ? null : { City: { units: 0, revenue: 0, cogs: 0 }, Trek: { units: 0, revenue: 0, cogs: 0 }, Cargo: { units: 0, revenue: 0, cogs: 0 } };
      const byChannel = lean ? null : { Dealers: { units: 0, revenue: 0 }, Webshop: { units: 0, revenue: 0 }, Lease: { units: 0, revenue: 0 } };
      const byCountry = lean ? null : { NL: { units: 0, revenue: 0 }, DE: { units: 0, revenue: 0 }, BE: { units: 0, revenue: 0 } };
      for (let li = 0; li < LINES.length; li++) {
        const line = LINES[li];
        const mat = d.material[line];
        for (let ci = 0; ci < CHANNELS.length; ci++) {
          for (let co = 0; co < COUNTRIES.length; co++) {
            const idx = cellIndex(li, ci, co);
            const u = d.units[idx] || 0;
            const p = cellRevenueUnit(d, li, ci, co);
            const r = u * p;
            const m = u * mat, l = u * d.laborPerUnit, f = u * d.freightPerUnit;
            revenue += r; unitsTotal += u; materialCost += m; laborCost += l; freightCost += f;
            if (!lean) {
              byLine[line].units += u; byLine[line].revenue += r; byLine[line].cogs += m + l + f;
              byChannel[CHANNELS[ci]].units += u; byChannel[CHANNELS[ci]].revenue += r;
              byCountry[COUNTRIES[co]].units += u; byCountry[COUNTRIES[co]].revenue += r;
              if (detail) cells[idx] = { units: u, revenue: r, cogs: m + l + f, price: p };
            }
          }
        }
      }
      const warranty = revenue * d.warrantyPct;
      if (!lean) for (const line of LINES) byLine[line].cogs += byLine[line].revenue * d.warrantyPct;
      const oneOffCogs = (d.oneOff && d.oneOff.cogs) || 0;
      const cogs = materialCost + laborCost + freightCost + warranty + oneOffCogs;
      const grossProfit = revenue - cogs;
      // --- opex ---
      const personnel = {};
      let personnelTotal = 0, fteTotal = 0;
      for (const k of DEPTS) { const c = d.fte[k] * d.costPerFte[k]; personnel[k] = c; personnelTotal += c; fteTotal += d.fte[k]; }
      const marketing = revenue * d.marketingPct;
      const oneOffOpex = (d.oneOff && d.oneOff.opex) || 0;
      const opex = personnelTotal + marketing + d.housing + d.it + d.other + oneOffOpex;
      const ebitda = grossProfit - opex;
      // --- afschrijving ---
      const nbvOpen = ppeGross - ppeAcc;
      const dep = Math.min(nbvOpen, ppeGross / depMonths);
      const ebit = ebitda - dep;
      // --- rente (op openingsbalansen) ---
      const interestExp = tl * config.termLoanRate / 12 + rcf * config.rcfRate / 12;
      const interestInc = Math.max(0, cash) * config.cashRate / 12;
      const netInterest = interestExp - interestInc;
      const ebt = ebit - netInterest;
      // --- belasting met verliescompensatie ---
      let taxable = ebt, tax = 0;
      if (taxable > 0) {
        const use = Math.min(lcf, taxable); lcf -= use; taxable -= use; tax = taxable * config.taxRate;
      } else { lcf += -taxable; }
      const netIncome = ebt - tax;
      // --- werkkapitaal ---
      revHist.push(revenue); cogsHist.push(cogs); payHist.push(cogs + marketing + d.housing + d.it + d.other + oneOffOpex);
      if (revHist.length > 3) { revHist.shift(); cogsHist.shift(); payHist.shift(); }
      const arNew = d.dso / 30 * avgLast(revHist, 3);
      const invNew = d.dio / 30 * avgLast(cogsHist, 3);
      const apNew = d.dpo / 30 * avgLast(payHist, 3);
      const dAR = arNew - ar, dInv = invNew - inv, dAP = apNew - ap;
      // belasting: maandelijks opbouwen, per kwartaal betalen
      let taxPaid = 0;
      const taxPayNew0 = taxPay + tax;
      if (monthOf(ym) % 3 === 0) { taxPaid = Math.max(0, taxPayNew0); }
      const taxPayNew = taxPayNew0 - taxPaid;
      const dTax = taxPayNew - taxPay;
      // --- kasstroom ---
      const cfo = netIncome + dep - dAR - dInv + dAP + dTax;
      const capex = d.capex || 0;
      const cfi = -capex;
      const tlDraw = d.termLoanDraw || 0;
      const tlRepay = Math.min(tl + tlDraw, d.termLoanRepay || 0);
      const dividend = d.dividend || 0;
      const equityRaise = d.equityRaise || 0;
      const cashPre = cash + cfo + cfi + tlDraw - tlRepay - dividend + equityRaise;
      let rcfDraw = 0, rcfRepay = 0;
      if (cashPre < config.minCash) rcfDraw = Math.min(config.minCash - cashPre, Math.max(0, config.rcfLimit - rcf));
      else rcfRepay = Math.min(rcf, cashPre - config.minCash);
      const cff = tlDraw - tlRepay + rcfDraw - rcfRepay - dividend + equityRaise;
      const cashNew = cash + cfo + cfi + cff;
      // --- balans bijwerken ---
      cash = cashNew; ar = arNew; inv = invNew; ppeGross += capex; ppeAcc += dep; ap = apNew; taxPay = taxPayNew;
      tl = tl + tlDraw - tlRepay; rcf = rcf + rcfDraw - rcfRepay; equity = equity + netIncome - dividend + equityRaise;
      const ppeNet = ppeGross - ppeAcc;
      const totalAssets = cash + ar + inv + ppeNet;
      const totalLiab = ap + taxPay + tl + rcf;
      const check = totalAssets - totalLiab - equity;
      if (Math.abs(check) > maxCheck) maxCheck = Math.abs(check);
      // --- KPI's ---
      ebitdaHist.push(ebitda); interestHist.push(interestExp);
      if (ebitdaHist.length > 12) { ebitdaHist.shift(); interestHist.shift(); }
      const ltmEbitda = sum(ebitdaHist) * (12 / ebitdaHist.length);
      const ltmInterest = sum(interestHist) * (12 / interestHist.length);
      const netDebt = tl + rcf - cash;
      const leverage = ltmEbitda > 0 ? netDebt / ltmEbitda : (netDebt > 0 ? 99 : 0);
      const icr = ltmInterest > 0 ? ltmEbitda / ltmInterest : 99;
      const fcf = cfo + cfi;
      if (lean) {
        opts.collect({ i, period: ym, year: yearOf(ym), month: monthOf(ym), revenue, ebitda, netIncome, fcf, cash, leverage, icr, ltmEbitda, rcf, rcfHeadroom: config.rcfLimit - rcf, leverageOk: leverage <= config.covenantLeverageMax, icrOk: icr >= config.covenantIcrMin, covenantOk: leverage <= config.covenantLeverageMax && icr >= config.covenantIcrMin, minCash: config.minCash });
        continue;
      }
      months[i] = {
        period: ym, year: yearOf(ym), month: monthOf(ym), quarter: quarterOf(ym),
        isActual: monthDiff(ym, config.actualsUntil) >= 0,
        pl: { revenue, cogs, materialCost, laborCost, freightCost, warranty, oneOffCogs, grossProfit, personnel, personnelTotal, marketing, housing: d.housing, it: d.it, other: d.other, oneOffOpex, opex, ebitda, dep, ebit, interestExp, interestInc, netInterest, ebt, tax, netIncome },
        bs: { cash, ar, inventory: inv, ppeGross, ppeAcc, ppeNet, totalAssets, ap, taxPayable: taxPay, termLoan: tl, rcf, totalLiab, equity, totalLiabEquity: totalLiab + equity, check },
        cf: { netIncome, dep, dAR: -dAR, dInv: -dInv, dAP, dTax, cfo, capex: -capex, cfi, tlDraw, tlRepay: -tlRepay, rcfDraw, rcfRepay: -rcfRepay, dividend: -dividend, equityRaise, cff, netCash: cfo + cfi + cff, cashOpen: cashNew - (cfo + cfi + cff), cashClose: cashNew, fcf, taxPaid },
        kpi: { units: unitsTotal, asp: unitsTotal > 0 ? revenue / unitsTotal : 0, grossMarginPct: revenue > 0 ? grossProfit / revenue : 0, ebitdaPct: revenue > 0 ? ebitda / revenue : 0, dso: d.dso, dio: d.dio, dpo: d.dpo, ccc: d.dso + d.dio - d.dpo, fte: fteTotal, fteByDept: Object.assign({}, d.fte), netDebt, ltmEbitda, ltmInterest, ltmMonths: ebitdaHist.length, covenantTestable: ebitdaHist.length >= 12, leverage, icr, covenantLeverageOk: leverage <= config.covenantLeverageMax, covenantIcrOk: icr >= config.covenantIcrMin, rcfHeadroom: config.rcfLimit - rcf, lossCarryforward: lcf, oneOffLabel: d.oneOff && d.oneOff.label || '' },
        byLine, byChannel, byCountry,
        cells
      };
    }
    const state = { cash, ar, inv, ppeGross, ppeAcc, ap, taxPay, tl, rcf, equity, equity0, lcf, revHist, cogsHist, payHist, ebitdaHist, interestHist, index: startIndex + n };
    return { periods: per, months, equity0, maxCheck, config, state, startIndex };
  }

  // ---------- aggregatie ----------
  const SUM_PL = ['revenue', 'cogs', 'materialCost', 'laborCost', 'freightCost', 'warranty', 'oneOffCogs', 'grossProfit', 'personnelTotal', 'marketing', 'housing', 'it', 'other', 'oneOffOpex', 'opex', 'ebitda', 'dep', 'ebit', 'interestExp', 'interestInc', 'netInterest', 'ebt', 'tax', 'netIncome'];
  const SUM_CF = ['netIncome', 'dep', 'dAR', 'dInv', 'dAP', 'dTax', 'cfo', 'capex', 'cfi', 'tlDraw', 'tlRepay', 'rcfDraw', 'rcfRepay', 'dividend', 'equityRaise', 'cff', 'netCash', 'fcf', 'taxPaid'];

  function aggregate(months, grain) { // grain: 'M' | 'Q' | 'Y'
    if (grain === 'M') return months.map(m => Object.assign({ key: m.period, label: m.period, n: 1, months: [m], partial: false }, m));
    const groups = new Map();
    for (const m of months) {
      const key = grain === 'Q' ? m.quarter : String(m.year);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const out = [];
    for (const [key, ms] of groups) {
      const last = ms[ms.length - 1];
      const pl = {}; for (const k of SUM_PL) pl[k] = sum(ms.map(x => x.pl[k]));
      pl.personnel = {}; for (const dpt of DEPTS) pl.personnel[dpt] = sum(ms.map(x => x.pl.personnel[dpt]));
      const cf = {}; for (const k of SUM_CF) cf[k] = sum(ms.map(x => x.cf[k]));
      cf.cashOpen = ms[0].cf.cashOpen; cf.cashClose = last.cf.cashClose;
      const byLine = {}, byChannel = {}, byCountry = {};
      for (const l of LINES) byLine[l] = { units: sum(ms.map(x => x.byLine[l].units)), revenue: sum(ms.map(x => x.byLine[l].revenue)), cogs: sum(ms.map(x => x.byLine[l].cogs)) };
      for (const c of CHANNELS) byChannel[c] = { units: sum(ms.map(x => x.byChannel[c].units)), revenue: sum(ms.map(x => x.byChannel[c].revenue)) };
      for (const c of COUNTRIES) byCountry[c] = { units: sum(ms.map(x => x.byCountry[c].units)), revenue: sum(ms.map(x => x.byCountry[c].revenue)) };
      const units = sum(ms.map(x => x.kpi.units));
      out.push({
        key, label: key, n: ms.length, year: last.year, quarter: last.quarter, period: last.period,
        isActual: ms.every(x => x.isActual), partial: ms.length < (grain === 'Q' ? 3 : 12),
        pl, cf, bs: last.bs,
        kpi: Object.assign({}, last.kpi, { units, asp: units > 0 ? pl.revenue / units : 0, grossMarginPct: pl.revenue > 0 ? pl.grossProfit / pl.revenue : 0, ebitdaPct: pl.revenue > 0 ? pl.ebitda / pl.revenue : 0, fteAvg: sum(ms.map(x => x.kpi.fte)) / ms.length }),
        byLine, byChannel, byCountry, months: ms
      });
    }
    return out;
  }

  // ---------- forecast drivers uit aannames ----------
  function defaultAssumptions() {
    return {
      volumeGrowth: 0.08,     // per jaar
      priceIndex: 0.02,       // per jaar
      materialIndex: 0.015,   // per jaar (kosten per eenheid)
      fteGrowth: 0.06,        // per jaar
      wageIndex: 0.035,       // per jaar
      marketingPct: 0.054,    // van omzet
      dso: 48, dio: 92, dpo: 54,
      capexPerYear: 5500000,
      dividendPct: 0.40,      // van winst vorig jaar, uitgekeerd in mei
      deExpansion: true,      // Duitse uitrol doorzetten
      leaseBoost: 0.10        // extra jaargroei leasekanaal
    };
  }

  /**
   * Bouwt forecast-drivers vanaf de maand na actualsUntil tot config.months.
   * Seizoenspatroon = aandeel per kalendermaand uit de laatste 24 actuele maanden.
   */
  function buildForecastDrivers(config, actualDrivers, a, actualMonths) {
    const nAct = actualDrivers.length;
    const horizon = config.months - nAct;
    if (horizon <= 0) return [];
    const last12 = actualDrivers.slice(-12);
    const last24 = actualDrivers.slice(-24);
    // seizoensindex per lijn per kalendermaand (genormaliseerd op gemiddelde 1)
    const season = {};
    for (let li = 0; li < LINES.length; li++) {
      const byMonth = new Array(12).fill(0), cnt = new Array(12).fill(0);
      for (let k = 0; k < last24.length; k++) {
        const ym = addMonths(config.start, nAct - last24.length + k);
        const mo = monthOf(ym) - 1;
        let u = 0; for (let ci = 0; ci < CHANNELS.length; ci++) for (let co = 0; co < COUNTRIES.length; co++) u += last24[k].units[cellIndex(li, ci, co)];
        byMonth[mo] += u; cnt[mo]++;
      }
      const avg = byMonth.map((v, i) => cnt[i] ? v / cnt[i] : 0);
      const mean = sum(avg) / 12;
      season[LINES[li]] = avg.map(v => mean > 0 ? v / mean : 1);
    }
    // LTM basis per cel
    const baseUnits = new Array(NCELL).fill(0);
    for (const d of last12) for (let i = 0; i < NCELL; i++) baseUnits[i] += d.units[i];
    const lastD = actualDrivers[nAct - 1];
    const out = [];
    // dividend: % van nettowinst vorig boekjaar, in mei
    const niByYear = {};
    if (actualMonths) for (const m of actualMonths) { niByYear[m.year] = (niByYear[m.year] || 0) + m.pl.netIncome; }
    const forecastNi = {};
    for (let h = 0; h < horizon; h++) {
      const ym = addMonths(config.start, nAct + h);
      const t = (h + 1) / 12; // jaren vooruit
      const mo = monthOf(ym) - 1;
      const d = {
        units: new Array(NCELL), price: {}, channelFactor: Object.assign({}, lastD.channelFactor), countryFactor: Object.assign({}, lastD.countryFactor), material: {},
        laborPerUnit: 0, freightPerUnit: 0, warrantyPct: lastD.warrantyPct, fte: {}, costPerFte: {}, marketingPct: 0, housing: 0, it: 0, other: 0,
        dso: 0, dio: 0, dpo: 0, capex: 0, termLoanDraw: 0, termLoanRepay: 0, dividend: 0, equityRaise: 0, oneOff: null
      };
      const g = Math.pow(1 + a.volumeGrowth, t);
      const leaseF = Math.pow(1 + a.leaseBoost, t);
      const deF = a.deExpansion ? Math.pow(1.22, t) : Math.pow(0.97, t);
      for (let li = 0; li < LINES.length; li++) {
        const sg = season[LINES[li]][mo] * g / 12;
        for (let ci = 0; ci < CHANNELS.length; ci++) for (let co = 0; co < COUNTRIES.length; co++) {
          const idx = cellIndex(li, ci, co);
          let u = baseUnits[idx] * sg;
          if (ci === 2) u *= leaseF;
          if (co === 1) u *= deF;
          d.units[idx] = u;
        }
      }
      const priceF = Math.pow(1 + a.priceIndex, t), matF = Math.pow(1 + a.materialIndex, t), wageF = Math.pow(1 + a.wageIndex, t), fteF = Math.pow(1 + a.fteGrowth, t), salesF = a.deExpansion ? Math.pow(1.06, t) : 1;
      for (const l of LINES) { d.price[l] = lastD.price[l] * priceF; d.material[l] = lastD.material[l] * matF; }
      d.laborPerUnit = lastD.laborPerUnit * wageF;
      d.freightPerUnit = lastD.freightPerUnit * matF;
      for (const k of DEPTS) { d.fte[k] = lastD.fte[k] * fteF * (k === 'sales' ? salesF : 1); d.costPerFte[k] = lastD.costPerFte[k] * wageF; }
      d.marketingPct = a.marketingPct;
      d.housing = lastD.housing * Math.pow(1.02, t); d.it = lastD.it * Math.pow(1.04, t); d.other = lastD.other * Math.pow(1.02, t) * (a.deExpansion ? Math.pow(1.05, t) : 1);
      d.dso = a.dso; d.dio = a.dio; d.dpo = a.dpo;
      d.capex = a.capexPerYear / 12;
      d.termLoanDraw = 0; d.termLoanRepay = lastD.termLoanRepay || 0; d.equityRaise = 0;
      d.dividend = 0;
      if (monthOf(ym) === 5) {
        const prevYear = yearOf(ym) - 1;
        const base = niByYear[prevYear] != null ? niByYear[prevYear] : (forecastNi[prevYear] || 0);
        d.dividend = Math.max(0, base) * a.dividendPct;
      }
      out.push(d);
    }
    return out;
  }

  /**
   * runScenario(dataset, assumptions) → volledige run (actuals + forecast).
   * Forecast-dividenden hangen af van forecast-winst; daarom twee passes.
   */
  function runScenario(dataset, assumptions, opts) {
    const config = dataset.config;
    const actuals = dataset.actualDrivers;
    const a = Object.assign(defaultAssumptions(), assumptions || {});
    const actRun = dataset._actRun || (dataset._actRun = run(config, actuals, opts));
    let fc = buildForecastDrivers(config, actuals, a, actRun.months);
    let fcRun = run(config, fc, Object.assign({}, opts, { state: actRun.state }));
    // tweede pass: dividend op basis van forecast-winst van het voorgaande jaar
    const niByYear = {};
    for (const m of actRun.months) niByYear[m.year] = (niByYear[m.year] || 0) + m.pl.netIncome;
    for (const m of fcRun.months) niByYear[m.year] = (niByYear[m.year] || 0) + m.pl.netIncome;
    let changed = false;
    for (let h = 0; h < fc.length; h++) {
      const ym = fcRun.periods[h];
      if (monthOf(ym) === 5) {
        const div = Math.max(0, niByYear[yearOf(ym) - 1] || 0) * a.dividendPct;
        if (Math.abs(div - fc[h].dividend) > 1) { fc[h].dividend = div; changed = true; }
      }
    }
    if (changed) fcRun = run(config, fc, Object.assign({}, opts, { state: actRun.state }));
    const res = {
      periods: actRun.periods.concat(fcRun.periods), months: actRun.months.concat(fcRun.months), equity0: actRun.equity0,
      maxCheck: Math.max(actRun.maxCheck, fcRun.maxCheck), config, state: fcRun.state, startIndex: 0,
      assumptions: a, forecastDrivers: fc, actualCount: actuals.length
    };
    return res;
  }

  // ---------- Monte Carlo ----------
  function defaultUncertainty() {
    return {
      volumeGrowthSd: 0.06,
      priceIndexSd: 0.015,
      materialIndexSd: 0.04,
      dsoSd: 6,
      dioSd: 12,
      wageIndexSd: 0.01,
      marketingSd: 0.006
    };
  }

  function monteCarlo(dataset, assumptions, unc, n, seed, opts) {
    opts = opts || {};
    const a = Object.assign(defaultAssumptions(), assumptions || {});
    const u = Object.assign(defaultUncertainty(), unc || {});
    const r = rng(seed || 20261006);
    const config = dataset.config;
    const actuals = dataset.actualDrivers;
    const actRun = run(config, actuals, { detail: false });
    const state = actRun.state;
    const targetYear = opts.targetYear || 2027;
    const results = { ebitda: new Float64Array(n), revenue: new Float64Array(n), minCash: new Float64Array(n), maxLeverage: new Float64Array(n), minIcr: new Float64Array(n), netIncome: new Float64Array(n), fcf: new Float64Array(n), breach: 0, cashBreach: 0, breachLeverage: 0, breachIcr: 0, breachBoth: 0, breachUndefined: 0, rcfDrawn: 0, breachFlags: new Uint8Array(n), draws: new Array(n) };
    for (let k = 0; k < n; k++) {
      const s = Object.assign({}, a, {
        volumeGrowth: r.normal(a.volumeGrowth, u.volumeGrowthSd),
        priceIndex: r.normal(a.priceIndex, u.priceIndexSd),
        materialIndex: r.normal(a.materialIndex, u.materialIndexSd),
        wageIndex: r.normal(a.wageIndex, u.wageIndexSd),
        marketingPct: Math.max(0.01, r.normal(a.marketingPct, u.marketingSd)),
        dso: Math.max(20, r.normal(a.dso, u.dsoSd)),
        dio: Math.max(30, r.normal(a.dio, u.dioSd))
      });
      const fc = buildForecastDrivers(config, actuals, s, actRun.months);
      let eb = 0, rev = 0, ni = 0, fcf = 0, minCash = Infinity, maxLev = -Infinity, minIcr = Infinity, breach = false, cashBreach = false, bLev = false, bIcr = false, bBoth = false, bUndef = false, drawn = false;
      run(config, fc, { detail: false, state, collect: function (m) {
        if (m.year === targetYear) { eb += m.ebitda; rev += m.revenue; ni += m.netIncome; fcf += m.fcf; }
        if (m.cash < minCash) minCash = m.cash;
        if (m.leverage > maxLev) maxLev = m.leverage;
        if (m.icr < minIcr) minIcr = m.icr;
        if (m.month % 3 === 0 && !m.covenantOk) { breach = true; if (m.ltmEbitda <= 0) bUndef = true; else if (!m.leverageOk && !m.icrOk) bBoth = true; else if (!m.leverageOk) bLev = true; else bIcr = true; }
        if (m.rcf > 1e-6) drawn = true;
        if (m.rcfHeadroom < 1e-6 && m.cash < m.minCash - 1) cashBreach = true;
      } });
      results.breachFlags[k] = (bUndef ? 8 : 0) | (bBoth ? 4 : 0) | (bLev ? 2 : 0) | (bIcr ? 1 : 0);
      if (bLev) results.breachLeverage++; if (bIcr) results.breachIcr++; if (bBoth) results.breachBoth++; if (bUndef) results.breachUndefined++; if (drawn) results.rcfDrawn++;
      results.ebitda[k] = eb; results.revenue[k] = rev; results.netIncome[k] = ni; results.fcf[k] = fcf; results.minCash[k] = minCash; results.maxLeverage[k] = maxLev; results.minIcr[k] = minIcr;
      if (breach) results.breach++; if (cashBreach) results.cashBreach++;
      results.draws[k] = { volumeGrowth: s.volumeGrowth, priceIndex: s.priceIndex, materialIndex: s.materialIndex, dso: s.dso, dio: s.dio, wageIndex: s.wageIndex, marketingPct: s.marketingPct, ebitda: eb };
    }
    results.n = n; results.targetYear = targetYear; results.seed = seed;
    return results;
  }

  function quantile(sortedArr, q) {
    if (!sortedArr.length) return 0;
    const pos = (sortedArr.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (pos - lo);
  }
  function stats(typed) {
    const arr = Array.from(typed).sort((x, y) => x - y);
    const mean = sum(arr) / arr.length;
    let v = 0; for (const x of arr) v += (x - mean) * (x - mean); v /= Math.max(1, arr.length - 1);
    return { mean, sd: Math.sqrt(v), p5: quantile(arr, 0.05), p10: quantile(arr, 0.10), p25: quantile(arr, 0.25), p50: quantile(arr, 0.5), p75: quantile(arr, 0.75), p90: quantile(arr, 0.90), p95: quantile(arr, 0.95), min: arr[0], max: arr[arr.length - 1], sorted: arr };
  }
  function histogram(sortedArr, bins, lo, hi) {
    lo = lo != null ? lo : sortedArr[0]; hi = hi != null ? hi : sortedArr[sortedArr.length - 1];
    const w = (hi - lo) / bins || 1; const counts = new Array(bins).fill(0);
    for (const x of sortedArr) { let b = Math.floor((x - lo) / w); if (b >= bins) b = bins - 1; if (b < 0) b = 0; counts[b]++; }
    return counts.map((c, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: c, share: c / sortedArr.length }));
  }
  // Pearson-correlatie van elke driver met het resultaat → tornado
  function sensitivity(draws, key) {
    const keys = ['volumeGrowth', 'priceIndex', 'materialIndex', 'dso', 'dio', 'wageIndex', 'marketingPct'];
    const y = draws.map(d => d[key]); const my = sum(y) / y.length;
    const out = [];
    for (const k of keys) {
      const x = draws.map(d => d[k]); const mx = sum(x) / x.length;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
      const rho = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
      out.push({ driver: k, rho, contribution: rho * rho });
    }
    const tot = sum(out.map(o => o.contribution)) || 1;
    for (const o of out) o.share = o.contribution / tot;
    return out.sort((p, q) => Math.abs(q.rho) - Math.abs(p.rho));
  }

  // ---------- DCF ----------
  function dcf(res, params) {
    const p = Object.assign({ wacc: 0.09, terminalGrowth: 0.02, valuationDate: null }, params || {});
    const months = res.months;
    const config = res.config;
    const valDate = p.valuationDate || config.actualsUntil;
    const startIdx = months.findIndex(m => m.period === valDate) + 1;
    const fcMonths = months.slice(startIdx);
    // jaarlijkse FCFF (unlevered): EBIT×(1−t) + D&A − capex − ΔNWC  → benadering via EBITDA − tax op EBIT − capex − ΔNWC
    const years = {};
    for (const m of fcMonths) {
      const y = m.year; if (!years[y]) years[y] = { year: y, months: 0, ebitda: 0, ebit: 0, dep: 0, capex: 0, dNwc: 0 };
      const yr = years[y]; yr.months++; yr.ebitda += m.pl.ebitda; yr.ebit += m.pl.ebit; yr.dep += m.pl.dep; yr.capex += -m.cf.capex; yr.dNwc += -(m.cf.dAR + m.cf.dInv + m.cf.dAP);
    }
    const rows = Object.values(years).sort((a, b) => a.year - b.year).map(yr => {
      const nopat = yr.ebit * (1 - config.taxRate);
      const fcff = nopat + yr.dep - yr.capex - yr.dNwc;
      return Object.assign(yr, { nopat, fcff });
    });
    // annualiseer een gedeeltelijk eerste jaar niet; discounteer op basis van maanden sinds waarderingsdatum (mid-year)
    let pv = 0; let monthsElapsed = 0;
    for (const r of rows) {
      const mid = (monthsElapsed + r.months / 2) / 12;
      r.df = Math.pow(1 + p.wacc, -mid); r.pv = r.fcff * r.df; pv += r.pv; monthsElapsed += r.months;
    }
    const lastFull = rows.filter(r => r.months === 12).slice(-1)[0] || rows[rows.length - 1];
    const tvFcff = lastFull.fcff * (1 + p.terminalGrowth);
    const tv = p.wacc > p.terminalGrowth ? tvFcff / (p.wacc - p.terminalGrowth) : NaN;
    const tvDf = Math.pow(1 + p.wacc, -(monthsElapsed / 12));
    const pvTv = tv * tvDf;
    const ev = pv + pvTv;
    const bsAtVal = months[startIdx - 1].bs;
    const netDebt = bsAtVal.termLoan + bsAtVal.rcf - bsAtVal.cash;
    const equityValue = ev - netDebt;
    const ltmEbitda = months[startIdx - 1].kpi.ltmEbitda;
    return { rows, pvExplicit: pv, tv, tvFcff, tvDf, monthsElapsed, pvTv, ev, netDebt, equityValue, ltmEbitda, evToEbitda: ltmEbitda > 0 ? ev / ltmEbitda : NaN, tvShare: ev ? pvTv / ev : 0, params: p, valuationDate: valDate };
  }

  function dcfGrid(res, waccs, growths) {
    return waccs.map(w => growths.map(g => dcf(res, { wacc: w, terminalGrowth: g }).equityValue));
  }

  return { LINES, CHANNELS, COUNTRIES, DEPTS, DEPT_LABELS, NCELL, cellIndex, cellOf, addMonths, monthDiff, periods, yearOf, monthOf, quarterOf, rng, defaultConfig, defaultAssumptions, defaultUncertainty, run, openingState, aggregate, buildForecastDrivers, runScenario, monteCarlo, stats, histogram, sensitivity, quantile, dcf, dcfGrid, sum, clone };
});
