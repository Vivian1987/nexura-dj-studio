// Carpetas soltadas → subcrates, en la app de escritorio real (main.js) con datos temporales y una carpeta
// de WAV sintéticos: Música/2020/{a,b}.wav, 2020/Verano/c.wav, 2020/Verano/Julio/d.wav, 2020/Vacía/ y
// 2020/Notas/leeme.txt (sin audio) + suelto.wav. El drop se simula con un DataTransfer cuyos File salen de un
// <input type=file> rellenado por CDP (DOM.setFileInputFiles), así webUtils.getPathForFile da la ruta real
// y se recorre el mismo camino que al soltar desde el Explorador.
// Uso: npx electron tools/ui-check-carpetas.cjs  → capturas e informe en .revision/carpetas/
'use strict';
const { app, BrowserWindow } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

const OUT = path.join(__dirname, '..', '.revision', 'carpetas');
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-carpetas-'));
app.setPath('userData', path.join(tmp, 'userData'));   // no toca la biblioteca ni los ajustes reales
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function wav(file, freq) {
  const sr = 22050, n = sr, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * i / sr) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
}
const M = path.join(tmp, 'Música');
const D2020 = path.join(M, '2020');
wav(path.join(D2020, 'Artista A - Uno.wav'), 220);
wav(path.join(D2020, 'Artista B - Dos.wav'), 330);
wav(path.join(D2020, 'Verano', 'Artista C - Tres.wav'), 440);
wav(path.join(D2020, 'Verano', 'Julio', 'Artista D - Cuatro.wav'), 550);
fs.mkdirSync(path.join(D2020, 'Vacía'), { recursive: true });
fs.mkdirSync(path.join(D2020, 'Notas'), { recursive: true });
fs.writeFileSync(path.join(D2020, 'Notas', 'leeme.txt'), 'sin audio');
const SUELTO = path.join(M, 'Artista E - Suelto.wav');
wav(SUELTO, 660);
const D2021 = path.join(M, '2021');
wav(path.join(D2021, 'Artista F - Seis.wav'), 770);

const report = [], errors = [];
const ok = (cond, msg) => { report.push((cond ? '✓ ' : '✗ ') + msg); if (!cond) errors.push(msg); };

app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, level, message, line, src) => { if (level >= 3) errors.push(`consola: ${message} (${path.basename(src || '')}:${line})`); });
});
require('../main.js');

const js = (wc, code) => wc.executeJavaScript(code, true);
const TREE = `nexuraApp.library.crateTree('custom', null, true).map(x => '  '.repeat(x.depth) + x.c.name + ' [' + x.c.ids.length + ']')`;

// Suelta «paths» (carpetas o archivos reales) sobre el elemento «sel» como lo haría el Explorador
async function drop(wc, sel, paths) {
  await js(wc, `(() => { let i = document.querySelector('#__drop'); if (!i) { i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.id = '__drop'; i.style.display = 'none'; document.body.append(i); } return true; })()`);
  const dbg = wc.debugger;
  const { root } = await dbg.sendCommand('DOM.getDocument', { depth: 0 });
  const { nodeId } = await dbg.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#__drop' });
  await dbg.sendCommand('DOM.setFileInputFiles', { nodeId, files: paths });
  return js(wc, `(async () => {
    const files = [...document.querySelector('#__drop').files];
    const dt = new DataTransfer(); for (const f of files) dt.items.add(f);
    const to = document.querySelector(${JSON.stringify(sel)});
    if (!to) return { error: 'sin destino ' + ${JSON.stringify(sel)} };
    const r = to.getBoundingClientRect(), o = { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 20, clientY: r.top + r.height / 2 };
    to.dispatchEvent(new DragEvent('dragover', o));
    to.dispatchEvent(new DragEvent('drop', o));
    await new Promise(res => setTimeout(res, 1500));
    return { rutas: files.map(f => window.nexura.pathForFile(f)) };
  })()`);
}

async function shot(win, name, w, h) {
  win.setContentSize(w, h);
  await wait(700);
  await js(win.webContents, `document.querySelector('#library').scrollIntoView({ block: 'end' }); { const s = document.querySelector('.lib-tree'), h = document.querySelector('.side-sec[title*="raíz"]'); if (s && h) s.scrollTop = h.parentElement.offsetTop - 4; } true`);
  win.webContents.invalidate();
  await wait(500);
  const [rw, rh] = win.getContentSize();   // la ventana tiene un ancho mínimo: se anota el tamaño real
  fs.writeFileSync(path.join(OUT, `${name}-${rw}x${rh}.png`), (await win.webContents.capturePage()).toPNG());
  report.push(`captura ${name}-${rw}x${rh}.png` + (rw !== w ? ` (pedido ${w}x${h}; ancho mínimo de la ventana)` : ''));
}

app.whenReady().then(async () => {
  let win;
  for (let i = 0; i < 40 && !(win = BrowserWindow.getAllWindows()[0]); i++) await wait(250);
  const wc = win.webContents;
  for (let i = 0; i < 40; i++) { if (await js(wc, '!!(window.nexuraApp && window.nexuraApp.library)').catch(() => false)) break; await wait(250); }
  await wait(1500);
  wc.debugger.attach('1.3');
  try {
    await js(wc, `nexuraApp.settings.autoAnalyze = false; nexuraApp.settings.welcomeSeen = true; document.querySelectorAll('.modal-back,.modal-bg').forEach(m => m.remove()); window.__dance = nexuraApp.library.createCrate('Dance').id; window.__techno = nexuraApp.library.createCrate('Techno').id; nexuraApp.libraryUI.setView('all'); nexuraApp.libraryUI.renderSide(); true`);
    await wait(600);
    report.push('Barra lateral: ' + await js(wc, `[...document.querySelectorAll('.side-item')].map(x => x.dataset.view).join(', ')`));
    report.push('Carpeta de prueba: ' + M);

    // 1) carpeta «2020» + archivo suelto sobre la crate «Dance» de la barra lateral
    const r1 = await drop(wc, '.side-item[data-view="crate:' + await js(wc, '__dance') + '"]', [D2020, SUELTO]);
    ok(r1.rutas && r1.rutas[0] === D2020, 'el File de la carpeta trae su ruta real (webUtils.getPathForFile): ' + JSON.stringify(r1));
    const s1 = await js(wc, `(() => { const L = nexuraApp.library, P = (id) => L.crates.find(c => c.id === id), by = (lbl) => L.crates.find(c => nexuraApp.libraryUI.crateLabel(c) === lbl);
      const names = (c) => c ? c.ids.map(i => L.get(i).title) : null;
      return { tree: ${TREE}, dance: names(P(__dance)), y2020: names(by('Dance › 2020')), verano: names(by('Dance › 2020 › Verano')), julio: names(by('Dance › 2020 › Verano › Julio')),
        vacia: !!L.crates.find(c => c.name === 'Vacía' || c.name === 'Notas'), pistas: L.tracks.size, total: L.crateTrackIds(__dance).length }; })()`);
    report.push('Árbol tras soltar 2020 + suelto en Dance:\n    ' + s1.tree.join('\n    '));
    ok(JSON.stringify(s1.dance) === JSON.stringify(['Suelto']), 'el archivo suelto va a Dance (y solo él): ' + JSON.stringify(s1.dance));
    ok(JSON.stringify(s1.y2020) === JSON.stringify(['Uno', 'Dos']), 'Dance › 2020 = Uno, Dos: ' + JSON.stringify(s1.y2020));
    ok(JSON.stringify(s1.verano) === JSON.stringify(['Tres']), 'Dance › 2020 › Verano = Tres: ' + JSON.stringify(s1.verano));
    ok(JSON.stringify(s1.julio) === JSON.stringify(['Cuatro']), 'Dance › 2020 › Verano › Julio = Cuatro: ' + JSON.stringify(s1.julio));
    ok(!s1.vacia, 'las carpetas sin audio (Vacía, Notas) no crean crate');
    ok(s1.pistas === 5 && s1.total === 5, `5 pistas en la biblioteca y en Dance con subcrates (${s1.pistas}, ${s1.total})`);
    await js(wc, `nexuraApp.libraryUI.setView('crate:' + nexuraApp.library.crates.find(c => c.name === '2020').id); true`);
    await shot(win, '1-dance-2020', 1280, 800);
    await shot(win, '1-dance-2020', 375, 812);
    win.setContentSize(1280, 800); await wait(500);

    // 2) otra vez lo mismo: sin duplicar crates ni pistas
    const n0 = await js(wc, 'nexuraApp.library.crates.length');
    await drop(wc, '.side-item[data-view="crate:' + await js(wc, '__dance') + '"]', [D2020]);
    const s2 = await js(wc, `({ crates: nexuraApp.library.crates.length, pistas: nexuraApp.library.tracks.size, y: nexuraApp.library.crates.find(c => c.name === '2020').ids.length })`);
    ok(s2.crates === n0 && s2.pistas === 5 && s2.y === 2, `soltar de nuevo no duplica (${s2.crates} crates, ${s2.pistas} pistas)`);

    // 3) sobre la cabecera CRATES → «2021» en la raíz
    await drop(wc, '.side-sec[title*="raíz"]', [D2021]);
    const s3 = await js(wc, `(() => { const c = nexuraApp.library.crates.find(c => c.name === '2021'); return c && { parent: c.parent, n: c.ids.length }; })()`);
    ok(s3 && s3.parent === null && s3.n === 1, 'soltar en «CRATES» crea «2021» en la raíz: ' + JSON.stringify(s3));

    // 4) sobre la tabla en «Todas las pistas» → solo a la biblioteca
    const n4 = await js(wc, 'nexuraApp.library.crates.length');
    await js(wc, `nexuraApp.library.remove(nexuraApp.library.crates.find(c => c.name === '2021').ids); nexuraApp.library.deleteCrate(nexuraApp.library.crates.find(c => c.name === '2021').id); nexuraApp.libraryUI.setView('all'); true`);
    await drop(wc, '.lib-main', [D2021]);
    const s4 = await js(wc, `({ crates: nexuraApp.library.crates.length, pista: !!nexuraApp.library.byPath(${JSON.stringify(path.join(D2021, 'Artista F - Seis.wav'))}) })`);
    ok(s4.crates === n4 - 1 && s4.pista, 'soltar en la tabla («Todas las pistas») añade la pista sin crear crates');

    // 5) sobre la tabla con la crate «Techno» abierta → Techno › 2021
    await js(wc, `nexuraApp.libraryUI.setView('crate:' + __techno); true`);
    await drop(wc, '.lib-main', [D2021]);
    const s5 = await js(wc, `(() => { const c = nexuraApp.library.crates.find(c => c.name === '2021'); return c && { padre: c.parent === __techno, n: c.ids.length }; })()`);
    ok(s5 && s5.padre && s5.n === 1, 'soltar en la tabla con «Techno» abierta crea Techno › 2021 (pista ya existente asignada)');

    // 6) «+ Carpeta» (mismo IPC que el diálogo: árbol de la carpeta) dentro de la crate abierta
    const s6 = await js(wc, `(async () => { const t = await window.nexura.listAudioTree([${JSON.stringify(M)}]); await nexuraApp.importTree(t, __techno);
      const m = nexuraApp.library.crates.find(c => c.name === 'Música'); return m && { padre: m.parent === __techno, sub: nexuraApp.library.crateTree('custom', null, true).filter(x => nexuraApp.library.subcrateIds(m.id).includes(x.c.id)).map(x => x.c.name), suelto: m.ids.length }; })()`);
    ok(s6 && s6.padre && s6.suelto === 1 && s6.sub.join(',') === '2020,Verano,Julio,2021', '«+ Carpeta» con la crate Techno abierta: Techno › Música › 2020 › Verano › Julio + 2021: ' + JSON.stringify(s6));

    // 7) biblioteca protegida: solo añade y avisa
    await js(wc, `nexuraApp.setSetting('protectLibrary', true); true`);
    const n7 = await js(wc, 'nexuraApp.library.crates.length');
    const D2022 = path.join(M, '..', '2022');
    wav(path.join(D2022, 'Artista G - Siete.wav'), 880);
    await drop(wc, '.side-item[data-view="crate:' + await js(wc, '__dance') + '"]', [D2022]);
    const s7 = await js(wc, `({ crates: nexuraApp.library.crates.length, pista: !!nexuraApp.library.byPath(${JSON.stringify(path.join(D2022, 'Artista G - Siete.wav'))}), aviso: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') })`);
    ok(s7.crates === n7 && s7.pista && /protegida/i.test(s7.aviso), 'biblioteca protegida: añade la pista, no crea crates y avisa: ' + s7.aviso);
    await shot(win, '2-protegida', 1280, 800);
    await js(wc, `nexuraApp.setSetting('protectLibrary', false); nexuraApp.libraryUI.setView('crate:' + __dance); true`);
    report.push('Árbol final:\n    ' + (await js(wc, TREE)).join('\n    '));
    await shot(win, '3-final', 1280, 800);
  } catch (e) { errors.push('prueba: ' + (e && e.stack || e)); }
  const txt = report.join('\n') + '\n\n' + (errors.length ? 'ERRORES:\n' + errors.join('\n') : 'Sin errores');
  fs.writeFileSync(path.join(OUT, 'informe.txt'), txt);
  console.log(txt);
  app.exit(errors.length ? 1 : 0);
});
