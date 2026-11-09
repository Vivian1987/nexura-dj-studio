// Sugerencias y reportes de la beta
// Los testers describen un error o una idea; se añade (si lo aceptan) la
// información del sistema y los últimos errores de la app. Se envía directamente
// al correo de NexuraIA (vía FormSubmit desde el proceso principal) o, si hay un
// webhook configurado (p. ej. n8n), a ese webhook. Sin conexión, queda en cola.
import { el, toast } from '../util.js';
import { btn, select } from './controls.js';
import { platform } from '../platform.js';

export const FEEDBACK_EMAIL = 'contacto@nexuraia.com';
const CATEGORIES = { error: 'Error / algo no funciona', idea: 'Sugerencia / nueva función', design: 'Diseño / interfaz', other: 'Otro' };

export class Feedback {
  constructor(app) {
    this.app = app;
    this.errors = [];
    window.addEventListener('error', (e) => this.log((e.message || 'Error') + (e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : '')));
    window.addEventListener('unhandledrejection', (e) => this.log('Promesa rechazada: ' + ((e.reason && (e.reason.message || e.reason)) || '')));
    window.addEventListener('online', () => this.flushQueue());
  }

  // Envío directo al correo de NexuraIA (o al webhook si se ha configurado)
  async send(payload) {
    const webhook = (this.app.settings.feedbackWebhook || '').trim();
    if (webhook) return platform.postFeedback(webhook, payload);
    return platform.sendFeedback(payload);
  }

  // Sugerencias que no se pudieron enviar (sin conexión): se reintentan al abrir la app
  async flushQueue() {
    const q = (this.app.settings.feedbackQueue || []).slice();
    if (!q.length || this.flushing) return;
    this.flushing = true;
    const left = [];
    for (const p of q) { try { await this.send(p); } catch (_) { left.push(p); } }
    this.app.setSetting('feedbackQueue', left);
    this.flushing = false;
    if (left.length < q.length) toast(`Se han enviado ${q.length - left.length} sugerencia(s) pendiente(s). ¡Gracias!`, 'ok', 5000);
  }

  log(msg) {
    this.errors.push(`${new Date().toLocaleTimeString('es-ES')} ${String(msg).slice(0, 300)}`);
    if (this.errors.length > 20) this.errors.shift();
  }

  systemInfo() {
    const a = this.app, i = a.info || {};
    return [
      `Versión: ${i.version || '—'}`,
      `Sistema: ${i.os || i.platform || navigator.userAgent}`,
      `Electron: ${i.electron || '—'}`,
      `Pantalla: ${screen.width}×${screen.height} · ventana ${innerWidth}×${innerHeight} · escala ${devicePixelRatio}`,
      `Audio: ${a.outputDesc || a.engine?.outputMode || '—'} · ${a.engine?.ctx?.sampleRate || '—'} Hz`,
      `Controlador: ${a.midi?.controllerName || 'ninguno'}`,
      `Forma de onda: ${a.waveLayout === 'deck' ? 'en deck' : 'superior'} · modo laptop: ${document.body.classList.contains('laptop-mode') ? 'sí' : 'no'}`,
      `Pistas en la biblioteca: ${a.library?.tracks?.size ?? '—'}`
    ].join('\n');
  }

  compose({ cat, text, contact, withInfo }) {
    const version = this.app.info?.version || '';
    const first = text.split('\n')[0].slice(0, 60);
    const subject = `[Nexura DJ Studio ${version}] ${CATEGORIES[cat]}${first ? ': ' + first : ''}`;
    let body = `${text}\n\n`;
    if (contact) body += `Contacto: ${contact}\n\n`;
    if (withInfo) {
      body += `--- Información del equipo ---\n${this.systemInfo()}\n`;
      if (this.errors.length) body += `\n--- Últimos errores ---\n${this.errors.join('\n')}\n`;
    }
    return { subject, body };
  }

  async open(preset = 'idea') {
    const app = this.app;
    const cat = select(CATEGORIES, preset, () => {}, 'wide');
    cat.id = 'fb-cat';
    const text = el('textarea', { id: 'fb-text', class: 'wide fb-text', rows: 7, placeholder: 'Cuéntanos qué pasó o qué te gustaría. Si es un error: qué estabas haciendo, qué esperabas y qué ocurrió.' });
    const contact = el('input', { id: 'fb-contact', class: 'wide', placeholder: 'Tu email o teléfono (opcional, por si necesitamos más detalles)' });
    const withInfo = el('input', { id: 'fb-info', type: 'checkbox', class: 'switch' });
    withInfo.checked = true;
    const preview = el('pre', { class: 'fb-preview' }, this.systemInfo() + (this.errors.length ? `\n\nÚltimos errores (${this.errors.length}):\n${this.errors.slice(-5).join('\n')}` : ''));
    const body = el('div', { class: 'form fb-form' },
      el('p', { class: 'hint' }, 'Esta es una versión demo de Nexura DJ Studio. Tus sugerencias nos ayudan a mejorarla.'),
      el('label', { class: 'frm', for: 'fb-cat' }, el('span', {}, 'Tipo'), cat),
      el('label', { class: 'frm', for: 'fb-text' }, el('span', {}, 'Mensaje'), text),
      el('label', { class: 'frm', for: 'fb-contact' }, el('span', {}, 'Tu nombre o contacto (opcional)'), contact),
      el('label', { class: 'fb-check', for: 'fb-info' }, withInfo, el('span', {}, 'Incluir información del equipo y errores recientes (no incluye tu música ni tus archivos)')),
      preview,
      el('p', { class: 'hint' }, 'Al pulsar «Enviar», el mensaje llega directamente al equipo de NexuraIA.'));
    withInfo.addEventListener('change', () => { preview.hidden = !withInfo.checked; });

    const choice = await app.modal('Enviar sugerencias', body, ['Cancelar', 'Enviar']);
    if (choice !== 1) return;
    const msg = text.value.trim();
    if (!msg) { toast('Escribe un mensaje antes de enviarlo.', 'warn'); return this.open(cat.value); }
    const who = contact.value.trim();
    const { subject } = this.compose({ cat: cat.value, text: msg, contact: who, withInfo: withInfo.checked });
    const payload = {
      subject, category: CATEGORIES[cat.value], message: msg, contact: who,
      version: app.info?.version || '', system: withInfo.checked ? this.systemInfo() : '',
      errors: withInfo.checked ? this.errors.join('\n') : '', date: new Date().toLocaleString('es-ES')
    };
    toast('Enviando…', 'info', 2000);
    try {
      await this.send(payload);
      toast('¡Gracias! Tu sugerencia se ha enviado a NexuraIA.', 'ok', 5000);
    } catch (e) {
      app.setSetting('feedbackQueue', [...(app.settings.feedbackQueue || []), payload]);
      toast('No hay conexión ahora mismo. Tu sugerencia se enviará automáticamente más tarde.', 'warn', 7000);
    }
  }

  // Bienvenida de la beta (solo la primera vez)
  async welcome() {
    const app = this.app;
    if (!app.info?.isBeta || app.settings.betaWelcomeSeen === app.info.version) return;
    const body = el('div', { class: 'form fb-form' },
      el('p', {}, `Gracias por probar la versión ${app.info.version} de Nexura DJ Studio.`),
      el('ul', { class: 'fb-list' },
        el('li', {}, 'Arrastra música (MP3, WAV, FLAC…) a la biblioteca o pulsa «+ Añadir música» en la barra lateral.'),
        el('li', {}, 'Haz doble clic en una pista para cargarla en un deck.'),
        el('li', {}, 'Conecta tu controladora MIDI por USB; si no se reconoce sola, configúrala en Ajustes → MIDI con «Añadir controladora». También puedes usar teclado y ratón.'),
        el('li', {}, 'Importa listas de YouTube o Spotify con «+ Importar» en LISTAS ONLINE de la barra lateral.')),
      el('p', { class: 'hint' }, 'Es una versión de prueba: puede haber errores. Con el botón «💬 SUGERENCIAS» de la barra superior puedes enviarnos cualquier problema o idea en un minuto.'));
    const r = await app.modal('Bienvenido a la beta', body, ['Enviar una sugerencia', 'Empezar']);
    app.setSetting('betaWelcomeSeen', app.info.version);
    if (r === 0) this.open();
  }
}
