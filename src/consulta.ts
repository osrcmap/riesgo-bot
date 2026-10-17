// Ejecuta riesgo-punto y valida la parte de su JSON que usa el bot.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod";

const Dia = z.looseObject({ fecha: z.string(), nivel: z.number(), estado: z.string() });

export const Respuesta = z.looseObject({
  ok: z.literal(true),
  completo: z.boolean(),
  mensaje: z.string().min(1),
  resumen: z.looseObject({
    avisos_de_lluvia: z.array(z.looseObject({ numero: z.number(), anio: z.number() })).nullable(),
  }),
  cruces: z.array(
    z.looseObject({ tipo: z.string(), aviso: z.looseObject({ numero: z.number(), anio: z.number() }) }),
  ),
  avisos: z
    .looseObject({
      meteorologicos: z.array(
        z.looseObject({ numero: z.number(), anio: z.number(), titulo: z.string(), dias: z.array(Dia) }),
      ),
      quebradas: z.looseObject({ numero: z.number(), anio: z.number(), nivel: z.number() }).nullable(),
    })
    .nullable(),
  fuentes: z.looseObject({
    peligros: z.looseObject({ ok: z.boolean() }),
    avisos: z.looseObject({ ok: z.boolean() }),
  }),
});
export type Respuesta = z.infer<typeof Respuesta>;

/** Consulta para un punto. Lanza si no hay respuesta útil (el llamador debe decir "no pude consultar"). */
export type Consultar = (lat: number, lon: number) => Promise<Respuesta>;

export const enPeru = (lat: number, lon: number) =>
  lon >= -81.5 && lon <= -68.5 && lat >= -18.5 && lat <= 0.1;

/** "-12.0464, -77.0428" → [lat, lon]. Acepta coma, espacio o punto y coma como separador. */
export function leerCoordenadas(texto: string): [number, number] | null {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(texto);
  if (!m) return null;
  // Si el decimal viene con coma ("-12,05 -77,04"), el separador tiene que ser espacio o punto y coma.
  const lat = Number(m[1].replace(",", "."));
  const lon = Number(m[2].replace(",", "."));
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

const require = createRequire(import.meta.url);

/** riesgo-punto instalado como dependencia; RIESGO_PUNTO_CLI lo sobrescribe. */
export function rutaRiesgoPunto(): string {
  return (
    process.env.RIESGO_PUNTO_CLI ||
    join(dirname(require.resolve("@osrcmap/riesgo-punto/package.json")), "dist/cli.js")
  );
}

export function consultarConRiesgoPunto(timeoutMs = 180_000): Consultar {
  return (lat, lon) =>
    new Promise((resolver, rechazar) => {
      const hijo = spawn(
        process.execPath,
        [rutaRiesgoPunto(), "consultar", "--lat", String(lat), "--lon", String(lon), "--json"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      hijo.stdout.on("data", (d) => (out += d));
      hijo.stderr.resume();
      const reloj = setTimeout(() => {
        hijo.kill("SIGKILL");
        rechazar(new Error(`riesgo-punto no respondió en ${timeoutMs / 1000} s`));
      }, timeoutMs);
      hijo.on("error", (e) => {
        clearTimeout(reloj);
        rechazar(e);
      });
      hijo.on("close", () => {
        clearTimeout(reloj);
        let json: unknown;
        try {
          json = JSON.parse(out.trim());
        } catch {
          return rechazar(new Error("riesgo-punto no devolvió JSON"));
        }
        const r = Respuesta.safeParse(json);
        if (!r.success) {
          const e = json as { code?: string; error?: string };
          return rechazar(
            new Error(`riesgo-punto: ${e?.code ?? "forma inesperada"} ${e?.error ?? ""}`.trim()),
          );
        }
        resolver(r.data);
      });
    });
}
