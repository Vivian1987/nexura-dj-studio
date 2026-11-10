// Ejecuta todas las pruebas de Node (tools/test-*.mjs y check-*.cjs) y `node --check` de los .js del
// proceso principal y la interfaz. Uso: node tools/test-todo.cjs  (las de interfaz, con Electron, aparte)
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tools = fs.readdirSync(__dirname);
const tests = [...tools.filter(f => /^test-.*\.mjs$/.test(f) && f !== 'test-grid-synth.mjs'), ...tools.filter(f => /^check-.*\.cjs$/.test(f))];
let failed = 0;
for (const t of tests) {
  const r = spawnSync(process.execPath, [path.join(__dirname, t)], { cwd: root, encoding: 'utf8', timeout: 600000 });
  const out = (r.status === 0 ? r.stdout : r.stdout + r.stderr).trim().split('\n');
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${t} → ${out[out.length - 1] || ''}`);
  if (!ok) console.log(out.filter(l => /✗|Error|fall/i.test(l)).slice(0, 10).map(l => '    ' + l).join('\n'));
}
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.(c?js)$/.test(e.name) ? [path.join(d, e.name)] : []));
const files = ['main.js', 'preload.js'].map(f => path.join(root, f)).concat(walk(path.join(root, 'main')), walk(path.join(root, 'src', 'js')), tools.filter(f => /\.(cjs|js)$/.test(f)).map(f => path.join(__dirname, f)));
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { bad++; console.log('✗ sintaxis', path.relative(root, f), r.stderr.split('\n').slice(0, 4).join(' ')); }
}
console.log(`\n${tests.length - failed}/${tests.length} pruebas correctas · sintaxis: ${files.length - bad}/${files.length} archivos`);
process.exit(failed || bad ? 1 : 0);
