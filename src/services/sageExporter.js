/**
 * sageExporter.js
 * Genera fichero TXT en protocolo ContaPlus R75 — formato ASCII posiciones fijas.
 * Cada linea tiene exactamente 75 caracteres (campos concatenados sin delimitador).
 *
 * Campos usados del diario (con posicion y longitud del manual):
 *   Pos  Campo       Tipo  Lon  Dec  Descripcion
 *   1    Asien       N     6         Numero del asiento
 *   2    Fecha       F     8         Fecha AAAAMMDD
 *   3    SubCta      C    12         Subcuenta
 *   4    Contra      C    12         Contrapartida
 *   5    PtaDebe     N    16    2    Importe debe (sin decimales, ceros izq)
 *   6    Concepto    C    25         Concepto del asiento
 *   7    PtaHaber    N    16    2    Importe haber (sin decimales, ceros izq)
 *   8    Factura     N     8         Numero factura IVA
 *   9    Baseimpo    N    16    2    Base imponible
 *  10    IVA         N     5    2    Porcentaje IVA (sin decimales)
 *  11    Recequiv    N     5    2    Recargo equivalencia
 *  12    Documento   C    10         Numero documento
 *
 * Total por linea: 6+8+12+12+16+25+16+8+16+5+5+10 = 139
 * Pero el protocolo R75 original usa 75 chars. Usamos los campos
 * esenciales ajustados a las longitudes del manual y generamos
 * un registro por linea con todos los campos concatenados.
 *
 * NOTA: Segun el manual, el formato CSV usa ; como separador.
 *       Generamos CSV ya que es el formato mas compatible con ContaPlus.
 *       La extension sera .txt para importacion como ASCII.
 *
 * Cuentas IVA soportado (PGC Pymes Scholarum):
 *   47200000 (0%), 47200004 (4%), 47200010 (10%), 47200021 (21%)
 */

const TOTAL_CAMPOS = 142;

const CUENTAS_IVA = {
  0:  '47200000',
  4:  '47200004',
  10: '47200010',
  21: '47200021',
};

function getCuentaIva(tipo) {
  return CUENTAS_IVA[tipo] || CUENTAS_IVA[21];
}

// ─── Helpers de formateo ────────────────────────────────────────────────────

/** Numerico con decimales: sin separador decimal, ceros a la izquierda */
function numDec(valor, lon, dec) {
  const n = parseFloat(valor) || 0;
  const entero = Math.round(Math.abs(n) * Math.pow(10, dec));
  return String(entero).padStart(lon, '0').substring(0, lon);
}

function fecha(iso) {
  if (!iso) return '        ';
  return String(iso).replace(/-/g, '').padEnd(8, ' ').substring(0, 8);
}

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

  // Linea 1: Proveedor en HABER
  const l1 = new Array(TOTAL_CAMPOS).fill('');
  l1[0]=asiento; l1[1]=fechaFmt; l1[2]=ctaProveedor; l1[3]=ctaGasto;
  l1[4]='0'; l1[5]=concepto; l1[6]=numDec(totalFactura,16,2);
  l1[11]=numFactura.substring(0,10); l1[26]='2'; l1[27]='0';
  l1[28]=numDec(totalFactura,16,2); l1[95]=numDec(totalFactura,16,2);
  l1[132]=conceptoLargo;
  lineas.push(lineaCSV(l1));

  // Linea 2: Gasto en DEBE
  const l2 = new Array(TOTAL_CAMPOS).fill('');
  l2[0]=asiento; l2[1]=fechaFmt; l2[2]=ctaGasto; l2[3]=ctaProveedor;
  l2[4]=numDec(baseSinIva,16,2); l2[5]=concepto; l2[6]='0';
  l2[11]=numFactura.substring(0,10); l2[26]='2';
  l2[27]=numDec(baseSinIva,16,2); l2[28]='0'; l2[132]=conceptoLargo;
  lineas.push(lineaCSV(l2));

  // Lineas IVA
  if (ivaList.length === 0) {
    const totalIva = parseFloat(d.total_iva) || 0;
    if (totalIva > 0) {
      lineas.push(lineaCSV(crearLineaIva(asiento, fechaFmt, ctaProveedor, concepto, conceptoLargo, numFactura, cifEmisor, nombreEmisor, totalFactura, baseSinIva, totalIva, 21)));
    }
  } else {
    for (const iva of ivaList) {
      const tipo = iva.tipo || 21, base = parseFloat(iva.base)||0, cuota = parseFloat(iva.cuota)||0;
      if (cuota > 0 || tipo === 0) {
        lineas.push(lineaCSV(crearLineaIva(asiento, fechaFmt, ctaProveedor, concepto, conceptoLargo, numFactura, cifEmisor, nombreEmisor, totalFactura, base, cuota, tipo)));
      }
    }
  }
  return lineas;
}

function crearLineaIva(asiento, fechaFmt, ctaProveedor, concepto, conceptoLargo, numFactura, cifEmisor, nombreEmisor, totalFactura, base, cuota, tipoIva) {
  const ctaIva = getCuentaIva(tipoIva);
  const l = new Array(TOTAL_CAMPOS).fill('');
  l[0]=asiento; l[1]=fechaFmt; l[2]=ctaIva; l[3]=ctaProveedor;
  l[4]=numDec(cuota,16,2); l[5]=concepto; l[6]='0';
  l[7]=numFactura.substring(0,8); l[8]=numDec(base,16,2);
  l[9]=numDec(tipoIva,5,2); l[10]='0'; l[11]=numFactura.substring(0,10);
  l[26]='2'; l[27]=numDec(cuota,16,2); l[28]='0';
  l[29]=numDec(base,16,2); l[61]=cifEmisor;
  l[62]=nombreEmisor.substring(0,40); l[72]='R'; l[73]='O';
  l[75]=logico(true); l[95]=numDec(totalFactura,16,2);
  l[132]=conceptoLargo; l[133]=cifEmisor;
  l[134]=nombreEmisor.substring(0,120);
  return l;
}

// ─── Funcion principal ──────────────────────────────────────────────────────
// asientosPorProveedor: { proveedorId: asientoInicio }

function generarFicheroSage(facturas, asientosPorProveedor = {}) {
  const lineas = [];
  // Agrupar facturas por proveedor
  const porProveedor = {};
  for (const f of facturas) {
    const pid = f.proveedor_id || '_sin';
    if (!porProveedor[pid]) porProveedor[pid] = [];
    porProveedor[pid].push(f);
  }

  const asientosFin = {}; // { proveedorId: ultimoAsiento }

  for (const [pid, facts] of Object.entries(porProveedor)) {
    let numAsiento = asientosPorProveedor[pid] || 1;
    for (const factura of facts) {
      lineas.push(...construirLineasFactura(factura, numAsiento));
      numAsiento++;
    }
    asientosFin[pid] = numAsiento - 1;
  }

  return {
    contenido: lineas.join('\r\n') + '\r\n',
    asientosFin,
  };
}

module.exports = { generarFicheroSage };
