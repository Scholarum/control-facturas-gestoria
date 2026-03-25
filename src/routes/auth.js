const express = require('express');
const router  = express.Router();

const { login }      = require('../services/authService');
const { resolveUser, requireAuth } = require('../middleware/auth');
const { getDb }      = require('../config/database');

// ─── Helper: obtener permisos de un rol ───────────────────────────────────────

async function getPermisos(rolNombre) {
  const db   = getDb();
  const rows = await db.all(
    `SELECT rp.recurso, rp.nivel
     FROM rol_permisos rp
     JOIN roles r ON r.id = rp.rol_id
     WHERE r.nombre = $1`,
    [rolNombre]
  );
  return rows.reduce((acc, { recurso, nivel }) => { acc[recurso] = nivel; return acc; }, {});
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });
  }
  try {
    const { token, user } = await login(email, password);
    const permisos = await getPermisos(user.rol);
    res.json({ ok: true, data: { token, user, permisos } });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', resolveUser, requireAuth, async (req, res) => {
  try {
    const { password_hash: _, ...user } = req.usuario;
    const permisos = await getPermisos(user.rol);
    res.json({ ok: true, data: { user, permisos } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
