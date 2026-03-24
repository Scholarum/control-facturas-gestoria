const express = require('express');
const router  = express.Router();

const { login }      = require('../services/authService');
const { resolveUser, requireAuth } = require('../middleware/auth');

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ ok: false, error: 'Email y contraseña requeridos' });
  }
  try {
    const { token, user } = await login(email, password);
    res.json({ ok: true, data: { token, user } });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', resolveUser, requireAuth, (req, res) => {
  const { password_hash: _, ...user } = req.usuario;
  res.json({ ok: true, data: { user } });
});

module.exports = router;
