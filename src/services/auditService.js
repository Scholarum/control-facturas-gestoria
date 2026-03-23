const db = require('../config/database');

/**
 * Eventos válidos del sistema
 */
const EVENTOS = {
  SUBIDA:    'SUBIDA',    // Factura subida al sistema
  APERTURA:  'APERTURA',  // Enlace abierto por la gestoría (clic en el link)
  VISTO:     'VISTO',     // Factura visualizada completamente
  REGISTRO:  'REGISTRO',  // Factura registrada/confirmada por la gestoría
};

const insert = db.prepare(`
  INSERT INTO logs_auditoria (evento, factura_id, usuario_id, ip, user_agent, token_usado, detalle)
  VALUES (@evento, @factura_id, @usuario_id, @ip, @user_agent, @token_usado, @detalle)
`);

/**
 * Registra un evento de auditoría.
 *
 * @param {object} params
 * @param {string}  params.evento      - Uno de EVENTOS.*
 * @param {number}  [params.facturaId]
 * @param {number}  [params.usuarioId]
 * @param {string}  params.ip
 * @param {string}  [params.userAgent]
 * @param {string}  [params.tokenUsado]
 * @param {object}  [params.detalle]   - Objeto libre; se serializa a JSON
 * @returns {object} Registro insertado
 */
function registrarEvento({ evento, facturaId, usuarioId, ip, userAgent, tokenUsado, detalle }) {
  if (!EVENTOS[evento]) {
    throw new Error(`Evento desconocido: ${evento}`);
  }

  const info = insert.run({
    evento,
    factura_id:   facturaId  ?? null,
    usuario_id:   usuarioId  ?? null,
    ip,
    user_agent:   userAgent  ?? null,
    token_usado:  tokenUsado ?? null,
    detalle:      detalle ? JSON.stringify(detalle) : null,
  });

  return { id: info.lastInsertRowid, evento, facturaId, ip, timestamp: new Date().toISOString() };
}

/**
 * Devuelve el historial de auditoría de una factura ordenado por fecha.
 */
function historialFactura(facturaId) {
  return db.prepare(`
    SELECT l.*, u.nombre AS usuario_nombre, u.email AS usuario_email
    FROM   logs_auditoria l
    LEFT JOIN usuarios u ON u.id = l.usuario_id
    WHERE  l.factura_id = ?
    ORDER  BY l.timestamp ASC
  `).all(facturaId);
}

module.exports = { registrarEvento, historialFactura, EVENTOS };
