// Prueba de los IPC de archivos de la fase 1 (carátula APIC/PICTURE, existencia por lotes) con archivos
// sintéticos y datos temporales. Uso: npx electron tools/art-check.cjs
'use strict';
const { app, nativeImage } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-art-'));
app.setPath('userData', path.join(tmp, 'data'));

const synch = (n) => Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
function files() {
  // imagen roja de 300×200 en PNG
  const bmp = Buffer.alloc(300 * 200 * 4); for (let i = 0; i < bmp.length; i += 4) { bmp[i + 2] = 255; bmp[i + 3] = 255; }
  const png = nativeImage.createFromBitmap(bmp, { width: 300, height: 200 }).toPNG();
  // ID3v2.3 con APIC (UTF-16 con descripción) + TIT2
  const apicBody = Buffer.concat([Buffer.from([1]), Buffer.from('image/png\0', 'latin1'), Buffer.from([3]), Buffer.from([0xFF, 0xFE]), Buffer.from('Portada', 'utf16le'), Buffer.from([0, 0]), png]);
  const frame = (id, body) => Buffer.concat([Buffer.from(id, 'latin1'), u32(body.length), Buffer.from([0, 0]), body]);
  const tags = Buffer.concat([frame('TIT2', Buffer.from('\0Prueba', 'latin1')), frame('APIC', apicBody)]);
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), synch(tags.length), tags, Buffer.alloc(2000)]);
  const pMp3 = path.join(tmp, 'con caratula.mp3'); fs.writeFileSync(pMp3, mp3);
  // FLAC con STREAMINFO vacío y bloque PICTURE (último)
  const pic = Buffer.concat([u32(3), u32(9), Buffer.from('image/png'), u32(0), u32(300), u32(200), u32(32), u32(0), u32(png.length), png]);
  const flac = Buffer.concat([Buffer.from('fLaC'), Buffer.from([0x00, 0, 0, 34]), Buffer.alloc(34), Buffer.from([0x86, (pic.length >> 16) & 255, (pic.length >> 8) & 255, pic.length & 255]), pic]);
  const pFlac = path.join(tmp, 'con caratula.flac'); fs.writeFileSync(pFlac, flac);
  const pNone = path.join(tmp, 'sin caratula.mp3'); fs.writeFileSync(pNone, Buffer.alloc(3000));
  return { pMp3, pFlac, pNone };
}

app.on('web-contents-created', (_e, wc) => {
  wc.on('did-finish-load', async () => {
    const f = files();
    const r = await wc.executeJavaScript(`(async () => {
      const N = window.nexura, info = async (u) => { if (!u) return null; const i = new Image(); i.src = u; await i.decode(); return i.width + 'x' + i.height; };
      return {
        mp3: await info(await N.artGet('mp3a', ${JSON.stringify(f.pMp3)})),
        mp3Cache: await info(await N.artGet('mp3a', ${JSON.stringify(f.pMp3)})),
        flac: await info(await N.artGet('flaca', ${JSON.stringify(f.pFlac)})),
        sin: await N.artGet('nonea', ${JSON.stringify(f.pNone)}),
        idMalo: await N.artGet('../x', ${JSON.stringify(f.pMp3)}),
        existe: await N.existsMany([${JSON.stringify(f.pMp3)}, ${JSON.stringify(path.join(tmp, 'no.mp3'))}]),
        etiquetas: (await N.infoForPaths([${JSON.stringify(f.pMp3)}]))[0]?.title
      };
    })()`);
    const cache = fs.readdirSync(path.join(tmp, 'data', 'data', 'art')).sort();
    console.log(JSON.stringify({ ...r, cache }, null, 2));
    const ok = r.mp3 === '96x64' && r.mp3Cache === '96x64' && r.flac === '96x64' && r.sin === null && r.idMalo === null && r.existe[0] === true && r.existe[1] === false && r.etiquetas === 'Prueba';
    console.log(ok ? '✓ carátulas (APIC y PICTURE), caché y existencia por lotes' : '✗ fallo');
    app.exit(ok ? 0 : 1);
  });
});
require('../main.js');
