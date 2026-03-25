const cron                   = require('node-cron');
const { ejecutarSync }       = require('./syncService');
const { enviarNotificaciones } = require('./notificacionService');
const { getSistemaConfig }   = require('./sistemaConfigService');
const { getDb }              = require('../config/database');

let syncTask   = null;
let notifyTask = null;

function buildCronExpr(hora, frecuencia) {
  const [h, m] = (hora || '08:00').split(':').map(n => parseInt(n, 10));
  switch (frecuencia) {
    case 'cada_hora': return `${m} * * * *`;
    case 'cada_6h':   return `${m} */6 * * *`;
    case 'diaria':    return `${m} ${h} * * *`;
    case 'semanal':   return `${m} ${h} * * 1`;
    default:          return null;
  }
}

async function iniciarCrons() {
  if (syncTask)   { syncTask.stop();   syncTask   = null; }
  if (notifyTask) { notifyTask.stop(); notifyTask = null; }

  let config;
  try {
    config = await getSistemaConfig();
  } catch (e) {
    console.warn('[Cron] No se pudo leer configuración:', e.message);
    return;
  }

  // Zona horaria: variable de entorno CRON_TIMEZONE o 'Europe/Madrid' por defecto
  const timezone = process.env.CRON_TIMEZONE || 'Europe/Madrid';

  if (config.sync_activo === 'true' && config.sync_frecuencia !== 'manual') {
    const expr = buildCronExpr(config.sync_hora, config.sync_frecuencia);
    if (expr && cron.validate(expr)) {
      syncTask = cron.schedule(expr, () => {
        console.log('[Cron] Iniciando sincronización automática...');
        ejecutarSync('CRON').catch(e => console.error('[Cron] Error sync:', e.message));
      }, { timezone });
      console.log(`[Cron] Sync programada → ${expr} (${config.sync_frecuencia} a las ${config.sync_hora} ${timezone})`);
    }
    // Si el servidor arrancó después de la hora programada, recuperar la ejecución perdida
    catchupSyncSiNecesario(config, timezone).catch(e =>
      console.warn('[Cron] Error comprobando catch-up:', e.message)
    );
  }

  if (config.notify_activo === 'true') {
    const expr = buildCronExpr(config.notify_hora, config.notify_frecuencia);
    if (expr && cron.validate(expr)) {
      notifyTask = cron.schedule(expr, async () => {
        console.log('[Cron] Iniciando envío de notificaciones automáticas...');
        try {
          const result = await enviarNotificaciones({ forzar: true, origen: 'CRON' });
          console.log('[Cron] Notificaciones resultado:', JSON.stringify(result));
        } catch (e) {
          console.error('[Cron] Error notificaciones:', e.message);
        }
      }, { timezone });
      console.log(`[Cron] Notificaciones programadas → ${expr} (${config.notify_frecuencia} a las ${config.notify_hora} ${timezone})`);
    }

    // Catch-up: si el servidor arrancó después de la hora programada
    catchupNotifSiNecesario(config, timezone).catch(e =>
      console.warn('[Cron] Error comprobando catch-up notificaciones:', e.message)
    );
  }
}

// ─── Catch-up: ejecutar sync si el servidor arrancó pasada la hora programada ─
// Cubre el caso habitual de restart/deploy después de la hora del cron diario.

async function catchupSyncSiNecesario(config, timezone) {
  if (config.sync_activo !== 'true' || config.sync_frecuencia !== 'diaria') return;

  const [h, m] = (config.sync_hora || '08:00').split(':').map(Number);

  // Hora actual en la zona configurada
  const now    = new Date();
  const hhmm   = now.toLocaleTimeString('es-ES', { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' });
  const [hNow, mNow] = hhmm.split(':').map(Number);

  // Si todavía no ha llegado la hora programada, nada que hacer
  if (hNow < h || (hNow === h && mNow < m)) return;

  // Comprobar si ya hay una ejecución CRON en las últimas 20 horas
  try {
    const db      = getDb();
    const reciente = await db.one(
      "SELECT id FROM historial_sincronizaciones WHERE origen = 'CRON' AND fecha >= NOW() - INTERVAL '20 hours' LIMIT 1"
    );
    if (reciente) return; // Ya corrió hoy
  } catch (_) {
    return; // Si falla la consulta, no hacemos catch-up
  }

  console.log(`[Cron] Sync diaria de las ${config.sync_hora} no ejecutada hoy. Lanzando ahora...`);
  ejecutarSync('CRON').catch(e => console.error('[Cron] Error en sync de recuperación:', e.message));
}

// ─── Catch-up para notificaciones ────────────────────────────────────────────

async function catchupNotifSiNecesario(config, timezone) {
  if (config.notify_activo !== 'true' || config.notify_frecuencia !== 'diaria') return;

  const [h, m] = (config.notify_hora || '09:00').split(':').map(Number);

  const now  = new Date();
  const hhmm = now.toLocaleTimeString('es-ES', { timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit' });
  const [hNow, mNow] = hhmm.split(':').map(Number);

  if (hNow < h || (hNow === h && mNow < m)) return;

  try {
    const db       = getDb();
    const reciente = await db.one(
      "SELECT id FROM historial_notificaciones WHERE origen = 'CRON' AND fecha >= NOW() - INTERVAL '20 hours' LIMIT 1"
    );
    if (reciente) return;
  } catch (_) {
    return;
  }

  console.log(`[Cron] Notificación diaria de las ${config.notify_hora} no ejecutada hoy. Lanzando ahora...`);
  enviarNotificaciones({ forzar: true, origen: 'CRON' }).catch(e =>
    console.error('[Cron] Error en notificación de recuperación:', e.message)
  );
}

module.exports = { iniciarCrons };
