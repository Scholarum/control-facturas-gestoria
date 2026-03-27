const express   = require('express');
const router    = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin } = require('../middleware/auth');

router.use(resolveUser);

// GET / - listar cuentas (con búsqueda opcional ?q= y filtro ?empresa=)
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const { q, empresa } = req.query;
    const empresaId = parseInt(empresa, 10) || null;
    const filtroEmpresa = empresaId ? `AND (empresa_id = ${empresaId} OR empresa_id IS NULL)` : '';
    const rows = q
      ? await db.all(
          `SELECT * FROM plan_contable WHERE activo = true ${filtroEmpresa} AND (codigo ILIKE $1 OR descripcion ILIKE $1) ORDER BY codigo`,
          [`%${q}%`]
        )
      : await db.all(`SELECT * FROM plan_contable WHERE activo = true ${filtroEmpresa} ORDER BY codigo`);
    res.json({ ok: true, data: rows });
  } catch (err) {
    console.error('[plan-contable] GET error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST / - añadir cuenta personalizada (solo admin)
router.post('/', requireAdmin, async (req, res) => {
  try {
    const { codigo, descripcion, grupo } = req.body;
    if (!codigo?.trim() || !descripcion?.trim()) {
      return res.status(400).json({ ok: false, error: 'codigo y descripcion requeridos' });
    }
    const db  = getDb();
    const row = await db.one(
      `INSERT INTO plan_contable (codigo, descripcion, grupo)
       VALUES ($1, $2, $3)
       ON CONFLICT (codigo) DO UPDATE SET descripcion = EXCLUDED.descripcion, activo = true
       RETURNING *`,
      [codigo.trim(), descripcion.trim(), grupo?.trim() || codigo.trim().charAt(0)]
    );
    res.json({ ok: true, data: row });
  } catch (err) {
    console.error('[plan-contable] POST error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// DELETE /:id - eliminar subcuenta (solo si es subcuenta y no está en uso)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const cuenta = await db.one('SELECT * FROM plan_contable WHERE id = $1', [id]);
    if (!cuenta) return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });

    // Solo permitir eliminar subcuentas (codigo > 4 dígitos)
    if (cuenta.codigo.length <= 4) {
      return res.status(400).json({ ok: false, error: 'No se pueden eliminar cuentas principales del plan contable' });
    }

    // Verificar que no esté en uso
    const enUso = await db.one(
      `SELECT EXISTS(
        SELECT 1 FROM proveedores WHERE cuenta_contable_id = $1 OR cuenta_gasto_id = $1
      ) OR EXISTS(
        SELECT 1 FROM drive_archivos WHERE cuenta_gasto_id = $1
      ) AS en_uso`,
      [id]
    );
    if (enUso?.en_uso) {
      return res.status(400).json({ ok: false, error: 'La cuenta esta en uso por proveedores o facturas' });
    }

    await db.query('DELETE FROM plan_contable WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
