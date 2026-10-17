import { describe, expect, test } from "bun:test";
import { Respuesta as Esquema, type Respuesta } from "../src/consulta.js";
import { Suscripciones } from "../src/suscripciones.js";
import { huella, novedades, ronda } from "../src/vigilancia.js";

const fx = async (n: string) =>
  Esquema.parse(JSON.parse(await Bun.file(`${import.meta.dir}/fixtures/${n}.json`).text()));

/** Copia de una respuesta con el día 2026-10-18 del aviso 421 en otro nivel. */
function conNivel(r: Respuesta, nivel: number): Respuesta {
  const c = structuredClone(r);
  for (const a of c.avisos?.meteorologicos ?? []) {
    if (a.numero === 421) for (const d of a.dias) if (d.fecha === "2026-10-18") d.nivel = nivel;
  }
  return c;
}

const sinAvisos = (r: Respuesta): Respuesta => ({
  ...structuredClone(r),
  avisos: null,
  fuentes: { ...r.fuentes, avisos: { ok: false } },
});

describe("huella y novedades", () => {
  test("una clave por día de aviso, aviso de quebradas y cruce", async () => {
    const h = huella(await fx("montero"));
    expect(h["met:2026-421:2026-10-18"]).toBe(3);
    expect(h["cruce:lluvia_y_zona_critica:2026-421"]).toBe(1);
  });
  test("solo cuenta lo nuevo o lo que sube", () => {
    expect(novedades({ a: 2 }, { a: 2 })).toEqual([]);
    expect(novedades({ a: 2 }, { a: 3 })).toEqual(["a"]);
    expect(novedades({ a: 3 }, { a: 2 })).toEqual([]); // baja: no avisa
    expect(novedades({ a: 2 }, {})).toEqual([]); // termina: no avisa
    expect(novedades({}, { b: 2 })).toEqual(["b"]);
  });
});

function entorno(respuestas: (Respuesta | Error)[]) {
  const db = new Suscripciones(":memory:");
  const enviados: { chat: number; texto: string }[] = [];
  let i = 0;
  const consultar = async () => {
    const r = respuestas[Math.min(i++, respuestas.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  };
  const enviar = async (chat: number, texto: string) => {
    enviados.push({ chat, texto });
  };
  return { db, enviados, consultar, enviar };
}

describe("ronda", () => {
  test("sin cambios no escribe; si sube un nivel, avisa una vez", async () => {
    const base = await fx("montero");
    const e = entorno([base, conNivel(base, 4), conNivel(base, 4)]);
    e.db.agregar(1, -4.654, -79.8539, JSON.stringify(huella(base)), 3);
    const o = { avisoFallaMs: 7_200_000 };
    expect((await ronda(e.db, e.consultar, e.enviar, o)).notificadas).toBe(0);
    expect((await ronda(e.db, e.consultar, e.enviar, o)).notificadas).toBe(1);
    expect(e.enviados[0].texto).toStartWith("NOVEDAD para tu ubicación guardada (-4.654, -79.8539)");
    expect((await ronda(e.db, e.consultar, e.enviar, o)).notificadas).toBe(0);
  });

  test("sin línea base, la primera revisión envía el estado completo", async () => {
    const e = entorno([await fx("chosica")]);
    e.db.agregar(1, -11.9437, -76.7036, null, 3);
    expect((await ronda(e.db, e.consultar, e.enviar, { avisoFallaMs: 7_200_000 })).notificadas).toBe(1);
  });

  test("si los avisos no responden, no toca la huella: al volver no hay falsas novedades", async () => {
    const base = await fx("montero");
    const e = entorno([sinAvisos(base), base]);
    e.db.agregar(1, -4.654, -79.8539, JSON.stringify(huella(base)), 3);
    const o = { avisoFallaMs: 7_200_000 };
    expect((await ronda(e.db, e.consultar, e.enviar, o)).fallidas).toBe(1);
    expect((await ronda(e.db, e.consultar, e.enviar, o)).notificadas).toBe(0);
    expect(e.enviados).toEqual([]);
  });

  test("fuente caída 2 horas: avisa una vez a cada chat; y al restablecerse", async () => {
    const base = await fx("montero");
    const e = entorno([new Error("caído"), new Error("caído"), new Error("caído"), base]);
    e.db.agregar(1, -4.654, -79.8539, JSON.stringify(huella(base)), 3);
    e.db.agregar(2, -4.654, -79.8539, JSON.stringify(huella(base)), 3);
    let t = Date.parse("2026-10-17T10:00:00-05:00");
    const o = { avisoFallaMs: 7_200_000, ahora: () => t };
    await ronda(e.db, e.consultar, e.enviar, o); // 10:00 empieza la falla
    t += 3_600_000;
    await ronda(e.db, e.consultar, e.enviar, o); // 11:00 aún no
    expect(e.enviados).toEqual([]);
    t += 3_600_000;
    await ronda(e.db, e.consultar, e.enviar, o); // 12:00 avisa
    expect(e.enviados.map((m) => m.chat)).toEqual([1, 2]);
    expect(e.enviados[0].texto).toContain("desde las 10:00");
    t += 1_800_000;
    await ronda(e.db, e.consultar, e.enviar, o); // vuelve
    expect(e.enviados.slice(2).map((m) => m.texto.slice(0, 30))).toEqual([
      "Ya puedo consultar al SENAMHI ",
      "Ya puedo consultar al SENAMHI ",
    ]);
  });

  test("usuario que bloqueó al bot: se borran sus suscripciones", async () => {
    const e = entorno([await fx("chosica")]);
    e.db.agregar(7, -11.9437, -76.7036, null, 3);
    const enviar = async () => {
      throw Object.assign(new Error("Forbidden: bot was blocked by the user"), { bloqueado: true });
    };
    expect((await ronda(e.db, e.consultar, enviar, { avisoFallaMs: 7_200_000 })).bloqueados).toBe(1);
    expect(e.db.listar(7)).toEqual([]);
  });

  test("si el envío falla por otra razón, se reintenta en la próxima ronda", async () => {
    const e = entorno([await fx("chosica")]);
    e.db.agregar(1, -11.9437, -76.7036, null, 3);
    let falla = true;
    const enviar = async (chat: number, texto: string) => {
      if (falla) throw new Error("timeout");
      e.enviados.push({ chat, texto });
    };
    await ronda(e.db, e.consultar, enviar, { avisoFallaMs: 7_200_000 });
    falla = false;
    expect((await ronda(e.db, e.consultar, enviar, { avisoFallaMs: 7_200_000 })).notificadas).toBe(1);
  });
});

test("suscripciones: redondeo, duplicadas, límite y olvidar", () => {
  const db = new Suscripciones(":memory:");
  expect(db.agregar(1, -12.046412, -77.042812, null, 2)).toEqual({ ok: true, total: 1 });
  expect(db.listar(1)[0]).toMatchObject({ lat: -12.0464, lon: -77.0428 });
  expect(db.agregar(1, -12.04641, -77.04281, null, 2)).toEqual({ ok: false, motivo: "duplicada" });
  expect(db.agregar(1, -5, -79, null, 2)).toEqual({ ok: true, total: 2 });
  expect(db.agregar(1, -6, -79, null, 2)).toEqual({ ok: false, motivo: "limite" });
  expect(db.agregar(2, -6, -79, null, 2).ok).toBe(true);
  expect(db.olvidar(1)).toBe(2);
  expect(db.todas().map((s) => s.chat_id)).toEqual([2]);
});
