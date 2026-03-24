const express   = require('express');
const router    = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin } = require('../middleware/auth');

router.use(resolveUser);

// GET / - listar cuentas (con búsqueda opcional ?q=)
router.get('/', async (req, res) => {
  const db = getDb();
  const { q } = req.query;
  const rows = q
    ? await db.all(
        `SELECT * FROM plan_contable WHERE activo = true AND (codigo ILIKE $1 OR descripcion ILIKE $1) ORDER BY codigo`,
        [`%${q}%`]
      )
    : await db.all(`SELECT * FROM plan_contable WHERE activo = true ORDER BY codigo`);
  res.json({ ok: true, data: rows });
});

// POST / - añadir cuenta personalizada (solo admin)
router.post('/', requireAdmin, async (req, res) => {
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
});

module.exports = router;
