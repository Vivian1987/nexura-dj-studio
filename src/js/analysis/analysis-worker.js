// Worker de análisis (módulo)
import { analyze } from './analysis-core.js';

self.onmessage = (e) => {
  const { id, mono, sr, opts } = e.data;
  try {
    const r = analyze(mono, sr, opts || {});
    self.postMessage({ id, ok: true, result: r }, [r.wave.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message || err) });
  }
};
