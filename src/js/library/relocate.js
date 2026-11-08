// Relocalizar archivos perdidos (sin DOM: se prueba en Node)
// Se busca cada pista por nombre de archivo (sin distinguir mayúsculas) entre los archivos encontrados
// en la carpeta elegida; si hay varios con el mismo nombre se desempata por tamaño.

export const fileName = (p) => String(p || '').split(/[\\/]/).pop() || '';
export const nameKey = (p) => fileName(p).toLowerCase();

// files: [{ path, size }] → Map nombre → [{ path, size }]
export function indexByName(files) {
  const m = new Map();
  for (const f of files || []) {
    const k = nameKey(f.path);
    if (!k) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(f);
  }
  return m;
}

// tracks: pistas perdidas [{ id, path, size }]; taken: rutas que ya tiene otra pista de la biblioteca
// (en minúsculas). Devuelve { moves: [{ id, path }], ambiguous: [id], notFound: [id], duplicate: [id] }
export function planRelocation(tracks, files, taken = new Set()) {
  const byName = files instanceof Map ? files : indexByName(files);
  const out = { moves: [], ambiguous: [], notFound: [], duplicate: [] };
  const used = new Set();
  for (const t of tracks) {
    let cands = (byName.get(nameKey(t.path)) || []).filter(f => !used.has(f.path.toLowerCase()));
    if (cands.length > 1 && t.size) {
      const same = cands.filter(f => f.size === t.size);
      if (same.length) cands = same;
    }
    if (!cands.length) { out.notFound.push(t.id); continue; }
    if (cands.length > 1) { out.ambiguous.push(t.id); continue; }
    const p = cands[0].path;
    if (taken.has(p.toLowerCase())) { out.duplicate.push(t.id); continue; }
    used.add(p.toLowerCase());
    out.moves.push({ id: t.id, path: p });
  }
  return out;
}
