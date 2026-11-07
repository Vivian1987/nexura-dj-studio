// Núcleo de análisis (funciones puras): forma de onda por bandas, BPM + fase
// del beatgrid y tonalidad (perfiles de Krumhansl-Kessler → Camelot).

const FFT_CACHE = new Map();
function fftTables(n) {
  let t = FFT_CACHE.get(n);
  if (t) return t;
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    let r = 0, x = i;
    for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos(-2 * Math.PI * i / n); sin[i] = Math.sin(-2 * Math.PI * i / n); }
  t = { rev, cos, sin };
  FFT_CACHE.set(n, t);
  return t;
}

// FFT compleja in-place (re, im de longitud potencia de 2)
export function fft(re, im) {
  const n = re.length;
  const { rev, cos, sin } = fftTables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1, step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const a = i + j, b = a + half;
        const tr = re[b] * cos[k] - im[b] * sin[k];
        const ti = re[b] * sin[k] + im[b] * cos[k];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

// Biquad paso bajo (RBJ)
function lowpass(x, sr, fc, q = 0.7071) {
  const w = 2 * Math.PI * fc / sr, cw = Math.cos(w), a = Math.sin(w) / (2 * q);
  const b0 = (1 - cw) / 2, b1 = 1 - cw, b2 = b0, a0 = 1 + a, a1 = -2 * cw, a2 = 1 - a;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

export function decimate(x, sr, target = 11025) {
  const f = Math.max(1, Math.round(sr / target));
  if (f === 1) return { d: x, sr };
  const lp = lowpass(lowpass(x, sr, (sr / f) * 0.42), sr, (sr / f) * 0.42);
  const d = new Float32Array(Math.floor(x.length / f));
  for (let i = 0; i < d.length; i++) d[i] = lp[i * f];
  return { d, sr: sr / f };
}

// ---------------------------------------------------------------------------
// Forma de onda: 4 bytes por bloque [amplitud, graves, medios, agudos]
// ---------------------------------------------------------------------------
export function computeWaveform(x, sr, binsPerSec = 150) {
  const hop = Math.max(1, Math.round(sr / binsPerSec));
  const nb = Math.ceil(x.length / hop);
  const amp = new Float32Array(nb), lo = new Float32Array(nb), mi = new Float32Array(nb), hi = new Float32Array(nb);
  const aL = 1 - Math.exp(-2 * Math.PI * 220 / sr);   // paso bajo 220 Hz
  const aH = 1 - Math.exp(-2 * Math.PI * 2600 / sr);  // paso bajo 2,6 kHz (para separar agudos)
  let l1 = 0, l2 = 0, h1 = 0, h2 = 0;
  for (let b = 0; b < nb; b++) {
    let pa = 0, pl = 0, pm = 0, ph = 0;
    const end = Math.min(x.length, (b + 1) * hop);
    for (let i = b * hop; i < end; i++) {
      const v = x[i];
      l1 += aL * (v - l1); l2 += aL * (l1 - l2);
      h1 += aH * (v - h1); h2 += aH * (h1 - h2);
      const low = l2, high = v - h2, mid = h2 - l2;
      const av = v < 0 ? -v : v; if (av > pa) pa = av;
      const al = low < 0 ? -low : low; if (al > pl) pl = al;
      const am = mid < 0 ? -mid : mid; if (am > pm) pm = am;
      const ah = high < 0 ? -high : high; if (ah > ph) ph = ah;
    }
    amp[b] = pa; lo[b] = pl; mi[b] = pm; hi[b] = ph;
  }
  let mA = 1e-6, mL = 1e-6, mM = 1e-6, mH = 1e-6;
  for (let b = 0; b < nb; b++) { if (amp[b] > mA) mA = amp[b]; if (lo[b] > mL) mL = lo[b]; if (mi[b] > mM) mM = mi[b]; if (hi[b] > mH) mH = hi[b]; }
  const out = new Uint8Array(nb * 4);
  for (let b = 0; b < nb; b++) {
    out[b * 4] = Math.round(255 * amp[b] / mA);
    out[b * 4 + 1] = Math.round(255 * Math.min(1, lo[b] / mL));
    out[b * 4 + 2] = Math.round(255 * Math.min(1, mi[b] / mM));
    out[b * 4 + 3] = Math.round(255 * Math.min(1, hi[b] / mH));
  }
  return { data: out, rate: sr / hop };
}

// ---------------------------------------------------------------------------
// Envolventes de ataques: flujo espectral (todas las bandas) y energía de graves
// ---------------------------------------------------------------------------
function detrend(env, fps, sec = 0.25) {
  const n = env.length, w = Math.max(1, Math.round(fps * sec));
  const out = new Float32Array(n);
  // media móvil centrada con suma prefija
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + env[i];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
    out[i] = Math.max(0, env[i] - (pre[b] - pre[a]) / (b - a));
  }
  return out;
}
function normalize(env) {
  let m = 1e-9;
  for (let i = 0; i < env.length; i++) if (env[i] > m) m = env[i];
  for (let i = 0; i < env.length; i++) env[i] /= m;
  return env;
}

export function onsetEnvelope(d, sr, frame = 512, hop = 128) {
  const n = Math.max(0, Math.floor((d.length - frame) / hop));
  const env = new Float32Array(n);
  const win = new Float32Array(frame);
  for (let i = 0; i < frame; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / frame);
  const re = new Float64Array(frame), im = new Float64Array(frame);
  const half = frame / 2;
  const prev = new Float32Array(half);
  const maxBin = Math.min(half, Math.floor(5000 / (sr / frame)));
  for (let f = 0; f < n; f++) {
    const off = f * hop;
    for (let i = 0; i < frame; i++) { re[i] = d[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < maxBin; k++) {
      const mag = Math.log1p(100 * Math.hypot(re[k], im[k]));
      const diff = mag - prev[k];
      if (diff > 0) flux += diff;
      prev[k] = mag;
    }
    env[f] = flux;
  }
  const fps = sr / hop;
  // El máximo del flujo aparece cuando el ataque ha entrado ~85 % en la ventana de Hann
  return { env: normalize(detrend(env, fps)), fps, offset: (frame * 0.85) / sr };
}

// Energía de graves (bombo): paso bajo 130 Hz, energía por bloque, derivada logarítmica
export function lowEnvelope(d, sr, hop = 128) {
  const lp = lowpass(lowpass(d, sr, 130), sr, 130);
  const n = Math.floor(lp.length / hop);
  const env = new Float32Array(n);
  let prev = 0;
  for (let b = 0; b < n; b++) {
    let e = 0;
    for (let i = b * hop; i < (b + 1) * hop; i++) e += lp[i] * lp[i];
    const l = Math.log1p(1000 * e / hop);
    env[b] = Math.max(0, l - prev);
    prev = l;
  }
  return { env: normalize(detrend(env, sr / hop)), fps: sr / hop, offset: 0 };
}

function sampleAt(env, x) {
  const i = Math.floor(x);
  if (i < 0 || i + 1 >= env.length) return 0;
  const f = x - i;
  return env[i] * (1 - f) + env[i + 1] * f;
}

function combScore(env, period, phase) {
  let s = 0, k = 0;
  for (let x = phase; x < env.length - 1; x += period) { s += sampleAt(env, x); k++; }
  return k ? s / k : 0;
}

function bestPhase(env, period, steps) {
  let bp = 0, bs = -Infinity, sum = 0;
  for (let k = 0; k < steps; k++) {
    const ph = (k / steps) * period;
    const s = combScore(env, period, ph);
    sum += s;
    if (s > bs) { bs = s; bp = ph; }
  }
  return { phase: bp, score: bs, contrast: bs / (sum / steps + 1e-9) };
}

// full: flujo espectral; low: envolvente de graves (misma fps). Devuelve BPM y tiempo del primer beat.
export function detectTempo(full, low, fps, minBpm = 85, maxBpm = 175, offFull = 0, offLow = 0) {
  const n = Math.min(full.length, low.length);
  if (n < fps * 4) return null;
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) env[i] = full[i] + low[i];
  // Autocorrelación en el rango 50–220 BPM
  const lagMin = Math.floor(60 * fps / 220), lagMax = Math.ceil(60 * fps / 50);
  const acf = new Float32Array(lagMax + 2);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n;
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = env[i] - mean;
  for (let lag = lagMin; lag <= lagMax + 1 && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += e[i] * e[i + lag];
    acf[lag] = s / (n - lag);
  }
  const acfAt = (lag) => {
    const i = Math.floor(lag), f = lag - i;
    if (i < lagMin || i + 1 > lagMax + 1) return 0;
    return acf[i] * (1 - f) + acf[i + 1] * f;
  };
  let best = null, bestScore = -Infinity;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.05) {
    const lag = 60 * fps / bpm;
    const s = acfAt(lag) + 0.5 * acfAt(lag * 2) + 0.25 * acfAt(lag * 4) + 0.3 * acfAt(lag / 2);
    if (s > bestScore) { bestScore = s; best = bpm; }
  }
  if (best == null) return null;

  // Refinado del BPM con filtro de peine sobre la envolvente combinada
  let rb = best, rs = -Infinity;
  const search = (lo, hi, step) => {
    for (let bpm = lo; bpm <= hi + 1e-9; bpm += step) {
      const period = 60 * fps / bpm;
      const r = bestPhase(env, period, Math.max(8, Math.round(period * 2)));
      if (r.score > rs) { rs = r.score; rb = bpm; }
    }
  };
  search(best - 1.5, best + 1.5, 0.05);
  const coarse = rb;
  search(coarse - 0.06, coarse + 0.06, 0.005);

  let bpm = rb;
  if (Math.abs(bpm - Math.round(bpm)) < 0.08) bpm = Math.round(bpm);
  else bpm = Math.round(bpm * 100) / 100;

  // Fase: preferimos el bombo (graves); si no hay graves rítmicos, el flujo completo
  const period = 60 * fps / bpm;
  const steps = Math.round(period * 4);
  const pl = bestPhase(low, period, steps);
  const pf = bestPhase(full, period, steps);
  const useLow = pl.contrast > 1.6;
  const penv = useLow ? low : full;
  const poff = useLow ? offLow : offFull;
  let per = period, ph = useLow ? pl.phase : pf.phase;

  // Ajuste por regresión lineal sobre los máximos reales cerca de cada beat previsto
  for (let iter = 0; iter < 3; iter++) {
    const ks = [], ts = [];
    const win = Math.max(2, Math.round(per * 0.12));
    for (let k = 0; ph + k * per < n - 2; k++) {
      const c = Math.round(ph + k * per);
      let bi = -1, bv = 0.15;
      for (let i = Math.max(1, c - win); i <= Math.min(n - 2, c + win); i++) {
        if (penv[i] > bv && penv[i] >= penv[i - 1] && penv[i] >= penv[i + 1]) { bv = penv[i]; bi = i; }
      }
      if (bi < 0) continue;
      const a = penv[bi - 1], b = penv[bi], cc = penv[bi + 1];
      const den = a - 2 * b + cc;
      const off = den !== 0 ? 0.5 * (a - cc) / den : 0;
      ks.push(k); ts.push(bi + Math.max(-0.5, Math.min(0.5, off)));
    }
    if (ks.length < 16) break;
    let mk = 0, mt = 0;
    for (let i = 0; i < ks.length; i++) { mk += ks[i]; mt += ts[i]; }
    mk /= ks.length; mt /= ks.length;
    let sxy = 0, sxx = 0;
    for (let i = 0; i < ks.length; i++) { sxy += (ks[i] - mk) * (ts[i] - mt); sxx += (ks[i] - mk) ** 2; }
    const slope = sxy / sxx;
    if (!(slope > 0) || Math.abs(slope / per - 1) > 0.02) break;
    per = slope; ph = mt - slope * mk;
  }
  let fb = 60 * fps / per;
  if (Math.abs(fb - Math.round(fb)) < 0.06) {
    // BPM entero: re-centra la fase con el periodo exacto
    const exact = 60 * fps / Math.round(fb);
    const mid = ph + per * Math.floor((n / per) / 2);
    ph = mid - exact * Math.floor((n / per) / 2);
    fb = Math.round(fb);
  } else fb = Math.round(fb * 100) / 100;
  const phaseTime = ph / fps + poff;
  // BPM variable: desviación local de los golpes respecto a la rejilla fija
  let drift = null;
  try { drift = trackDrift(penv, fps, 60 * fps / fb, ph, poff); } catch (e) { drift = null; }
  return { bpm: fb, phaseTime, confidence: bestScore, phaseFrom: useLow ? 'low' : 'full', drift };
}

// BPM variable: seguimiento de beats por programación dinámica (cada beat se apoya en el anterior
// con una penalización por desviarse del periodo medio) y, si el tempo cambia de forma sostenida
// (directos, temas tocados sin claqueta), marcas de beatgrid [{t, bpm}] cada 16 compases.
// Si la rejilla fija ya encaja (error mediano < 15 ms o tempo estable), devuelve null.
export function trackDrift(env, fps, per, ph, off = 0) {
  const n = env.length;
  if (n < per * 80) return null;
  const tight = 50;
  const score = new Float32Array(n), back = new Int32Array(n).fill(-1);
  const lo = Math.round(per * 0.75), hi = Math.round(per * 1.33);
  const pen = new Float32Array(hi + 1);
  for (let tau = lo; tau <= hi; tau++) pen[tau] = tight * Math.log(tau / per) ** 2;
  for (let t = 0; t < n; t++) {
    let best = 0, bi = -1;
    for (let tau = lo; tau <= hi && tau <= t; tau++) {
      const v = score[t - tau] - pen[tau];
      if (v > best) { best = v; bi = t - tau; }
    }
    score[t] = env[t] + best; back[t] = bi;
  }
  let end = n - 1;
  for (let t = Math.max(0, n - Math.ceil(per)); t < n; t++) if (score[t] > score[end]) end = t;
  const fr = [];
  for (let t = end; t >= 0; t = back[t]) { fr.push(t); if (back[t] < 0) break; }
  fr.reverse();
  if (fr.length < 64) return null;
  // posición fina de cada beat (máximo parabólico cercano)
  const b = fr.map(t => {
    let bi = t;
    for (let i = Math.max(1, t - 2); i <= Math.min(n - 2, t + 2); i++) if (env[i] > env[bi]) bi = i;
    if (bi <= 0 || bi >= n - 1) return bi;
    const a = env[bi - 1], c = env[bi], d = env[bi + 1], den = a - 2 * c + d;
    return bi + (den !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - d) / den)) : 0);
  });
  // ajuste lineal local (±8 beats) para quitar el temblor de cada golpe
  const fitAt = (i) => {
    const a = Math.max(0, i - 8), z = Math.min(b.length - 1, i + 8);
    let mk = 0, mt = 0, c = 0;
    for (let k = a; k <= z; k++) { mk += k; mt += b[k]; c++; }
    mk /= c; mt /= c;
    let sxy = 0, sxx = 0;
    for (let k = a; k <= z; k++) { sxy += (k - mk) * (b[k] - mt); sxx += (k - mk) ** 2; }
    const sl = sxx ? sxy / sxx : per;
    return { t: mt + sl * (i - mk), per: sl };
  };
  // ¿hace falta? error de la rejilla fija frente a los beats seguidos y variación del tempo local
  const k0 = Math.round((b[0] - ph) / per);
  const errs = b.map((x, i) => { let e = (x - (ph + (k0 + i) * per)) / per; e -= Math.round(e); return Math.abs(e * per) / fps; }).sort((x, y) => x - y);
  const medErr = errs[errs.length >> 1];
  const pers = [];
  for (let i = 16; i < b.length - 16; i += 16) pers.push(fitAt(i).per);
  const vari = pers.length ? (Math.max(...pers) - Math.min(...pers)) / per : 0;
  if (medErr < 0.015 || vari < 0.012) return null;
  // marcas cada 4 compases y después se quitan las que no hacen falta (error < 5 ms sin ellas)
  const fitT = (i) => fitAt(i).t / fps + off;
  let marks = [];
  for (let i = 0; i < b.length; i += 16) marks.push({ i, t: fitT(i) });
  const lastI = b.length - 1 - ((b.length - 1) % 4);
  if (lastI - marks[marks.length - 1].i >= 8) marks.push({ i: lastI, t: fitT(lastI) });
  const fits = (a, z) => {
    const p = (z.t - a.t) / (z.i - a.i);
    for (let j = a.i + 1; j < z.i; j++) if (Math.abs(a.t + (j - a.i) * p - fitT(j)) > 0.005) return false;
    return true;
  };
  const kept = [marks[0]];
  for (let k = 1; k < marks.length - 1; k++) if (!fits(kept[kept.length - 1], marks[k + 1])) kept.push(marks[k]);
  kept.push(marks[marks.length - 1]);
  marks = kept;
  if (marks.length < 2) return null;
  const grid = marks.map((m, k) => {
    const nx = marks[k + 1];
    return { t: m.t, bpm: nx ? 60 * (nx.i - m.i) / (nx.t - m.t) : null };
  });
  grid[grid.length - 1].bpm = grid[grid.length - 2].bpm;
  return grid.map(g => ({ t: Math.round(g.t * 10000) / 10000, bpm: Math.round(g.bpm * 1000) / 1000 }));
}


// ---------------------------------------------------------------------------
// Tonalidad
// ---------------------------------------------------------------------------
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return num / Math.sqrt(da * db || 1);
}

export function detectKey(d, sr) {
  const N = 8192;
  if (d.length < N * 2) return null;
  const chroma = new Float64Array(12);
  const re = new Float64Array(N), im = new Float64Array(N);
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const totalFrames = Math.floor((d.length - N) / (N / 2));
  const maxFrames = 360;
  const stride = Math.max(1, Math.floor(totalFrames / maxFrames));
  // tabla bin → (clase de altura, peso)
  const binHz = sr / N;
  const kMin = Math.ceil(55 / binHz), kMax = Math.min(N / 2 - 1, Math.floor(2000 / binHz));
  const pcs = new Int8Array(kMax + 1), wts = new Float32Array(kMax + 1);
  for (let k = kMin; k <= kMax; k++) {
    const midi = 69 + 12 * Math.log2((k * binHz) / 440);
    const r = Math.round(midi);
    const dev = Math.abs(midi - r);
    pcs[k] = ((r % 12) + 12) % 12;
    wts[k] = dev < 0.5 ? Math.cos(dev * Math.PI) ** 2 : 0;
  }
  const frameC = new Float64Array(12);
  for (let f = 0; f < totalFrames; f += stride) {
    const off = f * (N / 2);
    for (let i = 0; i < N; i++) { re[i] = d[off + i] * win[i]; im[i] = 0; }
    fft(re, im);
    frameC.fill(0);
    let tot = 0;
    for (let k = kMin; k <= kMax; k++) {
      const m = Math.hypot(re[k], im[k]);
      const v = m * wts[k];
      frameC[pcs[k]] += v; tot += v;
    }
    if (tot > 1e-9) for (let c = 0; c < 12; c++) chroma[c] += frameC[c] / tot;
  }
  let best = { score: -2, tonic: 0, minor: false };
  for (let t = 0; t < 12; t++) {
    const rot = Array.from({ length: 12 }, (_, i) => chroma[(i + t) % 12]);
    const sM = pearson(rot, MAJOR), sm = pearson(rot, MINOR);
    if (sM > best.score) best = { score: sM, tonic: t, minor: false };
    if (sm > best.score) best = { score: sm, tonic: t, minor: true };
  }
  return best;
}

export function rmsDb(x) {
  let s = 0;
  const step = Math.max(1, Math.floor(x.length / 2000000));
  let n = 0;
  for (let i = 0; i < x.length; i += step) { s += x[i] * x[i]; n++; }
  return 10 * Math.log10(s / Math.max(1, n) + 1e-12);
}

// Energía 1-10 (v2, calibrada con una biblioteca real de música de baile):
// volumen medio de la pista (dB RMS), tempo y proporción de frases altas de la curva de energía.
export const ENERGY_VERSION = 2;
export function energyFrom(trackRmsDb, bpm, curve) {
  const loud = Math.min(1, Math.max(0, (trackRmsDb + 17) / 9));          // −17 dB → 0 · −8 dB → 1
  const tempo = Math.min(1, Math.max(0, ((bpm || 120) - 95) / 45));       // 95 → 0 · 140 → 1
  const hf = curve && curve.length ? curve.filter(v => v >= 0.62).length / curve.length : 0.5;
  const drive = Math.min(1, Math.max(0, (hf - 0.2) / 0.5));
  return Math.max(1, Math.min(10, Math.round(1 + 9 * (0.5 * loud + 0.3 * tempo + 0.2 * drive))));
}

// ---------------------------------------------------------------------------
// Estructura y energía (herramientas de IA): curva de energía por compás,
// frases de 8 compases → intro, drops, breaks y outro; energía global 1-10.
// ---------------------------------------------------------------------------
export function analyzeStructure(d, sr, bpm, firstBeat = 0, trackRmsDb = null) {
  const dur = d.length / sr;
  if (dur < 20) return { energy: null, sections: [] };
  const beat = bpm ? 60 / bpm : 0.5;            // sin BPM: bloques de 2 s por «compás»
  const bar = beat * 4;
  const phraseBars = 8;
  const start0 = bpm ? ((firstBeat % bar) + bar) % bar : 0;
  const low = lowpass(lowpass(d, sr, 150), sr, 150);
  const nb = Math.floor((dur - start0) / bar);
  if (nb < phraseBars * 2) return { energy: null, sections: [] };
  const eFull = new Float64Array(nb), eLow = new Float64Array(nb), eFlux = new Float64Array(nb);
  for (let b = 0; b < nb; b++) {
    const i0 = Math.floor((start0 + b * bar) * sr), i1 = Math.min(d.length, Math.floor((start0 + (b + 1) * bar) * sr));
    let s = 0, sl = 0, fl = 0, prev = 0;
    for (let i = i0; i < i1; i++) {
      s += d[i] * d[i]; sl += low[i] * low[i];
      const a = Math.abs(d[i]); if (a > prev) fl += a - prev; prev = a * 0.995 + prev * 0.005;
    }
    const n = Math.max(1, i1 - i0);
    eFull[b] = 10 * Math.log10(s / n + 1e-10);
    eLow[b] = 10 * Math.log10(sl / n + 1e-10);
    eFlux[b] = fl / n;
  }
  const norm = (a) => {
    const v = [...a].sort((x, y) => x - y);
    const lo = v[Math.floor(v.length * 0.05)], hi = v[Math.floor(v.length * 0.95)];
    return Array.from(a, x => Math.min(1, Math.max(0, (x - lo) / ((hi - lo) || 1))));
  };
  const nF = norm(eFull), nL = norm(eLow), nX = norm(eFlux);
  const E = nF.map((v, i) => 0.45 * v + 0.4 * nL[i] + 0.15 * nX[i]);
  // energía media por frase de 8 compases
  const np = Math.floor(nb / phraseBars);
  const P = [];
  for (let k = 0; k < np; k++) {
    let s = 0;
    for (let b = k * phraseBars; b < (k + 1) * phraseBars; b++) s += E[b];
    P.push(s / phraseBars);
  }
  const pmin = Math.min(...P), pmax = Math.max(...P), span = (pmax - pmin) || 1;
  const cls = P.map(p => (p - pmin) / span >= 0.62 ? 'H' : (p - pmin) / span < 0.4 ? 'L' : 'M');
  const tOf = (k) => start0 + k * phraseBars * bar;
  const sections = [{ t: start0, type: 'intro', label: 'Intro' }];
  let state = cls[0] === 'H' ? 'H' : 'pre', drops = 0, breaks = 0, lastHigh = -1;
  for (let k = 0; k < np; k++) {
    if (cls[k] === 'H') {
      if (state !== 'H') { drops++; sections.push({ t: tOf(k), type: 'drop', label: 'Drop ' + drops }); }
      state = 'H'; lastHigh = k;
    } else if (cls[k] === 'L' && state === 'H') {
      // break solo si no es el final de la pista (si vuelve a subir después)
      if (cls.slice(k + 1).includes('H')) { breaks++; sections.push({ t: tOf(k), type: 'break', label: 'Break ' + breaks }); state = 'L'; }
    }
  }
  if (lastHigh >= 0 && lastHigh < np - 1) sections.push({ t: tOf(lastHigh + 1), type: 'outro', label: 'Outro' });
  const curve = P.map(p => Math.round(((p - pmin) / span) * 100) / 100);
  // sin el RMS de la pista completa, se estima con el de la señal analizada
  if (trackRmsDb == null) { let s2 = 0; for (let i = 0; i < d.length; i += 4) s2 += d[i] * d[i]; trackRmsDb = 10 * Math.log10(s2 / Math.max(1, d.length / 4) + 1e-12); }
  const energy = energyFrom(trackRmsDb, bpm, curve);
  return { energy, energyV: ENERGY_VERSION, sections, curve, phraseSec: phraseBars * bar };
}

export function analyze(mono, sr, opts = {}) {
  const wave = computeWaveform(mono, sr);
  const { d, sr: sr2 } = decimate(mono, sr, 11025);
  const of = onsetEnvelope(d, sr2);
  const ol = lowEnvelope(d, sr2);
  const tempo = detectTempo(of.env, ol.env, of.fps, opts.minBpm || 85, opts.maxBpm || 175, of.offset, ol.offset);
  let bpm = null, firstBeat = 0;
  if (tempo) {
    bpm = tempo.bpm;
    const beat = 60 / bpm;
    const t = tempo.phaseTime + (opts.latencyComp || 0);
    firstBeat = ((t % beat) + beat) % beat;
  }
  // BPM variable detectado: marcas de beatgrid (la primera coincide con un beat de la rejilla)
  let grid = null;
  if (tempo && tempo.drift && !opts.lockedBpm) {
    grid = tempo.drift.map(m => ({ t: m.t + (opts.latencyComp || 0), bpm: m.bpm }));
  }
  const key = detectKey(d, sr2);
  let struct = { energy: null, sections: [] };
  const sBpm = opts.lockedBpm || bpm, sFirst = opts.lockedBpm ? (opts.lockedFirstBeat || 0) : firstBeat;
  const trackRms = rmsDb(mono);
  try { struct = analyzeStructure(d, sr2, sBpm, sFirst, trackRms); } catch (e) { /* la estructura es opcional */ }
  return {
    bpm, firstBeat, grid,
    energy: struct.energy, sections: struct.sections, energyCurve: struct.curve || null,
    keyTonic: key ? key.tonic : null, keyMinor: key ? key.minor : null,
    rmsDb: trackRms, energyV: struct.energyV || null,
    wave: wave.data, waveRate: wave.rate
  };
}
