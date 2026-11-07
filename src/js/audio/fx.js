// Unidades de efectos: 2 unidades × 3 ranuras, sincronizadas al BPM
// Cada efecto expone: input, output, setParam(0..1), setTiming(segundosPorBeat, beats), on(bool)
import { clamp } from '../util.js';

export const BEAT_VALUES = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8, 16];
export const beatLabel = (b) => b >= 1 ? String(b) : (b === 0.75 ? '3/4' : '1/' + Math.round(1 / b));

function noiseIR(ctx, seconds, decay, preDelay = 0.01) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    const pd = Math.floor(preDelay * sr);
    for (let i = pd; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - pd) / (len - pd), decay);
  }
  return buf;
}

class Base {
  constructor(ctx) {
    this.ctx = ctx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.p = 0.5; this.beatSec = 0.5; this.beats = 1;
  }
  t() { return this.ctx.currentTime; }
  set(param, v, tc = 0.02) { param.setTargetAtTime(v, this.t(), tc); }
  setParam(v) { this.p = v; this.update(); }
  setTiming(beatSec, beats) { this.beatSec = beatSec; this.beats = beats; this.update(); }
  period() { return clamp(this.beatSec * this.beats, 0.01, 30); }
  on() {}
  update() {}
}

// Señal seca + rama húmeda
class WetDry extends Base {
  constructor(ctx) {
    super(ctx);
    this.dry = ctx.createGain(); this.wet = ctx.createGain();
    this.input.connect(this.dry).connect(this.output);
    this.wet.connect(this.output);
  }
}

class Echo extends WetDry {
  constructor(ctx, pingpong = false) {
    super(ctx);
    if (!pingpong) {
      this.delay = ctx.createDelay(20);
      this.fb = ctx.createGain();
      this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 6000;
      this.input.connect(this.delay); this.delay.connect(this.tone).connect(this.fb).connect(this.delay);
      this.tone.connect(this.wet);
    } else {
      this.dl = ctx.createDelay(20); this.dr = ctx.createDelay(20);
      this.fb = ctx.createGain();
      const merge = ctx.createChannelMerger(2);
      const mono = ctx.createGain(); mono.channelCount = 1; mono.channelCountMode = 'explicit';
      this.input.connect(mono).connect(this.dl);
      this.dl.connect(this.dr); this.dr.connect(this.fb).connect(this.dl);
      this.dl.connect(merge, 0, 0); this.dr.connect(merge, 0, 1);
      merge.connect(this.wet);
    }
    this.pingpong = pingpong;
    this.update();
  }
  update() {
    const per = this.period();
    if (this.pingpong) { this.set(this.dl.delayTime, per, 0.05); this.set(this.dr.delayTime, per, 0.05); }
    else this.set(this.delay.delayTime, per, 0.05);
    this.set(this.fb.gain, 0.25 + this.p * 0.55);
    this.set(this.wet.gain, 0.15 + this.p * 0.85);
  }
}

class Reverb extends WetDry {
  constructor(ctx, epic = false) {
    super(ctx);
    this.conv = ctx.createConvolver();
    this.conv.buffer = noiseIR(ctx, epic ? 6 : 2.6, epic ? 2.2 : 3.2, epic ? 0.04 : 0.012);
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'highpass'; this.hp.frequency.value = epic ? 350 : 150;
    this.input.connect(this.hp).connect(this.conv).connect(this.wet);
    this.epic = epic;
    this.update();
  }
  update() {
    this.set(this.wet.gain, this.p * (this.epic ? 1.4 : 1.1));
    if (this.epic) this.set(this.dry.gain, 1 - this.p * 0.35);
  }
}

class LfoEffect extends WetDry {
  makeLfo(type = 'sine') {
    this.lfo = this.ctx.createOscillator(); this.lfo.type = type;
    this.lfoAmt = this.ctx.createGain();
    this.lfo.connect(this.lfoAmt);
    this.lfo.start();
  }
  lfoRate() { return 1 / this.period(); }
}

class Flanger extends LfoEffect {
  constructor(ctx, chorus = false) {
    super(ctx);
    this.chorus = chorus;
    this.delay = ctx.createDelay(0.1);
    this.delay.delayTime.value = chorus ? 0.018 : 0.004;
    this.fb = ctx.createGain(); this.fb.gain.value = chorus ? 0 : 0.6;
    this.input.connect(this.delay); this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.wet);
    this.makeLfo();
    this.lfoAmt.connect(this.delay.delayTime);
    this.update();
  }
  update() {
    this.set(this.lfo.frequency, this.chorus ? 0.8 + this.p * 2 : this.lfoRate());
    this.set(this.lfoAmt.gain, this.chorus ? 0.004 * (0.3 + this.p) : 0.0035 * (0.3 + this.p));
    this.set(this.wet.gain, this.chorus ? 0.5 + this.p * 0.4 : 0.9);
    this.set(this.dry.gain, this.chorus ? 1 : 0.8);
  }
}

class Phaser extends LfoEffect {
  constructor(ctx) {
    super(ctx);
    this.stages = [];
    let node = this.input;
    for (let i = 0; i < 6; i++) {
      const ap = ctx.createBiquadFilter(); ap.type = 'allpass'; ap.frequency.value = 800; ap.Q.value = 0.6;
      node.connect(ap); node = ap; this.stages.push(ap);
    }
    this.fb = ctx.createGain(); this.fb.gain.value = 0.4;
    node.connect(this.fb).connect(this.stages[0]);
    node.connect(this.wet);
    this.makeLfo();
    for (const s of this.stages) this.lfoAmt.connect(s.frequency);
    this.update();
  }
  update() {
    this.set(this.lfo.frequency, this.lfoRate());
    this.set(this.lfoAmt.gain, 300 + this.p * 1400);
    this.set(this.wet.gain, 0.5 + this.p * 0.5);
  }
}

class FilterFx extends Base {
  constructor(ctx, type) {
    super(ctx);
    this.type = type;
    this.f = ctx.createBiquadFilter(); this.f.type = type; this.f.Q.value = 4;
    this.input.connect(this.f).connect(this.output);
    this.update();
  }
  update() {
    const v = this.p;
    const freq = this.type === 'highpass' ? 20 * Math.pow(10000 / 20, v) : 22000 * Math.pow(80 / 22000, v);
    this.set(this.f.frequency, freq, 0.03);
  }
}

class Crusher extends Base {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-crusher', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.output);
    this.update();
  }
  update() {
    this.node.parameters.get('bits').setValueAtTime(16 - this.p * 13, this.t());
    this.node.parameters.get('reduce').setValueAtTime(1 + Math.round(this.p * 15), this.t());
  }
}

class Distortion extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.shaper = ctx.createWaveShaper(); this.shaper.oversample = '4x';
    this.post = ctx.createGain();
    this.input.connect(this.shaper).connect(this.post).connect(this.wet);
    this.update();
  }
  update() {
    const k = 2 + this.p * 80, n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; curve[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
    this.shaper.curve = curve;
    this.set(this.post.gain, 0.6 / Math.sqrt(1 + this.p * 4));
    this.set(this.wet.gain, 1); this.set(this.dry.gain, 0);
  }
}

class Gate extends LfoEffect {
  // Trans (square) o Tremolo (sine)
  constructor(ctx, square) {
    super(ctx);
    this.square = square;
    this.vca = ctx.createGain();
    this.input.connect(this.vca).connect(this.output);
    this.dry.disconnect();
    this.makeLfo(square ? 'square' : 'sine');
    this.lfoAmt.connect(this.vca.gain);
    this.update();
  }
  update() {
    this.set(this.lfo.frequency, this.lfoRate() * (this.square ? 1 : 1));
    const depth = 0.15 + this.p * 0.85;
    this.set(this.vca.gain, 1 - depth / 2);
    this.set(this.lfoAmt.gain, depth / 2);
  }
}

class AutoPan extends LfoEffect {
  constructor(ctx) {
    super(ctx);
    this.pan = ctx.createStereoPanner();
    this.input.connect(this.pan).connect(this.output);
    this.dry.disconnect();
    this.makeLfo();
    this.lfoAmt.connect(this.pan.pan);
    this.update();
  }
  update() { this.set(this.lfo.frequency, this.lfoRate()); this.set(this.lfoAmt.gain, 0.2 + this.p * 0.8); }
}

class RingMod extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.vca = ctx.createGain(); this.vca.gain.value = 0;
    this.osc = ctx.createOscillator(); this.osc.connect(this.vca.gain); this.osc.start();
    this.input.connect(this.vca).connect(this.wet);
    this.update();
  }
  update() {
    this.set(this.osc.frequency, 40 * Math.pow(50, this.p));
    this.set(this.wet.gain, 0.4 + this.p * 0.6);
    this.set(this.dry.gain, 1 - this.p * 0.8);
  }
}

class Noise extends WetDry {
  constructor(ctx) {
    super(ctx);
    const len = ctx.sampleRate * 2;
    const b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; }
    this.src = ctx.createBufferSource(); this.src.buffer = b; this.src.loop = true; this.src.start();
    this.hp = ctx.createBiquadFilter(); this.hp.type = 'bandpass'; this.hp.Q.value = 1.4;
    this.src.connect(this.hp).connect(this.wet);
    this.update();
  }
  update() {
    this.set(this.hp.frequency, 200 * Math.pow(60, this.p), 0.05);
    this.set(this.wet.gain, 0.04 + this.p * 0.22);
  }
}

class Comb extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.delay = ctx.createDelay(0.05);
    this.fb = ctx.createGain(); this.fb.gain.value = 0.85;
    this.input.connect(this.delay); this.delay.connect(this.fb).connect(this.delay);
    this.delay.connect(this.wet);
    this.update();
  }
  update() { this.set(this.delay.delayTime, 1 / (60 * Math.pow(20, this.p))); this.set(this.wet.gain, 0.5); this.set(this.dry.gain, 0.6); }
}

class Repeat extends WetDry {
  constructor(ctx) {
    super(ctx);
    this.node = new AudioWorkletNode(ctx, 'nexura-repeat', { outputChannelCount: [2] });
    this.input.connect(this.node).connect(this.wet);
    this.dry.gain.value = 0;
    this.update();
  }
  on(v) { this.node.parameters.get('active').setValueAtTime(v ? 1 : 0, this.t()); }
  update() {
    this.node.parameters.get('length').setValueAtTime(clamp(this.period(), 0.02, 4), this.t());
    this.set(this.wet.gain, 1);
  }
}

class Braker extends WetDry {
  // Bajada de tono continua estilo "freno": repetición con transposición descendente
  constructor(ctx) {
    super(ctx);
    this.delay = ctx.createDelay(4);
    this.input.connect(this.delay).connect(this.wet);
    this.dry.gain.value = 0;
    this.update();
  }
  on(v) {
    const t = this.t();
    const p = this.delay.delayTime;
    p.cancelScheduledValues(t);
    this.wet.gain.cancelScheduledValues(t);
    if (v) {
      // retardo d(t) = t²/2T → la velocidad baja linealmente de 1 a 0 en T segundos
      const T = clamp(this.period() * (0.5 + this.p), 0.1, 7.8);
      const curve = new Float32Array(64);
      for (let i = 0; i < 64; i++) { const x = (i / 63) * T; curve[i] = (x * x) / (2 * T); }
      p.setValueCurveAtTime(curve, t, T);
      this.wet.gain.setValueAtTime(1, t);
      this.wet.gain.setValueAtTime(1, t + T * 0.9);
      this.wet.gain.linearRampToValueAtTime(0, t + T);
    } else { p.setValueAtTime(0, t); this.wet.gain.setValueAtTime(1, t); }
  }
}

export const EFFECTS = [
  { id: 'echo', name: 'Echo', make: (c) => new Echo(c) },
  { id: 'pingpong', name: 'Ping Pong', make: (c) => new Echo(c, true) },
  { id: 'reverb', name: 'Reverb', make: (c) => new Reverb(c) },
  { id: 'epicreverb', name: 'Epic Reverb', make: (c) => new Reverb(c, true) },
  { id: 'flanger', name: 'Flanger', make: (c) => new Flanger(c) },
  { id: 'phaser', name: 'Phaser', make: (c) => new Phaser(c) },
  { id: 'chorus', name: 'Chorus', make: (c) => new Flanger(c, true) },
  { id: 'hpf', name: 'HPF', make: (c) => new FilterFx(c, 'highpass') },
  { id: 'lpf', name: 'LPF', make: (c) => new FilterFx(c, 'lowpass') },
  { id: 'bitcrush', name: 'Bitcrush', make: (c) => new Crusher(c) },
  { id: 'distortion', name: 'Distortion', make: (c) => new Distortion(c) },
  { id: 'trans', name: 'Trans', make: (c) => new Gate(c, true) },
  { id: 'tremolo', name: 'Tremolo', make: (c) => new Gate(c, false) },
  { id: 'autopan', name: 'Auto Pan', make: (c) => new AutoPan(c) },
  { id: 'ringmod', name: 'Ring Mod', make: (c) => new RingMod(c) },
  { id: 'noise', name: 'Noise', make: (c) => new Noise(c) },
  { id: 'comb', name: 'Comb', make: (c) => new Comb(c) },
  { id: 'repeat', name: 'Repeat', make: (c) => new Repeat(c) },
  { id: 'braker', name: 'Braker', make: (c) => new Braker(c) }
];

class Slot {
  constructor(ctx, unit, idx) {
    this.ctx = ctx; this.unit = unit; this.idx = idx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.bypass = ctx.createGain();
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.input.connect(this.bypass).connect(this.output);
    this.wet.connect(this.output);
    this.enabled = false;
    this.param = 0.5;
    this.fx = null; this.fxId = null;
  }
  setEffect(id) {
    if (this.fx) { try { this.input.disconnect(this.fx.input); this.fx.output.disconnect(); } catch (_) {} }
    const def = EFFECTS.find(e => e.id === id) || EFFECTS[0];
    this.fxId = def.id; this.name = def.name;
    this.fx = def.make(this.ctx);
    this.fx.setParam(this.param);
    this.fx.setTiming(this.unit.beatSec, this.unit.beats);
    this.input.connect(this.fx.input);
    this.fx.output.connect(this.wet);
    if (this.enabled) this.fx.on(true);
  }
  setEnabled(v) {
    this.enabled = !!v;
    const t = this.ctx.currentTime;
    this.bypass.gain.setTargetAtTime(v ? 0 : 1, t, 0.01);
    this.wet.gain.setTargetAtTime(v ? 1 : 0, t, 0.01);
    if (this.fx) this.fx.on(this.enabled);
  }
  setParam(v) { this.param = clamp(v, 0, 1); if (this.fx) this.fx.setParam(this.param); }
}

export class FxUnit {
  constructor(ctx, idx) {
    this.ctx = ctx; this.idx = idx;
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.beats = 1; this.beatSec = 0.5; this.mix = 1;
    this.slots = [0, 1, 2].map(i => new Slot(ctx, this, i));
    this.input.connect(this.dry).connect(this.output);
    this.input.connect(this.slots[0].input);
    this.slots[0].output.connect(this.slots[1].input);
    this.slots[1].output.connect(this.slots[2].input);
    this.slots[2].output.connect(this.wet).connect(this.output);
    const defaults = idx === 0 ? ['echo', 'reverb', 'hpf'] : ['flanger', 'bitcrush', 'lpf'];
    this.slots.forEach((s, i) => s.setEffect(defaults[i]));
    this.target = idx === 0 ? 'deck0' : 'deck1';
    this.setMix(1);
  }
  setMix(v) {
    this.mix = clamp(v, 0, 1);
    const t = this.ctx.currentTime;
    // con mezcla al 100 % la cadena de ranuras ya incluye la señal seca de las ranuras apagadas
    this.dry.gain.setTargetAtTime(1 - this.mix, t, 0.01);
    this.wet.gain.setTargetAtTime(this.mix, t, 0.01);
  }
  setBeats(b) { this.beats = b; this.applyTiming(); }
  setBpm(bpm) {
    const bs = 60 / (bpm || 120);
    if (Math.abs(bs - this.beatSec) > 1e-4) { this.beatSec = bs; this.applyTiming(); }
  }
  applyTiming() { for (const s of this.slots) if (s.fx) s.fx.setTiming(this.beatSec, this.beats); }
  anyOn() { return this.slots.some(s => s.enabled); }
  toJSON() {
    return { target: this.target, beats: this.beats, mix: this.mix, slots: this.slots.map(s => ({ fx: s.fxId, p: s.param })) };
  }
  fromJSON(j) {
    if (!j) return;
    if (j.target) this.target = j.target;
    if (j.beats) this.beats = j.beats;
    if (j.mix != null) this.setMix(j.mix);
    (j.slots || []).forEach((s, i) => { if (this.slots[i]) { this.slots[i].param = s.p ?? 0.5; this.slots[i].setEffect(s.fx); } });
  }
}
