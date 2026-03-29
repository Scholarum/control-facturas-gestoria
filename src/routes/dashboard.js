const express = require('express');
const { getDb } = require('../config/database');
const { resolveUser, requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(resolveUser, requireAuth);

// GET /api/dashboard?empresa_id=N
router.get('/', async (req, res) => {
  const empresaId = req.query.empresa_id;
  const db = getDb();
  const empFilter = empresaId ? 'AND empresa_id = $1' : '';
  const params = empresaId ? [empresaId] : [];

  const [porMes, porEstado, porProveedor, totales] = await Promise.all([

    // Facturas por mes (últimos 12 meses)
    db.all(`
      SELECT
        to_char(date_trunc('month', COALESCE(
          CASE WHEN datos_extraidos ~ '^\\s*\\{' THEN (datos_extraidos::jsonb->>'fecha_emision')::date END,
          fecha_subida::date
        )), 'YYYY-MM') AS mes,
        COUNT(*)::int AS total,
        SUM(CASE WHEN datos_extraidos ~ '^\\s*\\{' THEN (datos_extraidos::jsonb->>'total_factura')::numeric ELSE 0 END) AS importe
      FROM drive_archivos
      WHERE 1=1 ${empFilter}
      GROUP BY mes
      ORDER BY mes DESC
      LIMIT 12
    `, params),

    // Por estado de gestión
    db.all(`
      SELECT COALESCE(estado_gestion, 'PENDIENTE') AS estado, COUNT(*)::int AS total
      FROM drive_archivos
      WHERE 1=1 ${empFilter}
      GROUP BY COALESCE(estado_gestion, 'PENDIENTE')
      ORDER BY total DESC
    `, params),

    // Top 10 proveedores por importe
    db.all(`
      SELECT
        COALESCE(proveedor, 'Sin proveedor') AS proveedor,
        COUNT(*)::int AS facturas,
        SUM(CASE WHEN datos_extraidos ~ '^\\s*\\{' THEN (datos_extraidos::jsonb->>'total_factura')::numeric ELSE 0 END) AS importe
      FROM drive_archivos
      WHERE 1=1 ${empFilter}
      GROUP BY proveedor
      ORDER BY importe DESC
      LIMIT 10
    `, params),

    // Totales generales
    db.one(`
      SELECT
        COUNT(*)::int AS total_facturas,
        COUNT(DISTINCT proveedor)::int AS total_proveedores,
        SUM(CASE WHEN datos_extraidos ~ '^\\s*\\{' THEN (datos_extraidos::jsonb->>'total_factura')::numeric ELSE 0 END) AS importe_total,
        COUNT(*) FILTER (WHERE COALESCE(estado_gestion,'PENDIENTE') = 'PENDIENTE')::int AS pendientes
      FROM drive_archivos
      WHERE 1=1 ${empFilter}
    `, params),
  ]);

  res.json({ ok: true, data: { porMes: porMes.reverse(), porEstado, porProveedor, totales } });
});

module.exports = router;
