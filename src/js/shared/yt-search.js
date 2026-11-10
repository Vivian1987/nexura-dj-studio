// Búsqueda de YouTube: errores de la Data API en lenguaje claro, «Comprobar clave» y la búsqueda por el
// servicio de NexuraIA (searchUrl de src/config/servicios.json) para quien no tiene clave propia.
// Al servicio se envía SOLO { id, q, max }: el id anónimo de la instalación (el mismo UUID del contador),
// el texto buscado y el número de resultados. Responde { items: [{ videoId, title, channel, thumb, duration }] }
// o HTTP 429 cuando se acaba el cupo diario.
// Compartido: el proceso principal lo usa con require() y la interfaz con import() (en el navegador queda
// en globalThis.nexuraYtSearch). Probado en Node: tools/test-busqueda.mjs.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.nexuraYtSearch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const GUIDE = 'https://github.com/mcontrerasdevpro/nexura-dj-studio#youtube-y-spotify';
  const MSG = {
    limit: 'Has llegado al límite diario de búsquedas gratuitas. Mañana se renueva, o pon tu propia clave en Ajustes → YouTube.',
    down: 'El servicio de búsqueda de NexuraIA no responde ahora mismo. Inténtalo más tarde o pon tu propia clave en Ajustes → YouTube.',
    bad: 'El servicio de búsqueda de NexuraIA ha devuelto una respuesta que no se entiende. Inténtalo más tarde.',
    none: 'Para buscar en YouTube pon tu propia clave de API (gratis) o conecta tu cuenta de Google en Ajustes → YouTube. La guía del README explica cómo crearla en 5 minutos.',
    keyOk: 'Clave correcta',
    quota: 'La clave es válida, pero hoy ya se ha gastado toda su cuota (unas 100 búsquedas al día). Se renueva a medianoche, hora del Pacífico (las 9:00 en España).',
    keyInvalid: 'La clave no es válida: revisa que la has copiado entera (empieza por «AIza»).',
    notEnabled: 'La clave existe, pero «YouTube Data API v3» no está habilitada en su proyecto de Google Cloud: actívala en «APIs y servicios → Biblioteca».',
    restricted: 'La clave tiene restricciones que no permiten usarla desde la app (de sitio web o de IP). En Google Cloud, deja «Restricciones de aplicación» en «Ninguna» y limítala solo a YouTube Data API v3.',
    net: 'No se ha podido conectar con YouTube. Revisa la conexión a Internet.',
    empty: 'Escribe o pega primero la clave.'
  };

  const err = (code, message, extra) => Object.assign(new Error(message), { code }, extra || {});

  // Error de la Data API → { code, message } en claro. j = cuerpo JSON de la respuesta (puede faltar).
  function ytErrorInfo(status, j) {
    const e = (j && j.error) || {};
    const reasons = (e.errors || []).map(x => x && x.reason).concat((e.details || []).map(x => x && x.reason)).filter(Boolean).join(' ');
    const text = `${reasons} ${e.status || ''} ${e.message || ''}`;
    if (/quotaExceeded|dailyLimitExceeded|rateLimitExceeded|RESOURCE_EXHAUSTED/i.test(text)) return { code: 'quota', message: MSG.quota };
    if (/keyInvalid|API_KEY_INVALID|API key not valid|badRequest.*key/i.test(text)) return { code: 'keyInvalid', message: MSG.keyInvalid };
    if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project|is disabled/i.test(text)) return { code: 'notEnabled', message: MSG.notEnabled };
    if (/ipRefererBlocked|API_KEY_.*BLOCKED|referer|forbidden.*restrict/i.test(text)) return { code: 'restricted', message: MSG.restricted };
    if (status === 400 && /key/i.test(text)) return { code: 'keyInvalid', message: MSG.keyInvalid };
    return { code: 'api', message: 'YouTube ha respondido con un error' + (e.message ? ': ' + e.message : ` (HTTP ${status})`) };
  }

  // «Comprobar clave»: una búsqueda mínima (1 resultado, solo ids; gasta 100 unidades de cuota, como cualquier búsqueda)
  async function checkKey(key, { fetchImpl = globalThis.fetch, base = 'https://www.googleapis.com/youtube/v3', timeoutMs = 10000 } = {}) {
    key = String(key || '').trim();
    if (!key) return { ok: false, code: 'empty', message: MSG.empty };
    const q = new URLSearchParams({ part: 'id', q: 'música', type: 'video', maxResults: '1', key });
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      const r = await fetchImpl(`${base}/search?${q}`, { signal: ctl.signal });
      clearTimeout(t);
      let j = null;
      try { j = await r.json(); } catch (_) { j = null; }
      if (r.ok) return { ok: true, code: 'ok', message: MSG.keyOk };
      return { ok: false, ...ytErrorInfo(r.status, j) };
    } catch (_) { return { ok: false, code: 'net', message: MSG.net }; }
  }

  const VIDEO_ID = /^[\w-]{11}$/;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  // Solo los campos que usa la app, saneados (lo que venga de más se descarta)
  function cleanItems(list) {
    const out = [];
    const seen = new Set();
    for (const v of Array.isArray(list) ? list : []) {
      if (!v || !VIDEO_ID.test(String(v.videoId)) || seen.has(v.videoId)) continue;
      seen.add(v.videoId);
      const it = { videoId: String(v.videoId), title: String(v.title || v.videoId).slice(0, 300), channel: String(v.channel || '').slice(0, 200), thumb: /^https:\/\//.test(String(v.thumb || '')) ? String(v.thumb) : '' };
      const d = Number(v.duration);
      if (d > 0 && d < 86400 * 2) it.duration = Math.round(d);
      out.push(it);
    }
    return out;
  }

  // Búsqueda por el servicio de NexuraIA. Lanza Error con code 'limit' (429), 'down' (caído, sin red, 5xx,
  // tiempo agotado) o 'bad' (respuesta incomprensible).
  async function serviceSearch({ url, id, q, max = 25, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
    if (!/^https?:\/\//.test(String(url || ''))) throw err('none', MSG.none);
    const body = { id: UUID.test(String(id)) ? String(id) : '', q: String(q || '').trim().slice(0, 200), max: Math.max(1, Math.min(50, Math.round(Number(max) || 25))) };
    if (!body.q) return [];
    let r;
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), timeoutMs);
      r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      clearTimeout(t);
    } catch (_) { throw err('down', MSG.down); }
    if (r.status === 429) throw err('limit', MSG.limit);
    if (!r.ok) throw err('down', MSG.down, { status: r.status });
    let j;
    try { j = await r.json(); } catch (_) { throw err('bad', MSG.bad); }
    if (j && j.error === 'limit') throw err('limit', MSG.limit);
    if (!j || !Array.isArray(j.items)) throw err('bad', MSG.bad);
    return cleanItems(j.items);
  }

  // Muestra «AIza••••••••» (solo el principio) para no enseñar la clave entera en pantalla
  const maskKey = (k) => { k = String(k || ''); return k ? k.slice(0, 4) + '•'.repeat(8) : ''; };

  return { MSG, GUIDE, ytErrorInfo, checkKey, serviceSearch, cleanItems, maskKey };
});
