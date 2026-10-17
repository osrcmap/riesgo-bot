// Arranque: bot de Telegram (long polling) + vigilancia periódica de suscripciones.
import { crearBot } from "./bot.js";
import { consultarConRiesgoPunto } from "./consulta.js";
import { Suscripciones } from "./suscripciones.js";
import { ronda } from "./vigilancia.js";

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error("Falta BOT_TOKEN (créalo con @BotFather en Telegram). Ver README.");
  process.exit(1);
}
const minutos = Number(process.env.RIESGO_BOT_INTERVALO_MIN) || 30;
const db = new Suscripciones(process.env.RIESGO_BOT_DB || "datos/bot.sqlite");
const { bot, enviar } = crearBot({
  token,
  db,
  consultar: consultarConRiesgoPunto(),
  maxSuscripciones: Number(process.env.RIESGO_BOT_MAX_UBICACIONES) || 3,
});

let enCurso = false;
async function vigilar() {
  if (enCurso) return; // una ronda a la vez
  enCurso = true;
  try {
    const r = await ronda(db, consultarConRiesgoPunto(), enviar, { avisoFallaMs: 2 * 3600_000 });
    console.log(`${new Date().toISOString()} ronda: ${JSON.stringify(r)}`);
  } catch (e) {
    console.error(`ronda fallida: ${(e as Error).message}`);
  } finally {
    enCurso = false;
  }
}
const reloj = setInterval(vigilar, minutos * 60_000);
setTimeout(vigilar, 60_000); // primera ronda al minuto de arrancar

const parar = async () => {
  clearInterval(reloj);
  await bot.stop();
  db.cerrar();
  process.exit(0);
};
process.once("SIGINT", parar);
process.once("SIGTERM", parar);

try {
  await bot.api.setMyCommands([
    { command: "start", description: "Cómo usar el bot" },
    { command: "mis_ubicaciones", description: "Ubicaciones que reviso" },
    { command: "olvidar", description: "Borrar mis datos" },
    { command: "privacidad", description: "Qué datos guardo" },
  ]);
  console.log(`riesgo-bot iniciado: revisión cada ${minutos} min`);
  await bot.start({
    drop_pending_updates: true,
    onStart: (i) => console.log(`conectado como @${i.username}`),
  });
} catch (e) {
  const err = e as { error_code?: number; message: string };
  console.error(
    err.error_code === 401 || err.error_code === 404
      ? "Telegram rechazó el token: revisa BOT_TOKEN (cópialo de nuevo desde @BotFather)."
      : `No se pudo conectar con Telegram: ${err.message}`,
  );
  clearInterval(reloj);
  db.cerrar();
  process.exit(1);
}
