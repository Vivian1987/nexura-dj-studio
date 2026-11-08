// Arranca la app de escritorio (main.js) con datos temporales, espera unos segundos, informa de los
// errores de consola del renderer y se cierra. Uso: npx electron tools/start-check.cjs
'use strict';
const { app } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nexura-start-'));
app.setPath('userData', tmp); // no toca la biblioteca ni los ajustes reales
const errors = [], logs = [];
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (_ev, level, message, line, src) => {
    const m = `${message} (${path.basename(src || '')}:${line})`;
    if (level >= 3) errors.push(m); else if (level === 2) logs.push('aviso: ' + m);
  });
  wc.on('render-process-gone', (_ev, d) => errors.push('renderer caído: ' + d.reason));
  wc.on('did-finish-load', async () => {
    try {
      const r = await wc.executeJavaScript(`new Promise(res => setTimeout(() => res({ app: !!window.nexuraApp, decks: window.nexuraApp?.decks?.length, cols: [...document.querySelectorAll('.lib-head .th')].length, fatal: !!document.querySelector('.fatal'), puente: !!(window.nexura && window.nexura.existsMany && window.nexura.artGet && window.nexura.findFiles && window.nexura.openPlaylist) }), 5000))`);
      logs.push('estado: ' + JSON.stringify(r));
    } catch (e) { errors.push('evaluación: ' + e.message); }
  });
});
require('../main.js');
setTimeout(() => {
  console.log(JSON.stringify({ userData: tmp, errores: errors, otros: logs }, null, 2));
  app.exit(errors.length ? 1 : 0);
}, 9000);
