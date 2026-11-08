// Interfaz de la biblioteca
import { el, fmtTime, camelotCompatible, debounce, uid, keyColor, CUE_COLORS } from '../util.js';
import { btn, select } from './controls.js';
import { SMART_FIELDS, SMART_OPS, CRATE_SORTS } from '../library/library.js';
import { cratePath, pathLabel, effectiveColor } from '../library/crate-tree.js';
import { COLUMNS, COL_BY_KEY, DEFAULT_COLS, visibleColumns, columnTemplate, columnsFor } from '../library/columns.js';
import { ENERGY_MODES } from '../ai/assistant.js';

// Columnas: catálogo en library/columns.js. Las que se ven dependen de las elegidas por el usuario
// (clic derecho en la cabecera; settings.libCols o, por crate, settings.libColsByView) y de cuántas caben
// (--lib-max en el CSS de cada tamaño de pantalla). La plantilla resultante va en --lib-cols (en #library)
// con los anchos que el usuario ajusta arrastrando el borde de la cabecera (settings.libColW).
const GRID = 'var(--lib-cols)';
const SIDE_MIN = 140, SIDE_MAX = 520;
const ART_SIZES = { small: { row: 28, col: 30 }, medium: { row: 44, col: 46 } };
// 1 h 05 min / 42 min
const fmtTotal = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };

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
    this.cols = [];
    this.rowH = 28;
    this.missing = new Map();   // id → true (perdido) / false (existe); comprobado en esta sesión
    this.art = new Map();       // id → data: URL | null (sin carátula) | 'pending'
    this.checkMissingSoon = debounce(() => this.checkMissing(), 250);
    this.loadArtSoon = debounce(() => this.loadArt(), 120);
    this.build();
    this.lib.on('change', debounce(() => { this.renderSide(); this.refresh(); }, 60));
    this.lib.on('track', debounce(() => this.refresh(false), 120));
    app.on('settings', (k) => {
      if (k === 'protectLibrary') this.refreshLock();
      if (k === 'libColsSame' || k === 'libArtSize') this.relayout();
    });
    this.renderSide();
    this.relayout();
  }

  build() {
    this.side = el('aside', { class: 'lib-side', tabindex: 0 });
    this.searchIn = el('input', { class: 'search', type: 'search', placeholder: 'Buscar (título, artista, BPM, tonalidad…) o pegar un enlace de YouTube o Spotify  ·  Ctrl+F' });
    this.searchIn.addEventListener('input', debounce(() => {
      const v = this.searchIn.value.trim();
      // Si se pega un enlace de YouTube en el buscador, se importa directamente
      if (/^(https?:\/\/)?(www\.|m\.|music\.)?(youtube\.com|youtu\.be)\//i.test(v)) {
        this.searchIn.value = ''; this.search = '';
        this.app.ytImport(v);
        return;
      }
      // y uno de Spotify abre el diálogo de importación
      if (/^(https?:\/\/)?(open|play)\.spotify\.com\/|^spotify:(user:[^:]+:)?(playlist|album|track):/i.test(v)) {
        this.searchIn.value = ''; this.search = '';
        this.app.spotifyImportDialog(v);
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
    this.lockBtn = btn('🔓', { cls: 'small lib-lock', onClick: () => this.app.setSetting('protectLibrary', !this.app.settings.protectLibrary) });
    const toolbar = el('div', { class: 'lib-toolbar' },
      this.sideToggle,
      this.viewTitle, this.aiMode, this.searchIn, this.countEl, this.lockBtn,
      btn('+ Archivos', { cls: 'small', onClick: () => this.app.addFiles(false) }),
      btn('+ Carpeta', { cls: 'small', onClick: () => this.app.addFiles(true) }),
      btn('⇪ Importar', { cls: 'small', title: 'Importar biblioteca de otro programa DJ: BPM, beatgrid, tonalidad, hot cues, loops y listas (colección XML o NML)', onClick: () => this.app.importLibrary() }),
      btn('✨ Pedir set', { cls: 'small ai-btn', title: 'Describe un set con tus palabras y la IA lo crea con tu música', onClick: () => this.app.aiPromptDialog() }),
      btn('Analizar', { cls: 'small', onClick: () => this.app.analyzeMany(this.rows.filter(t => t.source === 'local' && (!t.analyzed || t.sections === undefined))), title: 'Analiza BPM, tonalidad, forma de onda, estructura y energía de las pistas visibles que lo necesiten (respeta tus BPM corregidos)' }));
    this.head = el('div', { class: 'lib-head', style: { gridTemplateColumns: GRID }, title: 'Clic: ordenar · clic derecho: elegir columnas' });
    this.head.addEventListener('contextmenu', (e) => { e.preventDefault(); this.columnsMenu(e); });
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
    // al cambiar de tamaño de pantalla cambia cuántas columnas caben (--lib-max)
    window.addEventListener('resize', () => { if (this.colMax() !== this._max) this.relayout(); else this.applyColWidths(); this.placeSideRs(); });
    // soltar archivos del sistema (las listas .m3u/.m3u8 se importan como crate)
    main.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); main.classList.add('drop'); } });
    main.addEventListener('dragleave', () => main.classList.remove('drop'));
    main.addEventListener('drop', (e) => { main.classList.remove('drop'); if (e.dataTransfer.files.length) { e.preventDefault(); this.dropFiles(e.dataTransfer.files, this.viewId.startsWith('crate:') ? this.viewId.slice(6) : null); } });
    new ResizeObserver(() => this.renderRows()).observe(this.scroller);
    new ResizeObserver(() => this.placeSideRs()).observe(this.side);
  }

  // ------------------------------------------------------------ barra lateral
  sideItem(id, label, count, opts = {}) {
    const it = el('div', { class: 'side-item' + (id === this.viewId ? ' on' : '') + (opts.cls ? ' ' + opts.cls : ''), dataset: { view: id }, title: opts.title || null },
      opts.twisty || null,
      el('span', { class: 'si-ico', style: opts.color ? { color: opts.color } : null }, opts.icon || '•'), el('span', { class: 'si-label' }, label), count != null ? el('span', { class: 'si-count' }, String(count)) : null);
    if (opts.depth) it.style.setProperty('--depth', opts.depth);
    it.addEventListener('click', () => this.setView(id));
    if (opts.menu) it.addEventListener('contextmenu', (e) => { e.preventDefault(); this.app.contextMenu(e, typeof opts.menu === 'function' ? opts.menu() : opts.menu); });
    // crates: arrastrar una crate sobre otra la convierte en su subcrate; con el orden personalizado,
    // soltarla en el borde superior/inferior la coloca delante/detrás en ese nivel
    if (opts.crateId) {
      it.draggable = true;
      it.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/nexura-crate', opts.crateId); e.dataTransfer.effectAllowed = 'move'; });
    }
    const zone = (e) => {
      if (this.app.settings.crateSort !== 'custom') return 'into';
      const r = it.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
      return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'into';
    };
    const clear = () => it.classList.remove('drop', 'drop-before', 'drop-after');
    if (opts.drop || opts.crateId) {
      const ok = (e) => (opts.drop && (e.dataTransfer.types.includes('text/nexura-track') || e.dataTransfer.types.includes('Files'))) || (opts.crateId && e.dataTransfer.types.includes('text/nexura-crate'));
      it.addEventListener('dragover', (e) => {
        if (!ok(e)) return;
        e.preventDefault(); clear();
        const z = opts.crateId && e.dataTransfer.types.includes('text/nexura-crate') ? zone(e) : 'into';
        it.classList.add(z === 'into' ? 'drop' : 'drop-' + z);
      });
      it.addEventListener('dragleave', clear);
      it.addEventListener('drop', async (e) => {
        e.preventDefault(); clear();
        const crate = e.dataTransfer.getData('text/nexura-crate');
        if (crate && opts.crateId) return this.dropCrate(crate, opts.crateId, zone(e));
        if (!opts.drop) return;
        const ids = e.dataTransfer.getData('text/nexura-track');
        if (ids) opts.drop(ids.split(','));
        else if (e.dataTransfer.files.length) { const added = await this.dropFiles(e.dataTransfer.files, null, opts.crateId || null); if (added.length) opts.drop(added.map(t => t.id)); }
      });
    }
    return it;
  }
  section(title, ...actions) { return el('div', { class: 'side-sec' }, el('span', {}, title), el('span', { class: 'sec-actions' }, ...actions)); }

  // Soltar una crate: dentro de otra (subcrate) o delante/detrás de ella en su nivel
  dropCrate(id, target, z) {
    const L = this.lib;
    if (id === target) return;
    if (z === 'into') {
      if (L.subcrateIds(id).includes(target)) return this.app.toast('No se puede meter una crate dentro de uno de sus subcrates', 'warn');
      if (L.setCrateParent(id, target)) this.expandCrate(target);
    } else if (!L.moveCrate(id, target, z === 'after') && !L.protected) this.app.toast('No se puede meter una crate dentro de uno de sus subcrates', 'warn');
  }

  // Archivos soltados: las listas .m3u/.m3u8 se importan como crate (dentro de «listParent» si se sueltan
  // sobre una crate de la barra lateral); el resto, como pistas
  async dropFiles(fileList, crateId = null, listParent = null) {
    const files = [...fileList];
    const lists = files.filter(f => /\.m3u8?$/i.test(f.name));
    if (lists.length) await this.app.importPlaylists(await Promise.all(lists.map(f => this.app.platform.playlistFromFile(f))), listParent);
    const rest = files.filter(f => !lists.includes(f));
    return rest.length ? this.app.importDropped(rest, crateId) : [];
  }

  // --- árbol de crates (subcrates)
  collapsedCrates() { return new Set(this.app.settings.crateCollapsed || []); }
  setCrateOpen(id, open) {
    const s = this.collapsedCrates();
    if (open === !s.has(id)) return;
    if (open) s.delete(id); else s.add(id);
    this.app.setSetting('crateCollapsed', [...s].filter(x => this.lib.crate(x)));
    this.renderSide();
  }
  // despliega los antepasados de «id» (y la propia) para que se vea
  expandCrate(id) {
    const s = this.collapsedCrates(), path = cratePath(this.lib.crates, id);
    if (!path.some(c => s.has(c.id))) return;
    for (const c of path) s.delete(c.id);
    this.app.setSetting('crateCollapsed', [...s]);
    this.renderSide();
  }
  crateLabel(c) { return c ? pathLabel(this.lib.crates, c.id) : ''; }
  // Lista de crates para submenús («Añadir a crate», «Mover a…»), sangrada según la profundidad
  crateChoices(fn, filter = null) {
    return this.lib.crateTree(this.app.settings.crateSort, null, true).filter(x => !filter || filter(x.c)).map(({ c, depth }) => ({
      label: ' '.repeat(depth) + (depth ? '└ ' : '') + c.name, color: effectiveColor(this.lib.crates, c.id).color, fn: () => fn(c)
    }));
  }
  async newCrate(parent = null) {
    const L = this.lib;
    if (!L.guard('crate')) return null;
    const n = await this.app.prompt(parent ? `Nuevo subcrate en «${this.crateLabel(L.crate(parent))}»` : 'Nombre de la crate', '');
    const c = n && L.createCrate(n, parent);
    if (c) { if (parent) this.expandCrate(parent); this.setView('crate:' + c.id); }
    return c;
  }
  async deleteCrateAsk(c) {
    const L = this.lib;
    if (!L.guard('crate')) return;
    const subs = L.subcrateIds(c.id);
    let mode = 'all';
    if (subs.length) {
      const r = await this.app.modal('Eliminar crate', el('p', {}, `«${this.crateLabel(c)}» tiene ${subs.length} subcrate(s). ¿Qué hago con ellos? Las pistas siguen en la biblioteca.`), ['Cancelar', 'Borrar también los subcrates', 'Subirlos un nivel']);
      if (r < 1) return;
      mode = r === 1 ? 'all' : 'lift';   // el botón principal (Intro) es el que no borra nada más
    } else if (!await this.app.confirm(`¿Eliminar la crate «${this.crateLabel(c)}»? Las pistas siguen en la biblioteca.`)) return;
    const removed = L.deleteCrate(c.id, mode);
    if (removed && removed.some(id => this.viewId === 'crate:' + id)) this.setView('all');
  }

  crateMenu(c) {
    const L = this.lib, parent = L.crate(c.parent);
    const banned = new Set([c.id, ...L.subcrateIds(c.id)]);
    return [
      { label: 'Nuevo subcrate…', fn: () => this.newCrate(c.id) },
      { label: 'Renombrar…', fn: async () => { if (!L.guard('crate')) return; const n = await this.app.prompt('Nombre de la crate', c.name); if (n) L.renameCrate(c.id, n); } },
      { label: 'Color', sub: [...CUE_COLORS.map(col => ({ label: '●', color: col, fn: () => L.setCrateColor(c.id, col) })), { label: parent ? 'Sin color (el de la crate padre)' : 'Sin color', fn: () => L.setCrateColor(c.id, null) }] },
      { label: 'Mover a…', sub: [
        { label: (parent ? '' : '✓ ') + 'Raíz (CRATES)', fn: () => L.setCrateParent(c.id, null) },
        ...this.crateChoices((p) => { if (L.setCrateParent(c.id, p.id)) this.expandCrate(p.id); }, (x) => !banned.has(x.id) && x.id !== c.parent)
      ] },
      { label: '⇩ Importar M3U aquí (como subcrate)…', fn: () => this.app.importM3u(c.id) },
      ...(c.spotify ? [
        { label: 'Revisar importación de Spotify…', fn: () => this.app.spotifyCrate(c.id, false) },
        { label: 'Actualizar desde Spotify', fn: () => this.app.spotifyCrate(c.id, true) }
      ] : []),
      { label: 'Ordenar crates', sub: Object.entries(CRATE_SORTS).map(([k, v]) => ({ label: (this.app.settings.crateSort === k ? '✓ ' : ' ') + v, fn: () => this.setCrateSort(k) })) },
      ...(this.app.stems.available ? [{ label: '🎚 Separar stems de la crate (segundo plano)', fn: () => { const n = this.app.stems.enqueue(L.crateTrackIds(c.id).map(id => L.get(id))); this.app.toast(n ? `${n} pista(s) en cola de stems` : 'Todas las pistas de la crate ya tienen stems', n ? 'ok' : 'info'); } }] : []),
      { label: 'Eliminar crate', danger: true, fn: () => this.deleteCrateAsk(c) }
    ];
  }
  setCrateSort(k) { this.app.setSetting('crateSort', k); this.renderSide(); }
  // «N pistas · duración»: con el ajuste de subcrates incluye las de sus descendientes (sin duplicar)
  crateInfo(c) {
    const ts = this.lib.crateTrackIds(c.id).map(i => this.lib.get(i)).filter(Boolean);
    return `${ts.length} pistas · ${fmtTotal(ts.reduce((s, t) => s + (t.duration || 0), 0))}`;
  }
  crateSideItems() {
    const L = this.lib;
    return L.crateTree(this.app.settings.crateSort, this.collapsedCrates()).map(({ c, depth, hasKids, open }) => {
      const { color, inherited } = effectiveColor(L.crates, c.id);
      const twisty = el('span', { class: 'si-tw', title: hasKids ? (open ? 'Plegar' : 'Desplegar') : null }, hasKids ? (open ? '▾' : '▸') : '');
      if (hasKids) twisty.addEventListener('click', (e) => { e.stopPropagation(); this.setCrateOpen(c.id, !open); });
      const it = this.sideItem('crate:' + c.id, c.name, L.crateTrackIds(c.id).length, {
        icon: color ? '●' : c.spotify ? '♪' : '▣', color, depth, twisty, crateId: c.id,
        cls: 'crate' + (inherited ? ' inherit' : ''),
        title: (depth ? this.crateLabel(c) + '\n' : '') + this.crateInfo(c), drop: (ids) => L.addToCrate(c.id, ids),
        menu: () => this.crateMenu(c)
      });
      if (hasKids) it.dataset.kids = open ? 'open' : 'closed';
      return it;
    });
  }
  // Cabecera «CRATES»: soltar aquí una crate la devuelve a la raíz
  cratesSection(...actions) {
    const sec = this.section('CRATES', ...actions);
    sec.title = 'Suelta aquí una crate para devolverla a la raíz';
    sec.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/nexura-crate')) { e.preventDefault(); sec.classList.add('drop'); } });
    sec.addEventListener('dragleave', () => sec.classList.remove('drop'));
    sec.addEventListener('drop', (e) => {
      sec.classList.remove('drop');
      const id = e.dataTransfer.getData('text/nexura-crate');
      if (id) { e.preventDefault(); this.lib.setCrateParent(id, null); }
    });
    return sec;
  }
  // «Reiniciar pistas tocadas» (de la sesión mostrada o de todas)
  resetPlayedMenu(e) {
    const L = this.lib, h = this.viewId.startsWith('history:') ? this.viewId.slice(8) : null;
    const all = () => { L.resetPlayed(); this.app.toast('Marcas de pistas tocadas reiniciadas', 'ok'); };
    if (!h) return all();
    this.app.contextMenu(e, [
      { label: 'Reiniciar las de la sesión mostrada', fn: () => { L.resetPlayed(h); this.app.toast('Marcas de la sesión reiniciadas', 'ok'); } },
      { label: 'Reiniciar las de todas las sesiones', fn: all }
    ]);
  }

  renderSide() {
    const L = this.lib, s = this.side;
    s.innerHTML = '';
    const local = [...L.tracks.values()].filter(t => t.source === 'local').length;
    const yt = [...L.tracks.values()].filter(t => t.source === 'youtube').length;
    const libMenu = [
      { label: 'Relocalizar archivos perdidos…', fn: () => this.app.relocateMissing() },
      { label: 'Comprobar archivos perdidos', fn: () => this.checkAllMissing() }
    ];
    s.append(
      this.section('BIBLIOTECA'),
      this.sideItem('all', 'Todas las pistas', local, { icon: '♫', menu: libMenu }),
      this.sideItem('ai:next', 'Siguiente pista (IA)', null, { icon: '✨', cls: 'ai' }),
      this.sideItem('prepare', 'Prepare', L.prepare.length, { icon: '⧉', drop: (ids) => L.addToPrepare(ids), menu: [{ label: 'Vaciar Prepare', fn: () => L.removeFromPrepare([...L.prepare]) }] }),
      this.section('YOUTUBE'),
      el('div', { class: 'side-actions' },
        btn('+ Lista', { cls: 'micro', onClick: () => this.app.ytImportDialog(), title: 'Importar una lista de reproducción de YouTube' }),
        btn('Mis listas', { cls: 'micro', onClick: () => this.app.ytMyPlaylists(), title: 'Listas de tu cuenta de Google' }),
        btn('Buscar', { cls: 'micro', onClick: () => this.app.ytSearchDialog(), title: 'Buscar vídeos en YouTube' }),
        btn('+ Spotify', { cls: 'micro sp-side', onClick: () => this.app.spotifyImportDialog(), title: 'Importar una lista de Spotify como crate (solo títulos y artistas): se buscan en tu música y, las que falten, en YouTube o para comprar' })),
      this.sideItem('yt-all', 'Todos los vídeos', yt, { icon: '▶', cls: 'yt' }),
      ...L.ytPlaylists.map(p => this.sideItem('yt:' + p.id, p.title, p.ids.length, {
        icon: '▶', cls: 'yt',
        menu: [
          { label: 'Actualizar desde YouTube', fn: () => this.app.ytImport(p.playlistId) },
          { label: 'Eliminar lista', fn: () => { if (L.deleteYtPlaylist(p.id) && this.viewId === 'yt:' + p.id) this.setView('yt-all'); } }
        ]
      })),
      this.cratesSection(
        btn('⇩M3U', { cls: 'micro', title: 'Importar una lista .m3u / .m3u8 como crate (también puedes arrastrar el archivo; soltada sobre una crate, se crea como subcrate)', onClick: () => this.app.importM3u() }),
        btn('⇅', { cls: 'micro', title: 'Ordenar crates (dentro de cada nivel)', onClick: (e) => this.app.contextMenu(e, Object.entries(CRATE_SORTS).map(([k, v]) => ({ label: (this.app.settings.crateSort === k ? '✓ ' : ' ') + v, fn: () => this.setCrateSort(k) }))) }),
        btn('+', { cls: 'micro', title: 'Nueva crate (para un subcrate: clic derecho en la crate → «Nuevo subcrate…» o arrastra una crate sobre otra)', onClick: () => this.newCrate(null) })),
      ...this.crateSideItems(),
      this.section('SMART CRATES', btn('+', { cls: 'micro', title: 'Nueva smart crate', onClick: () => this.smartEditor() })),
      ...L.smart.map(sc => this.sideItem('smart:' + sc.id, sc.name, null, {
        icon: '✦',
        menu: [
          { label: 'Editar reglas…', fn: () => this.smartEditor(sc) },
          { label: 'Eliminar', fn: () => { if (L.deleteSmart(sc.id) && this.viewId === 'smart:' + sc.id) this.setView('all'); } }
        ]
      })),
      this.section('HISTORIAL', btn('↺', { cls: 'micro', title: 'Reiniciar pistas tocadas (quita la marca ✓ de la sesión mostrada o de todas)', onClick: (e) => this.resetPlayedMenu(e) })),
      ...L.history.slice().reverse().slice(0, 30).map(h => this.sideItem('history:' + h.id,
        new Date(h.date).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }), h.entries.length, {
          icon: '◷',
          menu: [
            { label: 'Reiniciar pistas tocadas de esta sesión', fn: () => { L.resetPlayed(h.id); this.app.toast('Marcas de la sesión reiniciadas', 'ok'); } },
            { label: 'Exportar CSV', fn: () => this.app.exportHistory(h.id) }
          ]
        })));
    this.sideItems = [...s.querySelectorAll('.side-item')];
  }

  setView(id) {
    this.viewId = id;
    this.app.setSetting('libView', id);
    this.sel.clear(); this.cursor = -1;
    for (const it of this.side.querySelectorAll('.side-item')) it.classList.toggle('on', it.dataset.view === id);
    // con columnas por crate, cada vista tiene las suyas
    if (this.app.settings.libColsSame === false) this.relayout(); else this.refresh();
    this.scroller.scrollTop = 0;
  }

  viewName() {
    const id = this.viewId, L = this.lib;
    if (id === 'all') return 'Todas las pistas';
    if (id === 'prepare') return 'Prepare';
    if (id === 'ai:next') return 'Siguiente pista (IA)';
    if (id === 'yt-all') return 'YouTube';
    const [k, v] = id.split(':');
    if (k === 'crate') return this.crateLabel(L.crate(v)) || 'Crate';
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
    // información de la vista: número de pistas y duración total
    const total = this.rows.reduce((s, t) => s + (t.duration || 0), 0);
    this.countEl.textContent = `${this.rows.length} pistas${total ? ' · ' + fmtTotal(total) : ''}`;
    const name = this.viewName();
    this.viewTitle.textContent = name;
    this.searchIn.placeholder = this.viewId === 'all' || this.viewId === 'everything'
      ? 'Buscar (título, artista, BPM, tonalidad…) o pegar un enlace de YouTube o Spotify  ·  Ctrl+F'
      : `Buscar en «${name}» (título, artista, BPM, tonalidad…)  ·  Ctrl+F`;
    this.refreshLock();
    for (const h of this.head.children) {
      h.classList.toggle('sorted', h.dataset.key === this.sort.field);
      h.dataset.dir = this.sort.dir > 0 ? '▲' : '▼';
    }
    this.spacer.style.height = this.rows.length * this.rowH + 'px';
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

  refreshLock() {
    const on = !!this.app.settings.protectLibrary;
    this.lockBtn.textContent = on ? '🔒' : '🔓';
    this.lockBtn.classList.toggle('on', on);
    this.lockBtn.title = on ? 'Biblioteca protegida: no se pueden borrar ni editar pistas, crates ni beatgrids (clic para desbloquear)' : 'Proteger biblioteca (evita borrar o editar por error durante una sesión)';
  }

  // ---------------------------------------------------------------- columnas configurables
  colMax() { return parseInt(getComputedStyle(this.root).getPropertyValue('--lib-max'), 10) || 99; }
  chosenCols() { return columnsFor(this.app.settings, this.viewId); }
  setChosenCols(keys) {
    const s = this.app.settings;
    if (s.libColsSame === false) this.app.setSetting('libColsByView', { ...(s.libColsByView || {}), [this.viewId]: keys });
    else this.app.setSetting('libCols', keys);
    this.relayout();
  }
  // Cabecera y plantilla según las columnas visibles (al cambiarlas, de vista o de tamaño de pantalla)
  relayout() {
    this._max = this.colMax();
    this.cols = visibleColumns(this.chosenCols(), this._max);
    const art = this.cols.some(c => c.key === 'art');
    const size = ART_SIZES[this.app.settings.libArtSize] || ART_SIZES.small;
    this.rowH = art ? size.row : 28;
    this.root.style.setProperty('--row-h', this.rowH + 'px');
    this.root.style.setProperty('--art-w', size.col + 'px');
    this.head.innerHTML = '';
    for (const c of this.cols) {
      const h = el('div', { class: 'th' + (c.key === 'explicit' ? ' center' : ''), dataset: { key: c.key }, title: c.menu || c.label }, c.label);
      h.appendChild(this.colResizer(c.key, h));
      if (!c.nosort) h.addEventListener('click', (e) => {
        if (e.target.classList.contains('col-rs')) return;
        // ▲ → ▼ → sin orden (orden propio de la crate o del set)
        this.sort = this.sort.field !== c.key ? { field: c.key, dir: 1 } : this.sort.dir > 0 ? { field: c.key, dir: -1 } : { field: null, dir: 1 };
        this.app.setSetting('libSort', this.sort);
        this.refresh();
      });
      this.head.appendChild(h);
    }
    this.applyColWidths();
    this.refresh();
  }
  columnsMenu(e) {
    const s = this.app.settings, chosen = new Set(visibleColumns(this.chosenCols()).map(c => c.key));
    const mark = (on) => (on ? '✓ ' : ' ');
    const hidden = new Set(visibleColumns(this.chosenCols()).map(c => c.key)); for (const c of this.cols) hidden.delete(c.key);
    this.app.contextMenu(e, [
      ...COLUMNS.filter(c => !c.fixed).map(c => ({
        label: mark(chosen.has(c.key)) + (c.menu || c.label) + (hidden.has(c.key) ? ' (no cabe en esta pantalla)' : ''),
        fn: () => { const k = new Set(chosen); k.has(c.key) ? k.delete(c.key) : k.add(c.key); this.setChosenCols(COLUMNS.filter(x => !x.fixed && k.has(x.key)).map(x => x.key)); }
      })),
      { label: mark(s.libColsSame !== false) + 'Mismas columnas en todos los crates', fn: () => this.app.setSetting('libColsSame', s.libColsSame === false) },
      { label: 'Tamaño de la carátula', sub: [['small', 'Pequeña'], ['medium', 'Mediana']].map(([k, v]) => ({ label: mark((s.libArtSize || 'small') === k) + v, fn: () => this.app.setSetting('libArtSize', k) })) },
      { label: 'Restablecer columnas', fn: () => { this.app.setSetting('libColW', {}); this.setChosenCols(DEFAULT_COLS.filter(k => !COL_BY_KEY[k].fixed)); } }
    ]);
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
      const x0 = e.clientX, w0 = th.getBoundingClientRect().width, min = COL_BY_KEY[key]?.min || 70;
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
    // en pantallas estrechas (≤ 760 px) se ignoran los anchos fijados para que todo quepa
    this.root.style.setProperty('--lib-cols', columnTemplate(this.cols, this._max <= 5 ? {} : w));
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

  // Valoración: 5 estrellas, clic para cambiar (la misma otra vez = sin valoración)
  ratingCell(t) {
    const r = t.rating || 0;
    const c = el('span', { class: 'rating', title: r ? `${r} de 5 · clic para cambiar` : 'Sin valorar · clic para valorar' },
      ...[1, 2, 3, 4, 5].map(n => el('i', { class: n <= r ? 'on' : '', dataset: { n } }, '★')));
    if (t.source === 'local' || t.source === 'youtube') c.addEventListener('pointerdown', (e) => {
      const n = +e.target.dataset.n; if (!n || e.button !== 0) return;
      e.stopPropagation();
      this.lib.setRating([t.id], n === r ? 0 : n);
    });
    return c;
  }
  cell(key, t, ctx) {
    switch (key) {
      case 'status': {
        const { ai, deckIdx, played } = ctx, lost = this.missing.get(t.id) === true;
        if (ai) return el('span', { class: 'st ai-score', title: ai.reasons.join(' · '), style: `--s:${ai.score.toFixed(2)}` }, String(Math.round(ai.score * 100)));
        if (lost && deckIdx == null) return el('span', { class: 'st missing', title: 'Archivo no encontrado: clic derecho → «Relocalizar archivos perdidos…»' }, '!');
        return el('span', { class: 'st' + (deckIdx != null ? ' deck' + deckIdx : '') },
          deckIdx != null ? String(deckIdx + 1) : t.source === 'youtube' ? '▶' : (t.analyzed ? (played ? '✓' : '') : '○'));
      }
      case 'art': {
        const url = t.source === 'youtube' ? t.thumb : this.art.get(t.id);
        return el('span', { class: 'c-art' }, url && url !== 'pending' ? el('img', { src: url, alt: '', loading: 'lazy' }) : el('i', {}, '♪'));
      }
      case 'title': return el('span', { class: 'c-title', title: ctx.ai ? ctx.ai.reasons.join(' · ') : '' }, t.title || '—', t.energy ? el('small', { class: 'nrg', title: 'Energía estimada por la IA (1-10)' }, '⚡' + t.energy) : null, t.stems ? el('small', { class: 'stm', title: 'Stems separados (voz, batería, bajo, melodía)' }, 'STEMS') : null);
      case 'artist': return el('span', { class: 'c-artist' }, t.artist || '');
      case 'bpm': return el('span', { class: 'num c-bpm' }, t.bpm ? (Math.round(t.bpm * 10) / 10).toString() : '');
      case 'camelot': { const ok = ctx.akey && camelotCompatible(ctx.akey, t.camelot); return el('span', { class: 'num key' + (ok ? ' compat' : ''), style: { color: keyColor(t.camelot) } }, (ok ? '◉ ' : '') + (t.camelot || t.key || '')); }
      case 'duration': return el('span', { class: 'num' }, t.duration ? fmtTime(t.duration, false) : '');
      case 'rating': return this.ratingCell(t);
      case 'explicit': return el('span', { class: 'c-explicit' }, t.explicit ? el('b', { title: 'Explicit' }, 'E') : '');
      case 'plays': return el('span', { class: 'num' }, t.plays ? String(t.plays) : '');
      case 'year': return el('span', { class: 'num' }, t.year ? String(t.year).slice(0, 4) : '');
      case 'energy': return el('span', { class: 'num' }, t.energy ? '⚡' + t.energy : '');
      case 'added': return el('span', { class: 'num dim' }, t.added ? new Date(t.added).toLocaleDateString('es-ES') : '');
      default: return el('span', {}, t[key] || '');
    }
  }

  renderRows() {
    const RH = this.rowH;
    const top = this.scroller.scrollTop, h = this.scroller.clientHeight || 300;
    const first = Math.max(0, Math.floor(top / RH) - 5);
    const last = Math.min(this.rows.length, Math.ceil((top + h) / RH) + 5);
    const loaded = new Map(this.app.decks.filter(d => d.track).map(d => [d.track.id, d.idx]));
    // en una sesión del historial, las tocadas de esa sesión; en el resto, las de la sesión actual
    const played = this.lib.playedIds(this.viewId.startsWith('history:') ? this.viewId.slice(8) : null);
    const akey = this.activeKey();
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) {
      const t = this.rows[i];
      const ctx = { deckIdx: loaded.get(t.id), ai: this.viewId === 'ai:next' ? this.app.ai.scores.get(t.id) : null, played: played.has(t.id), akey };
      const r = el('div', {
        class: 'row-t' + (this.sel.has(t.id) ? ' sel' : '') + (i === this.cursor ? ' cur' : '') + (i % 2 ? ' odd' : '') + (ctx.played ? ' played' : '') + (t.source === 'youtube' ? ' yt' : '') + (this.missing.get(t.id) === true ? ' missing' : ''),
        style: { top: i * RH + 'px', gridTemplateColumns: GRID }, draggable: 'true', dataset: { i }
      }, ...this.cols.map(c => this.cell(c.key, t, ctx)));
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
    this._visible = this.rows.slice(first, last);
    this.checkMissingSoon();
    if (this.cols.some(c => c.key === 'art')) this.loadArtSoon();
  }

  // ---------------------------------------------------------------- archivos perdidos y carátulas
  markMissing(id, lost) { if (this.missing.get(id) !== lost) { this.missing.set(id, lost); this.renderRows(); } }
  // Comprueba por IPC las pistas visibles que aún no se han comprobado en esta sesión
  async checkMissing(list = this._visible || []) {
    const todo = list.filter(t => t.source === 'local' && !this.missing.has(t.id));
    if (!todo.length) return 0;
    for (const t of todo) this.missing.set(t.id, false);
    const ex = await this.app.platform.existsMany(todo.map(t => t.path));
    if (!ex) return 0; // navegador: no se puede comprobar
    let lost = 0;
    todo.forEach((t, i) => { if (!ex[i]) { this.missing.set(t.id, true); lost++; } });
    if (lost) this.renderRows();
    return lost;
  }
  async checkAllMissing() {
    if (!this.app.platform.existsMany) return;
    const all = [...this.lib.tracks.values()].filter(t => t.source === 'local');
    for (const t of all) this.missing.delete(t.id);
    let lost = 0;
    for (let i = 0; i < all.length; i += 1000) lost += await this.checkMissing(all.slice(i, i + 1000));
    this.renderRows();
    this.app.toast(lost ? `${lost} archivo(s) perdidos (marcados con «!»). Clic derecho → «Relocalizar archivos perdidos…»` : 'Todos los archivos están en su sitio', lost ? 'warn' : 'ok', 6000);
  }
  async loadArt() {
    const todo = (this._visible || []).filter(t => t.source === 'local' && !this.art.has(t.id) && this.missing.get(t.id) !== true);
    if (!todo.length) return;
    for (const t of todo) this.art.set(t.id, 'pending');
    for (const t of todo) {
      try { this.art.set(t.id, await this.app.platform.artGet(t.id, t.path)); } catch (_) { this.art.set(t.id, null); }
    }
    this.renderRows();
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
    const RH = this.rowH, top = i * RH, st = this.scroller.scrollTop, h = this.scroller.clientHeight;
    if (top < st) this.scroller.scrollTop = top;
    else if (top + RH > st + h) this.scroller.scrollTop = top + RH - h;
  }
  // ← / → (teclado o botones MIDI) con la barra lateral activa: ← pliega la crate abierta o sube a su
  // crate padre; → despliega. Devuelve false si no hace nada (→ pasa entonces a la tabla).
  sideKey(dir) {
    if (this.focus !== 'side') return false;
    const c = this.viewId.startsWith('crate:') ? this.lib.crate(this.viewId.slice(6)) : null;
    if (!c) return dir < 0;
    const hasKids = this.lib.subcrateIds(c.id).length > 0, open = hasKids && !this.collapsedCrates().has(c.id);
    if (dir > 0) { if (!hasKids || open) return false; this.setCrateOpen(c.id, true); return true; }
    if (open) this.setCrateOpen(c.id, false);
    else if (this.lib.crate(c.parent)) this.setView('crate:' + c.parent);
    this.side.querySelector('.side-item.on')?.scrollIntoView({ block: 'nearest' });
    return true;
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
      { label: 'Añadir a crate', sub: [...this.crateChoices((c) => L.addToCrate(c.id, ids)), { label: '+ Nueva crate…', fn: async () => { if (!L.guard('crate')) return; const n = await app.prompt('Nombre de la crate', ''); const c = n && L.createCrate(n); if (c) L.addToCrate(c.id, ids); } }] },
      { label: 'Mostrar en qué crates está', fn: () => this.showCratesOf(one) },
      { label: 'Valoración', sub: [5, 4, 3, 2, 1, 0].map(n => ({ label: n ? '★'.repeat(n) + '☆'.repeat(5 - n) : 'Sin valoración', fn: () => L.setRating(ids, n) })) },
      { label: (one && one.explicit ? '✓ ' : ' ') + 'Explicit (E)', fn: () => L.setExplicit(ids, !(one && one.explicit)) }
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
      if (window.nexura) {
        const lost = sel.filter(t => this.missing.get(t.id) === true);
        items.push({ label: lost.length ? `Relocalizar archivos perdidos (${lost.length})…` : 'Relocalizar archivos perdidos…', fn: () => app.relocateMissing(lost.length ? lost : null) });
      }
    }
    if (one && one.source === 'youtube') items.push({ label: 'Abrir en YouTube', fn: () => app.platform.openExternal('https://www.youtube.com/watch?v=' + one.ytId) });
    if (one && (one.bpm || one.camelot)) items.push({ label: '✨ Crear set desde esta pista (IA)…', fn: () => app.aiBuildSet(one) });
    items.push({ label: 'Editar…', fn: () => this.editTrack(one) });
    // en una crate padre que muestra las pistas de sus subcrates, se quitan también de ellos
    if (this.viewId.startsWith('crate:')) {
      const cid = this.viewId.slice(6), deep = L.subTracks && L.subcrateIds(cid).length > 0;
      items.push({ label: deep ? 'Quitar de la crate y sus subcrates' : 'Quitar de la crate', fn: () => L.removeFromCrate(cid, ids, deep) });
    }
    if (this.viewId === 'prepare') items.push({ label: 'Quitar de Prepare', fn: () => L.removeFromPrepare(ids) });
    items.push({ label: `Eliminar de la biblioteca (${ids.length})`, danger: true, fn: async () => { if (!L.guard('remove')) return; if (await app.confirm(`¿Quitar ${ids.length} pista(s) de la biblioteca? Los archivos no se borran del disco.`)) L.remove(ids); } });
    app.contextMenu(e, items);
  }

  showCratesOf(t) {
    if (!t) return;
    // ruta completa de cada crate (Dance › 2024), en orden de árbol
    const order = this.lib.sortedCrates(this.app.settings.crateSort);
    const list = this.lib.cratesOf(t.id).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    const body = el('div', { class: 'crates-of' },
      el('p', {}, `«${t.title || '—'}»${t.artist ? ' · ' + t.artist : ''}`),
      list.length
        ? el('ul', { class: 'crates-of-list' }, ...list.map(c => {
          const li = el('li', { title: 'Abrir la crate' }, el('span', { class: 'swatch', style: { background: effectiveColor(this.lib.crates, c.id).color || 'var(--line2)' } }), this.crateLabel(c), el('small', {}, this.crateInfo(c)));
          li.addEventListener('click', () => { this.app.closeModal(); this.expandCrate(c.id); this.setView('crate:' + c.id); });
          return li;
        }))
        : el('p', { class: 'hint' }, 'Esta pista no está en ninguna crate.'),
      this.lib.prepare.includes(t.id) ? el('p', { class: 'hint' }, 'También está en Prepare.') : null);
    this.app.modal('Crates de la pista', body, ['Cerrar']);
  }

  async editTrack(t) {
    if (!t || !this.lib.guard('tags')) return;
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
    this.lib.editTrack(t.id, patch);
    this.refresh();
  }

  async smartEditor(sc) {
    if (!this.lib.guard('smart')) return;
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
    if (this.lib.saveSmart(edit)) this.setView('smart:' + edit.id);
  }
}
