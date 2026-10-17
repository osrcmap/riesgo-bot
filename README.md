# riesgo-bot

Bot de Telegram para las pruebas del piloto de alertas de El Niño 2026-2027. Envías una ubicación y responde con los avisos del SENAMHI y las zonas críticas del INGEMMET para ese punto (vía [`riesgo-punto`](https://github.com/osrcmap/riesgo-punto)). Si te suscribes, revisa la ubicación cada 30 minutos y te escribe **solo cuando aparece o sube un aviso de lluvia o de huaicos, o cualquier aviso en nivel rojo**.

> **Información de referencia de fuentes oficiales, no una alerta propia ni una orden de evacuación.**

## Ponerlo en marcha (en tu computadora, en el Perú)

El SENAMHI no responde a servidores en el extranjero o en la nube: el bot tiene que correr en el Perú. Usa *long polling*, así que no necesita IP pública, dominio ni HTTPS.

1. En Telegram, habla con **@BotFather** → `/newbot` → elige nombre y usuario → copia el **token**.
2. Instala y configura:
   ```bash
   bun install
   echo 'BOT_TOKEN=123456:ABC...' > .env      # Bun lee .env solo; .env está en .gitignore
   bun start
   ```
3. Abre tu bot en Telegram y envía `/start`.

Para dejarlo encendido mientras pruebas, córrelo en una terminal aparte (o con `tmux`/`screen`). `Ctrl+C` lo detiene limpiamente.

| Variable | Por defecto | Qué hace |
|---|---|---|
| `BOT_TOKEN` | (obligatoria) | Token de @BotFather |
| `RIESGO_BOT_INTERVALO_MIN` | `30` | Minutos entre revisiones de las ubicaciones suscritas |
| `RIESGO_BOT_MAX_UBICACIONES` | `3` | Ubicaciones por chat |
| `RIESGO_BOT_DB` | `datos/bot.sqlite` | Base de datos de suscripciones |
| `RIESGO_PUNTO_CLI` | (el instalado) | Otro `riesgo-punto` (desarrollo) |

## Qué hace

- **Consulta:** ubicación compartida, punto del mapa o coordenadas escritas (`-12.0464, -77.0428`). Responde con el `mensaje` de riesgo-punto tal cual: texto plano, igual que serviría para WhatsApp o SMS.
- **Suscripción** (botón "Avisarme si cambia"): guarda la ubicación con el estado actual como línea base. Cada 30 minutos avisa si aparece o sube de nivel un **aviso de lluvia** o de **activación de quebradas**, si hay un **cruce nuevo** (aviso de lluvia o de quebradas + zona crítica cercana) o si **cualquier aviso llega a nivel rojo**. Los avisos de viento, calor o frío en amarillo o naranja salen en la consulta, pero no generan notificación: en el Perú los huaicos y las inundaciones son el peligro principal, y notificar todo cansa y hace que la gente deje de leer. Si un aviso baja de nivel o termina, no escribe.
- **Si el SENAMHI no responde por 2 horas**, avisa una vez a cada suscriptor que no puede vigilar (el silencio no debe parecer "todo bien") y otra vez cuando se restablece.
- Comandos: `/start`, `/mis_ubicaciones` (con botones para quitar), `/olvidar`, `/privacidad`.
- En grupos solo responde a ubicaciones y comandos, no a cada mensaje.

## Privacidad

Solo se guarda algo si la persona toca "Avisarme si cambia": el id del chat y la ubicación redondeada a 4 decimales (~11 m). Las consultas sin suscripción no se guardan. `/olvidar` borra todo. Si alguien bloquea al bot, sus suscripciones se borran solas.

## Migrar a WhatsApp

Toda la lógica de riesgo está en `riesgo-punto`; este bot solo es el canal. Para WhatsApp habría que cambiar `src/bot.ts` (recibir ubicación, responder texto, botón de suscripción) y la función `enviar`. `src/vigilancia.ts`, `src/suscripciones.ts`, `src/consulta.ts` y `src/textos.ts` no dependen de Telegram.

## Desarrollo

```bash
bun test          # Telegram simulado (sin red), vigilancia con reloj controlado, riesgo-punto real con avisos simulados
bun run typecheck && bun run lint
```

## Limitaciones

- Una sola instancia: la base es SQLite local y las revisiones son secuenciales. Para cientos de suscriptores hay que medir (cada revisión ejecuta riesgo-punto; avisos-pe cachea al SENAMHI 10 minutos).
- Las novedades dependen de lo que publican SENAMHI e INGEMMET y de cómo lo interpreta riesgo-punto (ver sus LIMITATIONS).
- Si tu computadora se apaga, no hay vigilancia. Para el piloto real conviene un servidor en el Perú.
