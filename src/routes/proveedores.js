const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const router    = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin, requireAuth } = require('../middleware/auth');

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

// Auto-transicionar facturas PENDIENTE → CC_ASIGNADA si el proveedor tiene cuenta de gasto Y cuenta contable
async function autoAsignarFacturasProveedor(db, proveedor) {
  if (!proveedor.cuenta_gasto_id || !proveedor.cuenta_contable_id) return;
  try {
    await db.query(`
      UPDATE drive_archivos da
      SET estado_gestion = 'CC_ASIGNADA'
      WHERE da.estado_gestion = 'PENDIENTE'
        AND da.estado = 'PROCESADA'
        AND (
          da.proveedor = $1
          OR (
            $2::text IS NOT NULL
            AND da.datos_extraidos IS NOT NULL
            AND da.datos_extraidos ~ '^\\s*\\{'
            AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif($2::text)
          )
        )`,
      [proveedor.nombre_carpeta || '', proveedor.cif || null]
    );
  } catch (e) {
    console.error('[Proveedores] Error auto-asignando facturas:', e.message);
  }
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

    // Crear proveedores nuevos en una sola query SQL (sin parseo JS)
    await db.query(`
      INSERT INTO proveedores (razon_social, cif)
      SELECT DISTINCT ON (normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor'))
             COALESCE(NULLIF(TRIM((da.datos_extraidos::jsonb)->>'nombre_emisor'), ''), 'Sin nombre'),
             UPPER(TRIM((da.datos_extraidos::jsonb)->>'cif_emisor'))
      FROM drive_archivos da
      WHERE da.datos_extraidos IS NOT NULL
        AND da.datos_extraidos ~ '^\\s*\\{'
        AND (da.datos_extraidos::jsonb)->>'cif_emisor' IS NOT NULL
        AND TRIM((da.datos_extraidos::jsonb)->>'cif_emisor') <> ''
        AND NOT EXISTS (
          SELECT 1 FROM proveedores p
          WHERE p.activo = true
            AND normalizar_cif(p.cif) = normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor')
        )
      ON CONFLICT DO NOTHING
    `);

    const sinCuentas = await db.all(
      `SELECT id, razon_social, cif, nombre_carpeta FROM proveedores
       WHERE activo = true AND cuenta_contable_id IS NULL ORDER BY razon_social`
    );

    res.json({ ok: true, data: { creados: 0, sinCuentas } });
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
  await autoAsignarFacturasProveedor(db, row);
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
  await autoAsignarFacturasProveedor(db, row);
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

// GET /plantilla-importacion - descargar plantilla Excel de ejemplo
router.get('/plantilla-importacion', async (req, res) => {
  const filas = [
    { 'Razon Social': 'EMPRESA EJEMPLO SL', 'CIF': 'B12345678', 'Cuenta Contable': '40000001', 'Nombre Carpeta': '', 'Cuenta Gasto': '' },
    { 'Razon Social': 'SERVICIOS DEMO SA',  'CIF': 'A87654321', 'Cuenta Contable': '40000002', 'Nombre Carpeta': 'SERVICIOS DEMO', 'Cuenta Gasto': '62300001' },
  ];
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  ws['!cols'] = [{ wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 25 }, { wch: 18 }];
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="plantilla-proveedores.xlsx"',
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// POST /importar - importacion masiva desde Excel
router.post('/importar', requireAdmin, upload.single('archivo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'archivo requerido' });

  const wb    = XLSX.read(req.file.buffer, { type: 'buffer' });
  const ws    = wb.Sheets[wb.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(ws);

  if (!filas.length) return res.status(400).json({ ok: false, error: 'El archivo esta vacio' });

  const db     = getDb();
  const cuentas = await db.all('SELECT id, codigo FROM plan_contable WHERE activo = true');
  const cuentasMap = {};
  for (const c of cuentas) cuentasMap[c.codigo.trim()] = c.id;

  let insertados = 0, actualizados = 0, cuentasCreadas = 0;
  const errores = [];

  for (const [i, fila] of filas.entries()) {
    const razon_social   = String(fila['Razon Social']   || fila['Razón Social']   || '').trim();
    const nombre_carpeta = String(fila['Nombre Carpeta'] || '').trim() || null;
    const cif            = String(fila['CIF']            || '').trim().toUpperCase() || null;
    const codContable    = String(fila['Cuenta Contable'] || fila['Código Cuenta Contable'] || fila['Codigo Cuenta Contable'] || '').trim();
    const codGasto       = String(fila['Cuenta Gasto']    || fila['Código Cuenta Gasto']    || fila['Codigo Cuenta Gasto']    || '').trim();

    if (!razon_social) { errores.push({ fila: i + 2, error: 'Razon Social vacia' }); continue; }
    if (cif && !validarCIF(cif)) { errores.push({ fila: i + 2, error: `CIF invalido: ${cif}` }); continue; }

    // Resolver cuenta contable: buscar existente o crear si no existe
    let cuenta_contable_id = codContable ? (cuentasMap[codContable] ?? null) : null;
    if (codContable && !cuenta_contable_id) {
      try {
        const grupo = codContable.charAt(0);
        const row = await db.one(
          `INSERT INTO plan_contable (codigo, descripcion, grupo)
           VALUES ($1, $2, $3)
           ON CONFLICT (codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion, activo = true
           RETURNING id`,
          [codContable, razon_social, grupo]
        );
        cuenta_contable_id = row.id;
        cuentasMap[codContable] = row.id;
        cuentasCreadas++;
      } catch (e) {
        errores.push({ fila: i + 2, error: `Error creando cuenta ${codContable}: ${e.message}` });
      }
    }

    // Resolver cuenta de gasto: buscar existente o crear
    let cuenta_gasto_id = codGasto ? (cuentasMap[codGasto] ?? null) : null;
    if (codGasto && !cuenta_gasto_id) {
      try {
        const grupo = codGasto.charAt(0);
        const row = await db.one(
          `INSERT INTO plan_contable (codigo, descripcion, grupo)
           VALUES ($1, $2, $3)
           ON CONFLICT (codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion, activo = true
           RETURNING id`,
          [codGasto, razon_social, grupo]
        );
        cuenta_gasto_id = row.id;
        cuentasMap[codGasto] = row.id;
        cuentasCreadas++;
      } catch (e) {
        errores.push({ fila: i + 2, error: `Error creando cuenta ${codGasto}: ${e.message}` });
      }
    }

    const existing = cif
      ? await db.one('SELECT id FROM proveedores WHERE cif = $1', [cif])
      : await db.one('SELECT id FROM proveedores WHERE razon_social = $1', [razon_social]);

    if (existing) {
      await db.query(
        `UPDATE proveedores SET razon_social=$1, nombre_carpeta=COALESCE($2, nombre_carpeta), cif=$3,
         cuenta_contable_id=COALESCE($4, cuenta_contable_id), cuenta_gasto_id=COALESCE($5, cuenta_gasto_id),
         activo=true, updated_at=NOW()
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

  // Rellenar nombre_carpeta desde Drive para proveedores sin carpeta pero con CIF coincidente
  try {
    await db.query(`
      UPDATE proveedores p
      SET nombre_carpeta = sub.proveedor, updated_at = NOW()
      FROM (
        SELECT DISTINCT da.proveedor,
               normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') AS cif_norm
        FROM drive_archivos da
        WHERE da.proveedor IS NOT NULL
          AND da.datos_extraidos IS NOT NULL
          AND da.datos_extraidos ~ '^\\s*\\{'
          AND (da.datos_extraidos::jsonb)->>'cif_emisor' IS NOT NULL
      ) sub
      WHERE p.nombre_carpeta IS NULL
        AND p.cif IS NOT NULL
        AND normalizar_cif(p.cif) = sub.cif_norm
    `);
  } catch (e) {
    console.error('[Proveedores] Error rellenando nombre_carpeta desde Drive:', e.message);
  }

  // Auto-asignar facturas para los proveedores importados
  const provsActualizados = await db.all('SELECT * FROM proveedores WHERE activo = true AND cuenta_gasto_id IS NOT NULL AND cuenta_contable_id IS NOT NULL');
  for (const prov of provsActualizados) {
    await autoAsignarFacturasProveedor(db, prov);
  }

  res.json({ ok: true, data: { insertados, actualizados, cuentasCreadas, errores } });
});

// ─── PUT /:id/cuenta-contable — asignar cuenta contable (admin + gestoría) ──

router.put('/:id/cuenta-contable', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { cuenta_contable_id } = req.body;
  if (!cuenta_contable_id) return res.status(400).json({ ok: false, error: 'cuenta_contable_id requerida' });

  const db  = getDb();
  const row = await db.one(
    `UPDATE proveedores SET cuenta_contable_id = $1, updated_at = NOW()
     WHERE id = $2 AND activo = true RETURNING *`,
    [parseInt(cuenta_contable_id, 10), id]
  );
  if (!row) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });
  await autoAsignarFacturasProveedor(db, row);
  res.json({ ok: true, data: row });
});

// ─── POST /rapido — crear proveedor al vuelo (admin + gestoría) ─────────────

router.post('/rapido', requireAuth, async (req, res) => {
  const { razon_social, cif, nombre_carpeta, cuenta_contable_id, cuenta_gasto_id } = req.body;
  if (!razon_social?.trim()) return res.status(400).json({ ok: false, error: 'razon_social requerida' });
  if (cif && !validarCIF(cif)) return res.status(400).json({ ok: false, error: 'Formato CIF/NIF invalido' });

  const db = getDb();
  // Comprobar si ya existe por CIF
  if (cif) {
    const existe = await db.one(
      "SELECT id FROM proveedores WHERE UPPER(TRIM(cif)) = $1 AND activo = true",
      [cif.trim().toUpperCase()]
    );
    if (existe) return res.status(409).json({ ok: false, error: 'Ya existe un proveedor con ese CIF', data: existe });
  }

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
  await autoAsignarFacturasProveedor(db, row);
  res.json({ ok: true, data: row });
});

module.exports = router;
