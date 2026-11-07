// Importa mapeos MIDI de Mixxx (.midi.xml) y los traduce a acciones de Nexura.
// Solo se traducen los controles directos (sin script). Los controles que en Mixxx
// dependen de un script JavaScript (muy habitual en el jog) se cuentan aparte para
// completarlos con el asistente «Añadir controladora».
// Sin DOMParser para poder probarlo en Node: los .midi.xml tienen una estructura simple.

const tag = (src, name) => {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(src);
  return m ? m[1].trim() : '';
};
const blocks = (src, name) => {
  const out = [], re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
};
const unxml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const num = (s) => { const v = parseInt(String(s).trim(), /^\s*0x/i.test(s) ? 16 : 10); return Number.isFinite(v) ? v : NaN; };
const optionNames = (optSrc) => [...optSrc.matchAll(/<([a-z0-9-]+)\s*\/?>/gi)].map(m => m[1].toLowerCase());

const keyOf = (status, midino) => {
  const t = status & 0xF0, ch = status & 0x0F;
  if (t === 0x80 || t === 0x90) return `n${ch}:${midino}`;
  if (t === 0xB0) return `c${ch}:${midino}`;
  if (t === 0xE0) return `p${ch}:0`;
  return null;
};

// [ChannelN] → prefijo de deck (hasta 4 decks)
const deckOf = (group) => {
  const m = /^\[Channel([1-4])\]$/.exec(group);
  return m ? `deck${m[1]}.` : null;
};

// Traducción grupo + clave de Mixxx → acción de Nexura
function translate(group, key) {
  const d = deckOf(group);
  if (d) {
    const direct = {
      play: 'play', cue_default: 'cue', cue_set: 'cue', cue_gotoandplay: 'stutter', cue_gotoandstop: 'start', start_stop: 'start', start: 'start',
      sync_enabled: 'sync', beatsync: 'sync', beatsync_tempo: 'sync', sync_leader: 'sync', keylock: 'keylock', slip_enabled: 'slip', reverseroll: 'censor',
      pfl: 'pfl', volume: 'fader', rate: 'pitch', pregain: 'trim',
      filterLow: 'low', filterMid: 'mid', filterHigh: 'high',
      rate_temp_up: 'bendplus', rate_temp_down: 'bendminus', rate_temp_up_small: 'bendplus', rate_temp_down_small: 'bendminus',
      beatloop_activate: 'loop', beatloop_toggle: 'loop', loop_halve: 'loophalve', loop_double: 'loopdouble', loop_in: 'loopin', loop_out: 'loopout',
      reloop_toggle: 'reloop', reloop_exit: 'reloop', reloop_andstop: 'reloop',
      beatjump_forward: 'jumpfwd', beatjump_backward: 'jumpback',
      LoadSelectedTrack: 'load', eject: 'eject', bpm_tap: 'tap', tempo_tap: 'tap',
      pitch_up: 'keyup', pitch_down: 'keydown', reset_key: 'keyreset', pitch_adjust_set_default: 'keyreset',
      jog: 'jog', scratch2_enable: 'jogtouch'
    };
    if (direct[key]) return d + direct[key];
    let m;
    if ((m = /^hotcue_([1-8])_(activate|gotoandplay|goto|gotoandstop)$/.exec(key))) return d + 'hotcue' + m[1];
    if ((m = /^hotcue_([1-8])_clear$/.exec(key))) return d + 'hotcueclear' + m[1];
    if ((m = /^beatloop_[\d.]+_(activate|toggle)$/.exec(key))) return d + 'loop';
    return null;
  }
  let m;
  if ((m = /^\[EqualizerRack1_\[Channel([1-4])\]_Effect1\]$/.exec(group))) {
    const p = { parameter1: 'low', parameter2: 'mid', parameter3: 'high' }[key];
    return p ? `deck${m[1]}.${p}` : null;
  }
  if ((m = /^\[QuickEffectRack1_\[Channel([1-4])\]\]$/.exec(group))) return key === 'super1' ? `deck${m[1]}.filter` : null;
  if (group === '[Master]' || group === '[Mixer]') {
    return { crossfader: 'xfader', gain: 'master', headMix: 'cuemix', headGain: 'phones', headSplit: 'split' }[key] || null;
  }
  if (group === '[Library]') {
    return { MoveVertical: 'browse', MoveUp: 'browseup', MoveDown: 'browsedown', MoveFocus: 'browsepush', MoveFocusForward: 'browsepush', MoveFocusBackward: 'back', GoToItem: 'browsepush' }[key] || null;
  }
  if (group === '[Playlist]') {
    return { SelectTrackKnob: 'browse', SelectNextTrack: 'browsedown', SelectPrevTrack: 'browseup', LoadSelectedIntoFirstStopped: 'load' }[key] || null;
  }
  if ((m = /^\[Sampler([1-8])\]$/.exec(group))) {
    if (['cue_gotoandplay', 'start_play', 'play', 'cue_default'].includes(key)) return 'sampler' + m[1];
    if (['stop', 'start_stop', 'eject'].includes(key)) return 'samplerstop' + m[1];
    return null;
  }
  if ((m = /^\[EffectRack1_EffectUnit([12])_Effect([1-3])\]$/.exec(group))) {
    return { enabled: `fx${m[1]}.on${m[2]}`, meta: `fx${m[1]}.param${m[2]}`, effect_selector: `fx${m[1]}.next${m[2]}`, next_effect: `fx${m[1]}.next${m[2]}` }[key] || null;
  }
  if ((m = /^\[EffectRack1_EffectUnit([12])\]$/.exec(group))) {
    return { mix: `fx${m[1]}.mix` }[key] || null;
  }
  if (group === '[Recording]' && key === 'toggle_recording') return 'record';
  return null;
}

// Indicadores de Mixxx (salidas) → acción cuyo estado enciende el LED
function translateOutput(group, key) {
  const d = deckOf(group);
  if (d) {
    const direct = { play_indicator: 'play', play: 'play', cue_indicator: 'cue', sync_enabled: 'sync', keylock: 'keylock', pfl: 'pfl', slip_enabled: 'slip', loop_enabled: 'loop' };
    if (direct[key]) return d + direct[key];
    const m = /^hotcue_([1-8])_(enabled|status)$/.exec(key);
    if (m) return d + 'hotcue' + m[1];
    return null;
  }
  let m;
  if ((m = /^\[EffectRack1_EffectUnit([12])_Effect([1-3])\]$/.exec(group)) && key === 'enabled') return `fx${m[1]}.on${m[2]}`;
  if ((m = /^\[Sampler([1-8])\]$/.exec(group)) && (key === 'play' || key === 'play_indicator')) return 'sampler' + m[1];
  if (group === '[Master]' && key === 'headSplit') return 'split';
  return null;
}

export function parseMixxxMapping(xml, actions = null) {
  const src = String(xml || '');
  if (!/<MixxxControllerPreset|<MixxxMIDIPreset/i.test(src)) throw new Error('El archivo no parece un mapeo MIDI de Mixxx (.midi.xml).');
  const info = tag(src, 'info');
  const name = unxml(tag(info, 'name')) || 'Mapeo de Mixxx';
  const author = unxml(tag(info, 'author'));
  const map = {}, opts = {}, leds = [];
  const report = { total: 0, imported: 0, scripted: 0, unsupported: [], lsb: 0 };
  const scriptedNames = new Set();
  const known = (id) => !actions || !!actions[id];

  for (const c of blocks(tag(src, 'controls') || src, 'control')) {
    const group = unxml(tag(c, 'group')), key = unxml(tag(c, 'key'));
    const status = num(tag(c, 'status')), midino = num(tag(c, 'midino'));
    if (!Number.isFinite(status) || !Number.isFinite(midino)) continue;
    report.total++;
    const o = optionNames(tag(c, 'options'));
    const k = keyOf(status, midino);
    if (!k) { report.unsupported.push(`${group} ${key}`); continue; }
    if (o.includes('script-binding') || /\./.test(key)) {
      report.scripted++;
      scriptedNames.add((key.split('.').pop() || key) + (group ? ` ${group}` : ''));
      continue;
    }
    if (o.includes('fourteen-bit-lsb')) { report.lsb++; continue; } // el LSB se detecta solo
    const action = translate(group, key);
    if (!action || !known(action)) { report.unsupported.push(`${group} ${key}`); continue; }
    if ((status & 0xF0) === 0x80) { // la entrada «note off» complementa a la «note on»
      if (!map[k]) map[k] = action;
      continue;
    }
    map[k] = action;
    const op = {};
    if (o.includes('invert')) op.inv = true;
    if (o.includes('spread64')) op.enc = 'offset';
    else if (o.includes('selectknob') || o.includes('herc-jog') || o.includes('diff') || o.includes('relative')) op.enc = 'twos';
    if (Object.keys(op).length) opts[k] = op; else delete opts[k];
    report.imported++;
  }

  for (const out of blocks(tag(src, 'outputs'), 'output')) {
    const group = unxml(tag(out, 'group')), key = unxml(tag(out, 'key'));
    const status = num(tag(out, 'status')), midino = num(tag(out, 'midino'));
    if (!Number.isFinite(status) || !Number.isFinite(midino)) continue;
    const action = translateOutput(group, key);
    const k = keyOf(status, midino);
    if (!action || !k || k[0] === 'p' || !known(action)) continue;
    const on = num(tag(out, 'on')), off = num(tag(out, 'off'));
    leds.push({ key: k, action, on: Number.isFinite(on) ? on : 0x7F, off: Number.isFinite(off) ? off : 0 });
  }
  report.leds = leds.length;
  report.scriptedNames = [...scriptedNames].slice(0, 12);
  report.mappedActions = new Set(Object.values(map)).size;
  report.hasJog = Object.values(map).some(a => /\.jog$/.test(a));
  return { name, author, map, opts, leds, source: 'mixxx', report };
}
