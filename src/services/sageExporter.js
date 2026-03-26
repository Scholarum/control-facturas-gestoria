/**
 * sageExporter.js
 * Genera fichero CSV en protocolo ContaPlus R75 (142 campos separados por ;)
 *
 * Por cada factura genera 3 líneas:
 *   1. Proveedor (cuenta 4xx) en HABER — importe total con IVA
 *   2. Gasto (cuenta 6xx/2xx) en DEBE — base imponible
 *   3. IVA soportado (cuenta 472) en DEBE — cuota IVA
 */

const TOTAL_CAMPOS = 142;

// ─── Helpers de formateo ────────────────────────────────────────────────────

/** Texto: rellena con espacios a la derecha hasta la longitud exacta */
function txt(valor, lon) {
  const s = String(valor || '').substring(0, lon);
  return s + ' '.repeat(Math.max(lon - s.length, 0));
}

/** Numérico entero: rellena con ceros a la izquierda */
function num(valor, lon) {
  const n = parseInt(valor, 10) || 0;
  const s = String(Math.abs(n));
  return s.padStart(lon, '0').substring(0, lon);
}

/** Numérico con decimales: sin separador decimal, ceros a la izquierda
 *  Ej: 100.50 con lon=16 dec=2 → '0000000000010050' */
function numDec(valor, lon, dec) {
  const n = parseFloat(valor) || 0;
  const entero = Math.round(Math.abs(n) * Math.pow(10, dec));
  return String(entero).padStart(lon, '0').substring(0, lon);
}

/** Fecha en formato AAAAMMDD */
function fecha(iso) {
  if (!iso) return '        '; // 8 espacios
  const s = String(iso).replace(/-/g, '');
  return s.padEnd(8, ' ').substring(0, 8);
}

/** Lógico: .T. o .F. o vacío */
function logico(val) {
  if (val === true) return '.T.';
  if (val === false) return '.F.';
  return '';
}

// ─── Generar línea CSV de 142 campos ────────────────────────────────────────

function lineaCSV(campos) {
  // Asegurar exactamente 142 campos
  while (campos.length < TOTAL_CAMPOS) campos.push('');
  return campos.slice(0, TOTAL_CAMPOS).join(';');
}

// ─── Construir las 3 líneas por factura ─────────────────────────────────────

function construirLineasFactura(factura, numAsiento) {
  const d = factura.datos_extraidos || {};
  const iva = Array.isArray(d.iva) ? d.iva : [];

  const fechaEmision  = d.fecha_emision || '';
  const numFactura    = d.numero_factura || '';
  const concepto      = (d.nombre_emisor || factura.proveedor || '').substring(0, 25);
  const conceptoLargo = (d.nombre_emisor || factura.proveedor || '').substring(0, 50);
  const cifEmisor     = d.cif_emisor || '';
  const nombreEmisor  = d.nombre_emisor || '';
  const totalFactura  = parseFloat(d.total_factura) || 0;
  const baseSinIva    = parseFloat(d.total_sin_iva) || 0;
  const totalIva      = parseFloat(d.total_iva) || 0;
  const ctaProveedor  = factura.cta_proveedor_codigo || '';
  const ctaGasto      = factura.cuenta_gasto_codigo || '';

  // Determinar tipo y porcentaje de IVA principal
  const ivaPrincipal = iva.length > 0 ? iva.reduce((a, b) => (b.cuota || 0) > (a.cuota || 0) ? b : a, iva[0]) : { tipo: 21, base: baseSinIva, cuota: totalIva };
  const pctIva = ivaPrincipal.tipo || 21;

  // Subcuenta IVA soportado: 47200000 + tipo (o la que corresponda)
  const ctaIva = '47200000';

  const fechaFmt = fecha(fechaEmision);
  const asiento  = String(numAsiento);

  const lineas = [];

  // Línea 1: Proveedor en HABER (cuenta 4xx)
  const l1 = new Array(TOTAL_CAMPOS).fill('');
  l1[0]  = asiento;                          // Asien
  l1[1]  = fechaFmt;                         // Fecha
  l1[2]  = ctaProveedor;                     // SubCta
  l1[3]  = ctaGasto;                         // Contra
  l1[4]  = '0';                              // PtaDebe (0)
  l1[5]  = concepto;                         // Concepto
  l1[6]  = numDec(totalFactura, 16, 2);      // PtaHaber
  l1[7]  = '';                               // Factura (no IVA)
  l1[8]  = '';                               // Baseimpo
  l1[9]  = '';                               // IVA %
  l1[10] = '';                               // Recequiv
  l1[11] = numFactura.substring(0, 10);      // Documento
  l1[26] = '2';                              // MonedaUso (2=Euros)
  l1[27] = '0';                              // EuroDebe
  l1[28] = numDec(totalFactura, 16, 2);      // EuroHaber
  l1[29] = '';                               // BaseEuro
  l1[95] = numDec(totalFactura, 16, 2);      // nTotalFac
  l1[132] = conceptoLargo;                   // ConcepNew
  lineas.push(lineaCSV(l1));

  // Línea 2: Gasto en DEBE (cuenta 6xx/2xx)
  const l2 = new Array(TOTAL_CAMPOS).fill('');
  l2[0]  = asiento;
  l2[1]  = fechaFmt;
  l2[2]  = ctaGasto;
  l2[3]  = ctaProveedor;                     // Contra = proveedor
  l2[4]  = numDec(baseSinIva, 16, 2);        // PtaDebe
  l2[5]  = concepto;
  l2[6]  = '0';                              // PtaHaber
  l2[7]  = '';
  l2[8]  = '';
  l2[11] = numFactura.substring(0, 10);
  l2[26] = '2';
  l2[27] = numDec(baseSinIva, 16, 2);        // EuroDebe
  l2[28] = '0';                              // EuroHaber
  l2[132] = conceptoLargo;
  lineas.push(lineaCSV(l2));

  // Línea 3: IVA soportado en DEBE (cuenta 472)
  const l3 = new Array(TOTAL_CAMPOS).fill('');
  l3[0]  = asiento;
  l3[1]  = fechaFmt;
  l3[2]  = ctaIva;                           // SubCta IVA
  l3[3]  = ctaProveedor;                     // Contra = proveedor
  l3[4]  = numDec(totalIva, 16, 2);          // PtaDebe
  l3[5]  = concepto;
  l3[6]  = '0';                              // PtaHaber
  l3[7]  = numFactura.substring(0, 8);       // Factura (nº para libro IVA)
  l3[8]  = numDec(baseSinIva, 16, 2);        // Baseimpo
  l3[9]  = numDec(pctIva, 5, 2);             // IVA %
  l3[10] = '0';                              // Recequiv
  l3[11] = numFactura.substring(0, 10);      // Documento
  l3[26] = '2';
  l3[27] = numDec(totalIva, 16, 2);          // EuroDebe
  l3[28] = '0';                              // EuroHaber
  l3[29] = numDec(baseSinIva, 16, 2);        // BaseEuro
  l3[53] = '';                               // RazonSoc
  l3[60] = '';                               // TerIdNif
  l3[61] = cifEmisor;                        // TerNIF
  l3[62] = nombreEmisor.substring(0, 40);    // TerNom
  l3[72] = 'R';                              // TipoFac = Recibida
  l3[73] = 'O';                              // TipoIVA = Deducible op. interiores
  l3[75] = logico(true);                     // L340 = incluir en modelo
  l3[95] = numDec(totalFactura, 16, 2);      // nTotalFac
  l3[132] = conceptoLargo;
  l3[133] = cifEmisor;                       // TerNifNew
  l3[134] = nombreEmisor.substring(0, 120);  // TerNomNew
  lineas.push(lineaCSV(l3));

  return lineas;
}

// ─── Función principal ──────────────────────────────────────────────────────

function generarFicheroSage(facturas) {
  const lineas = [];
  let numAsiento = 1;

  // Obtener el último número de asiento para empezar desde ahí
  // (en una implementación más completa se consultaría la DB)

  for (const factura of facturas) {
    const lineasFactura = construirLineasFactura(factura, numAsiento);
    lineas.push(...lineasFactura);
    numAsiento++;
  }

  return lineas.join('\r\n') + '\r\n';
}

module.exports = { generarFicheroSage };
