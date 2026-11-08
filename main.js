// Nexura DJ Studio — proceso principal (Electron)
// © NexuraIA
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, session, safeStorage, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const http = require('http');
const crypto = require('crypto');
const os = require('os');

const APP_NAME = 'Nexura DJ Studio';
const SRC_DIR = path.join(__dirname, 'src');
const AUDIO_EXT = new Set(['.mp3', '.wav', '.flac', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.mp4', '.webm']);
const isDev = process.argv.includes('--dev');
// Destino de las sugerencias de la beta:
// 1) Webhook propio de NexuraIA (n8n → envía el correo desde contacto@nexuraia.com). La URL va en
//    config.local.json (no se sube al repositorio; ver config.local.example.json) y entra en el instalador.
function readLocalConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8')); } catch (_) { return {}; }
}
const FEEDBACK_WEBHOOK = String(readLocalConfig().feedbackWebhook || '');
// 2) Respaldo: FormSubmit (servicio gratuito; requiere activar el correo la primera vez)
const FEEDBACK_ENDPOINT = 'https://formsubmit.co/ajax/contacto@nexuraia.com';

// El audio en tiempo real no debe frenarse cuando la ventana pierde el foco
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow = null;
let serverPort = 0;

// ---------------------------------------------------------------------------
// Rutas de datos
// ---------------------------------------------------------------------------
const dataDir = () => path.join(app.getPath('userData'), 'data');
const waveDir = () => path.join(dataDir(), 'waveforms');
const recDir = () => path.join(app.getPath('music'), APP_NAME, 'Grabaciones');

async function ensureDirs() {
  await fsp.mkdir(waveDir(), { recursive: true });
}

// ---------------------------------------------------------------------------
// Servidor local: la interfaz se sirve por http://localhost para que el
// reproductor oficial de YouTube (IFrame API) funcione (no admite file://).
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav'
};

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        let rel = urlPath === '/' ? '/index.html' : urlPath;
        const filePath = path.normalize(path.join(SRC_DIR, rel));
        if (!filePath.startsWith(SRC_DIR)) { res.writeHead(403); return res.end(); }
        const data = await fsp.readFile(filePath);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        });
        res.end(data);
      } catch (e) {
        res.writeHead(404); res.end('Not found');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ---------------------------------------------------------------------------
// Lectura de etiquetas (ID3v2 / ID3v1 / FLAC Vorbis) sin dependencias
// ---------------------------------------------------------------------------
function decodeText(buf, enc) {
  try {
    if (enc === 0) return buf.toString('latin1');
    if (enc === 3) return buf.toString('utf8');
    if (enc === 1) {
      if (buf[0] === 0xFE && buf[1] === 0xFF) return swap16(buf.slice(2)).toString('utf16le');
      if (buf[0] === 0xFF && buf[1] === 0xFE) return buf.slice(2).toString('utf16le');
      return buf.toString('utf16le');
    }
    if (enc === 2) return swap16(buf).toString('utf16le');
  } catch (_) { /* ignore */ }
  return buf.toString('latin1');
}
function swap16(b) { const c = Buffer.from(b); if (c.length % 2) return c.slice(0, -1).swap16(); return c.swap16(); }
const clean = (s) => (s || '').replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();

async function readTags(filePath) {
  const tags = {};
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const ver = head[3];
      const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
      const tag = Buffer.alloc(Math.min(size, 4 * 1024 * 1024));
      await fh.read(tag, 0, tag.length, 10);
      let p = 0;
      const idLen = ver === 2 ? 3 : 4;
      const hdrLen = ver === 2 ? 6 : 10;
      const map = ver === 2
        ? { TT2: 'title', TP1: 'artist', TAL: 'album', TCO: 'genre', TBP: 'bpm', TKE: 'key', TYE: 'year' }
        : { TIT2: 'title', TPE1: 'artist', TALB: 'album', TCON: 'genre', TBPM: 'bpm', TKEY: 'key', TYER: 'year', TDRC: 'year' };
      while (p + hdrLen < tag.length) {
        const id = tag.toString('latin1', p, p + idLen);
        if (!/^[A-Z0-9]+$/.test(id)) break;
        let fsize;
        if (ver === 2) fsize = (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5];
        else if (ver === 4) fsize = (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7];
        else fsize = tag.readUInt32BE(p + 4);
        const body = tag.slice(p + hdrLen, p + hdrLen + fsize);
        if (map[id] && body.length > 1) tags[map[id]] = clean(decodeText(body.slice(1), body[0]));
        p += hdrLen + fsize;
        if (fsize <= 0) break;
      }
    } else if (head.toString('latin1', 0, 4) === 'fLaC') {
      let pos = 4;
      for (let guard = 0; guard < 64; guard++) {
        const bh = Buffer.alloc(4);
        await fh.read(bh, 0, 4, pos);
        const last = bh[0] & 0x80, type = bh[0] & 0x7F;
        const len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
        if (type === 4) {
          const b = Buffer.alloc(len);
          await fh.read(b, 0, len, pos + 4);
          let q = 0;
          const vlen = b.readUInt32LE(q); q += 4 + vlen;
          const n = b.readUInt32LE(q); q += 4;
          for (let i = 0; i < n && q < b.length; i++) {
            const l = b.readUInt32LE(q); q += 4;
            const kv = b.toString('utf8', q, q + l); q += l;
            const eq = kv.indexOf('=');
            const k = kv.slice(0, eq).toUpperCase(), v = kv.slice(eq + 1);
            const m = { TITLE: 'title', ARTIST: 'artist', ALBUM: 'album', GENRE: 'genre', BPM: 'bpm', INITIALKEY: 'key', DATE: 'year' };
            if (m[k]) tags[m[k]] = clean(v);
          }
          break;
        }
        pos += 4 + len;
        if (last) break;
      }
    }
    if (!tags.title && path.extname(filePath).toLowerCase() === '.mp3') {
      const st = await fh.stat();
      if (st.size > 128) {
        const t = Buffer.alloc(128);
        await fh.read(t, 0, 128, st.size - 128);
        if (t.toString('latin1', 0, 3) === 'TAG') {
          tags.title = clean(t.toString('latin1', 3, 33));
          tags.artist = clean(t.toString('latin1', 33, 63));
          tags.album = clean(t.toString('latin1', 63, 93));
        }
      }
    }
  } catch (_) { /* fichero sin etiquetas legibles */ }
  finally { if (fh) await fh.close().catch(() => {}); }

  // Si no hay etiquetas, "Artista - Título.mp3"
  if (!tags.title) {
    const base = path.basename(filePath, path.extname(filePath));
    const m = base.split(' - ');
    if (m.length >= 2) { tags.artist = tags.artist || m[0].trim(); tags.title = m.slice(1).join(' - ').trim(); }
    else tags.title = base;
  }
  return tags;
}

// Carátula: APIC (ID3v2.3/2.4), PIC (ID3v2.2) o bloque PICTURE de FLAC → { mime, data } o null
function id3Pictures(tag, ver) {
  const pics = [];
  const idLen = ver === 2 ? 3 : 4, hdrLen = ver === 2 ? 6 : 10;
  let p = 0;
  while (p + hdrLen < tag.length) {
    const id = tag.toString('latin1', p, p + idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    let fsize;
    if (ver === 2) fsize = (tag[p + 3] << 16) | (tag[p + 4] << 8) | tag[p + 5];
    else if (ver === 4) fsize = (tag[p + 4] << 21) | (tag[p + 5] << 14) | (tag[p + 6] << 7) | tag[p + 7];
    else fsize = tag.readUInt32BE(p + 4);
    if (fsize <= 0) break;
    if (id === 'APIC' || id === 'PIC') {
      const b = tag.slice(p + hdrLen, p + hdrLen + fsize);
      const enc = b[0];
      let q = 1, mime;
      if (id === 'PIC') { mime = 'image/' + b.toString('latin1', 1, 4).toLowerCase().replace('jpg', 'jpeg'); q = 4; }
      else { const z = b.indexOf(0, 1); mime = b.toString('latin1', 1, z); q = z + 1; }
      const type = b[q]; q++;
      // descripción terminada en 0 (dos ceros alineados en UTF-16)
      if (enc === 1 || enc === 2) { while (q + 1 < b.length && !(b[q] === 0 && b[q + 1] === 0)) q += 2; q += 2; }
      else { while (q < b.length && b[q] !== 0) q++; q++; }
      if (q < b.length) pics.push({ type, mime: mime || 'image/jpeg', data: b.slice(q) });
    }
    p += hdrLen + fsize;
  }
  return pics;
}
async function readCover(filePath) {
  let fh;
  try {
    fh = await fsp.open(filePath, 'r');
    const head = Buffer.alloc(10);
    await fh.read(head, 0, 10, 0);
    let pics = [];
    if (head.toString('latin1', 0, 3) === 'ID3') {
      const size = (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
      const tag = Buffer.alloc(Math.min(size, 16 * 1024 * 1024));
      await fh.read(tag, 0, tag.length, 10);
      pics = id3Pictures(tag, head[3]);
    } else if (head.toString('latin1', 0, 4) === 'fLaC') {
      let pos = 4;
      for (let guard = 0; guard < 64; guard++) {
        const bh = Buffer.alloc(4);
        await fh.read(bh, 0, 4, pos);
        const last = bh[0] & 0x80, type = bh[0] & 0x7F, len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
        if (type === 6 && len < 16 * 1024 * 1024) {
          const b = Buffer.alloc(len);
          await fh.read(b, 0, len, pos + 4);
          let q = 0;
          const ptype = b.readUInt32BE(q); q += 4;
          const ml = b.readUInt32BE(q); q += 4; const mime = b.toString('latin1', q, q + ml); q += ml;
          const dl = b.readUInt32BE(q); q += 4 + dl + 16;
          const n = b.readUInt32BE(q); q += 4;
          pics.push({ type: ptype, mime, data: b.slice(q, q + n) });
        }
        pos += 4 + len;
        if (last) break;
      }
    }
    return pics.find(x => x.type === 3) || pics[0] || null; // 3 = portada
  } catch (_) { return null; }
  finally { if (fh) await fh.close().catch(() => {}); }
}

async function fileInfo(filePath) {
  const st = await fsp.stat(filePath);
  const tags = await readTags(filePath);
  return { path: filePath, size: st.size, mtime: st.mtimeMs, ...tags };
}

async function scanFolder(dir, out = [], depth = 0) {
  if (depth > 12) return out;
  let entries = [];
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.')) await scanFolder(full, out, depth + 1); }
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------
// YouTube: OAuth (opcional, para "Mis listas") y API Data v3
// ---------------------------------------------------------------------------
const secretsFile = () => path.join(dataDir(), 'secrets.bin');
let ytTokens = null; // { access_token, refresh_token, expiry, clientId, clientSecret }

async function loadSecrets() {
  try {
    const raw = await fsp.readFile(secretsFile());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    ytTokens = JSON.parse(json);
  } catch (_) { ytTokens = null; }
}
async function saveSecrets() {
  const json = JSON.stringify(ytTokens || {});
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, 'utf8');
  await fsp.writeFile(secretsFile(), data);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function ytOAuthLogin(clientId, clientSecret) {
  return new Promise((resolve, reject) => {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(12));
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (!u.searchParams.has('code') && !u.searchParams.has('error')) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body style="font-family:sans-serif;background:#0b0d14;color:#fff;text-align:center;padding-top:80px">' +
        '<h2>Nexura DJ Studio</h2><p>Cuenta conectada. Ya puedes volver a la aplicación.</p></body></html>');
      srv.close();
      if (u.searchParams.get('state') !== state) return reject(new Error('Estado OAuth no válido'));
      if (u.searchParams.has('error')) return reject(new Error(u.searchParams.get('error')));
      try {
        const body = new URLSearchParams({
          code: u.searchParams.get('code'), client_id: clientId, client_secret: clientSecret,
          code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: redirect
        });
        const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error_description || j.error || 'Error de token');
        ytTokens = { access_token: j.access_token, refresh_token: j.refresh_token, expiry: Date.now() + (j.expires_in - 60) * 1000, clientId, clientSecret };
        await saveSecrets();
        resolve({ ok: true });
      } catch (e) { reject(e); }
    });
    let redirect = '';
    srv.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${srv.address().port}`;
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: 'code',
        scope: 'https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent',
        code_challenge: challenge, code_challenge_method: 'S256', state
      });
      shell.openExternal(url);
    });
    setTimeout(() => { try { srv.close(); } catch (_) {} reject(new Error('Tiempo de espera agotado')); }, 5 * 60 * 1000);
  });
}

async function ytAccessToken() {
  if (!ytTokens || !ytTokens.refresh_token) return null;
  if (ytTokens.access_token && Date.now() < ytTokens.expiry) return ytTokens.access_token;
  const body = new URLSearchParams({
    client_id: ytTokens.clientId, client_secret: ytTokens.clientSecret,
    refresh_token: ytTokens.refresh_token, grant_type: 'refresh_token'
  });
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || 'No se pudo renovar la sesión de YouTube');
  ytTokens.access_token = j.access_token;
  ytTokens.expiry = Date.now() + (j.expires_in - 60) * 1000;
  await saveSecrets();
  return ytTokens.access_token;
}

// ---------------------------------------------------------------------------
// Stems (Demucs en tools/stems con su propio entorno de Python)
// ---------------------------------------------------------------------------
const { spawn } = require('child_process');
const STEM_NAMES = ['drums', 'bass', 'other', 'vocals'];
// El motor necesita una carpeta con permiso de escritura (uv crea ahí su .venv): en la app instalada
// los archivos van dentro del paquete (resources/stems), así que se copian a E:\IA\nexura-stems si
// existe E:\IA o a los datos de la app. Con «npm start» se usa la misma carpeta: un solo entorno.
const stemsSource = () => (app.isPackaged ? path.join(process.resourcesPath, 'stems') : path.join(__dirname, 'tools', 'stems'));
function stemsTool() {
  const dir = process.platform === 'win32' && fs.existsSync('E:\\IA') ? 'E:\\IA\\nexura-stems' : path.join(dataDir(), 'stems-engine');
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['pyproject.toml', 'separate.py']) {
      const src = path.join(stemsSource(), f), dst = path.join(dir, f);
      const a = fs.readFileSync(src);
      if (!fs.existsSync(dst) || !a.equals(fs.readFileSync(dst))) fs.writeFileSync(dst, a);
    }
  } catch (e) { console.warn('stems tool', e.message); }
  return dir;
}
const stemsPython = () => path.join(stemsTool(), '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
// Carpeta por defecto: E:\IA\stems si existe E:\IA (SSD de modelos), si no dentro de los datos de la app
function defaultStemsDir() {
  if (process.platform === 'win32' && fs.existsSync('E:\\IA')) return 'E:\\IA\\stems';
  return path.join(dataDir(), 'stems');
}
const stemsDirOf = (dir) => (dir && path.isAbsolute(dir) ? dir : defaultStemsDir());
const safeId = (id) => /^[\w-]+$/.test(String(id || ''));
let stemsProc = null;

function findUv() {
  const home = os.homedir();
  const cands = [path.join(home, '.local', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv'), path.join(home, '.cargo', 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')];
  return cands.find(c => fs.existsSync(c)) || 'uv';
}
function stemsEnv() {
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' };
  if (process.platform === 'win32' && fs.existsSync('E:\\IA')) {
    env.TORCH_HOME = env.TORCH_HOME || 'E:\\IA\\modelos\\torch';
    env.UV_CACHE_DIR = env.UV_CACHE_DIR || 'E:\\IA\\cache\\uv';
    env.UV_PYTHON_INSTALL_DIR = env.UV_PYTHON_INSTALL_DIR || 'E:\\IA\\python';
  }
  return env;
}
function sendStems(ev) { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('stems:event', ev); }

function registerStemsIpc() {
  ipcMain.handle('stems:info', async (_e, dir) => ({
    installed: fs.existsSync(stemsPython()), tool: stemsTool(), dir: stemsDirOf(dir), busy: !!stemsProc
  }));
  ipcMain.handle('stems:status', async (_e, ids, dir) => {
    const base = stemsDirOf(dir), out = {};
    for (const id of ids || []) {
      if (!safeId(id)) continue;
      out[id] = STEM_NAMES.every(n => fs.existsSync(path.join(base, id, n + '.flac')));
    }
    return out;
  });
  ipcMain.handle('stems:read', async (_e, id, dir) => {
    if (!safeId(id)) throw new Error('id no válido');
    const base = path.join(stemsDirOf(dir), id), out = {};
    for (const n of STEM_NAMES) {
      const buf = await fsp.readFile(path.join(base, n + '.flac'));
      out[n] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    return out;
  });
  ipcMain.handle('stems:delete', async (_e, id, dir) => {
    if (!safeId(id)) return false;
    await fsp.rm(path.join(stemsDirOf(dir), id), { recursive: true, force: true });
    return true;
  });
  // Instala el entorno (uv sync): Python 3.11 + PyTorch CUDA + Demucs. Tarda unos minutos la primera vez.
  ipcMain.handle('stems:install', async () => {
    if (stemsProc) throw new Error('Ya hay un proceso de stems en marcha');
    return new Promise((resolve) => {
      const p = spawn(findUv(), ['sync', '--python', '3.11'], { cwd: stemsTool(), env: stemsEnv(), windowsHide: true });
      stemsProc = p;
      const line = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(l => sendStems({ ev: 'log', text: l.slice(0, 300) }));
      p.stdout.on('data', line); p.stderr.on('data', line);
      p.on('error', (e) => { stemsProc = null; sendStems({ ev: 'log', text: 'No se pudo ejecutar uv: ' + e.message }); resolve({ ok: false, error: e.message }); });
      p.on('close', (code) => { stemsProc = null; resolve({ ok: code === 0 && fs.existsSync(stemsPython()), code }); });
    });
  });
  // Separa una lista de pistas: [{id, path}]. Emite eventos 'stems:event' con el progreso.
  ipcMain.handle('stems:separate', async (_e, jobs, dir, model) => {
    if (stemsProc) throw new Error('Ya hay una separación en marcha');
    if (!fs.existsSync(stemsPython())) throw new Error('El motor de stems no está instalado');
    const out = stemsDirOf(dir);
    await fsp.mkdir(out, { recursive: true });
    const list = (jobs || []).filter(j => safeId(j.id) && j.path && fs.existsSync(j.path));
    return new Promise((resolve) => {
      const p = spawn(stemsPython(), [path.join(stemsTool(), 'separate.py'), '--out', out, '--model', ['htdemucs', 'htdemucs_ft'].includes(model) ? model : 'htdemucs'], { cwd: stemsTool(), env: stemsEnv(), windowsHide: true });
      stemsProc = p;
      let buf = '', errTail = '';
      const results = { done: [], failed: [] };
      p.stdout.on('data', (d) => {
        buf += String(d);
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
          if (!l) continue;
          try {
            const ev = JSON.parse(l);
            if (ev.ev === 'done') results.done.push(ev.id);
            if (ev.ev === 'error') results.failed.push(ev);
            sendStems(ev);
          } catch (_) { sendStems({ ev: 'log', text: l.slice(0, 300) }); }
        }
      });
      p.stderr.on('data', (d) => { errTail = (errTail + String(d)).slice(-2000); });
      p.on('error', (e) => { stemsProc = null; resolve({ ...results, error: e.message }); });
      p.on('close', (code) => { stemsProc = null; resolve({ ...results, code, error: code ? errTail.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ') : '' }); });
      p.stdin.end(JSON.stringify(list));
    });
  });
  ipcMain.handle('stems:cancel', async () => { if (stemsProc) { stemsProc.kill(); stemsProc = null; } return true; });
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------
function registerIpc() {
  registerStemsIpc();
  ipcMain.handle('app:info', () => ({
    os: `${os.type()} ${os.release()} (${os.arch()})`, electron: process.versions.electron,
    isBeta: /beta|alpha|rc/i.test(app.getVersion()),
    version: app.getVersion(), name: APP_NAME, platform: process.platform,
    userData: app.getPath('userData'), recordings: recDir()
  }));

  ipcMain.handle('dialog:openFiles', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Añadir pistas', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map(e => e.slice(1)) }]
    });
    if (r.canceled) return [];
    return Promise.all(r.filePaths.map(fileInfo));
  });

  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Añadir carpeta', properties: ['openDirectory'] });
    if (r.canceled) return [];
    const files = await scanFolder(r.filePaths[0]);
    const out = [];
    for (const f of files) { try { out.push(await fileInfo(f)); } catch (_) { /* skip */ } }
    return out;
  });

  ipcMain.handle('dialog:openSample', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Cargar muestra', properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: [...AUDIO_EXT].map(e => e.slice(1)) }]
    });
    return r.canceled ? null : r.filePaths[0];
  });

  // Biblioteca de otro programa DJ (colección XML / NML): devuelve ruta y texto
  // Colecciones y listas de otros programas DJ: varios archivos a la vez; devuelve sus bytes
  ipcMain.handle('dialog:openLibraryFile', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar biblioteca o listas de otro programa DJ', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Colecciones y listas', extensions: ['xml', 'nml', 'vdjfolder', 'm3u', 'm3u8', 'crate'] }]
    });
    if (r.canceled) return null;
    const out = [];
    for (const p of r.filePaths) {
      const st = await fsp.stat(p);
      if (st.size > 300 * 1024 * 1024) throw new Error('Archivo demasiado grande: ' + path.basename(p));
      const buf = await fsp.readFile(p);
      out.push({ path: p, name: path.basename(p), data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) });
    }
    return out;
  });
  // Primeros bytes de un archivo de audio (etiquetas ID3 / bloques FLAC con cues y beatgrid)
  ipcMain.handle('fs:readHead', async (_e, p, n) => {
    const fh = await fsp.open(p, 'r');
    try {
      const len = Math.max(0, Math.min(Number(n) || 0, 32 * 1024 * 1024));
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
    } finally { await fh.close(); }
  });

  ipcMain.handle('fs:infoForPaths', async (_e, paths) => {
    const out = [];
    for (const p of paths || []) {
      try {
        const st = await fsp.stat(p);
        if (st.isDirectory()) { for (const f of await scanFolder(p)) out.push(await fileInfo(f)); }
        else if (AUDIO_EXT.has(path.extname(p).toLowerCase())) out.push(await fileInfo(p));
      } catch (_) { /* skip */ }
    }
    return out;
  });

  ipcMain.handle('fs:readFile', async (_e, p) => {
    const buf = await fsp.readFile(p);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });
  ipcMain.handle('fs:exists', async (_e, p) => { try { await fsp.access(p); return true; } catch (_) { return false; } });
  // Comprobación por lotes de archivos perdidos: [ruta] → [true/false]
  ipcMain.handle('fs:existsMany', async (_e, paths) => Promise.all((paths || []).slice(0, 2000).map(p => fsp.access(String(p)).then(() => true, () => false))));

  // Listas .m3u / .m3u8 (botón de la barra lateral de la biblioteca): devuelve sus bytes
  ipcMain.handle('dialog:openPlaylist', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: 'Importar lista M3U', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Listas M3U', extensions: ['m3u', 'm3u8'] }]
    });
    if (r.canceled) return null;
    const out = [];
    for (const p of r.filePaths) {
      const st = await fsp.stat(p);
      if (st.size > 50 * 1024 * 1024) throw new Error('Lista demasiado grande: ' + path.basename(p));
      const buf = await fsp.readFile(p);
      out.push({ path: p, name: path.basename(p), data: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) });
    }
    return out;
  });

  // Relocalizar archivos perdidos: el usuario elige una carpeta y se buscan (en subcarpetas) los
  // archivos con esos nombres. Devuelve { dir, files: [{ path, size }] } o null si cancela.
  ipcMain.handle('dialog:findFiles', async (_e, names) => {
    const r = await dialog.showOpenDialog(mainWindow, { title: 'Carpeta donde buscar los archivos perdidos', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const want = new Set((names || []).map(n => String(n).toLowerCase()));
    const files = [];
    let seen = 0;
    const walk = async (dir, depth) => {
      if (depth > 16 || seen > 500000) return;
      let entries = [];
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('$')) await walk(full, depth + 1); continue; }
        seen++;
        if (!want.has(e.name.toLowerCase())) continue;
        try { files.push({ path: full, size: (await fsp.stat(full)).size }); } catch (_) { /* skip */ }
      }
    };
    await walk(r.filePaths[0], 0);
    return { dir: r.filePaths[0], files };
  });

  // Carátula en miniatura (JPEG de 96 px como data: URL) con caché en userData/data/art
  ipcMain.handle('art:get', async (_e, id, p) => {
    if (!/^[a-z0-9_-]+$/i.test(String(id || '')) || !p) return null;
    const dir = path.join(dataDir(), 'art');
    const jpg = path.join(dir, id + '.jpg'), none = path.join(dir, id + '.none');
    try { return 'data:image/jpeg;base64,' + (await fsp.readFile(jpg)).toString('base64'); } catch (_) { /* sin caché */ }
    if (fs.existsSync(none)) return null;
    await fsp.mkdir(dir, { recursive: true });
    const pic = await readCover(p);
    let img = pic ? nativeImage.createFromBuffer(pic.data) : null;
    if (!img || img.isEmpty()) { if (fs.existsSync(p)) await fsp.writeFile(none, ''); return null; }
    const { width, height } = img.getSize(), k = 96 / Math.max(width, height, 1);
    if (k < 1) img = img.resize({ width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)), quality: 'good' });
    const out = img.toJPEG(82);
    await fsp.writeFile(jpg, out);
    return 'data:image/jpeg;base64,' + out.toString('base64');
  });

  ipcMain.handle('store:get', async (_e, name) => {
    if (!/^[a-z0-9_-]+$/i.test(name)) return null;
    try { return JSON.parse(await fsp.readFile(path.join(dataDir(), name + '.json'), 'utf8')); } catch (_) { return null; }
  });
  ipcMain.handle('store:set', async (_e, name, data) => {
    if (!/^[a-z0-9_-]+$/i.test(name)) return false;
    const file = path.join(dataDir(), name + '.json');
    const tmp = file + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, file);
    return true;
  });

  ipcMain.handle('wave:get', async (_e, id) => {
    if (!/^[a-z0-9_-]+$/i.test(id)) return null;
    try { const b = await fsp.readFile(path.join(waveDir(), id + '.bin')); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); }
    catch (_) { return null; }
  });
  ipcMain.handle('wave:set', async (_e, id, data) => {
    if (!/^[a-z0-9_-]+$/i.test(id)) return false;
    await fsp.writeFile(path.join(waveDir(), id + '.bin'), Buffer.from(data));
    return true;
  });

  ipcMain.handle('rec:save', async (_e, data, name) => {
    await fsp.mkdir(recDir(), { recursive: true });
    const safe = String(name || 'Nexura-set').replace(/[^a-z0-9 _.-]/gi, '_');
    const file = path.join(recDir(), safe.endsWith('.wav') ? safe : safe + '.wav');
    await fsp.writeFile(file, Buffer.from(data));
    return file;
  });
  ipcMain.handle('shell:showItem', (_e, p) => { shell.showItemInFolder(p); return true; });
  // Sugerencias de la beta: envío directo al correo de NexuraIA mediante FormSubmit
  ipcMain.handle('feedback:email', async (_e, p) => {
    p = p || {};
    if (FEEDBACK_WEBHOOK) {
      try {
        const w = await fetch(FEEDBACK_WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app: 'Nexura DJ Studio', ...p }) });
        if (w.ok) return true;
      } catch (_) { /* se intenta el respaldo */ }
    }
    const isEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.contact || '');
    const body = {
      _subject: String(p.subject || 'Sugerencia Nexura DJ Studio').slice(0, 200),
      _template: 'table', _captcha: 'false',
      Tipo: p.category || '', Mensaje: String(p.message || '').slice(0, 5000), Contacto: p.contact || '(no indicado)',
      Version: p.version || app.getVersion(), Fecha: p.date || new Date().toISOString(),
      Equipo: p.system || '(no incluido)', Errores: p.errors || '(ninguno)'
    };
    if (isEmail) body._replyto = p.contact;
    const r = await fetch(FEEDBACK_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || String(j.success) !== 'true') throw new Error(j.message || 'HTTP ' + r.status);
    return true;
  });
  // Sugerencias de la beta: envío a un webhook https configurado por el usuario (p. ej. n8n)
  ipcMain.handle('feedback:post', async (_e, url, payload) => {
    if (!/^https:\/\//.test(url)) throw new Error('El webhook debe empezar por https://');
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return true;
  });
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https:\/\//.test(url) || /^mailto:contacto@nexuraia\.com\?/.test(url)) shell.openExternal(url);
    return true;
  });

  // YouTube
  ipcMain.handle('yt:oembed', async (_e, videoId) => {
    if (!/^[\w-]{6,20}$/.test(videoId)) return null;
    try {
      const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId));
      if (!r.ok) return null;
      return await r.json();
    } catch (_) { return null; }
  });
  ipcMain.handle('yt:api', async (_e, endpoint, params, apiKey) => {
    if (!/^[a-zA-Z]+$/.test(endpoint)) throw new Error('Endpoint no válido');
    const q = new URLSearchParams(params || {});
    const headers = {};
    let token = null;
    try { token = await ytAccessToken(); } catch (_) { token = null; }
    if (token) headers.Authorization = 'Bearer ' + token;
    else if (apiKey) q.set('key', apiKey);
    else throw new Error('Necesitas una clave de API de YouTube o conectar tu cuenta de Google en Ajustes');
    const r = await fetch(`https://www.googleapis.com/youtube/v3/${endpoint}?${q}`, { headers });
    const j = await r.json();
    if (!r.ok) throw new Error((j.error && j.error.message) || 'Error de la API de YouTube');
    return j;
  });
  ipcMain.handle('yt:login', async (_e, clientId, clientSecret) => ytOAuthLogin(clientId, clientSecret));
  ipcMain.handle('yt:logout', async () => { ytTokens = null; await saveSecrets(); return true; });
  ipcMain.handle('yt:status', async () => ({ connected: !!(ytTokens && ytTokens.refresh_token) }));
}

// ---------------------------------------------------------------------------
// Ventana
// ---------------------------------------------------------------------------
function setupPermissions() {
  const allowed = new Set(['midi', 'midiSysex', 'media', 'speaker-selection', 'fullscreen']);
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1680, height: 1000, minWidth: 900, minHeight: 600,
    backgroundColor: '#07080d', title: APP_NAME,
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false
    }
  });
  Menu.setApplicationMenu(null);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWindow.webContents.toggleDevTools();
    if (input.type === 'keyDown' && input.key === 'F11') mainWindow.setFullScreen(!mainWindow.isFullScreen());
  });
  await mainWindow.loadURL(`http://localhost:${serverPort}/index.html`);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.whenReady().then(async () => {
  await ensureDirs();
  await loadSecrets();
  setupPermissions();
  registerIpc();
  serverPort = await startStaticServer();
  await createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
