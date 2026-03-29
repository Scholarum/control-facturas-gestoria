const express = require('express');
const router  = express.Router();
const logger  = require('../config/logger');

const { getDb }                    = require('../config/database');
const { registrarEvento, EVENTOS } = require('../services/auditService');
const { resolveUser, requireAuth } = require('../middleware/auth');
const { generarCSV, generarNombreFichero, calcularTotales } = require('../services/a3Service');

router.use(resolveUser);
router.use(requireAuth);

// ─── POST /api/exportacion-a3/exportar ────────────────────────────────────────

router.post('/exportar', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

    const db = getDb();

    const archivos = await db.all(`
      SELECT
        da.id, da.nombre_archivo, da.proveedor, da.datos_extraidos,
        COALESCE(da.cuenta_gasto_id, p.cuenta_gasto_id)  AS cg_efectiva_id,
        COALESCE(cgd.codigo, pg.codigo)                   AS cuenta_gasto_codigo,
        cc.codigo                                         AS cta_proveedor_codigo
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
      WHERE da.id = ANY($1::int[])
    `, [ids]);

    if (!archivos.length) return res.status(404).json({ ok: false, error: 'Archivos no encontrados' });

    const archivosConDatos = archivos.map(a => ({
      ...a,
      datos_extraidos: a.datos_extraidos ? JSON.parse(a.datos_extraidos) : {},
    }));

    const sinCG = archivosConDatos.filter(a => !a.cuenta_gasto_codigo);
    if (sinCG.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `${sinCG.length} factura(s) sin cuenta de gasto asignada`,
        ids_sin_cg: sinCG.map(a => a.id),
      });
    }

    const sinCP = archivosConDatos.filter(a => !a.cta_proveedor_codigo);
    if (sinCP.length > 0) {
      return res.status(400).json({
        ok: false,
        error: `${sinCP.length} factura(s) sin cuenta contable de proveedor`,
        ids_sin_cp: sinCP.map(a => a.id),
      });
    }

    const nombreFichero = generarNombreFichero();
    const contenidoCsv  = generarCSV(archivosConDatos);
    const totales       = calcularTotales(archivosConDatos);

    const usuarioId     = req.usuario?.id     ?? null;
    const usuarioNombre = req.usuario?.nombre ?? null;

    const lote = await db.one(`
      INSERT INTO lotes_exportacion_a3
        (usuario_id, usuario_nombre, nombre_fichero, num_facturas,
         total_base, total_cuota, total_factura, ids_facturas, contenido_csv)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      RETURNING id, fecha, nombre_fichero, num_facturas, total_base, total_cuota, total_factura
    `, [
      usuarioId, usuarioNombre, nombreFichero, archivos.length,
      totales.base, totales.cuota, totales.factura,
      JSON.stringify(ids), contenidoCsv,
    ]);

    await db.query(
      `UPDATE drive_archivos SET estado_gestion = 'CONTABILIZADA', lote_a3_id = $1
       WHERE id = ANY($2::int[])`,
      [lote.id, ids]
    );

    registrarEvento({
      evento:    EVENTOS.EXPORT_A3,
      usuarioId,
      ip:        req.clientIp,
      userAgent: req.userAgent,
      detalle:   { lote_id: lote.id, nombre_fichero: nombreFichero, count: archivos.length },
    }).catch(() => {});

    res.json({ ok: true, data: { lote, nombre_fichero: nombreFichero, contenido_csv: contenidoCsv, totales } });
  } catch (e) {
    logger.error({ err: e }, 'exportacionA3 error en exportar');
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── GET /api/exportacion-a3 ──────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const db    = getDb();
    const lotes = await db.all(`
      SELECT id, fecha, usuario_id, usuario_nombre, nombre_fichero,
             num_facturas, total_base, total_cuota, total_factura, ids_facturas
      FROM lotes_exportacion_a3
      ORDER BY fecha DESC
    `);
    res.json({ ok: true, data: lotes });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── GET /api/exportacion-a3/:id/descargar ────────────────────────────────────

router.get('/:id/descargar', async (req, res) => {
  try {
    const id   = parseInt(req.params.id, 10);
    const db   = getDb();
    const lote = await db.one(
      'SELECT nombre_fichero, contenido_csv FROM lotes_exportacion_a3 WHERE id = $1',
      [id]
    );
    if (!lote) return res.status(404).json({ ok: false, error: 'Lote no encontrado' });

    res.set({
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${lote.nombre_fichero}"`,
    });
    res.send(lote.contenido_csv);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
