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
