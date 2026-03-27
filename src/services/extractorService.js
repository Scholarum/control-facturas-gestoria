require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { getDb }            = require('../config/database');
const { buildDriveClient } = require('./driveService');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const CAMPOS_CRITICOS = ['numero_factura', 'fecha_emision', 'total_factura'];

const PROMPT_DEFAULT = `Analiza los documentos PDF que te pidamos.
Tienes que extraer los datos de la factura con el máximo detalle fiscal posible.

Devuelve ÚNICAMENTE un objeto JSON válido con la siguiente estructura, sin texto adicional, sin markdown, sin explicaciones:

{
  "invoiceNumber": "string o null",
  "issueDate": "YYYY-MM-DD o null",
  "issuerName": "string o null",
  "issuerCif": "string o null",
  "receiverName": "string o null",
  "receiverCif": "string o null",
  "taxBase0": 0,
  "taxBase4": 0,
  "taxBase10": 0,
  "taxBase21": 0,
  "vatAmount0": 0,
  "vatAmount4": 0,
  "vatAmount10": 0,
  "vatAmount21": 0,
  "totalExcludingVat": 0,
  "totalVat": 0,
  "totalIncludingVat": 0,
  "paymentMethod": "string o null",
  "paymentDate": "YYYY-MM-DD o null"
}

Instrucciones clave:

Si hay varios tipos de IVA, desglósalos en sus campos correspondientes (taxBase4, taxBase21, etc.).

Si alguno de los tipos de IVA indicados no existen en la factura, devuelve el valor 0 tanto en la base imponible como en el total del impuesto.

Normaliza todos los números: usa PUNTO para decimales (ej: 15.50) y no uses separadores de miles. Esto es obligatorio para que el JSON sea válido.

Las fechas deben estar SIEMPRE en formato YYYY-MM-DD. Si el año tiene 2 dígitos, asume 20XX.

En el campo 'issuerName', extrae SIEMPRE el nombre COMPLETO con su forma jurídica legal como 'S.A.', 'S.L.', 'S.L.U.', etc. Ejemplo: Si ves 'Iberdrola S.A.', devuelve 'Iberdrola S.A.'.

En el campo 'issuerCif', extrae el CIF/NIF del emisor (quien emite la factura).

En el campo 'receiverName', busca el nombre del destinatario en secciones como 'Datos del cliente', 'Cliente:', 'Facturar a:', 'Abono a:' o similar.

En el campo 'receiverCif', extrae el CIF/NIF del receptor (quien recibe la factura).

Si no encuentras un campo de texto, devuelve null. Nunca inventes datos.

Responde SOLO con el JSON. Ningún carácter fuera del objeto JSON.`;

// ─── Prompt: lectura y escritura en BD ───────────────────────────────────────

async function getPrompt() {
  const db  = getDb();
  const row = await db.one("SELECT valor FROM configuracion WHERE clave = 'prompt_gemini'");
  return row ? row.valor : PROMPT_DEFAULT;
}

async function savePrompt(texto) {
  const db = getDb();
  await db.query(
    `INSERT INTO configuracion (clave, valor, updated_at)
     VALUES ('prompt_gemini', $1, NOW())
     ON CONFLICT (clave) DO UPDATE SET
       valor      = EXCLUDED.valor,
       updated_at = NOW()`,
    [texto]
  );
}

async function ensurePromptSeeded() {
  const db  = getDb();
  const row = await db.one("SELECT 1 FROM configuracion WHERE clave = 'prompt_gemini'");
  if (!row) await savePrompt(PROMPT_DEFAULT);
}

async function resetPromptToDefault() {
  await savePrompt(PROMPT_DEFAULT);
}

// ─── Gemini model ─────────────────────────────────────────────────────────────

function buildGeminiModel() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada en .env');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  return genAI.getGenerativeModel({ model: GEMINI_MODEL }, { apiVersion: 'v1' });
}

// ─── Helpers de extracción ────────────────────────────────────────────────────

async function descargarPdfTmp(drive, googleId) {
  const tmpPath = path.join(os.tmpdir(), `factura_${googleId}_${Date.now()}.pdf`);
  const res = await drive.files.get(
    { fileId: googleId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  fs.writeFileSync(tmpPath, Buffer.from(res.data));
  return tmpPath;
}

async function llamarGemini(model, pdfPath, prompt) {
  const base64Pdf = fs.readFileSync(pdfPath).toString('base64');
  const sizeKB = Math.round(base64Pdf.length * 0.75 / 1024);

  let resultado;
  try {
    resultado = await model.generateContent([
      { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
      { text: prompt },
    ]);
  } catch (geminiErr) {
    // Clasificar el error de Gemini
    const status = geminiErr.status || geminiErr.httpStatusCode || geminiErr.code;
    const msg = geminiErr.message || String(geminiErr);
    if (status === 429 || msg.includes('429') || msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('rate')) {
      throw new Error(`GEMINI_RATE_LIMIT: Cuota/rate limit excedido (${status}). ${msg.slice(0, 200)}`);
    }
    if (status === 403 || msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('api key')) {
      throw new Error(`GEMINI_AUTH: Problema de autenticacion/permisos (${status}). ${msg.slice(0, 200)}`);
    }
    if (status === 500 || status === 503 || msg.toLowerCase().includes('unavailable') || msg.toLowerCase().includes('internal')) {
      throw new Error(`GEMINI_SERVER: Error del servidor Gemini (${status}). ${msg.slice(0, 200)}`);
    }
    if (msg.toLowerCase().includes('too large') || msg.toLowerCase().includes('payload') || msg.toLowerCase().includes('size')) {
      throw new Error(`GEMINI_SIZE: PDF demasiado grande (${sizeKB}KB). ${msg.slice(0, 200)}`);
    }
    throw new Error(`GEMINI_ERROR: ${msg.slice(0, 300)}`);
  }

  const response = resultado.response;
  const finishReason = response.candidates?.[0]?.finishReason;
  if (finishReason && finishReason !== 'STOP') {
    throw new Error(`GEMINI_BLOCKED: Respuesta bloqueada (finishReason=${finishReason}). Posible contenido no procesable.`);
  }

  let texto = response.text().trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

  if (!texto) {
    throw new Error('GEMINI_EMPTY: Gemini devolvio respuesta vacia');
  }

  texto = texto.replace(/("[\w]+"\s*:\s*-?\d+),(\d{1,4})(?=\s*[,}\n])/g, '$1.$2');

  let raw;
  try {
    raw = JSON.parse(texto);
  } catch (parseErr) {
    throw new Error(`GEMINI_PARSE: Respuesta no es JSON valido. Inicio: ${texto.slice(0, 100)}`);
  }

  return mapearRespuestaGemini(raw);
}

// ─── Mapeador de formato ──────────────────────────────────────────────────────

function parseFechaFlexible(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split('/');
    return `${y}-${m}-${d}`;
  }
  return s;
}

function mapearRespuestaGemini(raw) {
  if ('numero_factura' in raw) return raw;

  const iva = [];
  for (const tipo of [0, 4, 10, 21]) {
    const base  = Number(raw[`taxBase${tipo}`])   || 0;
    const cuota = Number(raw[`vatAmount${tipo}`]) || 0;
    if (base !== 0 || cuota !== 0) iva.push({ tipo, base, cuota });
  }

  return {
    numero_factura:    raw.invoiceNumber   ?? null,
    fecha_emision:     parseFechaFlexible(raw.issueDate),
    nombre_emisor:     raw.issuerName      ?? null,
    cif_emisor:        raw.issuerCif       ?? null,
    nombre_receptor:   raw.receiverName    ?? null,
    cif_receptor:      raw.receiverCif     ?? null,
    iva,
    total_sin_iva:     Number(raw.totalExcludingVat) || null,
    total_iva:         Number(raw.totalVat)          || null,
    total_factura:     Number(raw.totalIncludingVat) || null,
    forma_pago:        raw.paymentMethod   ?? null,
    fecha_vencimiento: parseFechaFlexible(raw.paymentDate),
  };
}

function round2(n) { return Math.round((n || 0) * 100) / 100; }

function normalizarTotales(datos) {
  // Si total_factura es 0 o vacio, rellenar todos los importes a 0
  const total = Number(datos.total_factura);
  if (total === 0 || datos.total_factura == null) {
    return {
      ...datos,
      total_factura: 0,
      total_sin_iva: 0,
      total_iva:     0,
      iva: [{ tipo: 0, base: 0, cuota: 0 }],
    };
  }

  const iva = Array.isArray(datos.iva) ? datos.iva : [];
  if (iva.length === 0) return datos;
  return {
    ...datos,
    total_sin_iva: round2(iva.reduce((s, e) => s + (e.base  || 0), 0)),
    total_iva:     round2(iva.reduce((s, e) => s + (e.cuota || 0), 0)),
  };
}

function validarDatos(datos) {
  const faltantes = CAMPOS_CRITICOS.filter(c => datos[c] == null);
  return { valido: faltantes.length === 0, faltantes };
}

async function guardarResultado(id, estado, datos, error) {
  const db = getDb();
  await db.query(
    `UPDATE drive_archivos
     SET estado = $1, datos_extraidos = $2, error_extraccion = $3, procesado_at = NOW()
     WHERE id = $4`,
    [estado, datos ? JSON.stringify(datos) : null, error ?? null, id]
  );
}

// ─── Procesado de un único archivo ───────────────────────────────────────────

async function procesarArchivo(drive, model, archivo, prompt) {
  let tmpPath = null;
  const t0 = Date.now();
  try {
    tmpPath = await descargarPdfTmp(drive, archivo.google_id);
    const sizeKB = Math.round(fs.statSync(tmpPath).size / 1024);
    const datos = await llamarGemini(model, tmpPath, prompt);
    const ms = Date.now() - t0;

    const { valido, faltantes } = validarDatos(datos);
    const datosN = normalizarTotales(datos);

    if (!valido) {
      const motivo = `Campos criticos ausentes: ${faltantes.join(', ')}`;
      console.log(`[Gemini] REVISION ${archivo.nombre_archivo} (${sizeKB}KB, ${ms}ms) — ${motivo}`);
      await guardarResultado(archivo.id, 'REVISION_MANUAL', datosN, motivo);
      return { estado: 'REVISION_MANUAL', datos: datosN, error: motivo };
    }

    console.log(`[Gemini] OK ${archivo.nombre_archivo} (${sizeKB}KB, ${ms}ms) — ${datos.numero_factura || '?'}`);
    await guardarResultado(archivo.id, 'PROCESADA', datosN, null);
    return { estado: 'PROCESADA', datos: datosN };

  } catch (err) {
    const ms = Date.now() - t0;
    const motivo = err.message.slice(0, 300);
    console.error(`[Gemini] ERROR ${archivo.nombre_archivo} (${ms}ms) — ${motivo}`);
    await guardarResultado(archivo.id, 'REVISION_MANUAL', null, motivo);
    return { estado: 'REVISION_MANUAL', error: motivo };
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

// ─── Ejecución en lote ────────────────────────────────────────────────────────

async function ejecutarExtraccion(ids, onProgress = () => {}) {
  const db = getDb();

  let archivos;
  if (ids && ids.length) {
    // Cargar en una sola query en vez de una por ID
    archivos = await db.all(
      'SELECT * FROM drive_archivos WHERE id = ANY($1::int[]) ORDER BY id',
      [ids]
    );
  } else {
    archivos = await db.all(
      "SELECT * FROM drive_archivos WHERE estado IN ('SINCRONIZADA','REVISION_MANUAL','PROCESADA') ORDER BY id"
    );
  }

  const total   = archivos.length;
  const resumen = { procesada: 0, revision: 0, error: 0 };

  if (total === 0) {
    onProgress({ tipo: 'fin', resumen, total: 0 });
    return resumen;
  }

  const prompt = await getPrompt();
  const drive  = await buildDriveClient();
  const model  = buildGeminiModel();

  console.log(`[Extraccion] Iniciando ${total} facturas con modelo ${process.env.GEMINI_MODEL || 'gemini-2.5-flash'}`);
  const tInicio = Date.now();

  const CONCURRENCY = parseInt(process.env.GEMINI_CONCURRENCY, 10) || 3;
  let done = 0;
  let erroresConsecutivos = 0;

  for (let i = 0; i < archivos.length; i += CONCURRENCY) {
    const lote = archivos.slice(i, i + CONCURRENCY);
    const resultados = await Promise.allSettled(
      lote.map(async (archivo) => {
        onProgress({ tipo: 'inicio', done, total, id: archivo.id, nombre: archivo.nombre_archivo, proveedor: archivo.proveedor });
        return procesarArchivo(drive, model, archivo, prompt);
      })
    );

    let loteErrors = 0;
    for (let j = 0; j < resultados.length; j++) {
      done++;
      const r = resultados[j];
      const archivo = lote[j];
      if (r.status === 'fulfilled') {
        if (r.value.estado === 'PROCESADA') { resumen.procesada++; erroresConsecutivos = 0; }
        else { resumen.revision++; }
        onProgress({ tipo: 'resultado', done, total, id: archivo.id, nombre: archivo.nombre_archivo, proveedor: archivo.proveedor, ...r.value });
      } else {
        resumen.error = (resumen.error || 0) + 1;
        loteErrors++;
        erroresConsecutivos++;
        const errMsg = r.reason?.message || 'Error desconocido';
        console.error(`[Extraccion] ERROR ${archivo.nombre_archivo}: ${errMsg}`);
        onProgress({ tipo: 'resultado', done, total, id: archivo.id, nombre: archivo.nombre_archivo, estado: 'REVISION_MANUAL', error: errMsg });
      }
    }

    // Log de progreso cada 10 lotes
    if (done % (CONCURRENCY * 10) < CONCURRENCY) {
      const elapsed = ((Date.now() - tInicio) / 1000).toFixed(0);
      console.log(`[Extraccion] Progreso: ${done}/${total} (${resumen.procesada} OK, ${resumen.revision} revision, ${resumen.error || 0} error) — ${elapsed}s`);
    }

    // Si hay muchos errores consecutivos (rate limit), esperar mas tiempo
    if (erroresConsecutivos >= 5) {
      console.warn(`[Extraccion] ${erroresConsecutivos} errores consecutivos — posible rate limit. Esperando 10s...`);
      await new Promise(resolve => setTimeout(resolve, 10000));
      erroresConsecutivos = 0; // reset para dar otra oportunidad
    } else if (loteErrors > 0) {
      // Esperar mas si hubo errores en el lote
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else if (i + CONCURRENCY < archivos.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  const tTotal = ((Date.now() - tInicio) / 1000).toFixed(1);
  console.log(`[Extraccion] COMPLETADA en ${tTotal}s — ${resumen.procesada} OK, ${resumen.revision} revision, ${resumen.error || 0} error de ${total} total`);
  onProgress({ tipo: 'fin', resumen, total });
  return resumen;
}

module.exports = {
  getPrompt, savePrompt, ensurePromptSeeded, resetPromptToDefault,
  PROMPT_DEFAULT,
  procesarArchivo, ejecutarExtraccion,
  buildGeminiModel, normalizarTotales, validarDatos, guardarResultado,
};
