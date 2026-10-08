/* Tab: Power BI — hetzelfde model als Power BI-project (PBIP): download in de browser, sterschema, DAX-maten,
   calculation group, Power Query en de aansluiting met de cockpit. Leest window.HELDER_PBIP (gebouwd door
   scripts/build-pbip-bundle.mjs) en bouwt ZIP's met window.HZip — zonder netwerk. */
(function () {
  'use strict';
  const H = window.HC;
  const MODEL_DIR = 'Helder.SemanticModel/definition/';

  // =====================================================================
  // Lokale helpers: de projectbundel en de TMDL-bestanden lezen
  // =====================================================================
  let loadingBundle = null;
  // 'al geprobeerd' staat op moduleniveau, niet op de sectie: H.tabs.rerender() maakt elke keer een nieuwe sectie, dus een vlag op
  // root.dataset wordt nooit teruggezien en een mislukte lading (404, lege bundel) zou het tabblad eindeloos opnieuw laten renderen
  let bundleTried = false;
  /** laadt data/pbip.js (ca. 650 KB) pas als dit tabblad geopend wordt; roept cb(ok) aan zodra de lading geslaagd of mislukt is */
  function ensureBundle(cb) {
    const b = window.HELDER_PBIP;
    if (b && b.files && Object.keys(b.files).length) { bundleTried = true; cb(true); return; }
    if (!loadingBundle) {
      loadingBundle = new Promise(resolve => { const s = document.createElement('script'); s.src = 'data/pbip.js'; s.async = true; s.onload = () => resolve(true); s.onerror = () => resolve(false); document.head.appendChild(s); })
        .then(ok => { bundleTried = true; return ok; });
    }
    loadingBundle.then(ok => cb(ok));
  }
  function bundle() {
    const b = window.HELDER_PBIP;
    const files = b && b.files && typeof b.files === 'object' ? b.files : {};
    return { generatedAt: b && b.generatedAt ? b.generatedAt : null, files, empty: Object.keys(files).length === 0 };
  }
  function parseJson(text, fallback) { if (typeof text !== 'string') return fallback; try { return JSON.parse(text); } catch (e) { return fallback; } }
  function unquote(s) { s = String(s).trim(); return s.length > 1 && s[0] === "'" && s[s.length - 1] === "'" ? s.slice(1, -1) : s; }
  function bytesOf(text) { let n = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); n += c < 128 ? 1 : c < 2048 ? 2 : c >= 0xD800 && c <= 0xDBFF ? 4 : 3; if (c >= 0xD800 && c <= 0xDBFF) i++; } return n; }
  function sizeLabel(fmt, bytes) { return bytes >= 1024 * 1024 ? fmt.num(bytes / 1024 / 1024, 1) + ' MB' : fmt.num(bytes / 1024, 0) + ' KB'; }
  function csvRowCount(text) { if (typeof text !== 'string') return 0; const n = text.split('\n').filter(l => l.trim() !== '').length; return Math.max(0, n - 1); }
  /** datumfilter uit een M-partitie: `[DatumKey] >= 20230101 and [DatumKey] <= 20281231` → { lo, hi } */
  function dateBounds(mSource) { const m = /\[DatumKey\]\s*>=\s*(\d{8})\s+and\s+\[DatumKey\]\s*<=\s*(\d{8})/.exec(mSource || ''); return m ? { lo: Number(m[1]), hi: Number(m[2]) } : null; }
  /** CSV-rijen waarvan DatumKey buiten [lo, hi] valt (die filtert de M-query weg): { rows, months } (months = aantal verschillende DatumKeys) */
  function csvOutside(text, b) {
    const out = { rows: 0, months: 0 };
    if (typeof text !== 'string' || !b) return out;
    const lines = text.split('\n'); const head = (lines[0] || '').replace(/\r$/, '').split(','); const iD = head.indexOf('DatumKey'); if (iD < 0) return out;
    const keys = new Set();
    for (let i = 1; i < lines.length; i++) { const l = lines[i]; if (l.trim() === '') continue; const k = Number(l.split(',')[iD]); if (isFinite(k) && (k < b.lo || k > b.hi)) { out.rows++; keys.add(k); } }
    out.months = keys.size;
    return out;
  }
  function keyToIso(k) { const s = String(k); return s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); }
  /** sleutelmarkering: klein inline-SVG-sleuteltje (geen Unicode-glyph die van een systeemfont afhangt) */
  function keyIcon() {
    return H.svg('svg', { viewBox: '0 0 24 24', width: 11, height: 11, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', role: 'img', 'aria-label': 'sleutel', style: 'vertical-align:-1px;margin-right:4px;flex:none' },
      H.svg('circle', { cx: 7.5, cy: 16.5, r: 4.5 }), H.svg('path', { d: 'M10.8 13.2 21 3M17 7l3 3M13.5 10.5l3 3' }));
  }

  /** TMDL-tabel → { name, description, columns[{name,dataType,hidden,key,calculated,description}], measures, isCalcGroup, calcItems[], mSource, hierarchy } */
  function parseTable(text) {
    const t = { name: '', description: '', columns: [], measures: 0, isCalcGroup: false, calcItems: [], mSource: null, hierarchy: null };
    if (typeof text !== 'string') return t;
    const lines = text.split('\n');
    let pendingDesc = [], cur = null, curKind = null, inSource = false; const src = [];
    const flushSource = () => { inSource = false; t.mSource = src.join('\n').replace(/\s+$/, ''); };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/\r$/, '');
      if (inSource) { if (line.startsWith('\t\t\t\t') || line.trim() === '') { src.push(line.replace(/^\t{4}/, '')); continue; } flushSource(); }
      const trimmed = line.trim();
      if (trimmed.startsWith('///')) { pendingDesc.push(trimmed.replace(/^\/\/\/\s?/, '')); continue; }
      let m;
      if ((m = /^table\s+(.+)$/.exec(line))) { t.name = unquote(m[1]); t.description = pendingDesc.join(' '); pendingDesc = []; continue; }
      if ((m = /^\tcolumn\s+('[^']+'|[^\s=]+)(\s*=\s*(.*))?$/.exec(line))) { cur = { name: unquote(m[1]), calculated: !!m[2], dataType: '', hidden: false, key: false, description: pendingDesc.join(' ') }; curKind = 'column'; t.columns.push(cur); pendingDesc = []; continue; }
      if (/^\tmeasure\s+/.test(line)) { t.measures++; cur = null; curKind = null; pendingDesc = []; continue; }
      if (/^\tcalculationGroup\b/.test(line)) { t.isCalcGroup = true; cur = null; curKind = null; continue; }
      if ((m = /^\t\tcalculationItem\s+('[^']+'|[^\s=]+)\s*=\s*(.*)$/.exec(line))) { cur = { name: unquote(m[1]), dax: m[2].trim(), description: pendingDesc.join(' '), formatString: null }; curKind = 'item'; t.calcItems.push(cur); pendingDesc = []; continue; }
      if ((m = /^\thierarchy\s+(.+)$/.exec(line))) { t.hierarchy = unquote(m[1]); cur = null; curKind = null; pendingDesc = []; continue; }
      if (/^\tpartition\s+/.test(line)) { cur = null; curKind = null; pendingDesc = []; continue; }
      if (/^\t\tsource\s*=\s*$/.test(line)) { inSource = true; src.length = 0; continue; }
      if (curKind === 'column') {
        if ((m = /^\t\tdataType:\s*(\S+)/.exec(line))) cur.dataType = m[1];
        else if (/^\t\tisHidden\b/.test(line)) cur.hidden = true;
        else if (/^\t\tisKey\b/.test(line)) cur.key = true;
      } else if (curKind === 'item') {
        if ((m = /^\t\t\tformatStringDefinition\s*=\s*(.*)$/.exec(line))) cur.formatString = m[1].trim();
      }
    }
    if (inSource) flushSource();
    return t;
  }
  /** relationships.tmdl → [{from:'FactVerkoop', fromCol:'DatumKey', to:'DimDatum', toCol:'DatumKey', crossFilter, fromCardinality, toCardinality, active}]
      (per relationship-blok; TMDL-standaarden: many→one, oneDirection, actief) */
  function parseRelationships(text) {
    const out = [];
    if (typeof text !== 'string') return out;
    const split = s => { s = s.trim(); const i = s.lastIndexOf('.'); return { table: unquote(s.slice(0, i)), col: unquote(s.slice(i + 1)) }; };
    for (const block of text.replace(/\r/g, '').split(/\n(?=relationship\s)/)) {
      if (!/^relationship\s/.test(block.trim())) continue;
      const prop = name => { const m = new RegExp('^\\s*' + name + ':\\s*(.+)$', 'm').exec(block); return m ? m[1].trim() : null; };
      const fc = prop('fromColumn'), tc = prop('toColumn'); if (!fc || !tc) continue;
      const f = split(fc), t = split(tc);
      out.push({ from: f.table, fromCol: f.col, to: t.table, toCol: t.col, crossFilter: prop('crossFilteringBehavior') || 'oneDirection', fromCardinality: prop('fromCardinality') || 'many', toCardinality: prop('toCardinality') || 'one', active: (prop('isActive') || 'true') !== 'false' });
    }
    return out;
  }
  /** samenvatting van de relatie-eigenschappen, afgeleid uit de TMDL (niet hard gecodeerd) */
  function relSummary(rels, fmt) {
    if (!rels.length) return 'geen relaties';
    const n1m = rels.filter(r => r.fromCardinality === 'many' && r.toCardinality === 'one').length;
    const single = rels.filter(r => r.crossFilter === 'oneDirection').length;
    const inactive = rels.filter(r => !r.active).length;
    const parts = [n1m === rels.length ? 'alle één-op-veel vanuit de dimensie naar het feit' : fmt.int(n1m) + ' van ' + fmt.int(rels.length) + ' één-op-veel',
      single === rels.length ? 'enkelvoudig filterend' : fmt.int(rels.length - single) + ' in beide richtingen filterend'];
    if (inactive) parts.push(fmt.int(inactive) + ' inactief');
    return parts.join(', ');
  }
  /** expressions.tmdl → [{name, expression}] (M-parameters) */
  function parseExpressions(text) {
    const out = []; if (typeof text !== 'string') return out;
    const re = /^expression\s+('[^']+'|\S+)\s*=\s*(.*)$/gm; let m;
    while ((m = re.exec(text))) out.push({ name: unquote(m[1]), expression: m[2].trim() });
    return out;
  }
  /** blok uit een TMDL-bestand: vanaf de regel die op `startRe` past (met voorafgaande ///-regels) tot de volgende lege regel die wordt gevolgd door een regel met dezelfde of minder inspringing */
  function extractBlock(text, startRe) {
    if (typeof text !== 'string') return '';
    const lines = text.split('\n'); const i0 = lines.findIndex(l => startRe.test(l)); if (i0 < 0) return '';
    const indent = /^\t*/.exec(lines[i0])[0].length;
    let start = i0; while (start > 0 && lines[start - 1].trim().startsWith('///')) start--;
    let end = i0 + 1;
    while (end < lines.length) {
      if (lines[end].trim() === '') { let k = end + 1; while (k < lines.length && lines[k].trim() === '') k++; if (k >= lines.length || /^\t*/.exec(lines[k])[0].length <= indent) break; }
      end++;
    }
    return lines.slice(start, end).map(l => l.replace(new RegExp('^\\t{0,' + indent + '}'), '')).join('\n').replace(/\t/g, '    ').replace(/\s+$/, '');
  }
  function queryOrder(modelText) {
    const m = /PBI_QueryOrder\s*=\s*(\[[^\]]*\])/.exec(modelText || ''); const arr = m ? parseJson(m[1], null) : null; return Array.isArray(arr) ? arr : null;
  }

  // ---------- exports: DAX-markdown en Power Query-tekst ----------
  function groupMeasures(measures) {
    const groups = []; const idx = {};
    for (const m of measures) { const g = m.group || 'Overig'; if (!(g in idx)) { idx[g] = groups.length; groups.push({ name: g, items: [] }); } groups[idx[g]].items.push(m); }
    return groups;
  }
  function daxMarkdown(measures, calcGroup, fmt) {
    const groups = groupMeasures(measures);
    const L = [];
    L.push('# Helder E-Bikes — DAX-maten', '');
    L.push('Gegenereerd uit `powerbi/measures.json`: ' + fmt.int(measures.length) + ' maten in ' + fmt.int(groups.length) + ' weergavemappen van de maattabel `_Maten` (Helder.SemanticModel, TMDL). Alle cijfers zijn fictief.', '');
    L.push('Conventies: basismaten volgen het scenariofilter (zet een slicer op `DimScenario[Scenario]`); kostenmaten zijn positieve bedragen; balansmaten tonen de stand op de laatste maand in de periode; LTM-maten zijn verankerd op de laatste maand mét gegevens in de filtercontext.', '');
    for (const g of groups) {
      L.push('## ' + g.name, '');
      for (const m of g.items) {
        L.push('### ' + m.name, '');
        if (m.description) L.push(m.description, '');
        L.push('```dax', m.name + ' =', ...String(m.dax || '').split('\n').map(l => '    ' + l), '```', '');
        if (m.formatString) L.push('Notatie: `' + m.formatString + '`', '');
      }
    }
    if (calcGroup && calcGroup.calcItems.length) {
      L.push('## Calculation group `' + calcGroup.name + '`', '');
      L.push('Kolom `Tijdberekening`; zet hem in een slicer of op de kolommen van een matrix.', '');
      for (const it of calcGroup.calcItems) { L.push('### ' + it.name, ''); if (it.description) L.push(it.description, ''); L.push('```dax', it.dax, '```', ''); if (it.formatString) L.push('Notatie: `' + it.formatString + '`', ''); }
    }
    return L.join('\n');
  }
  function powerQueryText(tables, expressions, order) {
    const L = ['// Power Query (M) — Helder E-Bikes, uit Helder.SemanticModel/definition (TMDL-partities, mode: import)', '// De tabellen lezen CSV-bestanden uit de parameter CsvMap (map eindigend op een backslash); _Maten is een inline tabel. Fictieve data.', ''];
    for (const e of expressions) L.push('// ===== parameter ' + e.name + ' =====', e.expression, '');
    const withSource = tables.filter(t => t.mSource);
    const rank = t => { const i = order ? order.indexOf(t.name) : -1; return i < 0 ? 999 : i; };
    withSource.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    for (const t of withSource) L.push('// ===== ' + t.name + ' =====' + (t.description ? '\n// ' + t.description : ''), t.mSource, '');
    return L.join('\n');
  }

  // ---------- FactVerkoop.csv → per maand en scenario (voor de aansluiting met het engine) ----------
  function parseFactVerkoop(text) {
    const agg = {}; if (typeof text !== 'string') return agg;
    const lines = text.split('\n'); if (!lines.length) return agg;
    const head = lines[0].replace(/\r$/, '').split(','); const iD = head.indexOf('DatumKey'), iS = head.indexOf('ScenarioKey'), iA = head.indexOf('Aantal'), iO = head.indexOf('Omzet');
    if (iD < 0 || iS < 0 || iA < 0 || iO < 0) return agg;
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].replace(/\r$/, '').split(','); if (c.length < head.length) continue;
      const key = c[iD].slice(0, 4) + '-' + c[iD].slice(4, 6) + '|' + c[iS];
      const a = agg[key] || (agg[key] = { omzet: 0, aantal: 0, rijen: 0 });
      a.omzet += Number(c[iO]) || 0; a.aantal += Number(c[iA]) || 0; a.rijen++;
    }
    return agg;
  }

  // =====================================================================
  // Tab
  // =====================================================================
  H.tabs.register({
    id: 'powerbi', label: 'Power BI', short: 'Power BI', order: 80, icon: 'pbi',
    render(root, ctx) {
      const { model, fmt, h, ui } = ctx;
      const B = bundle(); const files = B.files;
      if (B.empty && !bundleTried) {
        // de projectbundel (ca. 650 KB) wordt pas geladen als dit tabblad geopend wordt
        root.appendChild(h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Power BI'))));
        root.appendChild(h('div', { class: 'note', 'data-busy': 'true' }, 'Power BI-project laden…'));
        ensureBundle(() => { if (H.tabs.current === 'powerbi') H.tabs.rerender(); });
        return;
      }
      const measures = (function () { const m = parseJson(files['measures.json'], []); return Array.isArray(m) ? m.filter(x => x && x.name) : []; })();
      const tablePaths = Object.keys(files).filter(p => p.startsWith(MODEL_DIR + 'tables/') && p.endsWith('.tmdl')).sort();
      const tables = tablePaths.map(p => parseTable(files[p]));
      const rels = parseRelationships(files[MODEL_DIR + 'relationships.tmdl']);
      const expressions = parseExpressions(files[MODEL_DIR + 'expressions.tmdl']);
      const order = queryOrder(files[MODEL_DIR + 'model.tmdl']);
      const csvPaths = Object.keys(files).filter(p => /^data\/[^/]+\.csv$/i.test(p)).sort();
      const csvRows = csvPaths.reduce((s, p) => s + csvRowCount(files[p]), 0);
      const calcGroup = tables.find(t => t.isCalcGroup) || null;
      const factNames = new Set(rels.map(r => r.from));
      const groups = groupMeasures(measures);
      const totalBytes = Object.keys(files).reduce((s, p) => s + bytesOf(files[p]), 0);
      const factSales = parseFactVerkoop(files['data/FactVerkoop.csv']);
      const tableByName = {}; for (const t of tables) tableByName[t.name] = t;
      // rijen die de M-query's wegfilteren omdat ze buiten de datumtabel vallen (per tabel afgeleid uit de partitie en de CSV)
      let excludedRows = 0, dateHi = null;
      for (const t of tables) { const b = dateBounds(t.mSource); if (!b) continue; dateHi = b.hi; excludedRows += csvOutside(files['data/' + t.name + '.csv'], b).rows; }
      // specifiek voor de aansluiting: wat de M-partitie van FactVerkoop wegfiltert (afgeleid uit de partitie en de CSV, nooit uit een jaartal)
      const salesBounds = dateBounds(tableByName.FactVerkoop && tableByName.FactVerkoop.mSource);
      const salesOutside = csvOutside(files['data/FactVerkoop.csv'], salesBounds);
      // parameter CsvMap: standaardwaarde uit expressions.tmdl (bijv. "C:\Helder\powerbi\data\") en de projectmap die daarbij hoort
      const csvMapExpr = expressions.find(e => e.name === 'CsvMap');
      const csvMapDefault = (csvMapExpr && (/^"([^"]*)"/.exec(csvMapExpr.expression) || [])[1]) || 'C:\\Helder\\powerbi\\data\\';
      const projectDir = csvMapDefault.replace(/data\\?$/i, '') || 'C:\\Helder\\powerbi\\';

      // ---------- pagina-kop ----------
      // chips in de paginakop: vast (TMDL, bundeldatum) plus de canonieke scenario-chip 'Forecast: <scenario>', die bij elke statewijziging opnieuw wordt gezet
      const headChips = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } });
      const drawHeadChips = () => {
        H.clear(headChips);
        headChips.appendChild(ui.chip('TMDL · compatibilityLevel 1604', 'accent'));
        if (B.generatedAt) headChips.appendChild(ui.chip('bundel ' + fmt.date(B.generatedAt), null));
        headChips.appendChild(ui.scenarioChip());
      };
      drawHeadChips();
      root.appendChild(h('div', { class: 'page-head' },
        h('div', null, h('h1', null, 'Power BI'),
          h('p', null, 'Hetzelfde model, maar dan als Power BI-project (PBIP): een semantisch model in TMDL met een sterschema, ' + (measures.length ? fmt.int(measures.length) + ' DAX-maten' : 'DAX-maten') + ' en een calculation group voor tijdintelligentie. Download het project en open het in Power BI Desktop; de ZIP wordt in uw browser samengesteld, er gaat niets over het netwerk.')),
        headChips));

      if (B.empty) root.appendChild(ui.note('De projectbundel (cockpit/data/pbip.js) is leeg: voer node scripts/build-pbip-bundle.mjs uit om het Power BI-project in te sluiten. Downloads zijn tot die tijd uitgeschakeld.', 'warning'));

      // ---------- feitenrij ----------
      const dimCount = tables.filter(t => !factNames.has(t.name) && !t.isCalcGroup && t.name !== '_Maten').length;
      const facts = h('div', { class: 'kpi-row' },
        ui.kpi({ label: 'Tabellen', value: B.empty ? '–' : fmt.int(tables.length), hint: B.empty ? 'geen bundel' : fmt.int(factNames.size) + ' feiten · ' + fmt.int(dimCount) + ' dimensies · maattabel · calculation group' }),
        ui.kpi({ label: 'DAX-maten', value: B.empty ? '–' : fmt.int(measures.length), hint: B.empty ? 'geen bundel' : fmt.int(groups.length) + ' weergavemappen in _Maten' }),
        ui.kpi({ label: 'Relaties', value: B.empty ? '–' : fmt.int(rels.length), hint: B.empty ? 'geen bundel' : relSummary(rels, fmt).replace(' vanuit de dimensie naar het feit', '') }),
        ui.kpi({ label: 'CSV-rijen', value: B.empty ? '–' : fmt.int(csvRows), hint: B.empty ? 'geen bundel' : fmt.int(csvPaths.length) + ' bestanden in data/' }),
        ui.kpi({ label: 'Calculation items', value: B.empty || !calcGroup ? '–' : fmt.int(calcGroup.calcItems.length), hint: calcGroup ? 'kolom Tijdberekening' : 'geen calculation group' }),
        ui.kpi({ label: 'Projectbestanden', value: B.empty ? '–' : fmt.int(Object.keys(files).length), hint: B.empty ? 'geen bundel' : sizeLabel(fmt, totalBytes) + ' tekst, ongecomprimeerd' }));
      root.appendChild(facts);

      // ---------- downloads ----------
      const grid1 = h('div', { class: 'grid' }); root.appendChild(grid1);
      const status = h('div', { class: 'small muted', id: 'pbi-dl-status', 'aria-live': 'polite' });
      const unavailable = h('div', { id: 'pbi-dl-unavailable' });
      const setStatus = (text, tone) => { H.clear(status); status.className = 'small ' + (tone === 'critical' ? 'ink-2' : 'muted'); if (text) status.appendChild(document.createTextNode(text)); };
      const zipOk = !!(window.HZip && typeof window.HZip.build === 'function');
      const canDownload = !B.empty && zipOk;
      const buttons = [];
      let busy = false;
      async function offer(btn, filename, make) {
        if (busy) return; busy = true;
        for (const b of buttons) b.disabled = true;
        try {
          setStatus('Bezig met samenstellen van ' + filename + ' …');
          await new Promise(resolve => H.caps.onReady(resolve));
          const data = make();
          const size = data instanceof Blob ? data.size : bytesOf(String(data));
          const sizeTxt = ' (' + sizeLabel(fmt, size) + ', samengesteld in de browser)';
          // downloads-contract: save() lost op met {status:'saved'|'delivered'} en verwerpt met {code}; een gewone browser kan niet zien of de gebruiker het dialoogvenster annuleert
          const res = await H.download(filename, data);
          if (res && res.status === 'delivered') setStatus('Doorgegeven: ' + filename + sizeTxt + '.');
          else if (!H.caps.isArtifact) setStatus('Aangeboden als download: ' + filename + sizeTxt + '.');
          else setStatus('Opgeslagen: ' + filename + sizeTxt + '.');
        } catch (e) {
          const code = e && e.code;
          if (code === 'declined') { setStatus(''); }
          else if (code === 'rejected_extension' || code === 'extension_not_enabled') { setStatus('Dit bestandstype is in deze weergave niet toegestaan; gebruik de map powerbi/ in de repository.', 'critical'); }
          else if (code === 'rate_limited') { setStatus('Er staat nog een bevestiging open; probeer het zo opnieuw.', 'critical'); }
          else if (code === 'too_large') { setStatus('Het bestand is te groot voor deze weergave; gebruik de map powerbi/ in de repository.', 'critical'); }
          else if (code === 'unavailable' || code === 'not_granted' || code === 'capability_disabled' || code === 'capability_removed') { setStatus(''); H.clear(unavailable); unavailable.appendChild(ui.note('Downloads zijn in deze weergave niet beschikbaar. Open de cockpit als gewone webpagina (cockpit/index.html) of gebruik de map powerbi/ in de repository.', 'warning')); }
          else { setStatus('Download mislukt: ' + (e && e.message ? e.message : 'onbekende fout') + '.', 'critical'); }
        } finally { busy = false; for (const b of buttons) b.disabled = !canDownload; }
      }
      const mkBtn = (label, id, filename, make, opts) => {
        const btn = ui.button(label, () => offer(btn, filename, make), Object.assign({ icon: 'download', id, disabled: !canDownload, title: canDownload ? filename : (B.empty ? 'De projectbundel is leeg' : 'ZIP-schrijver niet geladen') }, opts || {}));
        buttons.push(btn); return btn;
      };
      const projectEntries = () => Object.keys(files).sort().map(p => ({ path: p, content: files[p] }));
      const csvEntries = () => csvPaths.map(p => ({ path: p.replace(/^data\//, ''), content: files[p] }));
      const btnRow = h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        mkBtn('Download Power BI-project (.zip)', 'pbi-dl-project', 'Helder-PowerBI-project.zip', () => window.HZip.build(projectEntries()), { primary: true }),
        mkBtn('Download CSV-pakket (.zip)', 'pbi-dl-csv', 'Helder-CSV-data.zip', () => window.HZip.build(csvEntries())),
        mkBtn('Download DAX-maten (.md)', 'pbi-dl-dax', 'Helder-DAX-maten.md', () => new Blob([daxMarkdown(measures, calcGroup, fmt)], { type: 'text/markdown;charset=utf-8' })),
        mkBtn('Download Power Query (M)', 'pbi-dl-m', 'Helder-PowerQuery-M.txt', () => new Blob([powerQueryText(tables, expressions, order)], { type: 'text/plain;charset=utf-8' })));
      const dlExplain = B.empty ? ui.note('De knoppen zijn uitgeschakeld omdat HELDER_PBIP.files leeg is.', 'warning') : !zipOk ? ui.note('De knoppen zijn uitgeschakeld omdat de ZIP-schrijver (app/zip.js) niet geladen is.', 'warning') : null;
      const inside = h('ul', { class: 'small', style: { margin: 0, paddingLeft: '18px', color: 'var(--ink-2)', display: 'flex', flexDirection: 'column', gap: '3px' } },
        h('li', null, h('strong', null, 'Helder.pbip'), ' + ', h('strong', null, 'Helder.SemanticModel/'), ' (TMDL: ' + fmt.int(tablePaths.length) + ' tabellen, relaties, cultuur nl-NL, parameter CsvMap) + ', h('strong', null, 'Helder.Report/'), ' (drie minimale pagina\'s)'),
        h('li', null, h('strong', null, 'data/'), ' — ' + fmt.int(csvPaths.length) + ' CSV-bestanden, ' + fmt.int(csvRows) + ' rijen (UTF-8, komma, punt als decimaalteken)'),
        h('li', null, h('strong', null, 'build-tmdl.mjs, measures-def.mjs, validate.mjs, lineage.json'), ' — het project wordt uit de CSV-koppen gebouwd en structureel gevalideerd; herbouwen geeft geen diff'),
        h('li', null, h('strong', null, 'README.md'), ' — openen, sterschema, maatcatalogus, conventies en beperkingen'));
      grid1.appendChild(ui.card({ span: 8, title: 'Downloaden', subtitle: 'ZIP\'s worden in de browser samengesteld (STORE, CRC-32); er wordt niets opgehaald of verstuurd', body: [btnRow, dlExplain, status, unavailable], footer: 'Het project opent in Power BI Desktop; de CSV\'s en de DAX-catalogus zijn ook los te gebruiken (Excel, Fabric, Tabular Editor).' }));
      grid1.appendChild(ui.card({ span: 4, title: 'Wat zit er in het project', subtitle: fmt.int(Object.keys(files).length) + ' tekstbestanden, ' + sizeLabel(fmt, totalBytes), body: inside }));

      // ---------- aansluiting met de cockpit (dynamisch: volgt korrel, periode en scenario) ----------
      const recon = h('div', { class: 'span-12', style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' } });
      grid1.appendChild(recon);
      const draw = c => { drawHeadChips(); H.clear(recon); buildRecon(recon, c); };
      draw(ctx); ctx.subscribe(draw);
      function buildRecon(el, c) {
        const state = c.state; const sc = model.scenarios[state.scenarioKey] || model.scenarios.basis;
        const custom = Object.keys(state.overrides || {}).length > 0;
        const isBasis = state.scenarioKey === 'basis' && !custom;
        const hasCsv = Object.keys(factSales).length > 0;
        const ser = model.series(state.grain);
        const rows = ser.map(p => {
          const months = Array.isArray(p.months) ? p.months : [p]; // korrel M: het periodeobject is de maand zelf
          let omzet = 0, aantal = 0, missing = 0;
          for (const m of months) { const a = factSales[m.period + '|' + (m.isActual ? 1 : 3)]; if (!a) { missing++; continue; } omzet += a.omzet; aantal += a.aantal; }
          const mixed = !p.isActual && months.some(m => m.isActual); // actual én forecast in één periode → '2026*'
          // partial (engine): de periode valt maar voor een deel in het gekozen bereik → '(n mnd)'; n = maanden van de periode in het bereik
          return { key: p.key, label: fmt.period(p.key, state.grain), isActual: p.isActual, mixed, partial: !!p.partial, revC: p.pl.revenue, revP: omzet, diff: omzet - p.pl.revenue, n: months.length, unitsC: p.kpi.units, unitsP: aantal, missing };
        });
        // afrondingsmarge: de CSV's slaan 27 cellen per maand op in centen (hooguit € 0,135 per maand); marge € 0,50 per maand in de periode
        const tolOf = r => 0.5 * r.n;
        const outside = r => Math.abs(r.diff) > tolOf(r);
        const flagged = r => outside(r) && (r.isActual || isBasis); // buiten de marge én niet verklaarbaar door een ander scenario → slecht
        const actualRows = rows.filter(r => r.isActual), fcRows = rows.filter(r => !r.isActual);
        const maxDiffActual = actualRows.reduce((s, r) => Math.max(s, Math.abs(r.diff)), 0);
        const maxDiffAll = rows.reduce((s, r) => Math.max(s, Math.abs(r.diff)), 0);
        const actualsClose = !actualRows.some(outside), allClose = !rows.some(outside);
        const full = v => fmt.eur(v, { full: true });
        const cents = v => '€ ' + fmt.num(Math.abs(v), 2);
        const absText = v => Math.abs(v) < 1 ? cents(v) : full(Math.abs(v));
        const diffText = v => Math.abs(v) < 0.005 ? '€ 0,00' : fmt.signed(v, Math.abs(v) < 1 ? cents : full);
        const body = [];
        if (!hasCsv) body.push(ui.note('FactVerkoop.csv ontbreekt in de bundel; de aansluiting kan niet worden berekend.', 'warning'));
        else {
          const chips = [];
          if (isBasis) chips.push(ui.statusChip(allClose, 'sluit (afronding op centen)', 'wijkt af'));
          else { if (actualRows.length) chips.push(ui.statusChip(actualsClose, 'actuals sluiten', 'actuals wijken af')); if (fcRows.length) chips.push(ui.chip('forecast wijkt bewust af', 'forecast', 'info')); }
          const scrolls = rows.length > 16; // lange tabellen (bijv. 84 maanden) krijgen een vaste hoogte, zoals de kwartaaltoets op Balans
          body.push(h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' } }, chips,
            h('span', { class: 'small muted' }, 'grootste verschil ' + absText(maxDiffAll) + ' over ' + fmt.int(rows.length) + ' periodes' + (scrolls ? ', scrol voor alle rijen' : ''))));
          body.push(h('div', { class: 'small ink-2' }, isBasis
            ? 'Omzet en aantallen per ' + { M: 'maand', Q: 'kwartaal', Y: 'jaar' }[state.grain] + ' uit FactVerkoop.csv (scenario Actual t/m ' + fmt.monthLong(model.lastActualPeriod) + ', daarna Forecast) tegenover de berekening van het engine in deze cockpit (scenario Basis). Beide komen uit één generator; het verschil is hooguit afronding op centen.'
            : 'De CSV\'s bevatten de forecast van het basisscenario. In deze cockpit staat scenario ' + sc.label + (custom ? ' met aangepaste drivers' : '') + ': ' + (actualRows.length ? 'de gerealiseerde maanden sluiten (grootste verschil ' + absText(maxDiffActual) + ')' : 'in de gekozen periode staan geen gerealiseerde maanden') + (fcRows.length ? (actualRows.length ? ', ' : '; ') + 'de forecastperiodes wijken bewust af.' : '.')));
          // periodelabel volgens de canon: '2026*' = deels forecast, 'Q4 2026 F' = forecast als gedempte tekst (geen chip per rij), '2026 F (3 mnd)' = deel van de periode in het bereik
          const partialTxt = r => r.partial ? ' (' + fmt.int(r.n) + ' mnd)' : '';
          const periodCell = (v, r) => r.isActual ? v + partialTxt(r) : r.mixed ? v + '*' + partialTxt(r) : h('span', null, v, h('span', { class: 'forecast muted' }, ' F'), partialTxt(r));
          const tbl = ui.table({
            columns: [
              { key: 'label', label: 'Periode', format: periodCell },
              { key: 'diff', label: 'Verschil', align: 'num', format: (v, r) => flagged(r) ? h('span', { style: { color: 'var(--critical-ink)' }, title: 'buiten de afrondingsmarge van ' + cents(tolOf(r)) }, diffText(v)) : diffText(v) },
              { key: 'revC', label: 'Omzet cockpit', align: 'num', format: full },
              { key: 'revP', label: 'Omzet CSV', align: 'num', format: full },
              { key: 'unitsC', label: 'Eenheden cockpit', align: 'num', format: fmt.int },
              { key: 'unitsP', label: 'Eenheden CSV', align: 'num', format: fmt.int }
            ],
            rows, rowClass: r => r.isActual ? '' : 'forecast', maxHeight: scrolls ? 420 : null
          });
          body.push(tbl);
          // legendazin letterlijk zoals overal in de cockpit, alleen de delen die voorkomen
          const legend = [rows.some(r => r.mixed) ? '* = deels forecast' : null, rows.some(r => !r.isActual && !r.mixed) ? 'F = forecast' : null, rows.some(r => r.partial) ? '(n mnd) = deel van de periode in het bereik' : null].filter(Boolean).join(' · ');
          if (legend) body.push(h('div', { class: 'small muted' }, legend));
          if (salesOutside.rows) body.push(h('div', { class: 'small muted' }, fmt.int(salesOutside.months) + ' maanden (' + fmt.int(salesOutside.rows) + ' rijen) in FactVerkoop.csv vallen buiten de datumtabel van het model (DimDatum loopt t/m ' + fmt.date(keyToIso(salesBounds.hi)) + ') en worden door de M-query\'s weggefilterd.'));
        }
        el.appendChild(ui.card({ title: 'Aansluiting met de cockpit', subtitle: 'FactVerkoop.csv tegenover het engine, volgens de filters hierboven', body, footer: 'Omzet per productlijn, kanaal en land in de CSV\'s is afgerond op centen; de cockpit rekent met volledige precisie. Verschil = CSV − cockpit; rood alleen als een periode buiten de afrondingsmarge valt zonder dat een ander scenario dat verklaart.' }));
      }

      // ---------- sterschema ----------
      const grid2 = h('div', { class: 'grid' }); root.appendChild(grid2);
      const roleOf = t => t.isCalcGroup ? 'calc' : t.name === '_Maten' ? 'measures' : factNames.has(t.name) ? 'fact' : 'dim';
      const ordered = tables.slice().sort((a, b) => { const r = { fact: 0, dim: 1, measures: 2, calc: 3 }; return r[roleOf(a)] - r[roleOf(b)] || a.name.localeCompare(b.name); });
      // op een telefoon (≤ 640 px) staan de kolommen per entiteit en de relatielijst in een gesloten <details>: de kop met naam en aantal
      // blijft zichtbaar, het detail (17 entiteiten × alle kolommen, 19 relaties) niet; op desktop is de weergave ongewijzigd
      const compact = !!(window.matchMedia && window.matchMedia('(max-width: 640px)').matches);
      /** <details> met expliciete chevron: een summary met display:flex verliest in Chromium/Safari het native driehoekje */
      const foldable = (summaryChildren, bodyEl, opts) => {
        const chev = h('span', { class: 'muted', style: { display: 'inline-flex', flex: 'none', marginLeft: 'auto' }, 'aria-hidden': 'true' }, H.icon('down', 14));
        const det = h('details', { class: opts && opts.class, onToggle: () => { H.clear(chev); chev.appendChild(H.icon(det.open ? 'up' : 'down', 14)); } },
          h('summary', { class: opts && opts.summaryClass, title: opts && opts.title, style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', listStyle: 'none' } }, summaryChildren, chev), bodyEl);
        return det;
      };
      const schema = h('div', { class: 'schema' });
      for (const t of ordered) {
        const role = roleOf(t);
        const roleTxt = role === 'fact' ? 'feit' : role === 'dim' ? 'dimensie' : role === 'measures' ? 'maattabel' : 'calculation group';
        const head = h('div', { class: 'ent-head', title: t.description || t.name }, t.name, h('span', { class: 'muted', style: { fontWeight: 400, marginLeft: '6px', fontSize: '11px' } }, roleTxt));
        const ul = h('ul');
        if (role === 'calc') { for (const it of t.calcItems) ul.appendChild(h('li', null, it.name)); for (const col of t.columns.filter(cl => !cl.hidden)) ul.appendChild(h('li', { class: 'muted' }, col.name + ' (kolom)')); }
        else if (role === 'measures') { ul.appendChild(h('li', null, fmt.int(t.measures) + ' maten in ' + fmt.int(groups.length) + ' mappen')); for (const col of t.columns) ul.appendChild(h('li', { class: 'muted' }, col.name + ' (verborgen)')); }
        else {
          for (const col of t.columns) {
            // sleutelmarkering uitsluitend uit de TMDL: isKey, of een kolom aan een van beide kanten van een relatie
            const isKey = col.key || rels.some(r => (r.from === t.name && r.fromCol === col.name) || (r.to === t.name && r.toCol === col.name));
            ul.appendChild(h('li', { class: col.hidden && !isKey ? 'muted' : '', title: col.description || col.name }, isKey ? keyIcon() : null, col.name + (col.calculated ? ' ƒ' : ''), h('span', { class: 'muted' }, col.dataType ? ' ' + col.dataType : '')));
          }
          if (t.hierarchy) ul.appendChild(h('li', { class: 'muted' }, 'hiërarchie ' + t.hierarchy));
        }
        if (compact) {
          const nItems = ul.children.length;
          schema.appendChild(foldable([h('span', { style: { minWidth: 0, overflowWrap: 'anywhere' } }, t.name), h('span', { class: 'muted', style: { fontWeight: 400, fontSize: '11px', flex: 'none' } }, roleTxt + ' · ' + fmt.int(nItems))], ul, { class: 'ent' + (role === 'fact' ? ' fact' : ''), summaryClass: 'ent-head', title: t.description || t.name }));
        } else schema.appendChild(h('div', { class: 'ent' + (role === 'fact' ? ' fact' : '') }, head, ul));
      }
      const schemaBody = B.empty ? [ui.note('Geen tabellen gevonden in de bundel.', 'warning')] : [schema, h('div', { class: 'small muted' }, keyIcon(), '= sleutel (isKey) of relatiekolom · ƒ = berekende kolom · grijs = verborgen in het model · feiten op de eerste dag van de maand, DatumKey als yyyymmdd')];
      grid2.appendChild(ui.card({ span: 8, title: 'Sterschema', subtitle: fmt.int(factNames.size) + ' feittabellen rond ' + fmt.int(dimCount) + ' dimensies; gelezen uit de TMDL-bestanden', body: schemaBody }));
      const relByFact = {}; for (const r of rels) (relByFact[r.from] = relByFact[r.from] || []).push(r);
      const relList = h('div', { class: 'list' }, Object.keys(relByFact).map(f => h('div', { class: 'list-item' },
        h('span', { class: 'chip accent' }, fmt.int(relByFact[f].length)),
        h('div', { style: { minWidth: 0 } }, h('div', { class: 'title' }, f),
          h('div', { class: 'desc', style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, relByFact[f].map(r => h('div', { style: { overflowWrap: 'anywhere' } }, h('code', { class: 'mono' }, r.fromCol), ' → ', h('code', { class: 'mono' }, r.to + '[' + r.toCol + ']'), r.active ? null : h('span', { class: 'muted' }, ' (inactief)'), r.crossFilter === 'bothDirections' ? h('span', { class: 'muted' }, ' (beide richtingen)') : null)))))));
      // sleuteltypen uit de TMDL van de feittabel: welke relaties lopen op een tekstkolom, en welke typen komen verder voor
      const keyType = r => { const t = tableByName[r.from]; const c = t && t.columns.find(cl => cl.name === r.fromCol); return c && c.dataType ? c.dataType : 'onbekend'; };
      const textRels = rels.filter(r => keyType(r) === 'string');
      const otherTypes = Array.from(new Set(rels.filter(r => keyType(r) !== 'string').map(keyType)));
      const hasDatumKey = rels.some(r => r.fromCol === 'DatumKey');
      const relFoot = !rels.length ? null
        : (textRels.length ? (textRels.length === 1 ? 'Alleen ' + textRels[0].from + ' → ' + textRels[0].to + ' loopt op de tekstkolom ' + textRels[0].fromCol : textRels.map(r => r.from + ' → ' + r.to).join(', ') + ' lopen op een tekstkolom') + (otherTypes.length ? '; alle andere sleutels zijn ' + otherTypes.join('/') : '') : 'Alle sleutels zijn ' + otherTypes.join('/')) + (hasDatumKey ? ' (DatumKey als yyyymmdd).' : '.');
      const relBody = !rels.length ? ui.note('Geen relaties gevonden.', 'warning') : compact ? foldable([h('span', { style: { fontWeight: 600 } }, 'Toon de ' + fmt.int(rels.length) + ' relaties per feittabel')], relList, { summaryClass: 'small' }) : relList;
      grid2.appendChild(ui.card({ span: 4, title: 'Relaties', subtitle: fmt.int(rels.length) + ' relaties, ' + relSummary(rels, fmt), body: relBody, footer: relFoot }));

      // ---------- DAX-maten ----------
      const grid3 = h('div', { class: 'grid' }); root.appendChild(grid3);
      const list = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } });
      const countEl = h('div', { class: 'small muted', 'aria-live': 'polite' });
      const openState = {}; for (const g of groups) openState[g.name] = false; if (groups.length) openState[groups[0].name] = true;
      let filterText = '';
      const FORMAT_LABELS = { '"€ "#,0;"€ "-#,0;"€ "0': 'euro', '#,0': 'getal', '#,0.00': 'getal (0,00)', '#,0.0': 'getal (0,0)', '0.0%': 'percentage', '0.00': 'ratio (0,00)', '0.0': 'ratio (0,0)', '0': 'geheel getal' };
      /** rij voor een maat of calculation item: {name, description, dax, formatString (vaste notatie) | formatDef (DAX-expressie voor de notatie)} */
      function measureRow(m) {
        const dax = String(m.dax || '');
        const fmtLabel = m.formatString ? (FORMAT_LABELS[m.formatString] || m.formatString) : null;
        const btn = ui.button('Kopieer', async () => {
          const ok = await H.copyText(m.name + ' = ' + dax);
          btn.lastChild.textContent = ok ? 'Gekopieerd' : 'Kopiëren mislukt';
          setTimeout(() => { btn.lastChild.textContent = 'Kopieer'; }, 1600);
        }, { sm: true, ghost: true, icon: 'copy', title: 'Kopieer de DAX van ' + m.name });
        return h('div', { class: 'measure' },
          h('div', { style: { minWidth: 0 } },
            h('div', { class: 'm-name' }, m.name, fmtLabel ? h('span', { class: 'muted small', style: { fontWeight: 400, marginLeft: '8px' }, title: 'formatString: ' + m.formatString }, 'notatie ' + fmtLabel) : null),
            m.description ? h('div', { class: 'm-desc' }, m.description) : null,
            h('div', { class: 'm-dax' }, dax),
            m.formatDef ? h('div', { class: 'm-dax', style: { color: 'var(--muted)' }, title: 'formatStringDefinition' }, 'Notatie = ' + m.formatDef) : null),
          btn);
      }
      const allOpen = () => groups.every(g => openState[g.name]);
      const syncExpandBtn = () => { if (!expandBtn) return; expandBtn.lastChild.textContent = allOpen() ? 'Alles inklappen' : 'Alles uitvouwen'; expandBtn.disabled = !!filterText.trim(); };
      function renderList() {
        H.clear(list);
        const q = filterText.trim().toLowerCase();
        let shown = 0;
        for (const g of groups) {
          const items = q ? g.items.filter(m => (m.name + ' ' + (m.description || '') + ' ' + (m.dax || '') + ' ' + g.name).toLowerCase().includes(q)) : g.items;
          if (!items.length) continue;
          shown += items.length;
          const open = q ? true : !!openState[g.name];
          // expliciete chevron: een summary met display:flex verliest in Chromium/Safari het native driehoekje
          const chev = h('span', { class: 'muted', style: { display: 'inline-flex', flex: 'none' }, 'aria-hidden': 'true' }, H.icon(open ? 'up' : 'down', 14));
          const det = h('details', { open, onToggle: () => { H.clear(chev); chev.appendChild(H.icon(det.open ? 'up' : 'down', 14)); if (!q) { openState[g.name] = det.open; syncExpandBtn(); } } },
            h('summary', { style: { cursor: 'pointer', padding: '8px 0', fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' } },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', minWidth: 0 } }, chev, g.name),
              h('span', { class: 'muted', style: { fontWeight: 400, flex: 'none' } }, fmt.int(items.length) + (q ? ' van ' + fmt.int(g.items.length) : '') + ' maten')),
            h('div', null, items.map(measureRow)));
          list.appendChild(det);
        }
        if (!shown) list.appendChild(ui.note('Geen maat gevonden voor "' + filterText.trim() + '".'));
        H.clear(countEl); countEl.appendChild(document.createTextNode(q ? fmt.int(shown) + ' van ' + fmt.int(measures.length) + ' maten' : fmt.int(measures.length) + ' maten in ' + fmt.int(groups.length) + ' weergavemappen · klik op een map om hem uit te vouwen'));
        syncExpandBtn();
      }
      const filterInput = h('input', { class: 'input', id: 'pbi-filter', type: 'search', placeholder: 'bijv. LTM, DIVIDE of budget', autocomplete: 'off', onInput: e => { filterText = e.target.value; renderList(); } });
      const filterField = h('div', { class: 'field', style: { flex: '1 1 220px', maxWidth: '360px' } }, h('label', { for: 'pbi-filter' }, 'Zoek in naam, beschrijving of DAX'), filterInput);
      const expandBtn = ui.button('Alles uitvouwen', () => { const next = !allOpen(); for (const g of groups) openState[g.name] = next; renderList(); }, { sm: true, ghost: true, id: 'pbi-expand' });
      renderList();
      const daxBody = measures.length ? [h('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' } }, filterField, expandBtn), countEl, list] : [ui.note('measures.json ontbreekt in de bundel.', 'warning')];
      grid3.appendChild(ui.card({ span: 8, title: 'DAX-maten', subtitle: 'alle maten uit _Maten, gegroepeerd per weergavemap; kopieer de DAX met één klik', body: daxBody, footer: 'Basismaten volgen het scenariofilter: zet in een rapport altijd een slicer op DimScenario[Scenario] of gebruik de expliciete varianten (Omzet Actual, EBITDA Budget, …).' }));
      const side = h('div', { class: 'span-4', style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' } }); grid3.appendChild(side);
      if (calcGroup) {
        const ciRows = h('div', null, calcGroup.calcItems.map(it => measureRow({ name: it.name, description: it.description || '', dax: it.dax, formatString: null, formatDef: it.formatString })));
        side.appendChild(ui.card({ title: 'Calculation group ' + calcGroup.name, subtitle: 'kolom Tijdberekening · zet hem in een slicer of op de kolommen van een matrix', body: [ciRows, h('div', { class: 'small muted' }, 'De verschil-items houden via SELECTEDMEASUREFORMATSTRING() de notatie van de maat en laten tekstmaten (Covenantstatus, Gebeurtenis) ongemoeid; het model heeft discourageImplicitMeasures aan.')] }));
      }
      const conv = h('div', { class: 'list' },
        [['Basismaten volgen het scenariofilter', 'Zonder slicer op DimScenario tellen [Omzet] en [EBITDA] Actual, Budget en Forecast op. De A+F-maten geven een doorlopende reeks: Actual t/m de laatste gerealiseerde maand, daarna Forecast.'],
          ['Kosten positief, resultaten met teken', '[W&V bedrag] past DimRekening[Teken] toe via SUMX over VALUES(Teken) — twee storage-engine-scans, geen rij-voor-rij RELATED — en telt op tot de nettowinst.'],
          ['Balans = stand op de laatste maand', 'Geen optelling over maanden: VAR LaatsteKey = MAX(FactBalans[DatumKey]). [Balanscontrole] moet nul zijn.'],
          ['LTM verankerd op de laatste maand mét data', 'EOMONTH(LOOKUPVALUE(…)) en DATESINPERIOD(−12 maanden) op de A+F-reeks, zodat [Netto schuld] en [LTM EBITDA] dezelfde maand delen bij elk filter.']
        ].map(([t, d]) => h('div', { class: 'list-item' }, h('span', { class: 'chip accent' }, H.icon('info', 12)), h('div', null, h('div', { class: 'title' }, t), h('div', { class: 'desc' }, d)))));
      side.appendChild(ui.card({ title: 'Conventies', subtitle: 'wat een Power BI-ontwikkelaar moet weten', body: conv }));

      // ---------- zo opent u het + code ----------
      const grid4 = h('div', { class: 'grid' }); root.appendChild(grid4);
      const steps = h('ol', { style: { margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('li', null, 'Pak ', h('strong', null, 'Helder-PowerBI-project.zip'), ' uit op een vaste plek, bijvoorbeeld in ', h('code', { class: 'mono' }, projectDir), '. De ZIP heeft geen bovenliggende map: de bestanden (Helder.pbip, Helder.SemanticModel/, data/) staan direct in de map waarin u uitpakt.'),
        h('li', null, 'Open ', h('strong', null, 'Helder.pbip'), ' in Power BI Desktop van oktober 2024 of nieuwer. Staat het Power BI-projectformaat (PBIP) in uw versie nog onder Bestand › Opties › Preview-functies, schakel het dan eerst in.'),
        h('li', null, 'Staat het project in ', h('code', { class: 'mono' }, projectDir), ', dan klopt de standaardwaarde van de parameter ', h('strong', null, 'CsvMap'), ' al (', h('code', { class: 'mono' }, csvMapDefault), '). Anders: Start › Gegevens transformeren › Parameters bewerken en vul het volledige pad van de map data in, bijvoorbeeld ', h('code', { class: 'mono' }, 'D:\\Projecten\\Helder\\data\\'), ' (eindig op een backslash; een relatief pad vindt Power BI Desktop niet).'),
        h('li', null, 'Klik op ', h('strong', null, 'Vernieuwen'), ': ' + fmt.int(csvPaths.length) + ' CSV-bestanden met ' + fmt.int(csvRows) + ' rijen worden gelezen' + (excludedRows ? '; ' + fmt.int(excludedRows) + ' rijen vallen buiten de datumtabel (DimDatum loopt t/m ' + fmt.date(keyToIso(dateHi)) + ') en worden door de M-query\'s weggefilterd, ' + fmt.int(csvRows - excludedRows) + ' rijen komen in het model' : '') + ' (UTF-8, komma, punt als decimaalteken; de M-query\'s typeren met cultuur en-US).'));
      const stepNotes = [
        ui.note('De drie rapportpagina\'s (Overzicht, Winst & verlies, Balans) zijn bewust minimaal; het semantische model met de maten, de relaties en de calculation group is het eigenlijke deliverable. Bouw er uw eigen rapport op.', 'accent'),
        h('div', { class: 'small ink-2' }, 'Dezelfde cijfers als in deze cockpit: de CSV\'s en cockpit/data/dataset.js komen uit één generator (generator/generate.mjs), het engine in de browser en de DAX-maten rekenen op dezelfde feiten. Zie de aansluiting bovenaan.')
      ];
      grid4.appendChild(ui.card({ span: 4, title: 'Zo opent u het', subtitle: 'vier stappen in Power BI Desktop', body: [steps, ...stepNotes] }));
      const matenText = files[MODEL_DIR + 'tables/_Maten.tmdl'];
      const measureBlock = extractBlock(matenText, /^\tmeasure 'LTM EBITDA'/) || extractBlock(matenText, /^\tmeasure /);
      const verkoopText = files[MODEL_DIR + 'tables/FactVerkoop.tmdl'];
      const partitionBlock = extractBlock(verkoopText, /^\tpartition FactVerkoop\b/);
      const codeBody = [];
      // .code.wrap (index.html) laat lange regels afbreken zodat niets wordt afgesneden; geen tabindex: de box scrolt niet, dus een focusstop zou doelloos zijn
      const codeBox = text => h('div', { class: 'code wrap' }, text);
      if (measureBlock) codeBody.push(h('div', { class: 'eyebrow' }, 'Representatieve maat (_Maten.tmdl)'), codeBox(measureBlock));
      if (partitionBlock) codeBody.push(h('div', { class: 'eyebrow' }, 'Power Query-partitie (FactVerkoop.tmdl)'), codeBox(partitionBlock));
      if (!codeBody.length) codeBody.push(ui.note('De TMDL-bestanden ontbreken in de bundel.', 'warning'));
      grid4.appendChild(ui.card({ span: 8, title: 'Een blik in de TMDL', subtitle: 'letterlijk uit de projectbestanden: een LTM-maat met VAR/RETURN en de M-partitie van FactVerkoop', body: codeBody, footer: 'LTM-maten annualiseren bij minder dan twaalf beschikbare maanden (begin 2023), precies zoals FactKPI en het engine in deze cockpit.' }));

      root.appendChild(h('div', { class: 'small muted' }, 'Helder E-Bikes B.V. is fictief; het Power BI-project is gebouwd en structureel gevalideerd (validate.mjs) zonder Power BI Desktop. Opent een visual met een waarschuwing, verwijder hem dan en sleep de maten opnieuw in.'));
    }
  });
})();
