# Nexura DJ Studio

Software DJ de escritorio para Windows de **NexuraIA**. Mezcla tu música local y listas de **YouTube**, se controla con cualquier controladora **MIDI** (con perfil nativo para la **Denon DJ MC4000**) e incorpora herramientas de **IA que funcionan en tu ordenador**: stems, sugerencias, sets por texto y Automix.

Versión actual: **0.9.0-beta.5** (beta).

## Puesta en marcha

Requisitos: Windows 10/11 y [Node.js 20 LTS o superior](https://nodejs.org).

```powershell
git clone https://github.com/mcontrerasdevpro/nexura-dj-studio.git
cd nexura-dj-studio
npm install
npm start
```

- `npm run dev` abre la app con las herramientas de desarrollo.
- `npm run dist` crea el instalador en `dist\`.
- `npm run beta` crea el instalador y un `.zip` con instrucciones para compartir con testers. Antes de cada beta, sube la versión en `package.json`.
- `npm run web` sirve la interfaz en http://localhost:5180 para probarla en un navegador, sin Electron.

El instalador no está firmado, así que Windows SmartScreen muestra un aviso: pulsa «Más información → Ejecutar de todas formas».

### Configuración privada

La URL del webhook que recibe las sugerencias de la beta no está en el repositorio. Copia `config.local.example.json` como `config.local.json` en la raíz y pon tu URL. El archivo está en `.gitignore`, entra en el instalador al ejecutar `npm run dist` o `npm run beta`, y si no existe las sugerencias se envían por el servicio de respaldo.

### Herramientas opcionales

| Para | Necesitas |
|---|---|
| Stems (separar voz, batería, bajo y melodía) | [uv](https://docs.astral.sh/uv/), ffmpeg en el PATH y, mejor, una GPU NVIDIA. El motor (Python 3.11, PyTorch y Demucs, unos 3 GB) se instala desde **Ajustes → ✨ IA** |
| Pedir sets por texto con IA | [Ollama](https://ollama.com) en el mismo equipo (`http://127.0.0.1:11434`) con un modelo de chat. Sin Ollama funciona un intérprete de reglas |

## Funciones

| Área | Incluye |
|---|---|
| Decks | 2 decks, o 4 con una controladora de 4 decks; play/cue, sync de tempo y fase, key lock de alta calidad, transposición, key sync, slip, censor, vinyl/jog, freno y arranque de motor, pitch bend, rangos ±8/16/50 % |
| Pads | Hot Cue (8, con colores y nombres), Cue Loops, Saved Loop, Roll, Slicer, Beat Jump, Sampler, Pitch Play y Stems |
| Loops | Auto loop 1/32–32, ½ / ×2, loop in/out, reloop, mover loop, cuantización |
| Beatgrid | Análisis automático de BPM y primer tiempo, **BPM variable** detectado solo (directos, temas sin claqueta), editor de marcas, BPM por tramo, tap tempo, ×2 / ½, desplazar grid, «1 aquí» |
| Mezclador | 2 o 4 canales; gain, EQ de 3 bandas con kill (clic derecho), filtro LPF/HPF, PFL, faders, crossfader con 4 curvas, master con limitador, cue mix, split, vúmetros |
| Efectos | 2 unidades × 3 ranuras sincronizadas al BPM: Echo, Ping Pong, Reverb, Epic Reverb, Flanger, Phaser, Chorus, HPF, LPF, Bitcrush, Distortion, Trans, Tremolo, Auto Pan, Ring Mod, Noise, Comb, Repeat, Braker; presets |
| Sampler | 4 bancos × 8 ranuras, Trigger / Hold / On-Off, bucle y volumen por ranura, cue |
| Biblioteca | Archivos y carpetas (arrastrar y soltar), etiquetas ID3/FLAC, búsqueda, orden por columnas, crates, smart crates, Prepare, historial con exportación CSV, tonalidades compatibles (Camelot), barra lateral y columnas con ancho ajustable |
| Importar | Colecciones de rekordbox (XML), Traktor (NML) y VirtualDJ (`database.xml`), listas `.m3u/.m3u8` y `.vdjfolder`, crates de Serato (`.crate`), y cues/loops/beatgrid guardados dentro de los MP3 y FLAC. Trae BPM, beatgrid, tonalidad, hot cues con color, loops, valoraciones y listas (como crates) |
| Análisis | BPM, beatgrid (fijo o variable), tonalidad, forma de onda de 3 bandas, auto-gain, estructura (intro, drops, breaks, outro) y energía 1-10 |
| Grabación | WAV 16 bits del master en `Música\Nexura DJ Studio\Grabaciones` |
| Salidas | Estéreo, 4 canales (master 1/2 + auriculares 3/4), dos dispositivos o **mesa de mezclas externa** (cada deck por su salida; con 4 decks y una tarjeta de 8 canales, cada uno por su par) |

### Herramientas de IA (en local)

- **Stems:** separa cada pista en voz, batería, bajo y melodía con Demucs en tu GPU. Se separa una vez y se guarda (unos 40 MB por pista en FLAC). Cada deck tiene botones VOZ · BAT · BAJO · MEL (Mayús+clic: solo esa parte) y un modo de pads con Acapella, Instrumental y Solo batería. Puede separar **en segundo plano** las pistas de Prepare y las cargadas en los decks.
- **Siguiente pista:** la vista «Siguiente pista (IA)» puntúa tu biblioteca según la pista que suena (tonalidad Camelot, BPM y energía), con modo subir, mantener o bajar energía.
- **Cues automáticos:** marca intro, drops, breaks y outro en las pistas analizadas sin hot cues.
- **Crear set:** desde una pista, con curva de energía (subir, ola, mantener, bajar).
- **Pedir set por texto:** «media hora a 124-128 BPM subiendo la energía» → crea el set como crate y puede mandarlo a Prepare.
- **Automix:** la app pincha sola con las pistas de Prepare o las sugeridas. Entra en la intro, mezcla en el outro con sync e intercambio de graves, y pone key lock para no cambiar las tonalidades.

Ningún dato ni pista sale del ordenador.

## Controladoras

Nexura escanea los puertos MIDI al iniciar y cuando conectas o desconectas algo. Abre **Ajustes → MIDI / Controladores**:

- **Añadir controladora:** asistente que te pide mover cada control y detecta solo el tipo de mensaje, la codificación de platos y encoders y los pasos por vuelta del jog. Para controladoras de 4 decks añade los pasos de los decks 3 y 4.
- **MIDI Learn:** asigna cualquier acción a un control. Tus asignaciones tienen prioridad sobre los perfiles automáticos.
- **Importar mapeos de Mixxx** (`.midi.xml`) y exportar/importar perfiles propios en JSON.
- **Monitor MIDI** para ver lo que envía la controladora.

Las controladoras que solo funcionan por HID no son compatibles (Nexura usa MIDI).

### 4 decks

Los decks 3 y 4 aparecen solos cuando conectas una controladora de 4 decks reconocida (por ejemplo, Pioneer DDJ-SX/SZ/1000/FLX6/FLX10, Numark NS6/NS7 o Mixtrack Platinum, Denon MC6000/MC7000/MCX8000/Prime 4, Reloop Mixon 4/8 o Roland DJ-808) o una cuyo perfil use los decks 3 y 4. Con una controladora de 2 decks no aparecen. Se puede forzar en **Ajustes → Reproducción → Decks en pantalla**.

Los decks 1 y 3 comparten el lado izquierdo y los 2 y 4 el derecho, con pestañas para cambiar. Al tocar un control del deck 3 en la controladora, se muestra solo. El mezclador pasa a 4 canales (3 · 1 · centro · 2 · 4).

### Denon DJ MC4000

1. Conecta la MC4000 por USB. Si Windows no la muestra como dispositivo de audio, instala el driver de Denon DJ.
2. En **Ajustes → Audio**, elige la MC4000 como dispositivo master y el modo **Automático**.
   - Con 4 canales: master por 1/2 y auriculares (cue) por 3/4.
   - Si Windows la muestra como dos salidas estéreo: modo «Master y cue en dispositivos separados».
3. La app la reconoce sola (indicador arriba a la derecha).

Controles: play, cue, sync, stutter, inicio de pista, jog con scratch o nudge, pitch de 14 bits, rango, key lock, pitch bend, censor, PFL, gain, EQ, filtro, faders, crossfader, cue mix, split, pads (hot cues 1-4 / 5-8, roll, slicer y, pulsando de nuevo el pad 4 con PAD MODE, stems), loops, cuantización, 2 unidades FX, sampler 1-4, encoder de biblioteca, load, prepare. LEDs y vúmetros.

## YouTube

- **+ Lista:** pega la URL de una lista pública o no listada; sin configurar nada se importan hasta 200 vídeos.
- **Clave de API** (Ajustes → YouTube): listas completas, duraciones y búsqueda.
- **Mis listas:** conecta tu cuenta de Google para ver tus listas, incluidas las privadas.

Los vídeos se reproducen en el reproductor oficial de YouTube dentro del deck: play/pausa, cue, hot cues, tempo, fader, crossfader y master. Las condiciones de YouTube no permiten extraer el audio, así que en esas pistas no hay EQ, filtro, FX, scratch, loops, stems ni cue de auriculares, y suenan por la salida predeterminada de Windows.

## Atajos de teclado

- Deck 1: `Z` cue · `X` play · `C` sync · `V` loop · `A`/`S` bend · `1`–`8` pads.
- Deck 2: `N` cue · `M` play · `,` sync · `.` loop · `K`/`L` bend · `Q`–`I` pads.
- Biblioteca: `↑`/`↓`, `Mayús+←/→` cargar en el deck visible de cada lado, `Ctrl+F` buscar.
- `F6` Split Cue · `F7` Automix · `F8` modo laptop · `F9` grabar · `F11` pantalla completa · `F12` herramientas de desarrollo.

**Aviso Split Cue:** en una salida estéreo compartida, el audio pasa a cue mono por la izquierda y master mono por la derecha. No conectes esa señal a un equipo de sonido esperando una mezcla normal. Desactiva SPLIT para volver a la salida estéreo.

## Formatos

MP3, WAV, FLAC, OGG, OPUS, M4A/AAC.

## Pendiente

- Vídeo en los decks.
- DVS (vinilos de control); necesita calibración con hardware real.
- Leer cues guardados dentro de archivos M4A.
- Firma de código del instalador.

## Estructura del código

- `main.js` y `preload.js`: proceso principal de Electron (archivos, etiquetas, almacenamiento, YouTube, motor de stems).
- `src/js/audio/`: motor de audio, decks (AudioWorklet), beatgrid, stems, efectos y sampler.
- `src/js/analysis/`: análisis de BPM, beatgrid variable, tonalidad, estructura y energía.
- `src/js/library/`: biblioteca e importadores.
- `src/js/midi/`: MIDI universal, asistente, perfiles e importación de Mixxx; perfil nativo de la MC4000.
- `src/js/ai/`: asistente, Automix y sets por texto.
- `src/js/ui/`: interfaz.
- `tools/stems/`: motor de separación (Python, Demucs).

---
© NexuraIA · contacto@nexuraia.com
