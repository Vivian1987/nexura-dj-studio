// Asistente IA de Nexura DJ Studio (100 % local, sin servicios externos):
// - sugerencia de la siguiente pista (tonalidad Camelot + BPM + energía)
// - constructor de sets por curva de energía
// - cues automáticos a partir de la estructura analizada (intro, drops, breaks, outro)
import { CUE_COLORS } from '../util.js';

const parseCam = (c) => { const m = /^(\d+)([AB])$/.exec(c || ''); return m ? { n: +m[1], l: m[2] } : null; };
const wheel = (d) => ((d % 12) + 12) % 12;

// Relación armónica entre dos códigos Camelot → { score 0..1, label }
export function keyRelation(from, to) {
  const a = parseCam(from), b = parseCam(to);
  if (!a || !b) return { score: 0.4, label: '' };
  const d = wheel(b.n - a.n);
  if (a.l === b.l) {
    if (d === 0) return { score: 1, label: 'misma tonalidad' };
    if (d === 1) return { score: 0.92, label: 'armónica (+1)' };
    if (d === 11) return { score: 0.9, label: 'armónica (−1)' };
    if (d === 2) return { score: 0.62, label: 'subida de energía (+2)' };
    if (d === 7) return { score: 0.55, label: 'subida de semitono' };
    if (d === 10) return { score: 0.45, label: 'bajada (−2)' };
    return { score: 0.1, label: 'choque de tonalidad' };
  }
  if (d === 0) return { score: 0.86, label: a.l === 'A' ? 'relativa mayor' : 'relativa menor' };
  if ((a.l === 'A' && d === 1) || (a.l === 'B' && d === 11)) return { score: 0.6, label: 'diagonal' };
  return { score: 0.1, label: 'choque de tonalidad' };
}

// BPM del candidato frente al de referencia, admitiendo ×½ y ×2
export function bpmRelation(ref, bpm) {
  if (!ref || !bpm) return { score: 0.4, pct: null, label: '' };
  let c = bpm, f = 1;
  for (const k of [0.5, 2]) if (Math.abs(bpm * k - ref) < Math.abs(c - ref)) { c = bpm * k; f = k; }
  const pct = (c - ref) / ref * 100;
  const score = Math.max(0, 1 - Math.abs(pct) / 8);
  const label = `${Math.round(bpm * 10) / 10} BPM${f !== 1 ? (f === 2 ? ' (×2)' : ' (×½)') : ''} · ${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')} %`;
  return { score, pct, label };
}

export const ENERGY_MODES = { up: 'Subir energía', keep: 'Mantener energía', down: 'Bajar energía' };

export function transitionScore(from, to, { refBpm, refKey, mode = 'keep' } = {}) {
  const k = keyRelation(refKey ?? from.camelot, to.camelot);
  const b = bpmRelation(refBpm ?? from.bpm, to.bpm);
  let eScore = 0.5, eLabel = '';
  if (from.energy && to.energy) {
    const target = from.energy + (mode === 'up' ? 1 : mode === 'down' ? -1 : 0);
    eScore = Math.max(0, 1 - Math.abs(to.energy - target) / 4);
    eLabel = `energía ${to.energy}`;
  }
  let score = 0.45 * k.score + 0.35 * b.score + 0.2 * eScore;
  // Si la tonalidad choca o el BPM está fuera de rango, la transición no es viable aunque lo demás encaje
  score *= 0.55 + 0.45 * Math.min(k.score, b.score);
  if (from.genre && to.genre && from.genre.toLowerCase() === to.genre.toLowerCase()) score += 0.04;
  if (to.source === 'youtube') score -= 0.03; // sin forma de onda ni FX: algo menos práctica
  return { score: Math.max(0, Math.min(1, score)), reasons: [k.label, b.label, eLabel].filter(Boolean) };
}

export class Assistant {
  constructor(app) {
    this.app = app;
    this.mode = app.settings.aiEnergyMode || 'keep';
    this.scores = new Map(); // id → { score, reasons }
  }

  // Deck de referencia: el último que suena, o el último cargado
  refDeck() {
    const decks = this.app.decks.filter(d => d.track);
    const playing = decks.filter(d => d.playing);
    return playing.length ? playing[playing.length - 1] : decks[decks.length - 1] || null;
  }

  candidates(exclude = new Set()) {
    return [...this.app.library.tracks.values()].filter(t => !exclude.has(t.id) && (t.bpm || t.camelot));
  }

  // Lista ordenada de sugerencias para la siguiente pista
  suggest(limit = 60) {
    const d = this.refDeck();
    this.scores.clear();
    if (!d) return [];
    const L = this.app.library;
    const exclude = new Set(this.app.decks.filter(x => x.track).map(x => x.track.id));
    for (const e of (L.session ? L.session.entries : [])) exclude.add(e.id);
    const from = d.track;
    const out = [];
    for (const t of this.candidates(exclude)) {
      const r = transitionScore(from, t, { refBpm: d.currentBpm || from.bpm, refKey: d.displayKey || from.camelot, mode: this.mode });
      this.scores.set(t.id, r);
      out.push(t);
    }
    out.sort((a, b) => this.scores.get(b.id).score - this.scores.get(a.id).score);
    return out.slice(0, limit);
  }
  setMode(m) { if (ENERGY_MODES[m]) { this.mode = m; this.app.setSetting('aiEnergyMode', m); } }

  // Constructor de sets: encadena pistas maximizando transiciones y siguiendo una curva de energía
  buildSet(start, count = 15, curve = 'up', pool = null) {
    const list = [start];
    const used = new Set([start.id]);
    const cands = (pool || this.candidates()).filter(t => t.id !== start.id);
    for (let i = 1; i < count; i++) {
      const prev = list[list.length - 1];
      const pos = i / Math.max(1, count - 1);
      const mode = curve === 'up' ? 'up' : curve === 'down' ? 'down' : curve === 'wave' ? (pos < 0.7 ? 'up' : 'down') : 'keep';
      let best = null, bestS = -1;
      for (const t of cands) {
        if (used.has(t.id)) continue;
        let { score } = transitionScore(prev, t, { mode: i % 3 === 0 || curve !== 'up' ? mode : 'keep' });
        if (t.artist && t.artist === prev.artist) score -= 0.08; // variedad
        // respetar la curva: no bajar energía al subir ni subirla al bajar
        if (prev.energy && t.energy) {
          if (mode === 'up' && t.energy < prev.energy) score -= 0.12 * (prev.energy - t.energy);
          if (mode === 'down' && t.energy > prev.energy) score -= 0.12 * (t.energy - prev.energy);
        }
        if (score > bestS) { bestS = score; best = t; }
      }
      if (!best || bestS < 0.5) break;
      list.push(best); used.add(best.id);
    }
    return list;
  }

  // Cues automáticos: rellena los hot cues libres con las secciones analizadas
  static AUTO_COLORS = { intro: CUE_COLORS[4], drop: CUE_COLORS[0], break: CUE_COLORS[6], outro: CUE_COLORS[1] };
  autoCues(track, { overwrite = false } = {}) {
    const secs = (track.sections || []).filter(s => s.t >= 0 && (!track.duration || s.t < track.duration - 4));
    if (!secs.length) return 0;
    const cues = overwrite ? Array(8).fill(null) : (track.cues || Array(8).fill(null)).slice();
    const existing = cues.filter(Boolean).map(c => c.t);
    let n = 0;
    for (const s of secs) {
      if (existing.some(t => Math.abs(t - s.t) < 2)) continue;
      const slot = cues.findIndex(c => !c);
      if (slot < 0) break;
      cues[slot] = { t: s.t, color: Assistant.AUTO_COLORS[s.type] || CUE_COLORS[slot], name: s.label, auto: true };
      existing.push(s.t); n++;
    }
    if (n || overwrite) this.app.library.update(track.id, { cues });
    return n;
  }
}
