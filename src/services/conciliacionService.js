const { getDb } = require('../config/database');

function normalizar(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^0+/, '');
}

// Extrae el sufijo numérico de un string normalizado y elimina sus ceros iniciales.
// "fl039" → "39", "fac202639" → "202639", "39" → "39"
function sufijsNumerico(str) {
  const m = str.match(/(\d+)$/);
  return m ? m[1].replace(/^0+/, '') || '0' : '';
}

function coincideNumero(numA, numB) {
  const a = normalizar(numA);
  const b = normalizar(numB);
  if (!a || !b) return false;
  if (a === b) return true;

  const aPuro = /^\d+$/.test(a);
  const bPuro = /^\d+$/.test(b);

  // Ambos tienen 4+ chars: fuzzy completo
  if (a.length >= 4 && b.length >= 4) {
    return a.endsWith(b) || b.endsWith(a) || a.includes(b) || b.includes(a);
  }

  // Uno es puramente numérico (corto) y el otro tiene letras:
  // coincide si el sufijo numérico del largo es igual al número corto.
  // Ej: "39" vs "fl39" → sufijo("fl39")="39" === "39" ✓
  //     "39" vs "fac202639" → sufijo="202639" ≠ "39" ✗ (distinta factura)
  if (aPuro && !bPuro) return sufijsNumerico(b) === a;
  if (bPuro && !aPuro) return sufijsNumerico(a) === b;

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

// ═══════════════════════════════════════════════════════════════════════════════
// V2: Matching por Fecha + Importe + Referencia Simplificada
// ═══════════════════════════════════════════════════════════════════════════════

function simplificarReferencia(numFactura, anio) {
  if (!numFactura) return '';
  let s = String(numFactura);
  // Eliminar letras y caracteres no numéricos
  s = s.replace(/[^0-9]/g, '');
  if (!s) return '';
  // Eliminar año completo (ej: "2026")
  const anioStr = String(anio);
  s = s.replace(new RegExp(anioStr, 'g'), '');
  // Eliminar año corto al inicio (ej: "26")
  const anioCorto = anioStr.slice(2);
  s = s.replace(new RegExp('^' + anioCorto), '');
  // Eliminar ceros iniciales
  s = s.replace(/^0+/, '') || '0';
  return s;
}

function cruzarLineaMayor(linea, facturasDrive, anio) {
  // Importe de la factura: normalmente en HABER (col L), pero puede estar en DEBE (col K)
  const importeMayor = round2(linea.haber > 0 ? linea.haber : linea.debe);
  const fechaMayor   = linea.fecha;
  const usadas       = linea._usadas; // Set compartido por proveedor

  // Candidatos: fecha + importe exactos
  const candidatos = facturasDrive.filter(f => {
    if (usadas.has(f.id)) return false;
    const importeDB = round2(f.datos?.total_factura);
    const fechaDB   = f.datos?.fecha_emision;
    return fechaDB === fechaMayor && importeDB === importeMayor;
  });

  const mayorInfo = {
    fecha: fechaMayor, concepto: linea.concepto, documento: linea.documento,
    importe: importeMayor, lineaOriginal: linea.lineaOriginal,
  };

  if (!candidatos.length) {
    return {
      mayor:   mayorInfo,
      factura: null,
      estado:  'SIN_MATCH',
      detalleMatch: { fechaCoincide: false, importeCoincide: false, referenciaEncontrada: false, refSimplificada: null },
    };
  }

  // Buscar referencia simplificada en el concepto del Mayor (col I)
  const conceptoUpper = (linea.concepto || '').toUpperCase();

  for (const f of candidatos) {
    const numFact = f.datos?.numero_factura;
    const refSimp = simplificarReferencia(numFact, anio);
    if (refSimp && refSimp !== '0' && conceptoUpper.includes(refSimp)) {
      usadas.add(f.id);
      return {
        mayor:   mayorInfo,
        factura: { id: f.id, numero_factura: numFact, fecha_emision: f.datos.fecha_emision, total_factura: round2(f.datos.total_factura), nombre_archivo: f.nombre_archivo },
        estado:  'CONCILIADA',
        detalleMatch: { fechaCoincide: true, importeCoincide: true, referenciaEncontrada: true, refSimplificada: refSimp },
      };
    }
  }

  // Fecha+Importe OK pero referencia no encontrada → PARCIAL, usar el primer candidato
  const mejor = candidatos[0];
  usadas.add(mejor.id);
  const refSimp = simplificarReferencia(mejor.datos?.numero_factura, anio);
  return {
    mayor:   mayorInfo,
    factura: { id: mejor.id, numero_factura: mejor.datos?.numero_factura, fecha_emision: mejor.datos.fecha_emision, total_factura: round2(mejor.datos.total_factura), nombre_archivo: mejor.nombre_archivo },
    estado:  'PARCIAL',
    detalleMatch: { fechaCoincide: true, importeCoincide: true, referenciaEncontrada: false, refSimplificada: refSimp },
  };
}

async function obtenerFacturasPorProveedor(nombreCarpeta, proveedorId, cifProveedor) {
  const db = getDb();
  let archivos;

  if (proveedorId) {
    // Buscar por nombre_carpeta O por CIF del proveedor
    archivos = await db.all(`
      SELECT da.* FROM drive_archivos da
      WHERE da.estado = 'PROCESADA'
        AND (
          da.proveedor = $1
          OR (
            $2 IS NOT NULL
            AND da.datos_extraidos IS NOT NULL
            AND da.datos_extraidos ~ '^\\s*\\{'
            AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif($2)
          )
        )
    `, [nombreCarpeta || '', cifProveedor || null]);
  } else {
    // Sin proveedor vinculado, solo buscar por nombre_carpeta si existe
    if (nombreCarpeta) {
      archivos = await db.all(
        "SELECT * FROM drive_archivos WHERE proveedor = $1 AND estado = 'PROCESADA'",
        [nombreCarpeta]
      );
    } else {
      archivos = [];
    }
  }

  return archivos
    .map(a => ({ ...a, datos: a.datos_extraidos ? JSON.parse(a.datos_extraidos) : null }))
    .filter(a => a.datos?.fecha_emision);
}

async function ejecutarConciliacionV2(proveedoresConLineas) {
  const anio = new Date().getFullYear();
  const resultadosPorProveedor = [];
  let totalConciliadas = 0, totalParciales = 0, totalSinMatch = 0, totalLineas = 0;

  for (const prov of proveedoresConLineas) {
    const facturasDrive = await obtenerFacturasPorProveedor(
      prov.nombreCarpeta, prov.proveedorId, prov.cifProveedor
    );

    // Filtrar solo líneas cuyo documento empieza por F/ y tienen importe
    const lineasFactura = (prov.lineas || [])
      .filter(l => l.esFactura && (l.haber > 0 || l.debe > 0));

    const usadas = new Set();
    const resultados = lineasFactura.map(linea => {
      linea._usadas = usadas;
      return cruzarLineaMayor(linea, facturasDrive, anio);
    });

    const conciliadas = resultados.filter(r => r.estado === 'CONCILIADA').length;
    const parciales   = resultados.filter(r => r.estado === 'PARCIAL').length;
    const sinMatch    = resultados.filter(r => r.estado === 'SIN_MATCH').length;

    totalConciliadas += conciliadas;
    totalParciales   += parciales;
    totalSinMatch    += sinMatch;
    totalLineas      += resultados.length;

    resultadosPorProveedor.push({
      codigoCuenta:  prov.codigoCuenta,
      proveedorId:   prov.proveedorId,
      nombreCarpeta: prov.nombreCarpeta,
      razonSocial:   prov.razonSocial,
      nombreMayor:   prov.nombreMayor,
      resultados,
      resumen: { total: resultados.length, conciliadas, parciales, sinMatch },
    });
  }

  return {
    resultadosPorProveedor,
    resumenGlobal: {
      totalProveedores: proveedoresConLineas.length,
      totalLineas,
      conciliadas: totalConciliadas,
      parciales:   totalParciales,
      sinMatch:    totalSinMatch,
    },
  };
}

module.exports = { ejecutarConciliacion, ejecutarConciliacionV2, simplificarReferencia };
