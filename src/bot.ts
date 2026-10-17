// Bot de Telegram (grammY). Toda la lógica de riesgo vive en riesgo-punto; aquí solo hay canal.
import { autoRetry } from "@grammyjs/auto-retry";
import { Bot, type Context, GrammyError, InlineKeyboard, Keyboard } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { type Consultar, enPeru, leerCoordenadas } from "./consulta.js";
import { redondear, type Suscripciones } from "./suscripciones.js";
import * as T from "./textos.js";
import { type Enviar, huella } from "./vigilancia.js";

export type OpcionesBot = {
  token: string;
  db: Suscripciones;
  consultar: Consultar;
  maxSuscripciones: number;
  /** Consultas simultáneas a riesgo-punto. */
  concurrencia?: number;
  /** Solo para pruebas: evita la llamada getMe a Telegram. */
  botInfo?: UserFromGetMe;
};

/** Límite simple de tareas simultáneas. */
function limitador(n: number) {
  let activas = 0;
  const cola: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (activas >= n) await new Promise<void>((ok) => cola.push(ok));
    activas++;
    try {
      return await fn();
    } finally {
      activas--;
      cola.shift()?.();
    }
  };
}

const TECLADO = new Keyboard().requestLocation(T.BOTON_UBICACION).resized().persistent();
const MAX_TELEGRAM = 4000;
const recortar = (s: string) => (s.length > MAX_TELEGRAM ? `${s.slice(0, MAX_TELEGRAM - 1)}…` : s);

export function crearBot(o: OpcionesBot) {
  const bot = new Bot(o.token, o.botInfo ? { botInfo: o.botInfo } : undefined);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));
  const turno = limitador(o.concurrencia ?? 3);

  const ayuda = (ctx: Context) => ctx.reply(T.BIENVENIDA, { reply_markup: TECLADO });
  bot.command(["start", "ayuda", "help"], ayuda);
  bot.command("privacidad", (ctx) => ctx.reply(T.PRIVACIDAD));

  bot.command("mis_ubicaciones", async (ctx) => {
    const subs = o.db.listar(ctx.chat.id);
    if (!subs.length) return ctx.reply(T.SIN_UBICACIONES);
    const teclado = new InlineKeyboard();
    for (const s of subs) teclado.text(`Quitar ${s.lat}, ${s.lon}`, `q:${s.id}`).row();
    await ctx.reply(
      `Ubicaciones que reviso cada 30 minutos:\n${subs.map((s) => `• ${s.lat}, ${s.lon} (desde ${s.creada.slice(0, 10)})`).join("\n")}`,
      { reply_markup: teclado },
    );
  });

  bot.command("olvidar", (ctx) => ctx.reply(T.OLVIDADO(o.db.olvidar(ctx.chat.id))));

  /** Consulta en segundo plano: no bloquea al bot mientras riesgo-punto responde. */
  const responder = (ctx: Context, lat: number, lon: number) => {
    if (!enPeru(lat, lon)) return void ctx.reply(T.FUERA_DEL_PERU);
    const [la, lo] = [redondear(lat), redondear(lon)];
    void (async () => {
      await ctx.reply(T.CONSULTANDO).catch(() => {});
      try {
        const r = await turno(() => o.consultar(la, lo));
        await ctx.reply(recortar(r.mensaje), {
          reply_markup: new InlineKeyboard().text(T.BOTON_SUSCRIBIR, `s:${la},${lo}`),
        });
      } catch (e) {
        console.error(`consulta fallida: ${(e as Error).message}`);
        await ctx.reply(T.ERROR_CONSULTA).catch(() => {});
      }
    })();
  };

  bot.on("message:location", (ctx) =>
    responder(ctx, ctx.message.location.latitude, ctx.message.location.longitude),
  );

  // Texto libre solo en privado: en un grupo, el bot no debe contestar cada mensaje.
  bot.chatType("private").on("message:text", (ctx) => {
    const c = leerCoordenadas(ctx.message.text);
    if (c) return responder(ctx, c[0], c[1]);
    return ctx.reply(T.NO_ENTENDI, { reply_markup: TECLADO });
  });

  bot.callbackQuery(/^s:(-?[\d.]+),(-?[\d.]+)$/, async (ctx) => {
    const [lat, lon] = [Number(ctx.match[1]), Number(ctx.match[2])];
    const chatId = ctx.chat?.id;
    await ctx.answerCallbackQuery();
    if (chatId === undefined || !enPeru(lat, lon)) return;
    void (async () => {
      // Línea base con el estado actual: solo se avisará lo que cambie desde ahora.
      let base: string | null = null;
      try {
        const r = await turno(() => o.consultar(lat, lon));
        if (r.fuentes.avisos.ok && r.avisos) base = JSON.stringify(huella(r));
      } catch {
        // Sin línea base: la primera revisión enviará el estado completo.
      }
      const res = o.db.agregar(chatId, lat, lon, base, o.maxSuscripciones);
      const texto = res.ok
        ? T.suscrito(res.total, o.maxSuscripciones)
        : res.motivo === "limite"
          ? T.LIMITE(o.maxSuscripciones)
          : T.DUPLICADA;
      await ctx.reply(texto).catch(() => {});
    })();
  });

  bot.callbackQuery(/^q:(\d+)$/, async (ctx) => {
    const quitada = ctx.chat ? o.db.quitar(ctx.chat.id, Number(ctx.match[1])) : false;
    await ctx.answerCallbackQuery({ text: quitada ? "Ubicación quitada" : "Ya no estaba guardada" });
  });

  bot.catch((err) => console.error(`error en update ${err.ctx.update.update_id}: ${err.message}`));

  /** Envío para la vigilancia; marca `bloqueado` si el usuario bloqueó al bot o borró el chat. */
  const enviar: Enviar = async (chatId, texto) => {
    try {
      await bot.api.sendMessage(chatId, recortar(texto));
    } catch (e) {
      if (e instanceof GrammyError && (e.error_code === 403 || /chat not found/i.test(e.description))) {
        throw Object.assign(new Error(e.description), { bloqueado: true });
      }
      throw e;
    }
  };

  return { bot, enviar };
}
