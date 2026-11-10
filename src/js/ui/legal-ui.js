// Textos legales (src/legal/*.txt, también en el instalador): licencia, privacidad y licencias de terceros
import { el, toast } from '../util.js';

// Explicación exacta del contador anónimo (bienvenida y Ajustes → General); mismos campos que main/stats.js
export const STATS_FIELDS_TEXT = 'un identificador aleatorio de esta instalación (generado en tu equipo, sin relación con nada personal), la versión de la app, el idioma, si es Windows 10 u 11, el número de decks que usas (2 o 4) y si hay una controladora conectada (sí/no, sin el modelo).';

const DOCS = {
  licencia: { file: 'LICENCIA.txt', title: 'Licencia de uso' },
  privacidad: { file: 'PRIVACIDAD.txt', title: 'Política de privacidad' },
  terceros: { file: 'TERCEROS.txt', title: 'Licencias de terceros' }
};

export class LegalUI {
  constructor(app) { this.app = app; this.cache = {}; }

  async text(name) {
    const d = DOCS[name];
    if (!d) throw new Error('Documento desconocido');
    if (!this.cache[name]) {
      const r = await fetch('legal/' + d.file, { cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      this.cache[name] = (await r.text()).replace(/^﻿/, '');
    }
    return this.cache[name];
  }

  async show(name) {
    let txt;
    try { txt = await this.text(name); } catch (e) { return toast('No se pudo abrir el documento: ' + e.message, 'error'); }
    const pre = el('pre', { class: 'legal-text', tabindex: 0 }, txt);
    return this.app.modal(DOCS[name].title, pre, ['Cerrar']);
  }
}
