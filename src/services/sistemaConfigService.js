const { getDb } = require('../config/database');

const DEFAULTS = {
  sync_activo:       'true',
  sync_frecuencia:   'diaria',   // manual | cada_hora | cada_6h | diaria | semanal
  sync_hora:         '08:00',
  notify_activo:     'false',
  notify_frecuencia: 'diaria',
  notify_hora:       '09:00',
  notify_app_url:    'http://localhost:5173',
  modo_gestoria:     'v1',       // v1 = solo descarga/contabilizar | v2 = flujo completo con cuentas
  // Chat
  chat_activo:            'true',
  chat_roles:             'ADMIN,GESTORIA',  // roles con acceso, separados por coma
  chat_agente_defecto:    'atc',
  chat_max_mensajes_dia:  '100',             // por usuario
  chat_mensaje_bienvenida: '',               // vacío = sin mensaje de bienvenida
};

let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 5000; // 5 segundos

async function getSistemaConfig() {
  const now = Date.now();
  if (_cache && (now - _cacheTs) < CACHE_TTL) return _cache;

  const db   = getDb();
  const rows = await db.all('SELECT clave, valor FROM configuracion_sistema');
  const config = { ...DEFAULTS };
  for (const row of rows) config[row.clave] = row.valor;

  _cache = config;
  _cacheTs = now;
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
  _cache = null; // Invalidar cache
}

module.exports = { getSistemaConfig, setSistemaConfig, DEFAULTS };
