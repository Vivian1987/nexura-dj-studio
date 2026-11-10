// Pruebas en Node de «Eliminar de la biblioteca» con deshacer (Library.remove / restoreRemoved):
// node tools/test-borrar.mjs
import assert from 'node:assert/strict';

// entorno mínimo para importar library.js (usa platform.js → window / localStorage)
const store = new Map();
globalThis.window = {};
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
const { Library } = await import('../src/js/library/library.js');

let n = 0;
const test = async (name, fn) => { await fn(); n++; console.log('✓', name); };

function make() {
  const lib = new Library();
  const ts = lib.addFiles(['A', 'B', 'C', 'D', 'E'].map(x => ({ path: `E:\\Música\\${x}.mp3`, title: x, artist: 'Art ' + x })));
  const [a, b, c, d, e] = ts.map(t => t.id);
  const dance = lib.createCrate('Dance');
  const sub = lib.createCrate('2024', dance.id);
  lib.addToCrate(dance.id, [a, b, c, d]);
  lib.addToCrate(sub.id, [c, b]);
  lib.addToPrepare([d, b, a]);
  lib.addYouTubeItems([{ videoId: 'v1', title: 'Vídeo' }], { playlistId: 'PL1', title: 'Lista' });
  lib.ytPlaylists[0].ids.push(b);   // (una lista de YouTube con una pista local, para comprobar que también vuelve)
  return { lib, ids: { a, b, c, d, e }, dance, sub };
}

await test('Eliminar quita la pista de la biblioteca, crates, subcrates, Prepare y listas; el historial no cambia', () => {
  const { lib, ids: { a, b, c, d }, dance, sub } = make();
  lib.logPlay(lib.get(b), 0);
  const undo = lib.remove([b]);
  assert.ok(undo && undo.tracks.length === 1);
  assert.equal(lib.get(b), undefined);
  assert.deepEqual(lib.crate(dance.id).ids, [a, c, d]);
  assert.deepEqual(lib.crate(sub.id).ids, [c]);
  assert.deepEqual(lib.prepare, [d, a]);
  assert.deepEqual(lib.ytPlaylists[0].ids, ['yt_v1']);
  assert.equal(lib.session.entries[0].id, b);
});

await test('Deshacer devuelve la pista con todos sus datos y en la misma posición de todo', () => {
  const { lib, ids: { a, b, c, d, e }, dance, sub } = make();
  const t = lib.get(b);
  t.cues[0] = { t: 12.5, color: '#f00' }; t.bpm = 124; t.grid = [{ t: 0.1, bpm: 124 }, { t: 90, bpm: 126 }]; t.rating = 4;
  const orderBefore = [...lib.tracks.keys()];
  const undo = lib.remove([b, d]);
  assert.ok(lib.restoreRemoved(undo));
  assert.deepEqual([...lib.tracks.keys()], orderBefore, 'misma posición en «Todas las pistas»');
  const back = lib.get(b);
  assert.equal(back.cues[0].t, 12.5); assert.equal(back.bpm, 124); assert.equal(back.grid.length, 2); assert.equal(back.rating, 4);
  assert.deepEqual(lib.crate(dance.id).ids, [a, b, c, d]);
  assert.deepEqual(lib.crate(sub.id).ids, [c, b]);
  assert.deepEqual(lib.prepare, [d, b, a]);
  assert.deepEqual(lib.ytPlaylists[0].ids, ['yt_v1', b]);
  assert.equal(lib.byPath('E:\\Música\\B.mp3').id, b, 'el índice por ruta se rehace');
  void e;
});

await test('Deshacer conserva lo añadido entretanto y no duplica; varios borrados se deshacen en orden inverso', () => {
  const { lib, ids: { a, b, c, d, e }, dance } = make();
  const u1 = lib.remove([a]);
  lib.addToCrate(dance.id, [e]);          // añadida mientras tanto
  const u2 = lib.remove([c]);
  assert.deepEqual(lib.crate(dance.id).ids, [b, d, e]);
  lib.restoreRemoved(u2);
  assert.deepEqual(lib.crate(dance.id).ids, [b, c, d, e]);
  lib.restoreRemoved(u1);
  assert.deepEqual(lib.crate(dance.id).ids, [a, b, c, d, e]);
  // la pista se ha vuelto a añadir (misma ruta) antes de deshacer: no se duplica
  const u3 = lib.remove([d]);
  lib.addFiles([{ path: 'E:\\Música\\D.mp3', title: 'D otra vez' }]);
  lib.restoreRemoved(u3);
  assert.equal([...lib.tracks.values()].filter(t => t.path === 'E:\\Música\\D.mp3').length, 1);
  assert.equal(lib.tracks.size, 6);       // 5 locales + 1 vídeo
});

await test('Biblioteca protegida: ni se elimina ni se deshace', () => {
  const { lib, ids: { a } } = make();
  const msgs = []; lib.on('protected', m => msgs.push(m));
  const undo = lib.remove([a]);
  lib.protected = true;
  assert.equal(lib.restoreRemoved(undo), false);
  assert.equal(lib.get(a), undefined);
  assert.equal(lib.remove([...lib.tracks.keys()]), false);
  assert.equal(msgs.length, 2);
  lib.protected = false;
  assert.ok(lib.restoreRemoved(undo)); assert.ok(lib.get(a));
  assert.equal(lib.restoreRemoved(null), false);
});

// --- Borrar listas y vídeos de YouTube
function makeYt() {
  const lib = new Library();
  const [a] = lib.addFiles([{ path: 'E:\\Música\\A.mp3', title: 'A' }]).map(t => t.id);
  // 148 vídeos sueltos (sin lista), como en la biblioteca del usuario
  lib.addYouTubeItems(Array.from({ length: 148 }, (_, i) => ({ videoId: 'sv' + i, title: 'Suelto ' + i })), null);
  lib.addYouTubeItems([{ videoId: 'p1' }, { videoId: 'p2' }, { videoId: 'p3' }, { videoId: 'p4' }].map(x => ({ ...x, title: x.videoId })), { playlistId: 'PLA', title: 'Lista A' });
  lib.addYouTubeItems([{ videoId: 'p2', title: 'p2' }], { playlistId: 'PLB', title: 'Lista B' });   // p2 también en otra lista
  const c = lib.createCrate('Con vídeo');
  lib.addToCrate(c.id, ['yt_p3', a, 'yt_sv0']);                                                       // p3 también en una crate
  lib.addToPrepare(['yt_p4', 'yt_sv1', a]);
  return { lib, a, c, A: lib.ytPlaylists[0], B: lib.ytPlaylists[1] };
}

await test('YouTube: quitar todos los vídeos los saca de crates, Prepare y listas; deshacer los devuelve', () => {
  const { lib, a, c, A, B } = makeYt();
  const ids = lib.ytTrackIds();
  assert.equal(ids.length, 152);
  const before = { order: [...lib.tracks.keys()], crate: c.ids.slice(), prep: lib.prepare.slice(), A: A.ids.slice(), B: B.ids.slice() };
  const undo = lib.remove(ids);
  assert.equal(lib.ytTrackIds().length, 0);
  assert.equal(lib.view('yt-all').length, 0);
  assert.deepEqual(c.ids, [a]); assert.deepEqual(lib.prepare, [a]);
  assert.deepEqual(A.ids, []); assert.deepEqual(B.ids, []);
  assert.ok(lib.restoreRemoved(undo));
  assert.deepEqual([...lib.tracks.keys()], before.order);
  assert.deepEqual(c.ids, before.crate); assert.deepEqual(lib.prepare, before.prep);
  assert.deepEqual(A.ids, before.A); assert.deepEqual(B.ids, before.B);
});

await test('YouTube: «Eliminar lista» deja los vídeos; deshacer la devuelve en su sitio', () => {
  const { lib, A } = makeYt();
  const undo = lib.deleteYtPlaylist(A.id);
  assert.ok(undo);
  assert.deepEqual(lib.ytPlaylists.map(p => p.title), ['Lista B']);
  assert.ok(lib.get('yt_p1'));
  assert.ok(lib.restoreYtPlaylist(undo));
  assert.deepEqual(lib.ytPlaylists.map(p => p.title), ['Lista A', 'Lista B']);
  assert.deepEqual(lib.ytPlaylists[0].ids, ['yt_p1', 'yt_p2', 'yt_p3', 'yt_p4']);
  assert.equal(lib.restoreYtPlaylist(undo), false, 'no se duplica');
});

await test('YouTube: «Eliminar lista y sus vídeos» quita solo los que no están en otra lista ni en una crate', () => {
  const { lib, a, c, A, B } = makeYt();
  assert.deepEqual(lib.ytPlaylistOrphans(A.id).sort(), ['yt_p1', 'yt_p4']);   // p2 en Lista B, p3 en una crate; p4 solo en Prepare
  const undo = lib.deleteYtPlaylistWithVideos(A.id);
  assert.ok(undo && undo.removed.tracks.length === 2);
  assert.deepEqual(lib.ytPlaylists.map(p => p.title), ['Lista B']);
  assert.equal(lib.get('yt_p1'), undefined); assert.equal(lib.get('yt_p4'), undefined);
  assert.ok(lib.get('yt_p2') && lib.get('yt_p3'));
  assert.deepEqual(lib.prepare, ['yt_sv1', a]);
  assert.ok(lib.restoreYtPlaylistWithVideos(undo));
  assert.deepEqual(lib.ytPlaylists.map(p => p.title), ['Lista A', 'Lista B']);
  assert.deepEqual(lib.ytPlaylists[0].ids, ['yt_p1', 'yt_p2', 'yt_p3', 'yt_p4']);
  assert.deepEqual(lib.prepare, ['yt_p4', 'yt_sv1', a]);
  assert.deepEqual(c.ids, ['yt_p3', a, 'yt_sv0']);
  void B;
});

await test('YouTube: con la biblioteca protegida no se borra ninguna lista ni vídeo', () => {
  const { lib, A } = makeYt();
  lib.protected = true;
  assert.equal(lib.deleteYtPlaylist(A.id), false);
  assert.equal(lib.deleteYtPlaylistWithVideos(A.id), false);
  assert.equal(lib.ytPlaylists.length, 2); assert.ok(lib.get('yt_p1'));
});

console.log(`\n${n} pruebas de eliminar/deshacer superadas`);
