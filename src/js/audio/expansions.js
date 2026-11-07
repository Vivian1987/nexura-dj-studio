// Servicios de expansiones independientes. Las funciones todavía no implementadas
// permanecen desactivadas; una opción activa nunca implica soporte ficticio.
export const EXPANSIONS = {
  flip: { name: 'Flip', available: true, description: 'Graba y reproduce secuencias cuantizadas de hot cues y Censor (máximo 6 por pista).' },
  fxPresets: { name: 'Presets de FX', available: true, description: 'Guarda y restaura configuraciones de las dos unidades de efectos.' },
  laptop: { name: 'Modo solo laptop', available: true, description: 'Vista compacta, navegación por teclado y acceso rápido al Split Cue.' },
  video: { name: 'Video', available: false, description: 'Salida secundaria sincronizada y FX visuales; fase posterior.' },
  dvs: { name: 'DVS', available: false, description: 'Decodificación de timecode desde entrada de audio; requiere calibración y validación de hardware.' },
  pitchTime: { name: "Pitch 'n Time", available: false, description: 'Time-stretch de alta calidad mediante librería externa; fase posterior.' }
};

const MAX_FLIPS = 6;
const quantizedBeat = (beat) => Math.max(0, Math.round(beat));

export class ExpansionManager {
  constructor(app) { this.app = app; this.recordings = new Map(); this.playbacks = new Map(); }
  enabled(id) { return !!(this.app.settings.expansions || {})[id]; }
  setEnabled(id, value) {
    const def = EXPANSIONS[id];
    if (!def || (value && !def.available)) return false;
    const expansions = { ...(this.app.settings.expansions || {}), [id]: !!value };
    this.app.setSetting('expansions', expansions);
    return true;
  }
  flipList(deck) { return Array.isArray(deck.track?.flips) ? deck.track.flips : []; }
  saveFlipList(deck, flips) {
    if (!deck.track) return;
    deck.track.flips = flips.slice(0, MAX_FLIPS);
    this.app.library.update(deck.track.id, { flips: deck.track.flips });
    this.app.emit('expansions', 'flip', deck.idx);
  }
  startFlipRecord(deck, slot) {
    if (!this.enabled('flip')) return this.app.toast('Activa Flip en Ajustes → Expansiones primero', 'warn');
    if (!deck.track || !deck.bpm) return this.app.toast('Carga una pista analizada con BPM para grabar un Flip', 'warn');
    slot = Math.max(0, Math.min(MAX_FLIPS - 1, slot | 0));
    const flips = this.flipList(deck).slice();
    this.recordings.set(deck.idx, { slot, startBeat: deck.beatAt(deck.time), events: [], deckId: deck.track.id });
    this.app.toast(`Grabando Flip ${slot + 1} · Deck ${deck.idx + 1}`, 'ok');
  }
  stopFlipRecord(deck) {
    const rec = this.recordings.get(deck.idx);
    if (!rec) return false;
    this.recordings.delete(deck.idx);
    if (deck.track?.id !== rec.deckId) return this.app.toast('Pista cambiada: Flip descartado', 'warn');
    const flips = this.flipList(deck).slice();
    flips[rec.slot] = { name: flips[rec.slot]?.name || `Flip ${rec.slot + 1}`, events: rec.events.sort((a, b) => a.beat - b.beat) };
    this.saveFlipList(deck, flips);
    this.app.toast(`Flip ${rec.slot + 1} guardado (${rec.events.length} acciones)`, 'ok');
    return true;
  }
  record(deck, event) {
    const rec = this.recordings.get(deck.idx);
    if (!rec || deck.track?.id !== rec.deckId || this.playbacks.has(deck.idx)) return;
    const beat = quantizedBeat(deck.beatAt(deck.time) - rec.startBeat);
    const last = rec.events.at(-1);
    if (last && last.type === event.type && last.beat === beat && last.value === event.value) return;
    rec.events.push({ beat, ...event });
  }
  playFlip(deck, slot) {
    if (!this.enabled('flip') || !deck.track) return false;
    const flip = this.flipList(deck)[slot];
    if (!flip?.events?.length || !deck.bpm) return false;
    const token = { slot, deckId: deck.track.id, startBeat: deck.beatAt(deck.time), cursor: 0 };
    this.playbacks.set(deck.idx, token);
    this.app.emit('expansions', 'flip', deck.idx);
    return true;
  }
  stopFlip(deck) { const stopped = this.playbacks.delete(deck.idx); if (stopped) this.app.emit('expansions', 'flip', deck.idx); return stopped; }
  tick() {
    for (const [idx, playback] of this.playbacks) {
      const deck = this.app.decks[idx];
      if (!deck.track || deck.track.id !== playback.deckId || !deck.playing) continue;
      const elapsed = deck.beatAt(deck.time) - playback.startBeat;
      const events = this.flipList(deck)[playback.slot]?.events || [];
      while (playback.cursor < events.length && events[playback.cursor].beat <= elapsed + 0.02) {
        const event = events[playback.cursor++];
        if (event.type === 'cue') deck.jumpTo(event.time);
        else if (event.type === 'censor') deck.censor(!!event.value);
      }
      if (playback.cursor >= events.length) this.stopFlip(deck);
    }
  }
  state(deck) { return { recording: this.recordings.has(deck.idx), playing: this.playbacks.has(deck.idx), flips: this.flipList(deck) }; }
}
