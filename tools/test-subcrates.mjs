// Pruebas en Node de los subcrates (crates anidados): node tools/test-subcrates.mjs
import assert from 'node:assert/strict';

// entorno mínimo para importar library.js (usa platform.js → window / localStorage)
const store = new Map();
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

const T = await import('../src/js/library/crate-tree.js');
const { Library } = await import('../src/js/library/library.js');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('✓', name); };
const names = (list) => list.map(x => (x.c || x).name);

// Dance › 2024 / 2025 / Tech House › Peak time · Techno (raíz)
const tree = () => [
  { id: 'd', name: 'Dance', ids: ['t1'], color: '#ff3b47', created: 1 },
  { id: 'y5', name: '2025', ids: ['t3'], parent: 'd', created: 3 },
  { id: 'y4', name: '2024', ids: ['t2', 't1'], parent: 'd', created: 2 },
  { id: 'th', name: 'Tech House', ids: ['t4'], parent: 'd', created: 4, color: '#3b82ff' },
  { id: 'pt', name: 'Peak time', ids: ['t5', 't2'], parent: 'th', created: 5 },
  { id: 'tk', name: 'Techno', ids: ['t6'], created: 6 }
];

// ------------------------------------------------------------------ árbol puro
await test('Árbol: hijas, descendientes, ruta y aplanado con sangría', () => {
  const c = tree();
  assert.deepEqual(names(T.childrenOf(c, null)), ['Dance', 'Techno']);
  assert.deepEqual(names(T.childrenOf(c, 'd')), ['2025', '2024', 'Tech House']);
  assert.deepEqual(T.descendantIds(c, 'd'), ['y5', 'y4', 'th', 'pt']);
  assert.deepEqual(T.descendantIds(c, 'pt'), []);
  assert.equal(T.pathLabel(c, 'pt'), 'Dance › Tech House › Peak time');
  const flat = T.flattenTree(c, 'custom');
  assert.deepEqual(flat.map(x => `${x.depth}:${x.c.name}`), ['0:Dance', '1:2025', '1:2024', '1:Tech House', '2:Peak time', '0:Techno']);
  assert.deepEqual(flat.filter(x => x.hasKids).map(x => x.c.id), ['d', 'th']);
});
await test('Árbol: orden alfabético y por fecha dentro de cada nivel', () => {
  const c = tree();
  assert.deepEqual(names(T.flattenTree(c, 'alpha')), ['Dance', '2024', '2025', 'Tech House', 'Peak time', 'Techno']);
  assert.deepEqual(names(T.flattenTree(c, 'created')), ['Dance', '2024', '2025', 'Tech House', 'Peak time', 'Techno']);
});
await test('Árbol: plegar oculta las hijas (salvo en menús con all)', () => {
  const c = tree();
  const fold = T.flattenTree(c, 'custom', ['th']);
  assert.deepEqual(names(fold), ['Dance', '2025', '2024', 'Tech House', 'Techno']);
  assert.equal(fold.find(x => x.c.id === 'th').open, false);
  assert.deepEqual(names(T.flattenTree(c, 'custom', ['d'])), ['Dance', 'Techno']);
  assert.equal(T.flattenTree(c, 'custom', ['d'], true).length, 6);
});
await test('Profundidad: 6 niveles', () => {
  const c = [{ id: 'a0', name: 'L0', ids: [] }];
  for (let i = 1; i < 6; i++) c.push({ id: 'a' + i, name: 'L' + i, ids: ['x' + i], parent: 'a' + (i - 1) });
  assert.equal(T.flattenTree(c).at(-1).depth, 5);
  assert.equal(T.pathLabel(c, 'a5'), 'L0 › L1 › L2 › L3 › L4 › L5');
  assert.deepEqual(T.crateTrackIds(c, 'a0'), ['x1', 'x2', 'x3', 'x4', 'x5']);
});
await test('Mover sin ciclos: ni dentro de sí misma ni de un descendiente', () => {
  const c = tree();
  assert.equal(T.canMoveInto(c, 'd', 'd'), false);
  assert.equal(T.canMoveInto(c, 'd', 'pt'), false);
  assert.equal(T.canMoveInto(c, 'th', 'pt'), false);
  assert.equal(T.canMoveInto(c, 'pt', 'tk'), true);
  assert.equal(T.canMoveInto(c, 'pt', null), true);
  assert.equal(T.canMoveInto(c, 'pt', 'no-existe'), false);
});
await test('Pistas con descendientes sin duplicar (y solo las propias sin el ajuste)', () => {
  const c = tree();
  assert.deepEqual(T.crateTrackIds(c, 'd'), ['t1', 't3', 't2', 't4', 't5']);
  assert.deepEqual(T.crateTrackIds(c, 'd', false), ['t1']);
  assert.deepEqual(T.crateTrackIds(c, 'th'), ['t4', 't5', 't2']);
  assert.deepEqual(T.crateTrackIds(c, 'nada'), []);
});
await test('Borrar con hijos: todo el subárbol o subirlos un nivel (en su sitio)', () => {
  let r = T.deletePlan(tree(), 'th', 'all');
  assert.deepEqual(r.removed, ['th', 'pt']);
  assert.deepEqual(names(T.flattenTree(r.crates)), ['Dance', '2025', '2024', 'Techno']);
  r = T.deletePlan(tree(), 'th', 'lift');
  assert.deepEqual(r.removed, ['th']);
  assert.deepEqual(T.flattenTree(r.crates).map(x => `${x.depth}:${x.c.name}`), ['0:Dance', '1:2025', '1:2024', '1:Peak time', '0:Techno']);
  r = T.deletePlan(tree(), 'd', 'lift');
  assert.deepEqual(T.flattenTree(r.crates).map(x => `${x.depth}:${x.c.name}`), ['0:2025', '0:2024', '0:Tech House', '1:Peak time', '0:Techno']);
});
await test('Color heredado del antepasado más cercano', () => {
  const c = tree();
  assert.deepEqual(T.effectiveColor(c, 'y4'), { color: '#ff3b47', inherited: true });
  assert.deepEqual(T.effectiveColor(c, 'pt'), { color: '#3b82ff', inherited: true });
  assert.deepEqual(T.effectiveColor(c, 'th'), { color: '#3b82ff', inherited: false });
  assert.deepEqual(T.effectiveColor(c, 'tk'), { color: null, inherited: false });
});
await test('Reparar datos: padre inexistente → raíz; ciclo roto', () => {
  const c = [{ id: 'a', name: 'A', ids: [], parent: 'b' }, { id: 'b', name: 'B', ids: [], parent: 'a' }, { id: 'h', name: 'H', ids: [], parent: 'zz' }, { id: 's', name: 'S', ids: [], parent: 's' }];
  assert.equal(T.normalizeParents(c), true);
  assert.equal(c.find(x => x.id === 'h').parent, null);
  assert.equal(c.find(x => x.id === 's').parent, null);
  assert.ok(c.filter(x => x.id === 'a' || x.id === 'b').some(x => x.parent === null));
  assert.equal(T.flattenTree(c).length, 4);
  assert.equal(T.normalizeParents(c), false);
});
await test('Rutas de listas importadas («Dance / 2024») y ensurePath', () => {
  assert.deepEqual(T.splitListPath('Dance / 2024'), ['Dance', '2024']);
  assert.deepEqual(T.splitListPath('AC/DC'), ['AC/DC']);
  const c = tree();
  let k = 0;
  const make = (name, parent) => { const x = { id: 'n' + (++k), name, ids: [], parent }; c.push(x); return x; };
  assert.equal(T.ensurePath(c, ['Dance', '2024'], make).id, 'y4');
  const pt = T.ensurePath(c, ['Dance', 'Tech House', 'Peak time', 'Warm up'], make);
  assert.equal(T.pathLabel(c, pt.id), 'Dance › Tech House › Peak time › Warm up');
  assert.equal(T.ensurePath(c, ['Nada'], null), null);
  assert.equal(T.ensurePath(c, ['Nueva'], make, 'tk').parent, 'tk');
});

// ------------------------------------------------------------------ Library
const lib = new Library();
await lib.load();
const [a, b, cc, d] = lib.addFiles(['A', 'B', 'C', 'D'].map(x => ({ path: `E:\\${x}.mp3`, title: x })));
for (const [t, s] of [[a, 200], [b, 100], [cc, 60], [d, 40]]) lib.update(t.id, { duration: s });

await test('Library: crear subcrates, vista del padre con descendientes, contador y búsqueda', () => {
  const dance = lib.createCrate('Dance'), y24 = lib.createCrate('2024', dance.id), th = lib.createCrate('Tech House', dance.id);
  const peak = lib.createCrate('Peak time', th.id);
  assert.equal(y24.parent, dance.id); assert.equal(dance.parent, null);
  lib.addToCrate(dance.id, [a.id]); lib.addToCrate(y24.id, [b.id, a.id]); lib.addToCrate(peak.id, [cc.id]);
  assert.deepEqual(lib.view('crate:' + dance.id).map(t => t.title), ['A', 'B', 'C']);
  assert.deepEqual(lib.query('crate:' + dance.id, 'c').map(t => t.title), ['C']); // «Buscar en «Dance»» incluye los subcrates
  lib.subTracks = false;
  assert.deepEqual(lib.view('crate:' + dance.id).map(t => t.title), ['A']);
  assert.deepEqual(lib.query('crate:' + dance.id, 'c'), []);
  lib.subTracks = true;
  assert.equal(lib.crateTrackIds(th.id).length, 1);
  assert.deepEqual(lib.sortedCrates('alpha').map(c => c.name), ['Dance', '2024', 'Tech House', 'Peak time']);
});
await test('Library: mover (subcrate, raíz, reordenar en el nivel) sin ciclos', () => {
  const C = (nm) => lib.crates.find(c => c.name === nm);
  assert.equal(lib.setCrateParent(C('Dance').id, C('Peak time').id), false);
  assert.equal(lib.setCrateParent(C('Dance').id, C('Dance').id), false);
  assert.equal(lib.moveCrate(C('Dance').id, C('Peak time').id), false); // delante de una descendiente = ciclo
  const tk = lib.createCrate('Techno');
  assert.equal(lib.setCrateParent(tk.id, C('Dance').id), true);
  assert.deepEqual(lib.crateTree('custom').map(x => `${x.depth}:${x.c.name}`), ['0:Dance', '1:2024', '1:Tech House', '2:Peak time', '1:Techno']);
  assert.equal(lib.moveCrate(tk.id, C('2024').id), true); // delante de 2024, mismo nivel
  assert.deepEqual(lib.crateTree('custom').map(x => x.c.name), ['Dance', 'Techno', '2024', 'Tech House', 'Peak time']);
  assert.equal(lib.moveCrate(C('Peak time').id, C('2024').id, true), true); // detrás de 2024: sube a Dance
  assert.equal(C('Peak time').parent, C('Dance').id);
  assert.deepEqual(lib.crateTree('custom').map(x => x.c.name), ['Dance', 'Techno', '2024', 'Peak time', 'Tech House']);
  assert.equal(lib.setCrateParent(tk.id, null), true);
  assert.equal(tk.parent, null);
  assert.equal(lib.setCrateParent(C('Peak time').id, C('Tech House').id), true);
});
await test('Library: quitar pistas en la vista del padre (deep) y borrar con/sin hijos', () => {
  const C = (nm) => lib.crates.find(c => c.name === nm);
  lib.removeFromCrate(C('Dance').id, [cc.id], true);
  assert.deepEqual(C('Peak time').ids, []);
  lib.removeFromCrate(C('Dance').id, [b.id]);           // sin deep: solo la propia
  assert.deepEqual(C('2024').ids, [b.id, a.id]);
  const removed = lib.deleteCrate(C('Tech House').id, 'lift');
  assert.equal(removed.length, 1);
  assert.equal(C('Peak time').parent, C('Dance').id);
  const all = lib.deleteCrate(C('Dance').id, 'all');
  assert.deepEqual(all.length, 3);
  assert.deepEqual(lib.crates.map(c => c.name), ['Techno']);
});
await test('Library protegida: no crea, mueve ni borra subcrates', () => {
  const p = lib.createCrate('P'), h = lib.createCrate('H', p.id);
  lib.protected = true;
  const avisos = []; const off = lib.on('protected', (m) => avisos.push(m));
  assert.equal(lib.createCrate('X', p.id), null);
  assert.equal(lib.setCrateParent(h.id, null), false); assert.equal(h.parent, p.id);
  assert.equal(lib.moveCrate(h.id, p.id), false);
  assert.equal(lib.deleteCrate(p.id, 'all'), false);
  assert.equal(lib.ensureCratePath(['P', 'Nuevo']), null);
  assert.equal(lib.addToCrate(h.id, [a.id]), false);
  assert.equal(avisos.length, 6);
  lib.protected = false; off();
});
await test('library.json antiguo (sin parent) = todas en la raíz; padres perdidos se reparan', async () => {
  store.set('nexura_library', JSON.stringify({ tracks: [{ id: 'x1', path: 'D:\\v.mp3', source: 'local' }], crates: [{ id: 'c1', name: 'Vieja', ids: ['x1'] }, { id: 'c2', name: 'Otra', ids: [] }, { id: 'c3', name: 'Huérfana', ids: [], parent: 'borrada' }] }));
  const l2 = new Library(); await l2.load();
  assert.deepEqual(l2.crateTree().map(x => `${x.depth}:${x.c.name}`), ['0:Vieja', '0:Otra', '0:Huérfana']);
  assert.equal(l2.crate('c1').parent, undefined); // no se reescriben las crates antiguas sin necesidad
  assert.equal(l2.crate('c3').parent, null);
  assert.deepEqual(l2.view('crate:c1').map(t => t.id), ['x1']);
  // y lo guardado con subcrates se vuelve a leer igual
  l2.setCrateParent('c2', 'c1'); await l2.save();
  const l3 = new Library(); await l3.load();
  assert.equal(l3.crate('c2').parent, 'c1');
  assert.deepEqual(l3.crateTree().map(x => `${x.depth}:${x.c.name}`), ['0:Vieja', '1:Otra', '0:Huérfana']);
});

console.log(`\n${n} pruebas superadas`);
