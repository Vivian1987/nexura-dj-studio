// Cliente del worker de análisis + caché de formas de onda
import { gridUpdate } from '../audio/grid.js';
import { platform } from '../platform.js';
import { keyToCamelot, keyLabel, KEY_NAMES } from '../util.js';

export class Analyzer {
  constructor() {
    this.worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
    this.pending = new Map();
    this.seq = 0;
    this.queue = Promise.resolve();
    this.waves = new Map(); // id → { data, rate }
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.ok ? p.resolve(e.data.result) : p.reject(new Error(e.data.error));
    };
  }

  static mono(buffer) {
    const n = buffer.length;
    const out = new Float32Array(n);
    const chs = buffer.numberOfChannels;
    for (let c = 0; c < chs; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < n; i++) out[i] += d[i] / chs;
    }
    return out;
  }

  run(buffer, opts) {
    const id = ++this.seq;
    const mono = Analyzer.mono(buffer);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, mono, sr: buffer.sampleRate, opts }, [mono.buffer]);
    });
  }

  // Analiza en cola (uno detrás de otro) y rellena los metadatos de la pista
  analyzeTrack(track, buffer, opts = {}) {
    const job = this.queue.then(async () => {
      const r = await this.run(buffer, track.bpmLocked && track.bpm ? { ...opts, lockedBpm: track.bpm, lockedFirstBeat: track.firstBeat || 0 } : opts);
      const wave = { data: r.wave, rate: r.waveRate };
      this.waves.set(track.id, wave);
      platform.waveSet(track.id, packWave(wave)).catch(() => {});
      const meta = {
        duration: buffer.duration,
        analyzed: true,
        rmsDb: r.rmsDb,
        waveRate: r.waveRate,
        energy: r.energy, sections: r.sections || [], energyCurve: r.energyCurve || null, energyV: r.energyV || null
      };
      if (!track.bpmLocked) {
        meta.bpm = r.bpm; meta.firstBeat = r.firstBeat; meta.grid = null;
        // tempo variable detectado: beatgrid con marcas (BPM dominante para la biblioteca)
        if (r.grid && r.grid.length > 1) Object.assign(meta, gridUpdate(r.grid, buffer.duration), { bpmLocked: false });
      }
      if (r.keyTonic != null && !track.keyLocked) {
        meta.keyTonic = r.keyTonic; meta.keyMinor = r.keyMinor;
        meta.key = keyLabel(r.keyTonic, r.keyMinor);
        meta.camelot = keyToCamelot(KEY_NAMES[r.keyTonic], r.keyMinor);
      }
      return meta;
    });
    this.queue = job.catch(() => {});
    return job;
  }

  async getWave(id) {
    if (this.waves.has(id)) return this.waves.get(id);
    const raw = await platform.waveGet(id);
    if (!raw) return null;
    const w = unpackWave(raw);
    if (w) this.waves.set(id, w);
    return w;
  }
}

// Formato binario: "NXW1" + float32 rate + datos
function packWave(w) {
  const out = new Uint8Array(8 + w.data.length);
  out.set([78, 88, 87, 49]);
  new DataView(out.buffer).setFloat32(4, w.rate, true);
  out.set(w.data, 8);
  return out;
}
function unpackWave(raw) {
  const u = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  if (u.length < 8 || u[0] !== 78 || u[1] !== 88 || u[2] !== 87 || u[3] !== 49) return null;
  const rate = new DataView(u.buffer, u.byteOffset, 8).getFloat32(4, true);
  return { data: u.slice(8), rate };
}
