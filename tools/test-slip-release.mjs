// Simula el worklet del deck en Node y mide el salto de muestra al soltar el slip: node tools/test-slip-release.mjs
import assert from 'node:assert/strict';

globalThis.sampleRate = 48000;
let Proc = null;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };
globalThis.registerProcessor = (_n, cls) => { Proc = cls; };
await import('../src/js/audio/worklets/deck-processor.js');

function run(releaseS) {
  const p = new Proc();
  const sr = sampleRate, len = sr * 10, L = new Float32Array(len);
  for (let i = 0; i < len; i++) L[i] = Math.sin(2 * Math.PI * 220 * i / sr) * (0.5 + 0.4 * Math.sin(i / sr * 3)); // tono con envolvente
  const msg = (m) => p.onMsg(m);
  msg({ t: 'load', L, R: L, sr });
  msg({ t: 'motor', start: 0.002, stop: 0.002 });
  msg({ t: 'slipRelease', v: releaseS });
  msg({ t: 'play', v: true });
  const out = [new Float32Array(128), new Float32Array(128)], all = [];
  const block = () => { p.process([], [out]); all.push(...out[0]); };
  for (let i = 0; i < 100; i++) block();
  // slip + loop de 1/8 de segundo (como un roll) y soltar
  msg({ t: 'slipBegin' });
  msg({ t: 'loop', on: true, s: p.pos, e: p.pos + sr * 0.123 });
  for (let i = 0; i < 300; i++) block();
  msg({ t: 'loop', on: false });
  const at = all.length;
  msg({ t: 'slipEnd' });
  for (let i = 0; i < 100; i++) block();
  // mayor diferencia entre muestras consecutivas alrededor del retorno
  let jump = 0;
  for (let i = at - 2; i < at + Math.max(2, releaseS * sr) + 4 && i < all.length; i++) jump = Math.max(jump, Math.abs(all[i + 1] - all[i]));
  return { jump, pos: p.pos, xf: p.xfN };
}
const hard = run(0), soft = run(0.08);
const step = 2 * Math.PI * 220 / sampleRate; // paso máximo del tono sin cortes ≈ 0,029
console.log(`salto inmediato: ${hard.jump.toFixed(3)} · retorno de 80 ms: ${soft.jump.toFixed(3)} (pendiente natural del tono ≈ ${step.toFixed(3)})`);
assert.ok(hard.jump > 0.1, 'sin retorno se espera un corte');
assert.ok(soft.jump < step * 1.6, 'con retorno no debe haber corte');
assert.ok(Math.abs(hard.pos - soft.pos) < 2, 'las dos acaban en la posición sombra');
assert.equal(soft.xf, 0);
console.log('✓ retorno del slip sin clic y en la misma posición final');
