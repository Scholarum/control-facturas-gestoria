// ─── Formato SICE / A3Simple ──────────────────────────────────────────────────
// Cada factura genera N+2 líneas:
//   - 1 línea de gasto  (cuenta_gasto,    importe base,  D/H)
//   - N líneas de IVA   (47200000,         cuota IVA,    D/H)
//   - 1 línea proveedor (cuenta_proveedor, importe total, H/D)
// Abonos (total < 0): se invierten D/H y se usa importe absoluto.

function padCuenta(code) {
  if (!code) return '';
  return String(code).padEnd(8, '0').substring(0, 8);
}

function formatFecha(isoStr) {
  if (!isoStr) return '';
  const parts = String(isoStr).split('-');
  const [y, m, d] = parts;
  return `${(d || '01').padStart(2, '0')}${(m || '01').padStart(2, '0')}${y || '2000'}`;
}

function formatImporte(n) {
  return Math.abs(parseFloat(n) || 0).toFixed(2).replace('.', ',');
}

function truncate(str, len) {
  return String(str || '').substring(0, len);
}

function generarLineasAsiento(archivo) {
  const datos = archivo.datos_extraidos || {};

  const fecha      = formatFecha(datos.fecha_emision);
  const numFac     = datos.numero_factura || archivo.nombre_archivo || '';
  const proveedor  = archivo.proveedor || '';
  const concepto   = truncate(`Fca ${numFac} - ${proveedor}`, 50);

  const totalFac   = parseFloat(datos.total_factura ?? 0);
  const isAbono    = totalFac < 0;

  const ctaGasto     = padCuenta(archivo.cuenta_gasto_codigo);
  const ctaProveedor = padCuenta(archivo.cta_proveedor_codigo);

  const signoGasto    = isAbono ? 'H' : 'D';
  const signoProveedor = isAbono ? 'D' : 'H';

  const lineas = [];

  // Línea de gasto (base imponible)
  const base = parseFloat(datos.total_sin_iva != null ? datos.total_sin_iva : totalFac);
  lineas.push([fecha, ctaGasto, concepto, formatImporte(base), signoGasto].join(';'));

  // Líneas IVA (una por cada tipo con cuota > 0)
  const ivaArr = Array.isArray(datos.iva) ? datos.iva : [];
  for (const entry of ivaArr) {
    const cuota = parseFloat(entry.cuota ?? 0);
    if (Math.abs(cuota) > 0.001) {
      lineas.push([fecha, '47200000', concepto, formatImporte(cuota), signoGasto].join(';'));
    }
  }

  // Línea proveedor (total con IVA)
  lineas.push([fecha, ctaProveedor, concepto, formatImporte(totalFac), signoProveedor].join(';'));

  return lineas;
}

function generarCSV(archivos) {
  const lineas = [];
  for (const archivo of archivos) {
    lineas.push(...generarLineasAsiento(archivo));
  }
  return lineas.join('\r\n');
}

function generarNombreFichero() {
  const now  = new Date();
  const yyyy = now.getFullYear();
  const mm   = String(now.getMonth() + 1).padStart(2, '0');
  const dd   = String(now.getDate()).padStart(2, '0');
  const HH   = String(now.getHours()).padStart(2, '0');
  const min  = String(now.getMinutes()).padStart(2, '0');
  return `A3_Export_${yyyy}-${mm}-${dd}_${HH}${min}.csv`;
}

function calcularTotales(archivos) {
  return archivos.reduce((acc, a) => {
    const d = a.datos_extraidos || {};
    acc.base    += parseFloat(d.total_sin_iva ?? d.total_factura ?? 0);
    acc.cuota   += Array.isArray(d.iva)
      ? d.iva.reduce((s, e) => s + parseFloat(e.cuota ?? 0), 0)
      : 0;
    acc.factura += parseFloat(d.total_factura ?? 0);
    return acc;
  }, { base: 0, cuota: 0, factura: 0 });
}

module.exports = { generarCSV, generarNombreFichero, calcularTotales };
