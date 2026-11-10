// Anonimiza el texto técnico que sale del equipo (informe de errores): nunca rutas de archivos, nombres
// de canciones ni artistas, correos, nombre de usuario de Windows, enlaces ni identificadores de vídeos.
// Compartido: el proceso principal lo usa con require() (main/report.js) y la interfaz con import()
// (en el navegador queda en globalThis.nexuraAnonymize). Probado en Node: tools/test-informe.mjs.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.nexuraAnonymize = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const AUDIO = 'mp3|wav|flac|ogg|oga|opus|m4a|aac|mp4|webm|aiff?|alac|wma|m3u8?|crate|nml|xml|vdjfolder';

  // known: títulos, artistas y nombres de archivo de la biblioteca (se sustituyen por <pista>)
  function anonymize(text, { known = [], user = '', home = '' } = {}) {
    let s = String(text == null ? '' : text);
    // 1) enlaces (https://…, file://…, web:… del modo navegador)
    s = s.replace(/\b(?:https?|file):\/\/[^\s"'«»<>)]+/gi, '<enlace>');
    s = s.replace(/\bweb:[^\r\n]*?:\d+\b/g, '<archivo>').replace(/\bweb:\S+/g, '<archivo>');
    // 2) carpeta personal y rutas de Windows (C:\…, \\servidor\…) y Unix (/home/…, /Users/…, /mnt/…).
    //    Los nombres pueden llevar espacios y paréntesis: la ruta llega hasta la extensión de audio (lo que
    //    sigue se conserva) o, si no la hay, hasta el final del fragmento (mejor quitar de más que de menos).
    if (home && home.length >= 3) s = s.split(home).join('<ruta>');
    const cut = (m) => {
      const ext = new RegExp(`^.*?\\.(?:${AUDIO})\\b`, 'i').exec(m);
      return ext ? '<ruta>' + m.slice(ext[0].length) : '<ruta>';
    };
    s = s.replace(/(?:[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\/])[^"'«»<>|\r\n\t]*/g, cut);
    s = s.replace(/(?:^|(?<=[\s"'(=:]))\/(?:home|Users|mnt|media|Volumes|tmp|var|private|run|srv|data)\/[^"'«»<>|\r\n\t]*/g, cut);
    s = s.replace(/<ruta>[\\/][^"'«»<>|\r\n\t]*/g, cut);
    // restos: «algo.mp3» suelto
    s = s.replace(new RegExp(`[^\\s"'«»<>()\\[\\]]+\\.(?:${AUDIO})\\b`, 'gi'), '<archivo>');
    // 3) texto entre comillas angulares o tipográficas (los mensajes de la app ponen ahí títulos y crates)
    s = s.replace(/«[^»]{0,300}»/g, '«…»').replace(/“[^”]{0,300}”/g, '“…”');
    // 4) nombres de la biblioteca (los más largos primero; ≥ 4 caracteres para no borrar palabras comunes)
    const names = [...new Set((known || []).map(x => String(x || '').trim()).filter(x => x.length >= 4))].sort((a, b) => b.length - a.length);
    for (let i = 0; i < names.length; i += 200) {
      const re = new RegExp(names.slice(i, i + 200).map(escapeRe).join('|'), 'gi');
      s = s.replace(re, '<pista>');
    }
    // 5) correos, nombre de usuario, ids de YouTube y de Spotify
    s = s.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<email>');
    if (user && user.length >= 3) s = s.replace(new RegExp(`\\b${escapeRe(user)}\\b`, 'gi'), '<usuario>');
    s = s.replace(/\byt_[\w-]{6,20}\b/g, 'yt_<id>').replace(/\b(?:v=|youtu\.be\/)[\w-]{11}\b/g, 'v=<id>');
    s = s.replace(/\bspotify:(?:track|playlist|album|user):[\w:]+/g, 'spotify:<id>');
    return s;
  }
  return { anonymize };
});
