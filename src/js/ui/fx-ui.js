// Interfaz de las unidades de efectos
import { el, clamp } from '../util.js';
import { Knob, btn, select } from './controls.js';
import { EFFECTS, BEAT_VALUES, beatLabel, FX_CATEGORIES, FACTORY_PRESETS } from '../audio/fx.js';

// Lista de efectos agrupada por categorías
function fxSelect(value, onChange) {
  const s = el('select', { class: 'sel fx-sel' });
  for (const [cat, label] of Object.entries(FX_CATEGORIES)) {
    const g = el('optgroup', { label });
    for (const e of EFFECTS.filter(x => x.cat === cat)) g.appendChild(el('option', { value: e.id }, e.name));
    s.appendChild(g);
  }
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export const FX_TARGETS = { deck0: 'Deck 1', deck1: 'Deck 2', deck2: 'Deck 3', deck3: 'Deck 4', master: 'Master', sampler: 'Sampler' };

export class FxUnitUI {
  constructor(app, unit, root) {
    this.app = app; this.unit = unit; this.root = root;
    root.classList.add('fxunit', 'u' + unit.idx);
    this.target = select(FX_TARGETS, unit.target, (v) => { unit.target = v; app.rewireFx(); app.saveFxSoon(); }, 'tiny-sel');
    // destinos Deck 3/4 solo con 4 decks
    const showTargets = (n) => { for (const o of this.target.querySelectorAll ? this.target.querySelectorAll('option') : []) if (/^deck[23]$/.test(o.value)) o.hidden = o.disabled = n !== 4; };
    showTargets(app.deckCount || 2);
    app.on('decks', showTargets);
    this.beatsVal = el('span', { class: 'val' }, beatLabel(unit.beats));
    this.mix = new Knob({ label: 'MIX', value: unit.mix, def: 1, size: 30, onChange: (v) => { unit.setMix(v); app.saveFxSoon(); } });
    this.preset = select({ '': 'Preset…' }, '', (id) => { if (id) this.loadPreset(id); }, 'tiny-sel');
    this.refreshPresets();
    app.on('settings', (key) => { if (key === 'fxPresets') this.refreshPresets(); });
    this.slotEls = unit.slots.map((s, i) => {
      const sel = fxSelect(s.fxId, (v) => { s.setEffect(v); app.saveFxSoon(); app.emit('fx'); });
      const on = btn('ON', { cls: 'micro fxon', onClick: () => { s.setEnabled(!s.enabled); this.refresh(); app.emit('fx'); } });
      const k = new Knob({ label: '', value: s.param, def: 0.5, size: 30, onChange: (v) => { s.setParam(v); app.saveFxSoon(); } });
      return { sel, on, k, el: el('div', { class: 'fxslot' }, sel, el('div', { class: 'fxslot-ctl' }, on, k.el)) };
    });
    root.append(
      el('div', { class: 'fx-head' },
        el('span', { class: 'fx-title' }, 'FX ' + (unit.idx + 1)), this.stemTag = el('span', { class: 'fx-stemtag', title: 'Esta unidad procesa solo los stems elegidos (Mayús + pad en el modo Stems)' }), this.target),
      el('div', { class: 'fx-slots' }, ...this.slotEls.map(s => s.el)),
      el('div', { class: 'fx-side' },
        this.preset,
        btn('＋', { cls: 'micro', title: 'Guardar preset de esta unidad', onClick: () => this.savePreset() }),
        el('div', { class: 'beats' }, el('span', { class: 'lbl' }, 'BEATS'),
          el('div', {}, btn('−', { cls: 'micro', onClick: () => this.beats(-1) }), this.beatsVal, btn('+', { cls: 'micro', onClick: () => this.beats(1) }))),
        this.mix.el));
    app.on('fx', () => this.refresh());
    this.refresh();
  }
  beats(d) {
    const i = clamp(BEAT_VALUES.indexOf(this.unit.beats) + d, 0, BEAT_VALUES.length - 1);
    this.unit.setBeats(BEAT_VALUES[i]);
    this.app.saveFxSoon();
    this.refresh();
  }
  refreshPresets() {
    const presets = this.app.settings.fxPresets || {};
    const value = this.preset?.value || '';
    this.preset.innerHTML = '';
    this.preset.appendChild(el('option', { value: '' }, 'Preset…'));
    const fac = el('optgroup', { label: 'De fábrica' });
    for (const [id, p] of Object.entries(FACTORY_PRESETS)) fac.appendChild(el('option', { value: id }, p.name));
    this.preset.appendChild(fac);
    const own = Object.entries(presets);
    if (own.length) {
      const g = el('optgroup', { label: 'Mis presets' });
      for (const [id, p] of own) g.appendChild(el('option', { value: id }, p.name || id));
      this.preset.appendChild(g);
    }
    this.preset.value = value && (presets[value] || FACTORY_PRESETS[value]) ? value : '';
  }
  async savePreset() {
    if (!this.app.expansions.enabled('fxPresets')) return this.app.toast('Activa Presets de FX en Ajustes → Expansiones primero', 'warn');
    const name = await this.app.prompt('Guardar preset FX', `Preset ${this.unit.idx + 1}`);
    if (!name) return;
    const id = `fx-${Date.now().toString(36)}`;
    const presets = { ...(this.app.settings.fxPresets || {}), [id]: { name, unit: this.unit.toJSON(), enabled: this.unit.slots.map(s => s.enabled) } };
    this.app.setSetting('fxPresets', presets);
    this.refreshPresets();
    this.app.toast(`Preset «${name}» guardado`, 'ok');
  }
  loadPreset(id) {
    // los de fábrica siempre; los propios con la expansión Presets de FX
    const factory = FACTORY_PRESETS[id];
    if (!factory && !this.app.expansions.enabled('fxPresets')) return this.app.toast('Activa Presets de FX en Ajustes → Expansiones primero', 'warn');
    const preset = factory || this.app.settings.fxPresets?.[id];
    if (!preset?.unit) return;
    this.unit.fromJSON(preset.unit);
    (preset.enabled || []).forEach((enabled, i) => this.unit.slots[i]?.setEnabled(!!enabled));
    this.app.rewireFx(); this.app.saveFxSoon(); this.app.emit('fx');
    this.app.toast(`Preset «${preset.name}» cargado`, 'ok');
  }
  refresh() {
    const u = this.unit;
    this.target.value = u.target;
    this.beatsVal.textContent = beatLabel(u.beats);
    this.mix.set(u.mix, true);
    u.slots.forEach((s, i) => {
      const se = this.slotEls[i];
      se.on.classList.toggle('on', s.enabled);
      se.sel.value = s.fxId;
      se.k.set(s.param, true);
    });
    this.root.classList.toggle('active', u.anyOn());
    // unidad usada para Stems FX: se indica en el título
    const sd = (this.app.decks || []).find(d => d.stemsOn && d.stemFxUnit === u.idx && d.stemFx.some(Boolean));
    this.root.classList.toggle('stems', !!sd);
    this.stemTag.textContent = sd ? `STEMS D${sd.idx + 1}` : '';
  }
}
