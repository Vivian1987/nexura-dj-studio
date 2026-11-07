// Asistente «Añadir controladora»: configura cualquier controladora MIDI paso a paso.
// Pide mover cada control, detecta su mensaje (nota, CC, pitch bend, 14 bits),
// la codificación de jogs/encoders y los pasos por vuelta del plato, y guarda
// el resultado como perfil de ese dispositivo (settings.midiProfiles).
import { el, toast } from '../util.js';
import { btn, select } from './controls.js';
import {
  describeKey, parseKey, newRelStats, addRelStat, guessRelEncoding, REL_DECODERS, REL_NAMES,
  REF_TICKS_PER_REV, normalizeDeviceProfile, FOUR_DECK_MODELS
} from '../midi/midi.js';

function buildSteps(four = false) {
  const S = [];
  const add = (group, list) => list.forEach(x => S.push({ group, ...x }));
  add('General', [
    { type: 'abs', action: 'xfader', text: 'Mueve el CROSSFADER de un lado a otro.' },
    { type: 'rel', action: 'browse', text: 'Gira el ENCODER de navegación (el de la biblioteca) unos clics hacia la DERECHA.' },
    { type: 'button', action: 'browsepush', text: 'Pulsa el ENCODER de navegación (o el botón que cambia de panel / «Back»).' },
    { type: 'button', action: 'deck1.load', text: 'Pulsa LOAD del deck 1 (izquierda).' },
    { type: 'button', action: 'deck2.load', text: 'Pulsa LOAD del deck 2 (derecha).' },
    { type: 'abs', action: 'master', text: 'Mueve el volumen MASTER. Si en tu controladora actúa solo por hardware, pulsa «Saltar».' },
    { type: 'abs', action: 'cuemix', text: 'Mueve el knob CUE MIX de auriculares (o pulsa «Saltar»).' }
  ]);
  for (const n of four ? [1, 2, 3, 4] : [1, 2]) {
    const side = n % 2 ? 'izquierda' : 'derecha', p = `deck${n}.`;
    // decks 3 y 4: primero hay que cambiar la capa de ese lado en la controladora
    const layer = n > 2 ? `Cambia el lado ${n % 2 ? 'izquierdo' : 'derecho'} de tu controladora al DECK ${n} (botón «DECK ${n}» o «${n - 2}/${n}»). ` : '';
    if (n > 2) add(`Deck ${n} (${side})`, [{ type: 'button', action: p + 'load', text: `${layer}Después pulsa LOAD de ese lado (ahora es el deck ${n}).` }]);
    add(`Deck ${n} (${side})`, [
      { type: 'button', action: p + 'play', text: `${n > 2 ? 'Con la capa del deck ' + n + ' activa, pulsa' : 'Pulsa'} PLAY del deck ${n}.` },
      { type: 'button', action: p + 'cue', text: `Pulsa CUE del deck ${n}.` },
      { type: 'button', action: p + 'sync', text: `Pulsa SYNC del deck ${n}.` },
      { type: 'pitch', action: p + 'pitch', text: `Mueve el fader de PITCH del deck ${n} de un extremo a otro y déjalo en el extremo «+» (más rápido).` },
      { type: 'button', action: p + 'jogtouch', text: `Toca la parte de arriba del plato del deck ${n} y suéltalo, sin girarlo. Si tu plato no es táctil, pulsa «Saltar».` },
      { type: 'jog', action: p + 'jog', text: `Gira el plato del deck ${n} UNA vuelta completa hacia delante (sentido horario), tocándolo por arriba. Luego pulsa «Listo».` },
      { type: 'jog', action: p + 'jog', add: true, text: `Ahora gira el plato del deck ${n} una vuelta tocando SOLO el borde. Si tu plato no distingue el borde, pulsa «Saltar».` },
      { type: 'button', action: p + 'keylock', text: `Pulsa KEY LOCK del deck ${n} (o «Saltar»).` },
      { type: 'button', action: p + 'vinyl', text: `Pulsa VINYL / SCRATCH del deck ${n} (o «Saltar»).` }
    ]);
    add(`Mezclador · canal ${n}`, [
      { type: 'abs', action: p + 'fader', text: `Mueve el FADER del canal ${n} de arriba abajo.${n > 2 ? ' Si tu mezclador solo tiene 2 canales, pulsa «Saltar grupo».' : ''}` },
      { type: 'abs', action: p + 'trim', text: `Gira el GAIN / TRIM del canal ${n}.` },
      { type: 'abs', action: p + 'high', text: `Gira el EQ de AGUDOS (HI) del canal ${n}.` },
      { type: 'abs', action: p + 'mid', text: `Gira el EQ de MEDIOS (MID) del canal ${n}.` },
      { type: 'abs', action: p + 'low', text: `Gira el EQ de GRAVES (LOW) del canal ${n}.` },
      { type: 'abs', action: p + 'filter', text: `Gira el FILTRO del canal ${n} (o «Saltar»).` },
      { type: 'button', action: p + 'pfl', text: `Pulsa el botón CUE de auriculares (PFL) del canal ${n}.` }
    ]);
    add(`Pads · deck ${n}`, Array.from({ length: 8 }, (_, i) => ({ type: 'button', action: p + 'pad' + (i + 1), text: `Pulsa el PAD ${i + 1} del deck ${n} (en modo hot cue). Si solo tienes 4 pads, pulsa «Saltar grupo» al llegar al 5.` })));
    add(`Loops · deck ${n}`, [
      { type: 'button', action: p + 'loop', text: `Pulsa AUTO LOOP / LOOP del deck ${n} (o «Saltar»).` },
      { type: 'button', action: p + 'loophalve', text: `Pulsa LOOP ½ del deck ${n} (o «Saltar»).` },
      { type: 'button', action: p + 'loopdouble', text: `Pulsa LOOP ×2 del deck ${n} (o «Saltar»).` }
    ]);
  }
  return S;
}

export class MidiWizard {
  constructor(app) { this.app = app; }

  async open(deviceName = '') {
    const app = this.app, midi = app.midi;
    const names = midi.connectedNames;
    if (!names.length) return toast('Conecta tu controladora por USB y espera unos segundos antes de abrir el asistente.', 'warn', 6000);
    this.device = names.includes(deviceName) ? deviceName : names.find(n => !midi.isNative(n)) || names[0];
    this.steps = buildSteps(FOUR_DECK_MODELS.test(this.device));
    this.i = 0;
    this.results = [];
    this.body = el('div', { class: 'wizard' });
    this.renderStart();
    midi.capture = (m) => this.onMsg(m);
    await app.modal('Añadir controladora', this.body, ['Cerrar']);
    midi.capture = null;
    clearTimeout(this.timer);
    if (this.started && !this.saved) this.save(true);
  }

  // ---------------------------------------------------------------- pantallas
  renderStart() {
    const app = this.app, midi = app.midi;
    const names = midi.connectedNames;
    const existing = Object.keys(midi.getProfile(this.device).map).length;
    const keep = el('input', { type: 'checkbox', class: 'switch', id: 'wz-keep' });
    keep.checked = existing > 0;
    const four = el('input', { type: 'checkbox', class: 'switch', id: 'wz-four' });
    four.checked = FOUR_DECK_MODELS.test(this.device);
    const dev = select(Object.fromEntries(names.map(n => [n, n])), this.device, (v) => { this.device = v; this.renderStart(); }, 'wide');
    this.body.innerHTML = '';
    this.body.append(...[
      el('p', {}, 'El asistente te pedirá que muevas cada control de tu controladora o mesa con MIDI. Detecta solo el tipo de mensaje, la codificación de platos y encoders y los pasos por vuelta del jog.'),
      this.rowEl('Controladora', dev),
      midi.isNative(this.device) ? el('p', { class: 'hint ok' }, 'Esta controladora se reconoce automáticamente. Lo que configures aquí sustituye solo a los controles que vuelvas a asignar.') : null,
      existing ? el('label', { class: 'fb-check', for: 'wz-keep' }, keep, el('span', {}, `Conservar las ${existing} asignaciones que ya tiene`)) : null,
      el('label', { class: 'fb-check', for: 'wz-four' }, four, el('span', {}, 'Mi controladora maneja 4 decks (capas 1/3 y 2/4): añadir los pasos de los decks 3 y 4')),
      el('ul', { class: 'fb-list' },
        el('li', {}, 'Si tu equipo no tiene un control, pulsa «Saltar». «Saltar grupo» pasa al siguiente bloque (por ejemplo, si solo tienes 4 pads).'),
        el('li', {}, 'Mientras el asistente está abierto, la controladora no mueve la aplicación.'),
        el('li', {}, 'Puedes cerrarlo cuando quieras: lo que ya hayas configurado se guarda.')),
      el('div', { class: 'row wz-actions' }, btn('Empezar', { cls: 'primary', onClick: () => { this.keep = keep.checked; this.steps = buildSteps(four.checked); this.started = true; this.go(0); } }))].filter(Boolean));
  }

  rowEl(label, ctl) { return el('div', { class: 'set-row' }, el('div', { class: 'set-label' }, label), el('div', { class: 'set-ctl' }, ctl)); }

  go(i) {
    clearTimeout(this.timer);
    if (i >= this.steps.length) return this.finish();
    this.i = Math.max(0, i);
    this.st = { keys: new Map(), cand: null, done: false };
    this.renderStep();
  }

  renderStep(detail = '') {
    const s = this.steps[this.i], app = this.app;
    const act = app.actions[s.action];
    const pct = Math.round((this.i / this.steps.length) * 100);
    this.status = el('div', { class: 'wz-status' + (this.st.cand ? ' ok' : '') }, detail || (this.st.cand ? 'Detectado' : 'Esperando al control…'));
    this.doneBtn = s.type === 'jog' ? btn('Listo', { cls: 'primary', onClick: () => this.finishJog() }) : null;
    if (this.doneBtn) this.doneBtn.disabled = !this.st.cand;
    const nextGroup = this.steps.findIndex((x, k) => k > this.i && x.group !== s.group);
    this.body.innerHTML = '';
    this.body.append(
      el('div', { class: 'wz-progress' }, el('div', { style: { width: pct + '%' } })),
      el('div', { class: 'wz-meta' }, `${s.group} · paso ${this.i + 1} de ${this.steps.length}${act ? ' · ' + act.label : ''}`),
      el('p', { class: 'wz-text' }, s.text),
      this.status,
      el('div', { class: 'row wz-actions' },
        btn('← Atrás', { cls: 'small', onClick: () => { this.results = this.results.filter(r => r.step < this.i - 1); this.go(this.i - 1); } }),
        btn('Saltar', { cls: 'small', onClick: () => this.go(this.i + 1) }),
        btn('Saltar grupo', { cls: 'small', onClick: () => this.go(nextGroup < 0 ? this.steps.length : nextGroup) }),
        btn('Terminar y guardar', { cls: 'small', onClick: () => this.finish() }),
        this.doneBtn));
  }

  setStatus(text, ok = false) { if (this.status) { this.status.textContent = text; this.status.classList.toggle('ok', ok); } }

  // ---------------------------------------------------------------- detección
  usedKeys() {
    const s = this.steps[this.i];
    return new Set(this.results.filter(r => r.step !== this.i && !(s.type === 'jog' && r.type === 'jog')).map(r => r.key));
  }

  onMsg(m) {
    if (!this.started || m.name !== this.device || !this.steps || this.i >= this.steps.length || this.st.done) return;
    const s = this.steps[this.i];
    if (this.usedKeys().has(m.key)) return;
    const k = this.st.keys.get(m.key) || { n: 0, min: 1, max: 0, last: 0, vals: new Set(), stats: newRelStats(), d2: [] };
    this.st.keys.set(m.key, k);
    k.n++;
    if (s.type === 'button') {
      if (m.t === 0xB0) k.vals.add(m.d2);
      // botón por nota, o por CC que solo envía 127/0 (un knob envía valores intermedios)
      if (m.isNote ? m.pressed : (m.t === 0xB0 && m.d2 === 127 && k.vals.size <= 2)) {
        this.capture({ key: m.key }, `Detectado: ${describeKey(m.key)}`);
        this.next(350);
      }
      return;
    }
    if (m.isNote) return;
    if (s.type === 'abs' || s.type === 'pitch') {
      if (m.t === 0xB0 && m.d1 >= 32 && m.d1 < 64 && this.st.keys.has(`c${m.ch}:${m.d1 - 32}`)) return; // LSB 14 bits
      const v = m.t === 0xE0 ? ((m.d2 << 7) | m.d1) / 16383 : m.d2 / 127;
      k.min = Math.min(k.min, v); k.max = Math.max(k.max, v); k.last = v;
      const range = k.max - k.min;
      if (range >= 0.45 && (!this.st.cand || this.st.cand.key === m.key)) {
        // se confirma cuando el control deja de moverse (para conocer la posición final del pitch)
        this.st.cand = { key: m.key };
        this.setStatus(`Detectado: ${describeKey(m.key)} · recorrido ${Math.round(range * 100)} %${s.type === 'pitch' ? ' — deja el fader en el extremo «+»' : ''}`, true);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const kk = this.st.keys.get(m.key);
          const opts = s.type === 'pitch' && kk.last > 0.5 ? { inv: true } : null;
          this.capture({ key: m.key, opts }, `${describeKey(m.key)} · recorrido ${Math.round((kk.max - kk.min) * 100)} %${opts ? ' · dirección invertida' : ''}`);
          this.next(500);
        }, 900);
      } else if (!this.st.cand) this.setStatus(`Recibiendo ${describeKey(m.key)} · recorrido ${Math.round(range * 100)} %…`);
      return;
    }
    if (m.t !== 0xB0) return;
    addRelStat(k.stats, m.d2);
    k.d2.push(m.d2);
    if (s.type === 'rel') {
      if (k.n >= 3) {
        const enc = guessRelEncoding(k.stats);
        const sum = k.d2.reduce((a, v) => a + REL_DECODERS[enc](v), 0);
        this.capture({ key: m.key, opts: { enc, ...(sum < 0 ? { inv: true } : {}) } }, `Detectado: ${describeKey(m.key)} · encoder relativo (${REL_NAMES[enc]})`);
        this.next(700);
      }
      return;
    }
    if (s.type === 'jog') {
      const best = [...this.st.keys.entries()].filter(([key]) => parseKey(key)?.type === 'c').sort((a, b) => b[1].n - a[1].n)[0];
      if (!best) return;
      const [bk, bs] = best;
      const enc = guessRelEncoding(bs.stats);
      const total = bs.d2.reduce((a, v) => a + REL_DECODERS[enc](v), 0);
      this.st.cand = bs.n >= 8 ? { key: bk } : null;
      if (this.doneBtn) this.doneBtn.disabled = !this.st.cand;
      this.setStatus(`Plato: ${describeKey(bk)} · ${bs.n} mensajes · ${Math.abs(total)} pasos (${REL_NAMES[enc]})${this.st.cand ? ' — pulsa «Listo» al completar la vuelta' : ''}`, !!this.st.cand);
    }
  }

  capture(res, text) {
    const s0 = this.steps[this.i];
    // decks 3/4: si el control envía lo mismo que en el deck 1/2, la controladora no distingue capas
    const m = /^deck([34])\./.exec(s0.action);
    if (m) {
      const other = this.results.find(r => r.key === res.key && r.action === s0.action.replace(/^deck[34]/, 'deck' + (+m[1] - 2)));
      if (other) {
        this.st.cand = null; this.st.done = false;
        return this.setStatus(`Ese control envía el mismo mensaje que en el deck ${+m[1] - 2}. Comprueba que has cambiado la capa al deck ${m[1]}; si tu controladora no cambia de mensaje, pulsa «Saltar grupo».`);
      }
    }
    this.st.cand = res;
    this.st.done = true;
    this.results = this.results.filter(r => r.step !== this.i);
    const s = this.steps[this.i];
    this.results.push({ step: this.i, type: s.type, action: s.action, add: !!s.add, key: res.key, opts: res.opts || null });
    this.setStatus('✓ ' + text, true);
  }

  // solo avanza si el paso quedó detectado (capture puede rechazar un control repetido de otra capa)
  next(ms) { clearTimeout(this.timer); if (!this.st.done) return; this.timer = setTimeout(() => this.go(this.i + 1), ms); }

  finishJog() {
    const s = this.steps[this.i];
    const entries = [...this.st.keys.entries()].filter(([key, k]) => parseKey(key)?.type === 'c' && k.n >= 8);
    const maxN = Math.max(0, ...entries.map(([, k]) => k.n));
    this.results = this.results.filter(r => r.step !== this.i);
    const found = [];
    for (const [key, k] of entries) {
      if (k.n < maxN * 0.25) continue;
      const enc = guessRelEncoding(k.stats);
      const total = k.d2.reduce((a, v) => a + REL_DECODERS[enc](v), 0);
      const ticks = Math.abs(total);
      if (ticks < 10) continue;
      const opts = { enc, scale: Math.round((REF_TICKS_PER_REV / ticks) * 10000) / 10000, ...(total < 0 ? { inv: true } : {}) };
      this.results.push({ step: this.i, type: 'jog', action: s.action, add: true, key, opts });
      found.push(`${describeKey(key)} · ${ticks} pasos/vuelta`);
    }
    if (!found.length) { this.setStatus('No se detectó una vuelta completa. Gira el plato una vuelta entera y pulsa «Listo» otra vez.'); this.st.keys.clear(); return; }
    this.st.done = true;
    this.setStatus('✓ Plato configurado: ' + found.join(' · '), true);
    this.next(900);
  }

  // ---------------------------------------------------------------- guardar
  save(silent = false) {
    const midi = this.app.midi;
    const prof = this.keep ? midi.getProfile(this.device) : normalizeDeviceProfile(null);
    const firstJog = new Set();
    for (const r of this.results.slice().sort((a, b) => a.step - b.step)) {
      const replace = r.type !== 'jog' || !firstJog.has(r.action);
      if (r.type === 'jog') firstJog.add(r.action);
      if (replace) for (const k of Object.keys(prof.map)) if (prof.map[k] === r.action) { delete prof.map[k]; delete prof.opts[k]; }
      prof.map[r.key] = r.action;
      if (r.opts) prof.opts[r.key] = r.opts; else delete prof.opts[r.key];
    }
    if (this.results.length) prof.source = prof.source || 'asistente';
    midi.setProfile(this.device, prof);
    this.saved = true;
    const n = new Set(this.results.map(r => r.action)).size;
    if (n) toast(`${this.device}: ${n} controles configurados y guardados`, 'ok', 5000);
    else if (!silent) toast('No se configuró ningún control', 'warn');
    return n;
  }

  finish() {
    clearTimeout(this.timer);
    this.save();
    this.app.closeModal();
    setTimeout(() => this.app.settingsUI.open('midi'), 50);
  }
}
