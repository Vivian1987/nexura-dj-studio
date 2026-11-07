"""Separador de stems de Nexura DJ Studio (Demucs htdemucs, licencia MIT).

Uso: python separate.py --out <carpeta> [--model htdemucs] < trabajos.json
trabajos.json = [{"id": "...", "path": "C:/musica/tema.mp3"}, ...]
Escribe <carpeta>/<id>/{drums,bass,other,vocals}.flac (16 bits, 44,1 kHz)
y emite una línea JSON por evento en stdout (start, done, error, end).
"""
import json
import os
import sys
import time


def emit(**k):
    print(json.dumps(k, ensure_ascii=False), flush=True)


def main():
    args = sys.argv[1:]
    out = args[args.index('--out') + 1]
    model_name = args[args.index('--model') + 1] if '--model' in args else 'htdemucs'
    jobs = json.loads(sys.stdin.read() or '[]')

    import numpy as np
    import soundfile as sf
    import torch
    from demucs.apply import apply_model
    from demucs.audio import AudioFile
    from demucs.pretrained import get_model

    dev = 'cuda' if torch.cuda.is_available() else 'cpu'
    emit(ev='start', device=dev, gpu=torch.cuda.get_device_name(0) if dev == 'cuda' else '', n=len(jobs), model=model_name)
    t0 = time.time()
    model = get_model(model_name)
    model.to(dev)
    model.eval()
    emit(ev='model', secs=round(time.time() - t0, 1), sources=list(model.sources))

    for i, j in enumerate(jobs):
        try:
            t1 = time.time()
            wav = AudioFile(j['path']).read(streams=0, samplerate=model.samplerate, channels=model.audio_channels)
            ref = wav.mean(0)
            mean, std = ref.mean(), ref.std() + 1e-8
            with torch.no_grad():
                sources = apply_model(model, ((wav - mean) / std)[None].to(dev), device=dev,
                                      shifts=1, split=True, overlap=0.25, progress=False)[0]
            sources = sources * std + mean
            d = os.path.join(out, j['id'])
            os.makedirs(d, exist_ok=True)
            for name, src in zip(model.sources, sources):
                data = np.clip(src.cpu().numpy().T, -1.0, 1.0)
                tmp = os.path.join(d, name + '.tmp.flac')
                sf.write(tmp, data, model.samplerate, subtype='PCM_16', format='FLAC')
                os.replace(tmp, os.path.join(d, name + '.flac'))
            with open(os.path.join(d, 'stems.json'), 'w', encoding='utf-8') as f:
                json.dump({'model': model_name, 'sources': list(model.sources), 'sr': model.samplerate,
                           'seconds': round(wav.shape[-1] / model.samplerate, 2)}, f)
            emit(ev='done', id=j['id'], i=i, secs=round(time.time() - t1, 1))
        except Exception as e:  # noqa: BLE001
            emit(ev='error', id=j['id'], i=i, error=str(e)[:300])
        finally:
            if dev == 'cuda':
                torch.cuda.empty_cache()
    emit(ev='end', secs=round(time.time() - t0, 1))


if __name__ == '__main__':
    main()
