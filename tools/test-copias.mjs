// Pruebas de las copias de seguridad de la biblioteca (main/backup.js) con carpetas temporales.
// node tools/test-copias.mjs
import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
const require = createRequire(import.meta.url);
const B = require('../main/backup.js');

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('  ✓', msg); } else { fail++; console.log('  ✗', msg); } };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-copias-'));
const data = path.join(root, 'data'), copias = path.join(root, 'copias');
fs.mkdirSync(path.join(data, 'waveforms'), { recursive: true });
const lib = (n) => ({ tracks: Array.from({ length: n }, (_, i) => ({ id: 't' + i, title: 'Pista ' + i, cues: [{ t: i }], grid: [{ t: 0, bpm: 124 }] })), crates: [{ id: 'c1', name: 'Dance' }], prepare: ['t0'], history: [{ date: 1, ids: ['t1'] }] });
const write = (n, o) => fs.writeFileSync(path.join(data, n), typeof o === 'string' ? o : JSON.stringify(o));
write('library.json', lib(3));
write('settings.json', { quantize: true, libCols: ['bpm'] });
fs.writeFileSync(path.join(data, 'waveforms', 'x.bin'), Buffer.alloc(1000));
fs.writeFileSync(path.join(data, 'secrets.bin'), 'cifrado');
const at = (d) => new Date(d);

console.log('Copia y contenido');
ok(B.checkHealth(data).ok, 'datos sanos');
let r = B.makeBackup(data, copias, { reason: 'manual', version: '1.0.0-rc.1', now: at('2026-11-10T09:05:00') });
ok(r.name === '2026-11-10_0905', `carpeta AAAA-MM-DD_HHMM (${r.name})`);
const files = fs.readdirSync(path.join(copias, r.name)).sort();
ok(files.join(',') === 'copia.json,library.json,settings.json', `solo biblioteca, ajustes y manifiesto (${files.join(', ')})`);
ok(r.tracks === 3 && r.size > 0, 'cuenta pistas y tamaño');
const copied = JSON.parse(fs.readFileSync(path.join(copias, r.name, 'library.json'), 'utf8'));
ok(copied.tracks[2].cues[0].t === 2 && copied.crates[0].name === 'Dance' && copied.prepare[0] === 't0' && copied.history.length === 1, 'cues, grid, crates, Prepare e historial intactos');
r = B.makeBackup(data, copias, { reason: 'manual', now: at('2026-11-10T09:05:30') });
ok(r.name === '2026-11-10_0905-2', 'dos copias en el mismo minuto no se pisan');

console.log('Una al día y 14 como mucho');
const c1 = B.autoBackup(data, copias, { now: at('2026-11-11T08:00:00') });
const c2 = B.autoBackup(data, copias, { now: at('2026-11-11T20:00:00') });
ok(c1.name && c2.skipped === 'hoy', 'la automática se hace una vez al día');
for (let d = 12; d <= 30; d++) B.autoBackup(data, copias, { now: at(`2026-11-${d}T08:00:00`) });
const list = B.listBackups(copias);
ok(list.length === 14, `se conservan 14 (${list.length})`);
ok(list[0].name === '2026-11-30_0800' && list[13].name === '2026-11-17_0800', 'se borran las más antiguas');
ok(list.every(b => b.ok && b.size > 0 && b.date), 'lista con fecha y tamaño');

console.log('Restaurar');
write('library.json', lib(1));
const target = list.find(b => b.name === '2026-11-20_0800');
const res = B.restoreBackup(data, copias, target.name, { now: at('2026-12-01T10:00:00') });
const now = JSON.parse(fs.readFileSync(path.join(data, 'library.json'), 'utf8'));
ok(now.tracks.length === 3, 'la biblioteca vuelve a tener 3 pistas');
ok(res.before === '2026-12-01_1000', 'antes de restaurar se copia el estado actual');
const before = JSON.parse(fs.readFileSync(path.join(copias, res.before, 'library.json'), 'utf8'));
ok(before.tracks.length === 1, 'la copia previa guarda lo que había (1 pista)');
ok(B.listBackups(copias).some(b => b.name === target.name), 'la copia restaurada sigue en la lista');
ok(fs.existsSync(path.join(data, 'waveforms', 'x.bin')) && fs.existsSync(path.join(data, 'secrets.bin')), 'formas de onda y sesiones no se tocan');
let threw = false; try { B.restoreBackup(data, copias, '../../etc'); } catch (_) { threw = true; }
ok(threw, 'rechaza nombres de copia no válidos');

console.log('Biblioteca dañada');
write('library.json', '{"tracks": [ {"id": "t0", "tit');
const h = B.checkHealth(data);
ok(!h.ok && h.damaged.includes('library.json'), 'detecta library.json cortado a medias');
const skip = B.makeBackup(data, copias, { reason: 'auto', now: at('2026-12-02T08:00:00') });
ok(skip.skipped === 'danada', 'no hace copia automática de una biblioteca dañada');
const good = B.latestGood(copias);
ok(good && good.ok && good.tracks != null, `última copia buena: ${good && good.name}`);
B.restoreBackup(data, copias, good.name, { now: at('2026-12-02T08:01:00') });
ok(B.checkHealth(data).ok, 'restaurar la última buena deja los datos sanos');
const pre = B.listBackups(copias).find(b => b.reason === 'antes-de-restaurar' && b.name === '2026-12-02_0801');
ok(pre && pre.ok === false, 'la copia del estado dañado queda marcada como no buena');
ok(B.latestGood(copias).name !== '2026-12-02_0801', 'una copia dañada nunca es «la última buena»');
write('settings.json', '');
const moved = B.setAsideDamaged(data, B.checkHealth(data).damaged, at('2026-12-03T09:00:00'));
ok(moved[0] === 'settings.danada-2026-12-03_0900.json' && !fs.existsSync(path.join(data, 'settings.json')), 'empezar de cero aparta el archivo dañado sin borrarlo');
ok(!B.dataFiles(data).some(f => f.includes('danada')), 'los archivos apartados no entran en las copias');

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
