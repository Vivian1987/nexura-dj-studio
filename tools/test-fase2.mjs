// Pruebas de la fase 2 en Node: node tools/test-fase2.mjs
// Grid variable (inversas, edición), detección de tramos de tempo con señales sintéticas,
// enrutado de Stems FX y el worklet del deck (envío de stems y Stem Slip).
import assert from 'node:assert/strict';
import * as Grid from '../src/js/audio/grid.js';
import { analyze, tempoSegments } from '../src/js/analysis/analysis-core.js';
import { planFxRouting } from '../src/js/audio/fx-routing.js';
import { synth, beatsFromTempo, SR } from './test-grid-synth.mjs';

let n = 0;
const ok = (msg) => { n++; console.log('✓', msg); };

// ------------------------------------------------------------------ 1. grid variable: inversas exactas
{
  const tr = { bpm: 124, firstBeat: 0.31, grid: Grid.normalize([{ t: 0.31, bpm: 120 }, { t: 32.31, bpm: 126 }, { t: 70.4, bpm: 123.5 }, { t: 120, bpm: 128 }]) };
  let worst = 0;
  for (let b = -16; b < 400; b += 0.37) worst = Math.max(worst, Math.abs(Grid.beatAt(tr, Grid.beatTime(tr, b)) - b));
  for (let t = 0; t < 200; t += 0.173) worst = Math.max(worst, Math.abs(Grid.beatTime(tr, Grid.beatAt(tr, t)) - t));
  assert.ok(worst < 1e-9, 'inversas: ' + worst);
  const mb = Grid.markersWithBeats(tr);
  mb.forEach(m => { assert.ok(Number.isInteger(m.beat)); assert.ok(Math.abs(Grid.beatTime(tr, m.beat) - m.t) < 1e-9); });
  ok(`beatAt/beatTime inversos (error máx. ${worst.toExponential(1)}) y marcas {beat, t, bpm} con beats enteros`);
  // pista antigua sin marcas = un único marcador
  const old = { bpm: 128, firstBeat: 0.2 };
  assert.equal(Grid.markers(old).length, 1);
  assert.equal(Grid.markersWithBeats(old)[0].beat, 0);
  assert.ok(Math.abs(Grid.beatTime(old, 8) - (0.2 + 8 * 60 / 128)) < 1e-12);
  ok('pista antigua {bpm, firstBeat} = un marcador, mismo resultado que antes');
  // beatSpan sigue los tramos
  const span = Grid.beatSpan(tr, 30, 8); // empieza a 120 y cruza a 126
  const expect = Grid.beatTime(tr, Grid.beatAt(tr, 30) + 8) - 30;
  assert.ok(Math.abs(span - expect) < 1e-12 && Math.abs(span - 8 * 0.5) > 0.01);
  ok(`beatSpan: 8 beats desde 30 s = ${span.toFixed(4)} s (cruza el cambio de tempo; con BPM fijo serían 4,0000 s)`);
}

// ------------------------------------------------------------------ 2. edición del grid
{
  const fixed = { bpm: 124, firstBeat: 0.5 };
  // «Beat aquí» lejos de la marca: cambia el BPM del tramo para que el beat 64 caiga 30 ms más tarde
  const b64 = Grid.beatTime(fixed, 64);
  const g1 = Grid.gridUpdate(Grid.editBeatHere(fixed, b64 + 0.03), 300);
  const t1 = { ...fixed, ...g1 };
  assert.ok(Math.abs(Grid.beatTime(t1, 64) - (b64 + 0.03)) < 1e-3, 'beat aquí');
  assert.ok(Math.abs(Grid.beatTime(t1, 0) - 0.5) < 1e-9, 'el inicio no se mueve');
  ok(`«Beat aquí»: el beat 64 pasa a ${(b64 + 0.03).toFixed(3)} s (BPM ${t1.bpm})`);
  // «Beat aquí» cerca de la marca: se desplaza la marca
  const g2 = Grid.editBeatHere(fixed, 0.5 + 60 / 124 + 0.012);
  assert.ok(Math.abs(g2[0].t - 0.512) < 1e-9 && g2[0].bpm === 124);
  ok('«Beat aquí» junto a la marca: la marca se desplaza (12 ms), el BPM no cambia');
  // «Inicio del grid aquí»
  const g3 = Grid.editStartHere(fixed, 10.123);
  assert.equal(g3.length, 1); assert.equal(g3[0].t, 10.123);
  ok('«Inicio del grid aquí»: primer beat en la posición actual');
  // «Compás aquí»: el BPM se mantiene y 10 s pasa a ser primer tiempo
  const t4 = { ...fixed, ...Grid.gridUpdate(Grid.editBarHere(fixed, 10), 300) };
  const b = Grid.beatAt(t4, 10);
  assert.ok(Math.abs(b - Math.round(b)) < 1e-9 && Math.round(b) % 4 === 0 && t4.bpm === 124);
  ok('«Compás aquí»: el instante elegido cae en un primer tiempo de compás');
  // «Cambio de BPM aquí» (compás) en una pista fija: dos tramos, el primero intacto
  const t5 = { ...fixed, ...Grid.gridUpdate(Grid.editTempoChange(fixed, 60.2, 126, 'bar'), 300) };
  assert.equal(t5.grid.length, 2);
  assert.equal(t5.grid[0].bpm, 124); assert.equal(t5.grid[1].bpm, 126);
  const bb = Grid.beatAt(t5, t5.grid[1].t);
  assert.ok(Math.abs(bb - Math.round(bb)) < 1e-9 && Math.round(bb) % 4 === 0, 'cae en un compás');
  assert.equal(Grid.tempoChanges(t5).length, 1);
  ok(`«Cambio de BPM aquí»: tramo nuevo de 126 BPM desde ${t5.grid[1].t.toFixed(3)} s (compás ${Math.round(bb) / 4}); el anterior sigue a 124`);
  // en una pista con marcas, el cambio en un tramo intermedio desplaza las siguientes conservando beats
  const multi = { bpm: 120, firstBeat: 0, grid: Grid.normalize([{ t: 0, bpm: 120 }, { t: 64, bpm: 120 }, { t: 128, bpm: 124 }]) };
  const before = Grid.markersWithBeats(multi).map(m => m.beat);
  const t6 = { ...multi, ...Grid.gridUpdate(Grid.editTempoChange(multi, 32, 122, 'beat'), 300) };
  const after = Grid.markersWithBeats(t6);
  assert.ok(Math.abs(after.find(m => Math.abs(m.bpm - 122) < 1e-6).t - 32) < 1e-9);
  assert.deepEqual(after.filter(m => m.bpm !== 122).slice(1).map(m => m.beat), before.slice(1));
  ok('«Cambio de BPM aquí» a nivel de beat en un tramo intermedio: las marcas siguientes conservan sus beats');
}

// ------------------------------------------------------------------ 3. tramos de tempo (regresión por tramos)
{
  const fps = 86.13;
  const mk = (bpmFn, nb, jitter = 0) => { const t = []; let x = 0.3, s = 7; for (let i = 0; i < nb; i++) { s = (s * 16807) % 2147483647; t.push(x + jitter * ((s / 2147483647) - 0.5)); x += 60 / bpmFn(i); } return t; };
  assert.equal(tempoSegments(mk(() => 124, 360, 0.006)), null);
  const seg = tempoSegments(mk(i => (i < 180 ? 120 : 126), 360, 0.004));
  assert.equal(seg.length, 2); assert.equal(seg[1].i, 180);
  ok(`tempoSegments: tempo fijo con temblor ±3 ms → rejilla única; salto en el beat 180 → corte exacto (${seg.map(s => s.bpm).join(' → ')})`);
  void fps;
}

// ------------------------------------------------------------------ 4. análisis completo con audio sintético (180 s)
const dur = 180;
function check(name, fn, opts = {}) {
  const beats = beatsFromTempo(fn, dur);
  let x = synth(beats, dur);
  if (opts.breakFrom != null) { // break sin bombo ni charles (solo el acorde)
    const a = Math.round(opts.breakFrom * SR), z = Math.round(opts.breakTo * SR);
    for (let i = a; i < z; i++) x[i] = 0.05 * Math.sin(2 * Math.PI * 220 * i / SR) + 0.04 * Math.sin(2 * Math.PI * 277 * i / SR);
  }
  const r = analyze(x, SR);
  const tr = r.grid && r.grid.length > 1 ? { bpm: r.bpm, firstBeat: r.firstBeat, ...Grid.gridUpdate(r.grid, dur) } : { bpm: r.bpm, firstBeat: r.firstBeat };
  const errs = beats.filter(b => opts.breakFrom == null || b < opts.breakFrom || b > opts.breakTo)
    .map(b => { const v = Grid.beatAt(tr, b); return Math.abs(v - Math.round(v)) * 60 / Grid.bpmAt(tr, b) * 1000; }).sort((a, b) => a - b);
  return { tr, marks: tr.grid ? tr.grid.length : 1, med: errs[errs.length >> 1], max: errs[errs.length - 1] };
}
{
  const r = check('fijo', () => 124);
  assert.equal(r.marks, 1); assert.ok(Math.abs(r.tr.bpm - 124) < 0.05);
  ok(`tema fijo a 124 → 1 marcador, ${r.tr.bpm} BPM (error ${Math.abs(r.tr.bpm - 124).toFixed(3)} < 0,05), error de rejilla mediano ${r.med.toFixed(1)} ms`);
}
{
  const r = check('break', () => 124, { breakFrom: 60, breakTo: 92 });
  assert.equal(r.marks, 1); assert.ok(Math.abs(r.tr.bpm - 124) < 0.05);
  ok(`tema fijo a 124 con un break de 16 compases sin percusión → sigue siendo 1 marcador (error mediano ${r.med.toFixed(1)} ms)`);
}
{
  const r = check('salto', (t) => (t < 90 ? 120 : 126));
  const g = r.tr.grid;
  assert.ok(g && g.length === 2, 'dos tramos: ' + JSON.stringify(g));
  assert.ok(Math.abs(g[0].bpm - 120) < 0.05 && Math.abs(g[1].bpm - 126) < 0.05);
  assert.ok(Math.abs(g[1].t - 90) < 0.3, 'cambio en ~90 s');
  assert.ok(r.max < 10);
  ok(`salto 120 → 126 a mitad → marcas ${g.map(m => `${m.t.toFixed(2)} s·${m.bpm}`).join(', ')}; error máx. ${r.max.toFixed(1)} ms`);
}
{
  const r = check('leve', (t) => (t < 90 ? 124 : 124.6));
  assert.ok(r.marks === 2 && Math.abs(r.tr.grid[1].bpm - 124.6) < 0.05);
  ok(`cambio pequeño 124 → 124,6 (> 0,5 BPM sostenido) → 2 tramos (${r.tr.grid.map(m => m.bpm).join(' → ')}), error máx. ${r.max.toFixed(1)} ms`);
}
{
  const r = check('rampa', (t) => 118 + 8 * t / dur);
  assert.ok(r.marks > 3 && r.med < 6 && r.max < 25, JSON.stringify(r));
  ok(`rampa suave 118 → 126 → ${r.marks} marcas, error mediano ${r.med.toFixed(1)} ms, máx. ${r.max.toFixed(1)} ms`);
}

// ------------------------------------------------------------------ 5. enrutado de Stems FX
{
  const units = [{ idx: 0, target: 'deck0' }, { idx: 1, target: 'master' }];
  const decks = [0, 1, 2, 3].map(i => ({ idx: i, stemsOn: false, stemFx: [false, false, false, false], stemFxUnit: i % 2 }));
  let p = planFxRouting(units, decks);
  assert.deepEqual(p.deck[0].map(u => u.idx), [0]); assert.deepEqual(p.master.map(u => u.idx), [1]);
  assert.deepEqual(p.sends[0], [0, 0, 0, 0]);
  decks[0].stemsOn = true; decks[0].stemFx = [true, false, false, true];
  p = planFxRouting(units, decks);
  assert.deepEqual(p.deck[0], []); assert.deepEqual(p.stem[0].map(u => u.idx), [0]);
  assert.deepEqual(p.sends[0], [1, 0, 0, 1]);
  decks[1].stemsOn = true; decks[1].stemFx = [false, true, false, false]; decks[1].stemFxUnit = 0; // misma unidad: gana el primero
  p = planFxRouting(units, decks);
  assert.deepEqual(p.sends[1], [0, 0, 0, 0]); assert.deepEqual(p.stem[1], []);
  decks[0].stemsOn = false; // sin stems cargados no se envía nada y la unidad vuelve a su destino
  p = planFxRouting(units, decks);
  assert.deepEqual(p.sends[0], [0, 0, 0, 0]); assert.deepEqual(p.stem[1].map(u => u.idx), [0]);
  ok('planFxRouting: unidad en la cadena del deck, solo en los stems elegidos, conflicto entre decks y pista sin stems');
}

// ------------------------------------------------------------------ 6. worklet del deck: envío de stems y Stem Slip
{
  globalThis.sampleRate = 48000;
  let Proc = null;
  globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
  globalThis.registerProcessor = (name, cls) => { if (name === 'nexura-deck') Proc = cls; };
  await import('../src/js/audio/worklets/deck-processor.js');
  const sr = 48000, len = sr * 4;
  const tone = (f, a) => { const x = new Int16Array(len); for (let i = 0; i < len; i++) x[i] = Math.round(32767 * a * Math.sin(2 * Math.PI * f * i / sr)); return x; };
  const freqs = [440, 110, 55, 880];
  const stems = freqs.map((f, k) => { const L = tone(f, 0.2); return { L, R: L }; });
  const p = new Proc();
  const L = new Float32Array(len);
  p.onMsg({ t: 'load', L, R: L, sr });
  p.onMsg({ t: 'motor', start: 0.002, stop: 0.002 });
  p.onMsg({ t: 'stems', stems, gains: [1, 1, 1, 1] });
  p.onMsg({ t: 'play', v: true });
  const o0 = [new Float32Array(128), new Float32Array(128)], o1 = [new Float32Array(128), new Float32Array(128)];
  const run = (blocks) => { const a = [], b = []; for (let i = 0; i < blocks; i++) { p.process([], [o0, o1]); a.push(...o0[0]); b.push(...o1[0]); } return [a, b]; };
  const corr = (x, f, off) => { let s = 0, e = 0; for (let i = 0; i < x.length; i++) { const r = Math.sin(2 * Math.PI * f * (off + i) / sr); s += x[i] * r; e += r * r; } return s / e; };
  run(40);
  p.onMsg({ t: 'stemSend', v: [1, 0, 0, 0] }); // voz → FX
  run(40); // fundido de ~10 ms
  const start = Math.round(p.pos);
  const [a, b] = run(20);
  const vMain = corr(a, 440, start), vSend = corr(b, 440, start), bassMain = corr(a, 110, start), bassSend = corr(b, 110, start);
  assert.ok(Math.abs(vMain) < 0.01 && Math.abs(vSend - 0.2) < 0.01, `voz principal ${vMain} / envío ${vSend}`);
  assert.ok(Math.abs(bassMain - 0.2) < 0.01 && Math.abs(bassSend) < 0.01);
  ok(`Stems FX en el worklet: la voz sale solo por la salida 2 (${vSend.toFixed(3)}), el bajo solo por la principal (${bassMain.toFixed(3)})`);
  // la suma de las dos salidas es la mezcla completa (con el envío no se pierde ni se duplica nada)
  p.onMsg({ t: 'stemSend', v: [0, 0, 0, 0] }); run(60);
  // Stem Slip en loop: la batería (110 Hz) repite 1/10 s; al soltar vuelve a su posición real
  const s0 = p.pos;
  p.onMsg({ t: 'stemHold', k: 1, on: true, s: s0, len: sr * 0.1 });
  run(200);
  let maxJump = 0;
  p.onMsg({ t: 'stemHold', k: 1, on: false });
  const [c] = run(75); // ventana larga: las otras notas apenas se cuelan en la correlación
  for (let i = 1; i < c.length; i++) maxJump = Math.max(maxJump, Math.abs(c[i] - c[i - 1]));
  const off2 = Math.round(p.pos) - c.length + 0;
  const back = corr(c.slice(400), 110, off2 + 400);
  assert.ok(Math.abs(back - 0.2) < 0.02, 'la batería vuelve en fase con la pista: ' + back);
  assert.ok(maxJump < 0.06, 'sin clic al soltar: ' + maxJump);
  assert.deepEqual([...p.hEnv], [1, 1, 1, 1]);
  ok(`Stem Slip (loop): al soltar la batería vuelve en su sitio (correlación ${back.toFixed(3)}) sin clic (salto máx. ${maxJump.toFixed(3)})`);
  // un deck cargado sin stems con envío pedido: la salida 2 queda en silencio y no falla
  const q = new Proc();
  q.onMsg({ t: 'load', L: new Float32Array(len).fill(0.1), sr }); q.onMsg({ t: 'play', v: true }); q.onMsg({ t: 'stemSend', v: [1, 1, 1, 1] });
  for (let i = 0; i < 10; i++) q.process([], [o0, o1]);
  assert.ok(o1[0].every(v => v === 0) && o0[0].some(v => v !== 0));
  ok('sin stems: el envío a FX se ignora (salida 2 en silencio) y el deck suena normal');
}

console.log(`\n${n} pruebas superadas`);
