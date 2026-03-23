/**
 * extractor.js — Bloque 2: Extractor de datos de facturas via Gemini
 *
 * Uso:
 *   node extractor.js              → Procesa todos los archivos PENDIENTES
 *   node extractor.js --id 3       → Procesa solo el archivo con id=3
 *   node extractor.js --reprocess  → Reprocesa también los REVISION_MANUAL
 */
require('dotenv').config();

const { google }              = require('googleapis');
const { GoogleGenerativeAI }  = require('@google/generative-ai');
const fs                      = require('fs');
const path                    = require('path');
const os                      = require('os');
const { initDb, getDb }       = require('./src/config/database');
const { runMigrations }       = require('./src/config/migrate');

// ─── Configuración ────────────────────────────────────────────────────────────

const CREDENTIALS_FILE = path.resolve(__dirname, 'credentials..json');
const GEMINI_API_KEY   = process.env.GEMINI_API_KEY;
const GEMINI_MODEL     = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

// Campos obligatorios: si alguno falta → REVISION_MANUAL
const CAMPOS_CRITICOS = ['numero_factura', 'fecha_emision', 'total_factura'];

// ─── Prompt de extracción ─────────────────────────────────────────────────────

const PROMPT_EXTRACCION = `
Eres un asistente experto en análisis de facturas españolas. Tu tarea es extraer datos estructurados del PDF adjunto.

Devuelve ÚNICAMENTE un objeto JSON válido con exactamente esta estructura, sin texto adicional, sin markdown, sin explicaciones:

{
  "numero_factura": "string con el número o código de la factura, o null",
  "fecha_emision": "fecha en formato YYYY-MM-DD, o null",
  "cif_emisor": "CIF/NIF del emisor de la factura (no del receptor), o null",
  "iva": [
    { "tipo": 21, "base": 1000.00, "cuota": 210.00 }
  ],
  "total_factura": 1210.00,
  "forma_pago": "TRANSFERENCIA | DOMICILIACION | CONTADO | TARJETA | CHEQUE | otro texto descriptivo, o null",
  "fecha_vencimiento": "fecha en formato YYYY-MM-DD, o null"
}

Reglas estrictas:
- Fechas siempre en formato YYYY-MM-DD. Si el año tiene 2 dígitos, asume 20XX.
- Importes como número decimal sin símbolo de moneda (ej: 1210.50 no "1.210,50 €").
- El array "iva" debe tener una entrada por cada tipo de IVA distinto que aparezca (puede ser vacío []).
- Si no encuentras un campo, usa null. No inventes datos.
- Responde SOLO con el JSON. Ningún carácter fuera del objeto JSON.
`.trim();

// ─── Clientes externos ────────────────────────────────────────────────────────

async function buildDriveClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_FILE,
    scopes:  ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

function buildGeminiModel() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada en .env');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  // apiVersion: 'v1' — la v1beta no está disponible para todas las API keys
  return genAI.getGenerativeModel({ model: GEMINI_MODEL }, { apiVersion: 'v1' });
}

// ─── Descarga temporal del PDF ────────────────────────────────────────────────

async function descargarPdf(drive, googleId, nombreArchivo) {
  const tmpPath = path.join(os.tmpdir(), `factura_${googleId}_${Date.now()}.pdf`);

  const res = await drive.files.get(
    { fileId: googleId, alt: 'media' },
    { responseType: 'arraybuffer' }
  );

  fs.writeFileSync(tmpPath, Buffer.from(res.data));
  return tmpPath;
}

// ─── Extracción con Gemini ────────────────────────────────────────────────────

/**
 * Envía el PDF a Gemini y devuelve el JSON parseado, o lanza un error.
 */
async function extraerConGemini(model, pdfPath) {
  const pdfBytes  = fs.readFileSync(pdfPath);
  const base64Pdf = pdfBytes.toString('base64');

  const resultado = await model.generateContent([
    {
      inlineData: {
        mimeType: 'application/pdf',
        data:     base64Pdf,
      },
    },
    { text: PROMPT_EXTRACCION },
  ]);

  const texto = resultado.response.text().trim();

  // Eliminar posibles bloques markdown que el modelo añada por error
  const jsonLimpio = texto
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  return JSON.parse(jsonLimpio);
}

// ─── Validación del resultado ─────────────────────────────────────────────────

function validarDatos(datos) {
  const faltantes = CAMPOS_CRITICOS.filter(c => datos[c] === null || datos[c] === undefined);
  return { valido: faltantes.length === 0, faltantes };
}

// ─── Actualización de BD ──────────────────────────────────────────────────────

function actualizarArchivo(id, estado, datosExtraidos, errorExtraccion) {
  const db = getDb();
  db.prepare(`
    UPDATE drive_archivos
    SET estado           = ?,
        datos_extraidos  = ?,
        error_extraccion = ?,
        procesado_at     = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(
    estado,
    datosExtraidos  ? JSON.stringify(datosExtraidos)  : null,
    errorExtraccion ?? null,
    id
  );
}

// ─── Procesado de un único archivo ───────────────────────────────────────────

async function procesarArchivo(drive, model, archivo) {
  const { id, google_id, nombre_archivo, proveedor } = archivo;
  let tmpPath = null;

  console.log(`\n  → [${id}] ${proveedor} / ${nombre_archivo}`);

  try {
    // 1. Descargar PDF
    process.stdout.write('     Descargando PDF... ');
    tmpPath = await descargarPdf(drive, google_id, nombre_archivo);
    console.log('OK');

    // 2. Extraer con Gemini
    process.stdout.write(`     Enviando a Gemini (${GEMINI_MODEL})... `);
    const datos = await extraerConGemini(model, tmpPath);
    console.log('OK');

    // 3. Validar campos críticos
    const { valido, faltantes } = validarDatos(datos);
    if (!valido) {
      const motivo = `Campos críticos ausentes: ${faltantes.join(', ')}`;
      console.log(`     REVISION_MANUAL — ${motivo}`);
      actualizarArchivo(id, 'REVISION_MANUAL', datos, motivo);
      return 'REVISION_MANUAL';
    }

    // 4. Guardar como PROCESADA
    actualizarArchivo(id, 'PROCESADA', datos, null);
    console.log(`     PROCESADA ✓`);
    console.log(`       Factura: ${datos.numero_factura} | Total: ${datos.total_factura} | Emisor: ${datos.cif_emisor}`);
    return 'PROCESADA';

  } catch (err) {
    const motivo = err.message.slice(0, 300);
    console.log(`     ERROR — ${motivo}`);
    actualizarArchivo(id, 'REVISION_MANUAL', null, motivo);
    return 'REVISION_MANUAL';

  } finally {
    // Eliminar el archivo temporal siempre
    if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args        = process.argv.slice(2);
  const idFiltro    = args.includes('--id') ? parseInt(args[args.indexOf('--id') + 1]) : null;
  const reprocess   = args.includes('--reprocess');

  await initDb();
  runMigrations();

  const db = getDb();

  // Seleccionar archivos a procesar
  let archivos;
  if (idFiltro) {
    archivos = db.prepare('SELECT * FROM drive_archivos WHERE id = ?').all(idFiltro);
  } else {
    const estados = reprocess ? "('PENDIENTE','REVISION_MANUAL')" : "('PENDIENTE')";
    archivos = db.prepare(`SELECT * FROM drive_archivos WHERE estado IN ${estados} ORDER BY id`).all();
  }

  if (archivos.length === 0) {
    console.log('\nNo hay archivos pendientes de procesar.');
    return;
  }

  console.log(`\n══════════════════════════════════════════════`);
  console.log(`  Extractor Gemini — ${archivos.length} archivo(s) a procesar`);
  console.log(`══════════════════════════════════════════════`);

  const drive = await buildDriveClient();
  const model = buildGeminiModel();

  const resumen = { PROCESADA: 0, REVISION_MANUAL: 0, ERROR: 0 };

  for (const archivo of archivos) {
    const resultado = await procesarArchivo(drive, model, archivo);
    resumen[resultado] = (resumen[resultado] || 0) + 1;
  }

  console.log('\n──────────────────────────────────────────────');
  console.log(`  PROCESADA:        ${resumen.PROCESADA || 0}`);
  console.log(`  REVISION_MANUAL:  ${resumen.REVISION_MANUAL || 0}`);
  console.log('══════════════════════════════════════════════\n');
}

main().catch(err => { console.error('\nError fatal:', err.message); process.exit(1); });
