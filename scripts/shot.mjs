/*
 * Screenshots + consolefouten van de cockpit via Playwright/Chromium.
 *   node scripts/shot.mjs [tab] [--out dir] [--all]
 * Maakt desktop (1360×900) en mobiel (400×860) in licht en donker.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
for (const cand of ['playwright', '/opt/node22/lib/node_modules/playwright', '/opt/node-tools/node_modules/playwright']) { try { ({ chromium } = require(cand)); break; } catch (e) { } }
if (!chromium) { console.error('playwright niet gevonden'); process.exit(2); }
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : join(ROOT, '..', '..', '..', '..', 'tmp-shots');
const all = args.includes('--all');
const tabs = all ? ['overzicht', 'wv', 'balans', 'scenario', 'risico', 'waardering', 'analist', 'powerbi'] : [args.find(a => !a.startsWith('--') && a !== OUT) || 'overzicht'];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.csv': 'text/csv' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  try { const data = await readFile(join(ROOT, 'cockpit', p)); res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(data); }
  catch (e) { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, r));
const port = server.address().port;
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const errors = [];
for (const tab of tabs) {
  for (const [name, vp] of [['desktop', { width: 1360, height: 900 }], ['mobile', { width: 400, height: 860 }]]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${tab}/${name}/${scheme}] console.${m.type()}: ${m.text()}`); });
      page.on('pageerror', e => errors.push(`[${tab}/${name}/${scheme}] pageerror: ${e.message}`));
      page.on('requestfailed', r => { if (!r.url().includes('fonts.g')) errors.push(`[${tab}/${name}/${scheme}] requestfailed: ${r.url()}`); });
      await page.goto(`http://127.0.0.1:${port}/index.html#${tab}`, { waitUntil: 'load' });
      await page.waitForTimeout(900);
      const overflow = await page.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, h: document.documentElement.scrollHeight }));
      if (overflow.scrollW > overflow.clientW + 1) errors.push(`[${tab}/${name}/${scheme}] horizontale overflow: ${overflow.scrollW} > ${overflow.clientW}`);
      await page.screenshot({ path: join(OUT, `${tab}-${name}-${scheme}.png`), fullPage: true });
      await ctx.close();
      console.log(`${tab} ${name} ${scheme}: hoogte ${overflow.h}px`);
    }
  }
}
await browser.close(); server.close();
if (errors.length) { console.log('\nPROBLEMEN:'); for (const e of errors) console.log(' -', e); process.exitCode = 1; } else console.log('\nGeen consolefouten of overflow.');
