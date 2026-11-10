// Autoplay sobre un crate — lógica pura (sin DOM ni audio), probada en Node (tools/test-autoplay.mjs).
// La cola recorre una lista de ids fijada al empezar: en el orden de la tabla o barajada (Fisher-Yates,
// sin repetir hasta agotar la lista y sin repetir la última al volver a empezar), con «Repetir al
// terminar», «Saltar las ya tocadas» (las tocadas ANTES de empezar; las que pincha el propio Autoplay
// no cuentan, así la repetición sigue funcionando) y las pistas que fallan al cargar se saltan.

export const AUTOPLAY_ORDERS = { list: 'En orden de la lista', shuffle: 'Aleatorio' };
export const AUTOPLAY_TRANSITIONS = { gapless: 'Seguida (sin pausa)', fade: 'Fundido', sync: 'Mezcla con sync' };
export const AUTOPLAY_DEFAULTS = { order: 'list', transition: 'fade', fadeSecs: 5, repeat: true, skipPlayed: false };
export const FADE_MIN = 1, FADE_MAX = 12;

const clampFade = (s) => Math.min(FADE_MAX, Math.max(FADE_MIN, Math.round(Number(s) || AUTOPLAY_DEFAULTS.fadeSecs)));

// Opciones guardadas (settings.autoplay) con valores por defecto y saneadas
export function autoplayOptions(o = {}) {
  const r = { ...AUTOPLAY_DEFAULTS, ...(o || {}) };
  if (!AUTOPLAY_ORDERS[r.order]) r.order = AUTOPLAY_DEFAULTS.order;
  if (!AUTOPLAY_TRANSITIONS[r.transition]) r.transition = AUTOPLAY_DEFAULTS.transition;
  r.fadeSecs = clampFade(r.fadeSecs);
  r.repeat = r.repeat !== false;
  r.skipPlayed = !!r.skipPlayed;
  return r;
}

// Barajado de Fisher-Yates (copia); rng() en [0, 1)
export function shuffle(list, rng = Math.random) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class AutoplayQueue {
  // ids: orden de la tabla. opts: { order, repeat, startId, currentId (la que ya suena), skip (ids a saltar), rng }
  constructor(ids, opts = {}) {
    this.ids = [...new Set((ids || []).filter(Boolean))];
    this.order = opts.order === 'shuffle' ? 'shuffle' : 'list';
    this.repeat = opts.repeat !== false;
    this.skip = new Set(opts.skip || []);
    this.failed = new Set();
    this.rng = opts.rng || Math.random;
    this.cycle = 0;
    this.nextSeq = null;   // siguiente vuelta (barajada) ya calculada: peek() y next() coinciden
    this.seq = this.order === 'shuffle' ? shuffle(this.ids, this.rng) : this.ids.slice();
    // «En orden»: empieza por la pista elegida (la seleccionada en la tabla) si está en la lista
    const k = this.order === 'list' && opts.startId != null ? this.seq.indexOf(opts.startId) : -1;
    this.pos = k > 0 ? k - 1 : -1;
    // Ya suena una pista de la lista (currentId): cuenta como la actual y la cola sigue DESPUÉS de ella
    // (en orden: la siguiente de la tabla; aleatorio: se pone la primera de la vuelta y no se repite)
    const c = opts.currentId != null ? this.seq.indexOf(opts.currentId) : -1;
    if (c >= 0) {
      if (this.order === 'shuffle') { [this.seq[0], this.seq[c]] = [this.seq[c], this.seq[0]]; this.pos = 0; }
      else this.pos = c;
    }
  }
  get total() { return this.seq.length; }
  // posición (1…total) de la pista actual en la vuelta actual; 0 antes de empezar
  get index() { return this.pos < 0 ? 0 : Math.min(this.pos + 1, this.seq.length); }
  current() { return this.pos >= 0 ? this.seq[this.pos] ?? null : null; }
  playable(id) { return !this.skip.has(id) && !this.failed.has(id); }
  // Cuántas pistas quedan disponibles (sin saltadas ni fallidas)
  get available() { return this.ids.filter(id => this.playable(id)).length; }

  _makeCycle(last) {
    if (this.order !== 'shuffle') return this.ids.slice();
    const s = shuffle(this.ids, this.rng);
    // al volver a empezar, que no suene dos veces seguidas la que acaba de sonar
    if (s.length > 1 && s[0] === last) { const j = 1 + Math.floor(this.rng() * (s.length - 1)); [s[0], s[j]] = [s[j], s[0]]; }
    return s;
  }
  _walk() {
    let seq = this.seq, pos = this.pos, wraps = 0;
    for (let guard = 0; guard <= 2 * this.ids.length + 2; guard++) {
      pos++;
      if (pos >= seq.length) {
        if (!this.repeat || wraps >= 1 || !this.ids.length) return null;
        if (!this.nextSeq) this.nextSeq = this._makeCycle(this.current());
        seq = this.nextSeq; pos = 0; wraps++;
      }
      const id = seq[pos];
      if (this.playable(id)) return { id, seq, pos };
    }
    return null;
  }
  // Siguiente pista sin avanzar (null = no queda ninguna)
  peek() { const r = this._walk(); return r ? r.id : null; }
  // Avanza y devuelve la siguiente pista (null = fin de la lista)
  next() {
    const r = this._walk();
    if (!r) return null;
    if (r.seq !== this.seq) { this.seq = r.seq; this.nextSeq = null; this.cycle++; }
    this.pos = r.pos;
    return r.id;
  }
  // Pista que no se pudo cargar: no se vuelve a intentar en este Autoplay
  fail(id) { this.failed.add(id); }
}

// Momento (segundos de la pista) en que empieza la transición hacia la siguiente.
// gapless: justo al final (el bucle de la app va cada 100 ms; se solapa como mucho ~0,15 s).
// fade: N segundos (de reloj) antes del final; tempo = velocidad de reproducción del deck.
export function transitionStart(kind, duration, { fadeSecs = 5, tempo = 1 } = {}) {
  if (!(duration > 0)) return Infinity;
  if (kind === 'gapless') return Math.max(0, duration - 0.15 * tempo);
  const len = clampFade(fadeSecs) * tempo;
  return Math.max(Math.min(duration * 0.5, 1), duration - len);
}

// Niveles de fader durante un fundido (p = 0…1): las dos curvas se solapan para que no haya bajón
// en el centro (las dos a 0,75 a mitad del fundido)
export function fadeLevels(p) {
  const x = Math.min(1, Math.max(0, p));
  return { from: Math.min(1, (1 - x) * 1.5), to: Math.min(1, x * 1.5) };
}

// Texto del indicador: «AUTOPLAY · Dance › Años 80 · 3/120 · siguiente: Artista – Título»
// (index 0 = suena una pista que no es de la lista, la que ya sonaba al empezar: «–/120»)
export function autoplayLabel({ source = '', index = 0, total = 0, next = '' } = {}) {
  return ['AUTOPLAY', source, total ? `${index || '–'}/${total}` : '', next ? 'siguiente: ' + next : ''].filter(Boolean).join(' · ');
}
