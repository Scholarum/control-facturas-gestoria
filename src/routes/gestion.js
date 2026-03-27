const express = require('express');
const JSZip   = require('jszip');
const XLSX    = require('xlsx');
const router  = express.Router();

const { getDb }                     = require('../config/database');
const { registrarEvento, EVENTOS }  = require('../services/auditService');
const { buildDriveClient }          = require('../services/driveService');
const { resolveUser, requireAdmin, requireAuth } = require('../middleware/auth');
const { getSistemaConfig }          = require('../services/sistemaConfigService');
const { generarFicheroSage }       = require('../services/sageExporter');

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
  const empresaId = parseInt(req.query.empresa, 10) || null;
  const whereEmpresa = empresaId ? 'AND da.empresa_id = $1' : '';
  const params = empresaId ? [empresaId] : [];

  const archivos = await db.all(`
    SELECT
      da.id, da.google_id, da.nombre_archivo, da.ruta_completa,
      da.proveedor, da.fecha_subida, da.estado, da.estado_gestion,
      da.datos_extraidos, da.error_extraccion, da.procesado_at, da.ultima_sync,
      da.lote_a3_id, da.empresa_id,
      p.id                                                        AS proveedor_id,
      p.razon_social,
      p.cif                                                       AS proveedor_cif,
      da.cuenta_gasto_id                                          AS cg_manual_id,
      COALESCE(da.cuenta_gasto_id, pe.cuenta_gasto_id)            AS cg_efectiva_id,
      COALESCE(cgd.codigo,  peg.codigo)                           AS cuenta_gasto_codigo,
      COALESCE(cgd.descripcion, peg.descripcion)                  AS cuenta_gasto_desc,
      pec.codigo                                                  AS cta_proveedor_codigo,
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
    LEFT JOIN proveedor_empresa pe  ON pe.proveedor_id = p.id AND pe.empresa_id = da.empresa_id
    LEFT JOIN plan_contable peg     ON peg.id = pe.cuenta_gasto_id
    LEFT JOIN plan_contable cgd     ON cgd.id = da.cuenta_gasto_id
    LEFT JOIN plan_contable pec     ON pec.id = pe.cuenta_contable_id
    LEFT JOIN lotes_exportacion_a3 la ON la.id = da.lote_a3_id
    WHERE 1=1 ${whereEmpresa}
    ORDER BY da.id DESC
  `, params);
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

  // Descargar archivos en paralelo (lotes de 5 para no saturar la API de Drive)
  const BATCH_SIZE = 5;
  for (let i = 0; i < archivos.length; i += BATCH_SIZE) {
    const lote = archivos.slice(i, i + BATCH_SIZE);
    const resultados = await Promise.allSettled(
      lote.map(async (archivo) => {
        const resp = await drive.files.get(
          { fileId: archivo.google_id, alt: 'media' },
          { responseType: 'arraybuffer' }
        );
        return { archivo, data: Buffer.from(resp.data) };
      })
    );
    for (let j = 0; j < resultados.length; j++) {
      const r = resultados[j];
      if (r.status === 'fulfilled') {
        zip.file(r.value.archivo.nombre_archivo, r.value.data);
      } else {
        fallidos.push({ id: lote[j].id, nombre: lote[j].nombre_archivo, error: r.reason?.message || 'Error desconocido' });
      }
    }
  }

  if (fallidos.length) zip.file('_errores.json', JSON.stringify(fallidos, null, 2));

  // Solo la gestoria mueve a DESCARGADA, y solo las que estan en PENDIENTE
  const esAdmin = req.usuario?.rol === 'ADMIN';
  if (!esAdmin) {
    const configDl = await getSistemaConfig();
    const idsCandidatos = archivos
      .filter(a => a.estado_gestion === 'PENDIENTE' && (configDl.modo_gestoria === 'v1' || !tieneIncidencia(a.datos_extraidos)))
      .map(a => a.id);
    if (idsCandidatos.length) {
      if (configDl.modo_gestoria === 'v1') {
        await db.query(
          "UPDATE drive_archivos SET estado_gestion = 'DESCARGADA' WHERE id = ANY($1::int[]) AND estado_gestion = 'PENDIENTE'",
          [idsCandidatos]
        );
      } else {
        await db.query(
          `UPDATE drive_archivos da SET estado_gestion = 'DESCARGADA'
           WHERE da.id = ANY($1::int[])
             AND da.estado_gestion = 'PENDIENTE'
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

  // STORE sin comprimir: los PDFs ya están comprimidos, DEFLATE es lento y no reduce tamaño
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
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

  const configCont = await getSistemaConfig();
  if (configCont.modo_gestoria !== 'v1') {
    const sinCG = archivos.filter(a => !a.cg_efectiva_id);
    if (sinCG.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `${sinCG.length} factura(s) no tienen cuenta de gasto asignada`,
        ids_sin_cg: sinCG.map(a => a.id),
      });
    }
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

  const config = await getSistemaConfig();
  const esV1   = config.modo_gestoria === 'v1';

  let nuevoEstado = archivo.estado_gestion || 'PENDIENTE';
  if (cgId) {
    if (esV1) {
      // v1: no requiere proveedor/cuenta contable para transicionar
      if (nuevoEstado !== 'CC_ASIGNADA') nuevoEstado = 'CC_ASIGNADA';
    } else {
      // v2: requiere datos completos + proveedor con cuenta contable
      const datosOk      = !tieneIncidencia(archivo.datos_extraidos);
      const proveedorOk  = !!archivo.proveedor_id && !!archivo.cta_proveedor_codigo;
      if (datosOk && proveedorOk && nuevoEstado !== 'CC_ASIGNADA') nuevoEstado = 'CC_ASIGNADA';
    }
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

// ─── POST /api/drive/exportar-sage — generar fichero ContaPlus R75 ───────────

// ─── POST /api/drive/sage-preview — previsualizar proveedores y asientos ────

router.post('/sage-preview', requireAuth, express.json(), async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db = getDb();
  const archivos = await db.all(`
    SELECT da.id, da.proveedor, da.datos_extraidos, da.lote_sage_id,
           p.id AS proveedor_id, p.razon_social, p.ultimo_asiento_sage,
           cc.codigo AS cta_proveedor_codigo,
           COALESCE(cgd.codigo, pg.codigo) AS cuenta_gasto_codigo
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
    LEFT JOIN proveedor_empresa pe ON pe.proveedor_id = p.id AND pe.empresa_id = da.empresa_id
    LEFT JOIN plan_contable pg  ON pg.id  = pe.cuenta_gasto_id
    LEFT JOIN plan_contable cgd ON cgd.id = da.cuenta_gasto_id
    LEFT JOIN plan_contable cc  ON cc.id  = pe.cuenta_contable_id
    WHERE da.id = ANY($1::int[])
  `, [ids]);

  // Agrupar por proveedor
  const provMap = {};
  for (const a of archivos) {
    const pid = a.proveedor_id || 0;
    if (!provMap[pid]) {
      provMap[pid] = {
        proveedor_id: a.proveedor_id,
        razon_social: a.razon_social || a.proveedor || 'Sin proveedor',
        cta_proveedor: a.cta_proveedor_codigo || '',
        ultimo_asiento: a.ultimo_asiento_sage || 0,
        siguiente_asiento: (a.ultimo_asiento_sage || 0) + 1,
        num_facturas: 0,
        ya_exportadas: 0,
        sin_cuentas: 0,
      };
    }
    provMap[pid].num_facturas++;
    if (a.lote_sage_id) provMap[pid].ya_exportadas++;
    if (!a.cta_proveedor_codigo || !a.cuenta_gasto_codigo) provMap[pid].sin_cuentas++;
  }

  res.json({ ok: true, data: { proveedores: Object.values(provMap) } });
});

router.post('/exportar-sage', requireAuth, express.json(), async (req, res) => {
  const { ids, asientos_por_proveedor, contabilizar: marcarContabilizada } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db = getDb();
  const archivos = await db.all(`
    SELECT da.id, da.nombre_archivo, da.proveedor, da.datos_extraidos, da.lote_sage_id, da.empresa_id,
           p.id AS proveedor_id, pe.ultimo_asiento_sage,
           COALESCE(da.cuenta_gasto_id, pe.cuenta_gasto_id) AS cg_efectiva_id,
           COALESCE(cgd.codigo, peg.codigo)                  AS cuenta_gasto_codigo,
           pec.codigo                                        AS cta_proveedor_codigo
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
    LEFT JOIN proveedor_empresa pe  ON pe.proveedor_id = p.id AND pe.empresa_id = da.empresa_id
    LEFT JOIN plan_contable peg     ON peg.id = pe.cuenta_gasto_id
    LEFT JOIN plan_contable cgd     ON cgd.id = da.cuenta_gasto_id
    LEFT JOIN plan_contable pec     ON pec.id = pe.cuenta_contable_id
    WHERE da.id = ANY($1::int[])
  `, [ids]);

  if (!archivos.length) return res.status(404).json({ ok: false, error: 'Archivos no encontrados' });

  // Validar cuentas
  const sinDatos = archivos.filter(a => !a.cta_proveedor_codigo || !a.cuenta_gasto_codigo);
  if (sinDatos.length > 0) {
    return res.status(400).json({ ok: false, error: `${sinDatos.length} factura(s) sin cuenta contable o cuenta de gasto` });
  }

  // Verificar duplicados (ya exportadas a SAGE)
  const yaExportadas = archivos.filter(a => a.lote_sage_id);
  if (yaExportadas.length > 0) {
    return res.status(400).json({
      ok: false,
      error: `${yaExportadas.length} factura(s) ya exportadas a SAGE previamente`,
      ids_duplicadas: yaExportadas.map(a => a.id),
    });
  }

  // Parsear datos_extraidos
  const facturasConDatos = archivos.map(a => ({
    ...a,
    datos_extraidos: a.datos_extraidos ? JSON.parse(a.datos_extraidos) : {},
  }));

  // Verificar duplicados por CIF+numero factura
  for (const f of facturasConDatos) {
    const d = f.datos_extraidos;
    if (d.cif_emisor && d.numero_factura) {
      const dup = await db.one(
        'SELECT id FROM sage_facturas_exportadas WHERE cif_emisor = $1 AND numero_factura = $2',
        [d.cif_emisor.trim().toUpperCase(), d.numero_factura.trim().toUpperCase()]
      );
      if (dup) {
        return res.status(400).json({ ok: false, error: `Factura ${d.numero_factura} de ${d.cif_emisor} ya fue exportada a SAGE` });
      }
    }
  }

  // Generar ficheros con asientos por proveedor
  const asientosMap = {};
  if (asientos_por_proveedor) {
    for (const [k, v] of Object.entries(asientos_por_proveedor)) asientosMap[k] = parseInt(v, 10) || 1;
  }
  const { contenidoTXT, contenidoCSV, asientosFin } = generarFicheroSage(facturasConDatos, asientosMap);
  const fechaStr = new Date().toISOString().slice(0, 10);
  const nombreFichero = `diario-sage-${fechaStr}`;

  const usuarioId     = req.usuario?.id ?? null;
  const usuarioNombre = req.usuario?.nombre ?? null;

  // Calcular rango global de asientos
  const todosInicios = Object.values(asientosMap);
  const todosFines   = Object.values(asientosFin).map(Number);
  const asientoMin   = todosInicios.length ? Math.min(...todosInicios) : 1;
  const asientoMax   = todosFines.length ? Math.max(...todosFines) : 1;

  // Guardar lote en historial (ambos contenidos)
  const loteRow = await db.one(
    `INSERT INTO lotes_exportacion_sage (nombre_fichero, num_facturas, asiento_inicio, asiento_fin, contenido_csv, contenido_txt, usuario_id, usuario_nombre)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [nombreFichero, facturasConDatos.length, asientoMin, asientoMax, contenidoCSV, contenidoTXT, usuarioId, usuarioNombre]
  );

  // Marcar facturas como exportadas
  for (const f of facturasConDatos) {
    const d = f.datos_extraidos;
    await db.query('UPDATE drive_archivos SET lote_sage_id = $1 WHERE id = $2', [loteRow.id, f.id]);
    if (d.cif_emisor && d.numero_factura) {
      await db.query(
        `INSERT INTO sage_facturas_exportadas (lote_id, factura_id, cif_emisor, numero_factura)
         VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [loteRow.id, f.id, d.cif_emisor.trim().toUpperCase(), d.numero_factura.trim().toUpperCase()]
      );
    }
  }

  // Actualizar ultimo_asiento_sage por proveedor
  for (const [pid, ultimo] of Object.entries(asientosFin)) {
    if (pid !== '_sin') {
      await db.query('UPDATE proveedores SET ultimo_asiento_sage = $1 WHERE id = $2', [ultimo, parseInt(pid, 10)]);
    }
  }

  // Si se pide contabilizar, cambiar estado
  if (marcarContabilizada) {
    await db.query("UPDATE drive_archivos SET estado_gestion = 'CONTABILIZADA' WHERE id = ANY($1::int[])", [ids]);
  }

  registrarEvento({
    evento: 'EXPORT_SAGE', usuarioId,
    ip: req.clientIp, userAgent: req.userAgent,
    detalle: { lote_id: loteRow.id, count: facturasConDatos.length, asientos: asientosFin, contabilizada: !!marcarContabilizada },
  }).catch(() => {});

  res.json({ ok: true, data: { lote_id: loteRow.id, nombre_fichero: nombreFichero, contenido_txt: contenidoTXT, contenido_csv: contenidoCSV, asientos_fin: asientosFin, contabilizada: !!marcarContabilizada } });
});

// ─── GET /api/drive/sage-historial — historial de lotes SAGE ────────────────

router.get('/sage-historial', requireAuth, async (req, res) => {
  const db = getDb();
  const rows = await db.all('SELECT id, fecha, nombre_fichero, num_facturas, asiento_inicio, asiento_fin, usuario_nombre FROM lotes_exportacion_sage ORDER BY id DESC LIMIT 100');
  res.json({ ok: true, data: rows });
});

// ─── GET /api/drive/sage-historial/:id/facturas — facturas de un lote ────────

router.get('/sage-historial/:id/facturas', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const rows = await db.all(`
    SELECT se.cif_emisor, se.numero_factura,
           da.nombre_archivo, da.proveedor,
           (da.datos_extraidos::jsonb)->>'nombre_emisor'  AS nombre_emisor,
           (da.datos_extraidos::jsonb)->>'fecha_emision'  AS fecha_emision,
           (da.datos_extraidos::jsonb)->>'total_factura'  AS total_factura,
           (da.datos_extraidos::jsonb)->>'total_sin_iva'  AS total_sin_iva,
           (da.datos_extraidos::jsonb)->>'total_iva'      AS total_iva,
           cc.codigo AS cta_proveedor, cg.codigo AS cta_gasto
    FROM sage_facturas_exportadas se
    JOIN drive_archivos da ON da.id = se.factura_id
    LEFT JOIN LATERAL (
      SELECT p2.cuenta_contable_id, p2.cuenta_gasto_id FROM proveedores p2
      WHERE p2.activo = true AND (
        (p2.cif IS NOT NULL AND normalizar_cif(p2.cif) = normalizar_cif(se.cif_emisor))
        OR p2.nombre_carpeta = da.proveedor
      ) LIMIT 1
    ) p ON true
    LEFT JOIN plan_contable cc ON cc.id = p.cuenta_contable_id
    LEFT JOIN plan_contable cg ON cg.id = COALESCE(da.cuenta_gasto_id, p.cuenta_gasto_id)
    WHERE se.lote_id = $1
    ORDER BY se.id
  `, [id]);
  res.json({ ok: true, data: rows });
});

// ─── GET /api/drive/sage-historial/:id/descargar — re-descargar lote ────────

router.get('/sage-historial/:id/descargar', requireAuth, async (req, res) => {
  const id     = parseInt(req.params.id, 10);
  const format = req.query.format || 'txt';
  const db     = getDb();
  const row    = await db.one('SELECT nombre_fichero, contenido_csv, contenido_txt FROM lotes_exportacion_sage WHERE id = $1', [id]);
  if (!row) return res.status(404).json({ ok: false, error: 'Lote no encontrado' });
  const contenido = format === 'csv' ? (row.contenido_csv || '') : (row.contenido_txt || row.contenido_csv || '');
  const ext = format === 'csv' ? '.csv' : '.txt';
  res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename="${row.nombre_fichero}${ext}"` });
  res.send(contenido);
});


// ─── PUT /api/drive/vincular-proveedores — re-vincular facturas con proveedores por CIF ──

router.put('/vincular-proveedores', requireAuth, async (req, res) => {
  try {
    const db = getDb();

    // Facturas sin proveedor vinculado (ni por CIF ni por carpeta)
    const sinVinculo = await db.all(`
      SELECT da.id, da.nombre_archivo, da.proveedor,
             (da.datos_extraidos::jsonb)->>'cif_emisor'    AS cif_emisor,
             (da.datos_extraidos::jsonb)->>'nombre_emisor' AS nombre_emisor
      FROM drive_archivos da
      WHERE da.datos_extraidos IS NOT NULL
        AND da.datos_extraidos ~ '^\\s*\\{'
        AND NOT EXISTS (
          SELECT 1 FROM proveedores p
          WHERE p.activo = true AND (
            (p.cif IS NOT NULL AND normalizar_cif(p.cif) = normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor'))
            OR (p.nombre_carpeta IS NOT NULL AND p.nombre_carpeta = da.proveedor)
          )
        )
    `);

    // Facturas vinculadas por carpeta (proveedor tiene nombre_carpeta que coincide)
    const vinculadasPorCarpeta = await db.one(
      `SELECT COUNT(*) AS n FROM drive_archivos da
       WHERE EXISTS (
         SELECT 1 FROM proveedores p
         WHERE p.activo = true AND p.nombre_carpeta IS NOT NULL AND p.nombre_carpeta = da.proveedor
       )`
    );

    res.json({
      ok: true,
      data: {
        sin_proveedor: sinVinculo.length,
        vinculadas_por_carpeta: parseInt(vinculadasPorCarpeta.n, 10),
        detalle: sinVinculo.slice(0, 30).map(f => ({
          nombre: f.nombre_archivo,
          cif: f.cif_emisor,
          emisor: f.nombre_emisor,
          carpeta: f.proveedor,
        })),
      },
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── PUT /api/drive/aplicar-cuentas-proveedor ────────────────────────────────

router.put('/aplicar-cuentas-proveedor', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const config = await getSistemaConfig();
    const esV1 = config.modo_gestoria === 'v1';

    const empresaId = req.query.empresa ? parseInt(req.query.empresa, 10) : null;
    const filtroEmpresa = empresaId ? `AND da.empresa_id = ${empresaId}` : '';

    // Obtener todas las pendientes con info de proveedor y cuentas (de proveedor_empresa)
    const pendientes = await db.all(`
      SELECT da.id, da.nombre_archivo, da.proveedor, da.datos_extraidos, da.cuenta_gasto_id,
             p.id AS prov_id, pe.cuenta_gasto_id AS prov_cg_id, pe.cuenta_contable_id AS prov_cc_id
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
      LEFT JOIN proveedor_empresa pe ON pe.proveedor_id = p.id AND pe.empresa_id = da.empresa_id
      WHERE da.estado_gestion = 'PENDIENTE' ${filtroEmpresa}
    `);

    const idsActualizar = [];
    const motivos = []; // { id, nombre, motivo }

    for (const f of pendientes) {
      const cgEfectiva = f.cuenta_gasto_id || f.prov_cg_id;

      if (esV1) {
        // v1: solo necesita cuenta de gasto efectiva
        if (cgEfectiva) {
          idsActualizar.push(f.id);
        } else {
          motivos.push({ id: f.id, nombre: f.nombre_archivo, motivo: 'Sin cuenta de gasto' });
        }
        continue;
      }

      // v2: verificar todo
      if (!f.prov_id) {
        motivos.push({ id: f.id, nombre: f.nombre_archivo, motivo: 'Sin proveedor vinculado' });
        continue;
      }
      if (!f.prov_cc_id) {
        motivos.push({ id: f.id, nombre: f.nombre_archivo, motivo: 'Proveedor sin cuenta contable' });
        continue;
      }
      if (!cgEfectiva) {
        motivos.push({ id: f.id, nombre: f.nombre_archivo, motivo: 'Sin cuenta de gasto' });
        continue;
      }
      if (tieneIncidencia(f.datos_extraidos)) {
        motivos.push({ id: f.id, nombre: f.nombre_archivo, motivo: 'Datos de factura incompletos' });
        continue;
      }
      idsActualizar.push(f.id);
    }

    let actualizadas = 0;
    if (idsActualizar.length) {
      const r = await db.query(
        "UPDATE drive_archivos SET estado_gestion = 'CC_ASIGNADA' WHERE id = ANY($1::int[])",
        [idsActualizar]
      );
      actualizadas = r.rowCount;
    }

    res.json({ ok: true, data: { actualizadas, pendientes_sin_mover: motivos.length, motivos } });
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

// ─── PUT /api/drive/:id/datos — editar campos de datos_extraidos ─────────────

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
  const anteriores = {};

  for (const campo of CAMPOS_EDITABLES) {
    if (req.body[campo] === undefined) continue;
    anteriores[campo] = datosActuales[campo] ?? null;
    cambios[campo] = req.body[campo];
  }

  // IVA
  if (req.body.iva !== undefined) {
    anteriores.iva = datosActuales.iva ?? null;
    cambios.iva = req.body.iva;
  }

  if (!Object.keys(cambios).length) {
    return res.status(400).json({ ok: false, error: 'No hay campos que modificar' });
  }

  const nuevosDatos = { ...datosActuales, ...cambios };

  await db.query(
    'UPDATE drive_archivos SET datos_extraidos = $1 WHERE id = $2',
    [JSON.stringify(nuevosDatos), id]
  );

  await registrarEvento({
    evento:    'EDICION_DATOS_FACTURA',
    usuarioId: req.usuario?.id ?? null,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   {
      drive_id:         id,
      nombre:           archivo.nombre_archivo,
      proveedor:        archivo.proveedor,
      campos_editados:  Object.keys(cambios),
      valores_anteriores: anteriores,
      valores_nuevos:   cambios,
    },
  }).catch(() => {});

  res.json({ ok: true, data: { datos_extraidos: nuevosDatos } });
});

module.exports = router;
