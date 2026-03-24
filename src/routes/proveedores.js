const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const router    = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Validación básica CIF/NIF/NIE español
function validarCIF(cif) {
  if (!cif) return true;
  const c = cif.trim().toUpperCase().replace(/[\s.\-]/g, '');
  if (/^\d{8}[A-Z]$/.test(c))                              return true; // NIF
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(c))       return true; // CIF empresa
  if (/^[XYZ]\d{7}[A-Z]$/.test(c))                         return true; // NIE
  return false;
}

function labelProveedor(p) {
  if (p.razon_social && p.nombre_carpeta && p.razon_social !== p.nombre_carpeta) {
    return `${p.razon_social} (${p.nombre_carpeta})`;
  }
  return p.razon_social || p.nombre_carpeta || '';
}

const SELECT_FULL = `
  SELECT p.*,
         pc.codigo      AS cuenta_contable_codigo,
         pc.descripcion AS cuenta_contable_desc,
         pg.codigo      AS cuenta_gasto_codigo,
         pg.descripcion AS cuenta_gasto_desc
  FROM proveedores p
  LEFT JOIN plan_contable pc ON pc.id = p.cuenta_contable_id
  LEFT JOIN plan_contable pg ON pg.id = p.cuenta_gasto_id
`;

router.use(resolveUser);

// GET /selector - lista enriquecida para dropdowns (Drive + tabla proveedores)
router.get('/selector', async (req, res) => {
  const db   = getDb();
  const rows = await db.all(`
    SELECT DISTINCT
      da.proveedor                               AS nombre_carpeta,
      COALESCE(p.razon_social, da.proveedor)     AS razon_social
    FROM drive_archivos da
    LEFT JOIN proveedores p
           ON p.nombre_carpeta = da.proveedor AND p.activo = true
    WHERE da.proveedor IS NOT NULL
    ORDER BY 2
  `);
  res.json({
    ok: true,
    data: rows.map(r => ({
      nombre_carpeta: r.nombre_carpeta,
      label: r.razon_social && r.razon_social !== r.nombre_carpeta
        ? `${r.razon_social} (${r.nombre_carpeta})`
        : r.nombre_carpeta,
    })),
  });
});

// POST /autodetectar - detecta proveedores por CIF, crea los nuevos y devuelve todos sin cuentas
router.post('/autodetectar', async (req, res) => {
  try {
    const db = getDb();

    // Recopilar CIFs únicos de facturas procesadas
    const archivos = await db.all(
      `SELECT datos_extraidos FROM drive_archivos
       WHERE datos_extraidos IS NOT NULL AND estado = 'COMPLETADO'`
    );

    const cifMap = new Map(); // cif -> nombre_emisor
    for (const a of archivos) {
      try {
        const d = JSON.parse(a.datos_extraidos);
        const cif = d.cif_emisor?.trim().toUpperCase();
        if (cif && !cifMap.has(cif)) {
          cifMap.set(cif, d.nombre_emisor?.trim() || cif);
        }
      } catch {}
    }

    if (cifMap.size === 0) {
      const sinCuentas = await db.all(
        `SELECT id, razon_social, cif, nombre_carpeta FROM proveedores
         WHERE activo = true AND cuenta_contable_id IS NULL ORDER BY razon_social`
      );
      return res.json({ ok: true, data: { creados: 0, sinCuentas } });
    }

    // Obtener CIFs ya registrados
    const existentes = await db.all(
      'SELECT cif FROM proveedores WHERE activo = true AND cif IS NOT NULL'
    );
    const cifExistentes = new Set(existentes.map(p => p.cif.trim().toUpperCase()));

    // Crear los que faltan
    let creados = 0;
    for (const [cif, nombre] of cifMap) {
      if (!cifExistentes.has(cif)) {
        await db.query(
          'INSERT INTO proveedores (razon_social, cif) VALUES ($1, $2)',
          [nombre, cif]
        );
        creados++;
      }
    }

    // Devolver todos los proveedores sin cuentas contables
    const sinCuentas = await db.all(
      `SELECT id, razon_social, cif, nombre_carpeta FROM proveedores
       WHERE activo = true AND cuenta_contable_id IS NULL ORDER BY razon_social`
    );

    res.json({ ok: true, data: { creados, sinCuentas } });
  } catch (err) {
    console.error('[proveedores] autodetectar error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET / - listar todos los proveedores registrados
router.get('/', async (req, res) => {
  const db   = getDb();
  const rows = await db.all(`${SELECT_FULL} WHERE p.activo = true ORDER BY p.razon_social`);
  res.json({ ok: true, data: rows.map(r => ({ ...r, label: labelProveedor(r) })) });
});

// POST / - crear proveedor
router.post('/', requireAdmin, async (req, res) => {
  const { razon_social, nombre_carpeta, cif, cuenta_contable_id, cuenta_gasto_id } = req.body;
  if (!razon_social?.trim()) return res.status(400).json({ ok: false, error: 'razon_social requerida' });
  if (cif && !validarCIF(cif)) return res.status(400).json({ ok: false, error: 'Formato CIF/NIF inválido' });
  const db  = getDb();
  const row = await db.one(
    `INSERT INTO proveedores (razon_social, nombre_carpeta, cif, cuenta_contable_id, cuenta_gasto_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [
      razon_social.trim(),
      nombre_carpeta?.trim() || null,
      cif ? cif.trim().toUpperCase() : null,
      cuenta_contable_id || null,
      cuenta_gasto_id    || null,
    ]
  );
  res.json({ ok: true, data: { ...row, label: labelProveedor(row) } });
});

// PUT /:id - actualizar proveedor
router.put('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { razon_social, nombre_carpeta, cif, cuenta_contable_id, cuenta_gasto_id } = req.body;
  if (!razon_social?.trim()) return res.status(400).json({ ok: false, error: 'razon_social requerida' });
  if (cif && !validarCIF(cif)) return res.status(400).json({ ok: false, error: 'Formato CIF/NIF inválido' });
  const db  = getDb();
  const row = await db.one(
    `UPDATE proveedores
     SET razon_social = $1, nombre_carpeta = $2, cif = $3,
         cuenta_contable_id = $4, cuenta_gasto_id = $5, updated_at = NOW()
     WHERE id = $6 AND activo = true RETURNING *`,
    [
      razon_social.trim(),
      nombre_carpeta?.trim() || null,
      cif ? cif.trim().toUpperCase() : null,
      cuenta_contable_id || null,
      cuenta_gasto_id    || null,
      id,
    ]
  );
  if (!row) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
  res.json({ ok: true, data: { ...row, label: labelProveedor(row) } });
});

// DELETE /:id - desactivar proveedor
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db  = getDb();
  await db.query('UPDATE proveedores SET activo = false, updated_at = NOW() WHERE id = $1', [id]);
  res.json({ ok: true });
});

// GET /excel - exportar a Excel
router.get('/excel', async (req, res) => {
  const db   = getDb();
  const rows = await db.all(`${SELECT_FULL} WHERE p.activo = true ORDER BY p.razon_social`);

  const filas = rows.map(r => ({
    'Razón Social':                r.razon_social,
    'Nombre Carpeta':              r.nombre_carpeta              || '',
    'CIF':                         r.cif                         || '',
    'Código Cuenta Contable':      r.cuenta_contable_codigo      || '',
    'Descripción Cuenta Contable': r.cuenta_contable_desc        || '',
    'Código Cuenta Gasto':         r.cuenta_gasto_codigo         || '',
    'Descripción Cuenta Gasto':    r.cuenta_gasto_desc           || '',
  }));

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  ws['!cols'] = [
    { wch: 30 }, { wch: 25 }, { wch: 14 },
    { wch: 22 }, { wch: 40 }, { wch: 22 }, { wch: 40 },
  ];

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fecha  = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="proveedores-${fecha}.xlsx"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// POST /importar - importación masiva desde Excel
router.post('/importar', requireAdmin, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'archivo requerido' });

  const wb    = XLSX.read(req.file.buffer, { type: 'buffer' });
  const ws    = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws);

  if (!filas.length) return res.status(400).json({ ok: false, error: 'El archivo está vacío' });

  const db     = getDb();
  const cuentas = await db.all('SELECT id, codigo FROM plan_contable WHERE activo = true');
  const cuentasMap = {};
  for (const c of cuentas) cuentasMap[c.codigo.trim()] = c.id;

  let insertados = 0, actualizados = 0;
  const errores = [];

  for (const [i, fila] of filas.entries()) {
    const razon_social   = String(fila['Razón Social']   || fila['Razon Social']   || '').trim();
    const nombre_carpeta = String(fila['Nombre Carpeta'] || '').trim() || null;
    const cif            = String(fila['CIF']            || '').trim().toUpperCase() || null;
    const codContable    = String(fila['Código Cuenta Contable'] || fila['Codigo Cuenta Contable'] || '').trim();
    const codGasto       = String(fila['Código Cuenta Gasto']    || fila['Codigo Cuenta Gasto']    || '').trim();

    if (!razon_social) { errores.push({ fila: i + 2, error: 'Razón Social vacía' }); continue; }
    if (cif && !validarCIF(cif)) { errores.push({ fila: i + 2, error: `CIF inválido: ${cif}` }); continue; }

    const cuenta_contable_id = codContable ? (cuentasMap[codContable] ?? null) : null;
    const cuenta_gasto_id    = codGasto    ? (cuentasMap[codGasto]    ?? null) : null;

    const existing = cif
      ? await db.one('SELECT id FROM proveedores WHERE cif = $1', [cif])
      : await db.one('SELECT id FROM proveedores WHERE razon_social = $1', [razon_social]);

    if (existing) {
      await db.query(
        `UPDATE proveedores SET razon_social=$1, nombre_carpeta=$2, cif=$3,
         cuenta_contable_id=$4, cuenta_gasto_id=$5, activo=true, updated_at=NOW()
         WHERE id=$6`,
        [razon_social, nombre_carpeta, cif, cuenta_contable_id, cuenta_gasto_id, existing.id]
      );
      actualizados++;
    } else {
      await db.query(
        `INSERT INTO proveedores (razon_social, nombre_carpeta, cif, cuenta_contable_id, cuenta_gasto_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [razon_social, nombre_carpeta, cif, cuenta_contable_id, cuenta_gasto_id]
      );
      insertados++;
    }
  }

  res.json({ ok: true, data: { insertados, actualizados, errores } });
});

module.exports = router;
