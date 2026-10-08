/*
 * mc-worker.js — Monte Carlo-simulatie in een Web Worker, zodat de UI responsief blijft.
 *
 * Het engine rekent alle n simulaties in één keer (engine.monteCarlo). Om voortgang te kunnen melden draait de worker
 * de simulatie in brokken (standaard 10) met seeds die van de basisseed zijn afgeleid (brok 0 = basisseed, dus één brok
 * is bit-voor-bit gelijk aan een directe engine.monteCarlo-aanroep). Elk brok wordt direct naar de pagina gestuurd
 * (typed arrays worden overgedragen, niet gekopieerd); de pagina voegt de brokken samen met merge() en kan tussentijds
 * een voorlopige verdeling tonen.
 *
 * Bericht in : { id, dataset, assumptions, unc, n, seed, opts:{ targetYear, chunks } }
 *              (dataset zonder _actRun; dataset.js gebruikt window en kan niet in een worker geladen worden)
 * Berichten uit: { type:'part', id, k, done, n, part }   (na elk brok; part = resultaat van engine.monteCarlo voor dat brok)
 *                { type:'done', id, ms }
 *                { type:'error', id, message }
 *
 * Werkt ook in Node voor verificatie: require('./mc-worker.js').runChunked(dataset, a, unc, n, seed, opts).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) { module.exports = factory(require('./engine.js')); return; }
  if (!root.HelderEngine && typeof importScripts === 'function') importScripts('engine.js');
  root.HelderMC = factory(root.HelderEngine);
  // alleen in een echte worker-context luisteren naar berichten
  if (typeof importScripts === 'function' && typeof root.postMessage === 'function') {
    const now = () => (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    root.onmessage = function (ev) {
      const m = ev.data || {};
      const t0 = now();
      try {
        const MC = root.HelderMC;
        const plan = MC.chunkPlan(m.n, m.seed, m.opts);
        let done = 0;
        for (let k = 0; k < plan.length; k++) {
          const part = MC.runChunk(m.dataset, m.assumptions, m.unc, plan[k]);
          done += plan[k].size;
          root.postMessage({ type: 'part', id: m.id, k: k, done: done, n: m.n, part: part }, MC.KEYS.map(function (key) { return part[key].buffer; }).concat(part.breachFlags ? [part.breachFlags.buffer] : []));
        }
        root.postMessage({ type: 'done', id: m.id, ms: now() - t0 });
      } catch (e) {
        root.postMessage({ type: 'error', id: m.id, message: (e && e.message) || String(e) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const KEYS = ['ebitda', 'revenue', 'minCash', 'maxLeverage', 'minIcr', 'netIncome', 'fcf'];

  /** seed per brok: brok 0 = basisseed; overige via een 32-bits mix (murmur-finalizer) zodat de reeksen onafhankelijk zijn */
  function chunkSeed(seed, k) {
    const s = seed >>> 0;
    if (k === 0) return s;
    let x = (s ^ Math.imul(k, 0x9E3779B9)) >>> 0;
    x = Math.imul(x ^ (x >>> 16), 0x85EBCA6B) >>> 0;
    x = Math.imul(x ^ (x >>> 13), 0xC2B2AE35) >>> 0;
    return (x ^ (x >>> 16)) >>> 0;
  }
  /** verdeling van n over `chunks` brokken (verschil ≤ 1) */
  function chunkSizes(n, chunks) {
    const c = Math.max(1, Math.min(chunks || 10, n));
    const out = [];
    for (let k = 0; k < c; k++) { const size = Math.floor(n * (k + 1) / c) - Math.floor(n * k / c); if (size > 0) out.push(size); }
    return out;
  }
  /** plan: [{k, size, seed, targetYear}] */
  function chunkPlan(n, seed, opts) {
    opts = opts || {};
    const base = (seed == null ? 20261006 : seed) >>> 0;
    const targetYear = opts.targetYear || 2027;
    return chunkSizes(n, opts.chunks).map((size, k) => ({ k, size, seed: chunkSeed(base, k), baseSeed: base, targetYear }));
  }
  function runChunk(dataset, assumptions, unc, c) {
    return E.monteCarlo(dataset, assumptions, unc, c.size, c.seed, { targetYear: c.targetYear });
  }
  /** tellers van engine.monteCarlo die bij het samenvoegen opgeteld worden */
  const COUNTERS = ['breach', 'cashBreach', 'breachLeverage', 'breachIcr', 'breachBoth', 'breachUndefined', 'rcfDrawn'];
  /** voegt de deelresultaten van engine.monteCarlo samen tot één resultaat met dezelfde vorm (incl. breachFlags per simulatie) */
  function merge(parts, seed, targetYear) {
    const n = parts.reduce((s, p) => s + p.n, 0);
    const out = { n: n, seed: seed, targetYear: targetYear, draws: new Array(n), breachFlags: new Uint8Array(n) };
    for (const c of COUNTERS) out[c] = 0;
    for (const k of KEYS) { const arr = new Float64Array(n); let off = 0; for (const p of parts) { arr.set(p[k], off); off += p.n; } out[k] = arr; }
    let i = 0, off = 0;
    for (const p of parts) {
      for (const c of COUNTERS) out[c] += p[c] || 0;
      if (p.breachFlags) out.breachFlags.set(p.breachFlags, off); off += p.n;
      for (let j = 0; j < p.n; j++) out.draws[i++] = p.draws[j];
    }
    return out;
  }
  /** runChunked(dataset, assumptions, unc, n, seed, opts, onProgress(done, n, parts)) → resultaat als engine.monteCarlo (synchroon; Node/hoofdthread) */
  function runChunked(dataset, assumptions, unc, n, seed, opts, onProgress) {
    const plan = chunkPlan(n, seed, opts);
    const parts = []; let done = 0;
    for (const c of plan) { parts.push(runChunk(dataset, assumptions, unc, c)); done += c.size; if (onProgress) onProgress(done, n, parts); }
    return merge(parts, plan.length ? plan[0].baseSeed : (seed >>> 0), plan.length ? plan[0].targetYear : (opts && opts.targetYear) || 2027);
  }
  return { KEYS, COUNTERS, chunkSeed, chunkSizes, chunkPlan, runChunk, merge, runChunked };
});
