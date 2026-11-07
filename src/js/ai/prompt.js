// Asistente por texto: «hazme 1 hora de house a 122-126 subiendo la energía» → set.
// Usa Ollama en local si está disponible (http://127.0.0.1:11434) y, si no, un intérprete
// propio de reglas. Ningún dato sale del ordenador.

const CURVES = ['up', 'wave', 'keep', 'down'];
export let lastOllamaError = '';

// Intérprete de reglas (sin IA externa): siempre disponible
export function parseRuleBased(text, genres = []) {
  const q = ' ' + text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') + ' ';
  const out = { durationMin: null, count: null, minBpm: null, maxBpm: null, genres: [], curve: null, minEnergy: null, maxEnergy: null };
  let m;
  if ((m = /(\d+(?:[.,]\d+)?)\s*(?:h\b|hora|horas)/.exec(q))) out.durationMin = Math.round(parseFloat(m[1].replace(',', '.')) * 60);
  else if (/\b(una|1)\s+hora\b/.test(q)) out.durationMin = 60;
  else if (/media hora/.test(q)) out.durationMin = 30;
  if ((m = /(\d+)\s*(?:min|minutos)\b/.exec(q))) out.durationMin = (out.durationMin || 0) + parseInt(m[1], 10);
  if ((m = /(\d+)\s*(?:pistas|temas|canciones|tracks)\b/.exec(q))) out.count = parseInt(m[1], 10);
  if ((m = /(\d{2,3})\s*(?:-|–|a|y|hasta)\s*(\d{2,3})\s*(?:bpm)?/.exec(q)) && +m[1] >= 60 && +m[2] <= 200) { out.minBpm = Math.min(+m[1], +m[2]); out.maxBpm = Math.max(+m[1], +m[2]); }
  else if ((m = /(\d{2,3})\s*bpm/.exec(q))) { out.minBpm = +m[1] - 2; out.maxBpm = +m[1] + 2; }
  if (/subi|subiendo|warm|calentar|de menos a mas|in crescendo|pico/.test(q)) out.curve = 'up';
  const wave = /\bola\b|sub[aei]r? y baj[aei]r?|sube y baja|suba y baje/.test(q);
  if (!wave && /baj|cierre|chill|relaj|after|de mas a menos/.test(q)) out.curve = out.curve === 'up' ? 'wave' : 'down';
  if (wave) out.curve = 'wave';
  if (/manten|constante|estable|lineal/.test(q)) out.curve = 'keep';
  if (/tranquil|suave|chill|lounge|cena|relaj/.test(q)) out.maxEnergy = 5;
  if (/cañer|caner|potente|fiesta|pico|hard|energic/.test(q)) out.minEnergy = 6;
  for (const g of genres) {
    const gn = g.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (gn.length >= 3 && q.includes(gn)) out.genres.push(g);
  }
  return out;
}

async function ollamaChat(url, model, messages, think, retry = true) {
  const body = { model, messages, stream: false, format: 'json', options: { temperature: 0.1 } };
  if (think === false) body.think = false;
  const r = await fetch(url.replace(/\/$/, '') + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 200);
    // en frío (cargando el modelo en la GPU) Ollama puede responder 500: reintentar una vez
    if (r.status >= 500 && retry) { await new Promise(res => setTimeout(res, 2500)); return ollamaChat(url, model, messages, think, false); }
    throw new Error('Ollama ' + r.status + ': ' + txt);
  }
  const j = await r.json();
  return j.message && j.message.content;
}

// La política de seguridad de la app solo permite Ollama en este equipo (puerto 11434)
export function ollamaUrlAllowed(url) { return /^http:\/\/(127\.0\.0\.1|localhost):11434\/?$/.test(url || ''); }

export async function ollamaModels(url) {
  if (!ollamaUrlAllowed(url)) throw new Error('Solo se admite Ollama en este equipo (http://127.0.0.1:11434)');
  const r = await fetch(url.replace(/\/$/, '') + '/api/tags', { signal: AbortSignal.timeout(3000) });
  if (!r.ok) throw new Error('Ollama no responde');
  return ((await r.json()).models || []).map(m => m.name);
}

// Interpreta la petición con Ollama; si falla, con reglas
export async function parseRequest(text, { genres = [], url = 'http://127.0.0.1:11434', model = '' } = {}) {
  const rules = parseRuleBased(text, genres);
  if (!model || !ollamaUrlAllowed(url)) return { ...rules, engine: 'reglas' };
  const sys = `Eres el asistente de un software de DJ. Convierte la petición del usuario en un JSON con estas claves:
durationMin (número o null), count (número de pistas o null), minBpm, maxBpm (números o null),
genres (lista elegida SOLO de: ${JSON.stringify(genres.slice(0, 80))}; vacía si no se pide género),
curve (una de: "up" subir energía, "wave" subir y bajar, "keep" mantener, "down" bajar; null si no se indica),
minEnergy, maxEnergy (energía 1-10 o null).
Responde solo con el JSON.`;
  const messages = [{ role: 'system', content: sys }, { role: 'user', content: text }];
  try {
    let content;
    try { content = await ollamaChat(url, model, messages, false); }
    catch (e) {
      console.warn('Ollama (think:false)', e.message);
      lastOllamaError = e.message;
      content = await ollamaChat(url, model, messages, undefined); // modelos sin parámetro think
    }
    const j = JSON.parse(content);
    const num = (v) => (v == null || v === '' || isNaN(+v) ? null : +v);
    const parsed = {
      durationMin: num(j.durationMin), count: num(j.count), minBpm: num(j.minBpm), maxBpm: num(j.maxBpm),
      genres: Array.isArray(j.genres) ? j.genres.filter(g => genres.includes(g)) : [],
      curve: CURVES.includes(j.curve) ? j.curve : null,
      minEnergy: num(j.minEnergy), maxEnergy: num(j.maxEnergy)
    };
    // lo que las reglas detectan con seguridad (números explícitos) gana a la interpretación del modelo
    for (const k of ['minBpm', 'maxBpm', 'durationMin', 'count']) if (rules[k] != null) parsed[k] = rules[k];
    if (!parsed.genres.length && rules.genres.length) parsed.genres = rules.genres;
    if (!parsed.curve) parsed.curve = rules.curve;
    return { ...parsed, engine: 'Ollama · ' + model };
  } catch (e) {
    console.warn('Ollama', e.message);
    lastOllamaError = e.message;
    return { ...rules, engine: 'reglas (Ollama falló: ' + String(e.message).slice(0, 120) + ')' };
  }
}

// Aplica los filtros a la biblioteca y construye el set con el asistente
export function planSet(ai, tracks, req, { includeYT = false } = {}) {
  const inBpm = (b) => {
    if (!b || (req.minBpm == null && req.maxBpm == null)) return req.minBpm == null && req.maxBpm == null;
    const lo = req.minBpm ?? 0, hi = req.maxBpm ?? 999;
    return [b, b * 2, b / 2].some(x => x >= lo - 0.5 && x <= hi + 0.5);
  };
  let pool = tracks.filter(t => (includeYT || t.source === 'local') && (t.bpm || t.camelot));
  pool = pool.filter(t => inBpm(t.bpm));
  if (req.genres && req.genres.length) {
    const gs = req.genres.map(g => g.toLowerCase());
    pool = pool.filter(t => t.genre && gs.some(g => t.genre.toLowerCase().includes(g)));
  }
  if (req.minEnergy != null) pool = pool.filter(t => !t.energy || t.energy >= req.minEnergy);
  if (req.maxEnergy != null) pool = pool.filter(t => !t.energy || t.energy <= req.maxEnergy);
  if (pool.length < 2) return { set: [], pool };
  const avgDur = pool.reduce((s, t) => s + (t.duration || 300), 0) / pool.length;
  // en una sesión real cada pista suena ~70 % de su duración
  let count = req.count || (req.durationMin ? Math.round(req.durationMin * 60 / (avgDur * 0.7)) : 15);
  count = Math.max(2, Math.min(80, count, pool.length));
  const curve = req.curve || 'up';
  const byE = pool.slice().sort((a, b) => (a.energy || 5) - (b.energy || 5) || (a.bpm || 0) - (b.bpm || 0));
  const start = curve === 'down' ? byE[byE.length - 1] : curve === 'keep' ? byE[Math.floor(byE.length / 2)] : byE[0];
  const set = ai.buildSet(start, count, curve, pool);
  return { set, pool, count, curve };
}
