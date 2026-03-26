/**
 * sageExporter.js
 * Genera fichero CSV en protocolo ContaPlus R75 (142 campos separados por ;)
 *
 * Cuentas IVA soportado (PGC Pymes Scholarum):
 *   47200000 — IVA 0%
 *   47200004 — IVA 4%
 *   47200010 — IVA 10%
 *   47200021 — IVA 21%
 *
 * Por cada factura genera 2 + N lineas:
 *   1. Proveedor (cuenta 4xx) en HABER — importe total con IVA
 *   2. Gasto (cuenta 6xx/2xx) en DEBE — base imponible total
 *   3..N. IVA soportado en DEBE — una linea por cada tipo de IVA
 */

const TOTAL_CAMPOS = 142;

// Mapa de tipo IVA → subcuenta IVA soportado
const CUENTAS_IVA = {
  0:  '47200000',
  4:  '47200004',
  10: '47200010',
  21: '47200021',
};

function getCuentaIva(tipo) {
  return CUENTAS_IVA[tipo] || CUENTAS_IVA[21]; // fallback a 21%
}

// ─── Helpers de formateo ────────────────────────────────────────────────────

/** Numerico con decimales: sin separador decimal, ceros a la izquierda */
function numDec(valor, lon, dec) {
  const n = parseFloat(valor) || 0;
  const entero = Math.round(Math.abs(n) * Math.pow(10, dec));
  return String(entero).padStart(lon, '0').substring(0, lon);
}

/** Fecha en formato AAAAMMDD */
function fecha(iso) {
  if (!iso) return '        ';
  return String(iso).replace(/-/g, '').padEnd(8, ' ').substring(0, 8);
}

/** Logico */
function logico(val) {
  if (val === true) return '.T.';
  if (val === false) return '.F.';
  return '';
}

function lineaCSV(campos) {
  while (campos.length < TOTAL_CAMPOS) campos.push('');
  return campos.slice(0, TOTAL_CAMPOS).join(';');
}

// ─── Construir lineas por factura ───────────────────────────────────────────

function construirLineasFactura(factura, numAsiento) {
  const d = factura.datos_extraidos || {};
  const ivaList = Array.isArray(d.iva) ? d.iva.filter(e => e.base > 0 || e.cuota > 0) : [];

  const fechaEmision  = d.fecha_emision || '';
  const numFactura    = d.numero_factura || '';
  const concepto      = (d.nombre_emisor || factura.proveedor || '').substring(0, 25);
  const conceptoLargo = (d.nombre_emisor || factura.proveedor || '').substring(0, 50);
  const cifEmisor     = d.cif_emisor || '';
  const nombreEmisor  = d.nombre_emisor || '';
  const totalFactura  = parseFloat(d.total_factura) || 0;
  const baseSinIva    = parseFloat(d.total_sin_iva) || 0;
  const ctaProveedor  = factura.cta_proveedor_codigo || '';
  const ctaGasto      = factura.cuenta_gasto_codigo || '';
  const fechaFmt      = fecha(fechaEmision);
  const asiento       = String(numAsiento);

  const lineas = [];

  // Linea 1: Proveedor en HABER (cuenta 4xx)
  const l1 = new Array(TOTAL_CAMPOS).fill('');
  l1[0]  = asiento;
  l1[1]  = fechaFmt;
  l1[2]  = ctaProveedor;
  l1[3]  = ctaGasto;
  l1[4]  = '0';
  l1[5]  = concepto;
  l1[6]  = numDec(totalFactura, 16, 2);
  l1[11] = numFactura.substring(0, 10);
  l1[26] = '2';
  l1[27] = '0';
  l1[28] = numDec(totalFactura, 16, 2);
  l1[95] = numDec(totalFactura, 16, 2);
  l1[132] = conceptoLargo;
  lineas.push(lineaCSV(l1));

  // Linea 2: Gasto en DEBE (cuenta 6xx/2xx) — base imponible total
  const l2 = new Array(TOTAL_CAMPOS).fill('');
  l2[0]  = asiento;
  l2[1]  = fechaFmt;
  l2[2]  = ctaGasto;
  l2[3]  = ctaProveedor;
  l2[4]  = numDec(baseSinIva, 16, 2);
  l2[5]  = concepto;
  l2[6]  = '0';
  l2[11] = numFactura.substring(0, 10);
  l2[26] = '2';
  l2[27] = numDec(baseSinIva, 16, 2);
  l2[28] = '0';
  l2[132] = conceptoLargo;
  lineas.push(lineaCSV(l2));

  // Lineas 3..N: IVA soportado en DEBE — una linea por cada tipo de IVA
  if (ivaList.length === 0) {
    // Sin desglose: generar una linea con el total IVA al 21% por defecto
    const totalIva = parseFloat(d.total_iva) || 0;
    if (totalIva > 0) {
      const l3 = crearLineaIva(asiento, fechaFmt, ctaProveedor, concepto, conceptoLargo, numFactura, cifEmisor, nombreEmisor, totalFactura, baseSinIva, totalIva, 21);
      lineas.push(lineaCSV(l3));
    }
  } else {
    for (const iva of ivaList) {
      const tipo  = iva.tipo || 21;
      const base  = parseFloat(iva.base) || 0;
      const cuota = parseFloat(iva.cuota) || 0;
      if (cuota > 0 || tipo === 0) {
        const l = crearLineaIva(asiento, fechaFmt, ctaProveedor, concepto, conceptoLargo, numFactura, cifEmisor, nombreEmisor, totalFactura, base, cuota, tipo);
        lineas.push(lineaCSV(l));
      }
    }
  }

  return lineas;
}

function crearLineaIva(asiento, fechaFmt, ctaProveedor, concepto, conceptoLargo, numFactura, cifEmisor, nombreEmisor, totalFactura, base, cuota, tipoIva) {
  const ctaIva = getCuentaIva(tipoIva);
  const l = new Array(TOTAL_CAMPOS).fill('');
  l[0]  = asiento;
  l[1]  = fechaFmt;
  l[2]  = ctaIva;
  l[3]  = ctaProveedor;
  l[4]  = numDec(cuota, 16, 2);
  l[5]  = concepto;
  l[6]  = '0';
  l[7]  = numFactura.substring(0, 8);
  l[8]  = numDec(base, 16, 2);
  l[9]  = numDec(tipoIva, 5, 2);
  l[10] = '0';
  l[11] = numFactura.substring(0, 10);
  l[26] = '2';
  l[27] = numDec(cuota, 16, 2);
  l[28] = '0';
  l[29] = numDec(base, 16, 2);
  l[61] = cifEmisor;
  l[62] = nombreEmisor.substring(0, 40);
  l[72] = 'R';
  l[73] = 'O';
  l[75] = logico(true);
  l[95] = numDec(totalFactura, 16, 2);
  l[132] = conceptoLargo;
  l[133] = cifEmisor;
  l[134] = nombreEmisor.substring(0, 120);
  return l;
}

// ─── Funcion principal ──────────────────────────────────────────────────────

function generarFicheroSage(facturas, asientoInicio = 1) {
  const lineas = [];
  let numAsiento = asientoInicio;

  for (const factura of facturas) {
    const lineasFactura = construirLineasFactura(factura, numAsiento);
    lineas.push(...lineasFactura);
    numAsiento++;
  }

  return {
    contenido: lineas.join('\r\n') + '\r\n',
    asientoFin: numAsiento - 1,
  };
}

module.exports = { generarFicheroSage };
