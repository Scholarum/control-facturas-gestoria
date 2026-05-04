require('dotenv').config();

const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { getDb }            = require('../config/database');
const { buildDriveClient } = require('./driveService');
const logger               = require('../config/logger');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

const CAMPOS_CRITICOS = ['numero_factura', 'fecha_emision', 'total_factura'];

// CIFs de proveedores que envían múltiples facturas en un solo PDF.
// Se fuerza REVISION_MANUAL para procesamiento humano.
const CIFS_MULTI_FACTURA = new Set([
  'B95842522', // PAYCOMET S.L.
]);

// PROMPT_DEFAULT_V1 — version historica (pre-rectificativas). Se conserva como
// constante literal para que la migracion idempotente de runMigrations() pueda
// detectar si el prompt en BD coincide byte-a-byte con el default antiguo y,
// en ese caso, actualizarlo automaticamente al V2 (PROMPT_DEFAULT abajo).
// Si el admin ha customizado el prompt en la UI, la comparacion fallara y la
// migracion respetara su version.
const PROMPT_DEFAULT_V1 = `Analiza los documentos PDF que te pidamos.
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

// PROMPT_DEFAULT_V2 — version intermedia (pre-IRPF). Anyade deteccion de facturas
// rectificativas y extraccion opcional de datos de la factura original. Conservada
// como literal para que la migracion idempotente pueda detectarla byte-a-byte y
// actualizarla al V3 vigente. NO modificar este texto: si lo tocas, la cadena de
// migracion deja de detectar las instalaciones que estan en V2 y los admins
// tendran que resetear el prompt manualmente.
const PROMPT_DEFAULT_V2 = `Analiza los documentos PDF que te pidamos.
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
  "paymentDate": "YYYY-MM-DD o null",
  "isRectificativa": null,
  "rectifiedSerie": null,
  "rectifiedNumber": null,
  "rectifiedDate": null,
  "rectifiedTaxBase": null
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

DETECCIÓN DE FACTURAS RECTIFICATIVAS:

En 'isRectificativa' devuelve true si el documento se autodescribe explícitamente como una rectificativa. Señales que lo indican: títulos o textos como 'FACTURA RECTIFICATIVA', 'NOTA DE ABONO', 'NOTA DE CRÉDITO', 'FACTURA DE ABONO', 'CORRECCIÓN DE FACTURA', menciones explícitas a 'Art. 80 LIVA' o 'Ley del IVA art. 80', o literales equivalentes en inglés ('CREDIT NOTE', 'CORRECTED INVOICE') cuando el proveedor factura internacionalmente. Devuelve false si el documento es una factura ordinaria normal. Devuelve null SOLO si no puedes determinarlo — esto es excepcional, la mayoría de facturas son claramente ordinarias. Importante: un total negativo por sí solo NO basta para marcar true; tiene que haber texto que lo autodescriba como rectificativa.

Si 'isRectificativa' es true, intenta extraer también los datos de la factura original que se rectifica, si aparecen en el documento:
- 'rectifiedSerie': serie de la factura original (1 carácter, p.ej. 'A', 'B'). Si no se menciona, null.
- 'rectifiedNumber': número de la factura original (texto, hasta 40 caracteres). Si no se menciona, null.
- 'rectifiedDate': fecha de la factura original en formato YYYY-MM-DD. Si no se menciona, null.
- 'rectifiedTaxBase': base imponible de la factura original (número decimal positivo). Si no se menciona, null.

IMPORTANTE: muchas rectificativas NO traen referencia a la factura original. En ese caso, mantén los 4 campos 'rectified*' a null aunque 'isRectificativa' sea true. No inventes datos.

Si 'isRectificativa' es false o null, los 4 campos 'rectified*' deben ser null.

Si no encuentras un campo de texto, devuelve null. Nunca inventes datos.

Responde SOLO con el JSON. Ningún carácter fuera del objeto JSON.`;

// PROMPT_DEFAULT_V3_SIN_REGLAS — version intermedia previa a la incorporacion de
// reglas especificas de identificacion fiscal por proveedor. Conservada como literal
// (byte-a-byte) para que la migracion idempotente pueda detectar via SHA-256 las
// instalaciones que esten exactamente en este estado y migrarlas automaticamente
// al PROMPT_DEFAULT vigente. NO modificar este texto: si lo tocas, el hash deja de
// coincidir y los admins tendran que resetear el prompt manualmente desde la UI.
const PROMPT_DEFAULT_V3_SIN_REGLAS = `Analiza los documentos PDF que te pidamos.
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
  "paymentDate": "YYYY-MM-DD o null",
  "isRectificativa": null,
  "rectifiedSerie": null,
  "rectifiedNumber": null,
  "rectifiedDate": null,
  "rectifiedTaxBase": null,
  "irpfBase": null,
  "irpfPorcentaje": null,
  "irpfCuota": null,
  "irpfClave": null,
  "irpfDeducidoEnTotal": null
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

SEMÁNTICA CRÍTICA DE 'totalIncludingVat':

'totalIncludingVat' debe ser SIEMPRE el TOTAL A PAGAR neto, ya descontada cualquier retención IRPF si la factura la lleva. NO es el bruto base+IVA. Procedimiento:

1. Si en el PDF aparece un literal "Total a pagar", "Importe a pagar", "Total factura", "Líquido a pagar" o equivalente que indique cantidad final que el cliente abona, extráelo LITERALMENTE en 'totalIncludingVat' y devuelve 'irpfDeducidoEnTotal': true si la factura tiene IRPF y el literal lo refleja descontado, false si el literal NO descuenta IRPF, null si no hay IRPF en la factura.

2. Si no hay literal de "Total a pagar" claro, calcula 'totalIncludingVat' = totalExcludingVat + totalVat - irpfCuota (si hay IRPF) o totalExcludingVat + totalVat (si no hay). En ese caso devuelve 'irpfDeducidoEnTotal': true (el cálculo siempre descuenta IRPF si existe).

3. Coherencia obligatoria: si hay IRPF y devuelves 'totalIncludingVat' literal con 'irpfDeducidoEnTotal': false (es decir, el PDF lleva un total bruto sin descontar IRPF), pon también el cálculo neto en un campo aparte. Esta app trata 'totalIncludingVat' como neto a pagar; si dudas, calcula y marca 'irpfDeducidoEnTotal': true.

DETECCIÓN DE FACTURAS RECTIFICATIVAS:

En 'isRectificativa' devuelve true si el documento se autodescribe explícitamente como una rectificativa. Señales que lo indican: títulos o textos como 'FACTURA RECTIFICATIVA', 'NOTA DE ABONO', 'NOTA DE CRÉDITO', 'FACTURA DE ABONO', 'CORRECCIÓN DE FACTURA', menciones explícitas a 'Art. 80 LIVA' o 'Ley del IVA art. 80', o literales equivalentes en inglés ('CREDIT NOTE', 'CORRECTED INVOICE') cuando el proveedor factura internacionalmente. Devuelve false si el documento es una factura ordinaria normal. Devuelve null SOLO si no puedes determinarlo — esto es excepcional, la mayoría de facturas son claramente ordinarias. Importante: un total negativo por sí solo NO basta para marcar true; tiene que haber texto que lo autodescriba como rectificativa.

Si 'isRectificativa' es true, intenta extraer también los datos de la factura original que se rectifica, si aparecen en el documento:
- 'rectifiedSerie': serie de la factura original (1 carácter, p.ej. 'A', 'B'). Si no se menciona, null.
- 'rectifiedNumber': número de la factura original (texto, hasta 40 caracteres). Si no se menciona, null.
- 'rectifiedDate': fecha de la factura original en formato YYYY-MM-DD. Si no se menciona, null.
- 'rectifiedTaxBase': base imponible de la factura original (número decimal positivo). Si no se menciona, null.

IMPORTANTE: muchas rectificativas NO traen referencia a la factura original. En ese caso, mantén los 4 campos 'rectified*' a null aunque 'isRectificativa' sea true. No inventes datos.

Si 'isRectificativa' es false o null, los 4 campos 'rectified*' deben ser null.

DETECCIÓN DE RETENCIÓN IRPF:

Detecta retención IRPF si encuentras texto como "Retención IRPF", "IRPF", "Retención del X%", "-15% IRPF", "I.R.P.F.", "Retención profesional", "Retención arrendamiento", "Retenciones a cuenta", o líneas con porcentajes negativos aplicados sobre la base imponible (típicamente 7%, 15%, 19%).

Si detectas retención, rellena:
- 'irpfBase': base imponible sobre la que se calcula la retención (decimal positivo). Habitualmente coincide con 'totalExcludingVat' pero puede ser distinta.
- 'irpfPorcentaje': porcentaje aplicado (decimal positivo, p.ej. 15.00, 7.00, 19.00).
- 'irpfCuota': importe de la retención (decimal positivo: euros descontados al proveedor).
- 'irpfClave': código del tipo de retención según contexto:
    1 = General profesionales (caso por defecto si es factura de un profesional sin más detalle)
    2 = Arrendamientos dinerarios (Modelo 115, alquiler de local con pago en metálico)
    3 = Arrendamientos en especie (Modelo 115, raro)
    4-11 = Subtipos G.01-G.04 de actividades profesionales (sólo si el PDF los menciona explícitamente)
  Si no puedes determinar la clave con certeza, déjala a null y la asignará el usuario o el proveedor en BD.

Si NO hay rastro de IRPF en el PDF, los 5 campos IRPF (incluido 'irpfDeducidoEnTotal') deben ir a null. NO inventes una retención.

Coherencia: si 'irpfBase' e 'irpfPorcentaje' están informados, 'irpfCuota' debería cumplir 'irpfCuota ≈ irpfBase * irpfPorcentaje / 100' (margen 0.05€). Si los 3 vienen del PDF y no cumplen la igualdad, prioriza el valor literal de 'irpfCuota' del PDF.

Si no encuentras un campo de texto, devuelve null. Nunca inventes datos.

Responde SOLO con el JSON. Ningún carácter fuera del objeto JSON.`;

// REGLAS_OVERRIDE_FISCAL — overrides de identificacion fiscal por proveedor.
// Cuando aparezca un nuevo proveedor donde Gemini falla repetidamente al extraer
// CIF/VAT, se anyade aqui. Si la lista crece >10 reglas, migrar a tabla
// proveedor_overrides_extraccion (ver CLAUDE.md, seccion "Reglas de identificacion
// fiscal en PROMPT_DEFAULT").
const REGLAS_OVERRIDE_FISCAL = `REGLAS ESPECÍFICAS DE IDENTIFICACIÓN FISCAL POR PROVEEDOR:

Estas reglas tienen prioridad sobre cualquier otro valor de CIF/NIF/VAT que aparezca en el documento. Si detectas alguno de estos proveedores, usa siempre los valores indicados aquí, ignorando lo que diga el PDF:

- Si el proveedor (issuerName) es "Aduna 2021, S.A.U" o cualquier variante con prefijo (p. ej. "DISPE, ADUNA 2021, S.A.U", "ACL, ADUNA 2021, S.A.U") y el receptor (receiverName) contiene "R.S. SCHOLARUM DIGITAL SL", el CIF del receptor (receiverCif) debe ser SIEMPRE B86610821.

- Si el proveedor es MAILJET (cualquier variante de razón social, p. ej. "Mailjet SAS", "MAILJET S.A.S."), el VAT number / CIF del emisor (issuerCif) debe ser SIEMPRE FR67524536992.

- Si el proveedor es "IONOS Cloud S.L.U." (cualquier variante, p. ej. "1&1 IONOS Cloud SLU"), el CIF del emisor debe ser SIEMPRE B85049435.
`;

// PROMPT_DEFAULT — version vigente (V3+reglas). Se construye sobre PROMPT_DEFAULT_V3_SIN_REGLAS
// insertando REGLAS_OVERRIDE_FISCAL inmediatamente antes del cierre del prompt
// (las dos lineas finales "Si no encuentras..." y "Responde SOLO con el JSON...").
// Asi cuando se anyaden reglas nuevas, se editan SOLO en REGLAS_OVERRIDE_FISCAL,
// no se duplica el texto del V3 entero.
//
// La migracion idempotente compara hashes SHA-256 (ver migrate.js): si el prompt
// en BD coincide con V1, V2 o V3_SIN_REGLAS, se actualiza automaticamente al
// PROMPT_DEFAULT vigente. Si no coincide con ninguna version conocida, se loguea
// WARN y el admin debe resetear desde la UI de configuracion.
const PROMPT_DEFAULT = PROMPT_DEFAULT_V3_SIN_REGLAS.replace(
  '\nSi no encuentras un campo de texto, devuelve null. Nunca inventes datos.\n',
  `\n${REGLAS_OVERRIDE_FISCAL}\nSi no encuentras un campo de texto, devuelve null. Nunca inventes datos.\n`
);

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

// Errores que se pueden reintentar (transitorios)
const RETRIABLE_PREFIXES = ['GEMINI_RATE_LIMIT', 'GEMINI_SERVER', 'GEMINI_ERROR'];
const MAX_RETRIES = 3;

function isRetriable(err) {
  return RETRIABLE_PREFIXES.some(p => (err.message || '').startsWith(p));
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function llamarGeminiRaw(model, base64Pdf, prompt) {
  let resultado;
  try {
    resultado = await model.generateContent([
      { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
      { text: prompt },
    ]);
  } catch (geminiErr) {
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
      throw new Error(`GEMINI_SIZE: PDF demasiado grande. ${msg.slice(0, 200)}`);
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

async function llamarGemini(model, pdfPath, prompt) {
  const base64Pdf = fs.readFileSync(pdfPath).toString('base64');

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await llamarGeminiRaw(model, base64Pdf, prompt);
    } catch (err) {
      if (attempt < MAX_RETRIES && isRetriable(err)) {
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30000);
        logger.info({ attempt: attempt + 1, maxRetries: MAX_RETRIES, delaySec: (delay/1000).toFixed(1), err }, 'Gemini retry');
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }
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

  // Campos de rectificativa: prompts anteriores no los devolvian. Si llegan,
  // null = "Gemini no sabe / no aplica" (respeta valor actual al persistir);
  // false explicito = "detectado como NO rectificativa" (sobrescribe).
  const isRect = raw.isRectificativa === true  ? true
               : raw.isRectificativa === false ? false
               : null;
  const rectBaseRaw = raw.rectifiedTaxBase;

  // Campos IRPF (prompt V3): irpf_base e irpf_cuota se persisten como columnas
  // separadas en drive_archivos. Los campos informativos extraidos de Gemini
  // (porcentaje, clave, deducido_en_total) viajan en el JSONB datos_extraidos
  // para que la UI muestre alertas si el porcentaje detectado por Gemini no
  // coincide con el que tiene configurado el proveedor (commit 4 — alertas).
  // null = "Gemini no detecto IRPF / version pre-V3 sin el campo".
  const irpfDed = raw.irpfDeducidoEnTotal === true  ? true
                : raw.irpfDeducidoEnTotal === false ? false
                : null;

  return {
    numero_factura:    raw.invoiceNumber   ?? null,
    fecha_emision:     parseFechaFlexible(raw.issueDate),
    nombre_emisor:     raw.issuerName      ?? null,
    cif_emisor:        raw.issuerCif       ?? null,
    nombre_receptor:   raw.receiverName    ?? null,
    cif_receptor:      raw.receiverCif     ?? null,
    iva,
    total_sin_iva:     raw.totalExcludingVat != null ? Number(raw.totalExcludingVat) : null,
    total_iva:         raw.totalVat != null          ? Number(raw.totalVat)          : null,
    total_factura:     raw.totalIncludingVat != null  ? Number(raw.totalIncludingVat) : null,
    forma_pago:        raw.paymentMethod   ?? null,
    fecha_vencimiento: parseFechaFlexible(raw.paymentDate),
    es_rectificativa:  isRect,
    rect_serie:        raw.rectifiedSerie  ?? null,
    rect_numero:       raw.rectifiedNumber ?? null,
    rect_fecha:        parseFechaFlexible(raw.rectifiedDate),
    rect_base_imp:     rectBaseRaw != null ? Number(rectBaseRaw) : null,
    // IRPF: los 2 primeros van a columnas; los 3 siguientes al JSONB (alertas UI).
    irpf_base:                    raw.irpfBase  != null ? Number(raw.irpfBase)  : null,
    irpf_cuota:                   raw.irpfCuota != null ? Number(raw.irpfCuota) : null,
    irpf_porcentaje_extraido:     raw.irpfPorcentaje != null ? Number(raw.irpfPorcentaje) : null,
    irpf_clave_extraida:          Number.isInteger(raw.irpfClave) ? raw.irpfClave : null,
    irpf_deducido_en_total:       irpfDed,
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

// ─── Validación de CIF/VAT internacional ─────────────────────────────────────

function validarCIF(cif) {
  if (!cif || typeof cif !== 'string') return { valido: false, motivo: 'CIF vacio' };
  const c = cif.replace(/[\s.-]/g, '').toUpperCase();
  if (c.length < 5) return { valido: false, motivo: `CIF demasiado corto: ${c}` };

  // España: letra + 8 dígitos, o 8 dígitos + letra, o letra + 7 dígitos + letra
  if (/^[A-Z]\d{8}$/.test(c)) return { valido: true }; // CIF empresa
  if (/^\d{8}[A-Z]$/.test(c)) return { valido: true }; // NIF persona
  if (/^[KLMXYZ]\d{7}[A-Z]$/.test(c)) return { valido: true }; // NIE
  if (/^[A-Z]\d{7}[A-Z0-9]$/.test(c)) return { valido: true }; // CIF variantes

  // Prefijo ES (España VAT)
  if (/^ES[A-Z0-9]\d{7}[A-Z0-9]$/.test(c)) return { valido: true };

  // VAT europeo genérico: 2 letras + 2-13 alfanuméricos
  if (/^[A-Z]{2}[A-Z0-9]{2,13}$/.test(c)) return { valido: true };

  // Aceptar si tiene al menos letras y numeros mezclados (formato internacional)
  if (/[A-Z]/.test(c) && /\d/.test(c) && c.length >= 7) return { valido: true };

  return { valido: false, motivo: `Formato CIF no reconocido: ${c}` };
}

function validarCoherenciaImportes(datos) {
  const avisos = [];
  const total     = Number(datos.total_factura)  || 0;
  const sinIva    = Number(datos.total_sin_iva)  || 0;
  const totalIva  = Number(datos.total_iva)      || 0;
  const irpf      = Number(datos.irpf_cuota)     || 0;
  const iva = Array.isArray(datos.iva) ? datos.iva : [];

  if (total === 0) return avisos; // No validar facturas sin importe

  // Coherencia base + IVA - IRPF = total a pagar (tolerancia 0.05€).
  // total_factura es el "Total a pagar" neto, ya descontado IRPF (ver decision D1
  // sobre semantica de totalIncludingVat en el prompt Gemini). Si no hay IRPF,
  // la formula colapsa al chequeo clasico base + IVA = total.
  if (sinIva && totalIva) {
    const suma = round2(sinIva + totalIva - irpf);
    const diff = Math.abs(suma - Math.abs(total));
    if (diff > 0.05) {
      const detalle = irpf !== 0
        ? `Base (${sinIva}) + IVA (${totalIva}) - IRPF (${irpf}) = ${suma}, pero total es ${total} (diff: ${round2(diff)})`
        : `Base (${sinIva}) + IVA (${totalIva}) = ${suma}, pero total es ${total} (diff: ${round2(diff)})`;
      avisos.push(detalle);
    }
  }

  // Coherencia IVA desglosado vs totales
  if (iva.length > 0) {
    const sumaBase  = round2(iva.reduce((s, e) => s + (Number(e.base) || 0), 0));
    const sumaCuota = round2(iva.reduce((s, e) => s + (Number(e.cuota) || 0), 0));

    if (sinIva && Math.abs(sumaBase - sinIva) > 0.05) {
      avisos.push(`Suma bases IVA (${sumaBase}) != total_sin_iva (${sinIva})`);
    }
    if (totalIva && Math.abs(sumaCuota - totalIva) > 0.05) {
      avisos.push(`Suma cuotas IVA (${sumaCuota}) != total_iva (${totalIva})`);
    }

    // Verificar que cuota ≈ base × tipo/100 por cada línea
    for (const linea of iva) {
      const tipo = Number(linea.tipo) || 0;
      const base = Number(linea.base) || 0;
      const cuota = Number(linea.cuota) || 0;
      if (tipo > 0 && base > 0 && cuota > 0) {
        const esperado = round2(base * tipo / 100);
        if (Math.abs(esperado - cuota) > 0.10) {
          avisos.push(`IVA ${tipo}%: cuota ${cuota} esperada ${esperado} (base: ${base})`);
        }
      }
    }
  }

  return avisos;
}

function validarDatosExtraidos(datos) {
  const avisos = [];

  // Validar CIF emisor
  if (datos.cif_emisor) {
    const r = validarCIF(datos.cif_emisor);
    if (!r.valido) avisos.push(`CIF emisor: ${r.motivo}`);
  }

  // Validar CIF receptor
  if (datos.cif_receptor) {
    const r = validarCIF(datos.cif_receptor);
    if (!r.valido) avisos.push(`CIF receptor: ${r.motivo}`);
  }

  // Validar fecha (formato YYYY-MM-DD y rango razonable)
  if (datos.fecha_emision) {
    const d = new Date(datos.fecha_emision);
    if (isNaN(d.getTime())) {
      avisos.push(`Fecha emision invalida: ${datos.fecha_emision}`);
    } else {
      const year = d.getFullYear();
      if (year < 2000 || year > new Date().getFullYear() + 1) {
        avisos.push(`Fecha emision fuera de rango: ${datos.fecha_emision}`);
      }
    }
  }

  // Validar coherencia de importes
  avisos.push(...validarCoherenciaImportes(datos));

  return avisos;
}

function validarDatos(datos) {
  const faltantes = CAMPOS_CRITICOS.filter(c => datos[c] == null);
  // Ejecutar validaciones de calidad
  const avisos = validarDatosExtraidos(datos);
  if (avisos.length > 0) {
    datos._avisos_validacion = avisos;
  }
  return { valido: faltantes.length === 0, faltantes, avisos };
}

async function guardarResultado(id, estado, datos, error) {
  const db = getDb();

  // Sin datos (REVISION_MANUAL por fallo de extraccion): solo estado/error.
  if (!datos) {
    await db.query(
      `UPDATE drive_archivos
       SET estado = $1, datos_extraidos = NULL, error_extraccion = $2, procesado_at = NOW()
       WHERE id = $3`,
      [estado, error ?? null, id]
    );
    return;
  }

  // Fuente unica de verdad: los 5 campos de rectificativa (es_rectificativa + 4 rect_*)
  // y los 2 campos IRPF de factura (irpf_base, irpf_cuota) viven EXCLUSIVAMENTE como
  // columnas separadas de drive_archivos, nunca dentro del string JSON de
  // datos_extraidos. Asi las ediciones manuales desde la UI no divergen con lo que
  // extrajo Gemini en su dia.
  //
  // Los campos informativos IRPF que Gemini puede detectar (porcentaje, clave y
  // deducido_en_total) NO se persisten en columnas — el porcentaje y la clave los
  // toma siempre del proveedor (modelo "proveedor manda"). Pero quedan dentro de
  // datos_extraidos (JSONB) como informacion auxiliar para que la UI compare con
  // el proveedor y alerte si difiere (commit 4).
  //
  // COALESCE($n, columna): null de Gemini = "no detectado, respeta ediciones manuales
  // previas"; valor explicito (incluso false) = "sobrescribe el valor actual".
  const {
    es_rectificativa,
    rect_serie, rect_numero, rect_fecha, rect_base_imp,
    irpf_base, irpf_cuota,
    ...datosJson
  } = datos;

  // Heuristica de fallback: si Gemini no detecto explicitamente rectificativa (null)
  // o dijo false, pero la factura tiene total negativo, la marcamos como rectificativa.
  // Razon: abonos, notas de credito y rectificativas con IVA bien desglosado vienen
  // con signo negativo — cubrimos tambien los casos sin IVA desglosado. Los (pocos)
  // ajustes contables con total<0 que no son rectificativos los desmarca el usuario
  // desde la UI. Criterio coherente con el backfill retroactivo aplicado en dev
  // el 2026-04-24 (ver seccion "Heuristica es_rectificativa" en CLAUDE.md).
  //
  // Precedencia: Gemini true > heuristica true > Gemini false > Gemini null.
  // Nunca bajamos de true a false; solo elevamos null/false a true si total<0.
  let esRectFinal = es_rectificativa;
  if (esRectFinal !== true) {
    const total = Number(datosJson.total_factura);
    if (Number.isFinite(total) && total < 0) {
      esRectFinal = true;
    }
  }

  await db.query(
    `UPDATE drive_archivos
     SET estado           = $1,
         datos_extraidos  = $2,
         error_extraccion = $3,
         procesado_at     = NOW(),
         es_rectificativa = COALESCE($4, es_rectificativa),
         rect_serie       = COALESCE($5, rect_serie),
         rect_numero      = COALESCE($6, rect_numero),
         rect_fecha       = COALESCE($7::date, rect_fecha),
         rect_base_imp    = COALESCE($8, rect_base_imp),
         irpf_base        = COALESCE($9, irpf_base),
         irpf_cuota       = COALESCE($10, irpf_cuota)
     WHERE id = $11`,
    [
      estado,
      JSON.stringify(datosJson),
      error ?? null,
      esRectFinal ?? null,
      rect_serie ?? null,
      rect_numero ?? null,
      rect_fecha ?? null,
      rect_base_imp ?? null,
      irpf_base ?? null,
      irpf_cuota ?? null,
      id,
    ]
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

    const { valido, faltantes, avisos } = validarDatos(datos);
    const datosN = normalizarTotales(datos);

    if (!valido) {
      const motivo = `Campos criticos ausentes: ${faltantes.join(', ')}`;
      logger.info({ archivo: archivo.nombre_archivo, sizeKB, ms, motivo }, 'Gemini revision manual');
      await guardarResultado(archivo.id, 'REVISION_MANUAL', datosN, motivo);
      return { estado: 'REVISION_MANUAL', datos: datosN, error: motivo };
    }

    // Proveedores con múltiples facturas por PDF → revisión manual obligatoria
    const cifNorm = (datosN.cif_emisor || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (CIFS_MULTI_FACTURA.has(cifNorm)) {
      const motivo = `Proveedor multi-factura (${cifNorm}): este PDF puede contener varias facturas. Requiere revisión manual.`;
      logger.info({ archivo: archivo.nombre_archivo, sizeKB, ms, cif: cifNorm }, 'Multi-factura detectada, forzando revision manual');
      await guardarResultado(archivo.id, 'REVISION_MANUAL', datosN, motivo);
      return { estado: 'REVISION_MANUAL', datos: datosN, error: motivo };
    }

    if (avisos.length > 0) {
      logger.info({ archivo: archivo.nombre_archivo, sizeKB, ms, avisos: avisos.length, primerAviso: avisos[0] }, 'Gemini OK con avisos');
    } else {
      logger.info({ archivo: archivo.nombre_archivo, sizeKB, ms, factura: datos.numero_factura || '?' }, 'Gemini OK');
    }
    await guardarResultado(archivo.id, 'PROCESADA', datosN, avisos.length > 0 ? `Avisos: ${avisos.join(' | ')}` : null);
    return { estado: 'PROCESADA', datos: datosN };

  } catch (err) {
    const ms = Date.now() - t0;
    const motivo = err.message.slice(0, 300);
    logger.error({ archivo: archivo.nombre_archivo, ms, err }, 'Gemini error procesando archivo');
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

  logger.info({ total, modelo: process.env.GEMINI_MODEL || 'gemini-2.5-flash' }, 'Extraccion iniciando');
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
        logger.error({ archivo: archivo.nombre_archivo, err: r.reason }, 'Extraccion error en archivo');
        onProgress({ tipo: 'resultado', done, total, id: archivo.id, nombre: archivo.nombre_archivo, estado: 'REVISION_MANUAL', error: errMsg });
      }
    }

    // Log de progreso cada 10 lotes
    if (done % (CONCURRENCY * 10) < CONCURRENCY) {
      const elapsed = ((Date.now() - tInicio) / 1000).toFixed(0);
      logger.info({ done, total, procesada: resumen.procesada, revision: resumen.revision, error: resumen.error || 0, elapsed }, 'Extraccion progreso');
    }

    // Si hay muchos errores consecutivos (rate limit), esperar mas tiempo
    if (erroresConsecutivos >= 5) {
      logger.warn({ erroresConsecutivos }, 'Extraccion posible rate limit, esperando 10s');
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
  logger.info({ duracion: tTotal, procesada: resumen.procesada, revision: resumen.revision, error: resumen.error || 0, total }, 'Extraccion completada');
  onProgress({ tipo: 'fin', resumen, total });
  return resumen;
}

module.exports = {
  getPrompt, savePrompt, ensurePromptSeeded, resetPromptToDefault,
  PROMPT_DEFAULT, PROMPT_DEFAULT_V1, PROMPT_DEFAULT_V2, PROMPT_DEFAULT_V3_SIN_REGLAS,
  procesarArchivo, ejecutarExtraccion,
  buildGeminiModel, normalizarTotales, validarDatos, guardarResultado,
};
