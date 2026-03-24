const express  = require('express');
const router   = express.Router();

const { resolveUser, requireAdmin }  = require('../middleware/auth');
const { ejecutarSync }               = require('../services/syncService');
const { enviarNotificaciones }       = require('../services/notificacionService');
const { getDb }                      = require('../config/database');

router.use(resolveUser);

// ─── GET /api/sincronizacion/historial ────────────────────────────────────────

router.get('/historial', requireAdmin, async (req, res) => {
  const db   = getDb();
  const rows = await db.all(
    'SELECT * FROM historial_sincronizaciones ORDER BY id DESC LIMIT 50'
  );
  const data = rows.map(r => ({
    ...r,
    detalle: r.detalle ? JSON.parse(r.detalle) : null,
  }));
  res.json({ ok: true, data });
});

// ─── POST /api/sincronizacion/manual ─────────────────────────────────────────

router.post('/manual', requireAdmin, async (req, res) => {
  try {
    const result = await ejecutarSync('MANUAL');
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: `Error de sincronización: ${err.message}` });
  }
});

// ─── POST /api/sincronizacion/test-notificacion ───────────────────────────────

router.post('/test-notificacion', requireAdmin, async (req, res) => {
  try {
    const result = await enviarNotificaciones();
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
