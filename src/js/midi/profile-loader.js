// Carga y valida perfiles MIDI declarativos servidos como JSON local.
const BUILTIN_INDEX = new URL('./profiles/index.json', import.meta.url);
const NAME_PATTERNS = [
  { id: 'pioneer-ddj-generic', test: /\bDDJ[- ]|Pioneer DJ/i },
  { id: 'numark-generic', test: /Numark/i },
  { id: 'hercules-generic', test: /Hercules.*DJ|DJControl/i },
  { id: 'reloop-generic', test: /Reloop|Mixtour/i }
];

function normalizeProfile(raw) {
  if (!raw || typeof raw.id !== 'string' || !Array.isArray(raw.mappings)) return null;
  const mappings = raw.mappings.filter((m) =>
    m && typeof m.key === 'string' && typeof m.action === 'string' &&
    ['button', 'abs', 'rel'].includes(m.kind || 'button')
  ).map((m) => {
    const o = { ...(m.options || {}) };
    for (const k of ['enc', 'inv', 'scale']) if (m[k] != null) o[k] = m[k];
    return { key: m.key, action: m.action, kind: m.kind || 'button', ...o };
  });
  let matchers = [];
  try { matchers = (raw.match || []).map((s) => new RegExp(s, 'i')); } catch (_) { return null; }
  return { ...raw, mappings, matchers };
}

export class MidiProfileCatalog {
  constructor() { this.profiles = []; }

  async load() {
    const response = await fetch(BUILTIN_INDEX);
    if (!response.ok) throw new Error(`No se pudo cargar índice MIDI (${response.status})`);
    const files = await response.json();
    const loaded = await Promise.all(files.map(async (file) => {
      const res = await fetch(new URL(`./profiles/${encodeURIComponent(file)}`, import.meta.url));
      if (!res.ok) return null;
      try { return normalizeProfile(await res.json()); } catch (_) { return null; }
    }));
    this.profiles = loaded.filter(Boolean);
    return this.profiles;
  }

  match(name) {
    const n = String(name || '');
    return this.profiles.find((profile) => profile.matchers.some((re) => re.test(n))) || null;
  }

  genericMatch(name) {
    const entry = NAME_PATTERNS.find((p) => p.test.test(String(name || '')));
    return entry ? this.profiles.find((p) => p.id === entry.id) || null : null;
  }

  // prof: { map, opts, leds } (o un objeto plano {clave: acción} de versiones anteriores)
  exportUserProfile(name, prof, id = '') {
    const safe = String(name || 'Controlador MIDI').trim().slice(0, 80);
    const map = prof && prof.map ? prof.map : (prof || {});
    const opts = (prof && prof.opts) || {};
    return {
      schema: 'nexura-midi-profile', version: 1,
      id: id || `user-${safe.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: safe, match: [],
      mappings: Object.entries(map).map(([key, action]) => ({ key, action, ...(opts[key] || {}) })),
      ...(prof && prof.leds && prof.leds.length ? { leds: prof.leds } : {}),
      ...(prof && prof.ledsOff ? { ledsOff: true } : {})
    };
  }

  validateUserProfile(raw) {
    if (!raw || raw.schema !== 'nexura-midi-profile' || raw.version !== 1 || !Array.isArray(raw.mappings)) return null;
    const p = normalizeProfile(raw);
    return p && p.mappings.length === raw.mappings.length ? p : null;
  }
}
