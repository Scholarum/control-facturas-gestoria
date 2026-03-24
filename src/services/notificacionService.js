const Mailjet              = require('node-mailjet');
const { getDb }            = require('../config/database');
const { getSistemaConfig } = require('./sistemaConfigService');

// ─── Sustitución de variables en plantillas ───────────────────────────────────

function renderTemplate(tpl, vars) {
  return tpl
    .replace(/\{\{total\}\}/g,  vars.total)
    .replace(/\{\{s\}\}/g,      vars.s)
    .replace(/\{\{nombre\}\}/g, vars.nombre || '')
    .replace(/\{\{url\}\}/g,    vars.url || '');
}

// ─── Envío de notificaciones ──────────────────────────────────────────────────

async function enviarNotificaciones({ forzar = false, origen = 'MANUAL' } = {}) {
  const config = await getSistemaConfig();

  if (!forzar && config.notify_activo !== 'true') {
    return { saltado: true, motivo: 'notificaciones desactivadas' };
  }

  const apiKey    = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.warn('[Notificaciones] MAILJET_API_KEY / MAILJET_API_SECRET no configurados');
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
  const fromEmail = config.email_remitente
    || process.env.MAILJET_FROM_EMAIL
    || '';
  if (!fromEmail) {
    console.warn('[Notificaciones] email_remitente no configurado (ni en BD ni en MAILJET_FROM_EMAIL)');
    return { error: 'Email remitente no configurado. Ajústalo en Configuración → Notificaciones.' };
  }
  const fromName = 'Control de Facturas';
  const mj       = Mailjet.apiConnect(apiKey, apiSecret);
  console.log(`[Notificaciones] Iniciando envío — from: ${fromEmail}, destinatarios: ${usuarios.map(u => u.email).join(', ')}, facturas pendientes: ${total}`);

  const s        = total === 1 ? '' : 's';
  const tplVars  = { total, s, url: appUrl };

  // Plantillas editables
  const asunto = renderTemplate(config.email_asunto || '{{total}} factura{{s}} pendiente{{s}} de revisar', tplVars);

  const cuerpoTpl = config.email_cuerpo || 'Tienes {{total}} factura{{s}} pendiente{{s}} de revisar en el sistema de Control de Facturas.';

  const destinatariosLog = [];
  let enviados = 0;
  let errores  = 0;
  const respuestasMj = [];

  for (const u of usuarios) {
    const cuerpo    = renderTemplate(cuerpoTpl, { ...tplVars, nombre: u.nombre });
    const htmlBody  = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#1d4ed8;margin-bottom:8px">Control de Facturas</h2>
  <p style="color:#374151">Hola <strong>${u.nombre}</strong>,</p>
  <p style="color:#374151">${cuerpo}</p>
  <a href="${appUrl}"
     style="display:inline-block;margin:20px 0;padding:12px 28px;background:#2563eb;color:#fff;
            text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
    Ir a Control de Facturas →
  </a>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px;border-top:1px solid #e5e7eb;padding-top:12px">
    Este mensaje es automático del sistema de Control de Facturas. No responda a este correo.
  </p>
</div>`;

    const textBody = `Hola ${u.nombre},\n\n${cuerpo}\n\nAccede en: ${appUrl}\n\nMensaje automático.`;

    let logEntry = { email: u.email, nombre: u.nombre, enviado: false, error: null, mj_id: null };
    try {
      const mjRes = await mj.post('send', { version: 'v3.1' }).request({
        Messages: [{
          From: { Email: fromEmail, Name: fromName },
          To:   [{ Email: u.email, Name: u.nombre }],
          Subject:  asunto,
          TextPart: textBody,
          HTMLPart: htmlBody,
        }],
        SandboxMode: false,
      });
      const fullBody = mjRes.body ?? {};
      const msgRes   = fullBody?.Messages?.[0];
      logEntry.enviado = true;
      logEntry.mj_id   = msgRes?.To?.[0]?.MessageID ?? null;
      // Guardamos la respuesta completa para diagnóstico
      respuestasMj.push({
        email:   u.email,
        status:  msgRes?.Status,
        id:      logEntry.mj_id,
        uuid:    msgRes?.To?.[0]?.MessageUUID ?? null,
        rawBody: JSON.stringify(fullBody).slice(0, 800),
      });
      console.log(`[Notificaciones] OK → ${u.email} | status: ${msgRes?.Status} | id: ${logEntry.mj_id} | uuid: ${msgRes?.To?.[0]?.MessageUUID}`);
      enviados++;
    } catch (e) {
      // Captura el cuerpo completo de la respuesta de Mailjet para diagnóstico
      const mjBody = e.response?.data ?? e.response?.body ?? null;
      const errorDetail = mjBody
        ? JSON.stringify(mjBody).slice(0, 600)
        : (e.message || 'Error desconocido');
      logEntry.error = errorDetail;
      respuestasMj.push({ email: u.email, httpStatus: e.statusCode ?? e.response?.status, error: errorDetail });
      console.error(`[Notificaciones] ERROR → ${u.email} | HTTP ${e.statusCode ?? e.response?.status} |`, mjBody || e.message);
      errores++;
    }
    destinatariosLog.push(logEntry);
  }

  // Guardar en historial
  await db.query(
    `INSERT INTO historial_notificaciones
       (origen, asunto, destinatarios, enviados, errores, respuesta_mj)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      origen,
      asunto,
      JSON.stringify(destinatariosLog),
      enviados,
      errores,
      JSON.stringify(respuestasMj),
    ]
  );

  return { enviados, errores, destinatarios: usuarios.length, asunto };
}

module.exports = { enviarNotificaciones };
