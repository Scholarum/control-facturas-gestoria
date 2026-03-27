const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const router    = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin } = require('../middleware/auth');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(resolveUser);

// GET / - listar cuentas (con búsqueda opcional ?q= y filtro ?empresa=)
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { q, empresa } = req.query;
    const empresaId = parseInt(empresa, 10) || null;
    const filtroEmpresa = empresaId ? `AND (empresa_id = ${empresaId} OR empresa_id IS NULL)` : '';
    const rows = q
      ? await db.all(
          `SELECT * FROM plan_contable WHERE activo = true ${filtroEmpresa} AND (codigo ILIKE $1 OR descripcion ILIKE $1) ORDER BY codigo`,
          [`%${q}%`]
        )
      : await db.all(`SELECT * FROM plan_contable WHERE activo = true ${filtroEmpresa} ORDER BY codigo`);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[plan-contable] GET error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST / - añadir cuenta personalizada (solo admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { codigo, descripcion, grupo, empresa_id } = req.body;
    if (!codigo?.trim() || !descripcion?.trim()) {
      return res.status(400).json({ ok: false, error: 'codigo y descripcion requeridos' });
    }
    const db  = getDb();
    const row = await db.one(
      `INSERT INTO plan_contable (codigo, descripcion, grupo, empresa_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion, empresa_id = COALESCE(EXCLUDED.empresa_id, plan_contable.empresa_id), activo = true
       RETURNING *`,
      [codigo.trim(), descripcion.trim(), grupo?.trim() || codigo.trim().charAt(0), empresa_id || null]
    );
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[plan-contable] POST error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /importar — importacion masiva desde Excel para una empresa
router.post('/importar', requireAdmin, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'archivo requerido' });
  const empresaId = req.query.empresa ? parseInt(req.query.empresa, 10) : null;
  if (!empresaId) return res.status(400).json({ ok: false, error: 'empresa requerida (?empresa=ID)' });

  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws);

  if (!filas.length) return res.status(400).json({ ok: false, error: 'El archivo esta vacio' });

  const db = getDb();
  let insertadas = 0, actualizadas = 0;
  const errores = [];

  for (const [i, fila] of filas.entries()) {
    const codigo      = String(fila['Codigo'] || fila['codigo'] || fila['Código'] || '').trim();
    const descripcion = String(fila['Descripcion'] || fila['descripcion'] || fila['Descripción'] || fila['Titulo'] || '').trim();

    if (!codigo) { errores.push({ fila: i + 2, error: 'Codigo vacio' }); continue; }

    const grupo = codigo.charAt(0);
    try {
      const existe = await db.one('SELECT id FROM plan_contable WHERE codigo = $1', [codigo]);
      if (existe) {
        await db.query('UPDATE plan_contable SET descripcion = $1, empresa_id = $2, activo = true WHERE id = $3',
          [descripcion || codigo, empresaId, existe.id]);
        actualizadas++;
      } else {
        await db.query('INSERT INTO plan_contable (codigo, descripcion, grupo, empresa_id) VALUES ($1, $2, $3, $4)',
          [codigo, descripcion || codigo, grupo, empresaId]);
        insertadas++;
      }
    } catch (e) {
      errores.push({ fila: i + 2, error: e.message });
    }
  }

  res.json({ ok: true, data: { insertadas, actualizadas, errores } });
});

// POST /importar-pdf — extraer plan contable de PDF con Gemini
router.post('/importar-pdf', requireAdmin, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'archivo PDF requerido' });
  const empresaId = req.query.empresa ? parseInt(req.query.empresa, 10) : null;
  if (!empresaId) return res.status(400).json({ ok: false, error: 'empresa requerida (?empresa=ID)' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ ok: false, error: 'GEMINI_API_KEY no configurada' });

  // Timeout largo para PDFs grandes
  req.setTimeout(300000);
  if (res.setTimeout) res.setTimeout(300000);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
      { model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' },
      { apiVersion: 'v1' }
    );

    console.log(`[PlanContable] Enviando PDF a Gemini (${Math.round(req.file.size/1024)}KB)...`);

    const result = await model.generateContent([
      { inlineData: { mimeType: 'application/pdf', data: req.file.buffer.toString('base64') } },
      { text: `Analiza este documento de Plan General Contable y extrae TODAS las cuentas con su codigo y descripcion.

Devuelve UNICAMENTE un JSON sin texto adicional, sin markdown:
{
  "cuentas": [
    { "codigo": "40000001", "descripcion": "Nombre de la cuenta" }
  ]
}

Reglas:
- Incluye TODAS las cuentas que aparezcan, tanto principales (3-4 digitos) como subcuentas (5+ digitos).
- El codigo debe ser exactamente como aparece en el documento (con todos los digitos).
- La descripcion debe ser el nombre completo de la cuenta.
- No inventes cuentas que no aparezcan en el documento.
- Responde SOLO con el JSON.` },
    ]);

    let texto = result.response.text().trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();

    const parsed = JSON.parse(texto);
    const cuentas = parsed.cuentas || [];
    console.log(`[PlanContable] Gemini extrajo ${cuentas.length} cuentas`);

    if (!cuentas.length) {
      return res.status(422).json({ ok: false, error: 'Gemini no encontro cuentas en el PDF' });
    }

    // Insertar en DB
    const db = getDb();
    let insertadas = 0, actualizadas = 0;
    for (const c of cuentas) {
      const codigo = String(c.codigo || '').trim();
      const descripcion = String(c.descripcion || '').trim();
      if (!codigo) continue;
      const grupo = codigo.charAt(0);
      try {
        const existe = await db.one('SELECT id FROM plan_contable WHERE codigo = $1', [codigo]);
        if (existe) {
          await db.query('UPDATE plan_contable SET descripcion = $1, empresa_id = $2, activo = true WHERE id = $3',
            [descripcion || codigo, empresaId, existe.id]);
          actualizadas++;
        } else {
          await db.query('INSERT INTO plan_contable (codigo, descripcion, grupo, empresa_id) VALUES ($1, $2, $3, $4)',
            [codigo, descripcion || codigo, grupo, empresaId]);
          insertadas++;
        }
      } catch {}
    }

    console.log(`[PlanContable] Importadas: ${insertadas} nuevas, ${actualizadas} actualizadas`);
    res.json({ ok: true, data: { insertadas, actualizadas, total_extraidas: cuentas.length } });
  } catch (e) {
    console.error('[PlanContable] Error Gemini:', e.message);
    res.status(500).json({ ok: false, error: `Error procesando PDF: ${e.message.slice(0, 200)}` });
  }
});

// GET /plantilla — descargar plantilla Excel para importacion
router.get('/plantilla', async (req, res) => {
  const filas = [
    { Codigo: '40000001', Descripcion: 'Proveedor Ejemplo SL' },
    { Codigo: '47200021', Descripcion: 'H.P. IVA Soportado 21%' },
    { Codigo: '62300001', Descripcion: 'Servicios profesionales' },
  ];
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Plan Contable');
  ws['!cols'] = [{ wch: 15 }, { wch: 40 }];
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="plantilla-plan-contable.xlsx"',
    'Content-Length': buffer.length,
  });
  res.send(buffer);
});

// DELETE /:id - eliminar subcuenta (solo si es subcuenta y no está en uso)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const cuenta = await db.one('SELECT * FROM plan_contable WHERE id = $1', [id]);
    if (!cuenta) return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });

    // Solo permitir eliminar subcuentas (codigo > 4 dígitos)
    if (cuenta.codigo.length <= 4) {
      return res.status(400).json({ ok: false, error: 'No se pueden eliminar cuentas principales del plan contable' });
    }

    // Verificar que no esté en uso
    const enUso = await db.one(
      `SELECT EXISTS(
        SELECT 1 FROM proveedores WHERE cuenta_contable_id = $1 OR cuenta_gasto_id = $1
      ) OR EXISTS(
        SELECT 1 FROM drive_archivos WHERE cuenta_gasto_id = $1
      ) AS en_uso`,
      [id]
    );
    if (enUso?.en_uso) {
      return res.status(400).json({ ok: false, error: 'La cuenta esta en uso por proveedores o facturas' });
    }

    await db.query('DELETE FROM plan_contable WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
