const express = require('express');
const router  = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAuth, requireAdmin } = require('../middleware/auth');

router.use(resolveUser, requireAuth);

// GET / — listar pendientes de validación
router.get('/', async (_req, res) => {
  const db = getDb();
  const rows = await db.all(`
    SELECT pv.*, da.ruta_completa
    FROM pendientes_validacion pv
    LEFT JOIN drive_archivos da ON da.id = pv.drive_archivo_id
    ORDER BY pv.created_at DESC
  `);
  res.json({ ok: true, data: rows });
});

// GET /count — solo el conteo (para el banner)
router.get('/count', async (_req, res) => {
  const db = getDb();
  const row = await db.one('SELECT COUNT(*) AS n FROM pendientes_validacion');
  res.json({ ok: true, data: { count: parseInt(row.n, 10) } });
});

// POST /:id/confirmar — crear empresa + mover factura
router.post('/:id/confirmar', requireAdmin, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const pv = await db.one('SELECT * FROM pendientes_validacion WHERE id = $1', [id]);
  if (!pv) return res.status(404).json({ ok: false, error: 'Registro no encontrado' });

  const { nombre } = req.body;
  const nombreFinal = nombre?.trim() || pv.nombre_receptor || pv.cif_receptor;

  // Crear empresa (o encontrar existente por CIF)
  let empresa = await db.one(
    'SELECT * FROM empresas WHERE normalizar_cif(cif) = normalizar_cif($1)',
    [pv.cif_receptor]
  );

  if (!empresa) {
    empresa = await db.one(
      `INSERT INTO empresas (nombre, cif) VALUES ($1, $2)
       ON CONFLICT (cif) DO UPDATE SET nombre = EXCLUDED.nombre
       RETURNING *`,
      [nombreFinal, pv.cif_receptor]
    );
  }

  // Asignar la factura a la empresa
  if (pv.drive_archivo_id) {
    await db.query(
      'UPDATE drive_archivos SET empresa_id = $1 WHERE id = $2 AND empresa_id IS NULL',
      [empresa.id, pv.drive_archivo_id]
    );
  }

  // Eliminar de cuarentena
  await db.query('DELETE FROM pendientes_validacion WHERE id = $1', [id]);

  const logger = require('../config/logger');
  logger.info({ empresa: empresa.nombre, cif: empresa.cif, drive_id: pv.drive_archivo_id }, 'Empresa confirmada desde validación');

  res.json({ ok: true, data: { empresa, drive_archivo_id: pv.drive_archivo_id } });
});

// DELETE /:id — rechazar / error de lectura
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const pv = await db.one('SELECT * FROM pendientes_validacion WHERE id = $1', [id]);
  if (!pv) return res.status(404).json({ ok: false, error: 'Registro no encontrado' });

  await db.query('DELETE FROM pendientes_validacion WHERE id = $1', [id]);

  res.json({ ok: true, data: { eliminado: id, nombre_archivo: pv.nombre_archivo } });
});

module.exports = router;
