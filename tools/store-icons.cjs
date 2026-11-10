// Iconos de Microsoft Store (build/appx/*.png) a partir de build/icon.png: `npm run store:icons`
// (se ejecuta con Electron para dibujar con canvas sin dependencias). Nombres y tamaños que espera
// electron-builder para el objetivo appx.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'build', 'appx');
const BG = '#070b14';
// [archivo, ancho, alto, proporción del icono respecto al lado menor, fondo]
const ASSETS = [
  ['StoreLogo.png', 50, 50, 1, null],
  ['Square44x44Logo.png', 44, 44, 1, null],
  ['SmallTile.png', 71, 71, 0.8, BG],
  ['Square150x150Logo.png', 150, 150, 0.7, BG],
  ['LargeTile.png', 310, 310, 0.6, BG],
  ['Wide310x150Logo.png', 310, 150, 0.7, BG],
  ['SplashScreen.png', 620, 300, 0.6, BG],
  ['BadgeLogo.png', 24, 24, 1, null]
];

app.whenReady().then(async () => {
  const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas></canvas>');
  const res = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(icon)}; await img.decode();
    return ${JSON.stringify(ASSETS)}.map(([name, w, h, k, bg]) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
      const s = Math.round(Math.min(w, h) * k);
      g.drawImage(img, Math.round((w - s) / 2), Math.round((h - s) / 2), s, s);
      return [name, c.toDataURL('image/png')];
    });
  })()`);
  fs.mkdirSync(out, { recursive: true });
  for (const [name, url] of res) fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`Iconos de la Store en ${path.relative(root, out)}: ${res.map(r => r[0]).join(', ')}`);
  app.quit();
});
