// Interfaz de la biblioteca
import { el, fmtTime, camelotCompatible, debounce, uid, keyColor } from '../util.js';
import { btn, select } from './controls.js';
import { SMART_FIELDS, SMART_OPS } from '../library/library.js';
import { ENERGY_MODES } from '../ai/assistant.js';

const ROW_H = 28;
const COLS = [
  { key: 'status', label: '', w: '30px' },
  { key: 'title', label: 'Título', w: 'minmax(160px,2.2fr)' },
  { key: 'artist', label: 'Artista', w: 'minmax(120px,1.5fr)' },
  { key: 'bpm', label: 'BPM', w: '62px' },
  { key: 'camelot', label: 'Key', w: '52px' },
  { key: 'duration', label: 'Duración', w: '70px' },
  { key: 'album', label: 'Álbum', w: 'minmax(80px,1fr)' },
  { key: 'genre', label: 'Género', w: '96px' },
  { key: 'plays', label: 'Repr.', w: '48px' },
  { key: 'added', label: 'Añadida', w: '88px' }
];
// Las anchuras de columna se definen en CSS (--lib-cols) para adaptarlas al tamaño de pantalla; las que
// el usuario ajusta arrastrando el borde de la cabecera se guardan en settings.libColW y se aplican
// sobre las de CSS con --lib-cols-user (definida en #library)
const GRID = 'var(--lib-cols-user, var(--lib-cols))';
const COL_MIN = { status: 24, bpm: 40, camelot: 38, duration: 50, plays: 36, added: 60 };
const SIDE_MIN = 140, SIDE_MAX = 520;
// separa una lista de pistas de grid respetando los paréntesis de minmax(…)
function splitTracks(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of String(s).trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

export class LibraryUI {
  constructor(app, root) {
    this.app = app; this.root = root;
    this.lib = app.library;
    this.viewId = app.settings.libView || 'all';
    this.search = '';
    this.sort = app.settings.libSort || { field: null, dir: 1 };
    this.rows = [];
    this.sel = new Set();
    this.cursor = -1;
    this.anchor = -1;
    this.focus = 'table';
    this.build();
    this.lib.on('change', debounce(() => { this.renderSide(); this.refresh(); }, 60));
    this.lib.on('track', debounce(() => this.refresh(false), 120));
    this.renderSide();
    this.refresh();
  }

  build() {
    this.side = el('aside', { class: 'lib-side', tabindex: 0 });
    this.searchIn = el('input', { class: 'search', type: 'search', placeholder: 'Buscar (título, artista, BPM, tonalidad…) o pegar un enlace de YouTube  ·  Ctrl+F' });
    this.searchIn.addEventListener('input', debounce(() => {
      const v = this.searchIn.value.trim();
      // Si se pega un enlace de YouTube en el buscador, se importa directamente
      if (/^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(v)) {
        this.searchIn.value = ''; this.search = '';
        this.app.ytImport(v);
        return;
      }
      this.search = this.searchIn.value; this.refresh();
    }, 120));
    this.searchIn.addEventListener('keydown', (e) => { if (e.key === 'Escape') { this.searchIn.value = ''; this.search = ''; this.refresh(); this.searchIn.blur(); } if (e.key === 'Enter') this.searchIn.blur(); });
    this.countEl = el('span', { class: 'count' });
    this.viewTitle = el('span', { class: 'view-title' });
    this.aiMode = select(ENERGY_MODES, this.app.ai.mode, (v) => { this.app.ai.setMode(v); this.refresh(); });
    this.aiMode.classList.add('ai-mode');
    this.aiMode.title = 'Qué buscar respecto a la pista que suena';
    this.sideToggle = btn('☰', { cls: 'small lib-side-toggle', title: 'Mostrar u ocultar navegación', onClick: () => document.querySelector('#app')?.classList.toggle('side-expanded') });
    const toolbar = el('div', { class: 'lib-toolbar' },
      this.sideToggle,
      this.viewTitle, this.aiMode, this.searchIn, this.countEl,
      btn('+ Archivos', { cls: 'small', onClick: () => this.app.addFiles(false) }),
      btn('+ Carpeta', { cls: 'small', onClick: () => this.app.addFiles(true) }),
      btn('⇪ Importar', { cls: 'small', title: 'Importar biblioteca de otro programa DJ: BPM, beatgrid, tonalidad, hot cues, loops y listas (colección XML o NML)', onClick: () => this.app.importLibrary() }),
      btn('✨ Pedir set', { cls: 'small ai-btn', title: 'Describe un set con tus palabras y la IA lo crea con tu música', onClick: () => this.app.aiPromptDialog() }),
      btn('Analizar', { cls: 'small', onClick: () => this.app.analyzeMany(this.rows.filter(t => t.source === 'local' && (!t.analyzed || t.sections === undefined))), title: 'Analiza BPM, tonalidad, forma de onda, estructura y energía de las pistas visibles que lo necesiten (respeta tus BPM corregidos)' }));
    this.head = el('div', { class: 'lib-head', style: { gridTemplateColumns: GRID } },
      ...COLS.map(c => {
        const h = el('div', { class: 'th', dataset: { key: c.key } }, c.label);
        h.appendChild(this.colResizer(c.key, h));
        if (c.key !== 'status') h.addEventListener('click', (e) => {
          if (e.target.classList.contains('col-rs')) return;
          // ▲ → ▼ → sin orden (orden propio de la crate o del set)
          this.sort = this.sort.field !== c.key ? { field: c.key, dir: 1 } : this.sort.dir > 0 ? { field: c.key, dir: -1 } : { field: null, dir: 1 };
          this.app.setSetting('libSort', this.sort);
          this.refresh();
        });
        return h;
      }));
    this.scroller = el('div', { class: 'lib-scroll', tabindex: 0 });
    this.spacer = el('div', { class: 'lib-spacer' });
    this.rowsEl = el('div', { class: 'lib-rows' });
    this.scroller.append(this.spacer, this.rowsEl);
    this.scroller.addEventListener('scroll', () => this.renderRows());
    this.scroller.addEventListener('focus', () => { this.focus = 'table'; this.root.classList.remove('side-focus'); });
    this.side.addEventListener('focus', () => { this.focus = 'side'; this.root.classList.add('side-focus'); });
    this.empty = el('div', { class: 'lib-empty' });
    const main = el('div', { class: 'lib-main' }, toolbar, this.head, this.scroller, this.empty);
    // tirador para el ancho de la barra lateral
    this.sideRs = el('div', { class: 'lib-side-rs', title: 'Arrastra para cambiar el ancho · doble clic: ancho por defecto' });
    this.root.append(this.side, main, this.sideRs);
    this.bindSideResizer();
    this.applyColWidths();
    window.addEventListener('resize', () => { this.applyColWidths(); this.placeSideRs(); });
    // soltar archivos del sistema
    main.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); main.classList.add('drop'); } });
    main.addEventListener('dragleave', () => main.classList.remove('drop'));
    main.addEventListener('drop', (e) => { main.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); this.app.importDropped(e.dataTransfer.files, this.viewId.startsWith('crate:') ? this.viewId.slice(6) : null); } });
    new ResizeObserver(() => this.renderRows()).observe(this.scroller);
    new ResizeObserver(() => this.placeSideRs()).observe(this.side);
  }

  // ------------------------------------------------------------ barra lateral
  sideItem(id, label, count, opts = {}) {
    const it = el('div', { class: 'side-item' + (id === this.viewId ? ' on' : '') + (opts.cls ? ' ' + opts.cls : ''), dataset: { view: id } },
      el('span', { class: 'si-ico' }, opts.icon || '•'), el('span', { class: 'si-label' }, label), count != null ? el('span', { class: 'si-count' }, String(count)) : null);
    it.addEventListener('click', () => this.setView(id));
    if (opts.menu) it.addEventListener('contextmenu', (e) => { e.preventDefault(); this.app.contextMenu(e, opts.menu); });
    if (opts.drop) {
      it.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/nexura-track') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); it.classList.add('drop'); } });
      it.addEventListener('dragleave', () => it.classList.remove('drop'));
      it.addEventListener('drop', async (e) => {
        e.preventDefault(); it.classList.remove('drop');
        const ids = e.dataTransfer.getData('text/nexura-track');
        if (ids) opts.drop(ids.split(','));
        else if (e.dataTransfer.files.length) { const added = await this.app.importDropped(e.dataTransfer.files); opts.drop(added.map(t => t.id)); }
      });
    }
    return it;
  }
  section(title, ...actions) { return el('div', { class: 'side-sec' }, el('span', {}, title), el('span', { class: 'sec-actions' }, ...actions)); }

  renderSide() {
    const L = this.lib, s = this.side;
    s.innerHTML = '';
    const local = [...L.tracks.values()].filter(t => t.source === 'local').length;
    const yt = [...L.tracks.values()].filter(t => t.source === 'youtube').length;
    s.append(
      this.section('BIBLIOTECA'),
      this.sideItem('all', 'Todas las pistas', local, { icon: '♫' }),
      this.sideItem('ai:next', 'Siguiente pista (IA)', null, { icon: '✨', cls: 'ai' }),
      this.sideItem('prepare', 'Prepare', L.prepare.length, { icon: '⧉', drop: (ids) => L.addToPrepare(ids), menu: [{ label: 'Vaciar Prepare', fn: () => L.removeFromPrepare([...L.prepare]) }] }),
      this.section('YOUTUBE'),
      el('div', { class: 'side-actions' },
        btn('+ Lista', { cls: 'micro', onClick: () => this.app.ytImportDialog(), title: 'Importar una lista de reproducción de YouTube' }),
        btn('Mis listas', { cls: 'micro', onClick: () => this.app.ytMyPlaylists(), title: 'Listas de tu cuenta de Google' }),
        btn('Buscar', { cls: 'micro', onClick: () => this.app.ytSearchDialog(), title: 'Buscar vídeos en YouTube' })),
      this.sideItem('yt-all', 'Todos los vídeos', yt, { icon: '▶', cls: 'yt' }),
      ...L.ytPlaylists.map(p => this.sideItem('yt:' + p.id, p.title, p.ids.length, {
        icon: '▶', cls: 'yt',
        menu: [
          { label: 'Actualizar desde YouTube', fn: () => this.app.ytImport(p.playlistId) },
          { label: 'Eliminar lista', fn: () => { L.deleteYtPlaylist(p.id); if (this.viewId === 'yt:' + p.id) this.setView('yt-all'); } }
        ]
      })),
      this.section('CRATES', btn('+', { cls: 'micro', title: 'Nueva crate', onClick: async () => { const n = await this.app.prompt('Nombre de la crate', ''); if (n) { const c = L.createCrate(n); this.setView('crate:' + c.id); } } })),
      ...L.crates.map(c => this.sideItem('crate:' + c.id, c.name, c.ids.length, {
        icon: '▣', drop: (ids) => L.addToCrate(c.id, ids),
        menu: [
          { label: 'Renombrar…', fn: async () => { const n = await this.app.prompt('Nombre de la crate', c.name); if (n) L.renameCrate(c.id, n); } },
          ...(this.app.stems.available ? [{ label: '🎚 Separar stems de la crate (segundo plano)', fn: () => { const n = this.app.stems.enqueue(c.ids.map(id => L.get(id))); this.app.toast(n ? `${n} pista(s) en cola de stems` : 'Todas las pistas de la crate ya tienen stems', n ? 'ok' : 'info'); } }] : []),
          { label: 'Eliminar crate', fn: () => { L.deleteCrate(c.id); if (this.viewId === 'crate:' + c.id) this.setView('all'); } }
        ]
      })),
      this.section('SMART CRATES', btn('+', { cls: 'micro', title: 'Nueva smart crate', onClick: () => this.smartEditor() })),
      ...L.smart.map(sc => this.sideItem('smart:' + sc.id, sc.name, null, {
        icon: '✦',
        menu: [
          { label: 'Editar reglas…', fn: () => this.smartEditor(sc) },
          { label: 'Eliminar', fn: () => { L.deleteSmart(sc.id); if (this.viewId === 'smart:' + sc.id) this.setView('all'); } }
        ]
      })),
      this.section('HISTORIAL'),
      ...L.history.slice().reverse().slice(0, 30).map(h => this.sideItem('history:' + h.id,
        new Date(h.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), h.entries.length, {
          icon: '◷',
          menu: [{ label: 'Exportar CSV', fn: () => this.app.exportHistory(h.id) }]
        })));
    this.sideItems = [...s.querySelectorAll('.side-item')];
  }

  setView(id) {
    this.viewId = id;
    this.app.setSetting('libView', id);
    this.sel.clear(); this.cursor = -1;
    for (const it of this.side.querySelectorAll('.side-item')) it.classList.toggle('on', it.dataset.view === id);
    this.refresh();
    this.scroller.scrollTop = 0;
  }

  viewName() {
    const id = this.viewId, L = this.lib;
    if (id === 'all') return 'Todas las pistas';
    if (id === 'prepare') return 'Prepare';
    if (id === 'ai:next') return 'Siguiente pista (IA)';
    if (id === 'yt-all') return 'YouTube';
    const [k, v] = id.split(':');
    if (k === 'crate') return (L.crates.find(c => c.id === v) || {}).name || 'Crate';
    if (k === 'smart') return (L.smart.find(c => c.id === v) || {}).name || 'Smart crate';
    if (k === 'yt') return (L.ytPlaylists.find(c => c.id === v) || {}).title || 'Lista';
    if (k === 'history') return 'Historial';
    return '';
  }

  // ------------------------------------------------------------ tabla
  refresh(resetScroll = false) {
    const keepId = this.cursor >= 0 && this.rows[this.cursor] ? this.rows[this.cursor].id : null;
    const isAi = this.viewId === 'ai:next';
    this.root.classList.toggle('ai-view', isAi);
    if (isAi) {
      const q = this.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      this.rows = this.app.ai.suggest(80).filter(t => !q.length || q.every(tok => `${t.title} ${t.artist} ${t.genre} ${t.camelot} ${t.bpm ? Math.round(t.bpm) : ''}`.toLowerCase().includes(tok)));
    } else this.rows = this.lib.query(this.viewId, this.search, this.viewId.startsWith('history:') && !this.sort.field ? null : this.sort);
    if (keepId) this.cursor = this.rows.findIndex(r => r.id === keepId);
    this.countEl.textContent = this.rows.length + ' pistas';
    this.viewTitle.textContent = this.viewName();
    for (const h of this.head.children) {
      h.classList.toggle('sorted', h.dataset.key === this.sort.field);
      h.dataset.dir = this.sort.dir > 0 ? '▲' : '▼';
    }
    this.spacer.style.height = this.rows.length * ROW_H + 'px';
    const empty = !this.rows.length;
    this.empty.style.display = empty ? 'flex' : 'none';
    if (empty) {
      this.empty.innerHTML = '';
      if (this.viewId === 'all' && !this.search) this.empty.append(el('div', {}, el('h3', {}, 'Tu biblioteca está vacía'), el('p', {}, 'Arrastra aquí archivos o carpetas de música, o usa «+ Carpeta».')));
      else if (this.viewId === 'ai:next' && !this.app.ai.refDeck()) this.empty.append(el('div', {}, el('h3', {}, '✨ Sugerencias de la IA'), el('p', {}, 'Carga una pista en un deck y aquí verás las que mejor mezclan con ella: tonalidad compatible, BPM cercano y energía.')));
      else if (this.viewId === 'ai:next') this.empty.append(el('p', {}, 'No hay pistas analizadas que encajen. Analiza tu biblioteca con «Analizar».'));
      else if (this.viewId.startsWith('yt') && !this.search) this.empty.append(el('div', {}, el('h3', {}, 'Sin vídeos de YouTube'), el('p', {}, 'Pulsa «+ Lista» en la barra lateral y pega la URL de una lista de reproducción.')));
      else this.empty.append(el('p', {}, 'No hay resultados.'));
    }
    if (resetScroll) this.scroller.scrollTop = 0;
    this.renderRows();
  }

  activeKey() {
    const playing = this.app.decks.filter(d => d.track && d.playing);
    const d = playing.length ? playing[playing.length - 1] : this.app.decks.find(d => d.track);
    return d ? d.displayKey : '';
  }

  // ---------------------------------------------------------------- tamaños ajustables
  colResizer(key, th) {
    const h = el('span', { class: 'col-rs', title: 'Arrastra para cambiar el ancho · doble clic: ancho automático' });
    h.addEventListener('click', (e) => e.stopPropagation());
    h.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const w = { ...(this.app.settings.libColW || {}) }; delete w[key];
      this.app.setSetting('libColW', w); this.applyColWidths();
    });
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      h.setPointerCapture(e.pointerId);
      // al empezar se fijan los anchos actuales de todas las columnas visibles (así solo cambia esta)
      const w = { ...(this.app.settings.libColW || {}) };
      for (const t of this.head.children) if (t.offsetWidth && !w[t.dataset.key]) w[t.dataset.key] = Math.round(t.getBoundingClientRect().width);
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width, min = COL_MIN[key] || 70;
      document.body.classList.add('resizing-col');
      const move = (ev) => { w[key] = Math.round(Math.max(min, Math.min(900, w0 + ev.clientX - x0))); this.applyColWidths(w); };
      const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-col');
        this.app.setSetting('libColW', w);
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    return h;
  }
  applyColWidths(w = this.app.settings.libColW || {}) {
    if (!Object.keys(w).length) { this.root.style.removeProperty('--lib-cols-user'); return; }
    // columnas visibles en este tamaño de pantalla (las ocultas por CSS no tienen pista en el grid)
    const base = splitTracks(getComputedStyle(this.head).getPropertyValue('--lib-cols'));
    const cols = base.map((tr, i) => (COLS[i] && w[COLS[i].key] ? w[COLS[i].key] + 'px' : tr));
    // si todas son fijas, la última absorbe el espacio sobrante
    if (cols.every(c => /px$/.test(c)) && cols.length) cols[cols.length - 1] = `minmax(${cols[cols.length - 1]}, 1fr)`;
    this.root.style.setProperty('--lib-cols-user', cols.join(' '));
  }
  bindSideResizer() {
    const h = this.sideRs;
    const saved = this.app.settings.libSideW;
    if (saved) this.root.style.setProperty('--side-w', saved + 'px');
    h.addEventListener('dblclick', () => { this.root.style.removeProperty('--side-w'); this.app.setSetting('libSideW', null); });
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); h.setPointerCapture(e.pointerId);
      const x0 = e.clientX, w0 = this.side.getBoundingClientRect().width;
      const max = Math.min(SIDE_MAX, this.root.getBoundingClientRect().width * 0.5);
      let w = w0;
      document.body.classList.add('resizing-col');
      const move = (ev) => { w = Math.round(Math.max(SIDE_MIN, Math.min(max, w0 + ev.clientX - x0))); this.root.style.setProperty('--side-w', w + 'px'); };
      const up = () => {
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing-col');
        this.app.setSetting('libSideW', w);
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  }
  placeSideRs() {
    const w = this.side.offsetWidth;
    this.sideRs.hidden = !w || w > this.root.offsetWidth * 0.8; // en móvil la barra va encima: sin tirador
    if (w) this.sideRs.style.left = (this.side.offsetLeft + w) + 'px';
    this.applyColWidths();
  }

  renderRows() {
    const top = this.scroller.scrollTop, h = this.scroller.clientHeight || 300;
    const first = Math.max(0, Math.floor(top / ROW_H) - 5);
    const last = Math.min(this.rows.length, Math.ceil((top + h) / ROW_H) + 5);
    const loaded = new Map(this.app.decks.filter(d => d.track).map(d => [d.track.id, d.idx]));
    const played = new Set((this.lib.session ? this.lib.session.entries : []).map(e => e.id));
    const akey = this.activeKey();
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const t = this.rows[i];
      const deckIdx = loaded.get(t.id);
      const ai = this.viewId === 'ai:next' ? this.app.ai.scores.get(t.id) : null;
      const status = ai
        ? el('span', { class: 'st ai-score', title: ai.reasons.join(' · '), style: `--s:${ai.score.toFixed(2)}` }, String(Math.round(ai.score * 100)))
        : el('span', { class: 'st' + (deckIdx != null ? ' deck' + deckIdx : '') },
          deckIdx != null ? String(deckIdx + 1) : t.source === 'youtube' ? '▶' : (t.analyzed ? (played.has(t.id) ? '✓' : '') : '○'));
      const r = el('div', {
        class: 'row-t' + (this.sel.has(t.id) ? ' sel' : '') + (i === this.cursor ? ' cur' : '') + (i % 2 ? ' odd' : '') + (played.has(t.id) ? ' played' : '') + (t.source === 'youtube' ? ' yt' : ''),
        style: { top: i * ROW_H + 'px', gridTemplateColumns: GRID }, draggable: 'true', dataset: { i }
      },
        status,
        el('span', { class: 'c-title', title: ai ? ai.reasons.join(' · ') : '' }, t.title || '—', t.energy ? el('small', { class: 'nrg', title: 'Energía estimada por la IA (1-10)' }, '⚡' + t.energy) : null, t.stems ? el('small', { class: 'stm', title: 'Stems separados (voz, batería, bajo, melodía)' }, 'STEMS') : null),
        el('span', {}, t.artist || ''),
        el('span', { class: 'num' }, t.bpm ? (Math.round(t.bpm * 10) / 10).toString() : ''),
        el('span', { class: 'num key' + (akey && camelotCompatible(akey, t.camelot) ? ' compat' : ''), style: { color: keyColor(t.camelot) } }, (akey && camelotCompatible(akey, t.camelot) ? '◉ ' : '') + (t.camelot || t.key || '')),
        el('span', { class: 'num' }, t.duration ? fmtTime(t.duration, false) : ''),
        el('span', {}, t.album || ''),
        el('span', {}, t.genre || ''),
        el('span', { class: 'num' }, t.plays ? String(t.plays) : ''),
        el('span', { class: 'num dim' }, t.added ? new Date(t.added).toLocaleDateString('es-ES') : ''));
      r.addEventListener('pointerdown', (e) => this.onRowDown(e, i));
      r.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!this.sel.has(t.id)) this.selectOnly(i); this.rowMenu(e); });
      r.addEventListener('dragstart', (e) => {
        const ids = this.sel.has(t.id) ? [...this.sel] : [t.id];
        e.dataTransfer.setData('text/nexura-track', ids.join(','));
        e.dataTransfer.effectAllowed = 'copy';
      });
      frag.appendChild(r);
    }
    this.rowsEl.innerHTML = '';
    this.rowsEl.appendChild(frag);
  }

  onRowDown(e, i) {
    if (e.button === 2) return;
    // doble clic propio: la fila se redibuja en cada pulsación y el evento dblclick nativo se pierde
    const now = performance.now();
    if (!e.shiftKey && !e.ctrlKey && !e.metaKey && this.lastDown && this.lastDown.i === i && now - this.lastDown.at < 450) {
      this.lastDown = null;
      const t = this.rows[i];
      if (t) this.app.loadToDeck(t.id, this.app.freeDeckIndex());
      return;
    }
    this.lastDown = { i, at: now };
    this.scroller.focus({ preventScroll: true });
    const t = this.rows[i];
    if (e.shiftKey && this.anchor >= 0) {
      this.sel.clear();
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      for (let k = a; k <= b; k++) this.sel.add(this.rows[k].id);
    } else if (e.ctrlKey || e.metaKey) {
      this.sel.has(t.id) ? this.sel.delete(t.id) : this.sel.add(t.id);
      this.anchor = i;
    } else if (!this.sel.has(t.id)) {
      this.sel.clear(); this.sel.add(t.id); this.anchor = i;
    }
    this.cursor = i;
    this.renderRows();
  }
  selectOnly(i) { this.sel.clear(); if (this.rows[i]) this.sel.add(this.rows[i].id); this.cursor = this.anchor = i; this.renderRows(); }
  selected() { return this.rows.filter(t => this.sel.has(t.id)); }
  current() { return this.rows[this.cursor] || this.selected()[0] || null; }

  // Navegación (teclado / encoder de la controladora)
  move(delta) {
    if (this.focus === 'side') {
      const items = this.sideItems || [];
      let i = items.findIndex(it => it.dataset.view === this.viewId);
      i = Math.max(0, Math.min(items.length - 1, i + delta));
      if (items[i]) { this.setView(items[i].dataset.view); items[i].scrollIntoView({ block: 'nearest' }); }
      return;
    }
    if (!this.rows.length) return;
    const i = Math.max(0, Math.min(this.rows.length - 1, (this.cursor < 0 ? -1 : this.cursor) + delta));
    this.selectOnly(i);
    const top = i * ROW_H, st = this.scroller.scrollTop, h = this.scroller.clientHeight;
    if (top < st) this.scroller.scrollTop = top;
    else if (top + ROW_H > st + h) this.scroller.scrollTop = top + ROW_H - h;
  }
  toggleFocus(to) {
    this.focus = to || (this.focus === 'side' ? 'table' : 'side');
    this.root.classList.toggle('side-focus', this.focus === 'side');
    (this.focus === 'side' ? this.side : this.scroller).focus({ preventScroll: true });
  }

  rowMenu(e) {
    const app = this.app, L = this.lib;
    const sel = this.selected();
    const ids = sel.map(t => t.id);
    const one = sel[0];
    const items = [
      { label: 'Cargar en Deck 1', fn: () => app.loadToDeck(one.id, 0) },
      { label: 'Cargar en Deck 2', fn: () => app.loadToDeck(one.id, 1) },
      ...(app.deckCount === 4 ? [{ label: 'Cargar en Deck 3', fn: () => app.loadToDeck(one.id, 2) }, { label: 'Cargar en Deck 4', fn: () => app.loadToDeck(one.id, 3) }] : []),
      { label: 'Añadir a Prepare', fn: () => L.addToPrepare(ids) },
      { label: 'Añadir a crate', sub: [...L.crates.map(c => ({ label: c.name, fn: () => L.addToCrate(c.id, ids) })), { label: '+ Nueva crate…', fn: async () => { const n = await app.prompt('Nombre de la crate', ''); if (n) L.addToCrate(L.createCrate(n).id, ids); } }] }
    ];
    if (one && one.source === 'local') {
      items.push({ label: 'Cargar en sampler', sub: Array.from({ length: 8 }, (_, i) => ({ label: 'Ranura ' + (i + 1), fn: () => { app.sampler.loadSlot(i, one.path, one.title); app.saveSamplerSoon(); } })) });
      items.push({ label: 'Volver a analizar', fn: () => app.analyzeMany(sel.filter(t => t.source === 'local'), true) });
      items.push({ label: '✨ Cues automáticos (IA)', fn: () => app.aiAutoCues(sel) });
      items.push({ label: 'Leer cues y beatgrid guardados en el archivo', fn: () => app.readMarkersFromFiles(sel) });
      if (app.stems.available) {
        const loc = sel.filter(t => t.source === 'local'), withSt = loc.filter(t => t.stems);
        items.push({ label: withSt.length === loc.length ? '🎚 Volver a separar stems (IA)' : '🎚 Separar stems (IA)', fn: () => app.stems.separate(loc, withSt.length === loc.length) });
        if (withSt.length) items.push({ label: 'Borrar stems', fn: async () => { if (await app.confirm(`¿Borrar los stems de ${withSt.length} pista(s)? Se pueden volver a separar.`)) app.stems.remove(withSt); } });
      }
      if (app.platform.showItem && window.nexura) items.push({ label: 'Mostrar en carpeta', fn: () => app.platform.showItem(one.path) });
    }
    if (one && one.source === 'youtube') items.push({ label: 'Abrir en YouTube', fn: () => app.platform.openExternal('https://www.youtube.com/watch?v=' + one.ytId) });
    if (one && (one.bpm || one.camelot)) items.push({ label: '✨ Crear set desde esta pista (IA)…', fn: () => app.aiBuildSet(one) });
    items.push({ label: 'Editar…', fn: () => this.editTrack(one) });
    if (this.viewId.startsWith('crate:')) items.push({ label: 'Quitar de la crate', fn: () => L.removeFromCrate(this.viewId.slice(6), ids) });
    if (this.viewId === 'prepare') items.push({ label: 'Quitar de Prepare', fn: () => L.removeFromPrepare(ids) });
    items.push({ label: `Eliminar de la biblioteca (${ids.length})`, danger: true, fn: async () => { if (await app.confirm(`¿Quitar ${ids.length} pista(s) de la biblioteca? Los archivos no se borran del disco.`)) L.remove(ids); } });
    app.contextMenu(e, items);
  }

  async editTrack(t) {
    if (!t) return;
    const f = {};
    const field = (k, label) => { f[k] = el('input', { value: t[k] ?? '' }); return el('label', { class: 'frm' }, el('span', {}, label), f[k]); };
    const body = el('div', { class: 'form' }, field('title', 'Título'), field('artist', 'Artista'), field('album', 'Álbum'), field('genre', 'Género'), field('bpm', 'BPM'), field('camelot', 'Tonalidad (Camelot, p. ej. 8A)'), field('comment', 'Comentario'));
    const ok = await this.app.modal('Editar pista', body, ['Cancelar', 'Guardar']);
    if (ok !== 1) return;
    const patch = {};
    for (const k of Object.keys(f)) patch[k] = f[k].value.trim();
    patch.bpm = parseFloat(String(patch.bpm).replace(',', '.')) || null;
    if (patch.bpm !== t.bpm) patch.bpmLocked = true;
    if (patch.camelot !== t.camelot) patch.keyLocked = true;
    patch.camelot = patch.camelot.toUpperCase();
    this.lib.update(t.id, patch);
    this.refresh();
  }

  async smartEditor(sc) {
    const edit = sc ? JSON.parse(JSON.stringify(sc)) : { id: uid(), name: 'Nueva smart crate', match: 'all', rules: [{ field: 'genre', op: 'contains', value: '' }] };
    const name = el('input', { value: edit.name });
    const match = select({ all: 'Cumplir todas las reglas', any: 'Cumplir alguna regla' }, edit.match, (v) => { edit.match = v; });
    const rulesEl = el('div', { class: 'rules' });
    const renderRules = () => {
      rulesEl.innerHTML = '';
      edit.rules.forEach((r, i) => {
        const v1 = el('input', { value: r.value || '', placeholder: 'valor' });
        v1.addEventListener('input', () => { r.value = v1.value; });
        const v2 = el('input', { value: r.value2 || '', placeholder: 'hasta', style: { display: r.op === 'between' ? '' : 'none' } });
        v2.addEventListener('input', () => { r.value2 = v2.value; });
        rulesEl.appendChild(el('div', { class: 'rule' },
          select(SMART_FIELDS, r.field, (v) => { r.field = v; }),
          select(SMART_OPS, r.op, (v) => { r.op = v; v2.style.display = v === 'between' ? '' : 'none'; }),
          v1, v2,
          btn('✕', { cls: 'micro', onClick: () => { edit.rules.splice(i, 1); renderRules(); } })));
      });
    };
    renderRules();
    const body = el('div', { class: 'form' }, el('label', { class: 'frm' }, el('span', {}, 'Nombre'), name), match, rulesEl,
      btn('+ Regla', { cls: 'small', onClick: () => { edit.rules.push({ field: 'bpm', op: 'between', value: '120', value2: '130' }); renderRules(); } }));
    const ok = await this.app.modal(sc ? 'Editar smart crate' : 'Nueva smart crate', body, ['Cancelar', 'Guardar']);
    if (ok !== 1) return;
    edit.name = name.value.trim() || 'Smart crate';
    this.lib.saveSmart(edit);
    this.setView('smart:' + edit.id);
  }
}
