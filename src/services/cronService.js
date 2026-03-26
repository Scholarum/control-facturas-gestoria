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
    console.warn('[Cron] No se pudo leer configuracion:', e.message);
    return;
  }

  const timezone = process.env.CRON_TIMEZONE || 'Europe/Madrid';

  // ─── Sync ─────────────────────────────────────────────────────────────
  if (config.sync_activo === 'true' && config.sync_frecuencia !== 'manual') {
    const expr = buildCronExpr(config.sync_hora, config.sync_frecuencia);
    if (expr && cron.validate(expr)) {
      syncTask = cron.schedule(expr, () => {
        console.log('[Cron] Iniciando sincronizacion automatica...');
        ejecutarSync('CRON').catch(e => console.error('[Cron] Error sync:', e.message));
      }, { timezone });
      console.log(`[Cron] Sync programada -> ${expr} (${config.sync_frecuencia} a las ${config.sync_hora} ${timezone})`);
    }

    // Catch-up: solo si es diaria, la hora ya paso, estamos dentro de 2h de ventana,
    // y no hay ejecucion reciente
    if (config.sync_frecuencia === 'diaria') {
      const diff = minutosDesdeProgramada(config.sync_hora, timezone);
      if (diff > 0 && diff <= 120) {
        catchup('sync', config.sync_hora, timezone);
      }
    }
  }

  // ─── Notificaciones ───────────────────────────────────────────────────
  if (config.notify_activo === 'true') {
    const expr = buildCronExpr(config.notify_hora, config.notify_frecuencia);
    if (expr && cron.validate(expr)) {
      notifyTask = cron.schedule(expr, async () => {
        console.log('[Cron] Iniciando envio de notificaciones automaticas...');
        try {
          const result = await enviarNotificaciones({ forzar: true, origen: 'CRON' });
          console.log('[Cron] Notificaciones resultado:', JSON.stringify(result));
        } catch (e) {
          console.error('[Cron] Error notificaciones:', e.message);
        }
      }, { timezone });
      console.log(`[Cron] Notificaciones programadas -> ${expr} (${config.notify_frecuencia} a las ${config.notify_hora} ${timezone})`);
    }

    if (config.notify_frecuencia === 'diaria') {
      const diff = minutosDesdeProgramada(config.notify_hora, timezone);
      if (diff > 0 && diff <= 120) {
        catchup('notify', config.notify_hora, timezone);
      }
    }
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
    console.log(`[Cron] Catch-up: sync diaria de las ${hora} no ejecutada hoy. Lanzando...`);
    ejecutarSync('CRON').catch(e => console.error('[Cron] Error catch-up sync:', e.message));
  } else {
    console.log(`[Cron] Catch-up: notificacion diaria de las ${hora} no ejecutada hoy. Lanzando...`);
    enviarNotificaciones({ forzar: true, origen: 'CRON' }).catch(e =>
      console.error('[Cron] Error catch-up notificacion:', e.message)
    );
  }
}

module.exports = { iniciarCrons };
