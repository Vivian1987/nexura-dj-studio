// Controlador de deck: transporte, cue, hot cues, loops, roll, slicer, beat jump,
// pitch play, slip, censor, sync, keylock, scratch y modo YouTube.
import { Emitter, clamp, CUE_COLORS, camelotShift } from '../util.js';
import { YTSource } from '../youtube/youtube.js';
import { STEMS, STEM_PRESETS } from './stems.js';
import * as Grid from './grid.js';

export const PAD_MODES = ['hotcue', 'savedloop', 'roll', 'slicer', 'beatjump', 'sampler', 'pitchplay', 'stems'];
export const PAD_MODE_NAMES = {
  hotcue: 'Hot Cue', savedloop: 'Saved Loop', roll: 'Roll', slicer: 'Slicer',
  beatjump: 'Beat Jump', sampler: 'Sampler', pitchplay: 'Pitch Play', stems: 'Stems'
};
const STEM_PAD_PRESETS = ['acapella', 'instrumental', 'drums', 'all'];
export const ROLL_BEATS = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4];
export const JUMP_PADS = [-1, 1, -4, 4, -8, 8, -16, 16];
export const PITCH_PADS = [0, 1, 2, 3, -1, -2, -3, -4];
export const LOOP_SIZES = [1 / 32, 1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32];
export const RANGES = [0.08, 0.16, 0.5];
export const fmtBeats = (b) => b >= 1 ? String(Math.round(b * 1000) / 1000) : '1/' + Math.round(1 / b);

const SEC_PER_REV = 60 / 33.333; // un giro de plato = 1,8 s de audio a 33⅓ rpm

export class Deck extends Emitter {
  constructor(app, idx) {
    super();
    this.app = app;
    this.idx = idx;
    this.engine = app.engine;
    const ctx = this.engine.ctx;
    this.node = new AudioWorkletNode(ctx, 'nexura-deck', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    this.node.connect(this.engine.channels[idx].input);
    this.node.port.onmessage = (e) => this.onWorklet(e.data);

    this.track = null;
    this.sr = 44100;
    this.duration = 0;
    this.st = { pos: 0, sp: 0, at: performance.now() };
    this.playing = false;
    this.pitch = 0;          // fader −1..1
    this.range = app.settings.pitchRange || 0.08;
    this.tempo = 1;
    this.bend = 0;
    this.keylock = !!app.settings.keylockDefault;
    this.semis = 0;
    this.slip = false;
    this.vinyl = true;
    this.sync = false;
    this.cuePoint = 0;
    this.cuePreview = false;
    this.loop = { on: false, s: 0, e: 0 };
    this.loopBeats = 4;
    this.loopInPending = null;
    this.jumpBeats = 4;
    this.padMode = 'hotcue';
    this.padBank = 0;        // para controladores de 4 pads (hot cues 1-4 / 5-8)
    this.held = new Set();
    this.isYT = false;
    this.yt = null;
    this.ytContainer = null;
    this.playStartedAt = 0;
    this.loggedPlay = false;
    this.taps = [];
    this.stemsOn = false;              // stems cargados en el worklet
    this.stemGains = [1, 1, 1, 1];     // voz, batería, bajo, melodía
    this.send({ t: 'keylock', v: this.keylock });
    this.applyMotor();
  }

  send(m, transfer) { this.node.port.postMessage(m, transfer || []); }
  applyMotor() {
    const s = this.app.settings;
    this.send({ t: 'motor', start: (s.motorStart ?? 4) / 1000, stop: (s.motorStop ?? 4) / 1000 });
  }

  onWorklet(m) {
    if (m.t === 's') { this.st = { pos: m.pos / this.sr, sp: m.sp, at: performance.now() }; }
    else if (m.t === 'ended') { this.playing = false; this.emit('state'); }
  }

  // ---------------------------------------------------------------- posición
  get loaded() { return !!this.track; }
  get time() {
    if (this.isYT) return this.yt ? this.yt.time() : 0;
    const dt = (performance.now() - this.st.at) / 1000;
    return clamp(this.st.pos + this.st.sp * Math.min(dt, 0.05), 0, this.duration);
  }
  get speed() { return this.isYT ? (this.playing ? this.tempo : 0) : this.st.sp; }
  // BPM en la posición actual (con beatgrid de marcas puede variar a lo largo de la pista)
  get bpm() {
    const t = this.track; if (!t || !t.bpm) return 0;
    return t.grid && t.grid.length > 1 && !this.isYT ? Grid.bpmAt(t, this.time) : t.bpm;
  }
  get currentBpm() { return this.bpm * this.tempo; }
  get beatLen() { return this.bpm ? 60 / this.bpm : 0; }
  get firstBeat() { return this.track ? this.track.firstBeat || 0 : 0; }
  get hasGridMarkers() { return !!(this.track && this.track.grid && this.track.grid.length > 1); }
  beatAt(t) { return this.track && this.track.bpm ? Grid.beatAt(this.track, t) : 0; }
  beatTime(b) { return this.track && this.track.bpm ? Grid.beatTime(this.track, b) : 0; }
  nearestBeat(t) { return this.bpm ? this.beatTime(Math.round(this.beatAt(t))) : t; }
  floorBeat(t, div = 1) { return this.bpm ? this.beatTime(Math.floor(this.beatAt(t) / div + 1e-6) * div) : t; }
  q(t) { return this.app.settings.quantize && this.bpm ? this.nearestBeat(t) : t; }
  get displayKey() {
    if (!this.track || !this.track.camelot) return this.track && this.track.key || '';
    const drift = this.keylock || this.isYT ? 0 : Math.round(12 * Math.log2(this.tempo));
    return camelotShift(this.track.camelot, this.semis + drift);
  }

  // ---------------------------------------------------------------- carga
  async load(track, buffer) {
    this.stopAll();
    this.unloadYT();
    this.stemsOn = false; this.stemGains = [1, 1, 1, 1];
    this.track = track;
    this.isYT = false;
    this.sr = buffer.sampleRate;
    this.duration = buffer.duration;
    const L = buffer.getChannelData(0).slice();
    const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1).slice() : null;
    this.send({ t: 'load', L, R, sr: buffer.sampleRate });
    this.afterLoad();
  }

  async loadYouTube(track) {
    this.stopAll();
    this.send({ t: 'unload' });
    this.track = track;
    this.isYT = true;
    if (!this.yt) {
      this.yt = new YTSource(this.ytContainer);
      this.yt.onEnded = () => { this.playing = false; this.emit('state'); };
      this.yt.onError = (code) => this.app.toast(`YouTube no permite reproducir este vídeo fuera de su web (código ${code}).`, 'error');
    }
    this.emit('track', track); // muestra el contenedor del vídeo antes de crear el reproductor
    await this.yt.load(track.ytId);
    const d = this.yt.duration();
    this.duration = d || track.duration || 0;
    if (d && !track.duration) this.app.library.update(track.id, { duration: d });
    this.afterLoad();
  }

  afterLoad() {
    const t = this.track;
    this.playing = false;
    this.loop = { on: false, s: 0, e: 0 };
    this.semis = 0; this.send({ t: 'semis', v: 0 });
    this.loggedPlay = false;
    this.cuePoint = 0;
    this.st = { pos: 0, sp: 0, at: performance.now() };
    // Auto-gain a partir del RMS analizado
    if (this.app.settings.autoGain && t.rmsDb != null && !this.isYT) {
      const g = clamp(-14 - t.rmsDb, -12, 12);
      this.engine.channels[this.idx].set('trim', 0.5 + g / 24);
      this.app.emit('mixerSync');
    }
    if (!this.sync) this.setTempo(1 + this.pitch * this.range);
    else this.syncNow(true);
    this.emit('track', t);
    this.emit('state');
    this.emit('cues');
  }

  unloadYT() { if (this.yt) { this.yt.pause(); } this.isYT = false; }
  // ---------------------------------------------------------------- stems
  setStems(stems, lag = 0) {
    this.send({ t: 'stems', stems, gains: this.stemGains }, stems.flatMap(x => [x.L.buffer, x.R.buffer]));
    this.stemsOn = true; this.stemLag = lag;
    this.emit('stems'); this.emit('pads');
  }
  clearStems() { this.send({ t: 'stems', stems: null }); this.stemsOn = false; this.stemGains = [1, 1, 1, 1]; this.emit('stems'); this.emit('pads'); }
  needStems() {
    if (this.stemsOn) return true;
    if (!this.track || this.isYT) { this.app.toast('Los stems no están disponibles para vídeos de YouTube', 'warn'); return false; }
    if (this.track.stems) { this.app.toast('Cargando stems…'); this.app.stems.loadForDeck(this).catch(e => this.app.toast('No se pudieron cargar los stems: ' + e.message, 'error')); }
    else this.app.toast('Esta pista no tiene stems: pulsa ✨ SEPARAR en el deck o clic derecho en la biblioteca → «Separar stems (IA)»', 'warn', 5000);
    return false;
  }
  setStemGains(g) {
    this.stemGains = g.map(v => Math.max(0, Math.min(1, v)));
    if (this.stemsOn) this.send({ t: 'stemGains', v: this.stemGains });
    this.emit('stems'); this.emit('pads');
  }
  toggleStem(k) {
    if (!this.needStems()) return;
    const g = this.stemGains.slice(); g[k] = g[k] > 0.5 ? 0 : 1; this.setStemGains(g);
  }
  setStemLevel(k, v) { if (!this.stemsOn) return; const g = this.stemGains.slice(); g[k] = v; this.setStemGains(g); }
  stemPreset(name) {
    if (!this.needStems()) return;
    const p = STEM_PRESETS[name]; if (!p) return;
    // pulsar otra vez el mismo preset vuelve a todos
    const same = p.gains.every((v, i) => Math.abs(v - this.stemGains[i]) < 0.01);
    this.setStemGains(same && name !== 'all' ? [1, 1, 1, 1] : p.gains.slice());
  }

  eject() {
    if (this.playing) return;
    this.stopAll();
    this.send({ t: 'unload' });
    this.stemsOn = false; this.stemGains = [1, 1, 1, 1];
    if (this.yt) this.yt.destroy(), this.yt = null;
    this.track = null; this.isYT = false; this.duration = 0;
    this.emit('track', null); this.emit('state');
  }
  stopAll() {
    if (this.playing) this.pause();
    this.held.clear();
    this.send({ t: 'scratch', v: false });
    this.send({ t: 'reverse', v: false });
    this.send({ t: 'slipEnd', jump: false });
    this.send({ t: 'loop', on: false });
  }

  // ---------------------------------------------------------------- transporte
  play() {
    if (!this.track) return;
    this.engine.resume();
    this.playing = true;
    this.cuePreview = false;
    if (this.isYT) this.yt.play(); else this.send({ t: 'play', v: true });
    if (this.sync) this.syncNow(true);
    this.playStartedAt = performance.now();
    this.emit('state');
  }
  pause() {
    this.playing = false;
    if (this.isYT) { this.yt && this.yt.pause(); } else this.send({ t: 'play', v: false });
    this.emit('state');
  }
  togglePlay() { this.playing ? this.pause() : this.play(); }
  seek(t, keepSlip = false) {
    if (!this.track) return;
    t = clamp(t, 0, Math.max(0, this.duration - 0.01));
    if (this.isYT) this.yt.seek(t);
    else this.send({ t: 'seek', v: t * this.sr });
    this.st = { pos: t, sp: this.st.sp, at: performance.now() };
    if (!keepSlip) this.emit('seek');
  }
  // salto manteniendo la fase del beat si la cuantización está activa y se reproduce
  jumpTo(t) {
    if (this.app.settings.quantize && this.playing && this.bpm) {
      const now = this.time;
      t = t + (now - this.nearestBeat(now));
    }
    this.seek(t);
  }

  cueDown() {
    if (!this.track) return;
    if (this.playing && !this.cuePreview) {
      this.pause();
      this.seek(this.cuePoint);
    } else if (!this.playing) {
      if (Math.abs(this.time - this.cuePoint) < 0.02) {
        this.cuePreview = true;
        this.playing = true;
        if (this.isYT) this.yt.play(); else this.send({ t: 'play', v: true });
      } else {
        this.cuePoint = this.q(this.time);
        this.seek(this.cuePoint);
      }
    }
    this.emit('state');
  }
  cueUp() {
    if (this.cuePreview) {
      this.cuePreview = false;
      this.pause();
      this.seek(this.cuePoint);
    }
  }
  stutter() { if (!this.track) return; this.seek(this.cuePoint); this.play(); }
  toStart() { this.pause(); this.seek(0); }

  // ---------------------------------------------------------------- tempo
  setPitchFader(v) { // −1..1
    this.pitch = clamp(v, -1, 1);
    if (!this.sync) this.setTempo(1 + this.pitch * this.range);
    this.emit('tempo');
  }
  cycleRange() {
    const i = RANGES.indexOf(this.range);
    this.range = RANGES[(i + 1) % RANGES.length];
    if (!this.sync) this.setTempo(1 + this.pitch * this.range);
    this.emit('tempo');
  }
  setRange(r) { this.range = r; if (!this.sync) this.setTempo(1 + this.pitch * this.range); this.emit('tempo'); }
  setTempo(t) {
    this.tempo = clamp(t, 0.25, 2.5);
    if (this.isYT) { if (this.yt) this.yt.setRate(this.tempo); }
    else this.send({ t: 'rate', v: this.tempo });
    this.emit('tempo');
  }
  resetTempo() { this.pitch = 0; this.setTempo(1); this.emit('tempo'); }
  setBend(v) { this.bend = v; if (!this.isYT) this.send({ t: 'bend', v }); }
  bendDown(dir, coarse = false) { this.setBend(dir * (coarse ? 0.12 : 0.04)); }
  bendUp() { this.setBend(0); }
  nudge(v) { if (!this.isYT) this.send({ t: 'nudge', v }); }

  // ---------------------------------------------------------------- sync
  get syncMaster() {
    const others = (this.app.activeDecks || this.app.decks).filter(d => d !== this && d.track && d.bpm);
    if (!others.length) return null;
    return others.find(d => !d.sync) || others[0];
  }
  setSync(on) {
    this.sync = !!on;
    if (this.sync) this.syncNow(true);
    else { this.pitch = clamp((this.tempo - 1) / this.range, -1, 1); }
    this.emit('state'); this.emit('tempo');
  }
  toggleSync() { this.setSync(!this.sync); }
  syncNow(phase = false) {
    const m = this.syncMaster;
    if (!m || !this.bpm || !m.bpm) return;
    let target = m.currentBpm / this.bpm;
    // elige ×½ / ×2 si queda más cerca de 1
    for (const f of [0.5, 2]) if (Math.abs(target * f - 1) < Math.abs(target - 1)) target *= f;
    this.setTempo(target);
    if (phase && this.app.settings.syncPhase !== false) this.alignPhase(m);
  }
  alignPhase(m = this.syncMaster) {
    if (!m || !this.bpm || this.isYT) return;
    const ratio = m.bpm * m.tempo / (this.bpm * this.tempo);
    const mult = ratio > 1.4 ? 2 : ratio < 0.7 ? 0.5 : 1; // compás doble/mitad
    const mp = ((m.beatAt(m.time) / mult) % 1 + 1) % 1;
    const myB = this.beatAt(this.time);
    let diff = mp - ((myB % 1) + 1) % 1;
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    if (Math.abs(diff * this.beatLen) > 0.004) this.seek(this.time + diff * this.beatLen, true);
  }
  // Corrección continua de deriva (llamada periódicamente)
  syncTick() {
    if (!this.sync || !this.playing || this.isYT) return;
    const m = this.syncMaster;
    if (!m || !m.playing || m.isYT) return;
    this.syncNow(false);
    const myB = this.beatAt(this.time), mb = m.beatAt(m.time);
    let diff = ((mb % 1) + 1) % 1 - ((myB % 1) + 1) % 1;
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    const errSec = diff * this.beatLen;
    if (Math.abs(errSec) > 0.008 && Math.abs(errSec) < 0.2 && !this.loop.on && this.bend === 0) {
      this.send({ t: 'nudge', v: clamp(errSec * 2, -0.05, 0.05) });
    }
  }

  // ---------------------------------------------------------------- keylock / tonalidad
  toggleKeylock() { this.keylock = !this.keylock; this.send({ t: 'keylock', v: this.keylock }); this.emit('state'); }
  setSemis(s) { this.semis = clamp(Math.round(s), -12, 12); this.send({ t: 'semis', v: this.semis }); this.emit('state'); }
  keyShift(d) { this.setSemis(this.semis + d); }
  keyReset() { this.setSemis(0); }
  keySync() {
    // Ajusta la transposición para que coincida (o sea compatible) con la tonalidad del otro deck
    const m = this.app.decks.find(d => d !== this && d.track);
    if (!m || !this.track || !this.track.camelot || !m.displayKey) return;
    const target = m.displayKey;
    for (const s of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
      const drift = this.keylock ? 0 : Math.round(12 * Math.log2(this.tempo));
      if (camelotShift(this.track.camelot, s + drift) === target) { this.setSemis(s); return; }
    }
  }

  // ---------------------------------------------------------------- slip / censor / scratch
  toggleSlip() { this.slip = !this.slip; if (!this.slip) this.send({ t: 'slipEnd', jump: false }); this.emit('state'); }
  slipBegin() { if (!this.isYT) this.send({ t: 'slipBegin' }); }
  slipEnd(jump = true) { if (!this.isYT) this.send({ t: 'slipEnd', jump }); }
  censor(on) {
    if (this.isYT || !this.track) return;
    const wasCensoring = this.censoring;
    if (on) { this.slipBegin(); this.send({ t: 'reverse', v: true }); }
    else { this.send({ t: 'reverse', v: false }); this.slipEnd(); }
    this.censoring = on; this.emit('state');
    if (wasCensoring !== on) this.app.expansions?.record(this, { type: 'censor', value: !!on });
  }
  toggleVinyl() { this.vinyl = !this.vinyl; this.emit('state'); }
  jogTouch(on) {
    if (!this.track || this.isYT) return;
    if (!this.vinyl) return;
    this.scratching = !!on;
    if (on) { if (this.slip && this.playing) this.slipBegin(); this.send({ t: 'scratch', v: true }); }
    else { this.send({ t: 'scratch', v: false }); if (this.slip) this.slipEnd(); }
    this.emit('state');
  }
  // ticks del jog → scratch (si se toca el plato) o nudge / búsqueda
  jogTurn(ticks, ticksPerRev = 605) {
    if (!this.track) return;
    const revs = ticks / ticksPerRev;
    if (this.isYT) { if (!this.playing) this.seek(this.time + revs * SEC_PER_REV); return; }
    if (this.scratching) this.send({ t: 'scratchDelta', v: revs * SEC_PER_REV * this.sr });
    else if (this.playing) this.nudge(clamp(revs * 4, -0.6, 0.6) * (this.app.settings.jogSensitivity ?? 1));
    else this.seek(this.time + revs * SEC_PER_REV * 0.5);
  }
  scratchBySeconds(sec) { if (!this.isYT) this.send({ t: 'scratchDelta', v: sec * this.sr }); }

  // ---------------------------------------------------------------- hot cues
  saveCues() { this.app.library.update(this.track.id, { cues: this.track.cues, loops: this.track.loops }); this.emit('cues'); }
  hotcue(n) {
    if (!this.track) return;
    const c = this.track.cues[n];
    if (c) {
      if (c.le > c.t) return this.triggerCueLoop(n, c); // Cue Loop
      if (this.slip && this.playing) { this.slipBegin(); this.held.add('hc' + n); }
      this.app.expansions?.record(this, { type: 'cue', time: c.t });
      this.jumpTo(c.t);
      if (!this.playing) this.play();
    } else if (this.app.settings.cueLoops !== false && this.loop.on && this.loop.e > this.loop.s && !this.rolling && !this.isYT) {
      // Con un loop activo, el hot cue guarda el loop (Cue Loop)
      this.track.cues[n] = { t: this.loop.s, le: this.loop.e, color: CUE_COLORS[n % CUE_COLORS.length], name: '' };
      this.saveCues();
      this.app.toast(`Cue Loop ${n + 1} guardado (${this.loopLabel(this.loop.e - this.loop.s)})`);
    } else {
      const t = this.q(this.time);
      this.track.cues[n] = { t, color: CUE_COLORS[n % CUE_COLORS.length], name: '' };
      this.saveCues();
    }
  }
  // Salta al inicio del loop guardado y lo activa; si ya está activo, lo desactiva
  triggerCueLoop(n, c = this.track.cues[n]) {
    if (this.isYT) return this.app.toast('Los loops no están disponibles en pistas de YouTube', 'warn');
    if (this.isCueLoopActive(c)) { this.loopOff(); return; }
    this.app.expansions?.record(this, { type: 'cue', time: c.t });
    if (this.bpm) {
      const b = (c.le - c.t) / this.beatLen;
      this.loopBeats = LOOP_SIZES.find(x => Math.abs(x - b) < 1e-3) ?? Math.round(b * 1000) / 1000;
    }
    this.setLoop(c.t, c.le, true);
    this.jumpTo(c.t);
    if (!this.playing) this.play();
  }
  isCueLoopActive(c) { return !!(c && c.le && this.loop.on && Math.abs(this.loop.s - c.t) < 1e-3 && Math.abs(this.loop.e - c.le) < 1e-3); }
  loopLabel(len) {
    if (!this.bpm) return len.toFixed(2) + ' s';
    const b = Math.round(len / this.beatLen * 1000) / 1000;
    return (LOOP_SIZES.includes(b) ? fmtBeats(b) : String(Math.round(b * 100) / 100)) + (b === 1 ? ' beat' : ' beats');
  }
  // Convierte un hot cue normal en Cue Loop con el loop activo, o un Cue Loop en cue normal
  cueToggleLoop(n) {
    const c = this.track && this.track.cues[n];
    if (!c) return;
    if (c.le) { delete c.le; }
    else if (this.loop.e > this.loop.s) { c.t = this.loop.s; c.le = this.loop.e; }
    else {
      const len = (this.loopBeats || 4) * (this.beatLen || 0.5);
      c.le = c.t + len;
    }
    this.saveCues();
  }
  // Pasa un loop guardado a un hot cue libre como Cue Loop
  savedLoopToCue(n) {
    const l = this.track && this.track.loops[n];
    if (!l) return;
    const i = this.track.cues.findIndex((c, k) => k < 8 && !c);
    if (i < 0) return this.app.toast('No hay hot cues libres', 'warn');
    this.track.cues[i] = { t: l.s, le: l.e, color: CUE_COLORS[i % CUE_COLORS.length], name: '' };
    this.saveCues();
    this.app.toast(`Loop guardado → Cue Loop ${i + 1}`);
  }
  hotcueRelease(n) { if (this.held.delete('hc' + n)) this.slipEnd(); }
  deleteCue(n) { if (this.track && this.track.cues[n]) { this.track.cues[n] = null; this.saveCues(); } }
  setCueColor(n, color) { if (this.track && this.track.cues[n]) { this.track.cues[n].color = color; this.saveCues(); } }
  setCueName(n, name) { if (this.track && this.track.cues[n]) { this.track.cues[n].name = name; this.saveCues(); } }

  // ---------------------------------------------------------------- loops
  setLoop(s, e, on = true, jump = false) {
    if (this.isYT) return this.app.toast('Los loops no están disponibles en pistas de YouTube', 'warn');
    const wasOn = this.loop.on;
    this.loop = { on, s, e };
    if (on && !wasOn && this.slip && this.playing) this.slipBegin();
    if (!on && wasOn && this.slip && !this.rolling) this.slipEnd();
    this.send({ t: 'loop', on, s: s * this.sr, e: e * this.sr, jump });
    this.emit('loop');
  }
  loopOff() { if (this.loop.on) this.setLoop(this.loop.s, this.loop.e, false); }
  autoLoop(beats = this.loopBeats) {
    if (!this.track) return;
    if (this.loop.on && Math.abs((this.loop.e - this.loop.s) - beats * this.beatLen) < 1e-3) { this.loopOff(); return; }
    this.loopBeats = beats;
    const bl = this.beatLen || 0.5;
    const now = this.time;
    const s = this.app.settings.quantize && this.bpm ? this.floorBeat(now, Math.min(1, beats)) : now;
    this.setLoop(s, s + beats * bl, true);
  }
  loopSize(d) { // d = ±1 → ½ / ×2
    const i = clamp(LOOP_SIZES.indexOf(this.loopBeats) + d, 0, LOOP_SIZES.length - 1);
    this.loopBeats = LOOP_SIZES[i];
    if (this.loop.on) this.setLoop(this.loop.s, this.loop.s + this.loopBeats * (this.beatLen || 0.5), true);
    this.emit('loop');
  }
  loopHalve() {
    if (this.loop.on) {
      const len = (this.loop.e - this.loop.s) / 2;
      if (len < 0.005) return;
      this.loopBeats = this.beatLen ? len / this.beatLen : this.loopBeats / 2;
      this.setLoop(this.loop.s, this.loop.s + len, true, true);
    } else this.loopSize(-1);
  }
  loopDouble() {
    if (this.loop.on) {
      const len = (this.loop.e - this.loop.s) * 2;
      this.loopBeats = this.beatLen ? len / this.beatLen : this.loopBeats * 2;
      this.setLoop(this.loop.s, this.loop.s + len, true);
    } else this.loopSize(1);
  }
  loopIn() { this.loopInPending = this.q(this.time); if (this.loop.on) this.setLoop(this.loopInPending, this.loop.e, true); this.emit('loop'); }
  loopOut() {
    const s = this.loopInPending ?? (this.loop.e > this.loop.s ? this.loop.s : null);
    if (s == null) return;
    let e = this.q(this.time);
    if (e <= s + 0.01) return;
    this.setLoop(s, e, true);
    this.loopInPending = null;
  }
  reloop() {
    if (this.loop.on) this.loopOff();
    else if (this.loop.e > this.loop.s) { this.setLoop(this.loop.s, this.loop.e, true, true); }
  }
  loopMove(beats) {
    if (!this.loop.e) return;
    const d = beats * (this.beatLen || 0.5);
    this.setLoop(this.loop.s + d, this.loop.e + d, this.loop.on);
    if (this.loop.on) this.seek(this.time + d, true);
  }
  // Saved loops (8 ranuras guardadas con la pista)
  savedLoop(n) {
    if (!this.track) return;
    const l = this.track.loops[n];
    if (l) {
      if (this.loop.on && Math.abs(this.loop.s - l.s) < 1e-3) { this.loopOff(); return; }
      this.setLoop(l.s, l.e, true);
      this.jumpTo(l.s);
      if (!this.playing) this.play();
    } else if (this.loop.e > this.loop.s) {
      this.track.loops[n] = { s: this.loop.s, e: this.loop.e };
      this.saveCues();
    }
  }
  deleteSavedLoop(n) { if (this.track && this.track.loops[n]) { this.track.loops[n] = null; this.saveCues(); } }

  // ---------------------------------------------------------------- beat jump
  beatJump(beats) {
    if (!this.track) return;
    const d = beats * (this.beatLen || 0.5);
    if (this.loop.on) this.setLoop(this.loop.s + d, this.loop.e + d, true);
    this.seek(this.time + d);
  }
  setJumpSize(d) { const i = clamp(LOOP_SIZES.indexOf(this.jumpBeats) + d, 0, LOOP_SIZES.length - 1); this.jumpBeats = LOOP_SIZES[i]; this.emit('loop'); }

  // ---------------------------------------------------------------- roll
  rollStart(beats) {
    if (!this.track || this.isYT) return;
    if (!this.rolling) this.send({ t: 'slipBegin' });
    this.rolling = beats;
    const bl = this.beatLen || 0.5;
    const len = beats * bl;
    const now = this.time;
    const s = this.bpm ? this.floorBeat(now, beats) : now;
    this.setLoop(s, this.bpm ? this.beatTime(this.beatAt(s) + beats) : s + len, true);
    this.emit('state');
  }
  rollEnd(beats) {
    if (!this.rolling || (beats != null && this.rolling !== beats)) return;
    this.rolling = 0;
    this.send({ t: 'loop', on: false });
    this.loop = { on: false, s: this.loop.s, e: this.loop.e };
    this.send({ t: 'slipEnd' });
    this.emit('loop'); this.emit('state');
  }

  // ---------------------------------------------------------------- slicer
  slicerPress(k) {
    if (!this.track || this.isYT || !this.bpm) return;
    const bl = this.beatLen;
    if (!this.slicerDomain || !this.held.size) {
      this.slicerDomain = this.floorBeat(this.time, 8);
    }
    if (!this.held.has('sl')) this.send({ t: 'slipBegin' });
    this.held.add('sl'); this.held.add('sl' + k);
    const s = this.slicerDomain + k * bl;
    this.send({ t: 'seek', v: s * this.sr });
    this.loop = { on: true, s, e: s + bl };
    this.send({ t: 'loop', on: true, s: s * this.sr, e: (s + bl) * this.sr });
    if (!this.playing) this.play();
    this.emit('loop');
  }
  slicerRelease(k) {
    this.held.delete('sl' + k);
    if ([...this.held].some(h => /^sl\d/.test(h))) return;
    if (this.held.delete('sl')) {
      this.send({ t: 'loop', on: false });
      this.loop = { ...this.loop, on: false };
      this.send({ t: 'slipEnd' });
      this.emit('loop');
    }
  }

  // ---------------------------------------------------------------- pads
  setPadMode(m) { if (PAD_MODES.includes(m)) { this.padMode = m; this.emit('pads'); } }
  padDown(i, shift = false) {
    const m = this.padMode;
    if (shift) {
      if (m === 'hotcue') this.deleteCue(i);
      else if (m === 'savedloop') this.deleteSavedLoop(i);
      else if (m === 'sampler') this.app.sampler.stop(i);
      return;
    }
    switch (m) {
      case 'hotcue': this.hotcue(i); break;
      case 'savedloop': this.savedLoop(i); break;
      case 'roll': this.rollStart(ROLL_BEATS[i]); break;
      case 'slicer': this.slicerPress(i); break;
      case 'beatjump': this.beatJump(JUMP_PADS[i] * (this.jumpBeats / 4 >= 1 ? 1 : 1)); break;
      case 'sampler': this.app.sampler.press(i); break;
      case 'stems': if (i < 4) this.toggleStem(i); else this.stemPreset(STEM_PAD_PRESETS[i - 4]); break;
      case 'pitchplay': {
        const base = this.track && (this.track.cues.find(Boolean));
        this.setSemis(PITCH_PADS[i]);
        if (base) this.jumpTo(base.t);
        if (!this.playing) this.play();
        break;
      }
    }
    this.emit('pads');
  }
  padUp(i) {
    switch (this.padMode) {
      case 'hotcue': this.hotcueRelease(i); break;
      case 'roll': this.rollEnd(ROLL_BEATS[i]); break;
      case 'slicer': this.slicerRelease(i); break;
      case 'sampler': this.app.sampler.release(i); break;
    }
    this.emit('pads');
  }
  padState(i) {
    const t = this.track;
    switch (this.padMode) {
      case 'hotcue': {
        const c = t && t.cues[i];
        if (!c) return { on: false, label: String(i + 1) };
        if (c.le) return { on: true, color: c.color, label: '⟳ ' + (c.name || String(i + 1)), loop: true, active: this.isCueLoopActive(c) };
        return { on: true, color: c.color, label: c.name || String(i + 1) };
      }
      case 'savedloop': {
        const l = t && t.loops[i];
        const active = l && this.loop.on && Math.abs(this.loop.s - l.s) < 1e-3;
        return l ? { on: true, color: active ? '#2ee06a' : '#0f6b33', label: 'L' + (i + 1) } : { on: false, label: 'L' + (i + 1) };
      }
      case 'roll': return { on: this.rolling === ROLL_BEATS[i], color: '#1e9bff', dim: '#0d3463', label: fmtBeats(ROLL_BEATS[i]) };
      case 'slicer': return { on: this.held.has('sl' + i), color: '#ffa31a', dim: '#5a3606', label: 'S' + (i + 1) };
      case 'beatjump': return { on: false, color: '#a35bff', dim: '#3a1d63', label: (JUMP_PADS[i] > 0 ? '+' : '') + JUMP_PADS[i] };
      case 'sampler': {
        const s = this.app.sampler.slot(i);
        return { on: this.app.sampler.isPlaying(i), color: '#ff4fa8', dim: s.path ? '#5c1a3c' : null, label: s.name ? s.name.slice(0, 8) : String(i + 1) };
      }
      case 'pitchplay': return { on: this.semis === PITCH_PADS[i], color: '#ffd21a', dim: '#5a4a06', label: (PITCH_PADS[i] > 0 ? '+' : '') + PITCH_PADS[i] };
      case 'stems': {
        const avail = this.stemsOn;
        if (i < 4) { const st = STEMS[i]; return { on: avail && this.stemGains[i] > 0.5, color: st.color, dim: avail ? '#3a1a2a' : null, label: st.short }; }
        const pk = STEM_PAD_PRESETS[i - 4], pr = STEM_PRESETS[pk];
        const active = avail && pr.gains.every((v, k) => Math.abs(v - this.stemGains[k]) < 0.01);
        return { on: active, color: '#a35bff', dim: avail ? '#2a1a4a' : null, label: pr.name.toUpperCase() };
      }
    }
    return { on: false };
  }

  // ---------------------------------------------------------------- beatgrid
  tap() {
    const now = performance.now();
    this.taps = this.taps.filter(t => now - t < 2500);
    this.taps.push(now);
    if (this.taps.length >= 4 && this.track) {
      const iv = (this.taps[this.taps.length - 1] - this.taps[0]) / (this.taps.length - 1);
      const bpm = Math.round(60000 / iv * 10) / 10;
      const upd = { bpm, bpmLocked: true, grid: null }; // el tap vuelve a una rejilla fija
      if (this.isYT || !this.track.analyzed) upd.firstBeat = this.time % (60 / bpm);
      this.app.library.update(this.track.id, upd);
      this.emit('track', this.track);
    }
  }
  // guarda una rejilla de marcas (normalizada) en la pista
  saveGrid(g) {
    if (!this.track) return;
    this.app.library.update(this.track.id, Grid.gridUpdate(g, this.duration));
    this.emit('track', this.track); this.emit('grid');
    if (this.sync) this.syncNow();
  }
  gridMarkers() { return Grid.markers(this.track).map(m => ({ ...m })); }
  setBpm(bpm) {
    if (!this.track || !(bpm > 20)) return;
    if (this.hasGridMarkers) {
      // escribir el BPM en el tramo actual: las marcas siguientes se desplazan para conservar los beats
      const g = this.gridMarkers(), i = Grid.markerIndexAt(this.track, this.time);
      if (i + 1 < g.length) {
        const span = g[i + 1].t - g[i].t, n = Math.max(1, Math.round(span * g[i].bpm / 60));
        const delta = n * 60 / bpm - span;
        for (let k = i + 1; k < g.length; k++) g[k].t += delta;
      }
      g[i].bpm = bpm;
      return this.saveGrid(g);
    }
    this.app.library.update(this.track.id, { bpm, bpmLocked: true });
    this.emit('track', this.track); this.emit('grid');
    if (this.sync) this.syncNow();
  }
  bpmScale(f) {
    if (!this.bpm) return;
    if (this.hasGridMarkers) return this.saveGrid(this.gridMarkers().map(m => ({ t: m.t, bpm: m.bpm * f })));
    this.setBpm(Math.round(this.bpm * f * 100) / 100);
  }
  bpmNudge(d) { if (this.bpm) this.setBpm(Math.round((this.bpm + d) * 1000) / 1000); }
  gridShift(ms) {
    if (!this.track || !this.bpm) return;
    if (this.hasGridMarkers) {
      // mueve la marca del tramo actual (el tramo anterior se reajusta a beats enteros)
      const g = this.gridMarkers(), i = Grid.markerIndexAt(this.track, this.time);
      g[i].t += ms / 1000;
      return this.saveGrid(g);
    }
    const bl = this.beatLen;
    const fb = (((this.firstBeat + ms / 1000) % (4 * bl)) + 4 * bl) % (4 * bl);
    this.app.library.update(this.track.id, { firstBeat: fb, bpmLocked: true });
    this.emit('track', this.track); this.emit('grid');
  }
  downbeatHere() {
    if (!this.track || !this.bpm) return;
    if (this.hasGridMarkers) {
      const g = this.gridMarkers(), i = Grid.markerIndexAt(this.track, this.time);
      const bar = 4 * 60 / g[i].bpm;
      const k = Math.round((this.time - g[i].t) / bar); // compases desde la marca
      g[i].t = this.time - k * bar;
      if (i > 0 && g[i].t <= g[i - 1].t) g[i].t += bar;
      return this.saveGrid(g);
    }
    const bar = 4 * this.beatLen;
    this.app.library.update(this.track.id, { firstBeat: ((this.time % bar) + bar) % bar, bpmLocked: true });
    this.emit('track', this.track); this.emit('grid');
  }
  // Marca de grid en la posición actual (coloca el cabezal sobre el golpe y pulsa +MARCA)
  addGridMarker(t = this.time) {
    if (!this.track || !this.bpm) return this.app.toast('Primero analiza la pista o fija su BPM', 'warn');
    const g = this.gridMarkers();
    const i = Grid.markerIndexAt(this.track, t);
    if (g.some(m => Math.abs(m.t - t) < 60 / g[i].bpm * 0.75)) return this.app.toast('Ya hay una marca de grid en ese beat', 'warn');
    if (t < g[0].t) g.unshift({ t, bpm: g[0].bpm });
    else g.splice(i + 1, 0, { t, bpm: g[i].bpm });
    this.saveGrid(g);
    this.app.toast(`Marca de grid añadida (${this.hasGridMarkers ? this.track.grid.length : 1} marcas)`);
  }
  removeGridMarker(t = this.time) {
    if (!this.hasGridMarkers) return this.app.toast('La pista no tiene marcas de grid', 'info');
    const g = this.gridMarkers();
    let i = Grid.markerIndexAt(this.track, t);
    // la más cercana entre la del tramo y la siguiente
    if (i + 1 < g.length && Math.abs(g[i + 1].t - t) < Math.abs(g[i].t - t)) i++;
    g.splice(i, 1);
    this.saveGrid(g);
  }
  clearGridMarkers() {
    if (!this.hasGridMarkers) return;
    const g = this.gridMarkers(), i = Grid.markerIndexAt(this.track, this.time);
    this.saveGrid([{ t: g[0].t, bpm: g[i].bpm }]);
    this.app.toast('Beatgrid fijo restaurado');
  }

  // ---------------------------------------------------------------- por frame
  frame() {
    if (this.isYT && this.yt) {
      this.yt.setVolume(this.engine.effectiveGain(this.idx));
      const p = this.yt.isPlaying();
      if (this.playing && !p && this.yt.state === 2) { this.playing = false; this.emit('state'); }
    }
    if (this.playing && !this.loggedPlay && performance.now() - this.playStartedAt > (this.app.settings.historyAfter ?? 30) * 1000) {
      const g = this.engine.effectiveGain(this.idx);
      if (g > 0.05) { this.loggedPlay = true; this.app.library.logPlay(this.track, this.idx); }
    }
  }
}
