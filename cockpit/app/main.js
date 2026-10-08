/*
 * main.js — opstarten: model, navigatie, filterbalk, thema, runtime-capabilities (Claude-artifact).
 */
(function () {
  'use strict';
  const H = window.HC, h = H.h, fmt = H.fmt, ui = H.ui;

  function buildNav() {
    const nav = document.getElementById('nav'), strip = document.getElementById('tabstrip');
    H.clear(nav); H.clear(strip);
    for (const t of H.tabs.list) {
      const go = e => { e.preventDefault(); H.tabs.go(t.id); };
      nav.appendChild(h('a', { href: '#' + t.id, dataset: { tab: t.id }, onClick: go, 'aria-current': 'false' }, H.icon(t.icon || 'info', 18), t.label));
      strip.appendChild(h('a', { href: '#' + t.id, dataset: { tab: t.id }, onClick: go, 'aria-current': 'false' }, t.short || t.label));
    }
  }

  function scenarioOptions() {
    const s = H.state.get(); const list = Object.keys(H.model.scenarios).map(k => ({ value: k, label: H.model.scenarios[k].label }));
    if (Object.keys(s.overrides || {}).length) list.find(o => o.value === s.scenarioKey).label += ' (aangepast)';
    return list;
  }
  function buildFilterbar() {
    const bar = document.getElementById('filterbar'); H.clear(bar);
    const s = H.state.get();
    bar.appendChild(h('div', { class: 'filter-group' }, h('label', { for: 'f-grain' }, 'Korrel'), ui.segmented({ id: 'f-grain', label: 'Korrel', value: s.grain, options: [{ value: 'M', label: 'Maand' }, { value: 'Q', label: 'Kwartaal' }, { value: 'Y', label: 'Jaar' }], onChange: v => H.state.set({ grain: v }) })));
    bar.appendChild(h('div', { class: 'filter-group' }, h('label', { for: 'f-preset' }, 'Periode'), ui.select({ id: 'f-preset', label: 'Periode', inline: true, value: s.preset, options: Object.keys(H.PRESETS).map(k => ({ value: k, label: H.PRESETS[k].label })), onChange: v => H.state.set({ preset: v }) })));
    bar.appendChild(h('div', { class: 'filter-group' }, h('label', { for: 'f-scenario' }, 'Scenario'), ui.select({ id: 'f-scenario', label: 'Scenario', inline: true, value: s.scenarioKey, options: scenarioOptions(), onChange: v => H.state.set({ scenarioKey: v, overrides: {} }) })));
    const right = h('div', { class: 'filter-group', style: { marginLeft: 'auto' } });
    right.appendChild(ui.chip('Actuals t/m ' + fmt.month(H.model.lastActualPeriod), 'actual'));
    right.appendChild(ui.chip('Fictieve data', null));
    const isDark = () => (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
    const tbtn = ui.button('', () => { const next = isDark() ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('hc.theme', next); } catch (e) { } H.clear(tbtn); tbtn.appendChild(H.icon(isDark() ? 'sun' : 'moon', 15)); H.tabs.rerender(); }, { sm: true, ghost: true, title: 'Licht/donker thema', id: 'theme-toggle' });
    tbtn.appendChild(H.icon(isDark() ? 'sun' : 'moon', 15)); tbtn.setAttribute('aria-label', 'Thema wisselen');
    right.appendChild(tbtn);
    bar.appendChild(right);
  }
  function syncFilterbar() {
    const s = H.state.get();
    const g = document.getElementById('f-grain'); if (g) for (const b of g.children) b.setAttribute('aria-pressed', String(b.textContent === { M: 'Maand', Q: 'Kwartaal', Y: 'Jaar' }[s.grain]));
    const p = document.getElementById('f-preset'); if (p && p.value !== s.preset) p.value = s.preset;
    const sc = document.getElementById('f-scenario'); if (sc) { const opts = scenarioOptions(); H.clear(sc); for (const o of opts) sc.appendChild(h('option', { value: o.value, selected: o.value === s.scenarioKey }, o.label)); }
  }
  function buildSidebar() {
    const extra = document.getElementById('sidebar-extra'); H.clear(extra);
    const s = H.state.get(); const sc = H.model.scenarios[s.scenarioKey]; const run = H.model.run();
    const custom = Object.keys(s.overrides || {}).length > 0;
    extra.appendChild(h('div', { class: 'eyebrow' }, 'Actief scenario'));
    extra.appendChild(h('div', null, h('strong', null, sc.label), custom ? ui.chip('aangepast', 'accent') : null));
    extra.appendChild(h('div', { class: 'small ink-2' }, sc.description));
    const ok = run.maxCheck < 0.01;
    extra.appendChild(h('div', { class: 'small', style: { marginTop: '6px' } }, h('span', { class: ok ? 'check-ok' : 'check-bad' }, H.icon(ok ? 'check' : 'warn', 12), ' Balans sluit'), h('span', { class: 'muted' }, ' · ' + run.months.length + ' maanden, max. afwijking ' + fmt.eur(run.maxCheck, { full: true }).replace('€ 0', '€ 0,00'))));
    const foot = document.getElementById('sidebar-foot'); H.clear(foot);
    foot.appendChild(h('div', null, 'Helder E-Bikes B.V. bestaat niet. Alle cijfers, namen en gebeurtenissen zijn verzonnen voor deze demonstratie.'));
    foot.appendChild(h('div', { style: { marginTop: '6px' } }, 'Gebouwd door Claude · drie-statement model, Monte Carlo, DCF en Power BI-export in één pagina.'));
  }
  function buildFoot() {
    const f = document.getElementById('foot'); H.clear(f);
    f.appendChild(h('span', null, 'Helder CFO Cockpit · fictieve demonstratie · data gegenereerd ' + fmt.date(H.model.dataset.meta.generatedAt) + ' · bedragen in euro, excl. btw'));
  }

  // ---------- runtime-capabilities (alleen in een Claude-artifact aanwezig) ----------
  function initCaps() {
    const c = window.claude;
    H.caps.isArtifact = !!(c && typeof c.use === 'function');
    const done = () => { H.caps.ready = true; for (const fn of H.caps.listeners) { try { fn(H.caps); } catch (e) { console.error(e); } } H.caps.listeners = []; };
    if (!H.caps.isArtifact) { done(); return; }
    Promise.all([c.use('sample').catch(() => null), c.use('downloads').catch(() => null)]).then(([sample, downloads]) => { H.caps.sample = sample; H.caps.downloads = downloads; done(); });
  }
  /** bestand aanbieden: via downloads-capability (artifact) of gewone browserdownload */
  H.download = async function (filename, data) {
    if (H.caps.downloads) { return H.caps.downloads.save({ filename, data }); }
    if (H.caps.isArtifact) throw { code: 'unavailable', message: 'Downloads zijn in deze weergave niet beschikbaar.' };
    const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob); const a = h('a', { href: url, download: filename }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { status: 'saved' };
  };
  H.copyText = async function (text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: 0 } }); document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { } ta.remove(); return ok; } };

  function boot() {
    try { const saved = localStorage.getItem('hc.theme'); if (saved === 'dark' || saved === 'light') document.documentElement.dataset.theme = saved; } catch (e) { }
    H.model.init(window.HELDER_DATA);
    H.tabs._root = document.getElementById('view');
    buildNav(); buildFilterbar(); buildSidebar(); buildFoot();
    let start = location.hash.replace('#', '');
    if (!H.tabs.get(start)) { try { start = localStorage.getItem('hc.tab'); } catch (e) { } }
    H.tabs.go(H.tabs.get(start) ? start : H.tabs.list[0].id);
    window.addEventListener('hashchange', () => { const id = location.hash.replace('#', ''); if (id && id !== H.tabs.current && H.tabs.get(id)) H.tabs.go(id); });
    H.state.subscribe(() => { syncFilterbar(); buildSidebar(); });
    initCaps();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
