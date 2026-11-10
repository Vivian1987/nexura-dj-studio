// Registro técnico local y rotativo: <datos de usuario>\logs\nexura.log (+ nexura.1.log … nexura.4.log).
// Cada archivo hasta 1 MB; se conservan 5. Solo se guarda en el equipo: el informe de errores envía
// las últimas líneas (anonimizadas) únicamente si el usuario marca «Adjuntar registro técnico».
'use strict';
const fs = require('fs');
const path = require('path');

const LEVELS = new Set(['INFO', 'WARN', 'ERROR']);

function createLogger(dir, { maxSize = 1024 * 1024, maxFiles = 5, perMinute = 200, now = () => Date.now() } = {}) {
  const file = (i) => path.join(dir, i ? `nexura.${i}.log` : 'nexura.log');
  let last = '', repeats = 0, minute = 0, inMinute = 0, dropped = 0;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* sin carpeta: el registro queda desactivado */ }

  function rotate() {
    try {
      fs.rmSync(file(maxFiles - 1), { force: true });
      for (let i = maxFiles - 2; i >= 0; i--) if (fs.existsSync(file(i))) fs.renameSync(file(i), file(i + 1));
    } catch (_) { /* otro proceso tiene el archivo abierto: se reintenta en la siguiente línea */ }
  }
  function append(line) {
    try {
      let size = 0;
      try { size = fs.statSync(file(0)).size; } catch (_) { /* no existe todavía */ }
      if (size + line.length > maxSize && size > 0) rotate();
      fs.appendFileSync(file(0), line);
    } catch (_) { /* disco lleno o sin permisos: nunca romper la app por el registro */ }
  }
  const stamp = () => new Date(now()).toISOString();

  function write(level, source, msg) {
    level = LEVELS.has(String(level).toUpperCase()) ? String(level).toUpperCase() : 'INFO';
    const text = String(msg == null ? '' : msg).replace(/\r?\n/g, ' ⏎ ').slice(0, 2000);
    const key = `${level}|${source}|${text}`;
    // mensajes idénticos seguidos (p. ej. un error en cada fotograma) se resumen en una línea
    if (key === last) { repeats++; return; }
    if (repeats) { append(`${stamp()} [INFO] [log] (la línea anterior se repitió ${repeats} veces más)\n`); repeats = 0; }
    last = key;
    const m = Math.floor(now() / 60000);
    if (m !== minute) {
      if (dropped) append(`${stamp()} [WARN] [log] ${dropped} líneas omitidas por exceso de mensajes\n`);
      minute = m; inMinute = 0; dropped = 0;
    }
    if (++inMinute > perMinute) { dropped++; return; }
    append(`${stamp()} [${level}] [${String(source || 'app').slice(0, 20)}] ${text}\n`);
  }

  // Últimas n líneas (del archivo actual y, si no basta, de los anteriores)
  function tail(n = 200) {
    let lines = [];
    for (let i = 0; i < maxFiles && lines.length < n; i++) {
      let txt;
      try { txt = fs.readFileSync(file(i), 'utf8'); } catch (_) { continue; }
      lines = txt.split('\n').filter(Boolean).concat(lines);
    }
    return lines.slice(-n);
  }

  const files = () => Array.from({ length: maxFiles }, (_, i) => file(i)).filter(f => fs.existsSync(f));
  return { write, tail, files, dir, info: (s, m) => write('INFO', s, m), warn: (s, m) => write('WARN', s, m), error: (s, m) => write('ERROR', s, m) };
}

module.exports = { createLogger };
