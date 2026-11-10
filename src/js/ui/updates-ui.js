// Aviso discreto de actualizaciones en la barra de estado: «Nexura X disponible · Descargar» →
// «Descargando 45 %» → «Reiniciar para actualizar». Nunca reinicia con un deck sonando: en ese caso se
// instala al cerrar la app. Sin red o sin versiones nuevas no muestra nada (main/updater.js).
import { el, toast, $ } from '../util.js';
import { platform } from '../platform.js';

export class UpdatesUI {
  constructor(app) {
    this.app = app;
    this.state = { state: 'idle' };
    this.ind = el('span', { class: 'upd-ind', id: 'upd-ind', role: 'status', 'aria-live': 'polite', hidden: true });
    const bar = $('#statusbar');
    if (bar) bar.insertBefore(this.ind, bar.querySelector('.brand'));
    this.off = platform.updates.onEvent((ev) => this.onEvent(ev));
    this.configure();
    app.on('settings', (k) => { if (k === 'autoUpdate' || k === 'prereleaseUpdates') this.configure(); });
  }

  get available() { return platform.updates.available && this.app.info?.updates !== false; }

  configure() {
    const s = this.app.settings;
    return platform.updates.configure({ auto: s.autoUpdate !== false, prerelease: !!s.prereleaseUpdates }).catch(() => {});
  }

  // «Buscar ahora» (Ajustes → General): el resultado se muestra en el propio ajuste (cb) y con un aviso
  async checkNow(cb) {
    this.manualCb = cb;
    if (!this.available) { cb && cb('Las actualizaciones automáticas solo funcionan en la app instalada con el instalador.'); return; }
    cb && cb('Buscando…');
    await platform.updates.check().catch(() => {});
  }

  onEvent(ev) {
    if (!ev) return;
    const cb = this.manualCb;
    if (ev.state === 'checking') return;
    if (ev.state === 'none') { cb && cb(`Tienes la última versión (${this.app.info?.version || ''}).`); this.manualCb = null; return; }
    if (ev.state === 'unsupported') { cb && cb('Las actualizaciones automáticas solo funcionan en la app instalada con el instalador.'); this.manualCb = null; return; }
    if (ev.state === 'error') {
      cb && cb(ev.message || 'No se pudo comprobar ahora.');
      this.manualCb = null;
      if (this.state.state === 'downloading') toast(ev.message || 'No se pudo descargar la actualización.', 'warn', 6000);
      this.state = { state: ev.version ? 'available' : 'idle', version: ev.version };
      return this.render();
    }
    if (ev.state === 'available' && cb) { cb(`Hay una versión nueva: ${ev.version}.`); this.manualCb = null; }
    this.state = ev;
    this.render();
  }

  render() {
    const s = this.state, v = s.version || '';
    const ind = this.ind;
    ind.innerHTML = '';
    ind.hidden = !['available', 'downloading', 'downloaded'].includes(s.state);
    ind.className = 'upd-ind ' + s.state;
    if (s.state === 'available') {
      ind.append(el('span', {}, `Nexura ${v} disponible`), ' · ', el('button', { class: 'upd-act', id: 'upd-download', onclick: () => this.download() }, 'Descargar'));
    } else if (s.state === 'downloading') {
      ind.append(el('span', {}, `Descargando Nexura ${v}… ${s.percent || 0} %`), el('span', { class: 'upd-bar' }, el('i', { style: { width: (s.percent || 0) + '%' } })));
    } else if (s.state === 'downloaded') {
      ind.append(el('span', {}, `Nexura ${v} lista`), ' · ', el('button', { class: 'upd-act', id: 'upd-install', onclick: () => this.install() }, 'Reiniciar para actualizar'));
    }
  }

  async download() {
    this.state = { ...this.state, state: 'downloading', percent: 0 };
    this.render();
    const ok = await platform.updates.download().catch(() => false);
    if (!ok && this.state.state === 'downloading') { this.state.state = 'available'; this.render(); }
  }

  // Nunca en mitad de una sesión: con algún deck sonando se instala al cerrar
  async install() {
    const a = this.app;
    if (a.decks.some(d => d.playing) || a.autoplay?.enabled || a.automix?.enabled) {
      toast('Hay música sonando: la actualización se instalará cuando cierres Nexura DJ Studio.', 'info', 7000);
      return false;
    }
    if (a.engine?.recording) { toast('Estás grabando: la actualización se instalará al cerrar la app.', 'info', 7000); return false; }
    toast('Guardando y reiniciando…', 'info', 3000);
    try { await a.library.save(); await platform.storeSet('settings', a.settings); } catch (_) { /* se instala igualmente */ }
    return platform.updates.install();
  }
}
