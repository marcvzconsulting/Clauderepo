/*
 * Bundelt het Power BI-project (powerbi/) als tekstbestanden in cockpit/data/pbip.js, zodat de cockpit het project
 * volledig in de browser als ZIP kan aanbieden (geen netwerk nodig).
 *
 *   node scripts/build-pbip-bundle.mjs
 *
 * Schrijft:  window.HELDER_PBIP = { generatedAt: 'YYYY-MM-DD', files: { 'pad/relatief/aan/powerbi': inhoud, ... } };
 * Neemt mee: alle tekstbestanden (TMDL, JSON, MD, MJS, CSV, .pbip/.pbism/.pbir/.platform).
 * Slaat over: node_modules, tijdelijke uitvoer van validate.mjs en binaire bestanden.
 */
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'powerbi');
const OUT = join(ROOT, 'cockpit', 'data', 'pbip.js');

/** datum van de bundel (YYYY-MM-DD): de laatste commit die powerbi/ raakte als de map schoon is, anders de nieuwste mtime van de gebundelde bestanden */
function generatedAt(fileList) {
  try {
    const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (git('status', '--porcelain', '--', 'powerbi') === '') { const d = git('log', '-1', '--format=%cs', '--', 'powerbi'); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d; }
  } catch (e) { /* geen git of geen repository: val terug op mtime */ }
  let latest = 0;
  for (const f of fileList) latest = Math.max(latest, statSync(f).mtimeMs);
  return new Date(latest || Date.now()).toISOString().slice(0, 10);
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.cache']);
const SKIP_FILES = [/^validate-.*\.(log|txt|json)$/i, /\.log$/i, /^\.DS_Store$/];

function walk(dir, out) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full, out); continue; }
    if (!st.isFile()) continue;
    if (SKIP_FILES.some(re => re.test(name))) continue;
    out.push(full);
  }
  return out;
}

const files = {};
let bytes = 0, skipped = [], bundled = [];
for (const full of walk(SRC, [])) {
  const buf = readFileSync(full);
  if (buf.includes(0)) { skipped.push(relative(SRC, full)); continue; } // binair
  const rel = relative(SRC, full).split(sep).join('/');
  const text = buf.toString('utf8');
  files[rel] = text;
  bytes += buf.length;
  bundled.push(full);
}
const payload = { generatedAt: generatedAt(bundled), files };
const js = '/* Gegenereerd door scripts/build-pbip-bundle.mjs — het Power BI-project (powerbi/) als tekstbestanden; niet handmatig bewerken. */\n'
  + 'window.HELDER_PBIP = ' + JSON.stringify(payload) + ';\n';
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, js);
const n = Object.keys(files).length;
console.log(`cockpit/data/pbip.js geschreven: ${n} bestanden, ${(bytes / 1024).toFixed(0)} KB inhoud, ${(js.length / 1024).toFixed(0)} KB JS`);
if (skipped.length) console.log('overgeslagen (binair):', skipped.join(', '));
