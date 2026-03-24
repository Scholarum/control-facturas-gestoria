const Mailjet              = require('node-mailjet');
const { getDb }            = require('../config/database');
const { getSistemaConfig } = require('./sistemaConfigService');

async function enviarNotificaciones({ forzar = false } = {}) {
  const config = await getSistemaConfig();

  if (!forzar && config.notify_activo !== 'true') {
    return { saltado: true, motivo: 'notificaciones desactivadas' };
  }

  const apiKey    = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.warn('[Notificaciones] MAILJET_API_KEY / MAILJET_API_SECRET no configurados en .env');
    return { error: 'Credenciales Mailjet no configuradas' };
  }

  const db       = getDb();
  const usuarios = await db.all(
    "SELECT * FROM usuarios WHERE rol = 'GESTORIA' AND activo = 1"
  );

  if (!usuarios.length) return { enviados: 0, motivo: 'sin destinatarios GESTORIA' };

  const countRow = await db.one(
    "SELECT COUNT(*) AS total FROM drive_archivos WHERE estado_gestion = 'PENDIENTE'"
  );
  const total = parseInt(countRow.total, 10);

  if (!total) return { enviados: 0, motivo: 'sin facturas pendientes' };

  const appUrl    = config.notify_app_url || 'http://localhost:5173';
  const fromEmail = process.env.MAILJET_FROM_EMAIL || 'noreply@gestoria.local';
  const fromName  = 'Control de Facturas';
  const mj        = Mailjet.apiConnect(apiKey, apiSecret);

  const plural  = total === 1;
  const subject = `${total} factura${plural ? '' : 's'} pendiente${plural ? '' : 's'} de revisar`;

  const html = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#1d4ed8;margin-bottom:8px">Control de Facturas</h2>
  <p style="color:#374151">Hola <strong>{{nombre}}</strong>,</p>
  <p style="color:#374151">
    Tienes <strong style="color:#d97706">${total} factura${plural ? '' : 's'} pendiente${plural ? '' : 's'}</strong>
    de revisar en el sistema de Control de Facturas.
  </p>
  <a href="${appUrl}"
     style="display:inline-block;margin:20px 0;padding:12px 28px;background:#2563eb;color:#fff;
            text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
    Ir a Control de Facturas →
  </a>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px">
    Este mensaje es automático del sistema de Control de Facturas. No responda a este correo.
  </p>
</div>`;

  let enviados = 0;
  for (const u of usuarios) {
    try {
      await mj.post('send', { version: 'v3.1' }).request({
        Messages: [{
          From: { Email: fromEmail, Name: fromName },
          To:   [{ Email: u.email, Name: u.nombre }],
          Subject: subject,
          TextPart: `Hola ${u.nombre},\n\nTienes ${total} factura${plural ? '' : 's'} pendiente${plural ? '' : 's'} de revisar.\n\nAccede en: ${appUrl}\n\nMensaje automático.`,
          HTMLPart: html.replace('{{nombre}}', u.nombre),
        }],
      });
      enviados++;
    } catch (e) {
      console.error(`[Notificaciones] Error enviando a ${u.email}:`, e.message);
    }
  }

  return { enviados, destinatarios: usuarios.length };
}

module.exports = { enviarNotificaciones };
