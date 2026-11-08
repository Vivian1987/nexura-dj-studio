// Pruebas en Node de carpetas → crates: node tools/test-folder-crates.mjs
import assert from 'node:assert/strict';

// entorno mínimo para importar library.js (usa platform.js → window / localStorage)
const store = new Map();
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

const F = await import('../src/js/library/folder-crates.js');
const { pathLabel } = await import('../src/js/library/crate-tree.js');
const { Library } = await import('../src/js/library/library.js');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('✓', name); };

const f = (p) => ({ path: p, title: p.split(/[\\/]/).pop() });
const dir = (name, files = [], dirs = []) => ({ name, files: files.map(f), dirs });
// Dance/2020 (a, b) › Verano (c) › Vacía (sin audio) · Solo subcarpetas › Tech (d)
const dropped = () => ({ files: [], dirs: [dir('2020', ['E:/M/2020/a.mp3', 'E:/M/2020/b.mp3'], [
  dir('Verano', ['E:/M/2020/Verano/c.mp3'], [dir('Vacía')]),
  dir('Solo subcarpetas', [], [dir('Tech', ['E:/M/2020/Solo subcarpetas/Tech/d.mp3'])])
])] });

// crates de prueba: make añade al mismo array (como Library._newCrate)
const fake = (crates = []) => { let k = 0; return { crates, make: (name, parent) => { const c = { id: 'n' + (++k), name, parent, ids: [] }; crates.push(c); return c; } }; };
const label = (crates, c) => pathLabel(crates, c.id);

await test('Árbol: hasAudio, treeFiles, pruneTree y treeFromRelPaths', () => {
  const t = dropped();
  assert.equal(F.hasAudio(t.dirs[0]), true);
  assert.equal(F.hasAudio(dir('Vacía')), false);
  assert.equal(F.hasAudio(dir('x', [], [dir('y', [], [dir('z', ['z.mp3'])])])), true);
  assert.deepEqual(F.treeFiles(t).map(x => x.title), ['a.mp3', 'b.mp3', 'c.mp3', 'd.mp3']);
  const p = F.pruneTree(t);
  assert.deepEqual(p.dirs[0].dirs[0].dirs, []);                       // «Vacía» fuera
  assert.equal(t.dirs[0].dirs[0].dirs.length, 1);                     // el original no cambia
  const r = F.treeFromRelPaths([
    { rel: '2020/a.mp3', info: f('a') }, { rel: '2020/Verano/c.mp3', info: f('c') }, { rel: '2020/b.mp3', info: f('b') }
  ]);
  assert.equal(r.dirs.length, 1);
  assert.equal(r.dirs[0].name, '2020');
  assert.deepEqual(r.dirs[0].files.map(x => x.path), ['a', 'b']);
  assert.deepEqual(r.dirs[0].dirs[0].files.map(x => x.path), ['c']);
});

await test('Carpeta con subcarpetas sobre una crate: Dance › 2020 › Verano, cada pista en la suya', () => {
  const { crates, make } = fake([{ id: 'd', name: 'Dance', ids: [] }]);
  const plan = F.applyFolderTree(crates, F.pruneTree(dropped()), 'd', { make });
  assert.deepEqual(plan.created.map(c => label(crates, c)), ['Dance › 2020', 'Dance › 2020 › Verano', 'Dance › 2020 › Solo subcarpetas', 'Dance › 2020 › Solo subcarpetas › Tech']);
  assert.deepEqual(plan.top.map(c => c.name), ['2020']);
  const by = (name) => plan.assign.get(crates.find(c => c.name === name).id) || [];
  assert.deepEqual(by('2020'), ['E:/M/2020/a.mp3', 'E:/M/2020/b.mp3']);
  assert.deepEqual(by('Verano'), ['E:/M/2020/Verano/c.mp3']);
  assert.deepEqual(by('Solo subcarpetas'), []);                       // solo subcarpetas: crate vacía que agrupa
  assert.deepEqual(by('Tech'), ['E:/M/2020/Solo subcarpetas/Tech/d.mp3']);
  assert.equal(plan.assign.has('d'), false);                          // Dance no recibe las pistas
  assert.ok(!crates.some(c => c.name === 'Vacía'));
});

await test('Carpeta vacía o sin audio en ningún nivel: no crea nada', () => {
  const { crates, make } = fake([{ id: 'd', name: 'Dance', ids: [] }]);
  const plan = F.applyFolderTree(crates, { files: [], dirs: [dir('Nada', [], [dir('Tampoco')])] }, 'd', { make });
  assert.equal(plan.created.length, 0);
  assert.equal(crates.length, 1);
  assert.equal(plan.assign.size, 0);
});

await test('Nombres repetidos: se reutiliza el subcrate del mismo nivel (también sin distinguir mayúsculas)', () => {
  const { crates, make } = fake([{ id: 'd', name: 'Dance', ids: [] }, { id: 'y', name: '2020', parent: 'd', ids: ['viejo'] }, { id: 'r', name: '2020', ids: [] }]);
  const tree = { files: [], dirs: [dir('2020', ['C:/x/2020/a.mp3']), dir('2020', ['D:/y/2020/b.mp3'], [dir('verano', ['D:/y/2020/verano/c.mp3'])])] };
  const plan = F.applyFolderTree(crates, tree, 'd', { make });
  assert.deepEqual(plan.created.map(c => label(crates, c)), ['Dance › 2020 › verano']);
  assert.deepEqual(plan.assign.get('y'), ['C:/x/2020/a.mp3', 'D:/y/2020/b.mp3']);   // las dos carpetas «2020» juntas
  assert.equal(plan.top.length, 1);
  // otra vez con «VERANO»: mismo subcrate
  const again = F.applyFolderTree(crates, { files: [], dirs: [dir('2020', [], [dir('VERANO', ['e.mp3'])])] }, 'd', { make });
  assert.equal(again.created.length, 0);
  assert.equal(crates.filter(c => /verano/i.test(c.name)).length, 1);
  // la crate «2020» de la raíz no se toca
  assert.equal(plan.assign.has('r'), false);
});

await test('Mezcla de archivos y carpetas: sueltos al destino, carpetas como subcrates', () => {
  const { crates, make } = fake([{ id: 'd', name: 'Dance', ids: [] }]);
  const tree = { files: [f('E:/s1.mp3'), f('E:/s2.mp3')], dirs: [dir('2021', ['E:/2021/x.mp3'])] };
  const plan = F.applyFolderTree(crates, tree, 'd', { make });
  assert.deepEqual(plan.assign.get('d'), ['E:/s1.mp3', 'E:/s2.mp3']);
  assert.deepEqual(plan.assign.get(crates.find(c => c.name === '2021').id), ['E:/2021/x.mp3']);
  assert.deepEqual(plan.loose, []);
});

await test('Destino raíz, crate y subcrate', () => {
  // raíz: crates de primer nivel; los sueltos no van a ninguna crate
  let { crates, make } = fake([]);
  let plan = F.applyFolderTree(crates, { files: [f('s.mp3')], dirs: [dir('2020', ['a.mp3'], [dir('Verano', ['c.mp3'])])] }, null, { make });
  assert.deepEqual(crates.map(c => pathLabel(crates, c.id)), ['2020', '2020 › Verano']);
  assert.equal(crates[0].parent, null);
  assert.deepEqual(plan.loose, ['s.mp3']);
  // subcrate como destino: Dance › 2020 › (Verano › Julio)
  ({ crates, make } = fake([{ id: 'd', name: 'Dance', ids: [] }, { id: 'y', name: '2020', parent: 'd', ids: [] }]));
  plan = F.applyFolderTree(crates, { files: [], dirs: [dir('Verano', [], [dir('Julio', ['j.mp3'])])] }, 'y', { make });
  assert.deepEqual(plan.created.map(c => label(crates, c)), ['Dance › 2020 › Verano', 'Dance › 2020 › Verano › Julio']);
});

await test('Library.addFolderTree: pistas ya existentes, sin duplicar y biblioteca protegida', async () => {
  const L = new Library();
  L.addFiles([f('E:/M/2020/a.mp3')]);                                // ya estaba en la biblioteca
  const old = L.byPath('E:/M/2020/a.mp3');
  const dance = L.createCrate('Dance');
  const r = L.addFolderTree(dropped(), dance.id);
  assert.equal(r.tracks.length, 4);
  assert.equal(L.tracks.size, 4);                                     // sin duplicar «a»
  const y = L.crates.find(c => c.name === '2020'), v = L.crates.find(c => c.name === 'Verano');
  assert.equal(pathLabel(L.crates, v.id), 'Dance › 2020 › Verano');
  assert.ok(y.ids.includes(old.id));                                  // la existente también va a su subcrate
  assert.equal(y.ids.length, 2);
  assert.deepEqual(dance.ids, []);
  assert.deepEqual(L.crateTrackIds(dance.id).length, 4);              // con subcrates visibles: las 4
  // otra vez lo mismo: ni crates ni pistas repetidas
  const before = L.crates.length;
  const r2 = L.addFolderTree(dropped(), dance.id);
  assert.equal(r2.created.length, 0);
  assert.equal(L.crates.length, before);
  assert.equal(y.ids.length, 2);
  // protegida: se añaden a la biblioteca, sin crates, y avisa
  const warn = [];
  L.on('protected', (m) => warn.push(m));
  L.protected = true;
  const r3 = L.addFolderTree({ files: [], dirs: [dir('2022', ['E:/M/2022/z.mp3'])] }, dance.id);
  assert.equal(r3.blocked, true);
  assert.ok(L.byPath('E:/M/2022/z.mp3'));
  assert.ok(!L.crates.some(c => c.name === '2022'));
  assert.equal(warn.length, 1);
  // destino inexistente → raíz
  L.protected = false;
  L.addFolderTree({ files: [], dirs: [dir('Suelta', ['E:/q.mp3'])] }, 'no-existe');
  assert.equal(L.crates.find(c => c.name === 'Suelta').parent, null);
});

console.log(`\n${n} pruebas correctas`);
