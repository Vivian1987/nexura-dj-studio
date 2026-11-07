// Integración con YouTube mediante el reproductor oficial (IFrame Player API)
// y la YouTube Data API v3. El audio de YouTube no se extrae ni se procesa:
// se reproduce en el reproductor oficial y se controla desde los decks.
import { platform } from '../platform.js';
import { clamp } from '../util.js';

let apiPromise = null;
export function loadYouTubeApi() {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.onerror = () => { apiPromise = null; reject(new Error('No se pudo cargar el reproductor de YouTube (¿sin conexión?)')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}

export function parseYouTubeInput(input) {
  const s = String(input || '').trim();
  try {
    const u = new URL(s);
    const list = u.searchParams.get('list');
    const v = u.searchParams.get('v') || (u.hostname.includes('youtu.be') ? u.pathname.slice(1) : null);
    if (list) return { playlistId: list, videoId: v };
    if (v) return { videoId: v };
    const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{6,})/);
    if (m) return { videoId: m[2] };
  } catch (_) { /* no es URL */ }
  if (/^(PL|UU|LL|FL|OL|RD|OLAK5uy_)[\w-]{8,}$/.test(s)) return { playlistId: s };
  if (/^[\w-]{11}$/.test(s)) return { videoId: s };
  return {};
}

export function isoDuration(iso) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export class YouTubeService {
  constructor(getSettings) {
    this.getSettings = getSettings;
    this.hidden = null;
  }
  get apiKey() { return (this.getSettings().ytApiKey || '').trim(); }
  async connected() { try { return (await platform.yt.status()).connected; } catch (_) { return false; } }
  async canUseApi() { return !!this.apiKey || await this.connected(); }

  async api(endpoint, params) { return platform.yt.api(endpoint, params, this.apiKey); }

  async durations(ids) {
    const map = {};
    for (let i = 0; i < ids.length; i += 50) {
      const r = await this.api('videos', { part: 'contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
      for (const v of r.items || []) map[v.id] = isoDuration(v.contentDetails.duration);
    }
    return map;
  }

  async importPlaylist(input, onProgress = () => {}) {
    const { playlistId, videoId } = parseYouTubeInput(input);
    if (!playlistId && videoId) {
      const items = await this.videosInfo([videoId]);
      return { playlist: null, items };
    }
    if (!playlistId) throw new Error('No reconozco ese enlace. Pega la URL de un vídeo o de una lista de YouTube.');
    // Las listas «Mix» automáticas (RD…) no existen en la Data API: se leen con el reproductor
    const isMix = /^RD/.test(playlistId);
    try {
      if (!isMix && await this.canUseApi()) return await this.importViaApi(playlistId, onProgress);
      const r = await this.importViaPlayer(playlistId, onProgress);
      if (isMix) r.playlist.title = 'Mix de YouTube' + (r.items[0] && r.items[0].title ? ' · ' + r.items[0].title.slice(0, 30) : '');
      return r;
    } catch (e) {
      // Si la lista no se puede leer pero el enlace tiene un vídeo, importamos ese vídeo
      if (videoId) return { playlist: null, items: await this.videosInfo([videoId]), warning: e.message };
      throw e;
    }
  }

  async importViaApi(playlistId, onProgress) {
    let title = 'Lista de YouTube';
    try {
      const pl = await this.api('playlists', { part: 'snippet', id: playlistId });
      if (pl.items && pl.items[0]) title = pl.items[0].snippet.title;
    } catch (_) { /* listas especiales sin metadatos */ }
    const items = [];
    let pageToken = '';
    do {
      const r = await this.api('playlistItems', { part: 'snippet,contentDetails', playlistId, maxResults: 50, pageToken });
      for (const it of r.items || []) {
        const sn = it.snippet;
        if (!sn || sn.title === 'Private video' || sn.title === 'Deleted video') continue;
        items.push({
          videoId: it.contentDetails.videoId, title: sn.title,
          channel: sn.videoOwnerChannelTitle || sn.channelTitle || '',
          thumb: (sn.thumbnails && (sn.thumbnails.medium || sn.thumbnails.default) || {}).url || ''
        });
      }
      onProgress(items.length);
      pageToken = r.nextPageToken || '';
    } while (pageToken && items.length < 5000);
    try {
      const d = await this.durations(items.map(i => i.videoId));
      for (const it of items) it.duration = d[it.videoId] || 0;
    } catch (_) { /* duración opcional */ }
    return { playlist: { playlistId, title }, items };
  }

  // Sin clave de API: el reproductor oficial devuelve los IDs de la lista (hasta 200)
  async importViaPlayer(playlistId, onProgress) {
    const YT = await loadYouTubeApi();
    const ids = await new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:200px;height:200px;';
      const inner = document.createElement('div');
      host.appendChild(inner);
      document.body.appendChild(host);
      let done = false;
      const finish = (fn, v) => { if (done) return; done = true; try { p.destroy(); } catch (_) {} host.remove(); fn(v); };
      const p = new YT.Player(inner, {
        width: 200, height: 200,
        playerVars: { listType: 'playlist', list: playlistId, autoplay: 0, origin: location.origin },
        events: {
          onReady: () => {
            const tryGet = (n) => {
              const l = p.getPlaylist && p.getPlaylist();
              if (l && l.length) finish(resolve, l);
              else if (n > 0) setTimeout(() => tryGet(n - 1), 400);
              else finish(reject, new Error('La lista está vacía, es privada o no existe.'));
            };
            tryGet(25);
          },
          onError: () => finish(reject, new Error('YouTube no permite cargar esta lista.'))
        }
      });
      setTimeout(() => finish(reject, new Error('Tiempo de espera agotado al leer la lista.')), 20000);
    });
    const items = await this.videosInfo(ids, onProgress);
    return { playlist: { playlistId, title: 'Lista ' + playlistId.slice(0, 10) + '…' }, items };
  }

  async videosInfo(ids, onProgress = () => {}) {
    if (await this.canUseApi()) {
      const items = [];
      for (let i = 0; i < ids.length; i += 50) {
        const r = await this.api('videos', { part: 'snippet,contentDetails', id: ids.slice(i, i + 50).join(','), maxResults: 50 });
        for (const v of r.items || []) {
          items.push({
            videoId: v.id, title: v.snippet.title, channel: v.snippet.channelTitle,
            thumb: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url || '',
            duration: isoDuration(v.contentDetails.duration)
          });
        }
        onProgress(items.length);
      }
      return items;
    }
    let n = 0;
    return pool(ids, 6, async (id) => {
      const o = await platform.yt.oembed(id);
      onProgress(++n);
      return { videoId: id, title: o ? o.title : id, channel: o ? o.author_name : '', thumb: o ? o.thumbnail_url : '' };
    });
  }

  async myPlaylists() {
    if (!(await this.connected())) throw new Error('Conecta tu cuenta de Google en Ajustes → YouTube para ver tus listas.');
    const out = [];
    let pageToken = '';
    do {
      const r = await this.api('playlists', { part: 'snippet,contentDetails', mine: 'true', maxResults: 50, pageToken });
      for (const p of r.items || []) out.push({ playlistId: p.id, title: p.snippet.title, count: p.contentDetails.itemCount, thumb: (p.snippet.thumbnails.default || {}).url });
      pageToken = r.nextPageToken || '';
    } while (pageToken);
    return out;
  }

  async search(q) {
    const r = await this.api('search', { part: 'snippet', q, type: 'video', maxResults: 25, videoCategoryId: '10' });
    const ids = (r.items || []).map(i => i.id.videoId).filter(Boolean);
    return this.videosInfo(ids);
  }
}

// Reproductor de YouTube asociado a un deck
export class YTSource {
  constructor(container) {
    this.container = container;
    this.player = null;
    this.ready = false;
    this.videoId = null;
    this.state = -1;
    this.rate = 1;
    this.onEnded = null;
    this.onError = null;
  }
  async load(videoId) {
    const YT = await loadYouTubeApi();
    this.videoId = videoId;
    if (this.player && this.ready) {
      this.player.cueVideoById(videoId, 0);
      return;
    }
    await new Promise((resolve) => {
      const inner = document.createElement('div');
      this.container.innerHTML = '';
      this.container.appendChild(inner);
      this.player = new YT.Player(inner, {
        width: '100%', height: '100%', videoId,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, origin: location.origin, iv_load_policy: 3 },
        events: {
          onReady: () => { this.ready = true; this.player.setVolume(0); resolve(); },
          onStateChange: (e) => { this.state = e.data; if (e.data === 0 && this.onEnded) this.onEnded(); },
          onError: (e) => { if (this.onError) this.onError(e.data); resolve(); }
        }
      });
    });
  }
  play() { if (this.ready) this.player.playVideo(); }
  pause() { if (this.ready) this.player.pauseVideo(); }
  seek(t) { if (this.ready) this.player.seekTo(Math.max(0, t), true); }
  time() { return this.ready && this.player.getCurrentTime ? this.player.getCurrentTime() || 0 : 0; }
  duration() { return this.ready && this.player.getDuration ? this.player.getDuration() || 0 : 0; }
  isPlaying() { return this.state === 1 || this.state === 3; }
  setRate(r) {
    if (!this.ready) return 1;
    const want = clamp(Math.round(r * 20) / 20, 0.25, 2); // pasos de 0,05
    if (want !== this.rate) { this.player.setPlaybackRate(want); this.rate = want; }
    return this.player.getPlaybackRate ? this.player.getPlaybackRate() : want;
  }
  setVolume(v) {
    if (!this.ready) return;
    const vol = Math.round(clamp(v, 0, 1) * 100);
    if (vol !== this._vol) { this.player.setVolume(vol); this._vol = vol; }
  }
  destroy() { try { this.player && this.player.destroy(); } catch (_) {} this.player = null; this.ready = false; this.container.innerHTML = ''; }
}
