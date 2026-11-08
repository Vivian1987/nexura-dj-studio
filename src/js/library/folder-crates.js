// Carpetas → crates (funciones puras, probadas en Node con tools/test-folder-crates.mjs).
// Árbol de carpetas: { name, files: [info con .path], dirs: [nodo] }. En lo soltado o elegido, el nodo
// raíz no tiene nombre: sus `files` son los archivos sueltos y sus `dirs`, las carpetas.

import { childrenOf } from './crate-tree.js';

// ¿Tiene audio la carpeta en algún nivel?
export const hasAudio = (node) => !!node && ((node.files || []).length > 0 || (node.dirs || []).some(hasAudio));

// Todos los archivos del árbol (orden: los de cada carpeta y luego los de sus subcarpetas)
export function treeFiles(node, out = []) {
  if (!node) return out;
  out.push(...(node.files || []));
  for (const d of node.dirs || []) treeFiles(d, out);
  return out;
}

// Copia del árbol sin las carpetas que no tienen audio en ningún nivel
export function pruneTree(node) {
  if (!node) return { files: [], dirs: [] };
  return { ...node, files: (node.files || []).slice(), dirs: (node.dirs || []).filter(hasAudio).map(pruneTree) };
}

// Rutas relativas («Dance/2020/Verano/a.mp3», como webkitRelativePath) → árbol. items: [{ rel, info }]
export function treeFromRelPaths(items) {
  const root = { files: [], dirs: [] };
  for (const { rel, info } of items || []) {
    const parts = String(rel || '').split(/[\\/]+/).filter(Boolean);
    if (!parts.length) continue;
    parts.pop();
    let node = root;
    for (const name of parts) {
      let d = node.dirs.find(x => x.name === name);
      if (!d) { d = { name, files: [], dirs: [] }; node.dirs.push(d); }
      node = d;
    }
    node.files.push(info);
  }
  return root;
}

const folderName = (n) => String(n || '').trim() || 'Carpeta';
// Crate hija con ese nombre (igual o, si no, sin distinguir mayúsculas: en Windows «2020» = «2020»)
function findChild(crates, pid, name) {
  const kids = childrenOf(crates, pid);
  const low = name.toLocaleLowerCase('es');
  return kids.find(c => c.name === name) || kids.find(c => String(c.name).toLocaleLowerCase('es') === low) || null;
}

// Plan de crates para un árbol soltado sobre «target» (id de crate, o null = raíz). Cada carpeta con audio
// pasa a ser un subcrate (se reutiliza el que ya tenga ese nombre en ese nivel) y cada pista va solo al
// subcrate de su carpeta. Los archivos sueltos van a «target» (en la raíz no van a ninguna crate: loose).
// make(name, parent) crea la crate y la añade a `crates` (el mismo array) o devuelve null.
// idOf(ruta) = id de la pista (o null si no está en la biblioteca).
// Devuelve { assign: Map<crateId, [ids]>, loose: [ids], created: [crates], top: [crates de 1er nivel] }
export function applyFolderTree(crates, tree, target = null, { make, idOf = (p) => p } = {}) {
  const assign = new Map(), seen = new Map(), created = [], top = [], loose = [];
  const ids = (files) => (files || []).map(f => idOf(f.path)).filter(Boolean);
  const put = (cid, files) => {
    const list = ids(files);
    if (!list.length) return;
    if (!assign.has(cid)) { assign.set(cid, []); seen.set(cid, new Set()); }
    const l = assign.get(cid), s = seen.get(cid);
    for (const i of list) if (!s.has(i)) { s.add(i); l.push(i); }
  };
  if (target) put(target, tree.files);
  else for (const i of ids(tree.files)) if (!loose.includes(i)) loose.push(i);
  const walk = (node, pid, first) => {
    if (!hasAudio(node)) return;
    const name = folderName(node.name);
    let c = findChild(crates, pid, name);
    if (!c) {
      c = make ? make(name, pid) : null;
      if (!c) return;
      created.push(c);
    }
    if (first && !top.includes(c)) top.push(c);
    put(c.id, node.files);
    for (const d of node.dirs || []) walk(d, c.id, false);
  };
  for (const d of tree.dirs || []) walk(d, target || null, true);
  return { assign, loose, created, top };
}
