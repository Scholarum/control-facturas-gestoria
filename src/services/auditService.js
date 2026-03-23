const { getDb } = require('../config/database');

const EVENTOS = {
  SUBIDA:          'SUBIDA',
  APERTURA:        'APERTURA',
  VISTO:           'VISTO',
  REGISTRO:        'REGISTRO',
  DESCARGA:        'DESCARGA',
  CONTABILIZACION: 'CONTABILIZACION',
};

function registrarEvento({ evento, facturaId, usuarioId, ip, userAgent, tokenUsado, detalle }) {
  if (!EVENTOS[evento]) throw new Error(`Evento desconocido: ${evento}`);
  const db = getDb();

  const info = db.prepare(`
    INSERT INTO logs_auditoria (evento, factura_id, usuario_id, ip, user_agent, token_usado, detalle)
    VALUES (@evento, @factura_id, @usuario_id, @ip, @user_agent, @token_usado, @detalle)
  `).run({
    evento,
    factura_id:  facturaId  ?? null,
    usuario_id:  usuarioId  ?? null,
    ip,
    user_agent:  userAgent  ?? null,
    token_usado: tokenUsado ?? null,
    detalle:     detalle ? JSON.stringify(detalle) : null,
  });

  return { changes: info.changes, evento, facturaId, ip, timestamp: new Date().toISOString() };
}

function historialFactura(facturaId) {
  const db = getDb();
  return db.prepare(`
    SELECT l.*, u.nombre AS usuario_nombre, u.email AS usuario_email
    FROM   logs_auditoria l
    LEFT JOIN usuarios u ON u.id = l.usuario_id
    WHERE  l.factura_id = ?
    ORDER  BY l.timestamp ASC
  `).all(facturaId);
}

module.exports = { registrarEvento, historialFactura, EVENTOS };
