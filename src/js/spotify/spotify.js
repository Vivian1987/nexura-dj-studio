// Importar listas de Spotify (solo metadatos). Con la cuenta conectada se usa la Web API oficial
// (paginación completa); sin cuenta, o si la API no deja leer la lista, la página pública de inserción
// (máx. ~100 pistas). No se descarga ni se extrae audio de Spotify.
import { platform } from '../platform.js';
import { parseSpotifyInput, parseEmbedHtml, mapApiTrack, mapPlaylistPage, SPOTIFY_EMBED_LIMIT } from './spotify-core.js';

const MAX_TRACKS = 10000;

export class SpotifyService {
  constructor(getSettings) { this.getSettings = getSettings; }
  get clientId() { return (this.getSettings().spotifyClientId || '').trim(); }
  async status() { try { return await platform.spotify.status(); } catch (_) { return { connected: false, user: '' }; } }
  async connected() { return (await this.status()).connected; }

  async get(url) {
    const r = await platform.spotify.api(url);
    if (r && r.ok) return r.data;
    const status = r ? r.status : 0;
    const msg = (r && r.data && r.data.error && r.data.error.message) || '';
    const err = new Error(status === 404 ? 'Spotify no encuentra la lista o tu app no tiene acceso a ella'
      : status === 403 ? 'Spotify no permite leer esta lista con tu app' + (msg ? ` (${msg})` : '')
      : status === 401 ? 'La sesión de Spotify ha caducado: vuelve a conectar la cuenta'
      : status === 429 ? 'Spotify pide esperar un poco antes de seguir (demasiadas peticiones)'
      : 'Error de la API de Spotify' + (status ? ' (HTTP ' + status + ')' : '') + (msg ? ': ' + msg : ''));
    err.status = status;
    throw err;
  }

  // input: enlace o URI. Devuelve { type, id, name, owner, cover, tracks, source: 'api'|'embed', truncated, warning }
  async importList(input, onProgress = () => {}) {
    const ref = typeof input === 'object' && input ? input : parseSpotifyInput(input);
    if (!ref) throw new Error('No reconozco ese enlace. Pega el enlace de una lista, álbum o canción de Spotify (open.spotify.com/… o spotify:playlist:…).');
    let warning = '';
    if (await this.connected()) {
      try { return { ...(await this.viaApi(ref, onProgress)), ref }; }
      catch (e) { warning = e.message; }
    }
    onProgress({ phase: 'embed' });
    let list;
    try { list = parseEmbedHtml(await platform.spotify.embed(ref.type, ref.id), ref); }
    catch (e) { throw new Error(warning ? `${warning}. Tampoco se pudo leer la página pública: ${e.message}` : e.message); }
    if (!list.tracks.length) throw new Error('La lista está vacía o no es pública.');
    if (list.truncated) warning = (warning ? warning + '. ' : '') + `Sin cuenta conectada solo se leen las primeras ${SPOTIFY_EMBED_LIMIT} pistas: conecta tu cuenta en Ajustes → Spotify para importar la lista completa.`;
    return { ...list, type: list.type || ref.type, id: list.id || ref.id, ref, warning };
  }

  async viaApi(ref, onProgress) {
    const id = encodeURIComponent(ref.id);
    if (ref.type === 'track') {
      const t = mapApiTrack(await this.get(`/v1/tracks/${id}`));
      if (!t) throw new Error('No se pudo leer la canción');
      return { type: 'track', id: ref.id, name: t.title, owner: t.artists.join(', '), cover: t.cover, tracks: [t], source: 'api' };
    }
    if (ref.type === 'album') {
      const a = await this.get(`/v1/albums/${id}`);
      const cover = pickCover(a.images);
      const tracks = [];
      let page = a.tracks, guard = 0;
      while (page && guard++ < 200) {
        for (const x of page.items || []) { const t = mapApiTrack(x, cover); if (t) { t.album = t.album || a.name; tracks.push(t); } }
        onProgress({ phase: 'api', n: tracks.length, total: page.total || a.total_tracks || 0 });
        page = page.next && tracks.length < MAX_TRACKS ? await this.get(page.next) : null;
      }
      return { type: 'album', id: ref.id, name: a.name, owner: (a.artists || []).map(x => x.name).join(', '), cover, tracks, source: 'api' };
    }
    const pl = await this.get(`/v1/playlists/${id}`);
    const total = (pl.items && pl.items.total) || (pl.tracks && pl.tracks.total) || 0;
    // /items es el nombre actual del recurso; /tracks, el anterior (se prueba si el primero no existe)
    let page;
    try { page = await this.get(`/v1/playlists/${id}/items?limit=50`); }
    catch (e) { if (e.status !== 404 && e.status !== 400 && e.status !== 403) throw e; page = await this.get(`/v1/playlists/${id}/tracks?limit=100`); }
    const tracks = [];
    let guard = 0;
    while (page && guard++ < 400) {
      tracks.push(...mapPlaylistPage(page));
      onProgress({ phase: 'api', n: tracks.length, total: page.total || total });
      page = page.next && tracks.length < MAX_TRACKS ? await this.get(page.next) : null;
    }
    return { type: 'playlist', id: ref.id, name: pl.name, owner: (pl.owner && (pl.owner.display_name || pl.owner.id)) || '', cover: pickCover(pl.images), tracks, source: 'api' };
  }

  // «Mis listas»: [{ id, name, owner, count, cover }]
  async myPlaylists() {
    if (!(await this.connected())) throw new Error('Conecta tu cuenta de Spotify en Ajustes → Spotify para ver tus listas.');
    const out = [];
    let page = await this.get('/v1/me/playlists?limit=50'), guard = 0;
    while (page && guard++ < 100) {
      for (const p of page.items || []) {
        if (!p || !p.id) continue;
        out.push({ id: p.id, name: p.name, owner: (p.owner && (p.owner.display_name || p.owner.id)) || '', count: (p.items && p.items.total) || (p.tracks && p.tracks.total) || 0, cover: pickCover(p.images) });
      }
      page = page.next ? await this.get(page.next) : null;
    }
    return out;
  }
}

function pickCover(images) {
  const arr = (images || []).filter(x => x && x.url).sort((a, b) => (a.width || 0) - (b.width || 0));
  return (arr.find(x => (x.width || 0) >= 200) || arr[arr.length - 1] || {}).url || '';
}
