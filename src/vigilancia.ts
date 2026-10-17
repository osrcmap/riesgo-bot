// Revisión periódica de ubicaciones suscritas: avisa solo de lo nuevo o más grave en lluvias y huaicos, o en rojo.
import type { Consultar, Respuesta } from "./consulta.js";
import type { Suscripciones } from "./suscripciones.js";
import * as T from "./textos.js";

/** clave → nivel. Cada día de aviso relevante, el aviso de quebradas y cada cruce. */
export type Huella = Record<string, number>;

/**
 * Solo lo que puede activar huaicos (avisos de lluvia, quebradas, cruces) o un nivel rojo de
 * cualquier aviso. Un aviso de viento o calor amarillo/naranja no notifica (fatiga de alertas),
 * aunque sí aparece en el mensaje de la consulta.
 */
export function huella(r: Respuesta): Huella {
  const h: Huella = {};
  const lluvia = new Set((r.resumen.avisos_de_lluvia ?? []).map((a) => `${a.anio}-${a.numero}`));
  for (const a of r.avisos?.meteorologicos ?? []) {
    const deLluvia = lluvia.has(`${a.anio}-${a.numero}`);
    for (const d of a.dias) {
      if (d.estado !== "terminado" && (deLluvia || d.nivel === 4))
        h[`met:${a.anio}-${a.numero}:${d.fecha}`] = d.nivel;
    }
  }
  const q = r.avisos?.quebradas;
  if (q) h[`queb:${q.anio}-${q.numero}`] = q.nivel;
  for (const c of r.cruces) h[`cruce:${c.tipo}:${c.aviso.anio}-${c.aviso.numero}`] = 1;
  return h;
}

/** Claves nuevas o con nivel más alto. Las que bajan o desaparecen no avisan (evita fatiga de alertas). */
export const novedades = (antes: Huella, ahora: Huella) =>
  Object.entries(ahora)
    .filter(([k, n]) => antes[k] === undefined || n > antes[k])
    .map(([k]) => k);

/** Envía texto a un chat. Debe lanzar un error con `bloqueado = true` si el usuario bloqueó al bot. */
export type Enviar = (chatId: number, texto: string) => Promise<void>;

export type Opciones = {
  /** Tras cuánto tiempo sin poder consultar al SENAMHI se avisa a los suscriptores. */
  avisoFallaMs: number;
  ahora?: () => number;
};

const horaLima = (ms: number) => new Date(ms - 5 * 3600_000).toISOString().slice(11, 16);

/**
 * Una ronda: consulta cada suscripción, avisa novedades y lleva el estado de la fuente.
 * Si los avisos no se pudieron consultar, no se toca la huella (así la próxima consulta
 * exitosa no confunde "volvió la fuente" con "avisos nuevos").
 */
export async function ronda(db: Suscripciones, consultar: Consultar, enviar: Enviar, o: Opciones) {
  const ahora = o.ahora ?? Date.now;
  const resumen = { revisadas: 0, notificadas: 0, fallidas: 0, bloqueados: 0 };
  const cacheRonda = new Map<string, Promise<Respuesta>>(); // misma ubicación, una sola consulta por ronda

  for (const s of db.todas()) {
    resumen.revisadas++;
    let r: Respuesta;
    try {
      const k = `${s.lat},${s.lon}`;
      if (!cacheRonda.has(k)) cacheRonda.set(k, consultar(s.lat, s.lon));
      r = await (cacheRonda.get(k) as Promise<Respuesta>);
    } catch {
      resumen.fallidas++;
      continue;
    }
    if (!r.fuentes.avisos.ok || !r.avisos) {
      resumen.fallidas++;
      continue;
    }
    const actual = huella(r);
    const anterior: Huella = s.huella ? JSON.parse(s.huella) : {};
    if (novedades(anterior, actual).length) {
      try {
        await enviar(s.chat_id, T.novedad(s.lat, s.lon, r.mensaje));
        resumen.notificadas++;
      } catch (e) {
        if ((e as { bloqueado?: boolean }).bloqueado) {
          resumen.bloqueados++;
          db.olvidar(s.chat_id);
          continue;
        }
        continue; // no guardar la huella: se reintenta en la próxima ronda
      }
    }
    db.guardarHuella(s.id, JSON.stringify(actual));
  }

  await estadoFuente(db, enviar, resumen.fallidas > 0, ahora(), o.avisoFallaMs);
  return resumen;
}

/** Si la fuente lleva caída más de `umbralMs`, avisa una vez a cada chat; y otra vez cuando se restablece. */
async function estadoFuente(
  db: Suscripciones,
  enviar: Enviar,
  fallo: boolean,
  ahora: number,
  umbralMs: number,
) {
  const desde = db.leerEstado("fallo_desde");
  const avisado = db.leerEstado("fallo_avisado") === "1";
  const chats = [...new Set(db.todas().map((s) => s.chat_id))];
  const aTodos = async (texto: string) => {
    for (const c of chats) await enviar(c, texto).catch(() => {});
  };

  if (!fallo) {
    if (avisado) await aTodos(T.FUENTE_RESTABLECIDA);
    db.guardarEstado("fallo_desde", null);
    db.guardarEstado("fallo_avisado", null);
    return;
  }
  if (!desde) return db.guardarEstado("fallo_desde", new Date(ahora).toISOString());
  if (!avisado && ahora - Date.parse(desde) >= umbralMs) {
    await aTodos(T.FUENTE_CAIDA(horaLima(Date.parse(desde))));
    db.guardarEstado("fallo_avisado", "1");
  }
}
