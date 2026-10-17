// Suscripciones en SQLite (bun:sqlite). Solo se guarda lo necesario para avisar.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Suscripcion = {
  id: number;
  chat_id: number;
  lat: number;
  lon: number;
  creada: string;
  /** JSON de la última huella notificada; null si aún no hay línea base. */
  huella: string | null;
};

/** 4 decimales ≈ 11 m: suficiente para los avisos y zonas, sin guardar la ubicación exacta. */
export const redondear = (n: number) => Math.round(n * 1e4) / 1e4;

export class Suscripciones {
  readonly db: Database;

  constructor(ruta: string) {
    if (ruta !== ":memory:") mkdirSync(dirname(ruta), { recursive: true });
    this.db = new Database(ruta, { create: true, strict: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS suscripciones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      creada TEXT NOT NULL,
      huella TEXT,
      UNIQUE (chat_id, lat, lon)
    );
    CREATE TABLE IF NOT EXISTS estado (clave TEXT PRIMARY KEY, valor TEXT);`);
  }

  agregar(
    chatId: number,
    lat: number,
    lon: number,
    huella: string | null,
    max: number,
  ): { ok: true; total: number } | { ok: false; motivo: "limite" | "duplicada" } {
    const [la, lo] = [redondear(lat), redondear(lon)];
    return this.db.transaction(() => {
      if (
        this.db
          .query("SELECT 1 FROM suscripciones WHERE chat_id = ? AND lat = ? AND lon = ?")
          .get(chatId, la, lo)
      ) {
        return { ok: false as const, motivo: "duplicada" as const };
      }
      const total = this.listar(chatId).length;
      if (total >= max) return { ok: false as const, motivo: "limite" as const };
      this.db
        .query("INSERT INTO suscripciones (chat_id, lat, lon, creada, huella) VALUES (?, ?, ?, ?, ?)")
        .run(chatId, la, lo, new Date().toISOString(), huella);
      return { ok: true as const, total: total + 1 };
    })();
  }

  listar(chatId: number): Suscripcion[] {
    return this.db
      .query("SELECT * FROM suscripciones WHERE chat_id = ? ORDER BY id")
      .all(chatId) as Suscripcion[];
  }

  todas(): Suscripcion[] {
    return this.db.query("SELECT * FROM suscripciones ORDER BY id").all() as Suscripcion[];
  }

  quitar(chatId: number, id: number): boolean {
    return (
      this.db.query("DELETE FROM suscripciones WHERE chat_id = ? AND id = ?").run(chatId, id).changes > 0
    );
  }

  olvidar(chatId: number): number {
    return this.db.query("DELETE FROM suscripciones WHERE chat_id = ?").run(chatId).changes;
  }

  guardarHuella(id: number, huella: string) {
    this.db.query("UPDATE suscripciones SET huella = ? WHERE id = ?").run(huella, id);
  }

  leerEstado(clave: string): string | null {
    const r = this.db.query("SELECT valor FROM estado WHERE clave = ?").get(clave) as {
      valor: string;
    } | null;
    return r?.valor ?? null;
  }

  guardarEstado(clave: string, valor: string | null) {
    if (valor === null) this.db.query("DELETE FROM estado WHERE clave = ?").run(clave);
    else this.db.query("INSERT OR REPLACE INTO estado (clave, valor) VALUES (?, ?)").run(clave, valor);
  }

  cerrar() {
    this.db.close();
  }
}
