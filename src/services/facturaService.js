const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../config/database');
const { registrarEvento, EVENTOS } = require('./auditService');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function crearFactura({ numero, descripcion, importe, fechaEmision, archivoNombre, archivoRuta, subidaPor, ip, userAgent }) {
  const db     = getDb();
  const result = await db.query(
    `INSERT INTO facturas (numero, descripcion, importe, fecha_emision, archivo_nombre, archivo_ruta, subida_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [numero, descripcion ?? null, importe, fechaEmision, archivoNombre ?? null, archivoRuta ?? null, subidaPor]
  );
  const factura = await db.one('SELECT * FROM facturas WHERE id = $1', [result.rows[0].id]);
  await registrarEvento({ evento: EVENTOS.SUBIDA, facturaId: factura.id, usuarioId: subidaPor, ip, userAgent, detalle: { numero, importe } });
  return factura;
}

async function obtenerFactura(id) {
  return getDb().one('SELECT * FROM facturas WHERE id = $1', [id]);
}

async function listarFacturas() {
  return getDb().all(
    `SELECT f.*, u.nombre AS subida_por_nombre
     FROM   facturas f
     JOIN   usuarios u ON u.id = f.subida_por
     ORDER  BY f.created_at DESC`
  );
}

async function generarEnlaceGestoria(facturaId, { expiraEn } = {}) {
  const db      = getDb();
  const factura = await obtenerFactura(facturaId);
  if (!factura) throw new Error(`Factura ${facturaId} no encontrada`);

  const token    = uuidv4();
  const expiraAt = expiraEn ? new Date(Date.now() + expiraEn).toISOString() : null;

  await db.query(
    'INSERT INTO tokens_acceso (token, factura_id, expira_at) VALUES ($1, $2, $3)',
    [token, facturaId, expiraAt]
  );
  return { token, enlace: `${BASE_URL}/ver/${token}`, facturaId, expiraAt };
}

async function accederConToken(token, { ip, userAgent }) {
  const db       = getDb();
  const registro = await db.one(
    'SELECT factura_id, usado, expira_at FROM tokens_acceso WHERE token = $1',
    [token]
  );

  if (!registro)    throw Object.assign(new Error('Token inválido'), { status: 404 });
  if (registro.usado) throw Object.assign(new Error('Este enlace ya ha sido utilizado'), { status: 410 });
  if (registro.expira_at && new Date(registro.expira_at) < new Date()) {
    throw Object.assign(new Error('El enlace ha caducado'), { status: 410 });
  }

  const facturaId = registro.factura_id;
  await registrarEvento({ evento: EVENTOS.APERTURA, facturaId, ip, userAgent, tokenUsado: token });
  await registrarEvento({ evento: EVENTOS.VISTO,    facturaId, ip, userAgent, tokenUsado: token, detalle: { timestamp_visto: new Date().toISOString() } });

  await db.query(
    "UPDATE facturas SET estado = 'VISTO', updated_at = NOW() WHERE id = $1",
    [facturaId]
  );

  return obtenerFactura(facturaId);
}

module.exports = { crearFactura, obtenerFactura, listarFacturas, generarEnlaceGestoria, accederConToken };
