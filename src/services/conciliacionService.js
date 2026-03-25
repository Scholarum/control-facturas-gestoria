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

// Busca una factura de DB en las líneas del Mayor
function cruzarFacturaEnMayor(factura, lineasMayor, anio, usadas) {
  const importeDB = round2(factura.datos?.total_factura);
  const fechaDB   = factura.datos?.fecha_emision;
  const numFact   = factura.datos?.numero_factura;
  const refSimp   = simplificarReferencia(numFact, anio);

  const facturaInfo = {
    id: factura.id, numero_factura: numFact, fecha_emision: fechaDB,
    total_factura: importeDB, nombre_archivo: factura.nombre_archivo,
  };

  // Candidatos: líneas del Mayor con fecha + importe exactos
  const candidatos = lineasMayor.filter((l, idx) => {
    if (usadas.has(idx)) return false;
    const importeMayor = round2(l.haber > 0 ? l.haber : l.debe);
    return l.fecha === fechaDB && importeMayor === importeDB;
  });

  if (!candidatos.length) {
    return {
      factura: facturaInfo,
      mayor:   null,
      estado:  'SIN_MATCH',
      detalleMatch: { fechaCoincide: false, importeCoincide: false, referenciaEncontrada: false, refSimplificada: refSimp },
    };
  }

  // Buscar referencia simplificada en el concepto del Mayor
  for (const l of candidatos) {
    const idx = lineasMayor.indexOf(l);
    const conceptoUpper = (l.concepto || '').toUpperCase();
    if (refSimp && refSimp !== '0' && conceptoUpper.includes(refSimp)) {
      usadas.add(idx);
      const importeMayor = round2(l.haber > 0 ? l.haber : l.debe);
      return {
        factura: facturaInfo,
        mayor:   { fecha: l.fecha, concepto: l.concepto, documento: l.documento, importe: importeMayor, lineaOriginal: l.lineaOriginal },
        estado:  'CONCILIADA',
        detalleMatch: { fechaCoincide: true, importeCoincide: true, referenciaEncontrada: true, refSimplificada: refSimp },
      };
    }
  }

  // Fecha+Importe OK pero referencia no encontrada → PARCIAL
  const mejor = candidatos[0];
  const idxMejor = lineasMayor.indexOf(mejor);
  usadas.add(idxMejor);
  const importeMayor = round2(mejor.haber > 0 ? mejor.haber : mejor.debe);
  return {
    factura: facturaInfo,
    mayor:   { fecha: mejor.fecha, concepto: mejor.concepto, documento: mejor.documento, importe: importeMayor, lineaOriginal: mejor.lineaOriginal },
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
            $2::text IS NOT NULL
            AND da.datos_extraidos IS NOT NULL
            AND da.datos_extraidos ~ '^\\s*\\{'
            AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif($2::text)
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

async function obtenerVinculosManuales(facturaIds) {
  if (!facturaIds.length) return [];
  const db = getDb();
  return db.all(
    'SELECT * FROM conciliacion_vinculos_manuales WHERE factura_id = ANY($1::int[])',
    [facturaIds]
  );
}

async function ejecutarConciliacionV2(proveedoresConLineas) {
  const anio = new Date().getFullYear();
  const resultadosPorProveedor = [];
  let totalConciliadas = 0, totalConciliadasManual = 0, totalParciales = 0, totalSinMatch = 0, totalSinFactura = 0, totalLineas = 0;

  for (const prov of proveedoresConLineas) {
    const facturasDrive = await obtenerFacturasPorProveedor(
      prov.nombreCarpeta, prov.proveedorId, prov.cifProveedor
    );

    // Líneas del Mayor filtradas: documento F/ con importe
    const lineasFactura = (prov.lineas || [])
      .filter(l => l.esFactura && (l.haber > 0 || l.debe > 0));

    // Cargar vínculos manuales de ejecuciones anteriores
    const vinculosDB = await obtenerVinculosManuales(facturasDrive.map(f => f.id));

    // Fase 1: aplicar vínculos manuales previos
    const usadas = new Set();        // índices de líneas del Mayor ya usadas
    const facturasUsadas = new Set(); // IDs de facturas ya vinculadas
    const resultados = [];

    for (const v of vinculosDB) {
      const factura = facturasDrive.find(f => f.id === v.factura_id);
      if (!factura || facturasUsadas.has(factura.id)) continue;

      // Buscar la línea del Mayor que coincide con el vínculo guardado
      const idxMayor = lineasFactura.findIndex((l, idx) => {
        if (usadas.has(idx)) return false;
        const imp = round2(l.haber > 0 ? l.haber : l.debe);
        return l.fecha === v.mayor_fecha && imp === round2(v.mayor_importe);
      });

      if (idxMayor >= 0) {
        usadas.add(idxMayor);
        facturasUsadas.add(factura.id);
        const l = lineasFactura[idxMayor];
        const importeMayor = round2(l.haber > 0 ? l.haber : l.debe);
        resultados.push({
          factura: { id: factura.id, numero_factura: factura.datos?.numero_factura, fecha_emision: factura.datos?.fecha_emision, total_factura: round2(factura.datos?.total_factura), nombre_archivo: factura.nombre_archivo },
          mayor:   { fecha: l.fecha, concepto: l.concepto, documento: l.documento, importe: importeMayor, lineaOriginal: l.lineaOriginal },
          estado:  'CONCILIADA_MANUAL',
          detalleMatch: { fechaCoincide: true, importeCoincide: true, referenciaEncontrada: false, refSimplificada: null },
        });
      }
    }

    // Fase 2: matching automático para facturas no vinculadas manualmente
    for (const factura of facturasDrive) {
      if (facturasUsadas.has(factura.id)) continue;
      resultados.push(cruzarFacturaEnMayor(factura, lineasFactura, anio, usadas));
    }

    // Líneas del Mayor que no se emparejaron con ninguna factura → SIN_FACTURA
    lineasFactura.forEach((l, idx) => {
      if (!usadas.has(idx)) {
        const importeMayor = round2(l.haber > 0 ? l.haber : l.debe);
        resultados.push({
          factura: null,
          mayor:   { fecha: l.fecha, concepto: l.concepto, documento: l.documento, importe: importeMayor, lineaOriginal: l.lineaOriginal },
          estado:  'SIN_FACTURA',
          detalleMatch: { fechaCoincide: false, importeCoincide: false, referenciaEncontrada: false, refSimplificada: null },
        });
      }
    });

    const conciliadas       = resultados.filter(r => r.estado === 'CONCILIADA').length;
    const conciliadasManual = resultados.filter(r => r.estado === 'CONCILIADA_MANUAL').length;
    const parciales         = resultados.filter(r => r.estado === 'PARCIAL').length;
    const sinMatch          = resultados.filter(r => r.estado === 'SIN_MATCH').length;
    const sinFactura        = resultados.filter(r => r.estado === 'SIN_FACTURA').length;

    totalConciliadas       += conciliadas;
    totalConciliadasManual += conciliadasManual;
    totalParciales         += parciales;
    totalSinMatch          += sinMatch;
    totalSinFactura        += sinFactura;
    totalLineas            += resultados.length;

    resultadosPorProveedor.push({
      codigoCuenta:  prov.codigoCuenta,
      proveedorId:   prov.proveedorId,
      nombreCarpeta: prov.nombreCarpeta,
      razonSocial:   prov.razonSocial,
      nombreMayor:   prov.nombreMayor,
      resultados,
      resumen: { total: resultados.length, conciliadas, conciliadasManual, parciales, sinMatch, sinFactura },
    });
  }

  return {
    resultadosPorProveedor,
    resumenGlobal: {
      totalProveedores: proveedoresConLineas.length,
      totalLineas,
      conciliadas:       totalConciliadas,
      conciliadasManual: totalConciliadasManual,
      parciales:         totalParciales,
      sinMatch:          totalSinMatch,
      sinFactura:        totalSinFactura,
    },
  };
}

module.exports = { ejecutarConciliacion, ejecutarConciliacionV2, simplificarReferencia };
