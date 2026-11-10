// Búsqueda de YouTube por el servicio de NexuraIA y «Comprobar clave» (src/js/shared/yt-search.js), con un
// servidor HTTP local que simula el servicio: resultado, límite diario (429), error 500, respuesta rara,
// servicio caído (puerto cerrado) y tiempo agotado. Uso: node tools/test-busqueda.mjs
import http from 'http';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const S = require('../src/js/shared/yt-search.js');

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('✓', name); } else { fail++; console.log('✗', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const ID = '3f1c2a4b-9d8e-4f00-8abc-0123456789ab';

// --- servidor simulado
const got = [];
let mode = 'ok';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    got.push({ method: req.method, type: req.headers['content-type'], body: JSON.parse(body || '{}') });
    if (mode === 'slow') return setTimeout(() => res.end('{}'), 3000);
    if (mode === 'limit') { res.writeHead(429, { 'Content-Type': 'application/json' }); return res.end('{"error":"limit"}'); }
    if (mode === '500') { res.writeHead(500); return res.end('fallo'); }
    if (mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<html>n8n</html>'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ items: [
      { videoId: 'dQw4w9WgXcQ', title: 'Rick Astley - Never Gonna Give You Up', channel: 'Rick Astley', thumb: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', duration: 213, extra: 'no debe pasar' },
      { videoId: 'dQw4w9WgXcQ', title: 'duplicado' },
      { videoId: 'kJQP7kiw5Fk', title: 'Luis Fonsi - Despacito', channel: 'LuisFonsiVEVO', thumb: 'http://inseguro/x.jpg', duration: 'x' },
      { videoId: '<script>', title: 'id no válido' }
    ], cached: false }));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/webhook/nexura-dj-buscar`;

// 1) resultado
let items = await S.serviceSearch({ url, id: ID, q: '  rick astley  ', max: 10 });
ok(items.length === 2 && items[0].videoId === 'dQw4w9WgXcQ' && items[0].duration === 213 && items[1].videoId === 'kJQP7kiw5Fk', 'resultado: devuelve los vídeos válidos sin duplicados', items);
ok(Object.keys(items[0]).sort().join() === 'channel,duration,thumb,title,videoId' && items[1].thumb === '' && items[1].duration === undefined, 'resultado: solo los campos que usa la app (miniatura solo https, duración numérica)', items[1]);
const sent = got[got.length - 1];
ok(sent.method === 'POST' && /application\/json/.test(sent.type), 'POST JSON');
ok(JSON.stringify(Object.keys(sent.body).sort()) === '["id","max","q"]' && sent.body.id === ID && sent.body.q === 'rick astley' && sent.body.max === 10, 'se envía SOLO { id, q, max }', sent.body);
await S.serviceSearch({ url, id: 'no-es-un-uuid', q: 'x', max: 999 });
ok(got[got.length - 1].body.id === '' && got[got.length - 1].body.max === 50, 'id no válido → vacío; máximo 50 resultados', got[got.length - 1].body);
const before = got.length;
ok((await S.serviceSearch({ url, id: ID, q: '   ' })).length === 0 && got.length === before, 'texto vacío → no se llama al servicio');

// 2) límite diario
const code = async (m, opts = {}) => { mode = m; try { await S.serviceSearch({ url, id: ID, q: 'x', ...opts }); return 'sin-error'; } catch (e) { return e.code + '|' + e.message; } };
let r = await code('limit');
ok(r.startsWith('limit|Has llegado al límite diario de búsquedas gratuitas. Mañana se renueva, o pon tu propia clave en Ajustes → YouTube'), '429 → mensaje del límite diario', r);
// 3) errores del servicio
r = await code('500');
ok(r.startsWith('down|') && /no responde/.test(r), 'HTTP 500 → «no responde ahora mismo»', r);
r = await code('html');
ok(r.startsWith('bad|'), 'respuesta que no es JSON → «no se entiende»', r);
r = await code('slow', { timeoutMs: 300 });
ok(r.startsWith('down|'), 'tiempo agotado → «no responde»', r);
// 4) servicio caído (puerto cerrado)
mode = 'ok';
await new Promise(res => server.close(res));
r = await (async () => { try { await S.serviceSearch({ url, id: ID, q: 'x', timeoutMs: 2000 }); return 'sin-error'; } catch (e) { return e.code + '|' + e.message; } })();
ok(r.startsWith('down|') && /Ajustes → YouTube/.test(r), 'servicio caído → «no responde» con la alternativa de la clave propia', r);
r = await (async () => { try { await S.serviceSearch({ url: '', id: ID, q: 'x' }); return 'sin-error'; } catch (e) { return e.code + '|' + e.message; } })();
ok(r.startsWith('none|') && /guía del README/.test(r), 'sin servicio ni clave → mensaje con la guía del README', r);

// 5) errores de la Data API en claro
const yt = (status, reason, message, extra = {}) => S.ytErrorInfo(status, { error: { code: status, message, errors: reason ? [{ reason }] : [], ...extra } }).code;
ok(yt(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.') === 'quota', 'quotaExceeded → cuota agotada');
ok(yt(400, 'badRequest', 'API key not valid. Please pass a valid API key.', { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] }) === 'keyInvalid', 'API key not valid → clave no válida');
ok(yt(403, 'accessNotConfigured', 'YouTube Data API v3 has not been used in project 123 before or it is disabled.', { details: [{ reason: 'SERVICE_DISABLED' }] }) === 'notEnabled', 'SERVICE_DISABLED → API no habilitada');
ok(yt(403, 'forbidden', 'Requests from referer <empty> are blocked.', { details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] }) === 'restricted', 'referer bloqueado → restricciones de la clave');
ok(S.ytErrorInfo(500, null).code === 'api' && /HTTP 500/.test(S.ytErrorInfo(500, null).message), 'otro error → mensaje genérico con el código');

// 6) «Comprobar clave» con fetch simulado
const calls = [];
const fakeFetch = (status, body) => async (u) => { calls.push(String(u)); return { ok: status === 200, status, json: async () => body }; };
let c = await S.checkKey('AIzaSyB-correcta', { fetchImpl: fakeFetch(200, { items: [{ id: { videoId: 'x' } }] }) });
ok(c.ok && c.message === 'Clave correcta', 'clave correcta', c);
const q = new URL(calls[0]).searchParams;
ok(q.get('maxResults') === '1' && q.get('part') === 'id' && q.get('key') === 'AIzaSyB-correcta' && /\/youtube\/v3\/search$/.test(new URL(calls[0]).pathname), 'búsqueda mínima (1 resultado, solo ids)', calls[0]);
c = await S.checkKey('AIzaMal', { fetchImpl: fakeFetch(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', errors: [{ reason: 'badRequest' }] } }) });
ok(!c.ok && c.code === 'keyInvalid' && /no es válida/.test(c.message), 'clave no válida', c);
c = await S.checkKey('AIzaSinCuota', { fetchImpl: fakeFetch(403, { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }) });
ok(!c.ok && c.code === 'quota' && /cuota/.test(c.message), 'cuota agotada', c);
c = await S.checkKey('AIzaSinApi', { fetchImpl: fakeFetch(403, { error: { code: 403, message: 'YouTube Data API v3 has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }) });
ok(!c.ok && c.code === 'notEnabled' && /habilitada/.test(c.message), 'API no habilitada', c);
c = await S.checkKey('AIzaSinRed', { fetchImpl: async () => { throw new TypeError('fetch failed'); } });
ok(!c.ok && c.code === 'net', 'sin red', c);
c = await S.checkKey('  ', { fetchImpl: fakeFetch(200, {}) });
ok(!c.ok && c.code === 'empty', 'clave vacía → no se consulta');

// 7) máscara
ok(S.maskKey('AIzaSyB1234567890') === 'AIza••••••••' && S.maskKey('') === '', 'máscara «AIza••••••••»');

console.log(`\n${pass}/${pass + fail} comprobaciones de la búsqueda correctas`);
process.exit(fail ? 1 : 0);
