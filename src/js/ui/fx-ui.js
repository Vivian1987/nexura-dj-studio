// Interfaz de las unidades de efectos
import { el, clamp } from '../util.js';
import { Knob, btn, select } from './controls.js';
import { EFFECTS, BEAT_VALUES, beatLabel } from '../audio/fx.js';

export const FX_TARGETS = { deck0: 'Deck 1', deck1: 'Deck 2', deck2: 'Deck 3', deck3: 'Deck 4', master: 'Master', sampler: 'Sampler' };

export class FxUnitUI {
  constructor(app, unit, root) {
    this.app = app; this.unit = unit; this.root = root;
    root.classList.add('fxunit', 'u' + unit.idx);
    const fxOpts = Object.fromEntries(EFFECTS.map(e => [e.id, e.name]));
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
      const sel = select(fxOpts, s.fxId, (v) => { s.setEffect(v); app.saveFxSoon(); app.emit('fx'); }, 'fx-sel');
      const on = btn('ON', { cls: 'micro fxon', onClick: () => { s.setEnabled(!s.enabled); this.refresh(); app.emit('fx'); } });
      const k = new Knob({ label: '', value: s.param, def: 0.5, size: 30, onChange: (v) => { s.setParam(v); app.saveFxSoon(); } });
      return { sel, on, k, el: el('div', { class: 'fxslot' }, sel, el('div', { class: 'fxslot-ctl' }, on, k.el)) };
    });
    root.append(
      el('div', { class: 'fx-head' },
        el('span', { class: 'fx-title' }, 'FX ' + (unit.idx + 1)), this.target),
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
    const opts = { '': 'Preset…', ...Object.fromEntries(Object.entries(presets).map(([id, p]) => [id, p.name || id])) };
    const value = this.preset?.value || '';
    this.preset.innerHTML = '';
    for (const [v, label] of Object.entries(opts)) this.preset.appendChild(el('option', { value: v }, label));
    this.preset.value = opts[value] ? value : '';
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
    if (!this.app.expansions.enabled('fxPresets')) return this.app.toast('Activa Presets de FX en Ajustes → Expansiones primero', 'warn');
    const preset = this.app.settings.fxPresets?.[id];
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
  }
}
