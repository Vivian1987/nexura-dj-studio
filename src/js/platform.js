// Capa de plataforma: usa el puente de Electron (window.nexura) y, si no existe
// (modo navegador para pruebas), recurre a APIs web equivalentes.
const N = window.nexura;
export const isDesktop = !!(N && N.isDesktop);

const webFiles = new Map();
const webWaves = new Map();

function webInfo(file) {
  const id = 'web:' + file.name + ':' + file.size;
  webFiles.set(id, file);
  const base = file.name.replace(/\.[^.]+$/, '');
  const parts = base.split(' - ');
  return {
    path: id, size: file.size, mtime: file.lastModified,
    title: parts.length > 1 ? parts.slice(1).join(' - ') : base,
    artist: parts.length > 1 ? parts[0] : ''
  };
}

function pickWeb(dir) {
  return new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.multiple = true;
    inp.accept = 'audio/*';
    if (dir) inp.webkitdirectory = true;
    inp.onchange = () => resolve([...inp.files].filter(f => /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|mp4|webm)$/i.test(f.name)).map(webInfo));
    inp.click();
  });
}

export const platform = {
  async info() {
    if (N) return N.info();
    return { version: 'web', name: 'Nexura DJ Studio', platform: 'web', recordings: '(descargas)' };
  },
  async storeGet(name) {
    if (N) return N.storeGet(name);
    try { return JSON.parse(localStorage.getItem('nexura_' + name)); } catch (_) { return null; }
  },
  async storeSet(name, data) {
    if (N) return N.storeSet(name, data);
    try { localStorage.setItem('nexura_' + name, JSON.stringify(data)); } catch (_) { /* cuota */ }
    return true;
  },
  async readFile(p) {
    if (N) return N.readFile(p);
    const f = webFiles.get(p);
    if (!f) throw new Error('El archivo ya no está disponible en esta sesión del navegador');
    return new Uint8Array(await f.arrayBuffer());
  },
  async exists(p) { if (N) return N.exists(p); return webFiles.has(p); },
  // Archivos perdidos por lotes: [true/false] o null si no se puede comprobar (navegador)
  async existsMany(paths) { if (N && N.existsMany) return N.existsMany(paths); return null; },
  // Listas .m3u / .m3u8: [{ path, name, data }] o null
  async openPlaylist() {
    if (N && N.openPlaylist) return N.openPlaylist();
    return new Promise((resolve) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = '.m3u,.m3u8';
      inp.onchange = async () => resolve(inp.files.length ? await Promise.all([...inp.files].map(async f => ({ path: f.name, name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))) : null);
      inp.click();
    });
  },
  // Lista o archivo soltado: bytes y ruta (en el navegador solo el nombre)
  async playlistFromFile(file) {
    const p = N && N.pathForFile ? N.pathForFile(file) : null;
    return { path: p || file.name, name: file.name, data: new Uint8Array(await file.arrayBuffer()) };
  },
  // Relocalizar: elegir carpeta y buscar archivos por nombre → { dir, files: [{path, size}] } o null
  async findFiles(names) {
    if (N && N.findFiles) return N.findFiles(names);
    throw new Error('Relocalizar archivos solo está disponible en la app de escritorio');
  },
  // Carátula en miniatura (data: URL) o null
  async artGet(id, p) { if (N && N.artGet) return N.artGet(id, p); return null; },
  async openFiles() { if (N) return N.openFiles(); return pickWeb(false); },
  async openFolder() { if (N) return N.openFolder(); return pickWeb(true); },
  // Devuelve [{ path, name, data: Uint8Array }] o null
  async openLibraryFile() {
    if (N) return N.openLibraryFile();
    return new Promise((resolve) => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true; inp.accept = '.xml,.nml,.vdjfolder,.m3u,.m3u8,.crate';
      inp.onchange = async () => resolve(inp.files.length ? await Promise.all([...inp.files].map(async f => ({ path: f.name, name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))) : null);
      inp.click();
    });
  },
  // Primeros n bytes de un archivo (escritorio); en el navegador, el archivo entero si se añadió
  async readHead(p, n) {
    if (N) return N.readHead(p, n);
    const f = webFiles.get(p); if (!f) throw new Error('Archivo no disponible');
    return new Uint8Array(await f.slice(0, n).arrayBuffer());
  },
  // Información (etiquetas) de rutas de audio del disco; en el navegador no hay acceso a rutas
  async infoForPaths(paths) { if (N) return N.infoForPaths(paths); return []; },
  async openSample() {
    if (N) return N.openSample();
    const r = await pickWeb(false);
    return r[0] ? r[0].path : null;
  },
  async filesFromDrop(fileList) {
    const files = [...fileList];
    if (N) {
      const paths = files.map(f => N.pathForFile(f)).filter(Boolean);
      return N.infoForPaths(paths);
    }
    return files.filter(f => /\.(mp3|wav|flac|ogg|oga|opus|m4a|aac|mp4|webm)$/i.test(f.name)).map(webInfo);
  },
  async waveGet(id) { if (N) return N.waveGet(id); return webWaves.get(id) || null; },
  async waveSet(id, data) { if (N) return N.waveSet(id, data); webWaves.set(id, data); return true; },
  async saveRecording(bytes, name) {
    if (N) return N.saveRecording(bytes, name);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const a = document.createElement('a');
    a.href = url; a.download = name + '.wav'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return name + '.wav';
  },
  showItem(p) { if (N) N.showItem(p); },
  openExternal(url) {
    if (N) return N.openExternal(url);
    if (url.startsWith('mailto:')) location.href = url; else window.open(url, '_blank', 'noopener');
  },
  async sendFeedback(payload) {
    if (N && N.sendFeedback) return N.sendFeedback(payload);
    // modo navegador (pruebas): sin webhook propio, directamente el respaldo
    const r = await fetch('https://formsubmit.co/ajax/contacto@nexuraia.com', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.success) !== 'true') throw new Error(j.message || 'HTTP ' + r.status);
    return true;
  },
  async postFeedback(url, payload) {
    if (N && N.postFeedback) return N.postFeedback(url, payload);
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  },
  // Stems (solo escritorio: necesita el motor de Demucs instalado en tools/stems)
  stems: {
    available: !!(N && N.stems),
    info(dir) { return N && N.stems ? N.stems.info(dir) : Promise.resolve({ installed: false, unsupported: true }); },
    status(ids, dir) { return N && N.stems ? N.stems.status(ids, dir) : Promise.resolve({}); },
    read(id, dir) { if (!N || !N.stems) throw new Error('Stems disponibles solo en la app de escritorio'); return N.stems.read(id, dir); },
    remove(id, dir) { return N && N.stems ? N.stems.remove(id, dir) : Promise.resolve(false); },
    install() { if (!N || !N.stems) throw new Error('Stems disponibles solo en la app de escritorio'); return N.stems.install(); },
    separate(jobs, dir, model) { if (!N || !N.stems) throw new Error('Stems disponibles solo en la app de escritorio'); return N.stems.separate(jobs, dir, model); },
    cancel() { return N && N.stems ? N.stems.cancel() : Promise.resolve(true); },
    onEvent(fn) { return N && N.stems ? N.stems.onEvent(fn) : () => {}; }
  },
  // Spotify (solo metadatos; la petición la hace el proceso principal). Modo simulado para pruebas:
  // si existe window.__nexuraSpotifyMock = { embed, api, login, logout, status } se usa en su lugar.
  spotify: {
    get mock() { return window.__nexuraSpotifyMock || null; },
    get available() { return !!(this.mock || (N && N.spotify)); },
    async embed(type, id) {
      if (this.mock) return this.mock.embed(type, id);
      if (N && N.spotify) return N.spotify.embed(type, id);
      throw new Error('La importación de Spotify solo está disponible en la app de escritorio');
    },
    async api(url) {
      if (this.mock) return this.mock.api(url);
      if (N && N.spotify) return N.spotify.api(url);
      throw new Error('La cuenta de Spotify solo se puede conectar en la app de escritorio');
    },
    async login(clientId) {
      if (this.mock) return this.mock.login(clientId);
      if (N && N.spotify) return N.spotify.login(clientId);
      throw new Error('Disponible solo en la app de escritorio');
    },
    async logout() { if (this.mock) return this.mock.logout(); if (N && N.spotify) return N.spotify.logout(); return true; },
    async status() {
      if (this.mock) return this.mock.status();
      if (N && N.spotify) return N.spotify.status();
      return { connected: false, user: '' };
    }
  },
  yt: {
    async oembed(id) {
      if (N) return N.yt.oembed(id);
      try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + id));
        return r.ok ? r.json() : null;
      } catch (_) { return null; }
    },
    async api(endpoint, params, apiKey) {
      if (N) return N.yt.api(endpoint, params, apiKey);
      if (!apiKey) throw new Error('Necesitas una clave de API de YouTube (Ajustes → YouTube)');
      const q = new URLSearchParams({ ...params, key: apiKey });
      const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${q}`);
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || 'Error de la API de YouTube');
      return j;
    },
    async login(id, secret) { if (N) return N.yt.login(id, secret); throw new Error('Disponible solo en la app de escritorio'); },
    async logout() { if (N) return N.yt.logout(); return true; },
    async status() { if (N) return N.yt.status(); return { connected: false }; }
  }
};
