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
    // Buscar en facturas: nombre_archivo, proveedor, datos_extraidos (num factura, CIF)
    db.all(`
      SELECT id, nombre_archivo, proveedor, estado_gestion,
             CASE WHEN datos_extraidos ~ '^\\s*\\{' THEN datos_extraidos::jsonb->>'numero_factura' END AS numero_factura,
             CASE WHEN datos_extraidos ~ '^\\s*\\{' THEN datos_extraidos::jsonb->>'total_factura'  END AS total_factura
      FROM drive_archivos
      WHERE ($2::int IS NULL OR empresa_id = $2)
        AND (
          nombre_archivo ILIKE $1
          OR proveedor ILIKE $1
          OR (datos_extraidos ~ '^\\s*\\{' AND (
            datos_extraidos::jsonb->>'numero_factura' ILIKE $1
            OR datos_extraidos::jsonb->>'cif_emisor' ILIKE $1
          ))
        )
      ORDER BY id DESC
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
