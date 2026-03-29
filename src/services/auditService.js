const { getDb } = require('../config/database');

const EVENTOS = {
  SUBIDA:                'SUBIDA',
  APERTURA:              'APERTURA',
  VISTO:                 'VISTO',
  REGISTRO:              'REGISTRO',
  DESCARGA:              'DESCARGA',
  CONTABILIZACION:       'CONTABILIZACION',
  DOWNLOAD:              'DOWNLOAD',
  SET_CONTABILIZADA:     'SET_CONTABILIZADA',
  CONTABILIZAR_MASIVO:   'CONTABILIZAR_MASIVO',
  UPLOAD_CONCILIACION:   'UPLOAD_CONCILIACION',
  REVERTIR_ESTADO:       'REVERTIR_ESTADO',
  EXPORT_EXCEL:          'EXPORT_EXCEL',
  EXPORT_A3:             'EXPORT_A3',
  ELIMINAR_FACTURA:      'ELIMINAR_FACTURA',
  EDICION_DATOS_FACTURA: 'EDICION_DATOS_FACTURA',
  EXPORT_SAGE:           'EXPORT_SAGE',
  ASIGNAR_CG:            'ASIGNAR_CG',
};

async function registrarEvento({ evento, facturaId, usuarioId, ip, userAgent, tokenUsado, detalle }) {
  if (!EVENTOS[evento]) throw new Error(`Evento desconocido: ${evento}`);
  const db = getDb();

  await db.query(
    `INSERT INTO logs_auditoria (evento, factura_id, usuario_id, ip, user_agent, token_usado, detalle)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      evento,
      facturaId  ?? null,
      usuarioId  ?? null,
      ip,
      userAgent  ?? null,
      tokenUsado ?? null,
      detalle ? JSON.stringify(detalle) : null,
    ]
  );

  return { evento, facturaId, ip, timestamp: new Date().toISOString() };
}

async function historialFactura(driveArchivoId) {
  const db = getDb();
  return db.all(
    `SELECT l.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
     FROM   logs_auditoria l
     LEFT JOIN usuarios u ON u.id = l.usuario_id
     WHERE  l.detalle IS NOT NULL
       AND  (l.detalle::jsonb->>'drive_id')::text = $1::text
     ORDER  BY l.timestamp ASC`,
    [driveArchivoId]
  );
}

async function getAuditoria(usuarioId, rol, { limite = 200 } = {}) {
  const db = getDb();
  if (rol === 'ADMIN') {
    return db.all(
      `SELECT l.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM   logs_auditoria l
       LEFT JOIN usuarios u ON u.id = l.usuario_id
       ORDER  BY l.timestamp DESC
       LIMIT  $1`,
      [limite]
    );
  }
  return db.all(
    `SELECT l.*, u.nombre AS usuario_nombre, u.rol AS usuario_rol
     FROM   logs_auditoria l
     LEFT JOIN usuarios u ON u.id = l.usuario_id
     WHERE  l.usuario_id = $1
     ORDER  BY l.timestamp DESC
     LIMIT  $2`,
    [usuarioId, limite]
  );
}

module.exports = { registrarEvento, historialFactura, getAuditoria, EVENTOS };
