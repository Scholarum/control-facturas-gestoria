const express  = require('express');
const router   = express.Router();

const { resolveUser, requireAdmin }  = require('../middleware/auth');
const { ejecutarSync }               = require('../services/syncService');
const { enviarNotificaciones }       = require('../services/notificacionService');
const { getSistemaConfig }           = require('../services/sistemaConfigService');
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

// ─── GET /api/sincronizacion/diagnostico-notificacion ────────────────────────

router.get('/diagnostico-notificacion', requireAdmin, async (req, res) => {
  const config  = await getSistemaConfig();
  const db      = getDb();
  const usuarios = await db.all("SELECT nombre, email FROM usuarios WHERE rol = 'GESTORIA' AND activo = 1");
  const countRow = await db.one("SELECT COUNT(*) AS total FROM drive_archivos WHERE estado_gestion = 'PENDIENTE'");

  const apiKey        = process.env.MAILJET_API_KEY;
  const apiSecret     = process.env.MAILJET_API_SECRET;
  const fromEmail     = config.email_remitente || process.env.MAILJET_FROM_EMAIL || '';
  const advertencias  = [];

  if (!apiKey)    advertencias.push('MAILJET_API_KEY no está configurada en las variables de entorno del servidor.');
  if (!apiSecret) advertencias.push('MAILJET_API_SECRET no está configurada en las variables de entorno del servidor.');
  if (!fromEmail) advertencias.push('Email remitente vacío: configúralo en Notificaciones → Email remitente, o añade MAILJET_FROM_EMAIL al servidor.');
  if (fromEmail && fromEmail.endsWith('.local')) advertencias.push(`"${fromEmail}" parece un dominio local no verificado en Mailjet. Usa un dominio verificado.`);
  if (!usuarios.length) advertencias.push('No hay usuarios con rol GESTORIA activos: no se enviarán emails.');

  res.json({
    ok: true,
    data: {
      mailjet_key_presente:    !!apiKey,
      mailjet_secret_presente: !!apiSecret,
      from_email:              fromEmail || '(sin configurar)',
      notify_activo:           config.notify_activo,
      destinatarios:           usuarios,
      facturas_pendientes:     parseInt(countRow.total, 10),
      advertencias,
    },
  });
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

// ─── GET /api/sincronizacion/estado-mensaje/:messageId ───────────────────────

router.get('/estado-mensaje/:messageId', requireAdmin, async (req, res) => {
  const apiKey    = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  if (!apiKey || !apiSecret) {
    return res.status(400).json({ ok: false, error: 'Credenciales Mailjet no configuradas' });
  }
  const { messageId } = req.params;
  try {
    const mjRes = await fetch(
      `https://api.mailjet.com/v3/REST/message/${messageId}`,
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${apiKey}:${apiSecret}`).toString('base64'),
          'Content-Type':  'application/json',
        },
      }
    );
    const data = await mjRes.json();
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
