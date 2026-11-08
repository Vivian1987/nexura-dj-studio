// Procesadores auxiliares: bitcrusher, repetidor (stutter) y grabador de la salida master

class CrusherProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
      { name: 'reduce', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' }
    ];
  }
  constructor() { super(); this.hold = [0, 0]; this.c = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    if (!inp || !inp.length) return true;
    const steps = Math.pow(2, p.bits[0]) / 2;
    const red = Math.max(1, Math.round(p.reduce[0]));
    const n = out[0].length;
    for (let i = 0; i < n; i++) {
      if (this.c % red === 0) {
        for (let ch = 0; ch < out.length; ch++) {
          const x = (inp[ch] || inp[0])[i];
          this.hold[ch] = Math.round(x * steps) / steps;
        }
      }
      this.c++;
      for (let ch = 0; ch < out.length; ch++) out[ch][i] = this.hold[ch] || 0;
    }
    return true;
  }
}
registerProcessor('nexura-crusher', CrusherProcessor);

// Repetidor sincronizado: captura un fragmento y lo repite (estilo "Shredder/Repeat")
class RepeatProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'length', defaultValue: 0.25, minValue: 0.01, maxValue: 4, automationRate: 'k-rate' },
      { name: 'active', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.size = sampleRate * 4;
    this.L = new Float32Array(this.size); this.R = new Float32Array(this.size);
    this.w = 0; this.r = 0; this.capLen = 0; this.state = 0;
  }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0];
    const n = out[0].length;
    const active = p.active[0] > 0.5;
    const len = Math.max(64, Math.min(this.size, Math.floor(p.length[0] * sampleRate)));
    for (let i = 0; i < n; i++) {
      const l = inp && inp[0] ? inp[0][i] : 0;
      const r = inp && inp[1] ? inp[1][i] : l;
      if (!active) {
        this.state = 0;
        this.L[this.w] = l; this.R[this.w] = r;
        this.w = (this.w + 1) % this.size;
        out[0][i] = l; if (out[1]) out[1][i] = r;
        continue;
      }
      if (this.state === 0) { this.state = 1; this.capLen = len; this.r = 0; this.start = (this.w - len + this.size) % this.size; }
      const idx = (this.start + this.r) % this.size;
      // pequeño fundido en los bordes del fragmento
      const edge = Math.min(this.r, this.capLen - this.r, 64) / 64;
      out[0][i] = this.L[idx] * edge; if (out[1]) out[1][i] = this.R[idx] * edge;
      this.r = (this.r + 1) % this.capLen;
    }
    return true;
  }
}
registerProcessor('nexura-repeat', RepeatProcessor);

// Línea de retardo circular estéreo con lectura fraccional (lineal), base de los efectos de abajo
class Ring {
  constructor(bits) { this.N = 1 << bits; this.m = this.N - 1; this.L = new Float32Array(this.N); this.R = new Float32Array(this.N); this.w = 0; }
  write(l, r) { this.L[this.w] = l; this.R[this.w] = r; this.w = (this.w + 1) & this.m; }
  // posición absoluta (muestras, puede ser fraccional) → valor
  at(buf, p) { const i = Math.floor(p), f = p - i, a = buf[i & this.m], b = buf[(i + 1) & this.m]; return a + (b - a) * f; }
}
const inL = (inp, i) => (inp && inp[0] ? inp[0][i] : 0);
const inR = (inp, i) => (inp && inp[1] ? inp[1][i] : inL(inp, i));

// Transposición de efecto (Pitch y Spiral): dos cabezas con retardo que deriva y fundido Hann (suma = 1)
class PitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'semis', defaultValue: 0, minValue: -24, maxValue: 24, automationRate: 'k-rate' }]; }
  constructor() { super(); this.rb = new Ring(14); this.W = Math.round(sampleRate * 0.06); this.ph = 0; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, rb = this.rb, W = this.W;
    const s = p.semis[0];
    const step = (1 - Math.pow(2, s / 12)) / W; // el retardo cambia (1 − ratio) muestras por muestra
    const oR = out[1] || out[0];
    for (let i = 0; i < n; i++) {
      const l = inL(inp, i), r = inR(inp, i);
      rb.write(l, r);
      if (Math.abs(s) < 0.01) { out[0][i] = l; oR[i] = r; continue; }
      this.ph = ((this.ph + step) % 1 + 1) % 1;
      const p2 = (this.ph + 0.5) % 1;
      const g1 = Math.sin(Math.PI * this.ph) ** 2, g2 = 1 - g1;
      const base = rb.w - 1;
      const d1 = base - this.ph * W, d2 = base - p2 * W;
      out[0][i] = rb.at(rb.L, d1) * g1 + rb.at(rb.L, d2) * g2;
      oR[i] = rb.at(rb.R, d1) * g1 + rb.at(rb.R, d2) * g2;
    }
    return true;
  }
}
registerProcessor('nexura-pitch', PitchProcessor);

// Shredder: repite fragmentos cortos (granos) del audio reciente cambiando el tono en cada uno
const SHRED = [0, 7, -5, 12, 3, -7, 5, -12];
class ShredderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'grain', defaultValue: 0.06, minValue: 0.01, maxValue: 0.5, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor() { super(); this.rb = new Ring(17); this.g = 0; this.len = 0; this.rate = 1; this.st = 0; this.k = 0; this.F = 96; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, rb = this.rb, oR = out[1] || out[0];
    for (let i = 0; i < n; i++) {
      rb.write(inL(inp, i), inR(inp, i));
      if (this.g >= this.len) {
        this.len = Math.max(256, Math.round(p.grain[0] * sampleRate));
        this.rate = Math.pow(2, SHRED[this.k++ % SHRED.length] * p.depth[0] / 12);
        this.st = rb.w - this.len * Math.max(1, this.rate) - 64; // siempre dentro de lo ya grabado
        this.g = 0;
      }
      const env = Math.min(1, this.g / this.F, (this.len - this.g) / this.F);
      const pos = this.st + this.g * this.rate;
      out[0][i] = rb.at(rb.L, pos) * env; oR[i] = rb.at(rb.R, pos) * env;
      this.g++;
    }
    return true;
  }
}
registerProcessor('nexura-shredder', ShredderProcessor);

// Gater: puerta de 16 pasos con patrones, envolvente suave (1 ms subida, 8 ms bajada)
const GATES = [0xAAAA, 0xEEEE, 0xB6DB, 0xF0F0].map(b => Array.from({ length: 16 }, (_, i) => (b >> (15 - i)) & 1));
class GaterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'step', defaultValue: 0.125, minValue: 0.005, maxValue: 4, automationRate: 'k-rate' },
      { name: 'pattern', defaultValue: 0, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'depth', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' }
    ];
  }
  constructor() { super(); this.c = 0; this.env = 1; this.a = 1 - Math.exp(-1 / (sampleRate * 0.001)); this.r = 1 - Math.exp(-1 / (sampleRate * 0.008)); }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, oR = out[1] || out[0];
    const stepN = Math.max(32, p.step[0] * sampleRate), pat = GATES[Math.round(p.pattern[0]) & 3], depth = p.depth[0];
    for (let i = 0; i < n; i++) {
      const k = Math.floor(this.c / stepN) % 16;
      const tgt = pat[k] ? 1 : 1 - depth;
      this.env += (tgt - this.env) * (tgt > this.env ? this.a : this.r);
      out[0][i] = inL(inp, i) * this.env; oR[i] = inR(inp, i) * this.env;
      if (++this.c >= stepN * 16) this.c = 0;
    }
    return true;
  }
}
registerProcessor('nexura-gater', GaterProcessor);

// Reverse Echo: dos lectores reproducen al revés el último fragmento grabado (ventanas sin² desfasadas ½)
class ReverseProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'length', defaultValue: 0.5, minValue: 0.05, maxValue: 4, automationRate: 'k-rate' }]; }
  constructor() { super(); this.rb = new Ring(19); this.L = 0; this.t = [0, 0]; this.base = [0, 0]; this.init = false; }
  process(inputs, outputs, p) {
    const inp = inputs[0], out = outputs[0], n = out[0].length, rb = this.rb, oR = out[1] || out[0];
    const L = Math.max(512, Math.min(rb.N / 2 - 1, Math.round(p.length[0] * sampleRate)));
    if (!this.init || Math.abs(L - this.L) > 64) { this.L = L; this.t = [0, L / 2]; this.base = [rb.w, rb.w - L / 2]; this.init = true; }
    for (let i = 0; i < n; i++) {
      rb.write(inL(inp, i), inR(inp, i));
      let l = 0, r = 0;
      for (let j = 0; j < 2; j++) {
        if (this.t[j] >= this.L) { this.t[j] = 0; this.base[j] = rb.w - 1; }
        const g = Math.sin(Math.PI * this.t[j] / this.L) ** 2;
        const pos = this.base[j] - this.t[j];
        l += rb.at(rb.L, pos) * g; r += rb.at(rb.R, pos) * g;
        this.t[j]++;
      }
      out[0][i] = l; oR[i] = r;
    }
    return true;
  }
}
registerProcessor('nexura-reverse', ReverseProcessor);

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rec = false;
    this.chunk = 8192;
    this.bufL = new Float32Array(this.chunk); this.bufR = new Float32Array(this.chunk); this.n = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') { this.rec = true; this.n = 0; }
      if (e.data === 'stop') { this.flush(); this.rec = false; this.port.postMessage({ t: 'done' }); }
    };
  }
  flush() {
    if (this.n === 0) return;
    const l = this.bufL.slice(0, this.n), r = this.bufR.slice(0, this.n);
    this.port.postMessage({ t: 'data', l, r }, [l.buffer, r.buffer]);
    this.n = 0;
  }
  process(inputs, outputs) {
    const inp = inputs[0];
    const out = outputs[0];
    if (inp && inp.length) {
      for (let ch = 0; ch < out.length; ch++) out[ch].set(inp[ch] || inp[0]);
      if (this.rec) {
        const l = inp[0], r = inp[1] || inp[0];
        for (let i = 0; i < l.length; i++) {
          this.bufL[this.n] = l[i]; this.bufR[this.n] = r[i];
          if (++this.n >= this.chunk) this.flush();
        }
      }
    }
    return true;
  }
}
registerProcessor('nexura-recorder', RecorderProcessor);
