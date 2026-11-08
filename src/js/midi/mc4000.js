// Perfil nativo para la Denon DJ MC4000
// Canales MIDI: decks 1/2 = canales 1/2 (0x90/0x91, 0xB0/0xB1), pads = canales 5/6
// (0x94/0x95), FX 1/2 = canales 9/10 (0x98/0x99, 0xB8/0xB9), global = canal 16 (0x9F/0xBF).
// Cualquier control puede reasignarse con MIDI learn (Ajustes → MIDI).

const ON = 0x7F, OFF = 0x00, DIM = 0x01;
const rel = (v) => (v < 64 ? v : v - 128);

export class MC4000Profile {
  static match(name) { return /MC\s?4000/i.test(name || ''); }

  constructor(app, midi, input, output) {
    this.app = app; this.midi = midi; this.input = input; this.output = output;
    this.pitchMsb = [0, 0];
    this.pitchLsb = [0, 0];
    this.leds = new Map();
    this.lastVu = 0;
    this.ticksPerRev = 605;
  }

  send(bytes) { try { this.output && this.output.send(bytes); } catch (_) { /* puerto cerrado */ } }

  init() {
    // Pide al controlador el estado actual de faders y knobs
    if (this.midi.access && this.midi.access.sysexEnabled) {
      this.send([0xF0, 0x00, 0x02, 0x0B, 0x7F, 0x01, 0x60, 0x00, 0x04, 0x04, 0x01, 0x00, 0x00, 0xF7]);
    }
    this.leds.clear();
    for (const d of [0, 1]) this.send([0x90 + d, 0x07, this.app.decks[d].vinyl ? ON : OFF]);
  }

  deckPadIndex(deck, i) {
    const d = this.app.decks[deck];
    return ['hotcue', 'savedloop', 'sampler'].includes(d.padMode) ? i + 4 * d.padBank : i;
  }

  handle(st, d1, d2) {
    const app = this.app;
    const t = st & 0xF0, ch = st & 0x0F;
    const isNote = t === 0x90 || t === 0x80;
    const on = t === 0x90 && d2 > 0;

    // ---------------- decks (canales 1-2)
    if (ch <= 1) {
      const d = app.decks[ch];
      if (isNote) {
        switch (d1) {
          case 0x00: if (on) d.togglePlay(); return true;
          case 0x01: on ? d.cueDown() : d.cueUp(); return true;
          case 0x02: if (on) d.toggleSync(); return true;
          case 0x03: if (on) d.setSync(false); return true;
          case 0x04: if (on) d.stutter(); return true;
          case 0x05: if (on) d.toStart(); return true;
          case 0x06: d.jogTouch(on); return true;
          case 0x07: if (on) d.toggleVinyl(); return true;
          case 0x0B: on ? d.bendDown(1) : d.bendUp(); return true;
          case 0x0C: on ? d.bendDown(-1) : d.bendUp(); return true;
          case 0x0D: if (on) d.toggleKeylock(); return true;
          case 0x0E: if (on) d.cycleRange(); return true;
          case 0x10: d.censor(on); return true;
          case 0x1B: if (on) { const c = app.engine.channels[ch]; c.set('pfl', !c.values.pfl); } return true;
          case 0x20: on ? d.bendDown(-1, true) : d.bendUp(); return true;
          case 0x21: on ? d.bendDown(1, true) : d.bendUp(); return true;
        }
        return false;
      }
      if (t === 0xB0) {
        const c = app.engine.channels[ch];
        const knob = (v) => (Math.abs(v - 64) <= 1 ? 0.5 : v / 127);
        switch (d1) {
          case 0x06: d.jogTurn(rel(d2), this.ticksPerRev); return true;
          case 0x09: this.pitchMsb[ch] = d2; this.applyPitch(ch); return true;
          case 0x29: this.pitchLsb[ch] = d2; this.applyPitch(ch); return true;
          case 0x16: c.set('trim', knob(d2)); return true;
          case 0x17: c.set('high', knob(d2)); return true;
          case 0x18: c.set('mid', knob(d2)); return true;
          case 0x19: c.set('low', knob(d2)); return true;
          case 0x1A: c.set('filter', knob(d2)); return true;
          case 0x1C: c.set('fader', d2 / 127); return true;
        }
        return false;
      }
      return false;
    }

    // ---------------- pads y loops (canales 5-6)
    if (ch === 4 || ch === 5) {
      const deck = ch - 4, d = app.decks[deck];
      if (!isNote) return false;
      if (d1 >= 0x14 && d1 <= 0x17) {
        const i = d1 - 0x14;
        if (this.midi.padModeHeld[deck]) {
          if (on) this.selectModeFromPad(d, i);
          return true;
        }
        const idx = this.deckPadIndex(deck, i);
        on ? d.padDown(idx) : d.padUp(idx);
        return true;
      }
      if (d1 >= 0x1C && d1 <= 0x1F) { if (on) d.padDown(this.deckPadIndex(deck, d1 - 0x1C), true); return true; }
      switch (d1) {
        case 0x32: if (on) d.autoLoop(); return true;
        case 0x3F: if (on) app.setSetting('quantize', !app.settings.quantize); return true;
        case 0x34: if (on) d.loopHalve(); return true;
        case 0x38: if (on) d.loopIn(); return true;
        case 0x35: if (on) d.loopDouble(); return true;
        case 0x39: if (on) d.loopOut(); return true;
        case 0x33: if (on) d.reloop(); return true;
      }
      return false;
    }

    // ---------------- efectos (canales 9-10)
    if (ch === 8 || ch === 9) {
      const u = app.fxUnits[ch - 8];
      if (isNote) {
        if (d1 <= 0x02) { if (on) { const s = u.slots[d1]; s.setEnabled(!s.enabled); app.emit('fx'); } return true; }
        if (d1 >= 0x0B && d1 <= 0x0D) { if (on) app.nextEffect(u.slots[d1 - 0x0B]); return true; }
        if (d1 === 0x04) { if (on) { const d = app.fxTargetDeck(u); if (d) d.tap(); } return true; }
        if (d1 === 0x41) { if (on) { u.target = u.target === 'master' ? (u.idx ? 'deck1' : 'deck0') : 'master'; app.rewireFx(); app.emit('fx'); } return true; }
        return false;
      }
      if (t === 0xB0) {
        if (d1 <= 0x02) { u.slots[d1].setParam(d2 / 127); app.emit('fx'); return true; }
        if (d1 === 0x03) { app.fxBeats(u, Math.sign(rel(d2))); return true; }
      }
      return false;
    }

    // ---------------- global (canal 16)
    if (ch === 15) {
      const eng = app.engine;
      if (isNote) {
        switch (d1) {
          case 0x02: if (on) app.loadSelected(0); return true;
          case 0x03: if (on) app.loadSelected(1); return true;
          case 0x07: if (on && !app.libraryUI.sideKey(-1)) app.libraryUI.toggleFocus('side'); return true;   // en la barra lateral pliega subcrates
          case 0x11: if (on) app.togglePanel('sampler'); return true;
          case 0x1F: if (on) app.libraryUI.toggleFocus(); return true;
          case 0x1B: if (on) { const tr = app.libraryUI.current(); if (tr) { app.library.addToPrepare([tr.id]); app.toast('Añadida a Prepare: ' + tr.title); } } return true;
          case 0x10: if (on) app.libraryUI.setView('prepare'); return true;
          case 0x1C: eng.setSplit(on || (t === 0x90 && d2 > 0)); return true;
        }
        if (d1 >= 0x21 && d1 <= 0x24) { on ? app.sampler.press(d1 - 0x21) : app.sampler.release(d1 - 0x21); return true; }
        if (d1 >= 0x28 && d1 <= 0x2B) { if (on) app.sampler.stop(d1 - 0x28); return true; }
        return false;
      }
      if (t === 0xB0) {
        switch (d1) {
          case 0x00: app.libraryUI.move(Math.sign(rel(d2)) * Math.min(4, Math.abs(rel(d2)))); return true;
          case 0x01: app.libraryUI.move(rel(d2) * 10); return true;
          case 0x08: eng.setCrossfader(d2 / 127); return true;
          case 0x0D: eng.setCueMix(d2 / 127); return true;
          case 0x0C: if (app.settings.mc4000PhonesMidi) eng.setPhonesVol(d2 / 127); return true;
          case 0x1A: eng.setSamplerVol(d2 / 127); return true;
        }
      }
      return false;
    }
    return false;
  }

  applyPitch(ch) {
    const v = ((this.pitchMsb[ch] << 7) | this.pitchLsb[ch]) / 16383;
    const dir = this.app.settings.invertPitch ? 1 : -1;
    this.app.decks[ch].setPitchFader(dir * (v * 2 - 1));
  }

  // PAD MODE + pad 1..4 → Hot Cues 1-4 / Hot Cues 5-8 / Roll / Slicer (pulsar pad 4 otra vez → Stems)
  selectModeFromPad(d, i) {
    if (i === 0) { d.padBank = 0; d.setPadMode('hotcue'); }
    else if (i === 1) { d.padBank = 1; d.setPadMode('hotcue'); }
    else if (i === 2) d.setPadMode('roll');
    else d.setPadMode(d.padMode === 'slicer' ? 'stems' : 'slicer'); // pad 4 otra vez: Stems
    const name = { hotcue: 'Hot Cue ' + (d.padBank ? '5-8' : '1-4'), roll: 'Roll', slicer: 'Slicer (otra vez: Stems)', stems: 'Stems (Voz · Bat · Bajo · Mel)' }[d.padMode];
    this.app.toast(`Deck ${d.idx + 1}: pads en modo ${name}`);
  }

  led(st, d1, v) {
    const k = (st << 8) | d1;
    if (this.leds.get(k) === v) return;
    this.leds.set(k, v);
    this.send([st, d1, v]);
  }

  frame() {
    if (!this.output) return;
    const app = this.app;
    const blink = Math.floor(performance.now() / 300) % 2 === 0;
    app.decks.forEach((d, i) => {
      const loaded = !!d.track;
      this.led(0x90 + i, 0x00, d.playing ? ON : (loaded && blink ? DIM : OFF));
      const atCue = loaded && !d.playing && Math.abs(d.time - d.cuePoint) < 0.03;
      this.led(0x90 + i, 0x01, d.playing || atCue ? ON : OFF);
      this.led(0x90 + i, 0x02, d.sync ? ON : OFF);
      this.led(0x90 + i, 0x07, d.vinyl ? ON : OFF);
      this.led(0x90 + i, 0x0D, d.keylock ? ON : OFF);
      this.led(0x90 + i, 0x1B, app.engine.channels[i].values.pfl ? ON : OFF);
      this.led(0x94 + i, 0x32, d.loop.on ? ON : OFF);
      for (let p = 0; p < 4; p++) {
        const s = d.padState(this.deckPadIndex(i, p));
        this.led(0x94 + i, 0x14 + p, s.on ? (d.padMode === 'hotcue' ? DIM : ON) : OFF);
      }
    });
    app.fxUnits.forEach((u, i) => u.slots.forEach((s, k) => this.led(0x98 + i, k, s.enabled ? ON : OFF)));
    for (let k = 0; k < 4; k++) this.led(0x9F, 0x21 + k, app.sampler.isPlaying(k) ? ON : (app.sampler.slot(k).path ? DIM : OFF));
    // VU meters (~20 Hz)
    const now = performance.now();
    if (now - this.lastVu > 50 && app.lastMeters) {
      this.lastVu = now;
      const vu = (p) => Math.round(Math.min(1, Math.max(0, (20 * Math.log10(Math.max(p, 1e-5)) + 36) / 39)) * 0x7F);
      this.led(0xBF, 0x44, vu(app.lastMeters.L));
      this.led(0xBF, 0x45, vu(app.lastMeters.R));
    }
  }
}
