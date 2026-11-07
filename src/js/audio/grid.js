// Beatgrid con marcadores (BPM variable). Sin marcadores la pista usa una rejilla fija
// { bpm, firstBeat }; con `track.grid = [{t, bpm}, ...]` (ordenado, ≥ 2 marcas) cada tramo usa su
// BPM hasta la marca siguiente. Entre marcas siempre cabe un número entero de beats (como en las
// cabinas profesionales): al mover o añadir una marca se reajusta el BPM del tramo anterior.

export function markers(track) {
  if (!track || !track.bpm) return [];
  if (Array.isArray(track.grid) && track.grid.length >= 2) return track.grid;
  return [{ t: track.firstBeat || 0, bpm: track.bpm }];
}

// beats acumulados al inicio de cada marca (enteros salvo el primero, que es 0)
function cumBeats(g) {
  const B = [0];
  for (let i = 1; i < g.length; i++) B.push(B[i - 1] + Math.round((g[i].t - g[i - 1].t) * g[i - 1].bpm / 60));
  return B;
}

function segAt(g, t) { let i = 0; while (i + 1 < g.length && g[i + 1].t <= t) i++; return i; }

export function beatAt(track, t) {
  const g = markers(track); if (!g.length) return 0;
  if (g.length === 1) return (t - g[0].t) * g[0].bpm / 60;
  const B = cumBeats(g), i = segAt(g, t);
  return B[i] + (t - g[i].t) * g[i].bpm / 60;
}

export function beatTime(track, b) {
  const g = markers(track); if (!g.length) return 0;
  if (g.length === 1) return g[0].t + b * 60 / g[0].bpm;
  const B = cumBeats(g);
  let i = 0; while (i + 1 < g.length && B[i + 1] <= b) i++;
  return g[i].t + (b - B[i]) * 60 / g[i].bpm;
}

export function bpmAt(track, t) {
  const g = markers(track); if (!g.length) return 0;
  return g[segAt(g, t)].bpm;
}

export function markerIndexAt(track, t) { const g = markers(track); return g.length ? segAt(g, t) : -1; }

// Ajusta los BPM para que entre marcas quepa un número entero de beats y quita marcas duplicadas
export function normalize(grid) {
  const g = grid.filter(m => m && isFinite(m.t) && m.bpm > 20).sort((a, b) => a.t - b.t);
  const out = [];
  for (const m of g) {
    const prev = out[out.length - 1];
    if (prev && m.t - prev.t < 60 / prev.bpm * 0.75) continue; // menos de un beat: se descarta
    out.push({ t: m.t, bpm: m.bpm });
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const span = out[i + 1].t - out[i].t;
    const n = Math.max(1, Math.round(span * out[i].bpm / 60));
    out[i].bpm = Math.round(60 * n / span * 1000) / 1000;
  }
  return out;
}

// BPM dominante (el que más dura) para la biblioteca, el asistente y la ordenación
export function dominantBpm(grid, duration) {
  const w = new Map();
  grid.forEach((m, i) => {
    const end = i + 1 < grid.length ? grid[i + 1].t : Math.max(m.t + 1, duration || m.t + 1);
    const k = Math.round(m.bpm * 10) / 10;
    w.set(k, (w.get(k) || 0) + (end - m.t));
  });
  let best = grid[0].bpm, bw = -1;
  for (const [k, v] of w) if (v > bw) { bw = v; best = k; }
  return best;
}

// Campos a guardar en la pista para una rejilla dada
export function gridUpdate(grid, duration) {
  const g = normalize(grid);
  if (g.length <= 1) return { grid: null, bpm: g[0] ? Math.round(g[0].bpm * 100) / 100 : undefined, firstBeat: g[0] ? g[0].t : 0, bpmLocked: true };
  return { grid: g, bpm: dominantBpm(g, duration), firstBeat: g[0].t, bpmLocked: true };
}
