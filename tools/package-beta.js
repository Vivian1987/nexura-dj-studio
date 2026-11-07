// Empaqueta la beta para compartir: dist/Nexura-DJ-Studio-<versión>-beta.zip
// (instalador .exe + LEEME.txt). Se ejecuta después de electron-builder: `npm run beta`.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');
const setupName = `Nexura-DJ-Studio-Setup-${version}.exe`;
const setup = path.join(dist, setupName);
if (!fs.existsSync(setup)) {
  console.error(`No encuentro ${setupName} en dist/. Ejecuta antes: npx electron-builder --win nsis --x64`);
  process.exit(1);
}
const stage = path.join(dist, 'beta');
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });
fs.copyFileSync(setup, path.join(stage, setupName));
const leeme = fs.readFileSync(path.join(__dirname, 'LEEME-beta.txt'), 'utf8')
  .replace(/{{VERSION}}/g, version).replace(/{{SETUP}}/g, setupName)
  .replace(/\r?\n/g, '\r\n'); // saltos de línea de Windows para el Bloc de notas
fs.writeFileSync(path.join(stage, 'LEEME.txt'), '﻿' + leeme, 'utf8');

const zip = path.join(dist, `Nexura-DJ-Studio-${version}.zip`);
fs.rmSync(zip, { force: true });
if (process.platform === 'win32') {
  execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-j', '-q', zip, path.join(stage, setupName), path.join(stage, 'LEEME.txt')], { stdio: 'inherit' });
}
const mb = (fs.statSync(zip).size / 1048576).toFixed(1);
console.log(`\nBeta lista para compartir: ${zip} (${mb} MB)`);
