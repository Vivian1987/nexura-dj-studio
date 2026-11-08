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
    cues: Array(8).fill(null), loops: Array(8).fill(null), cueLoops: Array(8).fill(null),
    added: Date.now(), plays: 0, lastPlayed: 0, analyzed: false, bpmLocked: false, keyLocked: false
  };
}

// Biblioteca protegida (settings.protectLibrary): qué no se puede hacer y el aviso que se muestra
const PROTECTED = {
  remove: 'borrar pistas', crate: 'crear, borrar, renombrar u ordenar crates', crateTracks: 'añadir o quitar pistas de las crates',
  smart: 'crear, editar o borrar smart crates', tags: 'editar etiquetas ni valoraciones', grid: 'cambiar el BPM ni el beatgrid'
};
export const CRATE_SORTS = { custom: 'Personalizado (arrastrar)', alpha: 'Alfabético', created: 'Fecha de creación' };

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
    this.protected = false;   // lo fija la app desde settings.protectLibrary
    this._byPath = null;      // índice ruta → pista (las pistas relocalizadas conservan su id antiguo)
    this.saveSoon = debounce(() => this.save(), 800);
  }

  // Comprobación central de «Proteger biblioteca»: devuelve false (y avisa) si la acción no está permitida
  guard(kind) {
    if (!this.protected || !PROTECTED[kind]) return true;
    this.emit('protected', `Biblioteca protegida: no se puede ${PROTECTED[kind]}. Quita el candado 🔒 para hacer cambios.`);
    return false;
  }

  async load() {
    const d = await platform.storeGet('library');
    let migrated = false;
    if (d) {
      for (const t of d.tracks || []) {
        t.cues = t.cues || Array(8).fill(null);
        t.loops = t.loops || Array(8).fill(null);
        if (t.source === 'local' && !t.cueLoops) t.cueLoops = Array(8).fill(null);
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
  // Pista por ruta: primero por id (hash de la ruta) y, si no, por la ruta guardada (pistas relocalizadas)
  byPath(p) {
    const t = this.tracks.get(hashId(p));
    if (t) return t;
    if (!this._byPath) { this._byPath = new Map(); for (const x of this.tracks.values()) if (x.path) this._byPath.set(x.path.toLowerCase(), x); }
    return this._byPath.get(String(p).toLowerCase()) || null;
  }

  addFiles(infos, crateId = null) {
    const added = [];
    for (const info of infos) {
      let t = this.byPath(info.path);
      if (!t) { t = newTrack(info); this.tracks.set(t.id, t); if (this._byPath) this._byPath.set(t.path.toLowerCase(), t); }
      added.push(t);
    }
    if (crateId && this.guard('crateTracks')) this.addToCrate(crateId, added.map(t => t.id));
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
  // Cambios hechos a mano por el usuario (etiquetas, valoración, explicit): respetan la protección
  editTrack(id, patch) { if (!this.guard('tags')) return false; this.update(id, patch); return true; }
  setRating(ids, rating) {
    if (!this.guard('tags')) return false;
    const r = Math.max(0, Math.min(5, Math.round(rating) || 0));
    for (const id of ids) { const t = this.tracks.get(id); if (t) t.rating = r; }
    this.saveSoon(); this.emit('change');
    return true;
  }
  setExplicit(ids, on) {
    if (!this.guard('tags')) return false;
    for (const id of ids) { const t = this.tracks.get(id); if (t) t.explicit = !!on; }
    this.saveSoon(); this.emit('change');
    return true;
  }

  remove(ids) {
    if (!this.guard('remove')) return false;
    for (const id of ids) this.tracks.delete(id);
    for (const c of this.crates) c.ids = c.ids.filter(i => !ids.includes(i));
    this.prepare = this.prepare.filter(i => !ids.includes(i));
    for (const p of this.ytPlaylists) p.ids = p.ids.filter(i => !ids.includes(i));
    this._byPath = null;
    this.saveSoon();
    this.emit('change');
    return true;
  }

  // Relocalizar: cambia la ruta conservando el id (crates, Prepare, historial, formas de onda, stems,
  // cues y beatgrid siguen apuntando a la misma pista). moves: [{ id, path, size? }]
  relocate(moves) {
    let n = 0;
    for (const m of moves) {
      const t = this.tracks.get(m.id);
      if (!t || !m.path) continue;
      t.path = m.path;
      if (m.size) t.size = m.size;
      n++;
    }
    this._byPath = null;
    if (n) { this.saveSoon(); this.emit('change'); }
    return n;
  }

  // --- Crates
  // (las crates antiguas no tienen «created»: se ordenan por su posición, que es el orden en que se crearon)
  createCrate(name) {
    if (!this.guard('crate')) return null;
    const c = { id: uid(), name, ids: [], created: Date.now() };
    this.crates.push(c); this.saveSoon(); this.emit('change'); return c;
  }
  renameCrate(id, name) { if (!this.guard('crate')) return; const c = this.crates.find(c => c.id === id); if (c) { c.name = name; this.saveSoon(); this.emit('change'); } }
  deleteCrate(id) { if (!this.guard('crate')) return false; this.crates = this.crates.filter(c => c.id !== id); this.saveSoon(); this.emit('change'); return true; }
  setCrateColor(id, color) { if (!this.guard('crate')) return; const c = this.crates.find(c => c.id === id); if (c) { c.color = color || null; this.saveSoon(); this.emit('change'); } }
  // Orden personalizado: mueve la crate «id» delante de «beforeId» (o al final)
  moveCrate(id, beforeId) {
    if (!this.guard('crate') || id === beforeId) return;
    const i = this.crates.findIndex(c => c.id === id);
    if (i < 0) return;
    const [c] = this.crates.splice(i, 1);
    const j = beforeId ? this.crates.findIndex(x => x.id === beforeId) : -1;
    if (j < 0) this.crates.push(c); else this.crates.splice(j, 0, c);
    this.saveSoon(); this.emit('change');
  }
  sortedCrates(mode = 'custom') {
    const list = this.crates.map((c, i) => ({ c, i }));
    if (mode === 'alpha') list.sort((a, b) => a.c.name.localeCompare(b.c.name, 'es', { numeric: true, sensitivity: 'base' }));
    else if (mode === 'created') list.sort((a, b) => (a.c.created || 0) - (b.c.created || 0) || a.i - b.i);
    return list.map(x => x.c);
  }
  cratesOf(id) { return this.crates.filter(c => c.ids.includes(id)); }
  addToCrate(id, ids) {
    if (!this.guard('crateTracks')) return false;
    const c = this.crates.find(c => c.id === id);
    if (!c) return false;
    for (const i of ids) if (!c.ids.includes(i)) c.ids.push(i);
    this.saveSoon(); this.emit('change');
    return true;
  }
  removeFromCrate(id, ids) {
    if (!this.guard('crateTracks')) return;
    const c = this.crates.find(c => c.id === id);
    if (!c) return;
    c.ids = c.ids.filter(i => !ids.includes(i));
    this.saveSoon(); this.emit('change');
  }
  deleteYtPlaylist(id) { if (!this.guard('crate')) return false; this.ytPlaylists = this.ytPlaylists.filter(p => p.id !== id); this.saveSoon(); this.emit('change'); return true; }

  // --- Smart crates
  saveSmart(sc) {
    if (!this.guard('smart')) return false;
    const i = this.smart.findIndex(s => s.id === sc.id);
    if (i >= 0) this.smart[i] = sc; else this.smart.push({ ...sc, id: sc.id || uid() });
    this.saveSoon(); this.emit('change');
    return true;
  }
  deleteSmart(id) { if (!this.guard('smart')) return false; this.smart = this.smart.filter(s => s.id !== id); this.saveSoon(); this.emit('change'); return true; }
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
  // Pistas marcadas como tocadas en una sesión (por defecto la actual), sin las anteriores a un reinicio
  playedIds(sessionId = null) {
    const s = sessionId ? this.history.find(h => h.id === sessionId) : this.session;
    if (!s) return new Set();
    const from = s.resetAt || 0;
    return new Set(s.entries.filter(e => e.time > from).map(e => e.id));
  }
  // «Reiniciar pistas tocadas»: quita la marca de una sesión o de todas (el historial no se borra)
  resetPlayed(sessionId = null) {
    const now = Date.now();
    for (const h of this.history) if (!sessionId || h.id === sessionId) h.resetAt = now;
    this.saveSoon(); this.emit('change');
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
        const hay = `${t.title} ${t.artist} ${t.album} ${t.genre} ${t.comment} ${t.key} ${t.camelot} ${t.year || ''} ${t.bpm ? Math.round(t.bpm) : ''}`.toLowerCase();
        return tokens.every(tok => hay.includes(tok));
      });
    }
    if (sort && sort.field) {
      const f = sort.field, d = sort.dir;
      list = list.slice().sort((a, b) => {
        let x = a[f], y = b[f];
        if (f === 'camelot') { x = camelotSortKey(x); y = camelotSortKey(y); }
        if (f === 'explicit') { x = a.explicit ? 1 : 0; y = b.explicit ? 1 : 0; return (y - x) * d; }
        if (f === 'rating') { x = a.rating || 0; y = b.rating || 0; return (y - x) * d; }
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
