/*
 * Bouwt het Power BI-project (PBIP) van Helder E-Bikes B.V.:
 *   Helder.pbip, Helder.SemanticModel/ (TMDL) en Helder.Report/ (report.json)
 *
 *   node powerbi/build-tmdl.mjs        → schrijft alle projectbestanden en measures.json
 *
 * De kolomlijsten worden uit de CSV-koppen in powerbi/data/ gelezen, zodat sourceColumn en de
 * M-typeringen altijd exact overeenkomen. LineageTags worden eenmalig gegenereerd (crypto.randomUUID)
 * en bewaard in powerbi/lineage.json zodat herhaald bouwen geen nieuwe GUID's oplevert.
 * Alle data is volledig fictief.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MEASURES, CALC_ITEMS } from './measures-def.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, 'data');
const MODEL_DIR = join(__dirname, 'Helder.SemanticModel');
const REPORT_DIR = join(__dirname, 'Helder.Report');
const LINEAGE_FILE = join(__dirname, 'lineage.json');

// ---------- lineage tags (stabiel over herbouw) ----------
const lineage = existsSync(LINEAGE_FILE) ? JSON.parse(readFileSync(LINEAGE_FILE, 'utf8')) : {};
const used = new Set(Object.values(lineage));
function tag(key) {
  if (!lineage[key]) { let g; do { g = randomUUID(); } while (used.has(g)); lineage[key] = g; used.add(g); }
  return lineage[key];
}

// ---------- CSV lezen (alleen kop + waarden voor typedetectie) ----------
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function readCsv(name) {
  const text = readFileSync(join(DATA, name + '.csv'), 'utf8');
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const rows = lines.slice(1).map(parseCsvLine);
  return { header, rows };
}
// detecteert het M-type per kolom op basis van alle waarden
function detectType(values) {
  const v = values.filter(x => x !== '');
  if (v.length === 0) return 'text';
  if (v.every(x => /^\d{4}-\d{2}-\d{2}$/.test(x))) return 'date';
  if (v.every(x => /^-?\d+$/.test(x))) return 'int64';
  if (v.every(x => /^-?\d+(\.\d+)?$/.test(x))) return 'number';
  return 'text';
}
const M_TYPE = { int64: 'Int64.Type', number: 'type number', text: 'type text', date: 'type date' };
const TMDL_TYPE = { int64: 'int64', number: 'double', text: 'string', date: 'dateTime' };

// ---------- modelconfiguratie per tabel/kolom ----------
const TABLES = ['DimDatum', 'DimScenario', 'DimProductlijn', 'DimKanaal', 'DimLand', 'DimAfdeling', 'DimRekening',
  'FactVerkoop', 'FactWinstVerlies', 'FactBalans', 'FactKasstroom', 'FactKPI', 'FactFTE', 'Gebeurtenissen'];
const SUM_COLUMNS = new Set(['Aantal', 'Omzet', 'Kostprijs', 'Bedrag', 'FTE']);
const HIDDEN_COLUMNS = new Set(['JaarMaandSort', 'Volgorde']);
const SORT_BY = { DimDatum: { Maand: 'Maandnummer', MaandKort: 'Maandnummer', JaarMaand: 'JaarMaandSort' }, DimScenario: { Scenario: 'Volgorde' }, DimRekening: { Rekening: 'Volgorde' } };
const COLUMN_FORMAT = { DSO: '0.0', DIO: '0.0', DPO: '0.0', Leverage: '0.00', ICR: '0.00', Prijsfactor: '0.00', FTE: '#,0.0' };
const TABLE_DESCRIPTION = {
  DimDatum: 'Datumtabel op dagniveau (2023-2028). Feiten staan op de eerste dag van de maand.',
  DimScenario: 'Scenario: Actual (t/m 2026-09), Budget (alleen 2026, W&V en verkoop) en Forecast (vanaf 2026-10).',
  DimProductlijn: 'Productlijnen City, Trek en Cargo.',
  DimKanaal: 'Verkoopkanalen met prijsfactor t.o.v. de adviesprijs.',
  DimLand: 'Landen: thuismarkt Nederland en export Duitsland/België.',
  DimAfdeling: 'Afdelingen voor de FTE-registratie.',
  DimRekening: 'Rekeningschema van de W&V. Teken (+1 opbrengst, -1 kosten) bepaalt de bijdrage aan het resultaat.',
  FactVerkoop: 'Verkopen per maand, scenario, productlijn, kanaal en land (aantallen, omzet, kostprijs).',
  FactWinstVerlies: 'Winst- en verliesrekening in lang formaat: bedrag per rekening (kosten positief opgeslagen).',
  FactBalans: 'Balansstanden per maandeinde in lang formaat; passiva en eigen vermogen negatief opgeslagen.',
  FactKasstroom: 'Kasstroomoverzicht per maand in lang formaat (indirecte methode).',
  FactKPI: 'Werkkapitaal- en covenant-KPI\'s per maand zoals door het model gerapporteerd.',
  FactFTE: 'FTE per afdeling per maand.',
  Gebeurtenissen: 'Verklarende gebeurtenissen (storyline) met toelichting.'
};
const RELATIONSHIPS = [
  ['FactVerkoop', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactVerkoop', 'ScenarioKey', 'DimScenario', 'ScenarioKey'],
  ['FactVerkoop', 'ProductlijnKey', 'DimProductlijn', 'ProductlijnKey'], ['FactVerkoop', 'KanaalKey', 'DimKanaal', 'KanaalKey'], ['FactVerkoop', 'LandKey', 'DimLand', 'LandKey'],
  ['FactWinstVerlies', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactWinstVerlies', 'ScenarioKey', 'DimScenario', 'ScenarioKey'], ['FactWinstVerlies', 'RekeningKey', 'DimRekening', 'RekeningKey'],
  ['FactBalans', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactBalans', 'ScenarioKey', 'DimScenario', 'ScenarioKey'],
  ['FactKasstroom', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactKasstroom', 'ScenarioKey', 'DimScenario', 'ScenarioKey'],
  ['FactKPI', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactKPI', 'ScenarioKey', 'DimScenario', 'ScenarioKey'],
  ['FactFTE', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactFTE', 'ScenarioKey', 'DimScenario', 'ScenarioKey'], ['FactFTE', 'AfdelingKey', 'DimAfdeling', 'AfdelingKey'],
  ['Gebeurtenissen', 'DatumKey', 'DimDatum', 'DatumKey']
];

// ---------- TMDL helpers ----------
const T = '\t';
function ident(name) { return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`; }
function indentLines(text, level) { return text.split('\n').map(l => (l.length ? T.repeat(level) + l : '')).join('\n'); }
function descLines(desc, level) { return desc ? desc.split('\n').map(l => `${T.repeat(level)}/// ${l}`).join('\n') + '\n' : ''; }

function columnTmdl(table, col, type) {
  const isKey = /Key$/.test(col) && !(table === 'DimDatum' && col === 'Datum');
  const hidden = isKey || HIDDEN_COLUMNS.has(col);
  const summarize = SUM_COLUMNS.has(col) ? 'sum' : 'none';
  let format = COLUMN_FORMAT[col];
  if (!format) {
    if (type === 'date') format = 'dd-MM-yyyy';
    else if (SUM_COLUMNS.has(col)) format = '#,0';
    else if (type === 'int64' && !isKey) format = '0';
    else if (type === 'number') format = '#,0.00';
  }
  const lines = [];
  lines.push(`${T}column ${ident(col)}`);
  lines.push(`${T}${T}dataType: ${TMDL_TYPE[type]}`);
  if (table === 'DimDatum' && col === 'Datum') lines.push(`${T}${T}isKey`);
  if (hidden) lines.push(`${T}${T}isHidden`);
  if (format) lines.push(`${T}${T}formatString: ${format}`);
  lines.push(`${T}${T}lineageTag: ${tag(`column:${table}.${col}`)}`);
  lines.push(`${T}${T}summarizeBy: ${summarize}`);
  lines.push(`${T}${T}sourceColumn: ${col}`);
  const sortBy = SORT_BY[table]?.[col];
  if (sortBy) lines.push(`${T}${T}sortByColumn: ${ident(sortBy)}`);
  lines.push('');
  lines.push(`${T}${T}annotation SummarizationSetBy = User`);
  lines.push('');
  return lines.join('\n');
}

function mSource(table, header, types) {
  const typeList = header.map((c, i) => `{"${c}", ${M_TYPE[types[i]]}}`).join(', ');
  return [
    'let',
    `    Bron = Csv.Document(File.Contents(CsvMap & "${table}.csv"), [Delimiter=",", Columns=${header.length}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),`,
    '    Kop = Table.PromoteHeaders(Bron, [PromoteAllScalars=true]),',
    `    Typen = Table.TransformColumnTypes(Kop, {${typeList}}, "en-US")`,
    'in',
    '    Typen'
  ].join('\n');
}

function tableTmdl(table) {
  const { header, rows } = readCsv(table);
  const types = header.map((_, i) => detectType(rows.map(r => r[i] ?? '')));
  let out = descLines(TABLE_DESCRIPTION[table], 0);
  out += `table ${ident(table)}\n`;
  out += `${T}lineageTag: ${tag(`table:${table}`)}\n`;
  if (table === 'DimDatum') out += `${T}dataCategory: Time\n`;
  out += '\n';
  out += header.map((c, i) => columnTmdl(table, c, types[i])).join('\n');
  out += `\n${T}partition ${ident(table)} = m\n${T}${T}mode: import\n${T}${T}source =\n${indentLines(mSource(table, header, types), 3)}\n\n`;
  out += `${T}annotation PBI_ResultType = Table\n`;
  return { tmdl: out, header, types };
}

// ---------- maattabel _Maten ----------
function measureTmdl(m) {
  const multi = m.dax.includes('\n');
  let out = descLines(m.description, 1);
  if (multi) out += `${T}measure ${ident(m.name)} =\n${indentLines(m.dax, 3)}\n`;
  else out += `${T}measure ${ident(m.name)} = ${m.dax}\n`;
  if (m.formatString) out += `${T}${T}formatString: ${m.formatString}\n`;
  out += `${T}${T}displayFolder: ${m.group}\n`;
  out += `${T}${T}lineageTag: ${tag(`measure:${m.name}`)}\n`;
  out += '\n';
  return out;
}
function matenTmdl() {
  let out = '/// Maattabel: alle DAX-maten van het Helder-model, gegroepeerd in mappen. De enige kolom is verborgen.\n';
  out += `table _Maten\n${T}lineageTag: ${tag('table:_Maten')}\n\n`;
  out += MEASURES.map(measureTmdl).join('');
  out += `${T}column Kolom1\n${T}${T}dataType: int64\n${T}${T}isHidden\n${T}${T}formatString: 0\n${T}${T}lineageTag: ${tag('column:_Maten.Kolom1')}\n${T}${T}summarizeBy: none\n${T}${T}sourceColumn: Kolom1\n\n${T}${T}annotation SummarizationSetBy = User\n\n`;
  out += `${T}partition _Maten = m\n${T}${T}mode: import\n${T}${T}source =\n${indentLines('let\n    Bron = #table(type table [Kolom1 = Int64.Type], {{1}})\nin\n    Bron', 3)}\n\n`;
  out += `${T}annotation PBI_ResultType = Table\n`;
  return out;
}

// ---------- calculation group Tijdintelligentie ----------
function calcGroupTmdl() {
  let out = '/// Calculation group: pas tijdintelligentie toe op elke maat (Actueel, YTD, Vorig jaar, Verschil vs vorig jaar).\n';
  out += `table Tijdintelligentie\n${T}lineageTag: ${tag('table:Tijdintelligentie')}\n\n`;
  out += `${T}calculationGroup\n${T}${T}precedence: 10\n\n`;
  CALC_ITEMS.forEach((item, i) => {
    out += descLines(item.description, 2);
    out += `${T}${T}calculationItem ${ident(item.name)} = ${item.dax}\n`;
    if (item.formatStringDefinition) out += `${T}${T}${T}formatStringDefinition = ${item.formatStringDefinition}\n`;
    if (i > 0) out += `${T}${T}${T}ordinal: ${i}\n`;
    out += '\n';
  });
  out += `${T}column Tijdberekening\n${T}${T}dataType: string\n${T}${T}lineageTag: ${tag('column:Tijdintelligentie.Tijdberekening')}\n${T}${T}summarizeBy: none\n${T}${T}sourceColumn: Name\n${T}${T}sortByColumn: Ordinal\n\n${T}${T}annotation SummarizationSetBy = User\n\n`;
  out += `${T}column Ordinal\n${T}${T}dataType: int64\n${T}${T}isHidden\n${T}${T}formatString: 0\n${T}${T}lineageTag: ${tag('column:Tijdintelligentie.Ordinal')}\n${T}${T}summarizeBy: none\n${T}${T}sourceColumn: Ordinal\n\n${T}${T}annotation SummarizationSetBy = User\n\n`;
  out += `${T}partition Tijdintelligentie = calculationGroup\n${T}${T}mode: import\n`;
  return out;
}

// ---------- model-, database-, expressie-, relatie- en cultuurbestanden ----------
const ALL_TABLES = [...TABLES, '_Maten', 'Tijdintelligentie'];
function modelTmdl() {
  return [
    'model Model',
    `${T}culture: nl-NL`,
    `${T}defaultPowerBIDataSourceVersion: powerBI_V3`,
    `${T}sourceQueryCulture: nl-NL`,
    `${T}discourageImplicitMeasures`,
    `${T}dataAccessOptions`,
    `${T}${T}legacyRedirects`,
    `${T}${T}returnErrorValuesAsNull`,
    '',
    'annotation __PBI_TimeIntelligenceEnabled = 0',
    '',
    'annotation PBIDesktopVersion = 2.137.1102.0 (24.10)',
    '',
    `annotation PBI_QueryOrder = ${JSON.stringify(['CsvMap', ...ALL_TABLES])}`,
    '',
    'annotation PBI_ProTooling = ["DevMode"]',
    '',
    ...ALL_TABLES.map(t => `ref table ${ident(t)}`),
    '',
    'ref cultureInfo nl-NL',
    ''
  ].join('\n');
}
function databaseTmdl() { return `database\n${T}compatibilityLevel: 1604\n`; }
function expressionsTmdl() {
  return [
    '/// Map met de CSV-bestanden van het Helder-model (eindig op een backslash).',
    'expression CsvMap = "C:\\Helder\\powerbi\\data\\" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]',
    `${T}lineageTag: ${tag('expression:CsvMap')}`,
    '',
    `${T}annotation PBI_ResultType = Text`,
    ''
  ].join('\n');
}
function relationshipsTmdl() {
  return RELATIONSHIPS.map(([ft, fc, tt, tc]) => `relationship ${tag(`relationship:${ft}.${fc}->${tt}.${tc}`)}\n${T}fromColumn: ${ident(ft)}.${ident(fc)}\n${T}toColumn: ${ident(tt)}.${ident(tc)}\n`).join('\n');
}
function cultureTmdl() {
  return `cultureInfo nl-NL\n\n${T}linguisticMetadata =\n${T}${T}${T}{\n${T}${T}${T}  "Version": "1.0.0",\n${T}${T}${T}  "Language": "nl-NL"\n${T}${T}${T}}\n${T}${T}contentType: json\n`;
}

// ---------- rapport (klassieke report.json-indeling) ----------
const THEME = 'CY24SU06';
function visual(name, pos, singleVisual) {
  const config = { name, layouts: [{ id: 0, position: { x: pos.x, y: pos.y, z: pos.z ?? 0, width: pos.w, height: pos.h, tabOrder: pos.tab ?? 0 } }], singleVisual: { ...singleVisual, drillFilterOtherVisuals: true } };
  return { x: pos.x, y: pos.y, z: pos.z ?? 0, width: pos.w, height: pos.h, config: JSON.stringify(config), filters: '[]' };
}
function title(text) { return { title: [{ properties: { text: { expr: { Literal: { Value: `'${text.replace(/'/g, "''")}'` } } }, show: { expr: { Literal: { Value: 'true' } } } } }] }; }
const col = (src, prop) => ({ Column: { Expression: { SourceRef: { Source: src } }, Property: prop } });
const mea = (src, prop) => ({ Measure: { Expression: { SourceRef: { Source: src } }, Property: prop } });
function card(name, pos, measure) {
  return visual(name, pos, {
    visualType: 'card',
    projections: { Values: [{ queryRef: `_Maten.${measure}` }] },
    prototypeQuery: { Version: 2, From: [{ Name: 'm', Entity: '_Maten', Type: 0 }], Select: [{ ...mea('m', measure), Name: `_Maten.${measure}` }] },
    vcObjects: title(measure)
  });
}
function columnChart(name, pos, measure, titleText) {
  return visual(name, pos, {
    visualType: 'clusteredColumnChart',
    projections: { Category: [{ queryRef: 'DimDatum.JaarMaand' }], Y: [{ queryRef: `_Maten.${measure}` }] },
    prototypeQuery: {
      Version: 2,
      From: [{ Name: 'd', Entity: 'DimDatum', Type: 0 }, { Name: 'm', Entity: '_Maten', Type: 0 }],
      Select: [{ ...col('d', 'JaarMaand'), Name: 'DimDatum.JaarMaand' }, { ...mea('m', measure), Name: `_Maten.${measure}` }],
      OrderBy: [{ Direction: 1, Expression: col('d', 'JaarMaand') }]
    },
    vcObjects: title(titleText)
  });
}
function matrix(name, pos, rowTable, rowColumn, measures, titleText) {
  const src = rowTable === 'DimRekening' ? 'r' : 'b';
  return visual(name, pos, {
    visualType: 'pivotTable',
    projections: { Rows: [{ queryRef: `${rowTable}.${rowColumn}` }], Values: measures.map(m => ({ queryRef: `_Maten.${m}` })) },
    prototypeQuery: {
      Version: 2,
      From: [{ Name: src, Entity: rowTable, Type: 0 }, { Name: 'm', Entity: '_Maten', Type: 0 }],
      Select: [{ ...col(src, rowColumn), Name: `${rowTable}.${rowColumn}` }, ...measures.map(m => ({ ...mea('m', m), Name: `_Maten.${m}` }))]
    },
    vcObjects: title(titleText)
  });
}
function slicer(name, pos, table, column) {
  return visual(name, pos, {
    visualType: 'slicer',
    projections: { Values: [{ queryRef: `${table}.${column}` }] },
    prototypeQuery: { Version: 2, From: [{ Name: 's', Entity: table, Type: 0 }], Select: [{ ...col('s', column), Name: `${table}.${column}` }] },
    vcObjects: title(column)
  });
}
function page(name, displayName, ordinal, visuals) {
  return { name, displayName, filters: '[]', ordinal, visualContainers: visuals, config: '{}', displayOption: 1, width: 1280, height: 720 };
}
function reportJson() {
  const cardW = 236, cardH = 110, gap = 16, top = 24;
  const cardsRow = (names) => names.map((m, i) => card(`c${ordinalId()}`, { x: 24 + i * (cardW + gap), y: top, w: cardW, h: cardH, tab: i }, m));
  let n = 0; const ordinalId = () => (++n).toString().padStart(4, '0');
  const overzicht = page('ReportSection1', 'Overzicht', 0, [
    ...cardsRow(['Netto-omzet', 'EBITDA', 'EBITDA %', 'Nettowinst', 'Liquide middelen']),
    columnChart(`v${ordinalId()}`, { x: 24, y: 160, w: 900, h: 520, tab: 10 }, 'Netto-omzet', 'Netto-omzet per maand'),
    slicer(`s${ordinalId()}`, { x: 948, y: 160, w: 308, h: 160, tab: 11 }, 'DimScenario', 'Scenario'),
    slicer(`s${ordinalId()}`, { x: 948, y: 336, w: 308, h: 344, tab: 12 }, 'DimDatum', 'Jaar')
  ]);
  const wv = page('ReportSection2', 'Winst & verlies', 1, [
    ...cardsRow(['Netto-omzet', 'Brutomarge % (W&V)', 'Operationele kosten', 'EBITDA', 'Afwijking EBITDA vs budget (€)']),
    matrix(`m${ordinalId()}`, { x: 24, y: 160, w: 620, h: 520, tab: 10 }, 'DimRekening', 'Rekening', ['W&V bedrag', 'W&V bedrag Budget'], 'Winst- en verliesrekening'),
    columnChart(`v${ordinalId()}`, { x: 668, y: 160, w: 588, h: 344, tab: 11 }, 'EBITDA', 'EBITDA per maand'),
    slicer(`s${ordinalId()}`, { x: 668, y: 520, w: 280, h: 160, tab: 12 }, 'DimScenario', 'Scenario'),
    slicer(`s${ordinalId()}`, { x: 972, y: 520, w: 284, h: 160, tab: 13 }, 'DimDatum', 'Jaar')
  ]);
  const balans = page('ReportSection3', 'Balans', 2, [
    ...cardsRow(['Totaal activa', 'Eigen vermogen', 'Netto schuld', 'Leverage', 'Covenantstatus']),
    matrix(`m${ordinalId()}`, { x: 24, y: 160, w: 620, h: 520, tab: 10 }, 'FactBalans', 'Balanspost', ['Balans laatste stand'], 'Balans (laatste stand in de periode)'),
    columnChart(`v${ordinalId()}`, { x: 668, y: 160, w: 588, h: 344, tab: 11 }, 'Vrije kasstroom', 'Vrije kasstroom per maand'),
    slicer(`s${ordinalId()}`, { x: 668, y: 520, w: 280, h: 160, tab: 12 }, 'DimScenario', 'Scenario'),
    slicer(`s${ordinalId()}`, { x: 972, y: 520, w: 284, h: 160, tab: 13 }, 'DimDatum', 'Jaar')
  ]);
  const config = {
    version: '5.43',
    themeCollection: { baseTheme: { name: THEME, version: '5.55', type: 2 } },
    activeSectionIndex: 0,
    defaultDrillFilterOtherVisuals: true,
    settings: { useNewFilterPaneExperience: true, isPersistentUserStateDisabled: false, allowChangeFilterTypes: true, useStylableVisualContainerHeader: true, exportDataMode: 1, queryLimitOption: 6 }
  };
  return {
    config: JSON.stringify(config),
    layoutOptimization: 0,
    resourcePackages: [{ resourcePackage: { name: 'SharedResources', type: 2, items: [{ type: 202, path: `BaseThemes/${THEME}.json`, name: THEME }], disabled: false } }],
    sections: [overzicht, wv, balans],
    publicCustomVisuals: [],
    pods: [],
    filters: '[]'
  };
}
function themeJson() {
  return {
    name: THEME,
    dataColors: ['#1F5F8B', '#3DA5D9', '#73BFB8', '#FEC601', '#EA7317', '#C84C09', '#6B7280', '#A3A9B4'],
    background: '#FFFFFF', foreground: '#1F2937', tableAccent: '#1F5F8B',
    good: '#2E8B57', neutral: '#FEC601', bad: '#C84C09', maximum: '#1F5F8B', center: '#73BFB8', minimum: '#EA7317', null: '#E5E7EB'
  };
}

// ---------- schrijven ----------
function write(path, content) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
const json = o => JSON.stringify(o, null, 2) + '\n';

const tableInfo = {};
for (const t of TABLES) { const r = tableTmdl(t); tableInfo[t] = { header: r.header, types: r.types }; write(join(MODEL_DIR, 'definition', 'tables', `${t}.tmdl`), r.tmdl); }
write(join(MODEL_DIR, 'definition', 'tables', '_Maten.tmdl'), matenTmdl());
write(join(MODEL_DIR, 'definition', 'tables', 'Tijdintelligentie.tmdl'), calcGroupTmdl());
write(join(MODEL_DIR, 'definition', 'model.tmdl'), modelTmdl());
write(join(MODEL_DIR, 'definition', 'database.tmdl'), databaseTmdl());
write(join(MODEL_DIR, 'definition', 'expressions.tmdl'), expressionsTmdl());
write(join(MODEL_DIR, 'definition', 'relationships.tmdl'), relationshipsTmdl());
write(join(MODEL_DIR, 'definition', 'cultures', 'nl-NL.tmdl'), cultureTmdl());
write(join(MODEL_DIR, '.platform'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json', metadata: { type: 'SemanticModel', displayName: 'Helder' }, config: { version: '2.0', logicalId: tag('platform:SemanticModel') } }));
write(join(MODEL_DIR, 'definition.pbism'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json', version: '4.0', settings: {} }));
write(join(REPORT_DIR, '.platform'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/gitIntegration/platformProperties/2.0.0/schema.json', metadata: { type: 'Report', displayName: 'Helder' }, config: { version: '2.0', logicalId: tag('platform:Report') } }));
write(join(REPORT_DIR, 'definition.pbir'), json({ $schema: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/1.0.0/schema.json', version: '1.0', datasetReference: { byPath: { path: '../Helder.SemanticModel' } } }));
write(join(REPORT_DIR, 'report.json'), json(reportJson()));
write(join(REPORT_DIR, 'StaticResources', 'SharedResources', 'BaseThemes', `${THEME}.json`), json(themeJson()));
write(join(__dirname, 'Helder.pbip'), json({ version: '1.0', artifacts: [{ report: { path: 'Helder.Report' } }], settings: { enableAutoRecovery: true } }));
write(join(__dirname, 'measures.json'), json(MEASURES.map(m => ({ name: m.name, group: m.group, description: m.description, dax: m.dax, formatString: m.formatString || null }))));
write(LINEAGE_FILE, json(lineage));

const nFiles = readdirSync(join(MODEL_DIR, 'definition', 'tables')).length;
console.log(`PBIP gebouwd: ${nFiles} tabellen, ${MEASURES.length} maten, ${CALC_ITEMS.length} calculation items, ${RELATIONSHIPS.length} relaties.`);
