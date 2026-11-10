// Paquete para Microsoft Store (.appx): `npm run store`.
// Lee la identidad de build/store-identidad.json (o de STORE_IDENTITY_NAME / STORE_PUBLISHER) y llama a
// electron-builder con el objetivo appx. Sin identidad no hace nada (hay que darla de alta en Partner
// Center; pasos en CLAUDE.md → «Microsoft Store»). La Store firma el paquete al publicarlo y actualiza la
// app ella misma: dentro de la Store el actualizador propio se desactiva (process.windowsStore).
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'build', 'store-identidad.json'), 'utf8'));
const identityName = process.env.STORE_IDENTITY_NAME || cfg.identityName || '';
const publisher = process.env.STORE_PUBLISHER || cfg.publisher || '';
const publisherDisplayName = cfg.publisherDisplayName || 'NexuraIA';

const missing = [];
if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName)) missing.push('identityName (p. ej. 12345NexuraIA.NexuraDJStudio)');
if (!/^CN=/.test(publisher)) missing.push('publisher (p. ej. CN=XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX)');
if (missing.length) {
  console.error('Falta la identidad de Microsoft Store:\n  - ' + missing.join('\n  - ') +
    '\nCópiala de Partner Center (Identidad del producto) en build/store-identidad.json o en las variables STORE_IDENTITY_NAME y STORE_PUBLISHER.');
  process.exit(1);
}
const assets = path.join(root, 'build', 'appx');
if (!fs.existsSync(path.join(assets, 'StoreLogo.png'))) {
  console.error('Faltan los iconos de la Store en build/appx. Genéralos con: npm run store:icons');
  process.exit(1);
}
const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const args = ['--win', 'appx', '--x64', '--publish', 'never',
  `-c.appx.identityName=${identityName}`, `-c.appx.publisher=${publisher}`, `-c.appx.publisherDisplayName=${publisherDisplayName}`];
console.log('electron-builder ' + args.join(' '));
const r = spawnSync(bin, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
process.exit(r.status == null ? 1 : r.status);
