/**
 * conciliacionService.js
 * Lógica de conciliación entre facturas de Drive y entradas del Mayor SAGE.
 */
const { getDb } = require('../config/database');

// ─── Normalización de número de factura ──────────────────────────────────────

/**
 * Normaliza un número de factura para comparación fuzzy:
 * - Minúsculas
 * - Solo alfanumérico (elimina guiones, barras, espacios, puntos)
 * - Sin ceros a la izquierda
 */
function normalizar(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^0+/, '');
}

/**
 * Devuelve true si los números de factura son suficientemente similares.
 * Casos cubiertos:
 *   - Igualdad exacta (tras normalizar)
 *   - Uno es sufijo/prefijo del otro (SAGE añade prefijos de empresa)
 *   - Diferencias en longitud ≤ 4 caracteres en matches parciales
 */
function coincideNumero(numA, numB) {
  const a = normalizar(numA);
  const b = normalizar(numB);
  if (!a || !b) return false;
  if (a === b) return true;
  // Uno contiene al otro (maneja prefijos tipo "ES-" o "A-")
  if (a.length >= 4 && b.length >= 4) {
    return a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a);
  }
  return false;
}

const round2 = n => Math.round((n || 0) * 100) / 100;

// ─── Obtener facturas Drive ───────────────────────────────────────────────────

function obtenerFacturasDrive(proveedor, fechaDesde, fechaHasta) {
  const db       = getDb();
  const archivos = db.prepare(
    "SELECT * FROM drive_archivos WHERE proveedor = ? AND estado = 'PROCESADA'"
  ).all(proveedor);

  return archivos
    .map(a => ({
      ...a,
      datos: a.datos_extraidos ? JSON.parse(a.datos_extraidos) : null,
    }))
    .filter(a => a.datos?.fecha_emision)
    .filter(a => {
      const f = a.datos.fecha_emision;
      return (!fechaDesde || f >= fechaDesde) && (!fechaHasta || f <= fechaHasta);
    });
}

// ─── Algoritmo de conciliación ────────────────────────────────────────────────

function conciliar(facturasDrive, entradasSage) {
  // Marcamos cada entrada SAGE como usada para evitar duplicados
  const usadas = new Set();

  const resultados = facturasDrive.map(factura => {
    const datos      = factura.datos;
    const numDrive   = datos?.numero_factura;
    const importeDrive = round2(datos?.total_factura);
    const fechaDrive = datos?.fecha_emision;

    // Buscar candidatos en SAGE por número de factura
    const candidatos = entradasSage
      .map((e, idx) => ({ ...e, _idx: idx }))
      .filter(e => !usadas.has(e._idx) && coincideNumero(numDrive, e.numero_factura));

    if (!candidatos.length) {
      return {
        id:             factura.id,
        numero_factura: numDrive,
        fecha_emision:  fechaDrive,
        importe_drive:  importeDrive,
        proveedor:      factura.proveedor,
        nombre_archivo: factura.nombre_archivo,
        sage:           null,
        diferencia:     null,
        estado:         'PENDIENTE_EN_SAGE',
      };
    }

    // De entre los candidatos, elegir el de importe más cercano
    const mejor = candidatos.reduce((prev, curr) =>
      Math.abs(curr.importe - importeDrive) < Math.abs(prev.importe - importeDrive) ? curr : prev
    );
    usadas.add(mejor._idx);

    const importeSage = round2(mejor.importe);
    const importeOk   = importeDrive === importeSage;
    const fechaOk     = mejor.fecha === fechaDrive;

    const estado = importeOk && fechaOk
      ? 'OK'
      : 'ERROR_IMPORTE';

    return {
      id:             factura.id,
      numero_factura: numDrive,
      fecha_emision:  fechaDrive,
      importe_drive:  importeDrive,
      proveedor:      factura.proveedor,
      nombre_archivo: factura.nombre_archivo,
      sage: {
        numero_factura: mejor.numero_factura,
        fecha:          mejor.fecha,
        importe:        importeSage,
      },
      diferencia: round2(importeDrive - importeSage),
      estado,
    };
  });

  return resultados;
}

// ─── Resumen ──────────────────────────────────────────────────────────────────

function calcularResumen(resultados, proveedor, fechaDesde, fechaHasta) {
  return {
    proveedor,
    fechaDesde,
    fechaHasta,
    total:           resultados.length,
    ok:              resultados.filter(r => r.estado === 'OK').length,
    pendientesSage:  resultados.filter(r => r.estado === 'PENDIENTE_EN_SAGE').length,
    errorImporte:    resultados.filter(r => r.estado === 'ERROR_IMPORTE').length,
    generadoEn:      new Date().toISOString(),
  };
}

// ─── Punto de entrada ─────────────────────────────────────────────────────────

function ejecutarConciliacion(proveedor, fechaDesde, fechaHasta, entradasSage) {
  const facturasDrive = obtenerFacturasDrive(proveedor, fechaDesde, fechaHasta);

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
