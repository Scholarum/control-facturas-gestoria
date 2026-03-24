const { getDb } = require('../config/database');

const DEFAULTS = {
  sync_activo:       'true',
  sync_frecuencia:   'diaria',   // manual | cada_hora | cada_6h | diaria | semanal
  sync_hora:         '08:00',
  notify_activo:     'false',
  notify_frecuencia: 'diaria',
  notify_hora:       '09:00',
  notify_app_url:    'http://localhost:5173',
};

async function getSistemaConfig() {
  const db   = getDb();
  const rows = await db.all('SELECT clave, valor FROM configuracion_sistema');
  const config = { ...DEFAULTS };
  for (const row of rows) config[row.clave] = row.valor;
  return config;
}

async function setSistemaConfig(updates) {
  const db = getDb();
  for (const [clave, valor] of Object.entries(updates)) {
    await db.query(
      `INSERT INTO configuracion_sistema (clave, valor, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (clave) DO UPDATE SET
         valor      = EXCLUDED.valor,
         updated_at = NOW()`,
      [clave, String(valor)]
    );
  }
}

module.exports = { getSistemaConfig, setSistemaConfig, DEFAULTS };
