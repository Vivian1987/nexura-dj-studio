// Señales sintéticas para probar el análisis de tempo (bombo en cada beat, charles a contratiempo y un acorde)
export const SR = 44100;

export function synth(beats, dur, sr = SR) {
  const x = new Float32Array(Math.floor(dur * sr));
  let seed = 1;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
  beats.forEach((t, k) => {
    const i0 = Math.round(t * sr);
    for (let i = 0; i < sr * 0.25 && i0 + i < x.length; i++) {
      const tt = i / sr;
      x[i0 + i] += 0.7 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 12);
    }
    const nb = beats[k + 1] ?? t + 0.5, h = Math.round((t + nb) / 2 * sr);
    for (let i = 0; i < sr * 0.04 && h + i < x.length; i++) x[h + i] += 0.15 * rnd() * Math.exp(-i / sr * 80);
  });
  for (let i = 0; i < x.length; i++) x[i] += 0.05 * Math.sin(2 * Math.PI * 220 * i / sr) + 0.04 * Math.sin(2 * Math.PI * 277 * i / sr);
  return x;
}

// tiempos de beat para una función de tempo bpm(t)
export function beatsFromTempo(bpmFn, dur, t0 = 0.3) {
  const b = [];
  let t = t0;
  while (t < dur - 0.3) { b.push(t); t += 60 / bpmFn(t); }
  return b;
}
