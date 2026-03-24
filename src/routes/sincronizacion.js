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

// ─── GET /api/sincronizacion/historial-notificaciones ────────────────────────

router.get('/historial-notificaciones', requireAdmin, async (req, res) => {
  const db   = getDb();
  const rows = await db.all(
    'SELECT * FROM historial_notificaciones ORDER BY id DESC LIMIT 50'
  );
  res.json({ ok: true, data: rows });
});

// ─── POST /api/sincronizacion/test-notificacion ───────────────────────────────

router.post('/test-notificacion', requireAdmin, async (req, res) => {
  try {
    const result = await enviarNotificaciones({ forzar: true, origen: 'TEST' });
    res.json({ ok: true, data: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
