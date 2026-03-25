const express = require('express');
const JSZip   = require('jszip');
const XLSX    = require('xlsx');
const router  = express.Router();

const { getDb }                     = require('../config/database');
const { registrarEvento, EVENTOS }  = require('../services/auditService');
const { buildDriveClient }          = require('../services/driveService');
const { resolveUser, requireAdmin, requireAuth } = require('../middleware/auth');

function parsearArchivo(a) {
  const datos = a.datos_extraidos ? JSON.parse(a.datos_extraidos) : null;
  return { ...a, datos_extraidos: datos };
}

const CAMPOS_OBLIGATORIOS = [
  'numero_factura', 'fecha_emision', 'nombre_emisor', 'cif_emisor',
  'nombre_receptor', 'cif_receptor', 'total_factura',
];

// Condición SQL para verificar incidencia de datos (campos obligatorios vacíos)
function tieneIncidenciaSQL(alias) {
  const a = alias;
  return `(
    ${a}.datos_extraidos IS NULL
    OR NOT (${a}.datos_extraidos ~ '^\\s*\\{')
    OR (${a}.datos_extraidos::jsonb)->>'numero_factura' IS NULL OR TRIM((${a}.datos_extraidos::jsonb)->>'numero_factura') = ''
    OR (${a}.datos_extraidos::jsonb)->>'fecha_emision' IS NULL OR TRIM((${a}.datos_extraidos::jsonb)->>'fecha_emision') = ''
    OR (${a}.datos_extraidos::jsonb)->>'nombre_emisor' IS NULL OR TRIM((${a}.datos_extraidos::jsonb)->>'nombre_emisor') = ''
    OR (${a}.datos_extraidos::jsonb)->>'cif_emisor' IS NULL OR TRIM((${a}.datos_extraidos::jsonb)->>'cif_emisor') = ''
    OR (${a}.datos_extraidos::jsonb)->>'nombre_receptor' IS NULL OR TRIM((${a}.datos_extraidos::jsonb)->>'nombre_receptor') = ''
    OR (${a}.datos_extraidos::jsonb)->>'cif_receptor' IS NULL OR TRIM((${a}.datos_extraidos::jsonb)->>'cif_receptor') = ''
    OR (${a}.datos_extraidos::jsonb)->>'total_factura' IS NULL
  )`;
}

function tieneIncidencia(datos) {
  if (!datos) return true;
  const d = typeof datos === 'string' ? JSON.parse(datos) : datos;
  for (const c of CAMPOS_OBLIGATORIOS) {
    if (d[c] == null || d[c] === '') return true;
  }
  const iva = Array.isArray(d.iva) ? d.iva : [];
  if (!iva.some(e => e.base > 0 || e.cuota > 0)) return true;
  return false;
}

router.use(resolveUser);

// ─── GET /api/drive ───────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const db = getDb();
  const archivos = await db.all(`
    SELECT
      da.id, da.google_id, da.nombre_archivo, da.ruta_completa,
      da.proveedor, da.fecha_subida, da.estado, da.estado_gestion,
      da.datos_extraidos, da.error_extraccion, da.procesado_at, da.ultima_sync,
      da.lote_a3_id,
      p.id                                                        AS proveedor_id,
      p.razon_social,
      p.cif                                                       AS proveedor_cif,
      da.cuenta_gasto_id                                          AS cg_manual_id,
      COALESCE(da.cuenta_gasto_id, p.cuenta_gasto_id)             AS cg_efectiva_id,
      COALESCE(cgd.codigo,  pg.codigo)                            AS cuenta_gasto_codigo,
      COALESCE(cgd.descripcion, pg.descripcion)                   AS cuenta_gasto_desc,
      cc.codigo                                                   AS cta_proveedor_codigo,
      la.nombre_fichero                                           AS lote_a3_nombre,
      la.fecha                                                    AS lote_a3_fecha
    FROM drive_archivos da
    LEFT JOIN LATERAL (
      SELECT p2.*
      FROM proveedores p2
      WHERE p2.activo = true
        AND (
          (
            p2.cif IS NOT NULL
            AND da.datos_extraidos IS NOT NULL
            AND da.datos_extraidos ~ '^\\s*\\{'
            AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)
          )
          OR p2.nombre_carpeta = da.proveedor
        )
      ORDER BY (p2.cif IS NOT NULL
                AND da.datos_extraidos IS NOT NULL
                AND da.datos_extraidos ~ '^\\s*\\{'
                AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)
               ) DESC NULLS LAST
      LIMIT 1
    ) p ON true
    LEFT JOIN plan_contable pg  ON pg.id  = p.cuenta_gasto_id
    LEFT JOIN plan_contable cgd ON cgd.id = da.cuenta_gasto_id
    LEFT JOIN plan_contable cc  ON cc.id  = p.cuenta_contable_id
    LEFT JOIN lotes_exportacion_a3 la ON la.id = da.lote_a3_id
    ORDER BY da.id DESC
  `);
  res.json({ ok: true, data: archivos.map(parsearArchivo) });
});

// ─── GET /api/drive/proveedores ───────────────────────────────────────────────

router.get('/proveedores', async (req, res) => {
  const db   = getDb();
  const rows = await db.all(
    "SELECT DISTINCT proveedor FROM drive_archivos WHERE proveedor IS NOT NULL ORDER BY proveedor"
  );
  res.json({ ok: true, data: rows.map(r => r.proveedor) });
});

// ─── POST /api/drive/descargar-zip ────────────────────────────────────────────

router.post('/descargar-zip', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db       = getDb();
  const archivos = await db.all(
    'SELECT * FROM drive_archivos WHERE id = ANY($1::int[])',
    [ids]
  );

  if (!archivos.length) return res.status(404).json({ ok: false, error: 'Archivos no encontrados' });

  let drive;
  try { drive = await buildDriveClient(); }
  catch (e) { return res.status(500).json({ ok: false, error: 'Error conectando con Drive' }); }

  const zip      = new JSZip();
  const fallidos = [];

  for (const archivo of archivos) {
    try {
      const resp = await drive.files.get(
        { fileId: archivo.google_id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      zip.file(archivo.nombre_archivo, Buffer.from(resp.data));
    } catch (err) {
      fallidos.push({ id: archivo.id, nombre: archivo.nombre_archivo, error: err.message });
    }
  }

  if (fallidos.length) zip.file('_errores.json', JSON.stringify(fallidos, null, 2));

  // Los admins no modifican el estado al descargar
  const esAdmin = req.usuario?.rol === 'ADMIN';
  if (!esAdmin) {
    // Solo transicionar a DESCARGADA las que no tienen incidencia de datos ni de proveedor
    const idsCandidatos = archivos
      .filter(a => a.estado_gestion !== 'CONTABILIZADA' && !tieneIncidencia(a.datos_extraidos))
      .map(a => a.id);
    if (idsCandidatos.length) {
      await db.query(
        `UPDATE drive_archivos da SET estado_gestion = 'DESCARGADA'
         WHERE da.id = ANY($1::int[])
           AND EXISTS (
             SELECT 1 FROM proveedores p
             WHERE p.activo = true AND p.cuenta_contable_id IS NOT NULL
               AND (
                 (p.cif IS NOT NULL AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
                  AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p.cif))
                 OR p.nombre_carpeta = da.proveedor
               )
           )`,
        [idsCandidatos]
      );
    }
  }

  const usuarioId = req.usuario?.id ?? null;
  for (const archivo of archivos) {
    registrarEvento({
      evento:    EVENTOS.DOWNLOAD,
      usuarioId,
      ip:        req.clientIp,
      userAgent: req.userAgent,
      detalle:   {
        drive_id:      archivo.id,
        nombre:        archivo.nombre_archivo,
        proveedor:     archivo.proveedor,
        estado_previo: archivo.estado_gestion,
        google_id:     archivo.google_id,
      },
    }).catch(e => console.error('[audit]', e.message));
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const fecha  = new Date().toISOString().slice(0, 10);

  res.set({
    'Content-Type':        'application/zip',
    'Content-Disposition': `attachment; filename="facturas-${fecha}.zip"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// ─── PUT /api/drive/contabilizar ──────────────────────────────────────────────

router.put('/contabilizar', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db        = getDb();
  const usuarioId = req.usuario?.id ?? null;

  const archivos = await db.all(
    `SELECT da.id, da.nombre_archivo, da.proveedor,
            COALESCE(da.cuenta_gasto_id, p.cuenta_gasto_id) AS cg_efectiva_id
     FROM drive_archivos da
     LEFT JOIN LATERAL (
       SELECT p2.cuenta_gasto_id FROM proveedores p2
       WHERE p2.activo = true
         AND (
           (
             p2.cif IS NOT NULL
             AND da.datos_extraidos IS NOT NULL
             AND da.datos_extraidos ~ '^\\s*\\{'
             AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)
           )
           OR p2.nombre_carpeta = da.proveedor
         )
       ORDER BY (p2.cif IS NOT NULL
                 AND da.datos_extraidos IS NOT NULL
                 AND da.datos_extraidos ~ '^\\s*\\{'
                 AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)
                ) DESC NULLS LAST
       LIMIT 1
     ) p ON true
     WHERE da.id = ANY($1::int[])`,
    [ids]
  );

  const sinCG = archivos.filter(a => !a.cg_efectiva_id);
  if (sinCG.length > 0) {
    return res.status(400).json({
      ok: false,
      error: `${sinCG.length} factura(s) no tienen cuenta de gasto asignada`,
      ids_sin_cg: sinCG.map(a => a.id),
    });
  }

  await db.query(
    "UPDATE drive_archivos SET estado_gestion='CONTABILIZADA' WHERE id = ANY($1::int[])",
    [ids]
  );

  if (archivos.length > 0) {
    registrarEvento({
      evento:    EVENTOS.CONTABILIZAR_MASIVO,
      usuarioId,
      ip:        req.clientIp,
      userAgent: req.userAgent,
      detalle:   { count: archivos.length, facturas: archivos },
    }).catch(e => console.error('[audit]', e.message));
  }

  res.json({ ok: true, data: { contabilizadas: archivos.length } });
});

// ─── PUT /api/drive/cg-masivo — asignar Cta. Gasto a varias facturas ──────────

router.put('/cg-masivo', express.json(), async (req, res) => {
  const { ids, cuenta_gasto_id } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db   = getDb();
  const cgId = cuenta_gasto_id ? parseInt(cuenta_gasto_id, 10) : null;

  const archivos = await db.all(
    'SELECT id, estado_gestion FROM drive_archivos WHERE id = ANY($1::int[])',
    [ids]
  );
  const contabilizadas = archivos.filter(a => a.estado_gestion === 'CONTABILIZADA');
  if (contabilizadas.length > 0) {
    return res.status(400).json({
      ok:    false,
      error: `${contabilizadas.length} factura(s) ya están contabilizadas`,
      ids:   contabilizadas.map(a => a.id),
    });
  }

  const nuevoEstado = cgId ? 'CC_ASIGNADA' : 'PENDIENTE';
  await db.query(
    `UPDATE drive_archivos SET cuenta_gasto_id = $1, estado_gestion = $2
     WHERE id = ANY($3::int[]) AND estado_gestion != 'CONTABILIZADA'`,
    [cgId, nuevoEstado, ids]
  );

  res.json({ ok: true, data: { actualizadas: ids.length, cg_efectiva_id: cgId, estado_gestion: nuevoEstado } });
});

// ─── GET /api/drive/:id/stream — proxy PDF para vista previa ─────────────────

router.get('/:id/stream', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const archivo = await db.one('SELECT google_id, nombre_archivo FROM drive_archivos WHERE id = $1', [id]);
  if (!archivo) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });

  let drive;
  try { drive = await buildDriveClient(); }
  catch (e) { return res.status(500).json({ ok: false, error: 'Error conectando con Drive' }); }

  try {
    const resp = await drive.files.get(
      { fileId: archivo.google_id, alt: 'media' },
      { responseType: 'stream' }
    );
    const ext = (archivo.nombre_archivo || '').split('.').pop().toLowerCase();
    const ct  = ext === 'pdf'
      ? 'application/pdf'
      : (resp.headers['content-type'] || 'application/octet-stream');
    res.set('Content-Type', ct);
    res.set('Content-Disposition', 'inline');
    resp.data.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── PUT /api/drive/:id/cg — asignar cuenta de gasto ────────────────────────

router.put('/:id/cg', express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { cuenta_gasto_id } = req.body;
  const cgId = cuenta_gasto_id ? parseInt(cuenta_gasto_id, 10) : null;

  const db = getDb();
  const archivo = await db.one(`
    SELECT da.estado_gestion, da.datos_extraidos, p.id AS proveedor_id, cc.codigo AS cta_proveedor_codigo
    FROM drive_archivos da
    LEFT JOIN LATERAL (
      SELECT p2.* FROM proveedores p2
      WHERE p2.activo = true AND (
        (p2.cif IS NOT NULL AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
         AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif))
        OR p2.nombre_carpeta = da.proveedor
      )
      ORDER BY (p2.cif IS NOT NULL AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
               AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)) DESC NULLS LAST
      LIMIT 1
    ) p ON true
    LEFT JOIN plan_contable cc ON cc.id = p.cuenta_contable_id
    WHERE da.id = $1`, [id]);
  if (!archivo) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });
  if (archivo.estado_gestion === 'CONTABILIZADA')
    return res.status(400).json({ ok: false, error: 'No se puede modificar una factura contabilizada' });

  let nuevoEstado = archivo.estado_gestion || 'PENDIENTE';
  if (cgId) {
    // Solo transicionar a CC_ASIGNADA si no hay incidencias de datos NI de proveedor
    const datosOk      = !tieneIncidencia(archivo.datos_extraidos);
    const proveedorOk  = !!archivo.proveedor_id && !!archivo.cta_proveedor_codigo;
    if (datosOk && proveedorOk && nuevoEstado !== 'CC_ASIGNADA') nuevoEstado = 'CC_ASIGNADA';
  } else {
    if (nuevoEstado === 'CC_ASIGNADA') nuevoEstado = 'PENDIENTE';
  }

  await db.query(
    'UPDATE drive_archivos SET cuenta_gasto_id = $1, estado_gestion = $2 WHERE id = $3',
    [cgId, nuevoEstado, id]
  );

  res.json({ ok: true, data: { id, cg_efectiva_id: cgId, estado_gestion: nuevoEstado } });
});

// ─── PUT /api/drive/:id/revertir ─────────────────────────────────────────────

router.put('/:id/revertir', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const archivo = await db.one('SELECT * FROM drive_archivos WHERE id = $1', [id]);
  if (!archivo) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });

  const estadoPrevio = archivo.estado_gestion;
  await db.query("UPDATE drive_archivos SET estado_gestion='PENDIENTE' WHERE id=$1", [id]);

  await registrarEvento({
    evento:    EVENTOS.REVERTIR_ESTADO,
    usuarioId: req.usuario.id,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   {
      drive_id:      archivo.id,
      nombre:        archivo.nombre_archivo,
      proveedor:     archivo.proveedor,
      estado_previo: estadoPrevio,
      estado_nuevo:  'PENDIENTE',
    },
  });

  res.json({ ok: true, data: { id, estado_gestion: 'PENDIENTE' } });
});

// ─── POST /api/drive/exportar-excel ──────────────────────────────────────────

router.post('/exportar-excel', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db       = getDb();
  const archivos = await db.all(
    `SELECT da.*,
            p.razon_social,
            pc.codigo AS cuenta_contable_codigo,
            pg.codigo AS cuenta_gasto_codigo
     FROM drive_archivos da
     LEFT JOIN LATERAL (
       SELECT p2.*
       FROM proveedores p2
       WHERE p2.activo = true
         AND (
           (
             p2.cif IS NOT NULL
             AND da.datos_extraidos IS NOT NULL
             AND da.datos_extraidos ~ '^\\s*\\{'
             AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)
           )
           OR p2.nombre_carpeta = da.proveedor
         )
       ORDER BY (p2.cif IS NOT NULL
                 AND da.datos_extraidos IS NOT NULL
                 AND da.datos_extraidos ~ '^\\s*\\{'
                 AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)
                ) DESC NULLS LAST
       LIMIT 1
     ) p ON true
     LEFT JOIN plan_contable pc ON pc.id = p.cuenta_contable_id
     LEFT JOIN plan_contable pg ON pg.id = p.cuenta_gasto_id
     WHERE da.id = ANY($1::int[])`,
    [ids]
  );

  if (!archivos.length) return res.status(404).json({ ok: false, error: 'Archivos no encontrados' });

  const filas = archivos.map(a => {
    const d = a.datos_extraidos ? JSON.parse(a.datos_extraidos) : {};
    const iva = Array.isArray(d.iva) ? d.iva : [];
    const ivaMap = {};
    for (const e of iva) ivaMap[e.tipo] = e;

    return {
      'ID':                   a.id,
      'Proveedor':            a.proveedor || '',
      'Razón Social':         a.razon_social || '',
      'Cta. Contable':        a.cuenta_contable_codigo || '',
      'Cta. Gasto':           a.cuenta_gasto_codigo || '',
      'Archivo':              a.nombre_archivo,
      'Nº Factura':           d.numero_factura  || '',
      'Fecha Emisión':        d.fecha_emision    || '',
      'Nombre Emisor':        d.nombre_emisor    || '',
      'CIF Emisor':           d.cif_emisor       || '',
      'Nombre Receptor':      d.nombre_receptor  || '',
      'CIF Receptor':         d.cif_receptor     || '',
      'Base 0%':              ivaMap[0]  ? ivaMap[0].base  : '',
      'Cuota IVA 0%':         ivaMap[0]  ? ivaMap[0].cuota : '',
      'Base 4%':              ivaMap[4]  ? ivaMap[4].base  : '',
      'Cuota IVA 4%':         ivaMap[4]  ? ivaMap[4].cuota : '',
      'Base 10%':             ivaMap[10] ? ivaMap[10].base  : '',
      'Cuota IVA 10%':        ivaMap[10] ? ivaMap[10].cuota : '',
      'Base 21%':             ivaMap[21] ? ivaMap[21].base  : '',
      'Cuota IVA 21%':        ivaMap[21] ? ivaMap[21].cuota : '',
      'Total Base (sin IVA)': d.total_sin_iva  ?? '',
      'Total IVA':            d.total_iva      ?? '',
      'Total Factura':        d.total_factura  ?? '',
      'Forma de Pago':        d.forma_pago      || '',
      'Fecha Vencimiento':    d.fecha_vencimiento || '',
      'Estado Extracción':    a.estado,
      'Estado Gestión':       a.estado_gestion,
    };
  });

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas');

  ws['!cols'] = [
    {wch:6},{wch:22},{wch:30},{wch:14},{wch:14},{wch:32},{wch:16},{wch:14},
    {wch:30},{wch:14},{wch:30},{wch:14},
    {wch:10},{wch:12},{wch:10},{wch:12},{wch:10},{wch:12},{wch:10},{wch:12},
    {wch:18},{wch:12},{wch:14},
    {wch:18},{wch:16},{wch:18},{wch:16},
  ];

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  registrarEvento({
    evento:    EVENTOS.EXPORT_EXCEL,
    usuarioId: req.usuario?.id ?? null,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   { count: archivos.length, ids },
  }).catch(() => {});

  const fecha = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="facturas-${fecha}.xlsx"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// ─── PUT /api/drive/aplicar-cuentas-proveedor ────────────────────────────────
// Pasa a CC_ASIGNADA todas las facturas PENDIENTE cuyo proveedor ya tiene
// cuenta de gasto definida (por nombre de carpeta o por CIF extraído)

router.put('/aplicar-cuentas-proveedor', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const result = await db.query(
      `UPDATE drive_archivos da
       SET estado_gestion = 'CC_ASIGNADA'
       WHERE da.estado_gestion = 'PENDIENTE'
         AND NOT ${tieneIncidenciaSQL('da')}
         AND EXISTS (
           SELECT 1 FROM proveedores p
           WHERE p.activo = true
             AND p.cuenta_gasto_id IS NOT NULL
             AND p.cuenta_contable_id IS NOT NULL
             AND (
               (
                 p.cif IS NOT NULL
                 AND da.datos_extraidos IS NOT NULL
                 AND da.datos_extraidos ~ '^\\s*\\{'
                 AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p.cif)
               )
               OR p.nombre_carpeta = da.proveedor
             )
         )`
    );
    res.json({ ok: true, data: { actualizadas: result.rowCount } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DELETE /api/drive/:id — eliminar factura pendiente (solo admin) ─────────

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const archivo = await db.one('SELECT * FROM drive_archivos WHERE id = $1', [id]);
  if (!archivo) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });

  // Solo se puede eliminar si está en PENDIENTE y nunca fue descargada
  const estadosPermitidos = ['PENDIENTE'];
  if (!estadosPermitidos.includes(archivo.estado_gestion)) {
    return res.status(400).json({ ok: false, error: 'Solo se pueden eliminar facturas en estado Pendiente' });
  }

  await db.query('DELETE FROM drive_archivos WHERE id = $1', [id]);

  await registrarEvento({
    evento:    'ELIMINAR_FACTURA',
    usuarioId: req.usuario.id,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   {
      drive_id:        archivo.id,
      google_id:       archivo.google_id,
      nombre:          archivo.nombre_archivo,
      proveedor:       archivo.proveedor,
      estado:          archivo.estado,
      estado_gestion:  archivo.estado_gestion,
    },
  });

  res.json({ ok: true });
});

// ─── PUT /api/drive/:id/datos — editar campos vacíos de datos_extraidos ──────

const CAMPOS_EDITABLES = [
  'numero_factura', 'fecha_emision', 'nombre_emisor', 'cif_emisor',
  'nombre_receptor', 'cif_receptor', 'total_factura', 'total_sin_iva', 'total_iva',
];

router.put('/:id/datos', requireAuth, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const archivo = await db.one('SELECT * FROM drive_archivos WHERE id = $1', [id]);
  if (!archivo) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });

  const datosActuales = archivo.datos_extraidos ? JSON.parse(archivo.datos_extraidos) : {};
  const cambios = {};
  const rechazados = [];

  for (const campo of CAMPOS_EDITABLES) {
    if (req.body[campo] === undefined) continue;

    // Solo se pueden editar campos que llegaron vacíos de la extracción
    const valorActual = datosActuales[campo];
    if (valorActual != null && valorActual !== '' && valorActual !== 0) {
      rechazados.push(campo);
      continue;
    }

    cambios[campo] = req.body[campo];
  }

  // IVA: solo editable si no hay desglose
  if (req.body.iva !== undefined) {
    const ivaActual = Array.isArray(datosActuales.iva) ? datosActuales.iva : [];
    const tieneIva = ivaActual.some(e => e.base > 0 || e.cuota > 0);
    if (!tieneIva) {
      cambios.iva = req.body.iva;
    } else {
      rechazados.push('iva');
    }
  }

  if (!Object.keys(cambios).length) {
    return res.status(400).json({ ok: false, error: 'No hay campos editables que modificar', rechazados });
  }

  const nuevosDatos = { ...datosActuales, ...cambios };

  await db.query(
    'UPDATE drive_archivos SET datos_extraidos = $1 WHERE id = $2',
    [JSON.stringify(nuevosDatos), id]
  );

  // Registrar en auditoría
  await registrarEvento({
    evento:    'EDICION_DATOS_FACTURA',
    usuarioId: req.usuario?.id ?? null,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   {
      drive_id:    id,
      nombre:      archivo.nombre_archivo,
      proveedor:   archivo.proveedor,
      campos_editados: Object.keys(cambios),
      valores_nuevos:  cambios,
    },
  }).catch(() => {});

  res.json({ ok: true, data: { datos_extraidos: nuevosDatos, rechazados } });
});

module.exports = router;
