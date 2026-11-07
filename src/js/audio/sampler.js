// Sampler: 4 bancos × 8 ranuras, modos Trigger / Hold / On-Off, bucle y volumen por ranura
import { Emitter } from '../util.js';
import { platform } from '../platform.js';

export const SAMPLER_MODES = { trigger: 'Trigger', hold: 'Hold', onoff: 'On/Off' };

export class Sampler extends Emitter {
  constructor(engine) {
    super();
    this.engine = engine;
    const ctx = engine.ctx;
    this.ctx = ctx;
    this.pre = ctx.createGain();
    this.post = ctx.createGain();
    this.pre.connect(this.post).connect(engine.samplerBus);
    this.inserts = [];
    this.bank = 0;
    this.banks = [0, 1, 2, 3].map(() => Array.from({ length: 8 }, () => ({ name: '', path: '', mode: 'trigger', loop: false, gain: 0.8 })));
    this.buffers = new Map();   // path → AudioBuffer
    this.voices = new Map();    // "b:i" → { src, g }
  }
  setInserts(units) {
    try { this.pre.disconnect(); } catch (_) {}
    for (const u of this.inserts) { try { u.output.disconnect(); } catch (_) {} }
    this.inserts = units;
    let n = this.pre;
    for (const u of units) { n.connect(u.input); n = u.output; }
    n.connect(this.post);
  }
  slot(i, bank = this.bank) { return this.banks[bank][i]; }

  async loadSlot(i, path, name, bank = this.bank) {
    const s = this.slot(i, bank);
    s.path = path; s.name = name || path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    try { await this.getBuffer(path); } catch (e) { s.error = true; }
    this.emit('change');
  }
  clearSlot(i, bank = this.bank) {
    this.stop(i, bank);
    Object.assign(this.slot(i, bank), { name: '', path: '', error: false });
    this.emit('change');
  }
  async getBuffer(path) {
    if (this.buffers.has(path)) return this.buffers.get(path);
    const bytes = await platform.readFile(path);
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const buf = await this.ctx.decodeAudioData(ab);
    this.buffers.set(path, buf);
    return buf;
  }
  isPlaying(i, bank = this.bank) { return this.voices.has(bank + ':' + i); }

  async press(i, bank = this.bank) {
    const s = this.slot(i, bank);
    if (!s.path) return;
    const key = bank + ':' + i;
    if (s.mode === 'onoff' && this.voices.has(key)) { this.stop(i, bank); return; }
    this.stop(i, bank);
    let buf;
    try { buf = await this.getBuffer(s.path); } catch (_) { return; }
    const src = this.ctx.createBufferSource();
    src.buffer = buf; src.loop = !!s.loop;
    const g = this.ctx.createGain(); g.gain.value = s.gain;
    src.connect(g).connect(this.pre);
    src.onended = () => { if (this.voices.get(key)?.src === src) { this.voices.delete(key); this.emit('voices'); } };
    src.start();
    this.voices.set(key, { src, g });
    this.emit('voices');
  }
  release(i, bank = this.bank) {
    if (this.slot(i, bank).mode === 'hold') this.stop(i, bank);
  }
  stop(i, bank = this.bank) {
    const key = bank + ':' + i;
    const v = this.voices.get(key);
    if (!v) return;
    const t = this.ctx.currentTime;
    v.g.gain.setTargetAtTime(0, t, 0.01);
    try { v.src.stop(t + 0.05); } catch (_) {}
    this.voices.delete(key);
    this.emit('voices');
  }
  stopAll() { for (const k of [...this.voices.keys()]) { const [b, i] = k.split(':').map(Number); this.stop(i, b); } }
  setGain(i, v, bank = this.bank) {
    this.slot(i, bank).gain = v;
    const voice = this.voices.get(bank + ':' + i);
    if (voice) voice.g.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }
  toJSON() { return { bank: this.bank, banks: this.banks.map(b => b.map(({ name, path, mode, loop, gain }) => ({ name, path, mode, loop, gain }))) }; }
  fromJSON(j) {
    if (!j || !j.banks) return;
    this.bank = j.bank || 0;
    j.banks.forEach((b, bi) => b.forEach((s, i) => { if (this.banks[bi] && this.banks[bi][i]) Object.assign(this.banks[bi][i], s); }));
    this.emit('change');
  }
}
