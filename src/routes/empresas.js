const express = require('express');
const router  = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin, requireAuth } = require('../middleware/auth');

// GET / — listar empresas activas
router.get('/', requireAuth, async (req, res) => {
  const db = getDb();
  const rows = await db.all('SELECT * FROM empresas WHERE activo = true ORDER BY nombre');
  res.json({ ok: true, data: rows });
});

// POST / — crear empresa (admin)
router.post('/', requireAdmin, express.json(), async (req, res) => {
  const { nombre, cif } = req.body;
  if (!nombre?.trim() || !cif?.trim()) return res.status(400).json({ ok: false, error: 'nombre y cif requeridos' });
  const db = getDb();
  try {
    const row = await db.one(
      'INSERT INTO empresas (nombre, cif) VALUES ($1, $2) RETURNING *',
      [nombre.trim(), cif.trim().toUpperCase()]
    );
    res.json({ ok: true, data: row });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe una empresa con ese CIF' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /:id — editar empresa (admin)
router.put('/:id', requireAdmin, express.json(), async (req, res) => {
  const { nombre, cif } = req.body;
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const row = await db.one(
    'UPDATE empresas SET nombre = $1, cif = $2 WHERE id = $3 AND activo = true RETURNING *',
    [nombre?.trim(), cif?.trim().toUpperCase(), id]
  );
  if (!row) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
  res.json({ ok: true, data: row });
});

module.exports = router;
