const cron                   = require('node-cron');
const { ejecutarSync }       = require('./syncService');
const { enviarNotificaciones } = require('./notificacionService');
const { getSistemaConfig }   = require('./sistemaConfigService');
const { getDb }              = require('../config/database');
const logger                 = require('../config/logger');

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

// Obtener hora actual en la zona horaria configurada (como { h, m })
function horaActualEnZona(timezone) {
  const hhmm = new Date().toLocaleTimeString('es-ES', {
    timeZone: timezone, hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const [h, m] = hhmm.split(':').map(Number);
  return { h, m };
}

// Diferencia en minutos entre hora actual y hora programada (positivo = pasada)
function minutosDesdeProgramada(horaConfig, timezone) {
  const [hProg, mProg] = (horaConfig || '08:00').split(':').map(Number);
  const { h, m } = horaActualEnZona(timezone);
  return (h * 60 + m) - (hProg * 60 + mProg);
}

async function iniciarCrons() {
  if (syncTask)   { syncTask.stop();   syncTask   = null; }
  if (notifyTask) { notifyTask.stop(); notifyTask = null; }

  let config;
  try {
    config = await getSistemaConfig();
  } catch (e) {
    logger.warn({ err: e }, 'Cron no se pudo leer configuracion');
    return;
  }

  const timezone = process.env.CRON_TIMEZONE || 'Europe/Madrid';

  // ─── Sync ─────────────────────────────────────────────────────────────
  if (config.sync_activo === 'true' && config.sync_frecuencia !== 'manual') {
    const expr = buildCronExpr(config.sync_hora, config.sync_frecuencia);
    if (expr && cron.validate(expr)) {
      syncTask = cron.schedule(expr, () => {
        logger.info('Cron iniciando sincronizacion automatica');
        ejecutarSync('CRON').catch(e => logger.error({ err: e }, 'Cron error sync'));
      }, { timezone });
      logger.info({ expr, frecuencia: config.sync_frecuencia, hora: config.sync_hora, timezone }, 'Cron sync programada');
    }

    // Catch-up desactivado: usar cron externo (cron-job.org) para fiabilidad
    // Los endpoints /api/sincronizacion/cron-sync y /cron-notify son la via fiable
  }

  // ─── Notificaciones ───────────────────────────────────────────────────
  if (config.notify_activo === 'true') {
    const expr = buildCronExpr(config.notify_hora, config.notify_frecuencia);
    if (expr && cron.validate(expr)) {
      notifyTask = cron.schedule(expr, async () => {
        logger.info('Cron iniciando envio de notificaciones automaticas');
        try {
          const result = await enviarNotificaciones({ forzar: true, origen: 'CRON' });
          logger.info({ result }, 'Cron notificaciones resultado');
        } catch (e) {
          logger.error({ err: e }, 'Cron error notificaciones');
        }
      }, { timezone });
      logger.info({ expr, frecuencia: config.notify_frecuencia, hora: config.notify_hora, timezone }, 'Cron notificaciones programadas');
    }

    // Catch-up desactivado: usar cron externo para fiabilidad
  }
}

// ─── Catch-up generico ──────────────────────────────────────────────────────

async function catchup(tipo, hora, timezone) {
  try {
    const db = getDb();
    const tabla = tipo === 'sync' ? 'historial_sincronizaciones' : 'historial_notificaciones';
    const campo = tipo === 'sync' ? 'fecha' : 'fecha';

    // Verificar si ya hubo una ejecucion CRON hoy (en la zona horaria local)
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: timezone }); // YYYY-MM-DD
    const reciente = await db.one(
      `SELECT id FROM ${tabla} WHERE origen = 'CRON' AND ${campo}::date >= $1::date LIMIT 1`,
      [hoy]
    );
    if (reciente) return; // Ya corrio hoy
  } catch (_) {
    return;
  }

  if (tipo === 'sync') {
    logger.info({ hora }, 'Cron catch-up sync diaria no ejecutada hoy, lanzando');
    ejecutarSync('CRON').catch(e => logger.error({ err: e }, 'Cron error catch-up sync'));
  } else {
    logger.info({ hora }, 'Cron catch-up notificacion diaria no ejecutada hoy, lanzando');
    enviarNotificaciones({ forzar: true, origen: 'CRON' }).catch(e =>
      logger.error({ err: e }, 'Cron error catch-up notificacion')
    );
  }
}

module.exports = { iniciarCrons };
