const { getDb } = require('./database');

// ─── Schema ───────────────────────────────────────────────────────────────────

const tablas = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    nombre        TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    rol           TEXT    NOT NULL DEFAULT 'admin',
    password_hash TEXT,
    activo        INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS facturas (
    id              SERIAL PRIMARY KEY,
    numero          TEXT    NOT NULL UNIQUE,
    descripcion     TEXT,
    importe         REAL    NOT NULL,
    fecha_emision   TEXT    NOT NULL,
    estado          TEXT    NOT NULL DEFAULT 'PENDIENTE',
    archivo_nombre  TEXT,
    archivo_ruta    TEXT,
    subida_por      INTEGER NOT NULL REFERENCES usuarios(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS tokens_acceso (
    id          SERIAL PRIMARY KEY,
    token       TEXT    NOT NULL UNIQUE,
    factura_id  INTEGER NOT NULL REFERENCES facturas(id),
    usado       INTEGER NOT NULL DEFAULT 0,
    expira_at   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS logs_auditoria (
    id          SERIAL PRIMARY KEY,
    evento      TEXT    NOT NULL,
    factura_id  INTEGER REFERENCES facturas(id),
    usuario_id  INTEGER REFERENCES usuarios(id),
    ip          TEXT    NOT NULL,
    user_agent  TEXT,
    token_usado TEXT,
    detalle     TEXT,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS drive_archivos (
    id                SERIAL PRIMARY KEY,
    google_id         TEXT    NOT NULL UNIQUE,
    nombre_archivo    TEXT    NOT NULL,
    ruta_completa     TEXT    NOT NULL,
    proveedor         TEXT,
    fecha_subida      TEXT,
    estado            TEXT    NOT NULL DEFAULT 'PENDIENTE',
    estado_gestion    TEXT    NOT NULL DEFAULT 'PENDIENTE',
    datos_extraidos   TEXT,
    error_extraccion  TEXT,
    procesado_at      TIMESTAMPTZ,
    ultima_sync       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS configuracion (
    clave      TEXT PRIMARY KEY,
    valor      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS configuracion_sistema (
    clave      TEXT PRIMARY KEY,
    valor      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS historial_sincronizaciones (
    id               SERIAL PRIMARY KEY,
    origen           TEXT    NOT NULL DEFAULT 'MANUAL',
    fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado           TEXT    NOT NULL DEFAULT 'OK',
    facturas_nuevas  INTEGER NOT NULL DEFAULT 0,
    facturas_error   INTEGER NOT NULL DEFAULT 0,
    duracion_ms      INTEGER,
    detalle          TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS historial_notificaciones (
    id            SERIAL PRIMARY KEY,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    origen        TEXT    NOT NULL DEFAULT 'MANUAL',
    asunto        TEXT,
    destinatarios TEXT,
    enviados      INTEGER NOT NULL DEFAULT 0,
    errores       INTEGER NOT NULL DEFAULT 0,
    respuesta_mj  TEXT,
    detalle       TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS historial_conciliaciones (
    id              SERIAL PRIMARY KEY,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    proveedor       TEXT NOT NULL,
    fecha_desde     TEXT,
    fecha_hasta     TEXT,
    total           INTEGER NOT NULL DEFAULT 0,
    ok              INTEGER NOT NULL DEFAULT 0,
    pendientes_sage INTEGER NOT NULL DEFAULT 0,
    error_importe   INTEGER NOT NULL DEFAULT 0,
    resultado_json  JSONB NOT NULL
  )`,

  // Índices
  `CREATE INDEX IF NOT EXISTS idx_logs_factura    ON logs_auditoria(factura_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_evento     ON logs_auditoria(evento)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_timestamp  ON logs_auditoria(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_token    ON tokens_acceso(token)`,
  `CREATE INDEX IF NOT EXISTS idx_drive_estado    ON drive_archivos(estado)`,
  `CREATE INDEX IF NOT EXISTS idx_drive_proveedor ON drive_archivos(proveedor)`,
];

// ─── Seeds ────────────────────────────────────────────────────────────────────

const usuariosSeed = [
  { nombre: 'Administrador', email: 'admin@gestoria.local',    rol: 'ADMIN'    },
  { nombre: 'Gestoría',      email: 'gestoria@gestoria.local', rol: 'GESTORIA' },
];

const confDefaults = {
  sync_activo:       'true',
  sync_frecuencia:   'diaria',
  sync_hora:         '08:00',
  notify_activo:     'false',
  notify_frecuencia: 'diaria',
  notify_hora:       '09:00',
  notify_app_url:    'http://localhost:5173',
  email_asunto:      '{{total}} factura{{s}} pendiente{{s}} de revisar',
  email_cuerpo:      'Tienes {{total}} factura{{s}} pendiente{{s}} de revisar en el sistema de Control de Facturas.',
  email_remitente:   '',
};

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runMigrations() {
  const db = getDb();

  // Crear tablas e índices
  for (const sql of tablas) {
    await db.query(sql);
  }

  // Seed usuarios
  for (const u of usuariosSeed) {
    await db.query(
      `INSERT INTO usuarios (nombre, email, rol, activo)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (email) DO NOTHING`,
      [u.nombre, u.email, u.rol]
    );
  }

  // Seed configuracion_sistema
  for (const [clave, valor] of Object.entries(confDefaults)) {
    await db.query(
      `INSERT INTO configuracion_sistema (clave, valor)
       VALUES ($1, $2)
       ON CONFLICT (clave) DO NOTHING`,
      [clave, valor]
    );
  }

  console.log('Migración PostgreSQL completada.');
}

module.exports = { runMigrations };
