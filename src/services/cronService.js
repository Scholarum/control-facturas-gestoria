const cron                   = require('node-cron');
const { ejecutarSync }       = require('./syncService');
const { enviarNotificaciones } = require('./notificacionService');
const { getSistemaConfig }   = require('./sistemaConfigService');

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

  if (config.sync_activo === 'true' && config.sync_frecuencia !== 'manual') {
    const expr = buildCronExpr(config.sync_hora, config.sync_frecuencia);
    if (expr && cron.validate(expr)) {
      syncTask = cron.schedule(expr, () => {
        console.log('[Cron] Iniciando sincronización automática...');
        ejecutarSync('CRON').catch(e => console.error('[Cron] Error sync:', e.message));
      });
      console.log(`[Cron] Sync programada → ${expr} (${config.sync_frecuencia} a las ${config.sync_hora})`);
    }
  }

  if (config.notify_activo === 'true') {
    const expr = buildCronExpr(config.notify_hora, config.notify_frecuencia);
    if (expr && cron.validate(expr)) {
      notifyTask = cron.schedule(expr, () => {
        console.log('[Cron] Enviando notificaciones automáticas...');
        enviarNotificaciones().catch(e => console.error('[Cron] Error notif:', e.message));
      });
      console.log(`[Cron] Notificaciones programadas → ${expr} (${config.notify_frecuencia} a las ${config.notify_hora})`);
    }
  }
}

module.exports = { iniciarCrons };
