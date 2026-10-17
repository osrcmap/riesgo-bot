// Textos del bot. Texto plano (sin Markdown) para que sirvan igual en Telegram, WhatsApp o SMS.

export const AVISO_LEGAL =
  "Información de referencia de fuentes oficiales (SENAMHI, INGEMMET). No es una orden de evacuación. Ante una emergencia sigue a INDECI, SENAMHI y tu municipalidad.";

export const BIENVENIDA = `Hola. Te digo qué avisos del SENAMHI y qué zonas críticas de peligro del INGEMMET hay para una ubicación del Perú.

1. Toca "Enviar mi ubicación" o comparte una ubicación del mapa. También puedes escribir coordenadas, por ejemplo: -12.0464, -77.0428
2. Si quieres, toca "Avisarme si cambia" y te escribiré cuando aparezca un aviso nuevo o más grave para ese lugar.

Comandos: /mis_ubicaciones /olvidar /privacidad /ayuda

${AVISO_LEGAL}`;

export const PRIVACIDAD = `Qué guardo: solo si tocas "Avisarme si cambia", guardo el número de este chat y la ubicación (redondeada a unos 11 m) para revisarla cada 30 minutos.
Qué no guardo: las consultas sin suscripción no se guardan.
Para borrar todo: /olvidar
Código abierto: https://github.com/osrcmap/riesgo-bot`;

export const CONSULTANDO = "Consultando al SENAMHI y al INGEMMET… (puede tardar hasta un minuto)";

export const ERROR_CONSULTA =
  "No pude consultar las fuentes en este momento. Eso NO significa que no haya avisos: revisa senamhi.gob.pe o intenta de nuevo en unos minutos.";

export const FUERA_DEL_PERU =
  "Esa ubicación está fuera del Perú. Si escribiste coordenadas, revisa el orden: primero la latitud (entre -18.5 y 0) y luego la longitud (entre -81.5 y -68.5).";

export const NO_ENTENDI =
  'No entendí. Envía tu ubicación con el botón, comparte un punto del mapa o escribe coordenadas como "-12.0464, -77.0428". /ayuda';

export const BOTON_UBICACION = "📍 Enviar mi ubicación";
export const BOTON_SUSCRIBIR = "🔔 Avisarme si cambia";

export const suscrito = (n: number, max: number) =>
  `Listo: revisaré esta ubicación cada 30 minutos y te escribiré solo si aparece un aviso nuevo, sube un nivel o hay una coincidencia nueva con una zona crítica. Tienes ${n} de ${max} ubicaciones. /mis_ubicaciones`;

export const LIMITE = (max: number) =>
  `Ya tienes ${max} ubicaciones guardadas, el máximo. Quita una con /mis_ubicaciones.`;
export const DUPLICADA = "Esa ubicación ya está guardada. /mis_ubicaciones";
export const SIN_UBICACIONES =
  'No tienes ubicaciones guardadas. Envía una ubicación y toca "Avisarme si cambia".';
export const OLVIDADO = (n: number) =>
  `Listo: borré ${n} ubicaciones guardadas y no te escribiré más. Puedes volver cuando quieras.`;

export const novedad = (lat: number, lon: number, mensaje: string) =>
  `NOVEDAD para tu ubicación guardada (${lat}, ${lon}):\n\n${mensaje}`;

export const FUENTE_CAIDA = (desdeHoraLima: string) =>
  `No he podido consultar los avisos del SENAMHI desde las ${desdeHoraLima} (hora de Perú). Mientras tanto NO puedo avisarte de novedades: revisa senamhi.gob.pe y sigue a INDECI y tu municipalidad. Te escribiré cuando se restablezca.`;
export const FUENTE_RESTABLECIDA =
  "Ya puedo consultar al SENAMHI de nuevo. Sigo revisando tus ubicaciones cada 30 minutos.";
