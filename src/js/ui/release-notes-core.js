// Novedades de la versión (src/legal/NOVEDADES.md): funciones puras, probadas en Node (tools/test-novedades.mjs).

// Compara versiones «1.0.0», «1.0.0-rc.2», «1.1.0-beta.1»: < 0 si a es anterior, 0 si iguales, > 0 si posterior.
// Una versión de prueba va antes que la estable del mismo número (1.0.0-rc.2 < 1.0.0).
export function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(String(v || '').trim());
    if (!m) return null;
    return { nums: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] };
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (!x.pre.length || !y.pre.length) return (x.pre.length ? -1 : 0) + (y.pre.length ? 1 : 0);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (+p !== +q) return +p - +q; } else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

// ¿Avisar al arrancar? last = última versión que se abrió en este equipo (settings.lastVersion).
// Sin last: instalación nueva (no se avisa) o actualización desde la rc1, que aún no lo guardaba
// (se reconoce porque ya se vio la bienvenida).
export function shouldAnnounce(last, current, welcomeDone) {
  if (!/^\d+\.\d+\.\d+/.test(String(current || ''))) return false; // modo navegador («web»)
  if (!last) return !!welcomeDone;
  return compareVersions(current, last) > 0;
}

// «## 1.0.0-rc.2 · noviembre de 2026» abre una versión; «### Título» un apartado; «- texto» un punto;
// el resto, párrafos. **negrita** se conserva para la interfaz. Devuelve [{ version, title, blocks }].
export function parseNotes(md) {
  const out = [];
  let cur = null;
  for (const raw of String(md || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = /^##\s+(.+)$/.exec(line)) && !line.startsWith('###')) {
      const title = m[1].trim();
      const v = /^v?(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(title);
      cur = { version: v ? v[1] : '', title, blocks: [] };
      out.push(cur);
    } else if (!cur || !line || /^#\s/.test(line)) continue;
    else if ((m = /^###\s+(.+)$/.exec(line))) cur.blocks.push({ type: 'h', text: m[1] });
    else if ((m = /^[-*]\s+(.+)$/.exec(line))) {
      const last = cur.blocks[cur.blocks.length - 1];
      if (last && last.type === 'ul') last.items.push(m[1]); else cur.blocks.push({ type: 'ul', items: [m[1]] });
    } else cur.blocks.push({ type: 'p', text: line });
  }
  return out;
}

// Las notas de una versión (o, si no están, las de la más reciente publicada: no las «en preparación»)
export function notesFor(list, version) {
  return list.find(n => n.version === version) || list.find(n => !/en preparación/i.test(n.title)) || list[0] || null;
}
