// Enrutado de las unidades FX (puro, probado en Node): cada unidad va a su destino normal (deck, master,
// sampler) salvo que un deck la use para Stems FX; entonces solo procesa los stems enviados de ese deck.
// units: [{idx, target}] · decks: [{idx, stemsOn, stemFx: [4 × bool], stemFxUnit}]
// Devuelve { deck: [[u…] × 4], stem: [[u…] × 4], master: [u…], sampler: [u…], sends: [[0|1 × 4] × decks] }
export function planFxRouting(units, decks) {
  const out = { deck: [[], [], [], []], stem: [[], [], [], []], master: [], sampler: [], sends: [] };
  const stemUnit = new Map(); // índice de unidad → deck que la usa para stems (el primero gana)
  for (const d of decks) {
    if (d.stemsOn && d.stemFx && d.stemFx.some(Boolean) && !stemUnit.has(d.stemFxUnit)) stemUnit.set(d.stemFxUnit, d.idx);
  }
  for (const u of units) {
    if (stemUnit.has(u.idx)) { out.stem[stemUnit.get(u.idx)].push(u); continue; }
    const m = /^deck([0-3])$/.exec(u.target || '');
    if (m) out.deck[+m[1]].push(u);
    else if (u.target === 'sampler') out.sampler.push(u);
    else out.master.push(u);
  }
  for (const d of decks) {
    const used = out.stem[d.idx] && out.stem[d.idx].length > 0;
    out.sends[d.idx] = (d.stemFx || [false, false, false, false]).map(v => (used && d.stemsOn && v ? 1 : 0));
  }
  return out;
}
