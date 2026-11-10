# Nexura DJ Studio — estado y pendientes

Última actualización: 10 de noviembre de 2026 · rama `rc1-imprescindible` (desde la beta.8, sin commit) · versión **1.0.0-rc.1** en `package.json`. Resumen en `.revision/RESUMEN-rc1.md`.

## 1.0-rc1 — lo imprescindible para distribuirla gratis (10 nov 2026, sin commit)
- **Actualizaciones automáticas** (electron-updater + GitHub Releases de `mcontrerasdevpro/nexura-dj-studio`): aviso en la barra de estado, descarga con progreso, «Reiniciar para actualizar» (con música sonando se instala al cerrar); Ajustes → General; canal de versiones de prueba opcional; sin red o sin releases, silencio. `npm run release` publica un borrador (necesita `GH_TOKEN`).
- **Copias de seguridad de la biblioteca**: al arrancar (una al día) y antes de cada actualización, 14 últimas en `<datos>\copias`; Ajustes → Biblioteca (lista, hacer, restaurar, abrir carpeta); si al arrancar la biblioteca está dañada ofrece restaurar la última copia buena.
- **Informe de errores y sugerencias**: registro local rotativo (`<datos>\logs`, 5 × 1 MB), diálogo con tipo, email opcional y «Adjuntar registro técnico» con vista previa anonimizada; POST a `feedbackUrl` o, si no, correo + .txt.
- **Contador anónimo de uso** opcional y explicado (`statsUrl`, vacío = desactivado).
- **Bienvenida** de 4 pasos, **textos legales** (EULA en el instalador, privacidad, licencias de terceros), **menú de ayuda «?»** y **Acerca de** nuevo.
- **Microsoft Store** preparada (`npm run store`, iconos en `build/appx`), sin identidad todavía.
- **Botón Ordenar crates** (⇅ junto a «+ Nuevo» en la cabecera CRATES): abre el menú de orden que antes solo estaba en el clic derecho y en Ajustes, con textos más claros («Como se crearon», «Por nombre (A → Z)», «Personalizado (arrastrar)») y ✓ en el actual; el tooltip dice el orden activo. La lógica de orden y el arrastre no cambian. Prueba: `npx electron tools/ui-check-orden-crates.cjs` (`.revision/orden-crates/`).

### Lo que tiene que hacer Miguel antes de distribuir la rc1
- Completar en `src/legal/LICENCIA.txt` y `PRIVACIDAD.txt` el **[COMPLETAR: nombre o razón social, NIF y domicilio]** y que lo revise alguien de confianza en lo legal.
- Rellenar `feedbackUrl` en `src/config/servicios.json` con el webhook (si no, se usa el de `config.local.json` como en la beta) y, cuando exista, `statsUrl`.
- `GH_TOKEN` para `npm run release`; publicar la privacidad en nexuraia.com (la pide la Store).
- Partner Center (Microsoft Store): alta, reservar el nombre y copiar la identidad a `build/store-identidad.json`.

### Por probar a mano (rc1)
- Una actualización real de extremo a extremo: publicar 1.0.0-rc.1 como prerelease, instalarla, publicar una rc.2 de prueba y comprobar aviso → descarga → reinicio (y que con un deck sonando espera al cierre).
- El instalador: que muestre la licencia con las tildes bien y que la actualización silenciosa no enseñe el mensaje de agradecimiento.
- Restaurar una copia con la biblioteca real (miles de pistas) y el aviso de biblioteca dañada (por ejemplo, dejando `library.json` vacío).
- El correo de respaldo del informe con el programa de correo que tengas (Outlook / Correo de Windows / ninguno).

## Hecho en esta sesión (frente a Serato DJ Pro 5)
- **Fase 1 — biblioteca:** importar M3U/M3U8, proteger biblioteca (candado), reiniciar pistas tocadas, columnas configurables (valoración, Explicit, carátula, año, energía, comentario), colores y orden de crates, buscar en crate, «mostrar en qué crates está», archivos perdidos y relocalizar, modo de pads Cue Loop, retorno del slip, altura mínima de la biblioteca (8 filas en 1496×885).
- **Fase 2 — análisis y efectos:** beatgrid con cambios de tempo (detección y edición), Stems FX y Stem Slip, 17 efectos nuevos (36 en total) con presets de fábrica.
- **Spotify:** importar listas solo con metadatos (sin cuenta: listas públicas ≤ ~100 pistas; con cuenta Premium: API oficial). Empareja con la música local, reproductor oficial de YouTube para las que faltan y enlaces de compra. **Nunca se descarga audio.**
- **Subcrates:** árbol con plegado, arrastrar/mover sin ciclos, pistas de los subcrates en el padre, color heredado.
- **Carpetas → subcrates:** soltar una carpeta sobre un crate crea la jerarquía (Dance › 2020 › …); «+ Carpeta» con estructura.
- **Teclado:** Supr quita del crate/Prepare (o de la biblioteca con confirmación); Ctrl+Supr elimina de la biblioteca al instante con Deshacer / Ctrl+Z (ver abajo).
- **Autoplay** sobre un crate: en orden de la lista o aleatorio; transición seguida, fundido o sync; repetir y saltar tocadas; excluyente con Automix.
- **Selección en ámbar** (variante «C · Ámbar» elegida en Claude Design).
- **Autoplay con una pista sonando** (10 nov 2026, sin commit): activarlo ya no corta lo que suena; esa pista sigue en su deck (también el 3/4) y la lista continúa después de ella, con la transición elegida al final. Resumen en `.revision/RESUMEN-autoplay-supr.md`.
- **Ctrl+Supr rápido** (10 nov 2026, sin commit): elimina de la biblioteca al instante, sin diálogo, con «Deshacer» y Ctrl+Z (vuelven cues, beatgrid, crates, Prepare…); funciona con la pista seleccionada aunque el foco esté en la barra lateral; tras eliminar queda seleccionada la siguiente.
- **Borrar listas de YouTube** (10 nov 2026, sin commit): menú de «YouTube · todos los vídeos» → quitar todos los vídeos de la biblioteca (con confirmación y Deshacer; sin vídeos, la entrada desaparece y se abre «Todas las pistas»); en las listas importadas, «Eliminar lista y sus vídeos de la biblioteca» (solo los que no están en otra lista ni en un crate); Supr/Ctrl+Supr en la fila de la lista la elimina con confirmación.
- **Barra lateral rediseñada** (Claude Design: A «Árbol claro» + C «Barra de iconos»), sin commit todavía: árbol único con BIBLIOTECA / CRATES / SMART CRATES / LISTAS ONLINE, buscador de crates y listas, iconos de color por tipo, un botón por sección, pie «+ Añadir música» / «Importar…», barra de iconos automática en modo laptop y ≤ 1100 px (Ajustes → Biblioteca: Automática / Siempre / Nunca), cabecera de la tabla con icono y ruta. Resumen en `.revision/RESUMEN-barra-lateral.md`.

## Por probar a mano (no se puede simular)
- Arrastrar una carpeta real desde el Explorador de Windows sobre un crate.
- Autoplay con una lista de YouTube (también activarlo con un vídeo ya sonando: debe seguir y fundir al final).
- Autoplay activado a mitad de una pista real con la controladora (oír que no hay corte ni cambio de tono).
- Ctrl+Supr con la biblioteca real (miles de pistas): que sea instantáneo y que Ctrl+Z devuelva todo.
- Quitar los 148 vídeos de YouTube de la biblioteca real y deshacer (y que no vuelvan a aparecer al reiniciar la app).
- Sonido real por la tarjeta/controladora; controladora MIDI física con el asistente.
- Spotify con cuenta (requiere Premium; de momento no se usa).
- Barra lateral nueva con la biblioteca real (cientos de crates): soltura del buscador, arrastrar pistas y crates con el ratón de verdad y lectura con un lector de pantalla.

## Pendiente
- **Para la 1.0 final:** firma de código del instalador (SmartScreen), traducción al inglés si se distribuye fuera de España, página de descarga en nexuraia.com con la política de privacidad, y decidir qué hacer con «💬 SUGERENCIAS» (ahora duplica «? → Enviar informe o sugerencia»).
- **Fase 3 — interfaz y actuación:** formas de onda en vertical; paneles Prepare/Historial en vertical; sampler con vista ampliada; Scratch Bank; micrófono con talkover; Ableton Link; Flip completo (ahora beta).
- **Fase 4 — audio avanzado y expansiones:** keylock de alta calidad (nivel Pitch 'n Time); DVS (vinilos/CDJ de control); vídeo.
- **Opcional:** «quitar de la lista» en listas de YouTube importadas; decidir si los FX se muestran siempre en pantallas de poca altura (ahora quedan tras ☰ con alto ≤ 900 px); más luminosidad en tonalidades azules/violetas de `keyColor`.
- **No viable:** streaming de Spotify/Tidal/Beatport/Apple Music/SoundCloud (requiere acuerdos comerciales); CDJ en modo HID.

## Cómo se trabaja
- Los cambios los hace Claude Code en el PC con un encargo en `.revision/encargo-*.md` (sin commit ni beta); después se prueban con Playwright/Electron (prueba general de DJ de 51 comprobaciones + pruebas de cada novedad) y, si todo pasa, commit, push y `npm run beta`.
