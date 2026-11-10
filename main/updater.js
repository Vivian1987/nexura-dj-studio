// Actualizaciones automáticas (electron-updater, GitHub Releases de mcontrerasdevpro/nexura-dj-studio;
// la configuración va en «build.publish» de package.json). Se comprueba en segundo plano al arrancar y
// cada 6 h; nunca se descarga ni se reinicia sin que el usuario lo pida. Sin red o sin releases no se
// muestra nada. Las versiones -rc/-beta solo se ofrecen con «Recibir versiones de prueba».
// El objeto autoUpdater se inyecta para poder probar la lógica en Node (tools/test-actualizaciones.mjs).
'use strict';

const EVERY = 6 * 60 * 60 * 1000;

function createUpdater({ autoUpdater, send = () => {}, log = () => {}, beforeInstall = async () => {}, enabled = true, setTimer = setTimeout, setRepeat = setInterval }) {
  const st = { state: enabled ? 'idle' : 'disabled', version: '', percent: 0, manual: false, auto: true, prerelease: false };
  let started = false, repeat = null;
  const emit = () => send({ state: st.state, version: st.version, percent: st.percent });

  if (enabled && autoUpdater) {
    autoUpdater.autoDownload = false;          // descargar solo cuando el usuario pulsa «Descargar»
    autoUpdater.autoInstallOnAppQuit = true;   // descargada y sin reiniciar: se instala al cerrar la app
    autoUpdater.logger = null;
    autoUpdater.on('update-available', (info) => { st.state = 'available'; st.version = (info && info.version) || ''; emit(); });
    autoUpdater.on('update-not-available', () => { if (st.state === 'checking') st.state = 'idle'; if (st.manual) send({ state: 'none' }); });
    autoUpdater.on('download-progress', (p) => { st.state = 'downloading'; st.percent = Math.round((p && p.percent) || 0); emit(); });
    autoUpdater.on('update-downloaded', async (info) => {
      st.version = (info && info.version) || st.version;
      try { await beforeInstall('actualizacion'); st.backedUp = true; } catch (e) { log('WARN', 'Copia antes de actualizar: ' + e.message); }
      st.state = 'downloaded'; st.percent = 100; emit();
    });
    autoUpdater.on('error', (e) => {
      // sin red, sin releases publicadas, GitHub caído…: en las comprobaciones automáticas, silencio
      log('WARN', 'Actualizaciones: ' + ((e && e.message) || e).toString().split('\n')[0].slice(0, 200));
      const wasDownloading = st.state === 'downloading';
      st.state = wasDownloading ? 'available' : (st.version && st.state === 'available' ? 'available' : 'idle');
      // ninguna versión publicada (o ninguna del canal): para el usuario es «no hay novedades»
      if (!wasDownloading && /No published versions|Unable to find latest version|latest\.yml.*404|HttpError: 404/i.test(String((e && e.message) || e))) { if (st.manual) send({ state: 'none' }); return; }
      if (st.manual || wasDownloading) send({ state: 'error', version: st.version, message: wasDownloading ? 'No se pudo descargar la actualización. Inténtalo más tarde.' : 'No se pudo comprobar ahora. Revisa la conexión e inténtalo más tarde.' });
    });
  }

  function applyChannel() {
    if (!autoUpdater) return;
    autoUpdater.allowPrerelease = !!st.prerelease;
    autoUpdater.allowDowngrade = false; // allowPrerelease = true lo activa; nunca bajar de versión
  }

  async function check(manual = false) {
    if (!enabled || !autoUpdater) { if (manual) send({ state: 'unsupported' }); return { state: st.state }; }
    if (['downloading', 'downloaded'].includes(st.state)) { if (manual) emit(); return { state: st.state }; }
    st.manual = manual;
    if (st.state !== 'available') st.state = 'checking';
    if (manual) send({ state: 'checking' });
    applyChannel();
    try { await autoUpdater.checkForUpdates(); } catch (_) { /* lo gestiona el evento «error» */ }
    if (st.state === 'checking') st.state = 'idle';
    return { state: st.state, version: st.version };
  }

  // La interfaz manda los ajustes al arrancar y cada vez que cambian
  function configure({ auto = true, prerelease = false } = {}) {
    const chan = st.prerelease !== !!prerelease;
    st.auto = auto !== false; st.prerelease = !!prerelease;
    if (!enabled) return;
    if (!started) {
      started = true;
      if (st.auto) setTimer(() => check(false), 15000);
      repeat = setRepeat(() => { if (st.auto) check(false); }, EVERY);
    } else if (chan && st.auto && st.state === 'idle') check(false);
  }

  async function download() {
    if (!enabled || st.state !== 'available') return false;
    st.state = 'downloading'; st.percent = 0; emit();
    try { await autoUpdater.downloadUpdate(); return true; } catch (_) { return false; }
  }

  // Reiniciar e instalar (la interfaz ya ha comprobado que no hay ningún deck sonando)
  async function install() {
    if (!enabled || st.state !== 'downloaded') return false;
    if (!st.backedUp) { try { await beforeInstall('actualizacion'); st.backedUp = true; } catch (_) { /* se instala igualmente */ } }
    // instalación silenciosa (sin el asistente ni el mensaje de bienvenida del instalador) y abrir la app
    setTimer(() => autoUpdater.quitAndInstall(true, true), 200);
    return true;
  }

  return { check, configure, download, install, status: () => ({ ...st }), stop: () => repeat && clearInterval(repeat) };
}

module.exports = { createUpdater, EVERY };
