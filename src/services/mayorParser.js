/**
 * mayorParser.js
 * Parseo directo de archivos de Mayor (Excel/CSV) sin IA.
 * Segmenta por proveedor detectando cuentas contables de 8 dígitos.
 */
const XLSX    = require('xlsx');
const { getDb } = require('../config/database');

// ─── Detección de columnas ───────────────────────────────────────────────────

const PALABRAS_FECHA    = ['fecha', 'fec', 'date'];
const PALABRAS_CONCEPTO = ['concepto', 'descripcion', 'detalle', 'texto', 'descripción'];
const PALABRAS_DEBE     = ['debe', 'cargo', 'debit'];
const PALABRAS_HABER    = ['haber', 'abono', 'credit', 'crédito', 'credito'];

function detectarColumnas(filas) {
  // Buscar fila de cabecera en las primeras 15 filas
  for (let i = 0; i < Math.min(filas.length, 15); i++) {
    const fila = filas[i];
    if (!fila || !fila.length) continue;

    const celdas = fila.map(c => String(c || '').toLowerCase().trim());
    const idx = { fecha: -1, concepto: -1, debe: -1, haber: -1 };

    for (let j = 0; j < celdas.length; j++) {
      const c = celdas[j];
      if (idx.fecha === -1    && PALABRAS_FECHA.some(p => c.includes(p)))    idx.fecha = j;
      if (idx.concepto === -1 && PALABRAS_CONCEPTO.some(p => c.includes(p))) idx.concepto = j;
      if (idx.debe === -1     && PALABRAS_DEBE.some(p => c === p))           idx.debe = j;
      if (idx.haber === -1    && PALABRAS_HABER.some(p => c === p))          idx.haber = j;
    }

    // Necesitamos al menos fecha, concepto y debe
    if (idx.fecha >= 0 && idx.concepto >= 0 && idx.debe >= 0) {
      return { ...idx, filaCabecera: i };
    }
  }
  return null;
}

// ─── Parseo de valores ──────────────────────────────────────────────────────

function parsearFecha(valor) {
  if (valor == null || valor === '') return null;

  // Serial de Excel
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }

  const str = String(valor).trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY o DD-MM-YYYY
  const m = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const anio = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${anio}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

function parsearImporte(valor) {
  if (valor == null || valor === '') return null;
  if (typeof valor === 'number') return Math.round(valor * 100) / 100;

  let str = String(valor).trim().replace(/[€$\s]/g, '');
  if (!str) return null;

  // Formato europeo: 1.234,56 → 1234.56
  if (/\d+\.\d{3}/.test(str) && str.includes(',')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',') && !str.includes('.')) {
    str = str.replace(',', '.');
  }

  const n = parseFloat(str);
  return isNaN(n) ? null : Math.round(n * 100) / 100;
}

// ─── Detección de líneas de cabecera de proveedor ────────────────────────────

function esLineaCabecera(fila) {
  if (!fila || !fila.length) return null;
  // Unir todas las celdas para buscar el patrón
  const texto = fila.map(c => String(c || '').trim()).join(' ').trim();
  if (!texto) return null;

  // Buscar 8 dígitos al inicio de alguna celda o del texto completo
  const m = texto.match(/\b(\d{8})\b/);
  if (!m) return null;

  const codigoCuenta = m[1];
  // El nombre del proveedor es lo que viene después del código
  let nombreProveedor = texto.substring(texto.indexOf(codigoCuenta) + 8).trim();
  // Limpiar separadores típicos
  nombreProveedor = nombreProveedor.replace(/^[\s\-:]+/, '').trim();

  return { codigoCuenta, nombreProveedor: nombreProveedor || null };
}

// ─── Filtro de facturas ─────────────────────────────────────────────────────

function esFacturaRecibida(concepto) {
  if (!concepto) return false;
  const c = concepto.toUpperCase();
  return /\bF\//.test(c) || /\bFRA\b/.test(c) || /\bFACT/.test(c);
}

// ─── Resolución de proveedores contra la DB ─────────────────────────────────

async function resolverProveedores(segmentos) {
  const db = getDb();
  const proveedores = await db.all(`
    SELECT p.id, p.nombre_carpeta, p.razon_social, p.cif, pc.codigo AS cuenta_codigo
    FROM proveedores p
    LEFT JOIN plan_contable pc ON pc.id = p.cuenta_contable_id
    WHERE p.activo = true
  `);

  return segmentos.map(seg => {
    // Buscar proveedor cuya cuenta_codigo sea prefijo del código de 8 dígitos del Mayor
    const match = proveedores.find(p =>
      p.cuenta_codigo && seg.codigoCuenta.startsWith(p.cuenta_codigo)
    );
    return {
      ...seg,
      proveedorId:    match?.id || null,
      nombreCarpeta:  match?.nombre_carpeta || null,
      razonSocial:    match?.razon_social || null,
      cifProveedor:   match?.cif || null,
    };
  });
}

// ─── Función principal ──────────────────────────────────────────────────────

async function parsearMayor(buffer, mimetype, filename) {
  const ext = filename.toLowerCase().split('.').pop();

  let filas;
  if (ext === 'csv' || mimetype === 'text/csv' || mimetype === 'text/plain') {
    const texto = buffer.toString('utf8');
    filas = texto.split(/\r?\n/).map(l => l.split(/[;\t,]/).map(c => c.trim()));
  } else {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const ws = wb.Sheets[wb.SheetNames[0]];
    filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  }

  if (!filas.length) throw new Error('El archivo está vacío');

  // Detectar columnas
  const cols = detectarColumnas(filas);
  if (!cols) {
    throw new Error(
      'No se pudieron detectar las columnas del Mayor. ' +
      'Verifica que el archivo tenga cabeceras con: Fecha, Concepto/Descripción, Debe, Haber.'
    );
  }

  // Segmentar por proveedor
  const segmentos = [];
  let segActual = null;
  let totalLineas = 0;

  for (let i = cols.filaCabecera + 1; i < filas.length; i++) {
    const fila = filas[i];
    if (!fila || !fila.length) continue;

    // ¿Es una línea cabecera de proveedor?
    const cabecera = esLineaCabecera(fila);
    if (cabecera) {
      if (segActual) segmentos.push(segActual);
      segActual = {
        codigoCuenta:  cabecera.codigoCuenta,
        nombreMayor:   cabecera.nombreProveedor,
        lineas: [],
      };
      continue;
    }

    if (!segActual) continue;

    // Parsear línea de datos
    const fecha    = parsearFecha(fila[cols.fecha]);
    const concepto = String(fila[cols.concepto] || '').trim();
    const debe     = parsearImporte(fila[cols.debe]);
    const haber    = cols.haber >= 0 ? parsearImporte(fila[cols.haber]) : null;

    // Solo líneas con fecha y algún importe
    if (!fecha || (debe == null && haber == null)) continue;

    totalLineas++;
    segActual.lineas.push({
      fecha,
      concepto,
      debe,
      haber,
      esFactura:     esFacturaRecibida(concepto),
      lineaOriginal: i + 1, // 1-based para el usuario
    });
  }
  if (segActual) segmentos.push(segActual);

  // Resolver proveedores contra la DB
  const proveedoresResueltos = await resolverProveedores(segmentos);

  return {
    proveedores:     proveedoresResueltos,
    totalLineas,
    totalProveedores: proveedoresResueltos.length,
  };
}

module.exports = { parsearMayor };
