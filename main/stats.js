// Contador anónimo de uso (opcional). Solo funciona si src/config/servicios.json tiene «statsUrl» y el
// usuario lo permite (Ajustes → General). Como mucho una vez al día y SOLO estos campos:
//   id        identificador aleatorio de la instalación (UUID generado en el equipo, sin relación con nada personal)
//   version   versión de la app
//   lang      idioma de la interfaz del sistema (p. ej. «es-ES»)
//   os        «Windows 10» o «Windows 11»
//   decks     decks usados (2 o 4)
//   controller  si hay una controladora MIDI conectada (true/false), sin el modelo
// Sin dependencias de Electron (se prueba en Node: tools/test-estadisticas.mjs).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FIELDS = ['id', 'version', 'lang', 'os', 'decks', 'controller'];
const DAY = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function loadState(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); if (j && UUID.test(j.id)) return j; } catch (_) { /* nuevo */ }
  const s = { id: crypto.randomUUID(), lastSent: 0 };
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(s)); } catch (_) { /* sin disco */ }
  return s;
}

// Solo los campos permitidos, con valores saneados (cualquier otro dato se descarta)
function buildPayload({ id, version, lang, os, decks, controller }) {
  return {
    id: UUID.test(String(id)) ? String(id) : '',
    version: String(version || '').slice(0, 32),
    lang: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(String(lang || '')) ? String(lang) : 'und',
    os: ['Windows 10', 'Windows 11'].includes(os) ? os : 'otro',
    decks: Number(decks) === 4 ? 4 : 2,
    controller: !!controller
  };
}

const due = (lastSent, now = Date.now()) => !lastSent || now - lastSent >= DAY || now < lastSent;

// Devuelve { sent, reason }. Nunca lanza: sin red o con el servidor caído no pasa nada.
async function sendStats({ url, enabled, file, data, now = Date.now(), fetchImpl = globalThis.fetch, timeoutMs = 8000 }) {
  if (!url || !/^https?:\/\//.test(url)) return { sent: false, reason: 'sin-url' };
  if (!enabled) return { sent: false, reason: 'desactivado' };
  const state = loadState(file);
  if (!due(state.lastSent, now)) return { sent: false, reason: 'hoy' };
  const payload = buildPayload({ ...data, id: state.id });
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { sent: false, reason: 'http-' + r.status };
    state.lastSent = now;
    try { fs.writeFileSync(file, JSON.stringify(state)); } catch (_) { /* se reintentará mañana igualmente */ }
    return { sent: true, payload };
  } catch (e) { return { sent: false, reason: 'red' }; }
}

module.exports = { FIELDS, buildPayload, sendStats, loadState, due };
