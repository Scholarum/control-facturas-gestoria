/**
 * sageParser.js
 * Convierte un archivo de Mayor SAGE (Excel, CSV o PDF) en un array de entradas:
 * [{ numero_factura, fecha (YYYY-MM-DD), importe (decimal) }]
 *
 * Usa Gemini para la extracción inteligente, lo que hace el parser robusto
 * frente a cualquier variante de exportación de SAGE.
 */
const XLSX                    = require('xlsx');
const { GoogleGenerativeAI }  = require('@google/generative-ai');

const PROMPT_SAGE = `
Eres un experto en contabilidad española y en el software SAGE.
Analiza el siguiente contenido de un Mayor de SAGE (libro mayor de proveedor) y extrae TODAS las entradas que correspondan a facturas de compra/proveedor.

Devuelve ÚNICAMENTE este JSON sin texto adicional, sin markdown:
{
  "entradas": [
    {
      "numero_factura": "referencia o número de la factura tal como aparece",
      "fecha": "YYYY-MM-DD",
      "importe": 1234.56
    }
  ]
}

Reglas estrictas:
- Incluye SOLO asientos que sean facturas o albaranes de proveedor. Excluye pagos, transferencias y asientos de apertura/cierre.
- Los importes del Mayor SAGE suelen estar en formato europeo (1.234,56 €). Conviértelos a decimal puro: 1234.56
- En el Mayor de proveedores, el importe de la factura suele estar en la columna "Haber". Usa ese valor.
- Los abonos o facturas rectificativas pueden tener importe negativo.
- Fechas siempre en YYYY-MM-DD. Si el año tiene 2 dígitos, asume 20XX.
- Si un campo no existe, usa null.
- Responde SOLO con el JSON.
`.trim();

function buildModel() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI.getGenerativeModel(
    { model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
    { apiVersion: 'v1' }
  );
}

function limpiarJson(texto) {
  return texto
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

function normalizarFecha(str) {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  const d = new Date(str);
  return isNaN(d.getTime()) ? str : d.toISOString().slice(0, 10);
}

async function parsearConGeminiTexto(texto) {
  const model = buildModel();
  const result = await model.generateContent([
    { text: PROMPT_SAGE },
    { text: texto },
  ]);
  const raw = limpiarJson(result.response.text());
  const { entradas } = JSON.parse(raw);
  return normalizarEntradas(entradas);
}

async function parsearConGeminiPdf(buffer) {
  const model = buildModel();
  const result = await model.generateContent([
    { inlineData: { mimeType: 'application/pdf', data: buffer.toString('base64') } },
    { text: PROMPT_SAGE },
  ]);
  const raw = limpiarJson(result.response.text());
  const { entradas } = JSON.parse(raw);
  return normalizarEntradas(entradas);
}

function normalizarEntradas(entradas) {
  return (entradas || [])
    .filter(e => e.numero_factura || e.importe)
    .map(e => ({
      numero_factura: String(e.numero_factura || '').trim(),
      fecha:          normalizarFecha(e.fecha),
      importe:        parseFloat(e.importe) || 0,
    }));
}

/**
 * Entrada principal: recibe el buffer del archivo, su mimetype y nombre.
 * Devuelve array de entradas SAGE normalizadas.
 */
async function parsearSage(buffer, mimetype, filename) {
  const ext = filename.toLowerCase().split('.').pop();

  if (ext === 'pdf' || mimetype === 'application/pdf') {
    return parsearConGeminiPdf(buffer);
  }

  // Excel → convertir a CSV y enviar a Gemini como texto
  if (ext === 'xlsx' || ext === 'xls' || mimetype.includes('sheet') || mimetype.includes('excel')) {
    const wb  = XLSX.read(buffer, { type: 'buffer' });
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const csv = XLSX.utils.sheet_to_csv(ws);
    return parsearConGeminiTexto(csv);
  }

  // CSV / TXT → enviar directamente a Gemini
  const texto = buffer.toString('utf8');
  return parsearConGeminiTexto(texto);
}

module.exports = { parsearSage };
