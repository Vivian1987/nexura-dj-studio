// Cues, loops y beatgrid que otros programas DJ guardan dentro de los archivos de audio
// (marcadores en ID3 GEOB «Markers2» / «BeatGrid» en MP3 y en comentarios Vorbis de FLAC),
// y archivos de crate binarios (.crate). En la interfaz no se nombra el programa de origen.

const td8 = new TextDecoder('utf-8'), td16 = new TextDecoder('utf-16be'), tdLatin = new TextDecoder('latin1');

// ---------------------------------------------------------------- base64 tolerante
function b64(s) {
  s = String(s).replace(/[^A-Za-z0-9+/]/g, '');
  if (s.length % 4 === 1) s = s.slice(0, -1);
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
const cstr = (u, i) => { let j = i; while (j < u.length && u[j] !== 0) j++; return [j, u.subarray(i, j)]; };

// ---------------------------------------------------------------- Markers2 (cues, loops, bloqueo de BPM)
export function parseMarkers2(payload) {
  // payload: 01 01 + base64(01 01 + entradas) terminado en \0
  let p = payload;
  if (p[0] === 1 && p[1] === 1) p = p.subarray(2);
  const [end] = cstr(p, 0);
  const raw = b64(tdLatin.decode(p.subarray(0, end)));
  const out = { cues: [], loops: [], bpmLock: false };
  let i = raw[0] === 1 && raw[1] === 1 ? 2 : 0;
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  while (i < raw.length) {
    const [ne, nameB] = cstr(raw, i);
    const name = tdLatin.decode(nameB);
    if (!name || ne + 5 > raw.length) break;
    const len = dv.getUint32(ne + 1);
    const d = ne + 5;
    if (d + len > raw.length) break;
    if (name === 'CUE' && len >= 13) {
      const idx = raw[d + 1], ms = dv.getUint32(d + 2);
      const color = '#' + [raw[d + 7], raw[d + 8], raw[d + 9]].map(x => x.toString(16).padStart(2, '0')).join('');
      const [, lb] = cstr(raw, d + 12);
      if (idx < 8) out.cues.push({ n: idx, t: ms / 1000, color, name: td8.decode(lb) });
    } else if (name === 'LOOP' && len >= 15) {
      const s = dv.getUint32(d + 2), e = dv.getUint32(d + 6);
      if (e > s) out.loops.push({ n: raw[d + 1], s: s / 1000, e: e / 1000 });
    } else if (name === 'BPMLOCK' && len >= 1) out.bpmLock = !!raw[d];
    i = d + len;
  }
  return out;
}

// ---------------------------------------------------------------- BeatGrid (marcas con BPM)
export function parseBeatGrid(payload) {
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  if (payload.length < 6) return null;
  const n = dv.getUint32(2);
  if (!n || 6 + n * 8 > payload.length) return null;
  const m = [];
  for (let k = 0; k < n; k++) {
    const o = 6 + k * 8;
    const t = dv.getFloat32(o);
    if (k < n - 1) m.push({ t, beats: dv.getUint32(o + 4) });
    else m.push({ t, bpm: dv.getFloat32(o + 4) });
  }
  // BPM de cada tramo = beats hasta la siguiente marca / tiempo
  const grid = m.map((x, k) => ({ t: x.t, bpm: k < m.length - 1 ? 60 * x.beats / (m[k + 1].t - x.t) : x.bpm }));
  return grid.filter(g => isFinite(g.t) && g.bpm > 20 && g.bpm < 400);
}

// ---------------------------------------------------------------- ID3v2 (MP3, AIFF, WAV con ID3)
const synch = (u, i) => (u[i] << 21) | (u[i + 1] << 14) | (u[i + 2] << 7) | u[i + 3];
export function id3Size(head) {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  return 10 + synch(head, 6) + (head[5] & 0x10 ? 10 : 0);
}
function geobFrames(u) {
  const out = {};
  const ver = u[3];
  let i = 10;
  if (u[5] & 0x40) i += ver === 4 ? synch(u, 10) : (u[10] << 24 | u[11] << 16 | u[12] << 8 | u[13]) + 4; // cabecera extendida
  const end = Math.min(u.length, id3Size(u));
  while (i + 10 <= end) {
    const id = tdLatin.decode(u.subarray(i, i + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = ver === 4 ? synch(u, i + 4) : ((u[i + 4] << 24) | (u[i + 5] << 16) | (u[i + 6] << 8) | u[i + 7]) >>> 0;
    const d = i + 10;
    if (size <= 0 || d + size > u.length) break;
    if (id === 'GEOB') {
      const f = u.subarray(d, d + size), enc = f[0];
      let [j] = cstr(f, 1); j++;                     // MIME
      // nombre de archivo y descripción en la codificación del frame
      const skip = (k) => { if (enc === 1 || enc === 2) { while (k + 1 < f.length && !(f[k] === 0 && f[k + 1] === 0)) k += 2; return k + 2; } const [e] = cstr(f, k); return e + 1; };
      const readStr = (k) => { if (enc === 1 || enc === 2) { let e = k; while (e + 1 < f.length && !(f[e] === 0 && f[e + 1] === 0)) e += 2; return [e + 2, new TextDecoder(enc === 1 ? 'utf-16' : 'utf-16be').decode(f.subarray(k, e))]; } const [e, b] = cstr(f, k); return [e + 1, enc === 3 ? td8.decode(b) : tdLatin.decode(b)]; };
      j = skip(j);
      const [k, desc] = readStr(j);
      out[desc] = f.subarray(k);
    }
    i = d + size;
  }
  return out;
}

// ---------------------------------------------------------------- FLAC (comentarios Vorbis)
function flacComments(u) {
  if (u.length < 8 || tdLatin.decode(u.subarray(0, 4)) !== 'fLaC') return null;
  let i = 4;
  while (i + 4 <= u.length) {
    const last = u[i] & 0x80, type = u[i] & 0x7f, len = (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3];
    if (type === 4 && i + 4 + len <= u.length) {
      const dv = new DataView(u.buffer, u.byteOffset + i + 4, len);
      let o = 4 + dv.getUint32(0, true);
      const n = dv.getUint32(o, true); o += 4;
      const out = {};
      for (let k = 0; k < n && o + 4 <= len; k++) {
        const l = dv.getUint32(o, true); o += 4;
        const s = td8.decode(u.subarray(i + 4 + o, i + 4 + o + l)); o += l;
        const eq = s.indexOf('=');
        if (eq > 0) out[s.slice(0, eq).toUpperCase()] = s.slice(eq + 1);
      }
      return out;
    }
    if (last) break;
    i += 4 + len;
  }
  return null;
}
// en FLAC el valor es base64 de «mime\0\0Descripción\0» + datos
function flacPayload(v, desc) {
  const u = b64(v);
  const key = new TextEncoder().encode(desc + '\0');
  for (let i = 0; i + key.length <= u.length; i++) {
    let ok = true;
    for (let k = 0; k < key.length && ok; k++) if (u[i + k] !== key[k]) ok = false;
    if (ok) return u.subarray(i + key.length);
  }
  return null;
}

// Devuelve { cues, loops, grid, bpm, firstBeat } o null si el archivo no tiene marcadores
export function readFileMarkers(head) {
  let mk = null, bg = null;
  const id3 = id3Size(head) ? geobFrames(head) : null;
  if (id3) { mk = id3['Serato Markers2']; bg = id3['Serato BeatGrid']; }
  else {
    const vc = flacComments(head);
    if (vc) {
      if (vc.SERATO_MARKERS_V2) mk = flacPayload(vc.SERATO_MARKERS_V2, 'Serato Markers2');
      if (vc.SERATO_BEATGRID) bg = flacPayload(vc.SERATO_BEATGRID, 'Serato BeatGrid');
    }
  }
  if (!mk && !bg) return null;
  const out = { cues: [], loops: [], grid: null, bpm: null, firstBeat: null };
  try { if (mk) Object.assign(out, parseMarkers2(mk)); } catch (_) { /* marcadores dañados */ }
  try {
    const g = bg ? parseBeatGrid(bg) : null;
    if (g && g.length) { out.bpm = g[0].bpm; out.firstBeat = g[0].t; if (g.length > 1) out.grid = g; }
  } catch (_) { /* rejilla dañada */ }
  return out.cues.length || out.loops.length || out.bpm ? out : null;
}

// ---------------------------------------------------------------- crates binarias
// Etiquetas de 4 letras + longitud (u32 BE); «otrk» contiene «ptrk» con la ruta en UTF-16BE
// relativa a la raíz de la unidad donde está la carpeta de la biblioteca.
export function parseCrate(u, cratePath = '') {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const paths = [];
  const walk = (a, z) => {
    let i = a;
    while (i + 8 <= z) {
      const tag = tdLatin.decode(u.subarray(i, i + 4)), len = dv.getUint32(i + 4), d = i + 8;
      if (d + len > z) break;
      if (tag === 'otrk') walk(d, d + len);
      else if (tag === 'ptrk') paths.push(td16.decode(u.subarray(d, d + len)));
      i = d + len;
    }
  };
  walk(0, u.length);
  // raíz: unidad de Windows («E:») o raíz de macOS
  const drive = /^[A-Za-z]:/.exec(cratePath);
  const vol = /^\/Volumes\/[^/]+/.exec(cratePath);
  const abs = paths.map(p => {
    if (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')) return p.replace(/\//g, drive ? '\\' : '/');
    if (drive) return drive[0] + '\\' + p.replace(/\//g, '\\');
    return (vol ? vol[0] : '') + '/' + p;
  });
  // nombre: «Bodas%%Baile.crate» → «Bodas / Baile»
  const base = (cratePath.split(/[\\/]/).pop() || 'Crate').replace(/\.crate$/i, '').split('%%').join(' / ');
  return { name: base, paths: abs };
}
