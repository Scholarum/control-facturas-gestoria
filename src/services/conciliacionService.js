const { getDb } = require('../config/database');

function normalizar(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^0+/, '');
}

function coincideNumero(numA, numB) {
  const a = normalizar(numA);
  const b = normalizar(numB);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    return a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a);
  }
  return false;
}

const round2 = n => Math.round((n || 0) * 100) / 100;

async function obtenerFacturasDrive(proveedor, fechaDesde, fechaHasta) {
  const db       = getDb();
  const archivos = await db.all(
    "SELECT * FROM drive_archivos WHERE proveedor = $1 AND estado = 'PROCESADA'",
    [proveedor]
  );

  return archivos
    .map(a => ({ ...a, datos: a.datos_extraidos ? JSON.parse(a.datos_extraidos) : null }))
    .filter(a => a.datos?.fecha_emision)
    .filter(a => {
      const f = a.datos.fecha_emision;
      return (!fechaDesde || f >= fechaDesde) && (!fechaHasta || f <= fechaHasta);
    });
}

function conciliar(facturasDrive, entradasSage) {
  const usadas = new Set();

  return facturasDrive.map(factura => {
    const datos        = factura.datos;
    const numDrive     = datos?.numero_factura;
    const importeDrive = round2(datos?.total_factura);
    const fechaDrive   = datos?.fecha_emision;

    const candidatos = entradasSage
      .map((e, idx) => ({ ...e, _idx: idx }))
      .filter(e => !usadas.has(e._idx) && coincideNumero(numDrive, e.numero_factura));

    if (!candidatos.length) {
      return {
        id: factura.id, numero_factura: numDrive, fecha_emision: fechaDrive,
        importe_drive: importeDrive, proveedor: factura.proveedor,
        nombre_archivo: factura.nombre_archivo,
        sage: null, diferencia: null, estado: 'PENDIENTE_EN_SAGE',
      };
    }

    const mejor = candidatos.reduce((prev, curr) =>
      Math.abs(curr.importe - importeDrive) < Math.abs(prev.importe - importeDrive) ? curr : prev
    );
    usadas.add(mejor._idx);

    const importeSage = round2(mejor.importe);
    const estado = (importeDrive === importeSage && mejor.fecha === fechaDrive) ? 'OK' : 'ERROR_IMPORTE';

    return {
      id: factura.id, numero_factura: numDrive, fecha_emision: fechaDrive,
      importe_drive: importeDrive, proveedor: factura.proveedor,
      nombre_archivo: factura.nombre_archivo,
      sage: { numero_factura: mejor.numero_factura, fecha: mejor.fecha, importe: importeSage },
      diferencia: round2(importeDrive - importeSage),
      estado,
    };
  });
}

function calcularResumen(resultados, proveedor, fechaDesde, fechaHasta) {
  return {
    proveedor, fechaDesde, fechaHasta,
    total:          resultados.length,
    ok:             resultados.filter(r => r.estado === 'OK').length,
    pendientesSage: resultados.filter(r => r.estado === 'PENDIENTE_EN_SAGE').length,
    errorImporte:   resultados.filter(r => r.estado === 'ERROR_IMPORTE').length,
    generadoEn:     new Date().toISOString(),
  };
}

async function ejecutarConciliacion(proveedor, fechaDesde, fechaHasta, entradasSage) {
  const facturasDrive = await obtenerFacturasDrive(proveedor, fechaDesde, fechaHasta);

  if (!facturasDrive.length) {
    throw Object.assign(
      new Error(`No hay facturas procesadas para "${proveedor}" en el rango de fechas indicado.`),
      { status: 404 }
    );
  }

  const resultados = conciliar(facturasDrive, entradasSage);
  const resumen    = calcularResumen(resultados, proveedor, fechaDesde, fechaHasta);
  return { resumen, resultados };
}

module.exports = { ejecutarConciliacion };
