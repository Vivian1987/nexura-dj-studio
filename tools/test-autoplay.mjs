// Pruebas en Node del Autoplay sobre un crate (cola, orden, barajado, repetición, saltos):
// node tools/test-autoplay.mjs
import assert from 'node:assert/strict';

// entorno mínimo para importar library.js (usa platform.js → window / localStorage)
const store = new Map();
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

const C = await import('../src/js/ai/autoplay-core.js');
const { Library } = await import('../src/js/library/library.js');
const { AutoplayQueue, shuffle, transitionStart, fadeLevels, autoplayOptions, autoplayLabel } = C;

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('✓', name); };
// generador pseudoaleatorio reproducible (mulberry32)
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const take = (q, k) => Array.from({ length: k }, () => q.next());
const IDS = ['a', 'b', 'c', 'd', 'e'];

await test('Orden de la lista: el de la tabla, empezando por la seleccionada y con repetición desde el principio', () => {
  const q = new AutoplayQueue(IDS, { order: 'list', startId: 'c' });
  assert.deepEqual(take(q, 8), ['c', 'd', 'e', 'a', 'b', 'c', 'd', 'e']);
  const q2 = new AutoplayQueue(IDS, { order: 'list' });
  assert.equal(q2.peek(), 'a');
  assert.equal(q2.index, 0);
  assert.equal(q2.next(), 'a');
  assert.equal(q2.index, 1);
  assert.equal(q2.total, 5);
  // seleccionada que no está en la lista → desde la primera
  assert.equal(new AutoplayQueue(IDS, { startId: 'zz' }).next(), 'a');
});

await test('Orden de la tabla real: sigue la columna ordenada y su dirección (y el orden del crate sin orden)', () => {
  const lib = new Library();
  const ts = lib.addFiles([['Zeta', 128], ['Alfa', 122], ['Mu', 125], ['Beta', 130]].map(([title, bpm], i) => ({ path: `E:\\${title}.mp3`, title, bpm, artist: 'X' + i })));
  ts.forEach((t, i) => lib.update(t.id, { bpm: [128, 122, 125, 130][i] }));
  const c = lib.createCrate('Dance');
  lib.addToCrate(c.id, ts.map(t => t.id));
  const order = (sort) => { const q = new AutoplayQueue(lib.query('crate:' + c.id, '', sort).map(t => t.id), { repeat: false }); const out = []; let id; while ((id = q.next())) out.push(lib.get(id).title); return out; };
  assert.deepEqual(order({ field: null, dir: 1 }), ['Zeta', 'Alfa', 'Mu', 'Beta']);
  assert.deepEqual(order({ field: 'title', dir: 1 }), ['Alfa', 'Beta', 'Mu', 'Zeta']);
  assert.deepEqual(order({ field: 'bpm', dir: -1 }), ['Beta', 'Zeta', 'Mu', 'Alfa']);
  // un subcrate: con «mostrar pistas de los subcrates» el padre las incluye
  const sub = lib.createCrate('Años 80', c.id);
  const [x] = lib.addFiles([{ path: 'E:\\Extra.mp3', title: 'Extra' }]);
  lib.addToCrate(sub.id, [x.id]);
  assert.ok(lib.query('crate:' + c.id, '', null).some(t => t.id === x.id));
});

await test('Aleatorio: Fisher-Yates sin repetir hasta agotar la lista, y nunca la misma dos veces seguidas al volver a empezar', () => {
  for (let seed = 1; seed <= 300; seed++) {
    const q = new AutoplayQueue(IDS, { order: 'shuffle', rng: rng(seed) });
    const run = take(q, 15);
    for (let k = 0; k < 3; k++) assert.deepEqual([...run.slice(k * 5, k * 5 + 5)].sort(), IDS, 'cada vuelta tiene todas las pistas una vez');
    for (let i = 1; i < run.length; i++) assert.notEqual(run[i], run[i - 1], 'sin repetición seguida (semilla ' + seed + ')');
  }
  // reparto uniforme aproximado de la primera pista
  const first = {};
  for (let s = 1; s <= 5000; s++) { const id = shuffle(IDS, rng(s))[0]; first[id] = (first[id] || 0) + 1; }
  for (const id of IDS) assert.ok(first[id] > 850 && first[id] < 1150, `primera = ${id}: ${first[id]}`);
  // shuffle no modifica la lista original
  const src = IDS.slice(); shuffle(src); assert.deepEqual(src, IDS);
});

await test('peek() anuncia exactamente la que dará next(), también al cambiar de vuelta barajada', () => {
  const q = new AutoplayQueue(IDS, { order: 'shuffle', rng: rng(7) });
  for (let i = 0; i < 23; i++) { const p = q.peek(); assert.equal(q.next(), p); }
  assert.equal(q.cycle, 4);
});

await test('Sin «Repetir al terminar» la cola acaba; con «Repetir» sigue', () => {
  const q = new AutoplayQueue(['a', 'b', 'c'], { repeat: false });
  assert.deepEqual(take(q, 4), ['a', 'b', 'c', null]);
  assert.equal(q.peek(), null);
  const r = new AutoplayQueue(['a', 'b', 'c'], { repeat: false, startId: 'b' });
  assert.deepEqual(take(r, 3), ['b', 'c', null]);
  const s = new AutoplayQueue(['a', 'b', 'c'], { repeat: false, order: 'shuffle', rng: rng(3) });
  const got = take(s, 4);
  assert.equal(got[3], null); assert.deepEqual(got.slice(0, 3).sort(), ['a', 'b', 'c']);
  // activar «Repetir» a mitad sigue dando pistas
  const t = new AutoplayQueue(['a', 'b'], { repeat: false });
  t.next(); t.next(); t.repeat = true;
  assert.equal(t.next(), 'a');
});

await test('Saltar las ya tocadas: se saltan las tocadas antes de empezar, la repetición sigue funcionando', () => {
  const q = new AutoplayQueue(IDS, { skip: new Set(['b', 'd']) });
  assert.deepEqual(take(q, 6), ['a', 'c', 'e', 'a', 'c', 'e']);
  assert.equal(q.available, 3);
  const all = new AutoplayQueue(['a', 'b'], { skip: ['a', 'b'] });
  assert.equal(all.available, 0);
  assert.equal(all.next(), null);
  // la seleccionada ya tocada → empieza por la siguiente sin tocar
  assert.equal(new AutoplayQueue(IDS, { startId: 'b', skip: ['b'] }).next(), 'c');
});

await test('Pistas que fallan al cargar: se saltan siempre; si fallan todas, la cola se vacía', () => {
  const q = new AutoplayQueue(IDS);
  assert.equal(q.next(), 'a');
  assert.equal(q.next(), 'b'); q.fail('b');
  assert.equal(q.next(), 'c'); q.fail('c');
  assert.deepEqual(take(q, 5), ['d', 'e', 'a', 'd', 'e']);
  for (const id of IDS) q.fail(id);
  assert.equal(q.next(), null);
  // una sola pista válida con repetición: se repite (no hay otra)
  const one = new AutoplayQueue(['a', 'b'], { skip: ['b'] });
  assert.deepEqual(take(one, 3), ['a', 'a', 'a']);
  // lista vacía y duplicados
  assert.equal(new AutoplayQueue([]).next(), null);
  assert.equal(new AutoplayQueue(['a', 'a', 'b']).total, 2);
});

await test('Momento de la transición y niveles del fundido', () => {
  assert.equal(transitionStart('fade', 200, { fadeSecs: 5 }), 195);
  assert.equal(transitionStart('fade', 200, { fadeSecs: 5, tempo: 1.1 }), 200 - 5.5);
  assert.equal(transitionStart('fade', 200, { fadeSecs: 40 }), 188);   // máximo 12 s
  assert.equal(transitionStart('fade', 200, { fadeSecs: 0 }), 195);    // valor no válido → 5 s
  assert.ok(Math.abs(transitionStart('gapless', 200) - 199.85) < 1e-9);
  assert.equal(transitionStart('fade', 3, { fadeSecs: 5 }), 1);        // pista corta: nunca antes del 1 s / mitad
  assert.equal(transitionStart('fade', 0), Infinity);
  assert.deepEqual(fadeLevels(0), { from: 1, to: 0 });
  assert.deepEqual(fadeLevels(1), { from: 0, to: 1 });
  assert.deepEqual(fadeLevels(0.5), { from: 0.75, to: 0.75 });         // sin bajón en el centro
  for (let p = 0; p <= 1; p += 0.05) { const l = fadeLevels(p); assert.ok(l.from + l.to >= 1 - 1e-9); }
});

await test('Opciones guardadas saneadas y texto del indicador', () => {
  assert.deepEqual(autoplayOptions(), { order: 'list', transition: 'fade', fadeSecs: 5, repeat: true, skipPlayed: false });
  assert.deepEqual(autoplayOptions({ order: 'x', transition: 'sync', fadeSecs: '30', repeat: false, skipPlayed: 1 }), { order: 'list', transition: 'sync', fadeSecs: 12, repeat: false, skipPlayed: true });
  assert.equal(autoplayOptions({ fadeSecs: 0.4 }).fadeSecs, 1);
  assert.equal(autoplayLabel({ source: 'Dance › Años 80', index: 3, total: 120, next: 'A – B' }), 'AUTOPLAY · Dance › Años 80 · 3/120 · siguiente: A – B');
  assert.equal(autoplayLabel({ source: 'Prepare' }), 'AUTOPLAY · Prepare');
});

console.log(`\n${n} pruebas del Autoplay superadas`);
