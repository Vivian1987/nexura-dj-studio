// Textos legales: genera src/legal/TERCEROS.txt (dependencias de producción con su licencia, a partir de
// package-lock.json y node_modules) y deja LICENCIA.txt, PRIVACIDAD.txt y TERCEROS.txt en UTF-8 con BOM y
// saltos de línea de Windows (el instalador NSIS y el Bloc de notas los muestran bien así).
// `npm run legal` (también lo ejecutan `npm run dist`, `release` y `store`).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const legal = path.join(root, 'src', 'legal');
const pkg = require(path.join(root, 'package.json'));
const lock = require(path.join(root, 'package-lock.json'));
const crlf = (s) => s.replace(/^﻿/, '').replace(/\r?\n/g, '\r\n');
const writeTxt = (f, s) => fs.writeFileSync(f, '﻿' + crlf(s), 'utf8');

function licenseText(dir) {
  try {
    const f = fs.readdirSync(dir).find(n => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
    return f ? fs.readFileSync(path.join(dir, f), 'utf8').trim() : '';
  } catch (_) { return ''; }
}

// Paquetes que van dentro de la app: los del lock sin «dev»
const prod = Object.entries(lock.packages || {})
  .filter(([k, v]) => k.startsWith('node_modules/') && !v.dev && !v.devOptional)
  .map(([k, v]) => {
    const dir = path.join(root, k);
    let meta = {};
    try { meta = require(path.join(dir, 'package.json')); } catch (_) { /* sin instalar */ }
    return { name: k.replace(/^.*node_modules\//, ''), version: v.version || meta.version || '', license: v.license || meta.license || 'Desconocida', url: (meta.homepage || (meta.repository && (meta.repository.url || meta.repository)) || '').toString().replace(/^git\+/, ''), text: licenseText(dir) };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const electronVersion = (() => { try { return require(path.join(root, 'node_modules', 'electron', 'package.json')).version; } catch (_) { return pkg.devDependencies.electron; } })();
const electronLicense = licenseText(path.join(root, 'node_modules', 'electron'));

const out = [
  'NEXURA DJ STUDIO — LICENCIAS DE TERCEROS',
  `Versión ${pkg.version} · generado con «npm run legal»`,
  '',
  'Nexura DJ Studio incluye o usa los siguientes componentes de terceros. Cada uno se rige por su propia licencia, cuyo texto se reproduce a continuación.',
  '',
  '== Entorno de ejecución ==',
  '',
  `Electron ${electronVersion} — MIT — https://www.electronjs.org`,
  'Electron incluye Chromium, Node.js y otros componentes; sus licencias completas se instalan junto a la app en los archivos LICENSE.electron.txt y LICENSES.chromium.html (carpeta de instalación).',
  '',
  electronLicense,
  '',
  '== Bibliotecas incluidas ==',
  ''
];
for (const p of prod) {
  out.push(`--- ${p.name} ${p.version} — ${p.license}${p.url ? ' — ' + p.url : ''}`, '');
  if (p.text) out.push(p.text, '');
}
out.push('== Componentes opcionales (no incluidos en el instalador) ==', '',
  'Separación de stems: Demucs (Meta Platforms, Inc.) — MIT — https://github.com/facebookresearch/demucs. Se instala aparte, solo si lo pides en Ajustes → IA, junto con PyTorch (BSD-3-Clause) y sus dependencias.',
  'Asistente de IA por texto: Ollama (MIT) y el modelo que elijas, instalados por ti en tu equipo.',
  '');
writeTxt(path.join(legal, 'TERCEROS.txt'), out.join('\n'));
for (const f of ['LICENCIA.txt', 'PRIVACIDAD.txt']) writeTxt(path.join(legal, f), fs.readFileSync(path.join(legal, f), 'utf8'));
console.log(`TERCEROS.txt: ${prod.length} bibliotecas de producción + Electron ${electronVersion}`);
