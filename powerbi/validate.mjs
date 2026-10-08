/*
 * Valideert het Power BI-project in powerbi/ zonder Power BI Desktop:
 *   node powerbi/validate.mjs
 *
 * Controles: TMDL-structuur (tab-inspringing, blokken), unieke lineageTag-GUID's, relaties naar bestaande
 * kolommen met gelijk datatype, sourceColumn en M-typeringen exact gelijk aan de CSV-koppen, DAX-verwijzingen
 * naar bestaande tabellen/kolommen/maten, report.json en de overige JSON-bestanden.
 * Exitcode 1 bij fouten.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, 'data');
const DEF = join(__dirname, 'Helder.SemanticModel', 'definition');
const REPORT = join(__dirname, 'Helder.Report');
const errors = [];
const stats = {};
const err = (file, msg) => errors.push(`${file}: ${msg}`);

// ---------- CSV-koppen ----------
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
const csvHeaders = {};
const csvValues = {};   // tabel → kolom → Set van alle waarden (als tekst), voor letterlijke waarden in DAX en referentiële integriteit
for (const f of readdirSync(DATA).filter(f => f.endsWith('.csv'))) {
  const name = f.replace(/\.csv$/, '');
  const lines = readFileSync(join(DATA, f), 'utf8').split(/\r?\n/).filter(l => l.length > 0);
  const header = parseCsvLine(lines[0]);
  csvHeaders[name] = header;
  csvValues[name] = Object.fromEntries(header.map(h => [h, new Set()]));
  for (const line of lines.slice(1)) { const row = parseCsvLine(line); header.forEach((h, i) => csvValues[name][h].add(row[i] ?? '')); }
}

// ---------- TMDL-parser (structureel) ----------
const DECL = new Set(['database', 'model', 'table', 'column', 'measure', 'partition', 'relationship', 'expression', 'cultureInfo',
  'calculationGroup', 'calculationItem', 'ref', 'dataAccessOptions', 'linguisticMetadata', 'source', 'hierarchy', 'level', 'annotation', 'formatStringDefinition']);
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function unquote(name) { return name.startsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name; }

function parseTmdl(file) {
  const text = readFileSync(file, 'utf8');
  const name = basename(file);
  const lines = text.split('\n');
  const objects = []; // { kind, name, level, props: {}, expr: [], line }
  const stack = [];   // per niveau: het laatst gedeclareerde object
  let exprLevel = null; let exprTarget = null;
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\r$/, '');
    const n = idx + 1;
    if (line.trim() === '') return;
    const tabs = line.match(/^\t*/)[0].length;
    const rest = line.slice(tabs);
    if (exprLevel !== null) {
      if (tabs >= exprLevel) { exprTarget.expr.push(rest); return; }
      exprLevel = null; exprTarget = null;
    }
    if (/^\s/.test(rest)) { err(name, `regel ${n}: spaties als inspringing buiten een expressie`); return; }
    if (rest.startsWith('///')) return; // beschrijving
    if (tabs > stack.length) { err(name, `regel ${n}: inspringing springt van ${stack.length} naar ${tabs}`); return; }
    const parent = tabs > 0 ? stack[tabs - 1] : null;
    const BARE_DECL = new Set(['calculationGroup', 'dataAccessOptions', 'database']);
    const prop = rest.match(/^([A-Za-z_]\w*)(?::\s*(.*))?$/);
    if (prop && !(prop[2] === undefined && BARE_DECL.has(prop[1]))) {
      // eigenschap: "naam: waarde" of boolean "naam"
      if (!parent) { err(name, `regel ${n}: eigenschap "${prop[1]}" zonder ouderobject`); return; }
      if (tabs !== parent.level + 1) { err(name, `regel ${n}: eigenschap "${prop[1]}" staat niet één niveau onder ${parent.kind} ${parent.name}`); return; }
      parent.props[prop[1]] = prop[2] === undefined ? true : prop[2];
      stack.length = tabs;
      return;
    }
    const m = rest.match(/^([A-Za-z_]\w*)(?:\s+('(?:[^']|'')+'|[^\s=]+(?:\s+[^\s=]+)*?))?\s*(?:(=)\s*(.*))?$/);
    if (!m || !DECL.has(m[1])) { err(name, `regel ${n}: onbegrepen regel "${rest}"`); return; }
    const [, kw, ident, eq, value] = m;
    if (kw === 'annotation') { if (!parent && tabs > 0) err(name, `regel ${n}: annotatie zonder ouder`); return; }
    if (kw === 'ref') { objects.push({ kind: 'ref', name: ident, level: tabs, props: {}, expr: [], line: n }); return; }
    const obj = { kind: kw, name: ident !== undefined ? unquote(ident.trim()) : '', level: tabs, props: {}, expr: [], line: n, parent };
    if (kw === 'source' && (!parent || parent.kind !== 'partition')) err(name, `regel ${n}: source buiten partition`);
    if (eq) { if (value === '') { exprLevel = tabs + 2; exprTarget = obj; } else obj.expr.push(value); }
    objects.push(obj);
    stack.length = tabs; stack[tabs] = obj;
  });
  if (!text.includes('\t') && objects.length > 2) err(name, 'bevat geen tabs');
  return objects;
}

// ---------- model inlezen ----------
const tables = {};       // name → { columns: {name → {dataType, sourceColumn}}, measures: {name → dax}, partition, calcItems }
const lineageTags = [];
const relationships = [];
const measures = {};     // naam → { table, dax }
const tableFiles = readdirSync(join(DEF, 'tables')).filter(f => f.endsWith('.tmdl'));
for (const f of tableFiles) {
  const objs = parseTmdl(join(DEF, 'tables', f));
  const t = objs.find(o => o.kind === 'table' && o.level === 0);
  if (!t) { err(f, 'geen table-declaratie op niveau 0'); continue; }
  const tbl = { columns: {}, measures: {}, partition: null, calcItems: [], isCalcGroup: false, file: f };
  tables[t.name] = tbl;
  for (const o of objs) {
    if (o.props.lineageTag) lineageTags.push([f, o.props.lineageTag]);
    if (o.kind === 'column') { tbl.columns[o.name] = { dataType: o.props.dataType, sourceColumn: o.props.sourceColumn, props: o.props, calculated: o.expr.length ? o.expr.join('\n') : null }; if (!o.props.dataType) err(f, `kolom ${o.name} zonder dataType`); if (o.expr.length && o.props.sourceColumn) err(f, `berekende kolom ${o.name} heeft ook een sourceColumn`); if (!o.expr.length && !o.props.sourceColumn) err(f, `kolom ${o.name} zonder sourceColumn of expressie`); }
    if (o.kind === 'measure') { tbl.measures[o.name] = o.expr.join('\n'); if (measures[o.name]) err(f, `maat ${o.name} bestaat al in ${measures[o.name].table}`); measures[o.name] = { table: t.name, dax: tbl.measures[o.name] }; if (!o.props.lineageTag) err(f, `maat ${o.name} zonder lineageTag`); }
    if (o.kind === 'partition') { tbl.partition = o; }
    if (o.kind === 'source') { tbl.partition.source = o.expr.join('\n'); }
    if (o.kind === 'calculationGroup') tbl.isCalcGroup = true;
    if (o.kind === 'calculationItem') tbl.calcItems.push({ name: o.name, dax: o.expr.join('\n') });
  }
  if (!tbl.partition) err(f, 'geen partition');
  else if (tbl.partition.expr[0] === 'm' && !tbl.partition.source) err(f, 'partition zonder source');
  // sortByColumn moet bestaan
  for (const [c, col] of Object.entries(tbl.columns)) if (col.props.sortByColumn && !tbl.columns[unquote(col.props.sortByColumn)]) err(f, `kolom ${c}: sortByColumn ${col.props.sortByColumn} bestaat niet`);
  // hiërarchieniveaus verwijzen naar bestaande kolommen
  for (const o of objs.filter(o => o.kind === 'level')) {
    if (!o.props.column) err(f, `level ${o.name} zonder column`);
    else if (!tbl.columns[unquote(o.props.column)]) err(f, `level ${o.name}: kolom ${o.props.column} bestaat niet`);
    if (!o.parent || o.parent.kind !== 'hierarchy') err(f, `level ${o.name} staat niet onder een hierarchy`);
  }
}
stats.tabellen = Object.keys(tables).length;
stats.maten = Object.keys(measures).length;

// kolommen vs CSV
for (const [tname, tbl] of Object.entries(tables)) {
  const header = csvHeaders[tname];
  if (!header) { if (tname !== '_Maten' && !tbl.isCalcGroup) err(tbl.file, `geen CSV voor tabel ${tname}`); continue; }
  for (const [c, col] of Object.entries(tbl.columns)) if (!col.calculated && !header.includes(col.sourceColumn)) err(tbl.file, `sourceColumn ${col.sourceColumn} (kolom ${c}) ontbreekt in ${tname}.csv`);
  for (const h of header) if (!Object.values(tbl.columns).some(c => c.sourceColumn === h)) err(tbl.file, `CSV-kolom ${h} ontbreekt in de tabel`);
  const src = tbl.partition?.source || '';
  if (!src.includes(`CsvMap & "${tname}.csv"`)) err(tbl.file, `M-bron leest niet ${tname}.csv via CsvMap`);
  const typeMatch = src.match(/Table\.TransformColumnTypes\([^,]+,\s*\{(.*)\},\s*"en-US"\)/);
  if (!typeMatch) err(tbl.file, 'M: Table.TransformColumnTypes(..., "en-US") niet gevonden');
  else {
    const mCols = [...typeMatch[1].matchAll(/\{"([^"]+)",\s*([^}]+)\}/g)].map(x => [x[1], x[2].trim()]);
    if (mCols.map(x => x[0]).join(',') !== header.join(',')) err(tbl.file, `M-typelijst (${mCols.map(x => x[0]).join(',')}) wijkt af van CSV-kop (${header.join(',')})`);
    const MAP = { 'Int64.Type': 'int64', 'type number': 'double', 'type text': 'string', 'type date': 'dateTime', 'type datetime': 'dateTime', 'type logical': 'boolean' };
    for (const [c, mt] of mCols) { const col = Object.values(tbl.columns).find(x => x.sourceColumn === c); if (col && MAP[mt] !== col.dataType) err(tbl.file, `kolom ${c}: M-type ${mt} past niet bij dataType ${col.dataType}`); }
  }
}
// _Maten: één verborgen kolom, ≥ 45 maten
if (tables._Maten) {
  const cols = Object.values(tables._Maten.columns);
  if (cols.length !== 1 || cols[0].props.isHidden !== true) err('_Maten.tmdl', 'maattabel moet precies één verborgen kolom hebben');
  if (Object.keys(tables._Maten.measures).length < 45) err('_Maten.tmdl', `minder dan 45 maten (${Object.keys(tables._Maten.measures).length})`);
} else err('tables', 'tabel _Maten ontbreekt');
// calculation group
const cg = Object.entries(tables).find(([, t]) => t.isCalcGroup);
if (!cg) err('tables', 'geen calculation group');
else {
  const [cgName, cgT] = cg;
  if (cgT.calcItems.length < 5) err(cgT.file, 'calculation group heeft minder dan 5 items');
  const src = Object.values(cgT.columns).map(c => c.sourceColumn).sort().join(',');
  if (src !== 'Name,Ordinal') err(cgT.file, `calculation group kolommen moeten sourceColumn Name en Ordinal hebben (gevonden: ${src})`);
  if (cgT.partition?.expr[0] !== 'calculationGroup') err(cgT.file, 'partition van de calculation group moet "= calculationGroup" zijn');
  stats.calculationItems = cgT.calcItems.length; stats.calculationGroup = cgName;
}

// model.tmdl, database.tmdl, expressions.tmdl, relationships.tmdl, cultures
const modelObjs = parseTmdl(join(DEF, 'model.tmdl'));
const model = modelObjs.find(o => o.kind === 'model');
if (!model) err('model.tmdl', 'geen model-declaratie');
else {
  for (const p of ['culture', 'defaultPowerBIDataSourceVersion', 'sourceQueryCulture']) if (!model.props[p]) err('model.tmdl', `eigenschap ${p} ontbreekt`);
  if (model.props.discourageImplicitMeasures !== true) err('model.tmdl', 'discourageImplicitMeasures ontbreekt (vereist voor calculation groups)');
}
const refs = modelObjs.filter(o => o.kind === 'ref').map(o => o.name);
for (const t of Object.keys(tables)) if (!refs.includes(`table ${t}`) && !refs.includes(`table '${t}'`)) err('model.tmdl', `ref table ${t} ontbreekt`);
for (const r of refs) if (r.startsWith('table ')) { const t = unquote(r.slice(6)); if (!tables[t]) err('model.tmdl', `ref table ${t} verwijst naar onbekende tabel`); }
const cultureName = model?.props.culture;
if (!refs.includes(`cultureInfo ${cultureName}`)) err('model.tmdl', `ref cultureInfo ${cultureName} ontbreekt`);
const cultureFile = join(DEF, 'cultures', `${cultureName}.tmdl`);
if (!existsSync(cultureFile)) err('cultures', `${cultureName}.tmdl ontbreekt`);
else { const c = parseTmdl(cultureFile); const ci = c.find(o => o.kind === 'cultureInfo'); if (!ci || ci.name !== cultureName) err('cultures', 'cultureInfo-naam wijkt af'); const lm = c.find(o => o.kind === 'linguisticMetadata'); if (!lm) err('cultures', 'linguisticMetadata ontbreekt'); else { try { const j = JSON.parse(lm.expr.join('\n')); if (j.Version !== '1.0.0' || j.Language !== cultureName) err('cultures', 'linguisticMetadata moet Version 1.0.0 en de cultuurnaam bevatten'); } catch { err('cultures', 'linguisticMetadata is geen JSON'); } } }
const db = parseTmdl(join(DEF, 'database.tmdl')).find(o => o.kind === 'database');
if (!db || db.props.compatibilityLevel !== '1604') err('database.tmdl', 'compatibilityLevel 1604 ontbreekt');
const exprs = parseTmdl(join(DEF, 'expressions.tmdl')).filter(o => o.kind === 'expression');
const csvMap = exprs.find(o => o.name === 'CsvMap');
if (!csvMap) err('expressions.tmdl', 'parameter CsvMap ontbreekt');
else { if (!/IsParameterQuery=true/.test(csvMap.expr.join(' '))) err('expressions.tmdl', 'CsvMap is geen parameter (meta IsParameterQuery)'); if (csvMap.props.lineageTag) lineageTags.push(['expressions.tmdl', csvMap.props.lineageTag]); }
for (const o of modelObjs.concat(exprs)) if (o.props?.lineageTag && o !== csvMap) lineageTags.push(['model', o.props.lineageTag]);
const relObjs = parseTmdl(join(DEF, 'relationships.tmdl')).filter(o => o.kind === 'relationship');
const relNames = new Set();
for (const r of relObjs) {
  if (!GUID.test(r.name)) err('relationships.tmdl', `relatienaam ${r.name} is geen GUID`);
  if (relNames.has(r.name)) err('relationships.tmdl', `dubbele relatie ${r.name}`); relNames.add(r.name);
  const parseRef = s => { const m = s.match(/^('(?:[^']|'')+'|[^.]+)\.('(?:[^']|'')+'|.+)$/); return m ? [unquote(m[1]), unquote(m[2])] : null; };
  const from = parseRef(r.props.fromColumn || ''); const to = parseRef(r.props.toColumn || '');
  if (!from || !to) { err('relationships.tmdl', `relatie ${r.name}: fromColumn/toColumn ontbreekt`); continue; }
  const fc = tables[from[0]]?.columns[from[1]]; const tc = tables[to[0]]?.columns[to[1]];
  if (!fc) err('relationships.tmdl', `fromColumn ${r.props.fromColumn} bestaat niet`);
  if (!tc) err('relationships.tmdl', `toColumn ${r.props.toColumn} bestaat niet`);
  if (fc && tc && fc.dataType !== tc.dataType) err('relationships.tmdl', `${r.props.fromColumn} (${fc.dataType}) en ${r.props.toColumn} (${tc.dataType}) hebben verschillend datatype`);
  relationships.push({ from, to });
}
for (const t of Object.keys(tables).filter(t => t.startsWith('Fact'))) {
  if (!relationships.some(r => r.from[0] === t && r.to[0] === 'DimDatum')) err('relationships.tmdl', `${t} heeft geen relatie met DimDatum`);
  if (!relationships.some(r => r.from[0] === t && r.to[0] === 'DimScenario')) err('relationships.tmdl', `${t} heeft geen relatie met DimScenario`);
}
stats.relaties = relationships.length;

// lineageTags uniek + GUID
const seen = new Map();
for (const [f, g] of lineageTags) {
  if (!GUID.test(g)) err(f, `lineageTag ${g} is geen GUID`);
  if (seen.has(g)) err(f, `lineageTag ${g} is dubbel (ook in ${seen.get(g)})`); seen.set(g, f);
}
stats.lineageTags = lineageTags.length;

// DAX-verwijzingen
const TABLE_REF = /(?:'((?:[^']|'')+)'|([A-Za-z_][\w]*))\[([^\]]+)\]/g;
const BARE_REF = /\[([^\]]+)\]/g;
let daxRefs = 0;
function checkDax(owner, dax) {
  const stripped = dax.replace(/"(?:[^"]|"")*"/g, '""');
  for (const m of stripped.matchAll(TABLE_REF)) {
    const t = (m[1] ?? m[2]).replace(/''/g, "'"); const c = m[3]; daxRefs++;
    if (!tables[t]) { err('_Maten.tmdl', `${owner}: tabel ${t} bestaat niet`); continue; }
    if (!tables[t].columns[c] && !tables[t].measures[c]) err('_Maten.tmdl', `${owner}: ${t}[${c}] bestaat niet`);
  }
  const rest = stripped.replace(TABLE_REF, '');
  for (const m of rest.matchAll(BARE_REF)) { daxRefs++; if (!measures[m[1]]) err('_Maten.tmdl', `${owner}: maat [${m[1]}] bestaat niet`); }
}
for (const [name, m] of Object.entries(measures)) { if (!m.dax.trim()) err('_Maten.tmdl', `maat ${name} zonder expressie`); checkDax(`maat ${name}`, m.dax); }
if (cg) for (const item of cg[1].calcItems) checkDax(`calculation item ${item.name}`, item.dax);
let calcColumns = 0;
for (const [tname, tbl] of Object.entries(tables)) for (const [c, col] of Object.entries(tbl.columns)) if (col.calculated) { calcColumns++; checkDax(`berekende kolom ${tname}[${c}]`, col.calculated); }
stats.berekendeKolommen = calcColumns;
stats.daxVerwijzingen = daxRefs;

// letterlijke waarden in DAX-filters (Tabel[Kolom] = "x" / IN {"x", "y"}) moeten in de CSV-data voorkomen
const LITERAL_FILTER = /(?:'((?:[^']|'')+)'|([A-Za-z_]\w*))\[([^\]]+)\]\s*(?:=|IN)\s*("(?:[^"]|"")*"|\{[^}]*\})/g;
let daxLiterals = 0;
function checkLiterals(owner, dax) {
  for (const m of dax.matchAll(LITERAL_FILTER)) {
    const t = (m[1] ?? m[2]).replace(/''/g, "'"); const c = m[3];
    const values = csvValues[t]?.[c]; if (!values) continue; // geen CSV (maattabel) of geen kolom: al gemeld door checkDax
    for (const lit of m[4].matchAll(/"((?:[^"]|"")*)"/g)) { daxLiterals++; const v = lit[1].replace(/""/g, '"'); if (!values.has(v)) err('_Maten.tmdl', `${owner}: ${t}[${c}] heeft geen waarde "${v}" in ${t}.csv`); }
  }
}
for (const [name, m] of Object.entries(measures)) checkLiterals(`maat ${name}`, m.dax);
stats.daxLiteralen = daxLiterals;

// referentiële integriteit: elke sleutel in een feit (na de datumfilter uit de M-query) bestaat in de dimensie
const dimDatumKeys = [...(csvValues.DimDatum?.DatumKey ?? [])].map(Number);
const datumBereik = [Math.min(...dimDatumKeys), Math.max(...dimDatumKeys)];
let orphanChecks = 0;
for (const [tname, tbl] of Object.entries(tables)) {
  if (!csvHeaders[tname] || tname === 'DimDatum' || !csvHeaders[tname].includes('DatumKey')) continue;
  const src = tbl.partition?.source || '';
  const bounds = src.match(/Table\.SelectRows\(\w+, each \[DatumKey\] >= (\d+) and \[DatumKey\] <= (\d+)\)/);
  if (!bounds) { err(tbl.file, 'M: geen datumfilter (Table.SelectRows op [DatumKey] binnen het bereik van DimDatum)'); continue; }
  const [lo, hi] = [Number(bounds[1]), Number(bounds[2])];
  if (lo !== datumBereik[0] || hi !== datumBereik[1]) err(tbl.file, `M: datumfilter ${lo}-${hi} wijkt af van DimDatum (${datumBereik[0]}-${datumBereik[1]})`);
  const inRange = k => Number(k) >= lo && Number(k) <= hi;
  const buiten = [...csvValues[tname].DatumKey].filter(k => !inRange(k)).length;
  if (buiten) stats[`${tname} maanden buiten DimDatum (weggefilterd)`] = buiten;
  for (const r of relationships.filter(r => r.from[0] === tname)) {
    const [fc, tc] = [r.from[1], r.to[1]];
    const dimValues = csvValues[r.to[0]]?.[tc]; if (!dimValues) continue;
    orphanChecks++;
    const factRows = csvValues[tname][fc];
    const orphans = [...factRows].filter(v => (fc === 'DatumKey' ? inRange(v) : true) && !dimValues.has(v));
    if (orphans.length) err(tbl.file, `${tname}[${fc}]: ${orphans.length} waarde(n) zonder rij in ${r.to[0]}[${tc}], bijv. ${orphans.slice(0, 3).join(', ')}`);
  }
}
stats.sleutelcontroles = orphanChecks;

// ---------- JSON-bestanden ----------
function readJson(path) { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (e) { err(basename(path), `ongeldige JSON: ${e.message}`); return null; } }
const pbip = readJson(join(__dirname, 'Helder.pbip'));
if (pbip && !(pbip.artifacts?.[0]?.report?.path === 'Helder.Report')) err('Helder.pbip', 'artifacts[0].report.path moet Helder.Report zijn');
for (const [p, type] of [[join(__dirname, 'Helder.SemanticModel', '.platform'), 'SemanticModel'], [join(REPORT, '.platform'), 'Report']]) {
  const j = readJson(p); if (j && j.metadata?.type !== type) err(p, `metadata.type moet ${type} zijn`); if (j && !GUID.test(j.config?.logicalId || '')) err(p, 'config.logicalId is geen GUID');
}
const pbism = readJson(join(__dirname, 'Helder.SemanticModel', 'definition.pbism'));
if (pbism && pbism.version !== '4.0') err('definition.pbism', 'version moet 4.0 zijn');
const pbir = readJson(join(REPORT, 'definition.pbir'));
if (pbir && pbir.datasetReference?.byPath?.path !== '../Helder.SemanticModel') err('definition.pbir', 'datasetReference.byPath.path moet ../Helder.SemanticModel zijn');
const measuresJson = readJson(join(__dirname, 'measures.json'));
if (measuresJson) {
  if (!Array.isArray(measuresJson)) err('measures.json', 'moet een array zijn');
  else { for (const m of measuresJson) { for (const k of ['name', 'group', 'description', 'dax']) if (!m[k]) err('measures.json', `maat ${m.name}: ${k} ontbreekt`); if (!measures[m.name]) err('measures.json', `maat ${m.name} ontbreekt in TMDL`); else if (measures[m.name].dax !== m.dax) err('measures.json', `maat ${m.name}: DAX wijkt af van TMDL`); } if (measuresJson.length !== Object.keys(measures).length) err('measures.json', `aantal maten (${measuresJson.length}) ≠ TMDL (${Object.keys(measures).length})`); }
}

// report.json
const report = readJson(join(REPORT, 'report.json'));
let visualCount = 0; let slicerDefaults = 0;
if (report) {
  const cfg = (() => { try { return JSON.parse(report.config); } catch { err('report.json', 'config is geen JSON-string'); return null; } })();
  if (report.layoutOptimization !== 0) err('report.json', 'layoutOptimization moet 0 zijn');
  if (!Array.isArray(report.resourcePackages) || !report.resourcePackages.length) err('report.json', 'resourcePackages ontbreekt');
  else {
    const theme = cfg?.themeCollection?.baseTheme?.name;
    const item = report.resourcePackages[0].resourcePackage?.items?.find(i => i.name === theme);
    if (!item) err('report.json', `thema ${theme} ontbreekt in resourcePackages`);
    else if (!existsSync(join(REPORT, 'StaticResources', 'SharedResources', item.path))) err('report.json', `themabestand ${item.path} ontbreekt`);
  }
  if (!Array.isArray(report.sections) || report.sections.length < 3) err('report.json', 'minder dan 3 pagina\'s');
  const names = new Set();
  for (const s of report.sections || []) {
    if (names.has(s.name)) err('report.json', `dubbele paginanaam ${s.name}`); names.add(s.name);
    if (s.width !== 1280 || s.height !== 720) err('report.json', `pagina ${s.displayName}: afmeting moet 1280×720 zijn`);
    for (const k of ['filters', 'config']) { try { JSON.parse(s[k]); } catch { err('report.json', `pagina ${s.displayName}: ${k} is geen JSON-string`); } }
    const vnames = new Set();
    for (const vc of s.visualContainers || []) {
      visualCount++;
      let c; try { c = JSON.parse(vc.config); } catch { err('report.json', `pagina ${s.displayName}: visual config is geen JSON-string`); continue; }
      try { JSON.parse(vc.filters); } catch { err('report.json', `visual ${c.name}: filters is geen JSON-string`); }
      if (vnames.has(c.name)) err('report.json', `dubbele visualnaam ${c.name} op ${s.displayName}`); vnames.add(c.name);
      const sv = c.singleVisual; if (!sv?.visualType) { err('report.json', `visual ${c.name}: singleVisual.visualType ontbreekt`); continue; }
      const pos = c.layouts?.[0]?.position;
      if (!pos || pos.x !== vc.x || pos.y !== vc.y || pos.width !== vc.width || pos.height !== vc.height) err('report.json', `visual ${c.name}: layouts.position wijkt af van de container`);
      if (vc.x + vc.width > s.width || vc.y + vc.height > s.height) err('report.json', `visual ${c.name} valt buiten de pagina`);
      const q = sv.prototypeQuery; if (!q) { err('report.json', `visual ${c.name}: prototypeQuery ontbreekt`); continue; }
      const alias = Object.fromEntries((q.From || []).map(f => [f.Name, f.Entity]));
      for (const e of Object.values(alias)) if (!tables[e]) err('report.json', `visual ${c.name}: tabel ${e} bestaat niet`);
      const selectNames = new Set();
      for (const sel of q.Select || []) {
        selectNames.add(sel.Name);
        const kind = sel.Column ? 'Column' : sel.Measure ? 'Measure' : null;
        if (!kind) { err('report.json', `visual ${c.name}: Select-item zonder Column/Measure`); continue; }
        const entity = alias[sel[kind].Expression?.SourceRef?.Source]; const prop = sel[kind].Property;
        if (!entity) { err('report.json', `visual ${c.name}: SourceRef verwijst naar onbekende alias`); continue; }
        if (kind === 'Column' && !tables[entity]?.columns[prop]) err('report.json', `visual ${c.name}: kolom ${entity}[${prop}] bestaat niet`);
        if (kind === 'Measure' && !tables[entity]?.measures[prop]) err('report.json', `visual ${c.name}: maat ${entity}[${prop}] bestaat niet`);
        if (sel.Name !== `${entity}.${prop}`) err('report.json', `visual ${c.name}: Select.Name ${sel.Name} ≠ ${entity}.${prop}`);
      }
      for (const [role, items] of Object.entries(sv.projections || {})) for (const it of items) if (!selectNames.has(it.queryRef)) err('report.json', `visual ${c.name}: projectie ${role} → ${it.queryRef} ontbreekt in Select`);
      // standaardselectie van een slicer (objects.general.filter): kolom bestaat en de waarde komt in de data voor
      const sf = sv.objects?.general?.[0]?.properties?.filter?.filter;
      if (sf) {
        const falias = Object.fromEntries((sf.From || []).map(f => [f.Name, f.Entity]));
        for (const w of sf.Where || []) {
          const inCond = w.Condition?.In; if (!inCond) { err('report.json', `slicer ${c.name}: alleen In-condities worden ondersteund`); continue; }
          const ex = inCond.Expressions?.[0]?.Column; const entity = falias[ex?.Expression?.SourceRef?.Source]; const prop = ex?.Property;
          if (!entity || !tables[entity]?.columns[prop]) { err('report.json', `slicer ${c.name}: filterkolom ${entity}[${prop}] bestaat niet`); continue; }
          slicerDefaults++;
          for (const row of inCond.Values || []) for (const v of row) {
            const raw = v.Literal?.Value ?? ''; const val = raw.startsWith("'") ? raw.slice(1, -1).replace(/''/g, "'") : raw.replace(/L$/, '');
            const known = tables[entity].isCalcGroup ? tables[entity].calcItems.some(i => i.name === val) : csvValues[entity]?.[prop]?.has(val);
            if (!known) err('report.json', `slicer ${c.name}: standaardwaarde ${raw} komt niet voor in ${entity}[${prop}]`);
          }
        }
      }
    }
  }
  stats.paginas = report.sections?.length; stats.visuals = visualCount; stats.slicerStandaarden = slicerDefaults;
}

// ---------- resultaat ----------
console.log('Validatie Power BI-project Helder');
for (const [k, v] of Object.entries(stats)) console.log(`  ${k}: ${v}`);
if (errors.length) { console.log(`\n${errors.length} fout(en):`); for (const e of errors) console.log('  - ' + e); process.exit(1); }
console.log('\nOK: geen fouten gevonden.');
