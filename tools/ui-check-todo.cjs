// Ejecuta una tras otra todas las pruebas de interfaz con Electron (tools/ui-check-*.cjs y fx-check.cjs)
// contra `npm run web` (debe estar en marcha) y resume el resultado. Uso: node tools/ui-check-todo.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const only = process.argv.slice(2);
const list = only.length ? only : ['ui-check.cjs', ...fs.readdirSync(__dirname).filter(f => /^ui-check-.*\.cjs$/.test(f) && f !== 'ui-check-todo.cjs'), 'fx-check.cjs'];
let failed = 0;
for (const t of list) {
  const t0 = Date.now();
  const r = spawnSync(electron, [path.join(__dirname, t)], { cwd: root, encoding: 'utf8', timeout: 15 * 60000 });
  const lines = (r.stdout || '').split('\n').filter(l => !/^\[\d/.test(l));
  const fails = lines.filter(l => /^✗|✗ /.test(l));
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${t} (${Math.round((Date.now() - t0) / 1000)} s) → ${lines.filter(Boolean).pop() || r.error || ''}`);
  for (const l of fails.slice(0, 8)) console.log('    ' + l.slice(0, 300));
}
console.log(`\n${list.length - failed}/${list.length} pruebas de interfaz correctas`);
process.exit(failed ? 1 : 0);
