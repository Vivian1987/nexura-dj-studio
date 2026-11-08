// node --check de todos los archivos tocados por la importación de listas de Spotify
const { execFileSync } = require('child_process');
const files = [
  'main.js', 'preload.js', 'src/js/platform.js', 'src/js/app.js', 'src/js/library/library.js',
  'src/js/ui/library-ui.js', 'src/js/ui/settings-ui.js', 'src/js/ui/spotify-ui.js',
  'src/js/spotify/spotify.js', 'src/js/spotify/spotify-core.js',
  'tools/test-spotify.mjs', 'tools/ui-check-spotify.cjs'
];
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); console.log('ok  ', f); }
  catch (e) { bad++; console.log('FALLO', f, String(e.stderr || e.message).split('\n').slice(0, 4).join('\n')); }
}
process.exit(bad ? 1 : 0);
