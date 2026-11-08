// Spotify (solo metadatos): enlaces, JSON de la página pública de inserción, respuestas de la Web API,
// normalización de títulos/artistas, emparejamiento con la biblioteca local y elección de resultados de
// YouTube. Funciones puras, sin DOM: se prueban en Node (tools/test-spotify.mjs).
// Nunca se descarga ni se extrae audio de Spotify ni de YouTube: solo títulos, artistas, duración, ISRC y carátula.

// Redirect URI que hay que registrar tal cual en developer.spotify.com (Spotify no admite «localhost»)
export const SPOTIFY_REDIRECT_PORT = 43827;
export const SPOTIFY_REDIRECT_URI = `http://127.0.0.1:${SPOTIFY_REDIRECT_PORT}/callback`;
export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative';
// La página de inserción solo trae las primeras ~100 pistas de una lista
export const SPOTIFY_EMBED_LIMIT = 100;
// Umbrales de confianza del emparejamiento: ≥ HIGH se acepta solo; entre REVIEW y HIGH, «revisar»
export const MATCH_HIGH = 0.9;
export const MATCH_REVIEW = 0.72;

const TYPES = new Set(['playlist', 'album', 'track']);
const SP_ID = /^[A-Za-z0-9]{22}$/;

// ---------------------------------------------------------------- enlaces
// open.spotify.com/playlist|album|track/<id> (con o sin /intl-xx/, /embed/, /user/<u>/ y ?si=…),
// play.spotify.com y URIs spotify:playlist:<id> (también la antigua spotify:user:<u>:playlist:<id>).
// Devuelve { type, id } o null.
export function parseSpotifyInput(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  const uri = /^spotify:(?:user:[^:\s]+:)?(playlist|album|track):([A-Za-z0-9]{22})$/i.exec(s);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : 'https://' + s); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || !/^(open|play)\.spotify\.com$/i.test(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean)
    .filter(p => !/^intl-[a-z]{2}(-[a-z]{2,4})?$/i.test(p) && !/^embed(-podcast)?$/i.test(p));
  for (let i = 0; i < segs.length - 1; i++) {
    const t = segs[i].toLowerCase();
    if (TYPES.has(t) && SP_ID.test(segs[i + 1])) return { type: t, id: segs[i + 1] };
  }
  return null;
}
export const spotifyUrl = (type, id) => `https://open.spotify.com/${type}/${id}`;
export const isSpotifyLink = (s) => !!parseSpotifyInput(s);

// ---------------------------------------------------------------- normalización
// minúsculas, sin acentos ni signos; «&» y «+» = «and»; «$» = «s» (A$AP → asap)
export function fold(s) {
  return String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ł/g, 'l').replace(/đ/g, 'd')
    .replace(/[’'`´]/g, '').replace(/\$/g, 's')
    .replace(/\s*&\s*|\s+\+\s+/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Calificativos que no cambian la canción (se quitan)
const NEUTRAL = /^(original( mix| version| edit)?|(\d{4} )?(digital(ly)? )?remaster(ed)?( version)?( \d{4})?|album version|single version|lp version|mono( version)?|stereo( version)?|explicit( version)?|clean( version)?|deluxe( edition| version)?|bonus track|main( version| mix)?|from .+|taken from .+)$/;
// Otra duración de la misma mezcla (radio / extended / club): penalización pequeña
const EDIT = /^(radio( edit| version| mix)?|extended( mix| version| edit)?|club( mix| edit| version)|short( edit| version)|edit|single edit|original extended( mix)?|extended original( mix)?)$/;
// Palabras que indican una versión distinta (remix, directo, acústica…)
const DISTINCT = /\b(remix|rmx|mix|rework|re edit|reedit|bootleg|vip|dub|flip|refix|cover|live|en vivo|en directo|acoustic|acustica|unplugged|instrumental|acapella|a cappella|karaoke|demo|version|edit|mashup|sped up|slowed|reverb|nightcore|8d|remake|reprise)\b/;
const FEAT_RE = /^(feat|ft|featuring|with|con)\b\.?\s*/;
// palabras genéricas de una versión: se comparan solo los nombres (p. ej. el remezclador)
const VERSION_GENERIC = new Set(['remix', 'rmx', 'mix', 'rework', 're', 'reedit', 'edit', 'bootleg', 'vip', 'flip', 'refix', 'extended', 'radio', 'club', 'original', 'version', 'remaster', 'remastered', 'mixed', 'by']);

// «Título (feat. X) [Y Remix] - Remastered 2011» → { base, version, kind, feat }
//   kind: 'original' | 'edit' (radio/extended/club) | 'version' (remix, live, acústica…)
export function parseTitle(title) {
  let s = String(title || '').replace(/\s+/g, ' ').trim();
  const feat = [], descs = [];
  // (…) y […]
  s = s.replace(/\s*[([]([^()[\]]*)[)\]]/g, (_, inner) => { descs.push(inner); return ' '; });
  // « - Remastered 2011», « - Tiësto Remix», « - Radio Edit» (al estilo de Spotify)
  const parts = s.split(/\s+[-–—]\s+/);
  if (parts.length > 1) {
    const keep = [parts[0]];
    for (const p of parts.slice(1)) {
      const f = fold(p);
      if (NEUTRAL.test(f) || EDIT.test(f) || DISTINCT.test(f) || FEAT_RE.test(f)) descs.push(p); else keep.push(p);
    }
    s = keep.join(' - ');
  }
  // «feat. X» sin paréntesis hasta el final
  s = s.replace(/\s+(?:feat|ft|featuring)\b\.?\s+(.+)$/i, (_, who) => { feat.push(...splitArtists(who)); return ''; });
  let kind = 'original';
  const ver = [];
  for (const d of descs) {
    const f = fold(d);
    if (!f) continue;
    if (FEAT_RE.test(f)) { feat.push(...splitArtists(d.replace(/^\s*(feat|ft|featuring|with|con)\b\.?\s*/i, ''))); continue; }
    if (NEUTRAL.test(f)) continue;
    if (EDIT.test(f)) { if (kind === 'original') kind = 'edit'; continue; }
    if (DISTINCT.test(f)) { kind = 'version'; ver.push(f); continue; }
    s += ' ' + d; // «(Part 2)», «(Love Theme)»: es parte del título
  }
  return { base: fold(s), version: ver.join(' '), kind, feat };
}

// «A, B & C feat. D» → ['a', 'b', 'c', 'd'] (sin «the» inicial: The Weeknd = Weeknd)
export function splitArtists(str) {
  const list = Array.isArray(str) ? str : [str];
  const out = [];
  for (const item of list) {
    for (const p of String(item || '').split(/\s*(?:,|;|\/|\s&\s|&|\band\b|\bx\b|\bvs\b\.?|\bfeat\b\.?|\bft\b\.?|\bfeaturing\b|\bwith\b|\by\b(?=\s))\s*/i)) {
      const f = fold(p).replace(/^the /, '');
      if (f && !out.includes(f)) out.push(f);
    }
  }
  return out;
}

// ---------------------------------------------------------------- similitud
export function jaroWinkler(a, b) {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  const la = a.length, lb = b.length, win = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Uint8Array(la), mb = new Uint8Array(lb);
  let m = 0;
  for (let i = 0; i < la; i++) {
    for (let j = Math.max(0, i - win), e = Math.min(lb - 1, i + win); j <= e; j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = 1; m++; break;
    }
  }
  if (!m) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < 4 && p < la && p < lb && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}
const tokens = (s) => String(s || '').split(' ').filter(Boolean);
// Dice sobre conjuntos de palabras (no importa el orden)
export function tokenDice(a, b) {
  const A = new Set(tokens(a)), B = new Set(tokens(b));
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}
export const textSim = (a, b) => Math.max(jaroWinkler(a, b), tokenDice(a, b));

function versionFactor(a, b) {
  if (a.kind !== 'version' && b.kind !== 'version') return a.kind === b.kind ? 1 : 0.97;
  if (a.kind !== b.kind) return 0.55; // remix frente a original
  const na = tokens(a.version).filter(w => !VERSION_GENERIC.has(w)).join(' ');
  const nb = tokens(b.version).filter(w => !VERSION_GENERIC.has(w)).join(' ');
  if (!na && !nb) return 1;
  if (!na || !nb) return 0.8;
  const s = Math.max(tokenDice(na, nb), jaroWinkler(na, nb) >= 0.92 ? 1 : 0);
  return s >= 0.99 ? 1 : 0.55 + 0.45 * s * s;
}
function durationFactor(da, db, kinds) {
  if (!(da > 0) || !(db > 0)) return 1;
  const d = Math.abs(da - db);
  let f = d <= 5 ? 1 : d <= 10 ? 0.93 : d <= 20 ? 0.85 : 0.7;
  // radio edit frente a extended: la duración cambia por fuerza
  if (kinds.has('edit')) f = Math.max(f, 0.9);
  return f;
}

// Datos normalizados de una pista (Spotify o local): { base, version, kind, artists, duration, isrc }
export function prepTrack(t) {
  const p = parseTitle(t.title);
  const artists = splitArtists(t.artists || t.artist || '');
  for (const f of p.feat) if (!artists.includes(f)) artists.push(f);
  return { ...p, artists, primary: artists[0] || '', duration: Number(t.duration) || 0, isrc: normIsrc(t.isrc), hay: fold(`${t.artist || ''} ${t.title || ''} ${t.path ? fileBase(t.path) : ''}`) };
}
export const normIsrc = (s) => { const v = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(v) ? v : ''; };
const fileBase = (p) => String(p).split(/[\\/]/).pop().replace(/\.[^.]+$/, '');

function artistScore(sp, lo) {
  if (!sp.artists.length) return 0.6;
  if (!lo.artists.length) {
    // pista local sin artista: se busca el artista en el título o el nombre del archivo
    return sp.artists.some(a => a.length > 2 && (' ' + lo.hay + ' ').includes(' ' + a + ' ')) ? 0.95 : 0.5;
  }
  const best = (a) => Math.max(...lo.artists.map(b => Math.max(jaroWinkler(a, b), tokenDice(a, b))));
  const prim = best(sp.artists[0]);
  const cover = sp.artists.filter(a => best(a) >= 0.9).length / sp.artists.length;
  // el artista principal de Spotify puede ir de invitado en la etiqueta local («B feat. A»)
  return 0.8 * prim + 0.2 * Math.max(cover, prim >= 0.9 ? 0.5 : 0);
}

// Puntuación 0-1 entre una pista de Spotify y una local (ambas pasadas por prepTrack)
export function scorePair(sp, lo) {
  if (sp.isrc && lo.isrc && sp.isrc === lo.isrc) return { score: 1, isrc: true };
  const title = textSim(sp.base, lo.base);
  const artist = artistScore(sp, lo);
  const kinds = new Set([sp.kind, lo.kind]);
  const score = (0.55 * title + 0.45 * artist) * versionFactor(sp, lo) * durationFactor(sp.duration, lo.duration, kinds);
  return { score: Math.round(score * 1000) / 1000, isrc: false };
}

// Índice de la biblioteca local para no comparar cada pista con todas
const MAX_CANDS = 60;
const STOP = new Set(['the', 'a', 'an', 'and', 'of', 'el', 'la', 'los', 'las', 'de', 'y', 'feat', 'me', 'you', 'i', 'my', 'in', 'on', 'to']);
export function buildLocalIndex(tracks) {
  const items = [], byTok = new Map(), byIsrc = new Map();
  for (const t of tracks) {
    const p = prepTrack(t);
    const it = { t, p };
    items.push(it);
    if (p.isrc) byIsrc.set(p.isrc, it);
    const toks = new Set([...tokens(p.base), ...p.artists.flatMap(tokens), ...(!p.artists.length ? tokens(p.hay) : [])]);
    for (const w of toks) {
      if (w.length < 2 || STOP.has(w)) continue;
      if (!byTok.has(w)) byTok.set(w, []);
      byTok.get(w).push(it);
    }
  }
  return { items, byTok, byIsrc };
}

// Mejores candidatos locales para una pista de Spotify: [{ track, score, isrc }] (máx. 3, de mayor a menor)
export function matchTrack(spTrack, index, max = 3) {
  const sp = prepTrack(spTrack);
  if (sp.isrc && index.byIsrc.has(sp.isrc)) return [{ track: index.byIsrc.get(sp.isrc).t, score: 1, isrc: true }];
  // preselección: palabras compartidas, pesadas por lo raras que son (una palabra que aparece en media
  // biblioteca, como «remix» o «love», apenas cuenta); solo los MAX_CANDS mejores se puntúan a fondo
  const weight = new Map();
  for (const w of new Set([...tokens(sp.base), ...sp.artists.flatMap(tokens)])) {
    if (w.length < 2 || STOP.has(w)) continue;
    const list = index.byTok.get(w);
    if (!list) continue;
    const wt = 1 / Math.log2(1 + list.length);
    for (const it of list) weight.set(it, (weight.get(it) || 0) + wt);
  }
  let cands = [...weight.entries()];
  if (cands.length > MAX_CANDS) cands = cands.sort((a, b) => b[1] - a[1]).slice(0, MAX_CANDS);
  cands = cands.map(e => e[0]);
  // títulos de una sola palabra corta o solo con palabras vacías: se compara con todo
  if (!cands.length && tokens(sp.base).every(w => w.length < 2 || STOP.has(w))) cands = index.items;
  const out = [];
  for (const it of cands) {
    const r = scorePair(sp, it.p);
    if (r.score >= 0.5) out.push({ track: it.t, score: r.score, isrc: r.isrc });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}
export const confidenceOf = (score) => (score >= MATCH_HIGH ? 'high' : score >= MATCH_REVIEW ? 'review' : 'none');

// Empareja una lista completa: [{ ...pista de Spotify, cands, local (id aceptado o null), score, conf }]
// prior: elementos de una importación anterior de la misma lista (se respetan las decisiones del usuario)
export function matchList(spTracks, localTracks, prior = []) {
  const index = buildLocalIndex(localTracks);
  const exists = new Set(localTracks.map(t => t.id));
  const old = new Map(prior.filter(p => p && p.key).map(p => [p.key, p]));
  return spTracks.map((s, i) => {
    const key = itemKey(s, i);
    const cands = matchTrack(s, index);
    const best = cands[0];
    const item = { ...s, key, cands: cands.map(c => ({ id: c.track.id, score: c.score, isrc: c.isrc })), local: null, yt: null, score: best ? best.score : 0, conf: confidenceOf(best ? best.score : 0), manual: false };
    if (best && item.conf === 'high') item.local = best.track.id;
    const p = old.get(key);
    if (p && p.manual) {
      item.manual = true;
      item.local = p.local && exists.has(p.local) ? p.local : null;
      if (item.local) { item.conf = 'high'; if (!item.cands.some(c => c.id === item.local)) item.cands.unshift({ id: item.local, score: item.score, isrc: false }); }
    }
    if (p && p.yt && !item.local) item.yt = p.yt;
    return item;
  });
}
// clave estable de una pista dentro de la lista (uri de Spotify o, si no hay, artista+título)
export const itemKey = (s, i = 0) => s.uri || `${fold((s.artists || []).join(' '))}|${fold(s.title)}|${i}`;

// Ids de la crate en el orden original: pista local aceptada o, si no, el vídeo de YouTube elegido
export function crateIdsFrom(items) {
  const out = [];
  for (const it of items) {
    const id = it.local || (it.yt ? 'yt_' + String(it.yt.videoId).replace(/[^\w-]/g, '') : null);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}
export function itemStatus(it) {
  if (it.local) return it.conf === 'review' && !it.manual ? 'review' : 'local';
  if (it.yt) return 'youtube';
  if (it.conf === 'review') return 'review';
  return 'missing';
}

// ---------------------------------------------------------------- página de inserción (sin cuenta)
// La página open.spotify.com/embed/<tipo>/<id> lleva los metadatos en <script id="__NEXT_DATA__"> (JSON;
// el mismo método que la librería spotify-url-info) o, en la versión antigua, en <script id="resource">
// (JSON en base64). Devuelve { type, id, name, owner, cover, tracks, truncated } o lanza un error.
export function parseEmbedHtml(html, ref = {}) {
  const text = String(html || '');
  let entity = null;
  const next = /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
  if (next) {
    const j = JSON.parse(next[1]);
    const pp = j && j.props && j.props.pageProps;
    entity = pp && pp.state && pp.state.data && pp.state.data.entity;
    if (!entity && pp && (pp.status === 404 || pp.title === 'Not Found')) throw new Error('La lista no existe o no es pública.');
  } else {
    const res = /<script[^>]*id=["']resource["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
    if (res) entity = JSON.parse(decodeBase64Utf8(res[1].trim()));
  }
  if (!entity) throw new Error('No se encontraron los datos de la lista en la página pública de Spotify.');
  return entityToList(entity, ref);
}
function decodeBase64Utf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}
const idFromUri = (uri) => { const m = /:([A-Za-z0-9]{22})$/.exec(uri || ''); return m ? m[1] : ''; };
// «Artista 1, Artista 2» (la página usa espacios duros) → ['Artista 1', 'Artista 2']
const subtitleArtists = (s) => String(s || '').replace(/ /g, ' ').split(/\s*,\s*/).map(x => x.trim()).filter(Boolean);
function bestImage(list) {
  const arr = (list || []).filter(x => x && x.url);
  if (!arr.length) return '';
  arr.sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0));
  // la más pequeña que tenga al menos 200 px (para la tabla) o la mayor
  const fit = arr.filter(x => (x.width || x.maxWidth || 0) >= 200);
  return (fit[fit.length - 1] || arr[0]).url;
}
function entityToList(e, ref) {
  const type = String(e.type || ref.type || '').toLowerCase();
  const cover = bestImage((e.coverArt && e.coverArt.sources) || (e.visualIdentity && e.visualIdentity.image) || e.images);
  const base = { type, id: e.id || idFromUri(e.uri) || ref.id || '', name: e.name || e.title || '', owner: e.subtitle ? subtitleArtists(e.subtitle).join(', ') : (e.authors || []).map(a => a.name).join(', '), cover, source: 'embed' };
  let tracks = [];
  if (type === 'track') {
    tracks = [{ uri: e.uri || '', id: idFromUri(e.uri), title: e.name || e.title || '', artists: e.artists ? e.artists.map(a => a.name) : subtitleArtists(e.subtitle), duration: (e.duration || 0) / 1000, explicit: !!e.isExplicit, cover }];
  } else if (Array.isArray(e.trackList)) {
    tracks = e.trackList.filter(t => t && (t.title || t.name)).map(t => ({
      uri: t.uri || '', id: idFromUri(t.uri), title: t.title || t.name || '', artists: t.artists ? t.artists.map(a => a.name) : subtitleArtists(t.subtitle),
      duration: (t.duration || 0) / 1000, explicit: !!t.isExplicit, cover: '' }));
  } else if (e.tracks && Array.isArray(e.tracks.items)) {
    tracks = e.tracks.items.map(x => mapApiTrack(x && (x.track || x.item || x), cover)).filter(Boolean);
  }
  const total = (e.tracks && e.tracks.total) || 0;
  return { ...base, tracks, truncated: type !== 'track' && (tracks.length >= SPOTIFY_EMBED_LIMIT || total > tracks.length) };
}

// ---------------------------------------------------------------- Web API
// Pista de la Web API → formato interno (null si es un episodio o no tiene título)
export function mapApiTrack(t, albumCover = '') {
  if (!t || (t.type && t.type !== 'track') || !t.name) return null;
  const imgs = t.album && t.album.images;
  return {
    uri: t.uri || '', id: t.id || idFromUri(t.uri), title: t.name, artists: (t.artists || []).map(a => a.name).filter(Boolean),
    duration: (t.duration_ms || 0) / 1000, isrc: (t.external_ids && t.external_ids.isrc) || '', explicit: !!t.explicit,
    album: (t.album && t.album.name) || '', cover: bestImage(imgs) || albumCover
  };
}
// Página de elementos de una lista (/playlists/{id}/items o /tracks): [{ item | track }] → pistas
export const mapPlaylistPage = (page) => ((page && page.items) || []).map(x => mapApiTrack(x && (x.item || x.track))).filter(Boolean);

// ---------------------------------------------------------------- YouTube y tiendas
// Palabras que en un resultado de YouTube indican otra versión: se evitan salvo que el título las pida
const YT_AVOID = ['live', 'en vivo', 'en directo', 'karaoke', 'cover', 'instrumental', 'acapella', 'reaction', 'tutorial', 'lesson', 'nightcore', 'sped up', 'slowed', 'reverb', '8d', 'remix', 'mashup', '1 hour', '10 hours', 'loop', 'piano version', 'concert', 'bass boosted'];
export function youtubeQuery(sp) {
  const p = parseTitle(sp.title);
  const artist = (sp.artists && sp.artists[0]) || '';
  const title = String(sp.title || '').replace(/\s*[([](feat|ft|with)\b[^)\]]*[)\]]/gi, '').replace(/\s+-\s+(\d{4} )?remaster(ed)?( \d{4})?$/i, '').trim();
  return `${artist} ${title}${p.kind === 'version' && !fold(title).includes(p.version) ? ' ' + p.version : ''}`.trim();
}
// Mejor vídeo para una pista: results [{ videoId, title, channel, duration }] → { item, score } o null
export function pickYouTubeResult(sp, results, minScore = 0.55) {
  const p = prepTrack(sp);
  const want = fold(`${sp.title} ${p.version}`);
  let best = null;
  for (const r of results || []) {
    if (!r || !r.videoId) continue;
    const rt = fold(r.title);
    const rtT = new Set(tokens(rt));
    const ch = fold(String(r.channel || '').replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, ''));
    const baseT = tokens(p.base);
    const cov = baseT.length ? baseT.filter(w => rtT.has(w)).length / baseT.length : 0;
    const prim = p.artists[0] || '';
    const artistIn = prim && (tokens(prim).every(w => rtT.has(w)) || jaroWinkler(prim, ch) >= 0.9 || ch.includes(prim));
    let s = 0.6 * cov + 0.4 * (artistIn ? 1 : 0.3);
    for (const w of YT_AVOID) if ((' ' + rt + ' ').includes(' ' + w + ' ') && !(' ' + want + ' ').includes(' ' + w + ' ')) s *= 0.5;
    if (p.kind === 'version') {
      const vt = tokens(p.version).filter(w => !VERSION_GENERIC.has(w));
      if (vt.length && !vt.every(w => rtT.has(w))) s *= 0.6;
    }
    if (p.duration > 0 && r.duration > 0) {
      const d = Math.abs(p.duration - r.duration);
      s *= d <= 5 ? 1 : d <= 15 ? 0.92 : d <= 40 ? 0.8 : 0.55;
    }
    if (/\s-\s*topic$/i.test(r.channel || '') || /vevo$/i.test(r.channel || '') || /\bofficial (audio|video|music video)\b/.test(rt)) s = Math.min(1, s * 1.06);
    if (!best || s > best.score) best = { item: r, score: Math.round(s * 1000) / 1000 };
  }
  return best && best.score >= minScore ? best : null;
}

// Enlaces de búsqueda para comprar la pista (solo se abren en el navegador)
export const BUY_STORES = [
  { key: 'beatport', label: 'Beatport', url: (q) => `https://www.beatport.com/search?q=${q}` },
  { key: 'bandcamp', label: 'Bandcamp', url: (q) => `https://bandcamp.com/search?q=${q}&item_type=t` },
  { key: 'itunes', label: 'iTunes', url: (q) => `https://music.apple.com/es/search?term=${q}` }
];
export function buyLinks(sp) {
  const artist = (sp.artists && sp.artists[0]) || sp.artist || '';
  const title = String(sp.title || '').replace(/\s*[([](feat|ft|with)\b[^)\]]*[)\]]/gi, '').replace(/\s+-\s+(\d{4} )?remaster(ed)?( \d{4})?$/i, '').trim();
  const q = encodeURIComponent(`${artist} ${title}`.trim());
  return BUY_STORES.map(s => ({ key: s.key, label: s.label, url: s.url(q) }));
}
