const { getDb } = require('./database');

const schema = `
  -- Usuarios del sistema (administradores, gestores)
  CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    rol         TEXT    NOT NULL DEFAULT 'admin',
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Facturas
  CREATE TABLE IF NOT EXISTS facturas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          TEXT    NOT NULL UNIQUE,
    descripcion     TEXT,
    importe         REAL    NOT NULL,
    fecha_emision   TEXT    NOT NULL,
    estado          TEXT    NOT NULL DEFAULT 'PENDIENTE',
    archivo_nombre  TEXT,
    archivo_ruta    TEXT,
    subida_por      INTEGER NOT NULL REFERENCES usuarios(id),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Tokens de acceso para enlaces únicos enviados a la gestoría
  CREATE TABLE IF NOT EXISTS tokens_acceso (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT    NOT NULL UNIQUE,
    factura_id  INTEGER NOT NULL REFERENCES facturas(id),
    usado       INTEGER NOT NULL DEFAULT 0,
    expira_at   TEXT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Log de auditoría (inmutable: solo INSERT)
  CREATE TABLE IF NOT EXISTS logs_auditoria (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    evento      TEXT    NOT NULL,
    factura_id  INTEGER REFERENCES facturas(id),
    usuario_id  INTEGER REFERENCES usuarios(id),
    ip          TEXT    NOT NULL,
    user_agent  TEXT,
    token_usado TEXT,
    detalle     TEXT,
    timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Archivos sincronizados desde Google Drive
  CREATE TABLE IF NOT EXISTS drive_archivos (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    google_id         TEXT    NOT NULL UNIQUE,
    nombre_archivo    TEXT    NOT NULL,
    ruta_completa     TEXT    NOT NULL,
    proveedor         TEXT,
    fecha_subida      TEXT,
    estado            TEXT    NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE | PROCESADA | REVISION_MANUAL | IGNORADO
    datos_extraidos   TEXT,   -- JSON con los campos extraídos por Gemini
    error_extraccion  TEXT,   -- Motivo del fallo si estado = REVISION_MANUAL
    procesado_at      TEXT,   -- Timestamp del último intento de extracción
    ultima_sync       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE INDEX IF NOT EXISTS idx_logs_factura    ON logs_auditoria(factura_id);
  CREATE INDEX IF NOT EXISTS idx_logs_evento     ON logs_auditoria(evento);
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp  ON logs_auditoria(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tokens_token    ON tokens_acceso(token);
  CREATE INDEX IF NOT EXISTS idx_drive_estado    ON drive_archivos(estado);
  CREATE INDEX IF NOT EXISTS idx_drive_proveedor ON drive_archivos(proveedor);
`;

// Columnas añadidas en Bloque 2 — se aplican sobre BDs ya existentes
const alteraciones = [
  "ALTER TABLE drive_archivos ADD COLUMN datos_extraidos  TEXT",
  "ALTER TABLE drive_archivos ADD COLUMN error_extraccion TEXT",
  "ALTER TABLE drive_archivos ADD COLUMN procesado_at     TEXT",
];

function runMigrations() {
  const db = getDb();
  db.exec(schema);
  // ALTER TABLE no soporta IF NOT EXISTS → ignoramos el error si ya existe
  for (const sql of alteraciones) {
    try { db.exec(sql); } catch (_) { /* columna ya existente */ }
  }
  console.log('Migración completada. Base de datos lista.');
}

module.exports = { runMigrations };
