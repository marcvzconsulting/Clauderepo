/*
 * zip.js — minimale ZIP-schrijver voor de browser (en Node): STORE (geen compressie), CRC-32 (tabel), UTF-8-bestandsnamen
 * (general-purpose flag bit 11), lokale headers, central directory en end-of-central-directory record.
 *
 *   window.HZip.build([{ path: 'map/bestand.txt', content: 'tekst' | Uint8Array }, ...]) → Blob (application/zip)
 *   window.HZip.bytes(entries) → Uint8Array (zelfde inhoud, handig in Node)
 *
 * De DOS-datum/tijd van elk item is constant (2026-10-06 12:00) zodat een herbouw byte-voor-byte gelijk is.
 */
(function (root) {
  'use strict';

  // ---------- CRC-32 (IEEE 802.3, zoals in ZIP) ----------
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  // ---------- constante DOS-datum/tijd: 2026-10-06 12:00:00 ----------
  const DOS_TIME = (12 << 11) | (0 << 5) | 0;              // uur, minuut, seconde/2
  const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 6;   // jaar-1980, maand, dag
  const FLAG_UTF8 = 0x0800;                                 // general-purpose bit 11
  const VERSION = 20;                                       // 2.0: deflate/store, mappen

  const MAX_ENTRIES = 0xFFFF;                               // zonder ZIP64: hooguit 65535 items, 4 GB
  const MAX_SIZE = 0xFFFFFFFF;

  const encoder = new TextEncoder();                        // aanwezig in elke ondersteunde browser en in Node
  function toBytes(content) {
    if (content instanceof Uint8Array) return content;
    if (typeof ArrayBuffer !== 'undefined' && content instanceof ArrayBuffer) return new Uint8Array(content);
    return encoder.encode(content == null ? '' : String(content));
  }
  function normalizePath(p) { return String(p).replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/'); }

  function build(entries) {
    const bytes = buildBytes(entries);
    return new Blob([bytes], { type: 'application/zip' });
  }

  function buildBytes(entries) {
    const items = [];
    const seen = new Set();
    for (const e of entries || []) {
      if (!e || !e.path) continue;
      const path = normalizePath(e.path);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      const name = toBytes(path);
      const data = toBytes(e.content);
      if (name.length > MAX_ENTRIES) throw new Error('ZIP: bestandsnaam te lang (' + name.length + ' bytes, maximaal 65535): ' + path);
      if (data.length > MAX_SIZE) throw new Error('ZIP: bestand groter dan 4 GB; ZIP64 wordt niet ondersteund: ' + path);
      items.push({ name, data, crc: crc32(data) });
    }
    if (items.length > MAX_ENTRIES) throw new Error('ZIP: te veel bestanden (' + items.length + ', maximaal 65535); ZIP64 wordt niet ondersteund.');
    // omvang vooraf bepalen: lokaal = 30 + naam + data; central = 46 + naam; eocd = 22
    let localSize = 0, centralSize = 0;
    for (const it of items) { localSize += 30 + it.name.length + it.data.length; centralSize += 46 + it.name.length; }
    if (localSize + centralSize + 22 > MAX_SIZE) throw new Error('ZIP: archief groter dan 4 GB; ZIP64 wordt niet ondersteund.');
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let pos = 0;
    const u16 = v => { view.setUint16(pos, v & 0xFFFF, true); pos += 2; };
    const u32 = v => { view.setUint32(pos, v >>> 0, true); pos += 4; };
    const put = b => { out.set(b, pos); pos += b.length; };

    // lokale headers + data
    for (const it of items) {
      it.offset = pos;
      u32(0x04034b50); u16(VERSION); u16(FLAG_UTF8); u16(0); // signature, version needed, flags, compression = store
      u16(DOS_TIME); u16(DOS_DATE); u32(it.crc); u32(it.data.length); u32(it.data.length);
      u16(it.name.length); u16(0); // naamlengte, extra-lengte
      put(it.name); put(it.data);
    }
    // central directory
    const cdStart = pos;
    for (const it of items) {
      u32(0x02014b50); u16(VERSION); u16(VERSION); u16(FLAG_UTF8); u16(0); // signature, made by, needed, flags, compression
      u16(DOS_TIME); u16(DOS_DATE); u32(it.crc); u32(it.data.length); u32(it.data.length);
      u16(it.name.length); u16(0); u16(0); // naam, extra, commentaar
      u16(0); u16(0); u32(0);              // schijfnummer, interne attributen, externe attributen
      u32(it.offset);                      // offset lokale header
      put(it.name);
    }
    const cdSize = pos - cdStart;
    // end of central directory
    u32(0x06054b50); u16(0); u16(0); u16(items.length); u16(items.length); u32(cdSize); u32(cdStart); u16(0);
    return out;
  }

  const HZip = { build, bytes: buildBytes, crc32 };
  root.HZip = HZip;
  if (typeof module === 'object' && module && module.exports) module.exports = HZip;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
