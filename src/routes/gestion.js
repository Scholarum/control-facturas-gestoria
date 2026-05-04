const express = require('express');
const JSZip   = require('jszip');
const XLSX    = require('xlsx');
const router  = express.Router();
const logger  = require('../config/logger');

const multer  = require('multer');
const { getDb }                     = require('../config/database');
const { registrarEvento, EVENTOS }  = require('../services/auditService');
const { buildDriveClient, listarCarpetasRaiz, contarArchivosCarpeta, crearCarpeta, subirArchivo, obtenerCarpeta } = require('../services/driveService');
const { ejecutarExtraccion }        = require('../services/extractorService');
const { resolveUser, requireAdmin, requireAuth } = require('../middleware/auth');
const { getSistemaConfig, setSistemaConfig } = require('../services/sistemaConfigService');
const { generarFicheroSage }       = require('../services/sageExporter');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function parsearArchivo(a) {
  const datos = a.datos_extraidos ? JSON.parse(a.datos_extraidos) : null;
  // Nombre del proveedor: razon_social (por CIF) > nombre_emisor (extraído) > carpeta Drive
  const proveedor_nombre = a.razon_social || datos?.nombre_emisor || a.proveedor || null;
  return { ...a, datos_extraidos: datos, proveedor_nombre };
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
  if (!iva.some(e => e.base !== 0 || e.cuota !== 0)) return true;
  return false;
}

router.use(resolveUser);

// ─── GET /api/drive/stats — contadores por estado (ligero) ───────────────────

router.get('/stats', async (req, res) => {
  const db = getDb();
  const empresaId = parseInt(req.query.empresa, 10) || null;
  const where = empresaId ? 'WHERE empresa_id = $1' : '';
  const params = empresaId ? [empresaId] : [];

  const rows = await db.all(`
    SELECT COALESCE(estado_gestion, 'PENDIENTE') AS estado, COUNT(*)::int AS total
    FROM drive_archivos ${where}
    GROUP BY COALESCE(estado_gestion, 'PENDIENTE')
  `, params);

  const stats = { pendientes: 0, descargadas: 0, ccAsignadas: 0, contabilizadas: 0, total: 0 };
  for (const r of rows) {
    stats.total += r.total;
    if (r.estado === 'PENDIENTE')      stats.pendientes     = r.total;
    if (r.estado === 'DESCARGADA')     stats.descargadas    = r.total;
    if (r.estado === 'CC_ASIGNADA')    stats.ccAsignadas    = r.total;
    if (r.estado === 'CONTABILIZADA')  stats.contabilizadas = r.total;
  }

  // Proveedores sin cuenta contable (para alerta)
  const sinCuenta = empresaId
    ? await db.all(`
        SELECT DISTINCT da.proveedor AS razon_social,
               (CASE WHEN da.datos_extraidos ~ '^\\s*\\{' THEN da.datos_extraidos::jsonb->>'cif_emisor' END) AS cif
        FROM drive_archivos da
        LEFT JOIN LATERAL (
          SELECT p2.id, pe2.cuenta_contable_id FROM proveedores p2
          LEFT JOIN proveedor_empresa pe2 ON pe2.proveedor_id = p2.id AND pe2.empresa_id = da.empresa_id
          WHERE p2.activo = true AND (
            (p2.cif IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{' AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif))
            OR p2.nombre_carpeta = da.proveedor
          ) LIMIT 1
        ) p ON true
        WHERE da.empresa_id = $1 AND da.proveedor IS NOT NULL
          AND (p.id IS NULL OR p.cuenta_contable_id IS NULL)
        LIMIT 20
      `, [empresaId])
    : [];

  res.json({ ok: true, data: { ...stats, alertaProveedores: sinCuenta } });
});

// ─── GET /api/drive ───────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const db = getDb();
  const empresaId = parseInt(req.query.empresa, 10) || null;
  const estado    = req.query.estado || null;
  const page      = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit     = Math.min(10000, Math.max(1, parseInt(req.query.limit, 10) || 25));
  const offset    = (page - 1) * limit;
  const soloIds   = req.query.solo_ids === '1'; // Devolver solo IDs (para select all)

  // Filtros
  const { proveedor, numFactura, cif, fechaDesde, fechaHasta, estadoExtraccion, soloIncidencias, soloSinProveedor, importeMin, importeMax } = req.query;

  const conditions = ['1=1'];
  const params = [];
  let idx = 1;

  if (empresaId) { conditions.push(`da.empresa_id = $${idx++}`); params.push(empresaId); }
  if (estado) {
    if (estado === 'PENDIENTE') {
      conditions.push(`COALESCE(da.estado_gestion, 'PENDIENTE') = 'PENDIENTE'`);
    } else {
      conditions.push(`da.estado_gestion = $${idx++}`); params.push(estado);
    }
  }
  // El filtro proveedor debe buscar tanto en la carpeta Drive como en la razon_social del proveedor vinculado
  // Se aplica después del JOIN, usando provFilter
  let provNombreFilter = '';
  if (proveedor) { provNombreFilter = `AND (da.proveedor ILIKE $${idx} OR p.razon_social ILIKE $${idx})`; params.push(`%${proveedor}%`); idx++; }
  if (numFactura) {
    conditions.push(`da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{' AND (da.datos_extraidos::jsonb)->>'numero_factura' ILIKE $${idx++}`);
    params.push(`%${numFactura}%`);
  }
  if (cif) {
    conditions.push(`da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{' AND (da.datos_extraidos::jsonb)->>'cif_emisor' ILIKE $${idx++}`);
    params.push(`%${cif}%`);
  }
  if (fechaDesde) {
    conditions.push(`da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{' AND (da.datos_extraidos::jsonb)->>'fecha_emision' >= $${idx++}`);
    params.push(fechaDesde);
  }
  if (fechaHasta) {
    conditions.push(`da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{' AND (da.datos_extraidos::jsonb)->>'fecha_emision' <= $${idx++}`);
    params.push(fechaHasta);
  }
  if (importeMin !== undefined && importeMin !== '') {
    conditions.push(`da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{' AND ((da.datos_extraidos::jsonb)->>'total_factura')::numeric >= $${idx++}`);
    params.push(parseFloat(importeMin));
  }
  if (importeMax !== undefined && importeMax !== '') {
    conditions.push(`da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{' AND ((da.datos_extraidos::jsonb)->>'total_factura')::numeric <= $${idx++}`);
    params.push(parseFloat(importeMax));
  }
  if (estadoExtraccion) { conditions.push(`da.estado = $${idx++}`); params.push(estadoExtraccion); }
  if (soloIncidencias === 'si') { conditions.push(tieneIncidenciaSQL('da')); }
  if (soloIncidencias === 'no') { conditions.push(`NOT ${tieneIncidenciaSQL('da')}`); }

  const whereClause = conditions.join(' AND ');
  // soloSinProveedor se aplica como HAVING después del JOIN (necesita p.id)

  // Filtro soloSinProveedor requiere el JOIN con proveedores
  let provFilter = '';
  if (soloSinProveedor === 'si') provFilter = 'AND (p.id IS NULL OR pec.codigo IS NULL)';
  if (soloSinProveedor === 'no') provFilter = 'AND p.id IS NOT NULL AND pec.codigo IS NOT NULL';

  const joinBlock = `
    FROM drive_archivos da
    LEFT JOIN LATERAL (
      SELECT p2.*
      FROM proveedores p2
      WHERE p2.activo = true
        AND (
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
    LEFT JOIN lotes_exportacion_a3 la ON la.id = da.lote_a3_id
    WHERE ${whereClause} ${provFilter} ${provNombreFilter}`;

  // Modo solo_ids: devolver únicamente los IDs (para select all)
  if (soloIds) {
    const rows = await db.all(`SELECT da.id ${joinBlock} ORDER BY da.id DESC`, params);
    return res.json({ ok: true, ids: rows.map(r => r.id) });
  }

  const [archivos, countRow] = await Promise.all([
    db.all(`
      SELECT
        da.id, da.google_id, da.nombre_archivo, da.ruta_completa,
        da.proveedor, da.fecha_subida, da.estado, da.estado_gestion,
        da.datos_extraidos, da.error_extraccion, da.procesado_at, da.ultima_sync,
        da.lote_a3_id, da.lote_sage_id, da.empresa_id,
        p.id AS proveedor_id, p.razon_social, p.cif AS proveedor_cif,
        da.cuenta_gasto_id AS cg_manual_id,
        COALESCE(da.cuenta_gasto_id, pe.cuenta_gasto_id) AS cg_efectiva_id,
        COALESCE(cgd.codigo, peg.codigo) AS cuenta_gasto_codigo,
        COALESCE(cgd.descripcion, peg.descripcion) AS cuenta_gasto_desc,
        pec.codigo AS cta_proveedor_codigo,
        da.sii_tipo_clave, da.sii_tipo_fact,
        da.sii_tipo_exenci, da.sii_tipo_no_suje, da.sii_tipo_rectif, da.sii_entr_prest,
        p.sii_tipo_clave   AS proveedor_sii_tipo_clave,
        p.sii_tipo_fact    AS proveedor_sii_tipo_fact,
        p.sii_tipo_exenci  AS proveedor_sii_tipo_exenci,
        p.sii_tipo_no_suje AS proveedor_sii_tipo_no_suje,
        p.sii_tipo_rectif  AS proveedor_sii_tipo_rectif,
        p.sii_entr_prest   AS proveedor_sii_entr_prest,
        da.es_rectificativa, da.rect_serie, da.rect_numero, da.rect_base_imp,
        TO_CHAR(da.rect_fecha, 'YYYY-MM-DD') AS rect_fecha,
        da.irpf_base, da.irpf_cuota,
        p.aplica_irpf       AS proveedor_aplica_irpf,
        p.irpf_porcentaje   AS proveedor_irpf_porcentaje,
        p.irpf_clave        AS proveedor_irpf_clave,
        p.irpf_subcuenta    AS proveedor_irpf_subcuenta,
        la.nombre_fichero AS lote_a3_nombre, la.fecha AS lote_a3_fecha
      ${joinBlock}
      ORDER BY da.id DESC
      LIMIT $${idx++} OFFSET $${idx++}
    `, [...params, limit, offset]),

    db.one(`SELECT COUNT(*)::int AS total ${joinBlock}`, params),
  ]);

  res.json({
    ok: true,
    data: archivos.map(parsearArchivo),
    pagination: { page, limit, total: countRow.total, totalPages: Math.ceil(countRow.total / limit) },
  });
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
    }).catch(e => logger.error({ err: e.message }, 'audit error'));
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
    `SELECT da.id, da.nombre_archivo, da.proveedor, da.empresa_id,
            da.cuenta_gasto_id AS cg_factura,
            p.id AS prov_id,
            pe.cuenta_gasto_id AS cg_proveedor_empresa,
            COALESCE(da.cuenta_gasto_id, pe.cuenta_gasto_id) AS cg_efectiva_id
     FROM drive_archivos da
     LEFT JOIN LATERAL (
       SELECT p2.id FROM proveedores p2
       WHERE p2.activo = true
         AND (
           (p2.cif IS NOT NULL AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
            AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif))
           OR p2.nombre_carpeta = da.proveedor
         )
       ORDER BY (p2.cif IS NOT NULL AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
                AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)) DESC NULLS LAST
       LIMIT 1
     ) p ON true
     LEFT JOIN proveedor_empresa pe ON pe.proveedor_id = p.id AND pe.empresa_id = da.empresa_id
     WHERE da.id = ANY($1::int[])`,
    [ids]
  );

  const configCont = await getSistemaConfig();
  if (configCont.modo_gestoria !== 'v1') {
    const sinCG = archivos.filter(a => !a.cg_efectiva_id);
    if (sinCG.length > 0) {
      // Diagnóstico: mostrar datos reales de las primeras 5 facturas sin CG
      const muestra = sinCG.slice(0, 5).map(a => ({
        id: a.id, archivo: a.nombre_archivo, empresa_id: a.empresa_id,
        cg_factura: a.cg_factura, prov_id: a.prov_id, cg_prov_empresa: a.cg_proveedor_empresa,
      }));
      return res.status(400).json({
        ok: false,
        error: `${sinCG.length} factura(s) sin cuenta de gasto`,
        ids_sin_cg: sinCG.map(a => a.id),
        _debug: { total_enviados: ids.length, total_encontrados: archivos.length, con_cg: archivos.filter(a => a.cg_efectiva_id).length, muestra },
      });
    }
  }

  await db.query(
    "UPDATE drive_archivos SET estado_gestion='CONTABILIZADA' WHERE id = ANY($1::int[])",
    [ids]
  );

  if (archivos.length > 0) {
    // Registrar un evento por cada factura para el historial individual
    for (const a of archivos) {
      registrarEvento({
        evento: EVENTOS.CONTABILIZAR_MASIVO, usuarioId,
        ip: req.clientIp, userAgent: req.userAgent,
        detalle: { drive_id: a.id, nombre: a.nombre_archivo, proveedor: a.proveedor, count: archivos.length },
      }).catch(() => {});
    }
  }

  const { broadcast } = require('../services/sseService');
  broadcast('facturas_contabilizadas', { count: archivos.length, usuario: req.usuario?.nombre });

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

  const usuarioId = req.usuario?.id;
  for (const a of archivos.filter(x => x.estado_gestion !== 'CONTABILIZADA')) {
    registrarEvento({
      evento: 'ASIGNAR_CG', usuarioId,
      ip: req.clientIp, userAgent: req.userAgent,
      detalle: { drive_id: a.id, cuenta_gasto_id: cgId, estado_previo: a.estado_gestion, estado_nuevo: nuevoEstado },
    }).catch(() => {});
  }

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
    SELECT da.estado_gestion, da.datos_extraidos, da.empresa_id,
           p.id AS proveedor_id, pec.codigo AS cta_proveedor_codigo
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
    LEFT JOIN plan_contable pec ON pec.id = pe.cuenta_contable_id
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

  const estadoPrevio = archivo.estado_gestion || 'PENDIENTE';
  await db.query(
    'UPDATE drive_archivos SET cuenta_gasto_id = $1, estado_gestion = $2 WHERE id = $3',
    [cgId, nuevoEstado, id]
  );

  if (estadoPrevio !== nuevoEstado) {
    registrarEvento({
      evento: 'ASIGNAR_CG', usuarioId: req.usuario?.id,
      ip: req.clientIp, userAgent: req.userAgent,
      detalle: { drive_id: id, cuenta_gasto_id: cgId, estado_previo: estadoPrevio, estado_nuevo: nuevoEstado },
    }).catch(() => {});
  }

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
      'Proveedor':            a.razon_social || d.nombre_emisor || a.proveedor || '',
      'Carpeta Drive':        a.proveedor || '',
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
           p.id AS proveedor_id, p.razon_social,
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

  // Resumen global
  const provMap = {};
  let yaExportadas = 0;
  let sinCuentas   = 0;
  for (const a of archivos) {
    const pid = a.proveedor_id || 0;
    if (!provMap[pid]) {
      provMap[pid] = {
        proveedor_id: a.proveedor_id,
        razon_social: a.razon_social || a.proveedor || 'Sin proveedor',
        cta_proveedor: a.cta_proveedor_codigo || '',
        num_facturas: 0,
      };
    }
    provMap[pid].num_facturas++;
    if (a.lote_sage_id) yaExportadas++;
    if (!a.cta_proveedor_codigo || !a.cuenta_gasto_codigo) sinCuentas++;
  }

  // Últimos valores globales para sugerir el siguiente
  const cfg = await getSistemaConfig();
  const ultimoAsiento   = parseInt(cfg.sage_ultimo_asiento,   10) || 0;
  const ultimoDocumento = parseInt(cfg.sage_ultimo_documento, 10) || 0;

  res.json({ ok: true, data: {
    proveedores: Object.values(provMap),
    num_facturas: archivos.length,
    ya_exportadas: yaExportadas,
    sin_cuentas: sinCuentas,
    ultimo_asiento: ultimoAsiento,
    ultimo_documento: ultimoDocumento,
    siguiente_asiento: ultimoAsiento + 1,
    siguiente_documento: ultimoDocumento + 1,
  }});
});

// Valida fecha_exportacion del modal SAGE. Devuelve {valor, error}:
//   valor = string 'YYYY-MM-DD' valido en rango ±180 dias desde hoy,
//   valor = null si no viene en el body (fallback a hoy en el exportador),
//   error = mensaje claro si formato/rango invalido.
function validarFechaExportacion(iso) {
  if (iso === undefined || iso === null || iso === '') return { valor: null };
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { error: 'fecha_exportacion debe tener formato YYYY-MM-DD' };
  }
  const [y, m, d] = iso.split('-').map(Number);
  const ts = Date.UTC(y, m - 1, d);
  // Comprobar que la fecha es real (Date.UTC acepta 2026-02-31 y normaliza a marzo).
  const back = new Date(ts);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return { error: `fecha_exportacion no es una fecha real: ${iso}` };
  }
  // Rango ±180 dias en UTC (evita drift por horario de verano).
  const ahora = new Date();
  const hoyTs = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());
  const dias = Math.round((ts - hoyTs) / 86400000);
  if (dias < -180 || dias > 180) {
    return { error: `fecha_exportacion fuera de rango (±180 días desde hoy): ${iso} (${dias} días)` };
  }
  return { valor: iso };
}

router.post('/exportar-sage', requireAuth, express.json(), async (req, res) => {
  const { ids, asiento_inicio, documento_inicio, fecha_exportacion, contabilizar: marcarContabilizada } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  // Validación: enteros positivos
  const esEnteroPositivo = v => Number.isInteger(Number(v)) && Number(v) > 0 && String(v).match(/^\d+$/);
  if (!esEnteroPositivo(asiento_inicio)) {
    return res.status(400).json({ ok: false, error: 'Asiento de inicio debe ser un entero positivo' });
  }
  if (!esEnteroPositivo(documento_inicio)) {
    return res.status(400).json({ ok: false, error: 'Número de documento de inicio debe ser un entero positivo' });
  }
  const asientoInicio   = parseInt(asiento_inicio,   10);
  const documentoInicio = parseInt(documento_inicio, 10);

  const { valor: fechaExportacion, error: fechaErr } = validarFechaExportacion(fecha_exportacion);
  if (fechaErr) return res.status(400).json({ ok: false, error: fechaErr });

  const db = getDb();
  const archivos = await db.all(`
    SELECT da.id, da.nombre_archivo, da.proveedor, da.datos_extraidos, da.lote_sage_id, da.empresa_id,
           p.id AS proveedor_id, pe.ultimo_asiento_sage,
           COALESCE(da.cuenta_gasto_id, pe.cuenta_gasto_id) AS cg_efectiva_id,
           COALESCE(cgd.codigo, peg.codigo)                  AS cuenta_gasto_codigo,
           pec.codigo                                        AS cta_proveedor_codigo,
           COALESCE(da.sii_tipo_clave,   p.sii_tipo_clave,   1) AS sii_tipo_clave,
           COALESCE(da.sii_tipo_fact,    p.sii_tipo_fact,    1) AS sii_tipo_fact,
           COALESCE(da.sii_tipo_exenci,  p.sii_tipo_exenci,  1) AS sii_tipo_exenci,
           COALESCE(da.sii_tipo_no_suje, p.sii_tipo_no_suje, 1) AS sii_tipo_no_suje,
           COALESCE(da.sii_tipo_rectif,  p.sii_tipo_rectif,  2) AS sii_tipo_rectif,
           COALESCE(da.sii_entr_prest,   p.sii_entr_prest,   1) AS sii_entr_prest,
           da.sii_tipo_fact AS override_sii_tipo_fact,
           da.es_rectificativa, da.rect_serie, da.rect_numero, da.rect_base_imp,
           TO_CHAR(da.rect_fecha, 'YYYYMMDD') AS rect_fecha_ymd
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

  // Generar ficheros con asiento + documento globales correlativos.
  // fechaExportacion (opcional) override para pos 2/47/127. Null = fallback a hoy.
  const { contenidoTXT, contenidoCSV, asientoFin, documentoFin } =
    generarFicheroSage(facturasConDatos, { asientoInicio, documentoInicio, fechaExportacion });

  const fechaStr = new Date().toISOString().slice(0, 10);
  const nombreFichero = `diario-sage-${fechaStr}`;

  const usuarioId     = req.usuario?.id ?? null;
  const usuarioNombre = req.usuario?.nombre ?? null;

  // Guardar lote en historial (ambos contenidos)
  const loteRow = await db.one(
    `INSERT INTO lotes_exportacion_sage (nombre_fichero, num_facturas, asiento_inicio, asiento_fin, contenido_csv, contenido_txt, usuario_id, usuario_nombre, empresa_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [nombreFichero, facturasConDatos.length, asientoInicio, asientoFin, contenidoCSV, contenidoTXT, usuarioId, usuarioNombre, facturasConDatos[0]?.empresa_id || null]
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

  // Persistir últimos valores globales usados para sugerirlos en la próxima exportación
  await setSistemaConfig({
    sage_ultimo_asiento:   String(asientoFin),
    sage_ultimo_documento: String(documentoFin),
  });

  // Si se pide contabilizar, cambiar estado
  if (marcarContabilizada) {
    await db.query("UPDATE drive_archivos SET estado_gestion = 'CONTABILIZADA' WHERE id = ANY($1::int[])", [ids]);
  }

  registrarEvento({
    evento: 'EXPORT_SAGE', usuarioId,
    ip: req.clientIp, userAgent: req.userAgent,
    detalle: {
      lote_id: loteRow.id, count: facturasConDatos.length,
      asiento_inicio: asientoInicio, asiento_fin: asientoFin,
      documento_inicio: documentoInicio, documento_fin: documentoFin,
      contabilizada: !!marcarContabilizada,
    },
  }).catch(() => {});

  res.json({ ok: true, data: {
    lote_id: loteRow.id,
    nombre_fichero: nombreFichero,
    contenido_txt: contenidoTXT,
    contenido_csv: contenidoCSV,
    asiento_inicio: asientoInicio, asiento_fin: asientoFin,
    documento_inicio: documentoInicio, documento_fin: documentoFin,
    contabilizada: !!marcarContabilizada,
  }});
});

// ─── GET /api/drive/sage-historial — historial de lotes SAGE ────────────────

router.get('/sage-historial', requireAuth, async (req, res) => {
  const db = getDb();
  const empresaId = req.query.empresa ? parseInt(req.query.empresa, 10) : null;
  const filtro = empresaId ? `WHERE empresa_id = ${empresaId}` : '';
  const rows = await db.all(`SELECT id, fecha, nombre_fichero, num_facturas, asiento_inicio, asiento_fin, usuario_nombre FROM lotes_exportacion_sage ${filtro} ORDER BY id DESC LIMIT 100`);
  res.json({ ok: true, data: rows });
});

// ─── GET /api/drive/sage-historial/:id/facturas — facturas de un lote ────────

router.get('/sage-historial/:id/facturas', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const rows = await db.all(`
    SELECT se.cif_emisor, se.numero_factura,
           da.nombre_archivo, da.proveedor,
           COALESCE(p.razon_social, (da.datos_extraidos::jsonb)->>'nombre_emisor', da.proveedor) AS nombre_emisor,
           (da.datos_extraidos::jsonb)->>'fecha_emision'  AS fecha_emision,
           (da.datos_extraidos::jsonb)->>'total_factura'  AS total_factura,
           (da.datos_extraidos::jsonb)->>'total_sin_iva'  AS total_sin_iva,
           (da.datos_extraidos::jsonb)->>'total_iva'      AS total_iva,
           cc.codigo AS cta_proveedor, cc.descripcion AS cta_proveedor_desc,
           cg.codigo AS cta_gasto, cg.descripcion AS cta_gasto_desc
    FROM sage_facturas_exportadas se
    JOIN drive_archivos da ON da.id = se.factura_id
    LEFT JOIN LATERAL (
      SELECT p2.id, p2.razon_social FROM proveedores p2
      WHERE p2.activo = true AND (
        (p2.cif IS NOT NULL AND normalizar_cif(p2.cif) = normalizar_cif(se.cif_emisor))
        OR p2.nombre_carpeta = da.proveedor
      ) LIMIT 1
    ) p ON true
    LEFT JOIN proveedor_empresa pe ON pe.proveedor_id = p.id AND pe.empresa_id = da.empresa_id
    LEFT JOIN plan_contable cc ON cc.id = pe.cuenta_contable_id
    LEFT JOIN plan_contable cg ON cg.id = COALESCE(da.cuenta_gasto_id, pe.cuenta_gasto_id)
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
      for (const id of idsActualizar) {
        registrarEvento({
          evento: 'ASIGNAR_CG', usuarioId: req.usuario?.id,
          ip: req.clientIp, userAgent: req.userAgent,
          detalle: { drive_id: id, estado_previo: 'PENDIENTE', estado_nuevo: 'CC_ASIGNADA', via: 'aplicar-cuentas-proveedor' },
        }).catch(() => {});
      }
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

// Campos SII parametrizables como override por factura (columnas de drive_archivos,
// no del JSONB). Si la factura ya esta exportada a SAGE todos quedan bloqueados.
const CAMPOS_SII_FACTURA = ['sii_tipo_clave', 'sii_tipo_fact', 'sii_tipo_exenci', 'sii_tipo_no_suje', 'sii_tipo_rectif', 'sii_entr_prest'];

// Campos propios de rectificativa (columnas de drive_archivos, tambien fuera del JSONB).
// Mismo bloqueo por lote_sage_id que los SII. Validadores por tipo — ver PUT /:id/datos.
const CAMPOS_RECT_FACTURA = ['es_rectificativa', 'rect_serie', 'rect_numero', 'rect_fecha', 'rect_base_imp'];

// Campos IRPF de factura (columnas de drive_archivos, fuera del JSONB).
// Mismo bloqueo por lote_sage_id. Coherencia: cuota <= base. Autocompletado:
// si llega cuota y base esta NULL en BD, se autocompleta base = total_sin_iva
// (defensa contra estados inconsistentes que romperian el exportador SAGE).
const CAMPOS_IRPF_FACTURA = ['irpf_base', 'irpf_cuota'];
const VALIDADORES_IRPF = {
  irpf_base: (v) => {
    if (v === null || v === '') return { value: null };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { error: 'irpf_base debe ser numero >= 0 o null' };
    return { value: n };
  },
  irpf_cuota: (v) => {
    if (v === null || v === '') return { value: null };
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return { error: 'irpf_cuota debe ser numero >= 0 o null' };
    return { value: n };
  },
};

const VALIDADORES_RECT = {
  es_rectificativa: (v) => typeof v === 'boolean'
    ? { value: v }
    : { error: 'es_rectificativa debe ser true o false' },
  rect_serie: (v) => {
    if (v === null || v === '') return { value: null };
    if (typeof v !== 'string' || v.length > 1) return { error: 'rect_serie debe ser cadena de 1 caracter o null' };
    return { value: v };
  },
  rect_numero: (v) => {
    if (v === null || v === '') return { value: null };
    if (typeof v !== 'string' || v.length > 40) return { error: 'rect_numero debe ser cadena de hasta 40 caracteres o null' };
    return { value: v };
  },
  rect_fecha: (v) => {
    if (v === null || v === '') return { value: null };
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: 'rect_fecha debe ser YYYY-MM-DD o null' };
    return { value: v };
  },
  rect_base_imp: (v) => {
    if (v === null || v === '') return { value: null };
    const n = Number(v);
    if (!Number.isFinite(n)) return { error: 'rect_base_imp debe ser numero o null' };
    return { value: n };
  },
};

router.put('/:id/datos', requireAuth, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const archivo = await db.one('SELECT * FROM drive_archivos WHERE id = $1', [id]);
  if (!archivo) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });

  // Detectar que campos SII + rectificativa + IRPF vienen en el body (undefined = no tocar).
  const siiPresentes  = CAMPOS_SII_FACTURA.filter(c => req.body[c] !== undefined);
  const rectPresentes = CAMPOS_RECT_FACTURA.filter(c => req.body[c] !== undefined);
  const irpfPresentes = CAMPOS_IRPF_FACTURA.filter(c => req.body[c] !== undefined);

  if (archivo.lote_sage_id && (siiPresentes.length > 0 || rectPresentes.length > 0 || irpfPresentes.length > 0)) {
    return res.status(409).json({ ok: false, error: 'Factura ya exportada a SAGE, campos SII / rectificativa / IRPF no editables' });
  }

  // Validacion SII: null o '' = volver a heredar del proveedor (NULL en BD), entero >= 0 = override.
  const parseSiiCol = v => {
    if (v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return NaN;
    return n;
  };
  const siiNuevos = {};
  for (const c of siiPresentes) {
    const v = parseSiiCol(req.body[c]);
    if (Number.isNaN(v)) return res.status(400).json({ ok: false, error: `${c} debe ser entero >= 0 o null` });
    siiNuevos[c] = v;
  }

  // Validacion rectificativa: validador por campo (ver VALIDADORES_RECT).
  const rectNuevos = {};
  for (const c of rectPresentes) {
    const { value, error } = VALIDADORES_RECT[c](req.body[c]);
    if (error) return res.status(400).json({ ok: false, error });
    rectNuevos[c] = value;
  }

  // Validacion IRPF: parseo individual + coherencia + autocompletado.
  const irpfNuevos = {};
  for (const c of irpfPresentes) {
    const { value, error } = VALIDADORES_IRPF[c](req.body[c]);
    if (error) return res.status(400).json({ ok: false, error });
    irpfNuevos[c] = value;
  }
  // Autocompletado defensivo: si llega cuota informada y la base actual en BD
  // es NULL (y el body no la trae), autocompletamos base = total_sin_iva del JSON.
  // Razon: cuota sin base genera estado inconsistente que rompe el exportador SAGE
  // (commit 5 IRPF). Forzar la coherencia aqui evita parches downstream.
  if (irpfPresentes.includes('irpf_cuota') && irpfNuevos.irpf_cuota != null
      && !irpfPresentes.includes('irpf_base') && archivo.irpf_base == null) {
    const datos = archivo.datos_extraidos ? JSON.parse(archivo.datos_extraidos) : {};
    const totalSinIva = Number(datos.total_sin_iva);
    if (Number.isFinite(totalSinIva) && totalSinIva > 0) {
      irpfNuevos.irpf_base = totalSinIva;
      irpfPresentes.push('irpf_base');
    }
  }
  // Coherencia: cuota <= base (margen 0.01). baseEf y cuotaEf cogen el valor
  // nuevo si viene en el body, o el actual de BD si no.
  const baseEf  = irpfPresentes.includes('irpf_base')  ? irpfNuevos.irpf_base  : (archivo.irpf_base  != null ? Number(archivo.irpf_base)  : null);
  const cuotaEf = irpfPresentes.includes('irpf_cuota') ? irpfNuevos.irpf_cuota : (archivo.irpf_cuota != null ? Number(archivo.irpf_cuota) : null);
  if (baseEf != null && cuotaEf != null && cuotaEf > baseEf + 0.01) {
    return res.status(400).json({ ok: false, error: `irpf_cuota (${cuotaEf}) no puede ser mayor que irpf_base (${baseEf})` });
  }

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

  const hayCambiosJson = Object.keys(cambios).length > 0;
  if (!hayCambiosJson && siiPresentes.length === 0 && rectPresentes.length === 0 && irpfPresentes.length === 0) {
    return res.status(400).json({ ok: false, error: 'No hay campos que modificar' });
  }

  const nuevosDatos = hayCambiosJson ? { ...datosActuales, ...cambios } : datosActuales;

  if (hayCambiosJson) {
    await db.query(
      'UPDATE drive_archivos SET datos_extraidos = $1 WHERE id = $2',
      [JSON.stringify(nuevosDatos), id]
    );
  }

  for (const c of siiPresentes) {
    // Nombre de columna inyectado en SQL: c proviene de CAMPOS_SII_FACTURA (lista blanca).
    await db.query(`UPDATE drive_archivos SET ${c} = $1 WHERE id = $2`, [siiNuevos[c], id]);
    anteriores[c] = archivo[c] ?? null;
    cambios[c] = siiNuevos[c];
  }

  for (const c of rectPresentes) {
    // Nombre de columna de CAMPOS_RECT_FACTURA (lista blanca). rect_fecha va como string
    // YYYY-MM-DD y Postgres lo castea al tipo DATE de la columna.
    await db.query(`UPDATE drive_archivos SET ${c} = $1 WHERE id = $2`, [rectNuevos[c], id]);
    anteriores[c] = archivo[c] ?? null;
    cambios[c] = rectNuevos[c];
  }

  for (const c of irpfPresentes) {
    // Nombre de columna de CAMPOS_IRPF_FACTURA (lista blanca). NUMERIC(14,2) en BD,
    // el driver pg acepta number directamente.
    await db.query(`UPDATE drive_archivos SET ${c} = $1 WHERE id = $2`, [irpfNuevos[c], id]);
    anteriores[c] = archivo[c] != null ? Number(archivo[c]) : null;
    cambios[c] = irpfNuevos[c];
  }

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

  // Responder con el valor actual de los 13 campos SII + rectificativa + IRPF (nuevo
  // si se edito, previo en caso contrario). El frontend lo usa para update optimista.
  const siiResp = {};
  for (const c of CAMPOS_SII_FACTURA) {
    siiResp[c] = siiPresentes.includes(c) ? siiNuevos[c] : (archivo[c] ?? null);
  }
  const rectResp = {};
  for (const c of CAMPOS_RECT_FACTURA) {
    if (rectPresentes.includes(c)) {
      rectResp[c] = rectNuevos[c];
    } else if (c === 'rect_fecha' && archivo.rect_fecha instanceof Date) {
      // El driver pg devuelve DATE como Date. Formatear a ISO para el input date-picker.
      rectResp[c] = archivo.rect_fecha.toISOString().slice(0, 10);
    } else {
      rectResp[c] = archivo[c] ?? null;
    }
  }
  const irpfResp = {};
  for (const c of CAMPOS_IRPF_FACTURA) {
    if (irpfPresentes.includes(c)) {
      irpfResp[c] = irpfNuevos[c];
    } else {
      irpfResp[c] = archivo[c] != null ? Number(archivo[c]) : null;
    }
  }
  res.json({ ok: true, data: { datos_extraidos: nuevosDatos, ...siiResp, ...rectResp, ...irpfResp } });
});

// ─── GET /api/drive/carpetas — listar carpetas de proveedores en Drive ───────

router.get('/carpetas', requireAdmin, async (req, res) => {
  try {
    const drive = await buildDriveClient();
    const carpetas = await listarCarpetasRaiz(drive);

    // Contar archivos en cada carpeta (paralelo con límite)
    const BATCH = 5;
    const resultado = [];
    for (let i = 0; i < carpetas.length; i += BATCH) {
      const lote = carpetas.slice(i, i + BATCH);
      const conConteos = await Promise.all(
        lote.map(async c => {
          const count = await contarArchivosCarpeta(drive, c.id);
          return { ...c, archivos: count };
        })
      );
      resultado.push(...conConteos);
    }

    res.json({ ok: true, data: resultado });
  } catch (err) {
    logger.error({ err: err.message }, 'Drive: error listando carpetas');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/drive/carpetas — crear nueva carpeta de proveedor ─────────────

router.post('/carpetas', requireAdmin, async (req, res) => {
  try {
    const { nombre } = req.body;
    if (!nombre?.trim()) {
      return res.status(400).json({ ok: false, error: 'El nombre de la carpeta es obligatorio' });
    }

    const drive = await buildDriveClient();

    // Verificar que no exista ya una carpeta con ese nombre
    const existentes = await listarCarpetasRaiz(drive);
    const yaExiste = existentes.find(c => c.name.toLowerCase() === nombre.trim().toLowerCase());
    if (yaExiste) {
      return res.status(409).json({ ok: false, error: `Ya existe una carpeta "${yaExiste.name}"` });
    }

    const carpeta = await crearCarpeta(drive, nombre.trim());
    res.json({ ok: true, data: { ...carpeta, archivos: 0 } });
  } catch (err) {
    logger.error({ err: err.message }, 'Drive: error creando carpeta');
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/drive/upload-universal — subida ciega de facturas ─────────────

router.post('/upload-universal', requireAuth, upload.array('archivos', 20), async (req, res) => {
  const { carpeta_id } = req.body;
  if (!carpeta_id) {
    return res.status(400).json({ ok: false, error: 'carpeta_id es obligatorio' });
  }
  if (!req.files?.length) {
    return res.status(400).json({ ok: false, error: 'No se han enviado archivos' });
  }

  const db = getDb();

  try {
    const drive = await buildDriveClient();

    // Verificar que la carpeta existe y obtener su nombre (= proveedor)
    const carpetaInfo = await obtenerCarpeta(drive, carpeta_id);
    const nombreProveedor = carpetaInfo.name;

    const resultados = [];

    for (const file of req.files) {
      try {
        // 1. Subir a Drive
        const driveFile = await subirArchivo(drive, carpeta_id, file.originalname, file.buffer, file.mimetype);

        // 2. Insertar en drive_archivos como SINCRONIZADA
        const row = await db.one(
          `INSERT INTO drive_archivos (google_id, nombre_archivo, ruta_completa, proveedor, fecha_subida, estado)
           VALUES ($1, $2, $3, $4, $5, 'SINCRONIZADA')
           ON CONFLICT (google_id) DO UPDATE SET
             nombre_archivo = EXCLUDED.nombre_archivo,
             ruta_completa  = EXCLUDED.ruta_completa,
             proveedor      = EXCLUDED.proveedor,
             ultima_sync    = NOW()
           RETURNING id`,
          [driveFile.id, file.originalname, `${nombreProveedor}/${file.originalname}`, nombreProveedor, driveFile.createdTime || new Date().toISOString()]
        );

        resultados.push({ nombre: file.originalname, id: row.id, google_id: driveFile.id, ok: true });
      } catch (e) {
        logger.error({ archivo: file.originalname, err: e.message }, 'Upload: error subiendo archivo');
        resultados.push({ nombre: file.originalname, ok: false, error: e.message });
      }
    }

    const idsSubidos = resultados.filter(r => r.ok).map(r => r.id);

    // 3. Lanzar extracción con Gemini en background (no bloquear respuesta)
    if (idsSubidos.length > 0) {
      setImmediate(async () => {
        try {
          logger.info({ facturas: idsSubidos.length }, 'Upload: extrayendo facturas con Gemini');
          await ejecutarExtraccion(idsSubidos);

          // 4. Asignar empresa_id por CIF receptor
          await db.query(`
            UPDATE drive_archivos da SET empresa_id = e.id
            FROM empresas e
            WHERE da.id = ANY($1::int[])
              AND da.empresa_id IS NULL
              AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
              AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_receptor') = normalizar_cif(e.cif)
          `, [idsSubidos]);

          // 5. Crear empresas nuevas si CIF receptor no registrado
          const sinEmpresa = await db.all(`
            SELECT DISTINCT
              UPPER(TRIM((da.datos_extraidos::jsonb)->>'cif_receptor')) AS cif,
              (da.datos_extraidos::jsonb)->>'nombre_receptor' AS nombre
            FROM drive_archivos da
            WHERE da.id = ANY($1::int[])
              AND da.empresa_id IS NULL
              AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
              AND (da.datos_extraidos::jsonb)->>'cif_receptor' IS NOT NULL
              AND TRIM((da.datos_extraidos::jsonb)->>'cif_receptor') <> ''
          `, [idsSubidos]);

          for (const { cif, nombre } of sinEmpresa) {
            if (!cif) continue;
            try {
              await db.query(
                `INSERT INTO empresas (nombre, cif) VALUES ($1, $2) ON CONFLICT (cif) DO NOTHING`,
                [nombre?.trim() || cif, cif]
              );
            } catch {}
          }

          if (sinEmpresa.length > 0) {
            await db.query(`
              UPDATE drive_archivos da SET empresa_id = e.id
              FROM empresas e
              WHERE da.id = ANY($1::int[])
                AND da.empresa_id IS NULL
                AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
                AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_receptor') = normalizar_cif(e.cif)
            `, [idsSubidos]);
          }

          // 6. Auto-transición a CC_ASIGNADA si proveedor tiene cuentas
          await db.query(`
            UPDATE drive_archivos da
            SET estado_gestion = 'CC_ASIGNADA',
                cuenta_gasto_id = pe.cuenta_gasto_id
            FROM proveedores p
            JOIN proveedor_empresa pe ON pe.proveedor_id = p.id AND pe.empresa_id = da.empresa_id
            WHERE da.id = ANY($1::int[])
              AND da.estado = 'PROCESADA'
              AND da.estado_gestion = 'PENDIENTE'
              AND pe.cuenta_gasto_id IS NOT NULL
              AND pe.cuenta_contable_id IS NOT NULL
              AND (
                (p.cif IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
                 AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p.cif))
                OR p.nombre_carpeta = da.proveedor
              )
          `, [idsSubidos]);

          logger.info({ facturas: idsSubidos.length }, 'Upload: procesamiento completado');
          const { broadcast } = require('../services/sseService');
          broadcast('upload_complete', { count: idsSubidos.length });
        } catch (e) {
          logger.error({ err: e.message }, 'Upload: error en procesamiento post-subida');
        }
      });
    }

    res.json({
      ok: true,
      data: {
        subidos:  resultados.filter(r => r.ok).length,
        errores:  resultados.filter(r => !r.ok).length,
        archivos: resultados,
        mensaje:  idsSubidos.length > 0
          ? 'Facturas recibidas. El sistema esta identificando al receptor y clasificando los documentos...'
          : 'No se pudo subir ningun archivo',
      },
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Upload: error general');
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
