# Flujos de n8n de Nexura DJ Studio

Copia exportada de los tres flujos que usa la app (creados en n8n el 10 nov 2026, carpeta **Nexura DJ Studio**, desactivados y con el prefijo `[DEV]`).

| Archivo | Flujo | Webhook (POST) | Campo de `src/config/servicios.json` |
|---|---|---|---|
| `buscar-youtube.json` | [DEV] Nexura DJ · Buscar en YouTube | `/webhook/nexura-dj-buscar` | `searchUrl` |
| `informes.json` | [DEV] Nexura DJ · Informes y sugerencias | `/webhook/nexura-dj-informes` | `feedbackUrl` |
| `estadisticas.json` | [DEV] Nexura DJ · Estadísticas | `/webhook/nexura-dj-estadisticas` | `statsUrl` |

## Importarlos en otra instancia
n8n → **Workflows → Add workflow → ⋯ → Import from File…** y elegir el `.json`. Después:
- **Buscar en YouTube:** abrir los nodos «YouTube · buscar» y «YouTube · duraciones» y elegir la credencial de la clave de YouTube (ver abajo).
- **Informes** y **Estadísticas:** elegir la credencial SMTP en los nodos de correo (en la instancia actual ya apuntan a «SMTP Hostinger · contacto»).

## Credencial de YouTube (la crea Miguel; nunca la clave dentro de un nodo)
1. Google Cloud Console → proyecto de NexuraIA → habilitar **YouTube Data API v3** → **Credenciales → Clave de API**, restringida solo a esa API.
2. n8n → **Credentials → Add credential → Query Auth**: *Name* = `key`, *Value* = la clave. Nombre sugerido: «YouTube Data API · Nexura DJ».
3. Seleccionarla en los dos nodos HTTP del flujo de búsqueda.

Cuota: cada búsqueda gasta ~101 unidades (search 100 + videos 1) de las 10 000 diarias → unas 99 búsquedas reales al día para todos los usuarios; la caché de 7 días y el límite de 30 por instalación ayudan, pero si hay muchos usuarios habrá que pedir más cuota a Google (formulario de ampliación de cuota de YouTube) o repartir con varias claves.

## Dónde se guardan los datos
En los **datos estáticos** de cada flujo (las Data Tables no estaban disponibles por la API). Solo se guardan en ejecuciones de producción, con el flujo **activo** (no en «Test workflow»):
- Búsqueda: contador del día por id de instalación (se borra al día siguiente) y caché por texto (7 días, máx. 3000 búsquedas).
- Estadísticas: un registro por instalación y día durante 90 días y el resumen diario 2 años; resumen por correo cada día a las 8:00 (hora de Madrid).
Las ejecuciones correctas no se guardan (`saveDataSuccessExecution: none`): los textos buscados y los informes no quedan en el historial de n8n.

## Contrato con la app
- Buscar: entra `{ id, q, max }` → `200 { items: [{ videoId, title, channel, thumb, duration }] }`; `429 { error: "limit" }` al pasar de 30 al día; `400` petición no válida; `503` fallo de YouTube (la app lo muestra como «no responde»).
- Informes: los campos de `main/report.js → buildPayload`; `200 { ok: true }` o `502` (la app guarda el .txt y abre el correo).
- Estadísticas: `{ id, version, lang, os, decks, controller }` (`main/stats.js`) → `200`.
