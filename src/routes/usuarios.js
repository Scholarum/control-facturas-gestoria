const express = require('express');
const router  = express.Router();

const { getDb }         = require('../config/database');
const { hashPassword }  = require('../services/authService');
const { resolveUser, requireAuth, requireAdmin } = require('../middleware/auth');

router.use(resolveUser, requireAuth);

function safeUser(u) {
  const { password_hash: _, ...rest } = u;
  return rest;
}

// ─── GET /api/usuarios ────────────────────────────────────────────────────────

router.get('/', requireAdmin, async (req, res) => {
  const db = getDb();
  const usuarios = await db.all(
    'SELECT id, nombre, email, rol, activo, created_at FROM usuarios ORDER BY id'
  );
  res.json({ ok: true, data: usuarios });
});

// ─── POST /api/usuarios ───────────────────────────────────────────────────────

router.post('/', requireAdmin, async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password) {
    return res.status(400).json({ ok: false, error: 'nombre, email y contraseña son obligatorios' });
  }
  if (!['ADMIN', 'GESTORIA'].includes(rol)) {
    return res.status(400).json({ ok: false, error: 'rol debe ser ADMIN o GESTORIA' });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const db   = getDb();
  const hash = hashPassword(password);
  try {
    const result = await db.query(
      `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
       VALUES ($1, $2, $3, $4, 1)
       RETURNING id`,
      [nombre.trim(), email.trim().toLowerCase(), hash, rol]
    );
    const user = await db.one(
      'SELECT id, nombre, email, rol, activo, created_at FROM usuarios WHERE id = $1',
      [result.rows[0].id]
    );
    res.status(201).json({ ok: true, data: user });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ya existe un usuario con ese email' });
    }
    throw err;
  }
});

// ─── PUT /api/usuarios/:id ────────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const self = req.usuario.id === id;
  const isAdmin = req.usuario.rol === 'ADMIN';

  if (!self && !isAdmin) {
    return res.status(403).json({ ok: false, error: 'Solo puedes editar tu propio perfil' });
  }

  const { nombre, email, rol, activo } = req.body;
  const db   = getDb();
  const user = await db.one('SELECT * FROM usuarios WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

  const nuevoNombre = nombre?.trim() || user.nombre;
  const nuevoEmail  = email ? email.trim().toLowerCase() : user.email;
  const nuevoRol    = (isAdmin && rol && ['ADMIN','GESTORIA'].includes(rol)) ? rol : user.rol;
  const nuevoActivo = (isAdmin && activo !== undefined) ? (activo ? 1 : 0) : user.activo;

  try {
    await db.query(
      "UPDATE usuarios SET nombre=$1, email=$2, rol=$3, activo=$4 WHERE id=$5",
      [nuevoNombre, nuevoEmail, nuevoRol, nuevoActivo, id]
    );
    const updated = await db.one(
      'SELECT id, nombre, email, rol, activo, created_at FROM usuarios WHERE id = $1',
      [id]
    );
    res.json({ ok: true, data: updated });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ ok: false, error: 'Ese email ya está en uso' });
    }
    throw err;
  }
});

// ─── PUT /api/usuarios/:id/password ──────────────────────────────────────────

router.put('/:id/password', async (req, res) => {
  const id   = parseInt(req.params.id, 10);
  const self = req.usuario.id === id;
  const isAdmin = req.usuario.rol === 'ADMIN';

  if (!self && !isAdmin) {
    return res.status(403).json({ ok: false, error: 'No tienes permiso para cambiar esta contraseña' });
  }

  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres' });
  }

  const db   = getDb();
  const user = await db.one('SELECT id FROM usuarios WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });

  await db.query(
    "UPDATE usuarios SET password_hash = $1 WHERE id = $2",
    [hashPassword(password), id]
  );
  res.json({ ok: true });
});

// ─── DELETE /api/usuarios/:id ─────────────────────────────────────────────────

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.usuario.id) {
    return res.status(400).json({ ok: false, error: 'No puedes desactivarte a ti mismo' });
  }
  const db   = getDb();
  const user = await db.one('SELECT id FROM usuarios WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
  await db.query("UPDATE usuarios SET activo = 0 WHERE id = $1", [id]);
  res.json({ ok: true });
});

module.exports = router;
