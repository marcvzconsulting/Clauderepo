/*
 * Maakt van cockpit/index.html een artifact-fragment (cockpit/artifact.html) voor publicatie op claude.ai:
 * zonder doctype/html/head/body (de artifact-skeleton voegt die toe), mét title, fonts-link, style en alle body-inhoud.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'cockpit/index.html'), 'utf8');
const pick = (re) => { const m = re.exec(html); if (!m) throw new Error('niet gevonden: ' + re); return m[0]; };
const title = pick(/<title>[\s\S]*?<\/title>/);
const links = [...html.matchAll(/<link[^>]*>/g)].map(m => m[0]).filter(l => /fonts\.googleapis|preconnect/.test(l));
const style = pick(/<style>[\s\S]*?<\/style>/);
const body = /<body>([\s\S]*?)<\/body>/.exec(html)[1].trim();
const out = `${title}\n${links.join('\n')}\n${style}\n${body}\n`;
writeFileSync(join(ROOT, 'cockpit/artifact.html'), out);
console.log('cockpit/artifact.html geschreven:', (out.length / 1024).toFixed(0), 'KB');
