// Prueba de todos los efectos con OfflineAudioContext en Electron (Chromium sin interfaz): renderiza 2 s de una
// señal de prueba por cada efecto con el FxUnit real y comprueba que no hay NaN, que el pico es < 1,0 y que con
// wet = 0 la salida es igual a la entrada. Requiere `npm run web`. Uso: npx electron tools/fx-check.cjs
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const URL = process.env.NEXURA_URL || 'http://localhost:5180/index.html';
const OUT = path.join(__dirname, '..', '.revision', 'fase2');
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const PAGE = `(async () => {
  const { EFFECTS, FxUnit } = await import('/js/audio/fx.js');
  const sr = 48000, N = sr * 2;
  // señal de prueba (pico 0,5): bombo a 124 BPM, charles de ruido, acorde y un barrido
  const sig = [new Float32Array(N), new Float32Array(N)];
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  for (let i = 0; i < N; i++) {
    const t = i / sr, bt = t % (60 / 124), ht = (t + 30 / 124) % (60 / 124);
    const kick = 0.3 * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-bt * 30)) * bt) * Math.exp(-bt * 10);
    const hat = 0.08 * rnd() * Math.exp(-ht * 60);
    const chord = 0.035 * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277.2 * t) + Math.sin(2 * Math.PI * 329.6 * t));
    const sweep = 0.02 * Math.sin(2 * Math.PI * (300 + 1500 * t) * t);
    sig[0][i] = kick + hat + chord + sweep; sig[1][i] = kick + hat * 0.8 + chord + sweep * 0.7;
  }
  let inPeak = 0; for (const c of sig) for (const v of c) inPeak = Math.max(inPeak, Math.abs(v));
  const render = async (id, mix, p) => {
    const ctx = new OfflineAudioContext(2, N, sr);
    await ctx.audioWorklet.addModule('/js/audio/worklets/fx-processors.js');
    const b = ctx.createBuffer(2, N, sr); b.copyToChannel(sig[0], 0); b.copyToChannel(sig[1], 1);
    const src = ctx.createBufferSource(); src.buffer = b;
    const u = new FxUnit(ctx, 0);
    u.setBpm(124); u.setBeats(1);
    u.slots[0].param = p; u.slots[0].setEffect(id);
    u.setMix(mix);
    src.connect(u.input); u.output.connect(ctx.destination);
    // como en directo: la unidad ya existe; el efecto se enciende a 0,25 s y se apaga a 1,6 s
    ctx.suspend(ON).then(() => { u.slots[0].setEnabled(true); ctx.resume(); });
    ctx.suspend(OFF).then(() => { u.slots[0].setEnabled(false); ctx.resume(); });
    src.start();
    const t0 = performance.now();
    const out = await ctx.startRendering();
    return { out, ms: performance.now() - t0 };
  };
  const ON = 0.25, OFF = 1.6;
  // mayor salto entre muestras de la entrada (referencia para detectar clics)
  let inStep = 0; for (const c of sig) for (let i = 1; i < N; i++) inStep = Math.max(inStep, Math.abs(c[i] - c[i - 1]));
  const res = [];
  for (const e of EFFECTS) {
    const r = { id: e.id, name: e.name };
    try {
      let nan = false, peak = 0, rms = 0, ms = 0, click = 0;
      const a = Math.round(ON * sr), z = Math.round(OFF * sr);
      for (const p of [0.15, 0.5, 0.95]) {
        const w = await render(e.id, 1, p);
        ms = Math.max(ms, w.ms);
        for (let c = 0; c < 2; c++) {
          const d = w.out.getChannelData(c);
          for (let i = 0; i < N; i++) { const v = d[i]; if (!Number.isFinite(v)) nan = true; else { if (i > 2400) peak = Math.max(peak, Math.abs(v)); if (p === 0.5 && i >= a && i < z) rms += v * v; } }
          // salto entre muestras en los 30 ms tras encender y apagar (relativo al mayor de la entrada)
          for (const s of [a, z]) for (let i = s; i < s + sr * 0.03; i++) click = Math.max(click, Math.abs(d[i] - d[i - 1]) / inStep);
        }
      }
      rms = rms / (2 * (z - a));
      const d0 = await render(e.id, 0, 0.5);
      let dryErr = 0;
      for (let c = 0; c < 2; c++) { const d = d0.out.getChannelData(c); for (let i = Math.round(sr * 0.06); i < N; i++) dryErr = Math.max(dryErr, Math.abs(d[i] - sig[c][i])); }
      Object.assign(r, { nan, peak: +peak.toFixed(4), dryErr: +dryErr.toExponential(2), rms: +Math.sqrt(rms).toFixed(4), click: +click.toFixed(2), renderMs: Math.round(ms), ok: !nan && peak < 1 && dryErr < 1e-3 });
    } catch (err) { Object.assign(r, { ok: false, error: String(err && err.message || err) }); }
    res.push(r);
  }
  let inRms = 0; for (const c of sig) for (const v of c) inRms += v * v;
  return { inPeak: +inPeak.toFixed(4), inRms: +Math.sqrt(inRms / (2 * N)).toFixed(4), n: EFFECTS.length, res };
})()`;

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 800, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  for (let i = 0; i < 4; i++) { try { await win.loadURL(URL); break; } catch (e) { await wait(800); } }
  await wait(1500);
  let out;
  try { out = await win.webContents.executeJavaScript(PAGE, true); } catch (e) { out = { error: String(e && e.message || e) }; }
  out.consoleErrors = errors;
  fs.writeFileSync(path.join(OUT, 'fx-check.json'), JSON.stringify(out, null, 2));
  if (out.res) {
    console.log(`señal de prueba: pico ${out.inPeak} (rms ${out.inRms}) · ${out.n} efectos · render de 2 s (máx. de 3 cantidades)`);
    for (const r of out.res) console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(16)} NaN:${r.nan ? 'sí' : 'no'} pico:${r.peak} wet0-err:${r.dryErr} rms:${r.rms} clic:${r.click} ${r.renderMs} ms${r.error ? ' ERROR ' + r.error : ''}`);
    console.log(out.res.every(r => r.ok) ? 'TODOS OK' : 'HAY FALLOS');
  } else console.log(out);
  app.exit(out.res && out.res.every(r => r.ok) ? 0 : 1);
});
