// Biblioteca: pistas, crates, smart crates, historial, prepare y listas de YouTube
import { Emitter, hashId, uid, debounce } from '../util.js';
import { platform } from '../platform.js';
import { energyFrom, ENERGY_VERSION } from '../analysis/analysis-core.js';

export const SMART_FIELDS = {
  title: 'Título', artist: 'Artista', album: 'Álbum', genre: 'Género', bpm: 'BPM', camelot: 'Tonalidad (Camelot)',
  key: 'Tonalidad', year: 'Año', comment: 'Comentario', plays: 'Reproducciones', added: 'Añadida (días)', source: 'Origen', rating: 'Valoración', energy: 'Energía (IA)'
};
export const SMART_OPS = {
  contains: 'contiene', notcontains: 'no contiene', is: 'es', isnot: 'no es', gt: 'mayor que', lt: 'menor que', between: 'entre'
};

function newTrack(info) {
  return {
    id: hashId(info.path), path: info.path, source: 'local',
    title: info.title || '', artist: info.artist || '', album: info.album || '', genre: info.genre || '',
    year: info.year || '', comment: '', rating: 0,
    bpm: info.bpm ? parseFloat(info.bpm) || null : null, firstBeat: 0,
    key: info.key || '', camelot: '', keyTonic: null, keyMinor: null,
    duration: 0, size: info.size || 0, rmsDb: null,
    cues: Array(8).fill(null), loops: Array(8).fill(null),
    added: Date.now(), plays: 0, lastPlayed: 0, analyzed: false, bpmLocked: false, keyLocked: false
  };
}

export class Library extends Emitter {
  constructor() {
    super();
    this.tracks = new Map();
    this.crates = [];
    this.smart = [];
    this.history = [];
    this.prepare = [];
    this.ytPlaylists = [];
    this.session = null;
    this.saveSoon = debounce(() => this.save(), 800);
  }

  async load() {
    const d = await platform.storeGet('library');
    let migrated = false;
    if (d) {
      for (const t of d.tracks || []) {
        t.cues = t.cues || Array(8).fill(null);
        t.loops = t.loops || Array(8).fill(null);
        // recalcular la energía de pistas analizadas con una fórmula anterior (sin volver a analizar el audio)
        if (t.energyCurve && t.rmsDb != null && t.energyV !== ENERGY_VERSION) { t.energy = energyFrom(t.rmsDb, t.bpm, t.energyCurve); t.energyV = ENERGY_VERSION; migrated = true; }
        this.tracks.set(t.id, t);
      }
      this.crates = d.crates || [];
      this.smart = d.smart || [];
      this.history = d.history || [];
      this.prepare = d.prepare || [];
      this.ytPlaylists = d.ytPlaylists || [];
    }
    if (!this.smart.length) {
      this.smart.push({ id: uid(), name: 'House 120–130 BPM', match: 'all', rules: [{ field: 'bpm', op: 'between', value: '120', value2: '130' }] });
    }
    if (migrated) this.saveSoon();
    this.emit('change');
  }

  async save() {
    await platform.storeSet('library', {
      version: 1,
      tracks: [...this.tracks.values()],
      crates: this.crates, smart: this.smart,
      history: this.history.slice(-200),
      prepare: this.prepare, ytPlaylists: this.ytPlaylists
    });
  }

  get(id) { return this.tracks.get(id); }

  addFiles(infos, crateId = null) {
    const added = [];
    for (const info of infos) {
      const id = hashId(info.path);
      let t = this.tracks.get(id);
      if (!t) { t = newTrack(info); this.tracks.set(id, t); }
      added.push(t);
    }
    if (crateId) this.addToCrate(crateId, added.map(t => t.id));
    this.saveSoon();
    this.emit('change');
    return added;
  }

  addYouTubeItems(items, playlist) {
    const ids = [];
    for (const it of items) {
      const id = 'yt_' + it.videoId.replace(/[^\w-]/g, '');
      let t = this.tracks.get(id);
      if (!t) {
        t = newTrack({ path: 'youtube:' + it.videoId, title: it.title, artist: it.channel });
        t.id = id; t.source = 'youtube'; t.ytId = it.videoId; t.thumb = it.thumb || '';
        t.duration = it.duration || 0; t.analyzed = false;
        this.tracks.set(id, t);
      } else {
        if (it.title && !t.title) t.title = it.title;
        if (it.channel && !t.artist) t.artist = it.channel;
        if (it.duration) t.duration = it.duration;
      }
      ids.push(id);
    }
    if (playlist) {
      let pl = this.ytPlaylists.find(p => p.playlistId === playlist.playlistId);
      if (!pl) { pl = { id: uid(), playlistId: playlist.playlistId, title: playlist.title || 'Lista de YouTube', ids: [] }; this.ytPlaylists.push(pl); }
      pl.title = playlist.title || pl.title;
      pl.ids = ids;
    }
    this.saveSoon();
    this.emit('change');
    return ids;
  }

  update(id, patch) {
    const t = this.tracks.get(id);
    if (!t) return;
    Object.assign(t, patch);
    this.saveSoon();
    this.emit('track', t);
  }

  remove(ids) {
    for (const id of ids) this.tracks.delete(id);
    for (const c of this.crates) c.ids = c.ids.filter(i => !ids.includes(i));
    this.prepare = this.prepare.filter(i => !ids.includes(i));
    for (const p of this.ytPlaylists) p.ids = p.ids.filter(i => !ids.includes(i));
    this.saveSoon();
    this.emit('change');
  }

  // --- Crates
  createCrate(name) { const c = { id: uid(), name, ids: [] }; this.crates.push(c); this.saveSoon(); this.emit('change'); return c; }
  renameCrate(id, name) { const c = this.crates.find(c => c.id === id); if (c) { c.name = name; this.saveSoon(); this.emit('change'); } }
  deleteCrate(id) { this.crates = this.crates.filter(c => c.id !== id); this.saveSoon(); this.emit('change'); }
  addToCrate(id, ids) {
    const c = this.crates.find(c => c.id === id);
    if (!c) return;
    for (const i of ids) if (!c.ids.includes(i)) c.ids.push(i);
    this.saveSoon(); this.emit('change');
  }
  removeFromCrate(id, ids) {
    const c = this.crates.find(c => c.id === id);
    if (!c) return;
    c.ids = c.ids.filter(i => !ids.includes(i));
    this.saveSoon(); this.emit('change');
  }
  deleteYtPlaylist(id) { this.ytPlaylists = this.ytPlaylists.filter(p => p.id !== id); this.saveSoon(); this.emit('change'); }

  // --- Smart crates
  saveSmart(sc) {
    const i = this.smart.findIndex(s => s.id === sc.id);
    if (i >= 0) this.smart[i] = sc; else this.smart.push({ ...sc, id: sc.id || uid() });
    this.saveSoon(); this.emit('change');
  }
  deleteSmart(id) { this.smart = this.smart.filter(s => s.id !== id); this.saveSoon(); this.emit('change'); }
  matchRule(t, r) {
    let v = t[r.field];
    if (r.field === 'added') v = (Date.now() - (t.added || 0)) / 86400000;
    const num = parseFloat(v), a = parseFloat(r.value), b = parseFloat(r.value2);
    const s = String(v ?? '').toLowerCase(), q = String(r.value ?? '').toLowerCase();
    switch (r.op) {
      case 'contains': return s.includes(q);
      case 'notcontains': return !s.includes(q);
      case 'is': return s === q;
      case 'isnot': return s !== q;
      case 'gt': return num > a;
      case 'lt': return num < a;
      case 'between': return num >= Math.min(a, b) && num <= Math.max(a, b);
    }
    return false;
  }
  smartTracks(sc) {
    const all = [...this.tracks.values()];
    if (!sc.rules.length) return all;
    return all.filter(t => sc.match === 'any' ? sc.rules.some(r => this.matchRule(t, r)) : sc.rules.every(r => this.matchRule(t, r)));
  }

  // --- Prepare
  addToPrepare(ids) { for (const i of ids) if (!this.prepare.includes(i)) this.prepare.push(i); this.saveSoon(); this.emit('change'); }
  removeFromPrepare(ids) { this.prepare = this.prepare.filter(i => !ids.includes(i)); this.saveSoon(); this.emit('change'); }

  // --- Historial
  logPlay(track, deck) {
    if (!this.session) {
      this.session = { id: uid(), date: Date.now(), entries: [] };
      this.history.push(this.session);
    }
    const last = this.session.entries[this.session.entries.length - 1];
    if (last && last.id === track.id) return;
    this.session.entries.push({ id: track.id, title: track.title, artist: track.artist, bpm: track.bpm, key: track.camelot, deck, time: Date.now() });
    track.plays = (track.plays || 0) + 1;
    track.lastPlayed = Date.now();
    this.saveSoon();
    this.emit('change');
  }
  historyCsv(sessionId) {
    const s = this.history.find(h => h.id === sessionId);
    if (!s) return '';
    const rows = [['Hora', 'Deck', 'Artista', 'Título', 'BPM', 'Tonalidad']];
    for (const e of s.entries) rows.push([new Date(e.time).toLocaleTimeString(), e.deck + 1, e.artist, e.title, e.bpm || '', e.key || '']);
    return rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
  }

  // --- Consulta para la tabla
  view(viewId) {
    if (!viewId || viewId === 'all') return [...this.tracks.values()].filter(t => t.source === 'local');
    if (viewId === 'everything') return [...this.tracks.values()];
    if (viewId === 'prepare') return this.prepare.map(i => this.tracks.get(i)).filter(Boolean);
    if (viewId === 'yt-all') return [...this.tracks.values()].filter(t => t.source === 'youtube');
    const [kind, id] = viewId.split(':');
    if (kind === 'crate') { const c = this.crates.find(c => c.id === id); return c ? c.ids.map(i => this.tracks.get(i)).filter(Boolean) : []; }
    if (kind === 'smart') { const s = this.smart.find(s => s.id === id); return s ? this.smartTracks(s) : []; }
    if (kind === 'yt') { const p = this.ytPlaylists.find(p => p.id === id); return p ? p.ids.map(i => this.tracks.get(i)).filter(Boolean) : []; }
    if (kind === 'history') {
      const h = this.history.find(h => h.id === id);
      return h ? h.entries.map(e => this.tracks.get(e.id)).filter(Boolean) : [];
    }
    return [];
  }

  query(viewId, search = '', sort = { field: null, dir: 1 }) {
    let list = this.view(viewId);
    const q = search.trim().toLowerCase();
    if (q) {
      const tokens = q.split(/\s+/);
      list = list.filter(t => {
        const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.comment} ${t.key} ${t.camelot} ${t.bpm ? Math.round(t.bpm) : ''}`.toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      });
    }
    if (sort && sort.field) {
      const f = sort.field, d = sort.dir;
      list = list.slice().sort((a, b) => {
        let x = a[f], y = b[f];
        if (f === 'camelot') { x = camelotSortKey(x); y = camelotSortKey(y); }
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'es', { numeric: true })) * d;
      });
    }
    return list;
  }
}

function camelotSortKey(c) {
  const m = /^(\d+)([AB])$/.exec(c || '');
  return m ? parseInt(m[1], 10) * 2 + (m[2] === 'B' ? 1 : 0) : null;
}
