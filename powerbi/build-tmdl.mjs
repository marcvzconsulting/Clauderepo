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

// ---------- CSV lezen (kop + waarden voor typedetectie en grenzen) ----------
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

// ---------- grenzen uit de datumtabel ----------
// Feiten buiten het bereik van DimDatum zouden op de lege rij van de datumtabel landen en de maten onderling
// laten verschillen; elke query met een DatumKey filtert daarom op [MIN_DATUMKEY, MAX_DATUMKEY].
const dimDatum = readCsv('DimDatum');
const dd = Object.fromEntries(dimDatum.header.map((c, i) => [c, i]));
const datumKeys = dimDatum.rows.map(r => Number(r[dd.DatumKey]));
const MIN_DATUMKEY = Math.min(...datumKeys);
const MAX_DATUMKEY = Math.max(...datumKeys);
const DATUM_JAREN = [Math.floor(MIN_DATUMKEY / 10000), Math.floor(MAX_DATUMKEY / 10000)];
// standaardjaar in de rapportslicers: het laatste jaar met gerealiseerde maanden
const DEFAULT_JAAR = Math.max(...dimDatum.rows.filter(r => r[dd.IsActual] === '1').map(r => Number(r[dd.Jaar])));

// ---------- modelconfiguratie per tabel/kolom ----------
const TABLES = ['DimDatum', 'DimScenario', 'DimProductlijn', 'DimKanaal', 'DimLand', 'DimAfdeling', 'DimRekening', 'DimBalanspost',
  'FactVerkoop', 'FactWinstVerlies', 'FactBalans', 'FactKasstroom', 'FactKPI', 'FactFTE', 'Gebeurtenissen'];
const SUM_COLUMNS = new Set(['Aantal', 'Omzet', 'Kostprijs', 'Bedrag', 'FTE']);
// hulpkolommen die niet in de veldenlijst horen (sorteer-, teken- en vlagkolommen)
const HIDDEN_COLUMNS = new Set(['JaarMaandSort', 'Volgorde', 'Teken', 'Maandnummer', 'IsActual']);
const HIDDEN_TABLE_COLUMNS = new Set(['FactBalans.Balanspost']); // vervangen door DimBalanspost
const SORT_BY = {
  DimDatum: { Maand: 'Maandnummer', MaandKort: 'Maandnummer', JaarMaand: 'JaarMaandSort' },
  DimScenario: { Scenario: 'Volgorde' }, DimRekening: { Rekening: 'Volgorde', Rekeninggroep: 'RekeninggroepVolgorde', Niveau1: 'Niveau1Volgorde' }, DimBalanspost: { Balanspost: 'Volgorde' }
};
// berekende (DAX-)kolommen: sorteerkolommen voor de groepsniveaus van het rekeningschema (1 waarde per groep, vereist voor sortByColumn)
const CALCULATED_COLUMNS = {
  DimRekening: [
    { name: 'RekeninggroepVolgorde', type: 'int64', dax: 'CALCULATE(MIN(DimRekening[Volgorde]), ALLEXCEPT(DimRekening, DimRekening[Rekeninggroep]))', description: 'Sorteerkolom voor Rekeninggroep (laagste Volgorde in de groep).' },
    { name: 'Niveau1Volgorde', type: 'int64', dax: 'CALCULATE(MIN(DimRekening[Volgorde]), ALLEXCEPT(DimRekening, DimRekening[Niveau1]))', description: 'Sorteerkolom voor Niveau1 (laagste Volgorde in het niveau).' }
  ]
};
const COLUMN_FORMAT = { DSO: '0.0', DIO: '0.0', DPO: '0.0', Leverage: '0.00', ICR: '0.00', Prijsfactor: '0.00', FTE: '#,0.0', NettoSchuld: '#,0', LTMEBITDA: '#,0', RCFHeadroom: '#,0', Adviesprijs2026: '#,0' };
const DATA_CATEGORY = { 'DimLand.Landnaam': 'Country', 'DimLand.ISO3166': 'Country' };
const HIERARCHIES = {
  DimDatum: [{ name: 'Kalender', levels: [['Jaar', 'Jaar'], ['Kwartaal', 'JaarKwartaal'], ['Maand', 'JaarMaand']] }]
};
const TABLE_DESCRIPTION = {
  DimDatum: `Datumtabel op dagniveau (${DATUM_JAREN[0]}-${DATUM_JAREN[1]}). Feiten staan op de eerste dag van de maand; feitrijen buiten dit bereik worden bij het laden weggefilterd.`,
  DimScenario: 'Scenario: Actual (t/m 2026-09), Budget (alleen 2026: verkoop, W&V en FTE) en Forecast (vanaf 2026-10).',
  DimProductlijn: 'Productlijnen City, Trek en Cargo.',
  DimKanaal: 'Verkoopkanalen met prijsfactor t.o.v. de adviesprijs.',
  DimLand: 'Landen: thuismarkt Nederland en export Duitsland/België.',
  DimAfdeling: 'Afdelingen voor de FTE-registratie.',
  DimRekening: 'Rekeningschema van de W&V. Teken (+1 opbrengst, -1 kosten) bepaalt de bijdrage aan het resultaat.',
  DimBalanspost: 'Balansposten met zijde (Activa/Passiva), presentatievolgorde en teken (+1 activa, -1 passiva en eigen vermogen, die negatief zijn opgeslagen). Statische dimensie, niet uit de generator.',
  FactVerkoop: 'Verkopen per maand, scenario, productlijn, kanaal en land (aantallen, omzet, kostprijs).',
  FactWinstVerlies: 'Winst- en verliesrekening in lang formaat: bedrag per rekening (kosten positief opgeslagen).',
  FactBalans: 'Balansstanden per maandeinde in lang formaat; passiva en eigen vermogen negatief opgeslagen.',
  FactKasstroom: 'Kasstroomoverzicht per maand in lang formaat (indirecte methode).',
  FactKPI: 'Werkkapitaal- en covenant-KPI\'s per maand zoals door het model gerapporteerd.',
  FactFTE: 'FTE per afdeling per maand.',
  Gebeurtenissen: 'Verklarende gebeurtenissen (storyline) met toelichting.'
};
// kolombeschrijvingen: per kolomnaam, met 'Tabel.Kolom' als uitzondering
const COLUMN_DESCRIPTION = {
  DatumKey: 'Sleutel naar DimDatum (yyyymmdd, eerste dag van de maand).',
  ScenarioKey: 'Sleutel naar DimScenario (1 Actual, 2 Budget, 3 Forecast).',
  ProductlijnKey: 'Sleutel naar DimProductlijn.', KanaalKey: 'Sleutel naar DimKanaal.', LandKey: 'Sleutel naar DimLand.',
  AfdelingKey: 'Sleutel naar DimAfdeling.', RekeningKey: 'Sleutel naar DimRekening (rekeningnummer).',
  'DimDatum.DatumKey': 'Datumsleutel yyyymmdd; relaties vanuit de feiten komen hier binnen.',
  Datum: 'Kalenderdatum (sleutel van de datumtabel).', Jaar: 'Kalenderjaar.', Kwartaal: 'Kwartaal (Q1-Q4).', JaarKwartaal: 'Jaar en kwartaal, bijvoorbeeld 2026-Q3.',
  Maandnummer: 'Maandnummer 1-12 (sorteerkolom voor Maand en MaandKort).', Maand: 'Maandnaam (Nederlands).', MaandKort: 'Maandnaam afgekort tot drie letters.',
  JaarMaand: 'Jaar en maand als yyyy-mm; de korrel van alle feiten.', JaarMaandSort: 'Sorteerkolom voor JaarMaand (yyyymm).',
  IsActual: '1 voor maanden tot en met de laatste gerealiseerde maand (2026-09), anders 0. Gebruikt door de A+F-maten.',
  Scenario: 'Actual, Budget of Forecast.', Volgorde: 'Sorteervolgorde voor de weergave.',
  Productlijn: 'City, Trek of Cargo.', Segment: 'Doelgroep van de productlijn.', Adviesprijs2026: 'Adviesprijs 2026 in euro.',
  Kanaal: 'Dealers, Webshop of Lease.', Type: 'Direct (webshop) of Indirect.', Prijsfactor: 'Gerealiseerde prijs als factor van de adviesprijs.',
  Land: 'Landcode (NL, DE, BE).', Landnaam: 'Landnaam voor kaartvisuals.', Regio: 'Thuismarkt of Export.', ISO3166: 'ISO 3166-1 alpha-2 landcode.',
  AfdelingCode: 'Korte afdelingscode.', Afdeling: 'Afdelingsnaam.',
  Rekening: 'Rekeningnaam uit het rekeningschema.', Rekeninggroep: 'Groep van rekeningen (Omzet, Kostprijs omzet, Personeelskosten, ...).',
  Niveau1: 'Hoogste indeling van de W&V (Omzet, Brutomarge, Operationele kosten, Afschrijvingen, Financieel, Belastingen).',
  Teken: '+1 voor opbrengsten/activa, -1 voor kosten/passiva.',
  Balanspost: 'Naam van de balanspost.', 'FactBalans.Balanspost': 'Balanspost (tekst); relatie naar DimBalanspost.', Zijde: 'Activa of Passiva.',
  Aantal: 'Aantal verkochte fietsen.', Omzet: 'Omzet in euro.', Kostprijs: 'Directe kostprijs in euro.',
  'FactWinstVerlies.Bedrag': 'Bedrag in euro; kosten positief opgeslagen, teken via DimRekening[Teken].',
  'FactBalans.Bedrag': 'Stand per maandeinde in euro; passiva en eigen vermogen negatief.',
  'FactKasstroom.Bedrag': 'Kasmutatie in euro (instroom +, uitstroom -).',
  Kasstroompost: 'Post van het kasstroomoverzicht (indirecte methode).',
  DSO: 'Debiteurendagen.', DIO: 'Voorraaddagen.', DPO: 'Crediteurendagen.',
  NettoSchuld: 'Netto schuld in euro (termijnlening + RCF - liquide middelen).', LTMEBITDA: 'EBITDA over de laatste twaalf maanden in euro.',
  Leverage: 'Netto schuld / LTM EBITDA; 99 bij schuld zonder positieve EBITDA, 0 bij netto kas zonder positieve EBITDA.', ICR: 'LTM EBITDA / LTM rentelasten, afgetopt op 99.',
  RCFHeadroom: 'Onbenutte ruimte onder de rekening-courantfaciliteit in euro.', Eenmalig: 'Omschrijving van de eenmalige post in de maand, indien van toepassing.',
  FTE: 'Aantal fte in de maand.',
  Titel: 'Korte titel van de gebeurtenis.', Soort: 'Soort gebeurtenis: Marge, Financiering, Eenmalig of Groei.', Toelichting: 'Toelichting op de gebeurtenis.'
};
// Engelse soortcodes uit de generator → Nederlandse labels (toegepast in de M-query van Gebeurtenissen)
const SOORT_NL = { margin: 'Marge', financing: 'Financiering', oneoff: 'Eenmalig', growth: 'Groei' };
const RELATIONSHIPS = [
  ['FactVerkoop', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactVerkoop', 'ScenarioKey', 'DimScenario', 'ScenarioKey'],
  ['FactVerkoop', 'ProductlijnKey', 'DimProductlijn', 'ProductlijnKey'], ['FactVerkoop', 'KanaalKey', 'DimKanaal', 'KanaalKey'], ['FactVerkoop', 'LandKey', 'DimLand', 'LandKey'],
  ['FactWinstVerlies', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactWinstVerlies', 'ScenarioKey', 'DimScenario', 'ScenarioKey'], ['FactWinstVerlies', 'RekeningKey', 'DimRekening', 'RekeningKey'],
  ['FactBalans', 'DatumKey', 'DimDatum', 'DatumKey'], ['FactBalans', 'ScenarioKey', 'DimScenario', 'ScenarioKey'], ['FactBalans', 'Balanspost', 'DimBalanspost', 'Balanspost'],
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
  const hidden = isKey || HIDDEN_COLUMNS.has(col) || HIDDEN_TABLE_COLUMNS.has(`${table}.${col}`);
  const summarize = SUM_COLUMNS.has(col) ? 'sum' : 'none';
  let format = COLUMN_FORMAT[col];
  if (!format) {
    if (type === 'date') format = 'dd-MM-yyyy';
    else if (SUM_COLUMNS.has(col)) format = '#,0';
    else if (type === 'int64' && !isKey) format = '0';
    else if (type === 'number') format = '#,0.00';
  }
  const lines = [];
  const desc = COLUMN_DESCRIPTION[`${table}.${col}`] ?? COLUMN_DESCRIPTION[col];
  if (desc) lines.push(descLines(desc, 1).trimEnd());
  lines.push(`${T}column ${ident(col)}`);
  lines.push(`${T}${T}dataType: ${TMDL_TYPE[type]}`);
  if (table === 'DimDatum' && col === 'Datum') lines.push(`${T}${T}isKey`);
  if (hidden) lines.push(`${T}${T}isHidden`);
  if (isKey) lines.push(`${T}${T}isAvailableInMdx: false`);
  if (format) lines.push(`${T}${T}formatString: ${format}`);
  const dataCategory = DATA_CATEGORY[`${table}.${col}`];
  if (dataCategory) lines.push(`${T}${T}dataCategory: ${dataCategory}`);
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

function calculatedColumnTmdl(table, c) {
  return [
    descLines(c.description, 1).trimEnd(),
    `${T}column ${ident(c.name)} = ${c.dax}`,
    `${T}${T}dataType: ${TMDL_TYPE[c.type]}`,
    `${T}${T}isHidden`,
    `${T}${T}formatString: 0`,
    `${T}${T}lineageTag: ${tag(`column:${table}.${c.name}`)}`,
    `${T}${T}summarizeBy: none`,
    '',
    `${T}${T}annotation SummarizationSetBy = User`,
    ''
  ].join('\n');
}

function hierarchyTmdl(table, h) {
  const lines = [`${T}hierarchy ${ident(h.name)}`, `${T}${T}lineageTag: ${tag(`hierarchy:${table}.${h.name}`)}`, ''];
  for (const [level, column] of h.levels) {
    lines.push(`${T}${T}level ${ident(level)}`, `${T}${T}${T}lineageTag: ${tag(`level:${table}.${h.name}.${level}`)}`, `${T}${T}${T}column: ${ident(column)}`, '');
  }
  return lines.join('\n');
}

function mSource(table, header, types) {
  const typeList = header.map((c, i) => `{"${c}", ${M_TYPE[types[i]]}}`).join(', ');
  const steps = [
    `    Bron = Csv.Document(File.Contents(CsvMap & "${table}.csv"), [Delimiter=",", Columns=${header.length}, Encoding=65001, QuoteStyle=QuoteStyle.Csv]),`,
    '    Kop = Table.PromoteHeaders(Bron, [PromoteAllScalars=true]),',
    `    Typen = Table.TransformColumnTypes(Kop, {${typeList}}, "en-US")`
  ];
  let last = 'Typen';
  if (table !== 'DimDatum' && header.includes('DatumKey')) {
    steps.push(`    Binnen = Table.SelectRows(${last}, each [DatumKey] >= ${MIN_DATUMKEY} and [DatumKey] <= ${MAX_DATUMKEY})`);
    last = 'Binnen';
  }
  if (table === 'Gebeurtenissen') {
    const map = Object.entries(SOORT_NL).map(([en, nl]) => `${en} = "${nl}"`).join(', ');
    steps.push(`    Soort = Table.TransformColumns(${last}, {{"Soort", each Record.FieldOrDefault([${map}], _, _), type text}})`);
    last = 'Soort';
  }
  return ['let', steps.map((s, i) => (i < steps.length - 1 && !s.endsWith(',') ? s + ',' : s)).join('\n'), 'in', `    ${last}`].join('\n');
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
  for (const c of CALCULATED_COLUMNS[table] ?? []) out += '\n' + calculatedColumnTmdl(table, c);
  for (const h of HIERARCHIES[table] ?? []) out += '\n' + hierarchyTmdl(table, h);
  out += `\n${T}partition ${ident(table)} = m\n${T}${T}mode: import\n${T}${T}source =\n${indentLines(mSource(table, header, types), 4)}\n\n`;
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
  out += `${T}partition _Maten = m\n${T}${T}mode: import\n${T}${T}source =\n${indentLines('let\n    Bron = #table(type table [Kolom1 = Int64.Type], {{1}})\nin\n    Bron', 4)}\n\n`;
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
    // alleen Power Query-query's: de calculation group heeft geen M-query
    `annotation PBI_QueryOrder = ${JSON.stringify(['CsvMap', ...TABLES, '_Maten'])}`,
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
const lit = v => ({ expr: { Literal: { Value: v } } });
function title(text) { return { title: [{ properties: { text: lit(`'${text.replace(/'/g, "''")}'`), show: lit('true') } }] }; }
const col = (src, prop) => ({ Column: { Expression: { SourceRef: { Source: src } }, Property: prop } });
const mea = (src, prop) => ({ Measure: { Expression: { SourceRef: { Source: src } }, Property: prop } });
const sel = (src, kind, table, prop) => ({ ...(kind === 'col' ? col(src, prop) : mea(src, prop)), Name: `${table}.${prop}` });
const byMonth = () => ({ Category: [{ queryRef: 'DimDatum.JaarMaand' }] });
function card(name, pos, measure) {
  return visual(name, pos, {
    visualType: 'card',
    projections: { Values: [{ queryRef: `_Maten.${measure}` }] },
    prototypeQuery: { Version: 2, From: [{ Name: 'm', Entity: '_Maten', Type: 0 }], Select: [sel('m', 'mea', '_Maten', measure)] },
    vcObjects: title(measure)
  });
}
// kolom- of lijngrafiek van een of meer maten per maand (DimDatum[JaarMaand])
function monthChart(visualType, name, pos, measures, titleText) {
  return visual(name, pos, {
    visualType,
    projections: { ...byMonth(), Y: measures.map(m => ({ queryRef: `_Maten.${m}` })) },
    prototypeQuery: {
      Version: 2,
      From: [{ Name: 'd', Entity: 'DimDatum', Type: 0 }, { Name: 'm', Entity: '_Maten', Type: 0 }],
      Select: [sel('d', 'col', 'DimDatum', 'JaarMaand'), ...measures.map(m => sel('m', 'mea', '_Maten', m))],
      OrderBy: [{ Direction: 1, Expression: col('d', 'JaarMaand') }]
    },
    vcObjects: title(titleText)
  });
}
const columnChart = (name, pos, measure, titleText) => monthChart('clusteredColumnChart', name, pos, [measure], titleText);
const lineChart = (name, pos, measures, titleText) => monthChart('lineChart', name, pos, measures, titleText);
// matrix met een of meer rijniveaus (uitklapbaar) uit één dimensie en maten in de waarden
function matrix(name, pos, rowTable, rowColumns, measures, titleText) {
  return visual(name, pos, {
    visualType: 'pivotTable',
    projections: { Rows: rowColumns.map(c => ({ queryRef: `${rowTable}.${c}` })), Values: measures.map(m => ({ queryRef: `_Maten.${m}` })) },
    prototypeQuery: {
      Version: 2,
      From: [{ Name: 'r', Entity: rowTable, Type: 0 }, { Name: 'm', Entity: '_Maten', Type: 0 }],
      Select: [...rowColumns.map(c => sel('r', 'col', rowTable, c)), ...measures.map(m => sel('m', 'mea', '_Maten', m))]
    },
    vcObjects: title(titleText)
  });
}
// slicer als lijst; opts.selected = DAX-literal van de standaardselectie ('Actual', 2026L), opts.single = één keuze tegelijk
function slicer(name, pos, table, column, opts = {}) {
  const objects = { data: [{ properties: { mode: lit("'Basic'") } }] };
  if (opts.single) objects.selection = [{ properties: { singleSelect: lit('true') } }];
  if (opts.selected !== undefined) {
    objects.general = [{ properties: { filter: { filter: {
      Version: 2,
      From: [{ Name: 's', Entity: table, Type: 0 }],
      Where: [{ Condition: { In: { Expressions: [col('s', column)], Values: [[{ Literal: { Value: opts.selected } }]] } } }]
    } } } }];
  }
  return visual(name, pos, {
    visualType: 'slicer',
    projections: { Values: [{ queryRef: `${table}.${column}` }] },
    prototypeQuery: { Version: 2, From: [{ Name: 's', Entity: table, Type: 0 }], Select: [sel('s', 'col', table, column)] },
    objects,
    vcObjects: title(opts.title ?? column)
  });
}
function page(name, displayName, ordinal, visuals) {
  return { name, displayName, filters: '[]', ordinal, visualContainers: visuals, config: '{}', displayOption: 1, width: 1280, height: 720 };
}
function reportJson() {
  const cardW = 236, cardH = 110, gap = 16, top = 24;
  let n = 0; const id = () => (++n).toString().padStart(4, '0');
  const cardsRow = (names) => names.map((m, i) => card(`c${id()}`, { x: 24 + i * (cardW + gap), y: top, w: cardW, h: cardH, tab: i }, m));
  // standaardselecties: scenario Actual (één keuze) en het laatste gerealiseerde jaar, zodat het rapport zinvol opent
  const scenarioSlicer = (pos) => slicer(`s${id()}`, pos, 'DimScenario', 'Scenario', { selected: "'Actual'", single: true });
  const jaarSlicer = (pos) => slicer(`s${id()}`, pos, 'DimDatum', 'Jaar', { selected: `${DEFAULT_JAAR}L` });
  const overzicht = page('ReportSection1', 'Overzicht', 0, [
    ...cardsRow(['Netto-omzet', 'EBITDA', 'EBITDA %', 'Nettowinst', 'Liquide middelen']),
    columnChart(`v${id()}`, { x: 24, y: 160, w: 900, h: 520, tab: 10 }, 'Netto-omzet', 'Netto-omzet per maand'),
    scenarioSlicer({ x: 948, y: 160, w: 308, h: 136, tab: 11 }),
    jaarSlicer({ x: 948, y: 312, w: 308, h: 176, tab: 12 }),
    slicer(`s${id()}`, { x: 948, y: 504, w: 308, h: 176, tab: 13 }, 'Tijdintelligentie', 'Tijdberekening', { selected: "'Actueel'", single: true, title: 'Tijdberekening (calculation group)' })
  ]);
  const wv = page('ReportSection2', 'Winst & verlies', 1, [
    ...cardsRow(['Netto-omzet', 'Brutomarge % (W&V)', 'Operationele kosten', 'EBITDA', 'Afwijking EBITDA vs budget (€)']),
    matrix(`m${id()}`, { x: 24, y: 160, w: 620, h: 520, tab: 10 }, 'DimRekening', ['Rekeninggroep', 'Rekening'], ['W&V bedrag', 'W&V bedrag Budget (t/m realisatie)'], 'Winst- en verliesrekening (uitklapbaar)'),
    columnChart(`v${id()}`, { x: 668, y: 160, w: 588, h: 344, tab: 11 }, 'EBITDA', 'EBITDA per maand'),
    scenarioSlicer({ x: 668, y: 520, w: 280, h: 160, tab: 12 }),
    jaarSlicer({ x: 972, y: 520, w: 284, h: 160, tab: 13 })
  ]);
  const balans = page('ReportSection3', 'Balans', 2, [
    ...cardsRow(['Totaal activa', 'Eigen vermogen', 'Netto schuld', 'Leverage', 'Covenantstatus']),
    matrix(`m${id()}`, { x: 24, y: 160, w: 620, h: 520, tab: 10 }, 'DimBalanspost', ['Zijde', 'Balanspost'], ['Balansstand (gepresenteerd)'], 'Balans (laatste stand in de periode)'),
    lineChart(`v${id()}`, { x: 668, y: 160, w: 588, h: 176, tab: 11 }, ['Leverage', 'Covenant leverage max'], 'Leverage vs covenant (max 3,0x)'),
    columnChart(`v${id()}`, { x: 668, y: 352, w: 588, h: 176, tab: 12 }, 'Vrije kasstroom', 'Vrije kasstroom per maand'),
    scenarioSlicer({ x: 668, y: 544, w: 280, h: 136, tab: 13 }),
    jaarSlicer({ x: 972, y: 544, w: 284, h: 136, tab: 14 })
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
console.log(`PBIP gebouwd: ${nFiles} tabellen, ${MEASURES.length} maten, ${CALC_ITEMS.length} calculation items, ${RELATIONSHIPS.length} relaties; datumbereik ${MIN_DATUMKEY}-${MAX_DATUMKEY}, standaardjaar ${DEFAULT_JAAR}.`);
