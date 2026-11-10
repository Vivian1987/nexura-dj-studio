// Informe de errores y sugerencias: arma lo que se envía (y lo que se enseña antes de enviarlo).
// Sin dependencias de Electron (se prueba en Node: tools/test-informe.mjs).
'use strict';
const { anonymize } = require('../src/js/shared/anonymize.js');

const KINDS = { error: 'Error', idea: 'Sugerencia', other: 'Otro' };
const LOG_LINES = 200;

// «Windows 11» / «Windows 10» a partir de os.release() (10.0.22000 o superior = Windows 11)
function windowsLabel(platform, release) {
  if (platform !== 'win32') return platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : String(platform || 'desconocido');
  const build = Number(String(release || '').split('.')[2]) || 0;
  return build >= 22000 ? 'Windows 11' : 'Windows 10';
}

const validEmail = (s) => /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(String(s || '').trim());

// Parte técnica (solo si se marca «Adjuntar registro técnico»): versión, sistema, controladora y las
// últimas líneas del registro, sin rutas, canciones, artistas ni correos.
function technical({ version, os, controller, decks, log = [], known = [], user = '', home = '' }) {
  const ctl = String(controller || '').slice(0, 80);
  return {
    version: String(version || ''),
    os: String(os || ''),
    controller: ctl ? anonymize(ctl, { known, user, home }) : 'ninguna',
    decks: [2, 4].includes(Number(decks)) ? Number(decks) : 2,
    log: (log || []).slice(-LOG_LINES).map(l => anonymize(l, { known, user, home }))
  };
}

// Texto legible del informe (vista previa del diálogo y archivo .txt de respaldo)
function reportText({ kind, text, email, tech }) {
  const out = [
    `Nexura DJ Studio — ${KINDS[kind] || 'Otro'}`,
    `Fecha: ${new Date().toISOString()}`,
    email ? `Contacto: ${email}` : 'Contacto: (no indicado)',
    '', String(text || '').trim(), ''
  ];
  if (tech) {
    out.push('--- Registro técnico ---', `Versión: ${tech.version}`, `Sistema: ${tech.os}`, `Controladora MIDI: ${tech.controller}`, `Decks: ${tech.decks}`,
      `Últimas ${tech.log.length} líneas del registro:`, ...tech.log);
  }
  return out.join('\n');
}

// JSON que se envía al endpoint. Incluye los campos del flujo de sugerencias de la beta (subject,
// category, message, contact, system, errors) para que el webhook ya existente siga funcionando.
function buildPayload({ kind, text, email, attach, tech, version }) {
  const k = KINDS[kind] ? kind : 'other';
  const msg = String(text || '').trim().slice(0, 8000);
  const contact = validEmail(email) ? String(email).trim() : '';
  const first = msg.split('\n')[0].slice(0, 60);
  const p = {
    app: 'Nexura DJ Studio', type: k, category: KINDS[k], message: msg, email: contact, contact,
    version: String(version || ''), date: new Date().toISOString(),
    subject: `[Nexura DJ Studio ${version || ''}] ${KINDS[k]}${first ? ': ' + first : ''}`
  };
  if (attach && tech) {
    p.technical = tech;
    p.system = `Versión: ${tech.version}\nSistema: ${tech.os}\nControladora MIDI: ${tech.controller}\nDecks: ${tech.decks}`;
    p.errors = tech.log.join('\n');
  }
  return p;
}

// mailto: con el texto (el registro va en el .txt guardado: los mailto largos no abren en Windows)
function mailtoUrl({ kind, text, email, file }) {
  const subject = `Nexura DJ Studio · ${KINDS[kind] || 'Otro'}`;
  let body = String(text || '').trim().slice(0, 1200);
  if (email) body += `\n\nContacto: ${email}`;
  if (file) body += `\n\nHe guardado el informe completo en: ${file}\n(Adjúntalo a este correo, por favor.)`;
  return 'mailto:contacto@nexuraia.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

module.exports = { KINDS, LOG_LINES, windowsLabel, validEmail, technical, reportText, buildPayload, mailtoUrl };
