const express = require('express');
const router  = express.Router();

const { login, signToken } = require('../services/authService');
const { resolveUser, requireAuth } = require('../middleware/auth');
const { getDb }      = require('../config/database');
const { getSistemaConfig } = require('../services/sistemaConfigService');

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
    const config   = await getSistemaConfig();
    res.json({ ok: true, data: { token, user, permisos, modo_gestoria: config.modo_gestoria } });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ─── POST /api/auth/google ────────────────────────────────────────────────────

router.post('/google', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) {
    return res.status(400).json({ ok: false, error: 'Token de Google requerido' });
  }
  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!infoRes.ok) {
      return res.status(401).json({ ok: false, error: 'Token de Google inválido' });
    }
    const info  = await infoRes.json();
    const email = (info.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(401).json({ ok: false, error: 'No se pudo obtener el email de Google' });
    }

    const db   = getDb();
    const user = await db.one(
      "SELECT id, nombre, email, rol, activo, created_at FROM usuarios WHERE email = $1",
      [email]
    );

    if (!user || !user.activo) {
      return res.status(401).json({
        ok: false,
        error: 'Tu email no se encuentra en la plataforma. Contacta con el administrador para que te cree un usuario.',
      });
    }

    const token    = signToken({ id: user.id, rol: user.rol });
    const permisos = await getPermisos(user.rol);
    const config   = await getSistemaConfig();
    res.json({ ok: true, data: { token, user, permisos, modo_gestoria: config.modo_gestoria } });
  } catch (err) {
    res.status(500).json({ ok: false, error: 'Error al verificar el token de Google' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', resolveUser, requireAuth, async (req, res) => {
  try {
    const { password_hash: _, ...user } = req.usuario;
    const permisos = await getPermisos(user.rol);
    const config   = await getSistemaConfig();
    res.json({ ok: true, data: { user, permisos, modo_gestoria: config.modo_gestoria } });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
