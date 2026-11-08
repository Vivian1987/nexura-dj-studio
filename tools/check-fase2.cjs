// node --check de todos los archivos tocados en la fase 2
const { execFileSync } = require('child_process');
const files = [
  'src/js/audio/fx.js', 'src/js/audio/worklets/fx-processors.js', 'src/js/audio/worklets/deck-processor.js',
  'src/js/audio/deck.js', 'src/js/audio/grid.js', 'src/js/audio/engine.js', 'src/js/audio/fx-routing.js',
  'src/js/app.js', 'src/js/ui/deck-ui.js', 'src/js/ui/waveform.js', 'src/js/ui/settings-ui.js', 'src/js/ui/fx-ui.js',
  'src/js/midi/midi.js', 'src/js/ai/automix.js', 'src/js/analysis/analysis-core.js',
  'tools/test-fase2.mjs', 'tools/test-grid-synth.mjs', 'tools/fx-check.cjs', 'tools/ui-check-fase2.cjs'
];
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); console.log('ok  ', f); }
  catch (e) { bad++; console.log('FALLO', f, String(e.stderr || e.message).split('\n').slice(0, 4).join('\n')); }
}
process.exit(bad ? 1 : 0);
