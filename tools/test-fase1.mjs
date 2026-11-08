// Pruebas en Node de la fase 1 (biblioteca y Cue Loops): node tools/test-fase1.mjs
import assert from 'node:assert/strict';

// entorno mínimo para importar library.js (usa platform.js → window / localStorage)
const store = new Map();
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

const { parseM3u, decodePlaylist, resolvePath } = await import('../src/js/library/import.js');
const { planRelocation, indexByName } = await import('../src/js/library/relocate.js');
const { COLUMNS, DEFAULT_COLS, visibleColumns, columnTemplate, columnsFor } = await import('../src/js/library/columns.js');
const { Library } = await import('../src/js/library/library.js');
const { hashId } = await import('../src/js/util.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('✓', name); };

// ------------------------------------------------------------------ M3U
test('M3U: rutas relativas a una lista de Windows (con .. y barras /)', () => {
  const txt = '#EXTM3U\r\n#EXTINF:215,Daft Punk - One More Time\r\nHouse\\one more time.mp3\r\n..\\Techno/kick.flac\r\n.\\a.mp3\r\n';
  const pl = parseM3u(txt, 'E:\\Música\\Listas\\Viernes noche.m3u8');
  assert.equal(pl.name, 'Viernes noche');
  assert.deepEqual(pl.paths, ['E:\\Música\\Listas\\House\\one more time.mp3', 'E:\\Música\\Techno\\kick.flac', 'E:\\Música\\Listas\\a.mp3']);
  assert.deepEqual({ ...pl.entries[0], path: undefined }, { path: undefined, duration: 215, artist: 'Daft Punk', title: 'One More Time' });
  assert.equal(pl.entries[1].title, undefined); // EXTINF solo describe la línea siguiente
});
test('M3U: rutas absolutas (Windows, Windows con /, UNC, Unix y file://)', () => {
  const txt = 'D:\\DJ\\x.mp3\nD:/DJ/sub/../y.mp3\n\\\\NAS\\musica\\z.mp3\n/Users/ana/Music/w.mp3\nfile:///E:/M%C3%BAsica/v.mp3\nfile:///Users/ana/u.mp3';
  const pl = parseM3u(txt, 'C:\\Listas\\l.m3u');
  assert.deepEqual(pl.paths, ['D:\\DJ\\x.mp3', 'D:\\DJ\\y.mp3', '\\\\NAS\\musica\\z.mp3', '/Users/ana/Music/w.mp3', 'E:\\Música\\v.mp3', '/Users/ana/u.mp3']);
});
test('M3U: lista de macOS/Linux con rutas relativas', () => {
  const pl = parseM3u('#EXTINF:-1,Solo título\n../Techno/a b.mp3\nsub\\c.mp3', '/Users/ana/Music/Listas/set.m3u');
  assert.deepEqual(pl.paths, ['/Users/ana/Music/Techno/a b.mp3', '/Users/ana/Music/Listas/sub/c.mp3']);
  assert.deepEqual({ t: pl.entries[0].title, a: pl.entries[0].artist, d: pl.entries[0].duration }, { t: 'Solo título', a: '', d: 0 });
});
test('M3U: en el navegador (sin carpeta) la ruta relativa se conserva', () => {
  assert.equal(resolvePath('House/x.mp3', 'lista.m3u'), 'House/x.mp3');
});
test('M3U: UTF-8 (con BOM) y Latin-1', () => {
  const utf8 = new Uint8Array([0xEF, 0xBB, 0xBF, ...new TextEncoder().encode('Canción.mp3')]);
  assert.equal(decodePlaylist(utf8), 'Canción.mp3');
  const latin1 = new Uint8Array([0x43, 0x61, 0x6E, 0x63, 0x69, 0xF3, 0x6E, 0x2E, 0x6D, 0x70, 0x33]); // «Canción.mp3» en Latin-1
  assert.equal(decodePlaylist(latin1), 'Canción.mp3');
});

// ------------------------------------------------------------------ columnas
test('Columnas: por defecto (sin carátula, Explicit, año, energía ni comentario)', () => {
  const keys = visibleColumns(null).map(c => c.key);
  assert.deepEqual(keys, ['status', 'title', 'artist', 'bpm', 'camelot', 'duration', 'rating', 'genre', 'album', 'plays', 'added']);
  assert.deepEqual(keys.filter(k => k !== 'status' && k !== 'title'), DEFAULT_COLS.filter(k => k !== 'status' && k !== 'title'));
});
test('Columnas: las fijas siempre se ven y el máximo quita las de menor prioridad', () => {
  assert.deepEqual(visibleColumns([]).map(c => c.key), ['status', 'title']);
  assert.deepEqual(visibleColumns(['art', 'artist', 'bpm', 'camelot', 'added', 'explicit'], 5).map(c => c.key), ['status', 'title', 'artist', 'bpm', 'camelot']);
  // el orden es siempre el del catálogo
  assert.deepEqual(visibleColumns(['added', 'artist']).map(c => c.key), ['status', 'title', 'artist', 'added']);
});
test('Columnas: plantilla de grid con anchos del usuario', () => {
  const cols = visibleColumns(['artist', 'bpm']);
  assert.equal(columnTemplate(cols), '30px minmax(var(--col-min-title, 140px), 2.2fr) minmax(var(--col-min-text, 100px), 1.5fr) 62px');
  assert.equal(columnTemplate(cols, { title: 300, bpm: 70 }), '30px 300px minmax(var(--col-min-text, 100px), 1.5fr) 70px');
  // todas fijas → la última se estira
  assert.equal(columnTemplate(cols, { title: 300, artist: 200, bpm: 70 }), '30px 300px 200px minmax(70px, 1fr)');
});
test('Columnas: mismas en todos los crates o por crate', () => {
  const s = { libCols: ['bpm'], libColsSame: true, libColsByView: { 'crate:a': ['genre'] } };
  assert.deepEqual(columnsFor(s, 'crate:a'), ['bpm']);
  s.libColsSame = false;
  assert.deepEqual(columnsFor(s, 'crate:a'), ['genre']);
  assert.deepEqual(columnsFor(s, 'crate:b'), ['bpm']); // sin columnas propias: las globales
  assert.deepEqual(columnsFor({}, 'all'), DEFAULT_COLS);
  assert.ok(COLUMNS.every(c => c.key && c.w));
});

// ------------------------------------------------------------------ relocalizar
test('Relocalizar: por nombre, desempate por tamaño, ambiguos, no encontrados y duplicados', () => {
  const tracks = [
    { id: 'a', path: 'D:\\Old\\One.mp3', size: 100 },
    { id: 'b', path: 'D:\\Old\\two.mp3', size: 200 },
    { id: 'c', path: 'D:\\Old\\three.mp3', size: 300 },
    { id: 'd', path: 'D:\\Old\\four.mp3', size: 400 },
    { id: 'e', path: 'D:\\Old\\five.mp3', size: 500 }
  ];
  const files = [
    { path: 'E:\\New\\one.MP3', size: 100 },
    { path: 'E:\\New\\A\\two.mp3', size: 999 }, { path: 'E:\\New\\B\\two.mp3', size: 200 },
    { path: 'E:\\New\\A\\three.mp3', size: 1 }, { path: 'E:\\New\\B\\three.mp3', size: 2 },
    { path: 'E:\\New\\five.mp3', size: 500 }
  ];
  const plan = planRelocation(tracks, indexByName(files), new Set(['e:\\new\\five.mp3']));
  assert.deepEqual(plan.moves, [{ id: 'a', path: 'E:\\New\\one.MP3' }, { id: 'b', path: 'E:\\New\\B\\two.mp3' }]);
  assert.deepEqual(plan.ambiguous, ['c']);
  assert.deepEqual(plan.notFound, ['d']);
  assert.deepEqual(plan.duplicate, ['e']);
});

const lib = new Library();
await lib.load();
test('Relocalizar: se conserva el id y con él crates, Prepare, historial, cues y valoración', () => {
  const [t] = lib.addFiles([{ path: 'D:\\Old\\One.mp3', title: 'One', size: 100 }]);
  const oldId = t.id;
  t.cues[0] = { t: 1.5, color: '#fff', name: '' }; t.rating = 4; t.bpm = 124; t.bpmLocked = true;
  const c = lib.createCrate('Viernes'); lib.addToCrate(c.id, [oldId]); lib.addToPrepare([oldId]);
  lib.logPlay(t, 0);
  assert.equal(lib.relocate([{ id: oldId, path: 'E:\\New\\one.mp3', size: 101 }]), 1);
  const r = lib.get(oldId);
  assert.equal(r.path, 'E:\\New\\one.mp3'); assert.equal(r.size, 101);
  assert.equal(r.cues[0].t, 1.5); assert.equal(r.rating, 4); assert.equal(r.bpm, 124);
  assert.ok(lib.crates[0].ids.includes(oldId)); assert.ok(lib.prepare.includes(oldId));
  assert.ok(lib.view('history:' + lib.session.id).some(x => x.id === oldId));
  // volver a añadir el archivo en su ruta nueva no duplica la pista (búsqueda por ruta)
  assert.notEqual(hashId('E:\\New\\one.mp3'), oldId);
  const again = lib.addFiles([{ path: 'E:\\NEW\\one.mp3', title: 'One' }]);
  assert.equal(again[0].id, oldId); assert.equal(lib.tracks.size, 1);
  assert.equal(lib.byPath('E:\\New\\one.mp3').id, oldId);
});

// ------------------------------------------------------------------ protección, crates, historial
test('Proteger biblioteca: bloquea borrar/editar/crates y permite añadir, Prepare y ordenar', () => {
  const avisos = []; const off = lib.on('protected', (m) => avisos.push(m));
  lib.protected = true;
  const id = [...lib.tracks.keys()][0];
  assert.equal(lib.remove([id]), false); assert.ok(lib.get(id));
  assert.equal(lib.createCrate('X'), null);
  assert.equal(lib.addToCrate(lib.crates[0].id, ['zz']), false);
  assert.equal(lib.editTrack(id, { title: 'otro' }), false); assert.equal(lib.get(id).title, 'One');
  assert.equal(lib.setRating([id], 1), false); assert.equal(lib.get(id).rating, 4);
  assert.equal(lib.deleteCrate(lib.crates[0].id), false);
  assert.equal(lib.saveSmart({ id: 's', name: 's', match: 'all', rules: [] }), false);
  assert.equal(lib.guard('grid'), false);
  const added = lib.addFiles([{ path: 'D:\\Nueva.mp3', title: 'Nueva' }]); // pistas nuevas: sí
  assert.ok(lib.get(added[0].id));
  lib.addToPrepare([added[0].id]); assert.ok(lib.prepare.includes(added[0].id));
  assert.ok(lib.query('all', '', { field: 'title', dir: 1 }).length >= 2);
  lib.update(added[0].id, { bpm: 128, analyzed: true }); // el análisis de pistas nuevas sigue funcionando
  assert.equal(lib.get(added[0].id).bpm, 128);
  assert.ok(avisos.length >= 8 && avisos.every(m => m.startsWith('Biblioteca protegida')));
  lib.protected = false; off();
});
test('Crates: color, orden alfabético / por fecha / personalizado y en qué crates está una pista', () => {
  const b = lib.createCrate('bajos'), a = lib.createCrate('Agudos');
  lib.setCrateColor(b.id, '#ff3b47');
  assert.equal(lib.crates.find(c => c.id === b.id).color, '#ff3b47');
  assert.deepEqual(lib.sortedCrates('alpha').map(c => c.name), ['Agudos', 'bajos', 'Viernes']);
  assert.deepEqual(lib.sortedCrates('created').map(c => c.name), ['Viernes', 'bajos', 'Agudos']);
  lib.moveCrate(a.id, lib.crates[0].id);
  assert.deepEqual(lib.sortedCrates('custom').map(c => c.name), ['Agudos', 'Viernes', 'bajos']);
  const id = lib.crates.find(c => c.name === 'Viernes').ids[0];
  lib.addToCrate(b.id, [id]);
  assert.deepEqual(lib.cratesOf(id).map(c => c.name).sort(), ['Viernes', 'bajos']);
});
test('Historial: reiniciar pistas tocadas de una sesión o de todas', () => {
  const id = lib.session.entries[0].id;
  assert.ok(lib.playedIds().has(id));
  lib.session.entries[0].time -= 10; // jugada antes del reinicio
  lib.resetPlayed(lib.session.id);
  assert.equal(lib.playedIds().size, 0);
  assert.equal(lib.history[0].entries.length, 1); // el historial no se borra
  const t2 = lib.addFiles([{ path: 'D:\\otra.mp3', title: 'otra' }])[0];
  lib.logPlay(t2, 1); lib.session.entries[1].time += 10;
  assert.deepEqual([...lib.playedIds()], [t2.id]);
  lib.history.forEach(h => h.entries.forEach(e => { e.time -= 20; }));
  lib.resetPlayed();
  assert.equal(lib.playedIds().size, 0);
});
test('Ordenar por valoración y Explicit', () => {
  const ts = [...lib.tracks.values()];
  lib.setRating([ts[1].id], 5); lib.setExplicit([ts[2].id], true);
  assert.equal(lib.query('all', '', { field: 'rating', dir: 1 })[0].id, ts[1].id);
  assert.equal(lib.query('all', '', { field: 'explicit', dir: 1 })[0].id, ts[2].id);
});
test('Datos antiguos: pistas sin cueLoops, crates sin color ni fecha', async () => {
  store.set('nexura_library', JSON.stringify({ tracks: [{ id: 'x1', path: 'D:\\v.mp3', source: 'local', cues: null }], crates: [{ id: 'c1', name: 'Vieja', ids: ['x1'] }] }));
  const l2 = new Library(); await l2.load();
  assert.deepEqual(l2.get('x1').cueLoops, Array(8).fill(null));
  assert.deepEqual(l2.get('x1').cues, Array(8).fill(null));
  assert.deepEqual(l2.sortedCrates('created').map(c => c.name), ['Vieja']);
});

console.log(`\n${n} pruebas superadas`);
