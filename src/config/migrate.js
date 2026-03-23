require('dotenv').config();
const db = require('./database');

const schema = `
  -- Usuarios del sistema (administradores, gestores)
  CREATE TABLE IF NOT EXISTS usuarios (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT    NOT NULL,
    email       TEXT    NOT NULL UNIQUE,
    rol         TEXT    NOT NULL DEFAULT 'admin',   -- admin | gestor
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Facturas
  CREATE TABLE IF NOT EXISTS facturas (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    numero          TEXT    NOT NULL UNIQUE,          -- Número de factura
    descripcion     TEXT,
    importe         REAL    NOT NULL,
    fecha_emision   TEXT    NOT NULL,
    estado          TEXT    NOT NULL DEFAULT 'PENDIENTE',  -- PENDIENTE | VISTO | REGISTRADO
    archivo_nombre  TEXT,                              -- Nombre original del fichero
    archivo_ruta    TEXT,                              -- Ruta interna al fichero
    subida_por      INTEGER NOT NULL REFERENCES usuarios(id),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Tokens de acceso para enlaces únicos enviados a la gestoría
  CREATE TABLE IF NOT EXISTS tokens_acceso (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT    NOT NULL UNIQUE,              -- UUID v4
    factura_id  INTEGER NOT NULL REFERENCES facturas(id),
    usado       INTEGER NOT NULL DEFAULT 0,           -- 0 = activo, 1 = caducado/revocado
    expira_at   TEXT,                                 -- NULL = sin expiración
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Log de auditoría (inmutable: nunca se actualiza, solo se inserta)
  CREATE TABLE IF NOT EXISTS logs_auditoria (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    evento      TEXT    NOT NULL,   -- SUBIDA | APERTURA | VISTO | REGISTRO
    factura_id  INTEGER REFERENCES facturas(id),
    usuario_id  INTEGER REFERENCES usuarios(id),  -- NULL si acceso externo (gestoría)
    ip          TEXT    NOT NULL,
    user_agent  TEXT,
    token_usado TEXT,               -- Token empleado en accesos externos
    detalle     TEXT,               -- JSON con contexto adicional libre
    timestamp   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  -- Índices para consultas frecuentes
  CREATE INDEX IF NOT EXISTS idx_logs_factura   ON logs_auditoria(factura_id);
  CREATE INDEX IF NOT EXISTS idx_logs_evento    ON logs_auditoria(evento);
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs_auditoria(timestamp);
  CREATE INDEX IF NOT EXISTS idx_tokens_token   ON tokens_acceso(token);
`;

db.exec(schema);
console.log('Migración completada. Base de datos lista.');
