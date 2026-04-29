const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const router    = express.Router();
const { getDb } = require('../config/database');
const logger    = require('../config/logger');
const { resolveUser, requireAdmin, requireAuth } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Validacion de CIF/NIF/NIE español + VAT numbers europeos e internacionales
function validarCIF(cif) {
  if (!cif) return true;
  const c = cif.trim().toUpperCase().replace(/[\s.\-/]/g, '');
  if (c.length < 5) return false; // demasiado corto para ser valido

  // España: NIF, CIF, NIE
  if (/^\d{8}[A-Z]$/.test(c))                              return true;
  if (/^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(c))       return true;
  if (/^[XYZ]\d{7}[A-Z]$/.test(c))                         return true;

  // VAT europeo con prefijo de pais (2 letras + alfanumerico)
  // AT: ATU12345678              BE: BE0123456789
  // DE: DE123456789              FR: FRXX123456789
  // GB: GB123456789              IT: IT12345678901
  // NL: NL123456789B01           PT: PT123456789
  // Otros: prefijo 2 letras + 5-15 caracteres alfanumericos
  if (/^[A-Z]{2}[A-Z0-9]{5,15}$/.test(c)) return true;

  // Sin prefijo de pais: alfanumerico de 5-15 caracteres (CIF extranjero limpio)
  if (/^[A-Z0-9]{5,15}$/.test(c)) return true;

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
    logger.error({ err: e }, 'Proveedores error auto-asignando facturas');
  }
}

function selectProveedores(empresaId) {
  if (empresaId) {
    return `
      SELECT p.*,
             pe.cuenta_contable_id, pe.cuenta_gasto_id, pe.ultimo_asiento_sage,
             pc.codigo      AS cuenta_contable_codigo,
             pc.descripcion AS cuenta_contable_desc,
             pg.codigo      AS cuenta_gasto_codigo,
             pg.descripcion AS cuenta_gasto_desc
      FROM proveedores p
      LEFT JOIN proveedor_empresa pe ON pe.proveedor_id = p.id AND pe.empresa_id = ${parseInt(empresaId, 10)}
      LEFT JOIN plan_contable pc ON pc.id = pe.cuenta_contable_id
      LEFT JOIN plan_contable pg ON pg.id = pe.cuenta_gasto_id
    `;
  }
  return `
    SELECT p.*,
           pc.codigo      AS cuenta_contable_codigo,
           pc.descripcion AS cuenta_contable_desc,
           pg.codigo      AS cuenta_gasto_codigo,
           pg.descripcion AS cuenta_gasto_desc
    FROM proveedores p
    LEFT JOIN plan_contable pc ON pc.id = p.cuenta_contable_id
    LEFT JOIN plan_contable pg ON pg.id = p.cuenta_gasto_id
  `;
}
// Mantener compatibilidad
const SELECT_FULL = selectProveedores(null);

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

// POST /autodetectar - devuelve proveedores sin cuentas (ya no crea automaticamente)
router.post('/autodetectar', async (req, res) => {
  try {
    const db = getDb();
    const sinCuentas = await db.all(
      `SELECT id, razon_social, cif, nombre_carpeta FROM proveedores
       WHERE activo = true AND cuenta_contable_id IS NULL ORDER BY razon_social`
    );
    res.json({ ok: true, data: { creados: 0, sinCuentas } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET / - listar proveedores (con cuentas de la empresa si se pasa ?empresa=)
router.get('/', async (req, res) => {
  const db = getDb();
  const empresaId = req.query.empresa ? parseInt(req.query.empresa, 10) : null;
  const sql = selectProveedores(empresaId);
  const rows = await db.all(`${sql} WHERE p.activo = true ORDER BY p.razon_social`);
  res.json({ ok: true, data: rows.map(r => ({ ...r, label: labelProveedor(r) })) });
});

// Validacion ligera de campos SII: entero >= 0 o undefined.
function parseSiiEntero(val) {
  if (val === undefined || val === null || val === '') return undefined;
  const n = Number(val);
  if (!Number.isInteger(n) || n < 0) return NaN;
  return n;
}

// Columnas SII parametrizables por proveedor (mismo patron para los 6). El orden
// aqui tambien define el orden que aparece en las cabeceras del Excel de export.
const CAMPOS_SII_PROVEEDOR = ['sii_tipo_clave', 'sii_tipo_fact', 'sii_tipo_exenci', 'sii_tipo_no_suje', 'sii_tipo_rectif', 'sii_entr_prest'];

// Columnas IRPF de proveedor — modelo "proveedor manda".
const CAMPOS_IRPF_PROVEEDOR = ['aplica_irpf', 'irpf_porcentaje', 'irpf_clave', 'irpf_subcuenta'];

// Parsea los 6 campos SII del body y devuelve {values, error}. values[c] puede ser:
//   number  → valor explicito a insertar/actualizar
//   undefined → no viene en el body, mantener default/valor actual en BD.
function parseCamposSiiBody(body) {
  const values = {};
  for (const c of CAMPOS_SII_PROVEEDOR) {
    const v = parseSiiEntero(body[c]);
    if (Number.isNaN(v)) return { error: `${c} debe ser entero >= 0` };
    values[c] = v;
  }
  return { values };
}

// Normaliza booleanos del body que pueden llegar como bool o string ("true"/"false")
// desde Excel/JSON-multipart. Devuelve true|false|null si no es interpretable.
function parseBooleano(val) {
  if (val === true || val === 'true'  || val === 'TRUE'  || val === 1) return true;
  if (val === false || val === 'false' || val === 'FALSE' || val === 0) return false;
  return null;
}

// Parsea los 4 campos IRPF del body con la siguiente semantica:
//   - 'aplica_irpf' ausente del body → ignora los 4; ningun campo IRPF se toca (return {values: {}}).
//   - 'aplica_irpf' = false → fuerza los 3 restantes a NULL (limpieza al desmarcar).
//   - 'aplica_irpf' = true  → exige los 3 restantes informados y validos. La subcuenta
//     se valida contra plan_contable (debe existir y empezar por '4751'). Asincrono.
//
// Convencion de cliente: el modal proveedor y la edicion inline mandan SIEMPRE los 4
// campos juntos. Edicion parcial de un solo campo IRPF sin 'aplica_irpf' = no-op.
//
// Devuelve {values, error}. values mapea cada columna a su valor a persistir o
// undefined si no se debe tocar.
async function parseCamposIrpfBody(body, db) {
  if (!('aplica_irpf' in body)) {
    return { values: {} };
  }
  const aplica = parseBooleano(body.aplica_irpf);
  if (aplica === null) return { error: 'aplica_irpf debe ser true o false' };

  if (aplica === false) {
    return { values: { aplica_irpf: false, irpf_porcentaje: null, irpf_clave: null, irpf_subcuenta: null } };
  }

  // aplica = true: exigir los 3 informados.
  const pct = body.irpf_porcentaje;
  if (pct === undefined || pct === null || pct === '') return { error: 'irpf_porcentaje requerido cuando aplica_irpf=true' };
  const pctN = Number(pct);
  if (!Number.isFinite(pctN) || pctN < 0 || pctN > 100) return { error: 'irpf_porcentaje debe ser numero entre 0 y 100' };

  const claveRaw = body.irpf_clave;
  if (claveRaw === undefined || claveRaw === null || claveRaw === '') return { error: 'irpf_clave requerida cuando aplica_irpf=true' };
  const claveN = Number(claveRaw);
  if (!Number.isInteger(claveN) || claveN < 1 || claveN > 11) return { error: 'irpf_clave debe ser entero entre 1 y 11' };

  const sub = String(body.irpf_subcuenta || '').trim();
  if (!sub) return { error: 'irpf_subcuenta requerida cuando aplica_irpf=true' };
  if (!/^4751\d*$/.test(sub)) return { error: `irpf_subcuenta debe empezar por '4751': ${sub}` };
  const fila = await db.one(
    `SELECT codigo FROM plan_contable WHERE codigo = $1 AND activo = true LIMIT 1`,
    [sub]
  );
  if (!fila) return { error: `subcuenta IRPF '${sub}' no existe en plan contable. Crea la subcuenta antes de asignarla al proveedor.` };

  return {
    values: {
      aplica_irpf:     true,
      irpf_porcentaje: pctN,
      irpf_clave:      claveN,
      irpf_subcuenta:  sub,
    },
  };
}

// POST / - crear proveedor
router.post('/', requireAdmin, async (req, res) => {
  const { razon_social, nombre_carpeta, cif, cuenta_contable_id, cuenta_gasto_id, empresa_id } = req.body;
  if (!razon_social?.trim()) return res.status(400).json({ ok: false, error: 'razon_social requerida' });
  if (cif && !validarCIF(cif)) return res.status(400).json({ ok: false, error: 'Formato CIF/NIF invalido' });

  const { values: sii, error: siiErr } = parseCamposSiiBody(req.body);
  if (siiErr) return res.status(400).json({ ok: false, error: siiErr });

  const db  = getDb();
  const { values: irpf, error: irpfErr } = await parseCamposIrpfBody(req.body, db);
  if (irpfErr) return res.status(400).json({ ok: false, error: irpfErr });

  if (nombre_carpeta?.trim()) {
    const dup = await db.one('SELECT id FROM proveedores WHERE nombre_carpeta = $1 AND activo = true', [nombre_carpeta.trim()]);
    if (dup) return res.status(409).json({ ok: false, error: `La carpeta "${nombre_carpeta.trim()}" ya esta asignada a otro proveedor` });
  }
  // Si el body trae campos SII se insertan explicitos; si no, la tabla aplica el DEFAULT correspondiente.
  const cols = ['razon_social', 'nombre_carpeta', 'cif'];
  const vals = [razon_social.trim(), nombre_carpeta?.trim() || null, cif ? cif.trim().toUpperCase() : null];
  for (const c of CAMPOS_SII_PROVEEDOR) {
    if (sii[c] !== undefined) { cols.push(c); vals.push(sii[c]); }
  }
  // Campos IRPF: si parseCamposIrpfBody devolvio values vacio, no se incluye ninguno
  // (aplica_irpf cae en su DEFAULT FALSE y los otros 3 quedan NULL). Si devolvio
  // aplica_irpf=true, los 4 vienen ya validados (subcuenta existe y empieza por 4751).
  for (const c of CAMPOS_IRPF_PROVEEDOR) {
    if (irpf[c] !== undefined) { cols.push(c); vals.push(irpf[c]); }
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const row = await db.one(
    `INSERT INTO proveedores (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  // Guardar cuentas en proveedor_empresa si se pasan
  const empId = empresa_id || (await db.one('SELECT id FROM empresas WHERE activo = true ORDER BY id LIMIT 1'))?.id;
  if (empId && (cuenta_contable_id || cuenta_gasto_id)) {
    await db.query(
      `INSERT INTO proveedor_empresa (proveedor_id, empresa_id, cuenta_contable_id, cuenta_gasto_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (proveedor_id, empresa_id) DO UPDATE SET
         cuenta_contable_id = COALESCE(EXCLUDED.cuenta_contable_id, proveedor_empresa.cuenta_contable_id),
         cuenta_gasto_id = COALESCE(EXCLUDED.cuenta_gasto_id, proveedor_empresa.cuenta_gasto_id)`,
      [row.id, empId, cuenta_contable_id || null, cuenta_gasto_id || null]
    );
  }
  res.json({ ok: true, data: { ...row, label: labelProveedor(row) } });
});

// PUT /:id - actualizar proveedor
router.put('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const b  = req.body;

  // Edicion parcial: validamos y actualizamos solo los campos presentes en el body.
  // Clave de deteccion uniforme: `'campo' in b` (no depender de destructuring ni de
  // undefined vs null) — ver convencion "UPDATE dinamico" en CLAUDE.md.
  if ('razon_social' in b && !b.razon_social?.trim()) {
    return res.status(400).json({ ok: false, error: 'razon_social no puede estar vacia' });
  }
  if ('cif' in b && b.cif && !validarCIF(b.cif)) {
    return res.status(400).json({ ok: false, error: 'Formato CIF/NIF invalido' });
  }

  // Solo validamos los campos SII que vienen realmente en el body (edicion parcial).
  const siiPresentes = CAMPOS_SII_PROVEEDOR.filter(c => c in b);
  const siiParsed = {};
  for (const c of siiPresentes) {
    const v = parseSiiEntero(b[c]);
    if (Number.isNaN(v)) return res.status(400).json({ ok: false, error: `${c} debe ser entero >= 0` });
    siiParsed[c] = v;
  }

  const db = getDb();
  const { values: irpfParsed, error: irpfErr } = await parseCamposIrpfBody(b, db);
  if (irpfErr) return res.status(400).json({ ok: false, error: irpfErr });

  if ('nombre_carpeta' in b && b.nombre_carpeta?.trim()) {
    const dup = await db.one('SELECT id FROM proveedores WHERE nombre_carpeta = $1 AND activo = true AND id <> $2', [b.nombre_carpeta.trim(), id]);
    if (dup) return res.status(409).json({ ok: false, error: `La carpeta "${b.nombre_carpeta.trim()}" ya esta asignada a otro proveedor` });
  }

  // UPDATE dinamico: SET solo para columnas presentes en el body. Asi la edicion
  // parcial (p.ej. editar solo CIF inline) no pisa con NULL los demas campos.
  // SII de proveedor es NOT NULL; si viene null explicito (siiParsed[c] === undefined
  // tras pasar por parseSiiEntero) lo ignoramos en el UPDATE.
  // IRPF: parseCamposIrpfBody devuelve {} si no viene aplica_irpf en el body; si viene
  // false fuerza los 3 restantes a NULL; si viene true los 4 ya estan validados.
  const sets = [];
  const vals = [];
  if ('razon_social'   in b) { sets.push(`razon_social   = $${vals.length + 1}`); vals.push(b.razon_social.trim()); }
  if ('nombre_carpeta' in b) { sets.push(`nombre_carpeta = $${vals.length + 1}`); vals.push(b.nombre_carpeta?.trim() || null); }
  if ('cif'            in b) { sets.push(`cif            = $${vals.length + 1}`); vals.push(b.cif ? b.cif.trim().toUpperCase() : null); }
  for (const c of siiPresentes) {
    if (siiParsed[c] !== undefined) { sets.push(`${c} = $${vals.length + 1}`); vals.push(siiParsed[c]); }
  }
  for (const c of CAMPOS_IRPF_PROVEEDOR) {
    if (c in irpfParsed) { sets.push(`${c} = $${vals.length + 1}`); vals.push(irpfParsed[c]); }
  }
  sets.push(`updated_at = NOW()`);
  vals.push(id);

  const row = await db.one(
    `UPDATE proveedores SET ${sets.join(', ')} WHERE id = $${vals.length} AND activo = true RETURNING *`,
    vals
  );
  if (!row) return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' });

  // Cuentas en proveedor_empresa: solo se tocan si el body las incluye (flujo del Modal).
  const { cuenta_contable_id, cuenta_gasto_id, empresa_id } = b;
  const empId = empresa_id || (await db.one('SELECT id FROM empresas WHERE activo = true ORDER BY id LIMIT 1'))?.id;
  if (empId && (cuenta_contable_id || cuenta_gasto_id)) {
    await db.query(
      `INSERT INTO proveedor_empresa (proveedor_id, empresa_id, cuenta_contable_id, cuenta_gasto_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (proveedor_id, empresa_id) DO UPDATE SET
         cuenta_contable_id = COALESCE(EXCLUDED.cuenta_contable_id, proveedor_empresa.cuenta_contable_id),
         cuenta_gasto_id = COALESCE(EXCLUDED.cuenta_gasto_id, proveedor_empresa.cuenta_gasto_id)`,
      [id, empId, cuenta_contable_id || null, cuenta_gasto_id || null]
    );
  }
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

// GET /excel - exportar a Excel. Acepta ?ids=1,2,3 para exportar solo los proveedores filtrados.
router.get('/excel', async (req, res) => {
  const db = getDb();
  const idsParam = String(req.query.ids || '').trim();
  const ids = idsParam
    ? idsParam.split(',').map(s => parseInt(s, 10)).filter(n => Number.isInteger(n) && n > 0)
    : null;

  const rows = ids && ids.length
    ? await db.all(`${SELECT_FULL} WHERE p.id = ANY($1::int[]) AND p.activo = true ORDER BY p.razon_social`, [ids])
    : await db.all(`${SELECT_FULL} WHERE p.activo = true ORDER BY p.razon_social`);

  const filas = rows.map(r => ({
    'ID (no modificar)':           r.id,
    'Razón Social':                r.razon_social,
    'Nombre Carpeta':              r.nombre_carpeta              || '',
    'CIF':                         r.cif                         || '',
    'Código Cuenta Contable':      r.cuenta_contable_codigo      || '',
    'Descripción Cuenta Contable': r.cuenta_contable_desc        || '',
    'Código Cuenta Gasto':         r.cuenta_gasto_codigo         || '',
    'Descripción Cuenta Gasto':    r.cuenta_gasto_desc           || '',
    'Clave SII':                   r.sii_tipo_clave   ?? 1,
    'Tipo Factura SII':            r.sii_tipo_fact    ?? 1,
    'Tipo Exencion SII':           r.sii_tipo_exenci  ?? 1,
    'Tipo No Sujeta SII':          r.sii_tipo_no_suje ?? 1,
    'Tipo Rectificativa SII':      r.sii_tipo_rectif  ?? 2,
    'Entrega/Prestacion SII':      r.sii_entr_prest   ?? 1,
  }));

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  ws['!cols'] = [
    { wch: 10 },
    { wch: 30 }, { wch: 25 }, { wch: 14 },
    { wch: 22 }, { wch: 40 }, { wch: 22 }, { wch: 40 },
    { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 22 },
  ];

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fecha  = new Date().toISOString().slice(0, 10);
  const filename = ids && ids.length
    ? `proveedores-filtrados-${fecha}-${rows.length}reg.xlsx`
    : `proveedores-${fecha}.xlsx`;
  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// GET /plantilla-importacion - descargar plantilla Excel de ejemplo
router.get('/plantilla-importacion', async (req, res) => {
  const filas = [
    { 'ID (no modificar)': '', 'Razon Social': 'EMPRESA EJEMPLO SL', 'CIF': 'B12345678', 'Cuenta Contable': '40000001', 'Nombre Carpeta': '', 'Cuenta Gasto': '', 'Clave SII': 1, 'Tipo Factura SII': 1, 'Tipo Exencion SII': 1, 'Tipo No Sujeta SII': 2, 'Tipo Rectificativa SII': 2, 'Entrega/Prestacion SII': 3 },
    { 'ID (no modificar)': '', 'Razon Social': 'SERVICIOS DEMO SA',  'CIF': 'A87654321', 'Cuenta Contable': '40000002', 'Nombre Carpeta': 'SERVICIOS DEMO', 'Cuenta Gasto': '62300001', 'Clave SII': 1, 'Tipo Factura SII': 1, 'Tipo Exencion SII': 1, 'Tipo No Sujeta SII': 2, 'Tipo Rectificativa SII': 2, 'Entrega/Prestacion SII': 3 },
  ];
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proveedores');
  ws['!cols'] = [{ wch: 10 }, { wch: 30 }, { wch: 14 }, { wch: 18 }, { wch: 25 }, { wch: 18 }, { wch: 10 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 22 }];
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
    const idRaw          = fila['ID (no modificar)'] ?? fila['ID'] ?? fila['id'];
    const idNum          = idRaw === undefined || idRaw === null || idRaw === '' ? null
                         : (Number.isInteger(Number(idRaw)) && Number(idRaw) > 0 ? Number(idRaw) : NaN);
    const razon_social   = String(fila['Razon Social']   || fila['Razón Social']   || '').trim();
    const nombre_carpeta = String(fila['Nombre Carpeta'] || '').trim() || null;
    const cif            = String(fila['CIF']            || '').trim().toUpperCase() || null;
    const codContable    = String(fila['Cuenta Contable'] || fila['Código Cuenta Contable'] || fila['Codigo Cuenta Contable'] || '').trim();
    const codGasto       = String(fila['Cuenta Gasto']    || fila['Código Cuenta Gasto']    || fila['Codigo Cuenta Gasto']    || '').trim();

    // Lectura de los 6 campos SII con cabeceras Excel flexibles (con/sin tilde).
    const SII_HEADERS = {
      sii_tipo_clave:   ['Clave SII'],
      sii_tipo_fact:    ['Tipo Factura SII'],
      sii_tipo_exenci:  ['Tipo Exencion SII', 'Tipo Exención SII'],
      sii_tipo_no_suje: ['Tipo No Sujeta SII'],
      sii_tipo_rectif:  ['Tipo Rectificativa SII'],
      sii_entr_prest:   ['Entrega/Prestacion SII', 'Entrega/Prestación SII'],
    };
    const sii = {};
    let siiError = null;
    for (const col of CAMPOS_SII_PROVEEDOR) {
      let raw;
      for (const h of SII_HEADERS[col]) if (h in fila) { raw = fila[h]; break; }
      if (raw === undefined || raw === '') { sii[col] = undefined; continue; }
      const v = parseSiiEntero(raw);
      if (Number.isNaN(v)) { siiError = `${col} invalido: ${raw}`; break; }
      sii[col] = v;
    }

    if (Number.isNaN(idNum)) { errores.push({ fila: i + 2, error: `ID invalido: ${idRaw}` }); continue; }
    if (!razon_social) { errores.push({ fila: i + 2, error: 'Razon Social vacia' }); continue; }
    if (cif && !validarCIF(cif)) { errores.push({ fila: i + 2, error: `CIF invalido: ${cif}` }); continue; }
    if (siiError) { errores.push({ fila: i + 2, error: siiError }); continue; }

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

    // Matching endurecido: ID (clave unica) -> CIF -> razon social.
    // Si viene ID pero no existe en BD, descartamos la fila (nunca crea duplicados por
    // copy/paste accidental del Excel). Si no viene ID, caemos a CIF y luego a razon social.
    let existing = null;
    if (idNum !== null) {
      existing = await db.one('SELECT id FROM proveedores WHERE id = $1', [idNum]);
      if (!existing) { errores.push({ fila: i + 2, error: `ID ${idNum} no encontrado` }); continue; }
    } else if (cif) {
      existing = await db.one('SELECT id FROM proveedores WHERE cif = $1', [cif]);
    } else {
      existing = await db.one('SELECT id FROM proveedores WHERE razon_social = $1', [razon_social]);
    }

    let provId;
    if (existing) {
      // UPDATE dinamico con COALESCE en SII: si la celda viene vacia (sii[c] === undefined),
      // se pasa NULL y COALESCE mantiene el valor actual en BD.
      const sets = ['razon_social=$1', 'nombre_carpeta=COALESCE($2, nombre_carpeta)', 'cif=$3'];
      const params = [razon_social, nombre_carpeta, cif];
      for (const c of CAMPOS_SII_PROVEEDOR) {
        sets.push(`${c}=COALESCE($${params.length + 1}, ${c})`);
        params.push(sii[c] ?? null);
      }
      sets.push('activo=true', 'updated_at=NOW()');
      params.push(existing.id);
      await db.query(`UPDATE proveedores SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
      provId = existing.id;
      actualizados++;
    } else {
      // En INSERT, si no viene el campo se omite y la tabla aplica el DEFAULT correspondiente.
      const cols = ['razon_social', 'nombre_carpeta', 'cif'];
      const vals = [razon_social, nombre_carpeta, cif];
      for (const c of CAMPOS_SII_PROVEEDOR) {
        if (sii[c] !== undefined) { cols.push(c); vals.push(sii[c]); }
      }
      const placeholders = vals.map((_, k) => `$${k + 1}`).join(', ');
      const newRow = await db.one(
        `INSERT INTO proveedores (${cols.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        vals
      );
      provId = newRow.id;
      insertados++;
    }

    // Guardar cuentas en proveedor_empresa para la empresa del query param
    const empId = req.query.empresa ? parseInt(req.query.empresa, 10) : (await db.one('SELECT id FROM empresas WHERE activo = true ORDER BY id LIMIT 1'))?.id;
    if (empId && (cuenta_contable_id || cuenta_gasto_id)) {
      await db.query(
        `INSERT INTO proveedor_empresa (proveedor_id, empresa_id, cuenta_contable_id, cuenta_gasto_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (proveedor_id, empresa_id) DO UPDATE SET
           cuenta_contable_id = COALESCE(EXCLUDED.cuenta_contable_id, proveedor_empresa.cuenta_contable_id),
           cuenta_gasto_id = COALESCE(EXCLUDED.cuenta_gasto_id, proveedor_empresa.cuenta_gasto_id)`,
        [provId, empId, cuenta_contable_id || null, cuenta_gasto_id || null]
      );
    }
  }

  res.json({ ok: true, data: { insertados, actualizados, cuentasCreadas, errores } });
});

// ─── PUT /:id/cuentas-empresa — asignar cuentas para una empresa (admin + gestoria) ──

router.put('/:id/cuentas-empresa', requireAuth, express.json(), async (req, res) => {
  const proveedorId = parseInt(req.params.id, 10);
  const { empresa_id } = req.body;
  if (!empresa_id) return res.status(400).json({ ok: false, error: 'empresa_id requerido' });

  const db = getDb();
  // Permitir null explícito para desvincular cuentas
  const ccId = 'cuenta_contable_id' in req.body ? (req.body.cuenta_contable_id ?? null) : undefined;
  const cgId = 'cuenta_gasto_id' in req.body ? (req.body.cuenta_gasto_id ?? null) : undefined;

  // Upsert: campos no enviados mantienen su valor actual
  const ccSet = ccId !== undefined ? 'EXCLUDED.cuenta_contable_id' : 'proveedor_empresa.cuenta_contable_id';
  const cgSet = cgId !== undefined ? 'EXCLUDED.cuenta_gasto_id' : 'proveedor_empresa.cuenta_gasto_id';

  await db.query(
    `INSERT INTO proveedor_empresa (proveedor_id, empresa_id, cuenta_contable_id, cuenta_gasto_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (proveedor_id, empresa_id) DO UPDATE SET
       cuenta_contable_id = ${ccSet},
       cuenta_gasto_id    = ${cgSet}`,
    [proveedorId, parseInt(empresa_id, 10), ccId ?? null, cgId ?? null]
  );
  res.json({ ok: true });
});

// ─── PUT /:id/cuenta-contable — legacy, redirige a cuentas-empresa ──

router.put('/:id/cuenta-contable', requireAuth, express.json(), async (req, res) => {
  const proveedorId = parseInt(req.params.id, 10);
  const { cuenta_contable_id, empresa_id } = req.body;
  if (!cuenta_contable_id) return res.status(400).json({ ok: false, error: 'cuenta_contable_id requerida' });

  const db = getDb();
  const empId = empresa_id || (await db.one('SELECT id FROM empresas WHERE activo = true ORDER BY id LIMIT 1'))?.id;
  if (!empId) return res.status(400).json({ ok: false, error: 'No hay empresas configuradas' });

  await db.query(
    `INSERT INTO proveedor_empresa (proveedor_id, empresa_id, cuenta_contable_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (proveedor_id, empresa_id) DO UPDATE SET cuenta_contable_id = EXCLUDED.cuenta_contable_id`,
    [proveedorId, empId, parseInt(cuenta_contable_id, 10)]
  );
  res.json({ ok: true });
});

// ─── POST /rapido — crear proveedor al vuelo (admin + gestoría) ─────────────

router.post('/rapido', requireAuth, async (req, res) => {
  const { razon_social, cif, nombre_carpeta, cuenta_contable_id, cuenta_gasto_id, empresa_id } = req.body;
  if (!razon_social?.trim()) return res.status(400).json({ ok: false, error: 'razon_social requerida' });
  if (cif && !validarCIF(cif)) return res.status(400).json({ ok: false, error: 'Formato CIF/NIF invalido' });

  const { values: sii, error: siiErr } = parseCamposSiiBody(req.body);
  if (siiErr) return res.status(400).json({ ok: false, error: siiErr });

  const db = getDb();
  if (cif) {
    const existe = await db.one(
      "SELECT id FROM proveedores WHERE UPPER(TRIM(cif)) = $1 AND activo = true",
      [cif.trim().toUpperCase()]
    );
    if (existe) return res.status(409).json({ ok: false, error: 'Ya existe un proveedor con ese CIF', data: existe });
  }
  if (nombre_carpeta?.trim()) {
    const dup = await db.one('SELECT id FROM proveedores WHERE nombre_carpeta = $1 AND activo = true', [nombre_carpeta.trim()]);
    if (dup) return res.status(409).json({ ok: false, error: `La carpeta "${nombre_carpeta.trim()}" ya esta asignada a otro proveedor` });
  }

  const cols = ['razon_social', 'nombre_carpeta', 'cif'];
  const vals = [razon_social.trim(), nombre_carpeta?.trim() || null, cif ? cif.trim().toUpperCase() : null];
  for (const c of CAMPOS_SII_PROVEEDOR) {
    if (sii[c] !== undefined) { cols.push(c); vals.push(sii[c]); }
  }
  const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
  const row = await db.one(
    `INSERT INTO proveedores (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
    vals
  );
  // Guardar cuentas en proveedor_empresa
  const empId = empresa_id || (await db.one('SELECT id FROM empresas WHERE activo = true ORDER BY id LIMIT 1'))?.id;
  if (empId && (cuenta_contable_id || cuenta_gasto_id)) {
    await db.query(
      `INSERT INTO proveedor_empresa (proveedor_id, empresa_id, cuenta_contable_id, cuenta_gasto_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (proveedor_id, empresa_id) DO UPDATE SET
         cuenta_contable_id = COALESCE(EXCLUDED.cuenta_contable_id, proveedor_empresa.cuenta_contable_id),
         cuenta_gasto_id = COALESCE(EXCLUDED.cuenta_gasto_id, proveedor_empresa.cuenta_gasto_id)`,
      [row.id, empId, cuenta_contable_id || null, cuenta_gasto_id || null]
    );
  }
  res.json({ ok: true, data: row });
});

module.exports = router;
