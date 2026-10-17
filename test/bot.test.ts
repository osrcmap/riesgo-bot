// El bot completo contra un Telegram simulado: se capturan las llamadas a la API, sin red.
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Update } from "grammy/types";
import { crearBot } from "../src/bot.js";
import { type Consultar, consultarConRiesgoPunto, leerCoordenadas, Respuesta } from "../src/consulta.js";
import { Suscripciones } from "../src/suscripciones.js";

const montero = Respuesta.parse(
  JSON.parse(await Bun.file(join(import.meta.dir, "fixtures/montero.json")).text()),
);

function simular(consultar: Consultar = async () => montero) {
  const db = new Suscripciones(":memory:");
  const { bot } = crearBot({
    token: "123:ABC",
    db,
    consultar,
    maxSuscripciones: 3,
    botInfo: {
      id: 1,
      is_bot: true,
      first_name: "riesgo",
      username: "riesgo_bot",
      can_join_groups: true,
      can_read_all_group_messages: false,
      supports_inline_queries: false,
      can_connect_to_business: false,
      has_main_web_app: false,
    } as never,
  });
  const llamadas: { metodo: string; payload: any }[] = [];
  bot.api.config.use(async (_prev, metodo, payload) => {
    llamadas.push({ metodo, payload });
    return { ok: true, result: metodo === "sendMessage" ? { message_id: llamadas.length } : true } as never;
  });
  let id = 0;
  const chat = { id: 42, type: "private" as const, first_name: "Ana" };
  const from = { id: 42, is_bot: false, first_name: "Ana" };
  const mensaje = (extra: object): Update =>
    ({ update_id: ++id, message: { message_id: id, date: 0, chat, from, ...extra } }) as Update;
  const enviar = (u: Update) => bot.handleUpdate(u);
  const textos = () =>
    llamadas.filter((l) => l.metodo === "sendMessage").map((l) => l.payload.text as string);
  /** Espera a que el bot (que responde en segundo plano) envíe al menos n mensajes. */
  const esperar = async (n: number) => {
    for (let i = 0; i < 200 && textos().length < n; i++) await Bun.sleep(10);
  };
  return { db, llamadas, textos, esperar, enviar, mensaje, chat, from };
}

describe("bot", () => {
  test("/start muestra la ayuda con el botón de ubicación", async () => {
    const s = simular();
    await s.enviar(s.mensaje({ text: "/start", entities: [{ type: "bot_command", offset: 0, length: 6 }] }));
    const p = s.llamadas[0].payload;
    expect(p.text).toContain("No es una orden de evacuación");
    expect(p.reply_markup.keyboard[0][0]).toMatchObject({ request_location: true });
  });

  test("ubicación → 'consultando' y luego el mensaje de riesgo-punto con botón de suscripción", async () => {
    const s = simular();
    await s.enviar(s.mensaje({ location: { latitude: -4.654012, longitude: -79.853911 } }));
    await s.esperar(2);
    expect(s.textos()[0]).toContain("Consultando");
    expect(s.textos()[1]).toBe(montero.mensaje);
    const boton = s.llamadas.at(-1)?.payload.reply_markup.inline_keyboard[0][0];
    expect(boton).toEqual({ text: "🔔 Avisarme si cambia", callback_data: "s:-4.654,-79.8539" });
  });

  test("coordenadas escritas también sirven; fuera del Perú se explica", async () => {
    const s = simular();
    await s.enviar(s.mensaje({ text: "-4.654, -79.8539" }));
    await s.esperar(2);
    expect(s.textos()[1]).toBe(montero.mensaje);
    await s.enviar(s.mensaje({ text: "-79.85, -4.65" }));
    await s.esperar(3);
    expect(s.textos()[2]).toContain("fuera del Perú");
  });

  test("si la consulta falla, dice que eso NO significa que no haya avisos", async () => {
    const s = simular(async () => {
      throw new Error("caído");
    });
    await s.enviar(s.mensaje({ location: { latitude: -4.654, longitude: -79.8539 } }));
    await s.esperar(2);
    expect(s.textos()[1]).toContain("NO significa que no haya avisos");
  });

  test("suscribir, listar, quitar y olvidar", async () => {
    const s = simular();
    const boton = (data: string): Update =>
      ({
        update_id: Date.now(),
        callback_query: {
          id: "cb",
          from: s.from,
          chat_instance: "x",
          data,
          message: { message_id: 1, date: 0, chat: s.chat },
        },
      }) as Update;
    await s.enviar(boton("s:-4.654,-79.8539"));
    await s.esperar(1);
    expect(s.textos()[0]).toStartWith("Listo: revisaré esta ubicación");
    const sub = s.db.listar(42)[0];
    expect(sub).toMatchObject({ lat: -4.654, lon: -79.8539 });
    expect(JSON.parse(sub.huella ?? "{}")["met:2026-421:2026-10-18"]).toBe(3); // línea base guardada
    await s.enviar(boton("s:-4.654,-79.8539"));
    await s.esperar(2);
    expect(s.textos()[1]).toContain("ya está guardada");
    await s.enviar(
      s.mensaje({ text: "/mis_ubicaciones", entities: [{ type: "bot_command", offset: 0, length: 16 }] }),
    );
    expect(s.textos()[2]).toContain("-4.654, -79.8539");
    await s.enviar(boton(`q:${sub.id}`));
    expect(s.db.listar(42)).toEqual([]);
    s.db.agregar(42, -5, -79, null, 3);
    await s.enviar(
      s.mensaje({ text: "/olvidar", entities: [{ type: "bot_command", offset: 0, length: 8 }] }),
    );
    expect(s.textos().at(-1)).toContain("borré 1 ubicaciones");
    expect(s.db.listar(42)).toEqual([]);
  });

  test("en un grupo no contesta cada mensaje de texto", async () => {
    const s = simular();
    await s.enviar({
      update_id: 999,
      message: {
        message_id: 1,
        date: 0,
        chat: { id: -5, type: "group", title: "Vecinos" },
        from: s.from,
        text: "hola a todos",
      },
    } as Update);
    expect(s.llamadas).toEqual([]);
  });
});

test("leerCoordenadas", () => {
  expect(leerCoordenadas("-12.0464, -77.0428")).toEqual([-12.0464, -77.0428]);
  expect(leerCoordenadas("-12,0464 -77,0428")).toEqual([-12.0464, -77.0428]);
  expect(leerCoordenadas("-12.05;-77.04")).toEqual([-12.05, -77.04]);
  expect(leerCoordenadas("hola")).toBeNull();
  expect(leerCoordenadas("Mz. B Lt. 12")).toBeNull();
});

test("consultarConRiesgoPunto con el riesgo-punto instalado (peligros real, avisos simulado)", async () => {
  // Fuerza a riesgo-punto a usar un avisos-pe falso: el SENAMHI no responde desde CI.
  const falso = join(mkdtempSync(join(tmpdir(), "riesgo-bot-")), "falso-avisos.mjs");
  await Bun.write(falso, `console.log(${JSON.stringify(JSON.stringify(montero.avisos))});\n`);
  process.env.RIESGO_PUNTO_AVISOS_CLI = falso;
  try {
    const r = await consultarConRiesgoPunto(60_000)(-4.654, -79.8539);
    expect(r.fuentes.peligros.ok).toBe(true);
    expect(r.mensaje).toContain("Pueblo Nuevo-Las Viudas, Montero");
  } finally {
    delete process.env.RIESGO_PUNTO_AVISOS_CLI;
  }
}, 60_000);
