// Subcrates: árbol de crates anidadas (funciones puras, probadas en Node con tools/test-subcrates.mjs).
// Cada crate tiene `parent` (id de la crate padre) o null/ausente en la raíz; el orden personalizado de
// cada nivel es el orden del array `library.crates`.

const byId = (crates) => new Map(crates.map(c => [c.id, c]));

// Padre efectivo: null si no tiene, si el padre ya no existe o si apunta a sí misma
export function parentId(crates, c, map = byId(crates)) {
  const p = c && c.parent;
  return p && p !== c.id && map.has(p) ? p : null;
}

// Repara datos antiguos o dañados: padres inexistentes → raíz y ciclos rotos (la crate que cierra el
// ciclo pasa a la raíz). Devuelve true si cambió algo.
export function normalizeParents(crates) {
  const map = byId(crates);
  let changed = false;
  for (const c of crates) {
    if (c.parent === undefined) continue;
    if (c.parent !== null && parentId(crates, c, map) === null) { c.parent = null; changed = true; }
  }
  for (const c of crates) {
    const seen = new Set([c.id]);
    let p = c.parent ? map.get(c.parent) : null;
    while (p) {
      if (seen.has(p.id)) { c.parent = null; changed = true; break; }
      seen.add(p.id);
      p = p.parent ? map.get(p.parent) : null;
    }
  }
  return changed;
}

export function childrenOf(crates, pid = null) {
  const map = byId(crates);
  return crates.filter(c => parentId(crates, c, map) === (pid || null));
}

// Ids de todas las crates descendientes (sin la propia), en orden de árbol (profundidad primero)
export function descendantIds(crates, id) {
  const kids = new Map();
  const map = byId(crates);
  for (const c of crates) { const p = parentId(crates, c, map); if (p) (kids.get(p) || kids.set(p, []).get(p)).push(c); }
  const out = [], seen = new Set([id]);
  const walk = (pid) => { for (const k of kids.get(pid) || []) if (!seen.has(k.id)) { seen.add(k.id); out.push(k.id); walk(k.id); } };
  walk(id);
  return out;
}

// ¿Se puede mover «id» dentro de «newParent» (null = raíz)? No dentro de sí misma ni de un descendiente
export function canMoveInto(crates, id, newParent) {
  if (!crates.some(c => c.id === id)) return false;
  if (!newParent) return true;
  if (newParent === id || !crates.some(c => c.id === newParent)) return false;
  return !descendantIds(crates, id).includes(newParent);
}

// Ruta desde la raíz: [crate raíz, …, crate]
export function cratePath(crates, id) {
  const map = byId(crates), out = [], seen = new Set();
  let c = map.get(id);
  while (c && !seen.has(c.id)) { seen.add(c.id); out.unshift(c); c = map.get(parentId(crates, c, map)); }
  return out;
}
export const PATH_SEP = ' › ';
export const pathLabel = (crates, id) => cratePath(crates, id).map(c => c.name).join(PATH_SEP);

// Ordena una lista de hermanas según settings.crateSort (custom = orden del array)
export function sortSiblings(list, mode = 'custom', order = null) {
  const pos = order || new Map(list.map((c, i) => [c.id, i]));
  const l = list.slice();
  if (mode === 'alpha') l.sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' }));
  else if (mode === 'created') l.sort((a, b) => (a.created || 0) - (b.created || 0) || pos.get(a.id) - pos.get(b.id));
  return l;
}

// Árbol aplanado para la barra lateral: [{ c, depth, hasKids, open }]. Las plegadas (collapsed: Set o
// array de ids) no muestran sus hijas salvo con all = true (menús «Añadir a crate» / «Mover a…»).
export function flattenTree(crates, mode = 'custom', collapsed = null, all = false) {
  const fold = collapsed instanceof Set ? collapsed : new Set(collapsed || []);
  const map = byId(crates), order = new Map(crates.map((c, i) => [c.id, i]));
  const kids = new Map();
  for (const c of crates) { const p = parentId(crates, c, map); (kids.get(p) || kids.set(p, []).get(p)).push(c); }
  const out = [], seen = new Set();
  const walk = (pid, depth) => {
    for (const c of sortSiblings(kids.get(pid) || [], mode, order)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      const hasKids = (kids.get(c.id) || []).length > 0, open = hasKids && !fold.has(c.id);
      out.push({ c, depth, hasKids, open });
      if (hasKids && (open || all)) walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// Pistas de una crate: las suyas y, con subs, las de todas sus descendientes sin duplicar (orden: las
// propias y luego las de cada subcrate en orden de árbol personalizado)
export function crateTrackIds(crates, id, subs = true) {
  const map = byId(crates), c = map.get(id);
  if (!c) return [];
  const seen = new Set(), out = [];
  const add = (x) => { for (const i of x.ids || []) if (!seen.has(i)) { seen.add(i); out.push(i); } };
  add(c);
  if (subs) for (const d of descendantIds(crates, id)) add(map.get(d));
  return out;
}

// Borrar una crate: mode 'all' borra también sus subcrates; 'lift' sube sus hijas directas al nivel de la
// crate borrada (en su posición). Devuelve { crates: array nuevo, removed: ids borrados }.
export function deletePlan(crates, id, mode = 'all') {
  const map = byId(crates), c = map.get(id);
  if (!c) return { crates: crates.slice(), removed: [] };
  if (mode === 'all') {
    const removed = [id, ...descendantIds(crates, id)], rm = new Set(removed);
    return { crates: crates.filter(x => !rm.has(x.id)), removed };
  }
  // las hijas ocupan el sitio de la borrada en el orden personalizado (se les cambia `parent`)
  const up = parentId(crates, c, map);
  const kids = crates.filter(k => k.id !== id && parentId(crates, k, map) === id);
  const out = [];
  for (const x of crates) {
    if (x.id === id) out.push(...kids);
    else if (!kids.includes(x)) out.push(x);
  }
  for (const k of kids) k.parent = up;
  return { crates: out, removed: [id] };
}

// Color visible: el propio o el del antepasado más cercano con color (inherited = true → más tenue)
export function effectiveColor(crates, id) {
  const path = cratePath(crates, id);
  for (let i = path.length - 1; i >= 0; i--) if (path[i].color) return { color: path[i].color, inherited: i !== path.length - 1 };
  return { color: null, inherited: false };
}

// Busca (y, con make, crea) la ruta de nombres [«Dance», «2024»] bajo «root» (null = raíz).
// make(name, parent) crea la crate y la devuelve. Devuelve la última crate o null.
export function ensurePath(crates, names, make = null, root = null) {
  let pid = root || null, c = null;
  for (const raw of names) {
    const name = String(raw).trim();
    if (!name) continue;
    c = childrenOf(crates, pid).find(x => x.name === name) || null;
    if (!c) { if (!make) return null; c = make(name, pid); if (!c) return null; }
    pid = c.id;
  }
  return c;
}
// «Dance / 2024» (listas en carpetas de las colecciones importadas, «Dance%%2024.crate») → segmentos
export const splitListPath = (name) => String(name || '').split(/\s+\/\s+/).map(s => s.trim()).filter(Boolean);
