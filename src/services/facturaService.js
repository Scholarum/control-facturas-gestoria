const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { registrarEvento, EVENTOS } = require('./auditService');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function crearFactura({ numero, descripcion, importe, fechaEmision, archivoNombre, archivoRuta, subidaPor, ip, userAgent }) {
  const db = getDb();
  db.prepare(`
    INSERT INTO facturas (numero, descripcion, importe, fecha_emision, archivo_nombre, archivo_ruta, subida_por)
    VALUES (@numero, @descripcion, @importe, @fecha_emision, @archivo_nombre, @archivo_ruta, @subida_por)
  `).run({ numero, descripcion: descripcion ?? null, importe, fecha_emision: fechaEmision, archivo_nombre: archivoNombre ?? null, archivo_ruta: archivoRuta ?? null, subida_por: subidaPor });

  const factura = db.prepare('SELECT * FROM facturas WHERE numero = ?').get(numero);

  registrarEvento({ evento: EVENTOS.SUBIDA, facturaId: factura.id, usuarioId: subidaPor, ip, userAgent, detalle: { numero, importe } });
  return factura;
}

function obtenerFactura(id) {
  return getDb().prepare('SELECT * FROM facturas WHERE id = ?').get(id);
}

function listarFacturas() {
  return getDb().prepare(`
    SELECT f.*, u.nombre AS subida_por_nombre
    FROM   facturas f
    JOIN   usuarios u ON u.id = f.subida_por
    ORDER  BY f.created_at DESC
  `).all();
}

function generarEnlaceGestoria(facturaId, { expiraEn } = {}) {
  const db      = getDb();
  const factura = obtenerFactura(facturaId);
  if (!factura) throw new Error(`Factura ${facturaId} no encontrada`);

  const token    = uuidv4();
  const expiraAt = expiraEn ? new Date(Date.now() + expiraEn).toISOString() : null;

  db.prepare('INSERT INTO tokens_acceso (token, factura_id, expira_at) VALUES (?, ?, ?)').run(token, facturaId, expiraAt);
  return { token, enlace: `${BASE_URL}/ver/${token}`, facturaId, expiraAt };
}

function accederConToken(token, { ip, userAgent }) {
  const db      = getDb();
  const registro = db.prepare(`
    SELECT ta.factura_id, ta.usado, ta.expira_at
    FROM   tokens_acceso ta
    WHERE  ta.token = ?
  `).get(token);

  if (!registro) throw Object.assign(new Error('Token inválido'), { status: 404 });
  if (registro.usado) throw Object.assign(new Error('Este enlace ya ha sido utilizado'), { status: 410 });
  if (registro.expira_at && new Date(registro.expira_at) < new Date()) {
    throw Object.assign(new Error('El enlace ha caducado'), { status: 410 });
  }

  const facturaId = registro.factura_id;

  registrarEvento({ evento: EVENTOS.APERTURA, facturaId, ip, userAgent, tokenUsado: token });
  registrarEvento({ evento: EVENTOS.VISTO,    facturaId, ip, userAgent, tokenUsado: token, detalle: { timestamp_visto: new Date().toISOString() } });

  db.prepare(`UPDATE facturas SET estado = 'VISTO', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(facturaId);

  return obtenerFactura(facturaId);
}

module.exports = { crearFactura, obtenerFactura, listarFacturas, generarEnlaceGestoria, accederConToken };
