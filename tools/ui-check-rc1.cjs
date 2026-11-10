// 1.0-rc1 en la interfaz, con Electron contra `npm run web` (1280×800 y 375×812):
// A) bienvenida la primera vez (4 pasos, estadísticas marcadas y explicadas, «Empezar» guarda las opciones;
//    al recargar ya no sale) y «Saltar» (estadísticas desactivadas);
// B) menú de ayuda «?» y diálogo «Enviar informe o sugerencia»: tipos, email, «Adjuntar registro técnico» con
//    la vista previa SIN rutas ni canciones, envío (simulado) con y sin registro y alternativa por correo;
// C) Ajustes → General (actualizaciones, estadísticas con lo que se envía), Biblioteca (copias: solo
//    escritorio) y Acerca de (licencia, privacidad, terceros).
// Capturas e informe en .revision/rc1/. Uso: npx electron tools/ui-check-rc1.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '.revision', 'rc1');
const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const SIZES = [[1280, 800], [375, 812]];
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const track = (id, title, artist) => ({
  id, path: `web:${artist} - ${title}.mp3:1`, source: 'local', title, artist, album: '', genre: 'House', year: '2024', comment: '', rating: 0,
  bpm: 124, firstBeat: 0.1, key: '', camelot: '8A', duration: 200, size: 1, rmsDb: -10, cues: Array(8).fill(null), loops: Array(8).fill(null),
  cueLoops: Array(8).fill(null), added: Date.now(), plays: 0, lastPlayed: 0, analyzed: true, energy: 5, sections: []
});
const LIB = { version: 1, tracks: [track('t1', 'Titanium', 'David Guetta'), track('t2', 'Seek Bromance', 'Tim Berg'), track('t3', 'One More Time', 'Daft Punk')],
  crates: [{ id: 'c1', name: 'Boda de Lucía', ids: ['t1'], created: Date.now() }], smart: [], history: [], prepare: [], ytPlaylists: [] };

const load = async (win) => { for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); return; } catch (e) { await wait(800); } } throw new Error('no se pudo cargar ' + URL); };
const js = (win, code) => win.webContents.executeJavaScript(code, true).catch(e => ({ error: String(e && e.message || e) }));
async function shot(win, name) {
  win.webContents.invalidate();
  await wait(400);
  fs.writeFileSync(path.join(OUT, name + '.png'), (await win.webContents.capturePage()).toPNG());
  console.log('captura', name);
}
// settings = null → primera vez (sin ajustes guardados)
async function open(win, settings) {
  const put = `localStorage.clear(); localStorage.setItem('nexura_library', ${JSON.stringify(JSON.stringify(LIB))});` +
    (settings ? ` localStorage.setItem('nexura_settings', ${JSON.stringify(JSON.stringify(settings))});` : '');
  await js(win, `${put} true`);
  await load(win);
  await wait(2200);
  await js(win, `document.querySelector('.start-overlay')?.remove(); true`);
  win.focus(); win.webContents.focus();
}
const click = (win, sel) => js(win, `(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
const clickText = (win, scope, re) => js(win, `(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find(x => ${re}.test(x.textContent) && x.offsetParent); if (!b) return false; b.click(); return true; })()`);
const overflow = (win) => js(win, `(() => { const m = document.querySelector('.modal-ov:last-of-type .modal'); if (!m) return null; const r = m.getBoundingClientRect(); const b = m.querySelector('.modal-body') || m;
  return { left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, scrollW: document.documentElement.scrollWidth, inner: Math.max(m.scrollWidth - m.clientWidth, b.scrollWidth - b.clientWidth) }; })()`);
const fits = (o) => o && o.left >= 0 && o.right <= o.vw && o.inner <= 1;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const report = { errors: [], checks: {}, ok: true };
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const check = (name, cond, data) => { report.checks[`${tag} · ${name}`] = { ok: !!cond, ...data }; if (!cond) { report.ok = false; console.log('✗', tag, name, JSON.stringify(data)); } else console.log('✓', tag, name); };
    const win = new BrowserWindow({ width: w, height: h, useContentSize: true, show: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false, offscreen: true } });
    win.webContents.on('console-message', (_e, level, message, line, src) => { if (level >= 3) report.errors.push(`${tag} ${message} (${path.basename(src || '')}:${line})`); });
    await load(win);

    // ---------------- A) bienvenida
    await open(win, null);
    let s = await js(win, `(() => ({ open: !!document.querySelector('#welcome'), title: document.querySelector('#wl-title')?.textContent, count: document.querySelector('.wl-count')?.textContent, free: document.querySelector('.wl-free')?.textContent || '' }))()`);
    await shot(win, `${tag}-01-bienvenida-1`);
    check('La primera vez aparece la bienvenida (paso 1 de 4, «gratis»)', s.open && /Bienvenido/.test(s.title) && /1 de 4/.test(s.count) && /gratis/i.test(s.free), s);
    check('Bienvenida sin desbordar la pantalla', fits(await overflow(win)), { o: await overflow(win) });
    const titles = [];
    for (let i = 0; i < 3; i++) { await clickText(win, '.welcome .btn', '/^Siguiente$/'); await wait(150); titles.push(await js(win, `document.querySelector('#wl-title').textContent`)); if (i < 2) await shot(win, `${tag}-0${i + 2}-bienvenida-${i + 2}`); }
    s = await js(win, `(() => { const st = document.querySelector('#wl-stats'), up = document.querySelector('#wl-updates'); const txt = st?.closest('label')?.textContent || '';
      return { stats: st?.checked, statsVisible: !!st?.offsetParent, txt, upd: up?.checked, btn: [...document.querySelectorAll('.welcome .btn')].filter(b => b.offsetParent).map(b => b.textContent) }; })()`);
    await shot(win, `${tag}-04-bienvenida-4`);
    check('Pasos: música (carpeta → crates), controladora, privacidad', /música/i.test(titles[0]) && /controladora/i.test(titles[1]) && /Privacidad/.test(titles[2]), { titles });
    check('Estadísticas: casilla marcada, visible y explicada (qué se envía)', s.stats === true && s.statsVisible && /identificador aleatorio/.test(s.txt) && /Windows 10 u 11/.test(s.txt) && /sí\/no/.test(s.txt), { s });
    check('Actualizaciones automáticas marcadas y botón «Empezar»', s.upd === true && s.btn.includes('Empezar') && !s.btn.includes('Saltar'), { btn: s.btn });
    await click(win, '#wl-stats'); // el usuario la desmarca
    await clickText(win, '.welcome .btn', '/^Empezar$/');
    await wait(300);
    s = await js(win, `(() => ({ open: !!document.querySelector('#welcome'), stats: nexuraApp.settings.statsEnabled, upd: nexuraApp.settings.autoUpdate, done: nexuraApp.settings.welcomeDone }))()`);
    check('«Empezar» guarda las elecciones (estadísticas desmarcadas = no)', !s.open && s.stats === false && s.upd === true && s.done === true, s);
    await js(win, `nexuraApp.saveSettingsSoon(); true`); await wait(600);
    const saved = await js(win, `localStorage.getItem('nexura_settings')`);
    await load(win); await wait(2000);
    s = await js(win, `!!document.querySelector('#welcome')`);
    check('Al volver a abrir ya no aparece', s === false && /welcomeDone":true/.test(saved), {});
    await open(win, null);
    await clickText(win, '.welcome .btn', '/^Saltar$/');
    await wait(200);
    s = await js(win, `(() => ({ open: !!document.querySelector('#welcome'), stats: nexuraApp.settings.statsEnabled, done: nexuraApp.settings.welcomeDone }))()`);
    check('«Saltar»: se cierra y las estadísticas quedan desactivadas', !s.open && s.stats === false && s.done === true, s);

    // ---------------- B) menú de ayuda e informe
    await js(win, `console.error('No se pudo abrir el archivo: C:\\\\Users\\\\Pepe\\\\Music\\\\David Guetta - Titanium.mp3 (código 5)'); console.warn('Cargando «Boda de Lucía» · pepe@correo.es'); true`);
    await wait(700);
    await click(win, '.help-btn');
    await wait(150);
    const items = await js(win, `[...document.querySelectorAll('.ctx.root > .ctx-item')].map(x => x.textContent)`);
    await shot(win, `${tag}-05-menu-ayuda`);
    check('Menú de ayuda con «Enviar informe o sugerencia», bienvenida, licencia y privacidad', items.some(t => /Enviar informe o sugerencia/.test(t)) && items.some(t => /Ver bienvenida/.test(t)) && items.some(t => /Licencia/.test(t)) && items.some(t => /privacidad/i.test(t)), { items });
    await js(win, `(() => { const it = [...document.querySelectorAll('.ctx-item')].find(x => /Enviar informe/.test(x.textContent)); it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); return true; })()`);
    await wait(900);
    s = await js(win, `(() => ({ title: document.querySelector('.modal-head h2')?.textContent, kinds: [...document.querySelectorAll('#fb-kind option')].map(o => o.textContent), email: !!document.querySelector('#fb-email'),
      attach: document.querySelector('#fb-attach')?.checked, preview: document.querySelector('#fb-preview')?.textContent || '' }))()`);
    await shot(win, `${tag}-06-informe`);
    check('Diálogo: Error / Sugerencia / Otro, email opcional y «Adjuntar registro técnico» marcado', /Enviar informe o sugerencia/.test(s.title) && s.kinds.join() === 'Error,Sugerencia,Otro' && s.email && s.attach === true, s);
    check('La vista previa enseña versión, sistema, controladora y el registro', /Versión:/.test(s.preview) && /Controladora MIDI:/.test(s.preview) && /No se pudo abrir el archivo/.test(s.preview), { preview: s.preview.slice(-400) });
    check('La vista previa no lleva rutas, canciones, artistas, crates ni correos', !/Titanium|Guetta|Pepe|Music|\.mp3|Boda de Lucía|correo\.es/.test(s.preview) && /<ruta>/.test(s.preview), { preview: s.preview.slice(-400) });
    check('Diálogo de informe sin desbordar', fits(await overflow(win)), { o: await overflow(win) });
    await click(win, '#fb-attach');
    s = await js(win, `document.querySelector('#fb-preview').hidden`);
    check('Desmarcar «Adjuntar registro» oculta la vista previa', s === true, {});
    // envío simulado (sin registro)
    await js(win, `window.__sent = []; window.__nexuraReportMock = { send: async (info) => { window.__sent.push(info); return { ok: true, via: 'web' }; } };
      document.querySelector('#fb-kind').value = 'error'; document.querySelector('#fb-text').value = 'El jog va con retraso'; document.querySelector('#fb-email').value = 'dj@example.com'; true`);
    await clickText(win, '.modal-foot .btn', '/^Enviar$/');
    await wait(400);
    s = await js(win, `(() => { const i = window.__sent[0] || {}; return { kind: i.kind, text: i.text, email: i.email, attach: i.attach, decks: i.decks, keys: Object.keys(i).sort().join(','), toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }; })()`);
    check('Envía tipo, texto, email y attach=false; da las gracias', s.kind === 'error' && s.text === 'El jog va con retraso' && s.email === 'dj@example.com' && s.attach === false && /Gracias/.test(s.toast), s);
    // sin servicio: alternativa por correo + archivo
    await js(win, `window.__nexuraReportMock = { send: async (info) => { window.__sent.push(info); return { ok: false, via: 'mail', file: 'C:\\\\Users\\\\x\\\\AppData\\\\Roaming\\\\Nexura DJ Studio\\\\informes\\\\informe-2026-11-10_1200.txt' }; } }; nexuraApp.feedback.open('idea'); true`);
    await wait(700);
    await js(win, `document.querySelector('#fb-text').value = 'Más efectos de eco'; true`);
    await clickText(win, '.modal-foot .btn', '/^Enviar$/');
    await wait(500);
    s = await js(win, `(() => ({ title: document.querySelector('.modal-head h2')?.textContent, body: document.querySelector('.modal-body')?.textContent || '', attach: window.__sent[1]?.attach, kind: window.__sent[1]?.kind }))()`);
    await shot(win, `${tag}-07-informe-correo`);
    check('Sin servicio: abre el correo y dice dónde está el .txt para adjuntar', /correo/i.test(s.title) && /contacto@nexuraia\.com/.test(s.body) && /informe-2026-11-10_1200\.txt/.test(s.body) && s.attach === true && s.kind === 'idea', s);
    await js(win, `nexuraApp.closeModal(); true`);

    // ---------------- C) Ajustes
    await js(win, `nexuraApp.settingsUI.open('general'); true`);
    await wait(500);
    s = await js(win, `(() => ({ tabs: [...document.querySelectorAll('.set-tab')].map(t => t.textContent), page: document.querySelector('.set-page')?.textContent || '', preview: document.querySelector('#set-stats-preview')?.textContent || '' }))()`);
    await shot(win, `${tag}-08-ajustes-general`);
    check('Ajustes → General: actualizaciones automáticas, versiones de prueba, «Buscar ahora», estadísticas y bienvenida', s.tabs[0] === 'General' && /Buscar actualizaciones automáticamente/.test(s.page) && /Recibir versiones de prueba/.test(s.page) && /Buscar ahora/.test(s.page) && /Enviar estadísticas anónimas de uso/.test(s.page) && /Ver bienvenida/.test(s.page) && !/\bnull\b|undefined/.test(s.page), { tabs: s.tabs });
    let keys = null; try { keys = Object.keys(JSON.parse(s.preview)).sort().join(','); } catch (_) { /* no es JSON */ }
    check('Ajustes enseña exactamente lo que se envía (6 campos)', keys === 'controller,decks,id,lang,os,version', { keys });
    await click(win, '#set-upd-check'); await wait(300);
    s = await js(win, `document.querySelector('#set-upd-state')?.textContent`);
    check('«Buscar ahora» en el navegador explica que solo funciona instalada', /solo funcionan en la app instalada/.test(s), { s });
    await clickText(win, '.set-tab', '/^Biblioteca$/'); await wait(300);
    s = await js(win, `document.querySelector('.set-page').textContent`);
    check('Biblioteca → «Copias de seguridad» (en el navegador, aviso de solo escritorio)', /Copias de seguridad/.test(s) && /solo están disponibles en la app de escritorio/.test(s), {});
    await clickText(win, '.set-tab', '/^Acerca de$/'); await wait(300);
    s = await js(win, `(() => ({ txt: document.querySelector('.set-page').textContent, links: [...document.querySelectorAll('.about-links .link')].map(a => a.textContent) }))()`);
    await shot(win, `${tag}-09-acerca-de`);
    check('Acerca de: versión, NexuraIA, licencia, privacidad, terceros y «Enviar informe o sugerencia»', /Versión/.test(s.txt) && /NexuraIA/.test(s.txt) && s.links.join() === 'Licencia de uso,Política de privacidad,Licencias de terceros' && /Enviar informe o sugerencia/.test(s.txt), s);
    for (const [id, re, n] of [['#about-lic', /CONTRATO DE LICENCIA/, 'licencia'], ['#about-priv', /POLÍTICA DE PRIVACIDAD/, 'privacidad'], ['#about-3p', /LICENCIAS DE TERCEROS[\s\S]*electron-updater/, 'terceros']]) {
      await click(win, id); await wait(500);
      s = await js(win, `(() => ({ t: document.querySelector('.legal-text')?.textContent || '' }))()`);
      if (n === 'privacidad') await shot(win, `${tag}-10-privacidad`);
      check(`Abre el texto de ${n}`, re.test(s.t), { start: s.t.slice(0, 60) });
      check(`Texto de ${n} sin desbordar`, fits(await overflow(win)), { o: await overflow(win) });
      await js(win, `nexuraApp.closeModal(); true`);
      await js(win, `nexuraApp.settingsUI.open('about'); true`); await wait(300);
    }
    await js(win, `nexuraApp.closeModal(); true`);
    s = await js(win, `[...document.querySelectorAll('.toast.error')].map(t => t.textContent)`);
    check('Ningún aviso de error en pantalla', !s.length, { s });
    win.destroy();
  }
  // los dos console.error/warn de prueba no cuentan
  report.errors = report.errors.filter(e => !/favicon|youtube|No se pudo abrir el archivo|Cargando «/i.test(e));
  if (report.errors.length) { report.ok = false; console.log('✗ errores en consola: ' + report.errors.join(' | ')); }
  fs.writeFileSync(path.join(OUT, 'informe.json'), JSON.stringify(report, null, 2));
  console.log(report.ok ? '\nTODO OK' : '\nHAY FALLOS', '· informe en .revision/rc1/informe.json');
  app.exit(report.ok ? 0 : 1);
});
