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
  // Cargar empresas asignadas a cada usuario
  const ue = await db.all('SELECT ue.usuario_id, e.id AS empresa_id, e.nombre FROM usuario_empresa ue JOIN empresas e ON e.id = ue.empresa_id WHERE e.activo = true');
  const ueMap = {};
  for (const r of ue) {
    if (!ueMap[r.usuario_id]) ueMap[r.usuario_id] = [];
    ueMap[r.usuario_id].push({ id: r.empresa_id, nombre: r.nombre });
  }
  const data = usuarios.map(u => ({ ...u, empresas: ueMap[u.id] || [] }));
  res.json({ ok: true, data });
});

// ─── POST /api/usuarios ───────────────────────────────────────────────────────

router.post('/', requireAdmin, async (req, res) => {
  const { nombre, email, password, rol } = req.body;
  if (!nombre || !email || !password) {
    return res.status(400).json({ ok: false, error: 'nombre, email y contraseña son obligatorios' });
  }
  // Validar que el rol existe
  const db2   = getDb();
  const roles = await db2.all('SELECT nombre FROM roles WHERE activo = true');
  const nombresRoles = roles.map(r => r.nombre);
  if (!nombresRoles.includes(rol)) {
    return res.status(400).json({ ok: false, error: `Rol inválido. Roles disponibles: ${nombresRoles.join(', ')}` });
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
  let nuevoRol = user.rol;
  if (isAdmin && rol) {
    const db3   = getDb();
    const roles = await db3.all('SELECT nombre FROM roles WHERE activo = true');
    if (roles.some(r => r.nombre === rol)) nuevoRol = rol;
  }
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

const USUARIOS_PROTEGIDOS = ['roberto@scholarum.es'];

router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (id === req.usuario.id) {
    return res.status(400).json({ ok: false, error: 'No puedes desactivarte a ti mismo' });
  }
  const db   = getDb();
  const user = await db.one('SELECT id, email FROM usuarios WHERE id = $1', [id]);
  if (!user) return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
  if (USUARIOS_PROTEGIDOS.includes(user.email?.toLowerCase())) {
    return res.status(400).json({ ok: false, error: 'Este usuario esta protegido y no se puede desactivar' });
  }
  await db.query("UPDATE usuarios SET activo = 0 WHERE id = $1", [id]);
  res.json({ ok: true });
});

// ─── GET /api/usuarios/:id/empresas — empresas asignadas al usuario ──────────

router.get('/:id/empresas', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const rows = await db.all(
    `SELECT e.id, e.nombre, e.cif FROM empresas e
     JOIN usuario_empresa ue ON ue.empresa_id = e.id
     WHERE ue.usuario_id = $1 AND e.activo = true ORDER BY e.nombre`,
    [id]
  );
  res.json({ ok: true, data: rows });
});

// ─── PUT /api/usuarios/:id/empresas — asignar empresas al usuario ───────────

router.put('/:id/empresas', requireAdmin, express.json(), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { empresa_ids } = req.body; // array de IDs
  if (!Array.isArray(empresa_ids)) return res.status(400).json({ ok: false, error: 'empresa_ids debe ser un array' });

  const db = getDb();
  // Borrar asignaciones actuales y recrear
  await db.query('DELETE FROM usuario_empresa WHERE usuario_id = $1', [id]);
  for (const empId of empresa_ids) {
    await db.query(
      'INSERT INTO usuario_empresa (usuario_id, empresa_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, parseInt(empId, 10)]
    );
  }
  res.json({ ok: true });
});

module.exports = router;
