// Pruebas del contador anónimo de uso (main/stats.js): sin URL no se envía nada; con una URL de prueba
// local se envían solo los campos permitidos y como mucho una vez al día. node tools/test-estadisticas.mjs
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
const require = createRequire(import.meta.url);
const S = require('../main/stats.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-stats-'));
const file = path.join(dir, 'instalacion.id');
// datos «de más» que nunca deben salir
const data = { version: '1.0.0-rc.1', lang: 'es-ES', os: 'Windows 11', decks: 4, controller: 'Pioneer DDJ-400', user: 'Miguel', tracks: 377, path: 'C:\\Users\\Miguel\\Music' };
let calls = 0;
const spy = async () => { calls++; return { ok: true }; };

console.log('Sin URL o sin permiso');
let r = await S.sendStats({ url: '', enabled: true, file, data, fetchImpl: spy });
ok(!r.sent && r.reason === 'sin-url' && calls === 0, 'sin statsUrl no hace ninguna petición');
ok(!fs.existsSync(file), 'sin statsUrl ni siquiera crea el identificador');
r = await S.sendStats({ url: 'http://127.0.0.1:9/x', enabled: false, file, data, fetchImpl: spy });
ok(!r.sent && r.reason === 'desactivado' && calls === 0, 'con la opción desactivada no hace ninguna petición');

console.log('Con una URL de prueba local');
const got = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', d => { b += d; }); req.on('end', () => { got.push({ method: req.method, headers: req.headers, body: b }); res.end('ok'); }); });
await new Promise(res => srv.listen(0, '127.0.0.1', res));
const url = `http://127.0.0.1:${srv.address().port}/stats`;
const t0 = Date.parse('2026-11-10T10:00:00Z');
r = await S.sendStats({ url, enabled: true, file, data, now: t0 });
ok(r.sent && got.length === 1, 'envía una vez');
const body = JSON.parse(got[0].body);
ok(JSON.stringify(Object.keys(body).sort()) === JSON.stringify([...S.FIELDS].sort()), `solo los campos permitidos: ${Object.keys(body).join(', ')}`);
ok(body.controller === true && body.decks === 4 && body.os === 'Windows 11' && body.lang === 'es-ES' && body.version === '1.0.0-rc.1', 'valores correctos (controladora = sí/no, sin modelo)');
ok(!got[0].body.includes('DDJ') && !got[0].body.includes('Miguel') && !got[0].body.includes('377') && !got[0].body.includes('Music'), 'no salen modelo, usuario, nº de pistas ni rutas');
ok(/^[0-9a-f-]{36}$/.test(body.id), 'id aleatorio de instalación (UUID)');
ok(!got[0].headers.cookie && !got[0].headers.authorization, 'sin cookies ni cabeceras de identificación');
r = await S.sendStats({ url, enabled: true, file, data, now: t0 + 5 * 3600e3 });
ok(!r.sent && r.reason === 'hoy' && got.length === 1, 'no repite el mismo día');
r = await S.sendStats({ url, enabled: true, file, data, now: t0 + 25 * 3600e3 });
const body2 = JSON.parse(got[1].body);
ok(r.sent && body2.id === body.id, 'al día siguiente envía otra vez con el mismo id');
const odd = S.buildPayload({ id: 'no', version: 'x', lang: '<script>', os: 'Linux', decks: 7, controller: 'sí' });
ok(odd.id === '' && odd.lang === 'und' && odd.os === 'otro' && odd.decks === 2 && odd.controller === true, 'valores saneados');
srv.close();

console.log('Sin red');
fs.rmSync(file, { force: true });
r = await S.sendStats({ url: 'http://127.0.0.1:1/stats', enabled: true, file, data, timeoutMs: 2000 });
ok(!r.sent && r.reason === 'red', 'sin servidor: no lanza ni avisa, solo devuelve «red»');
r = await S.sendStats({ url, enabled: true, file, data, fetchImpl: async () => ({ ok: false, status: 500 }) });
ok(!r.sent && r.reason === 'http-500', 'error del servidor: tampoco lanza');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
