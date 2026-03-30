const express = require('express');
const { getDb } = require('../config/database');
const { resolveUser, requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(resolveUser, requireAuth);

// GET /api/busqueda?q=texto&empresa_id=N
router.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ ok: true, data: { facturas: [], proveedores: [] } });

  const empresaId = req.query.empresa_id;
  const db = getDb();
  const like = `%${q}%`;

  const [facturas, proveedores] = await Promise.all([
    // Buscar en facturas: nombre_archivo, proveedor (carpeta y razon_social), num factura, CIF
    db.all(`
      SELECT da.id, da.nombre_archivo, da.proveedor, da.estado_gestion,
             COALESCE(p.razon_social, da.datos_extraidos::jsonb->>'nombre_emisor', da.proveedor) AS proveedor_nombre,
             CASE WHEN da.datos_extraidos ~ '^\\s*\\{' THEN da.datos_extraidos::jsonb->>'numero_factura' END AS numero_factura,
             CASE WHEN da.datos_extraidos ~ '^\\s*\\{' THEN da.datos_extraidos::jsonb->>'total_factura'  END AS total_factura
      FROM drive_archivos da
      LEFT JOIN LATERAL (
        SELECT p2.razon_social FROM proveedores p2
        WHERE p2.activo = true AND p2.cif IS NOT NULL
          AND da.datos_extraidos ~ '^\\s*\\{'
          AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p2.cif)
        LIMIT 1
      ) p ON true
      WHERE ($2::int IS NULL OR da.empresa_id = $2)
        AND (
          da.nombre_archivo ILIKE $1
          OR da.proveedor ILIKE $1
          OR p.razon_social ILIKE $1
          OR (da.datos_extraidos ~ '^\\s*\\{' AND (
            da.datos_extraidos::jsonb->>'numero_factura' ILIKE $1
            OR da.datos_extraidos::jsonb->>'cif_emisor' ILIKE $1
          ))
        )
      ORDER BY da.id DESC
      LIMIT 10
    `, [like, empresaId || null]),

    // Buscar en proveedores: razon_social, CIF, nombre_carpeta
    db.all(`
      SELECT id, razon_social, cif, nombre_carpeta
      FROM proveedores
      WHERE activo = true
        AND (razon_social ILIKE $1 OR cif ILIKE $1 OR nombre_carpeta ILIKE $1)
      ORDER BY razon_social
      LIMIT 5
    `, [like]),
  ]);

  res.json({ ok: true, data: { facturas, proveedores } });
});

module.exports = router;
