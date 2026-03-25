/**
 * mayorParser.js
 * Parseo directo de archivos de Mayor contable (Excel/CSV).
 *
 * Estructura de columnas esperada (A-M):
 *   A: CUENTA CONTABLE   B: ASIENTO   C: FECHA   D: RAZON SOCIAL/EMPRESA
 *   E: (vacía)           F: DOCUMENTO G: CONTRAPARTIDA  H: (vacía)
 *   I: CONCEPTO          J: SEGMENTOS K: DEBE    L: HABER   M: SALDOS
 *
 * Segmentación por proveedor:
 *   - Columna A contiene código de 8 dígitos → inicio de bloque
 *   - Columna D contiene la razón social
 *
 * Identificación de facturas:
 *   - Columna F (DOCUMENTO) debe empezar por 'F/' → factura recibida
 *
 * Datos para matching:
 *   - Fecha:     Columna C
 *   - Importe:   Columna L (HABER) = total factura con IVA
 *   - Concepto:  Columna I → para búsqueda de referencia simplificada
 */
const XLSX      = require('xlsx');
const { getDb } = require('../config/database');

// ─── Índices fijos de columnas (A=0, B=1, ..., M=12) ────────────────────────

const COL = {
  CUENTA:     0,  // A - Cuenta contable (8 dígitos en cabecera de proveedor)
  ASIENTO:    1,  // B
  FECHA:      2,  // C
  RAZON:      3,  // D - Razón social (en cabecera de proveedor)
  DOCUMENTO:  5,  // F - 'F/xxx' = factura recibida
  CONCEPTO:   8,  // I - Texto del concepto (para referencia fuzzy)
  DEBE:      10,  // K
  HABER:     11,  // L - Importe total factura con IVA
};

// ─── Parseo de valores ──────────────────────────────────────────────────────

function parsearFecha(valor) {
  if (valor == null || valor === '') return null;

  // Serial de Excel
  if (typeof valor === 'number') {
    const d = XLSX.SSF.parse_date_code(valor);
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }

  const str = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;

  // DD/MM/YYYY, DD-MM-YYYY, DD-MM-YY
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

// ─── Detección de cabecera de proveedor ─────────────────────────────────────

function detectarCabeceraProveedor(fila) {
  const celdaA = String(fila[COL.CUENTA] || '').trim();
  if (!/^\d{8}$/.test(celdaA)) return null;

  const razonSocial = String(fila[COL.RAZON] || '').trim();
  return {
    codigoCuenta:    celdaA,
    nombreProveedor: razonSocial || null,
  };
}

// ─── Identificación de factura (columna F empieza por F/) ───────────────────

function esFacturaRecibida(fila) {
  const doc = String(fila[COL.DOCUMENTO] || '').trim().toUpperCase();
  return doc.startsWith('F/') || doc.startsWith('F ');
}

// ─── Detectar fila de cabecera para saber dónde empiezan los datos ──────────

function encontrarFilaCabecera(filas) {
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const celdaA = String(filas[i]?.[COL.CUENTA] || '').toLowerCase().trim();
    if (celdaA.includes('cuenta')) return i;
  }
  return 0; // si no encuentra cabecera, empieza desde 0
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
    // Buscar proveedor cuya cuenta_codigo sea prefijo del código de 8 dígitos
    const match = proveedores.find(p =>
      p.cuenta_codigo && seg.codigoCuenta.startsWith(p.cuenta_codigo)
    );
    return {
      ...seg,
      proveedorId:   match?.id || null,
      nombreCarpeta: match?.nombre_carpeta || null,
      razonSocial:   match?.razon_social || null,
      cifProveedor:  match?.cif || null,
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

  if (!filas.length) throw new Error('El archivo esta vacio');

  const filaCabecera = encontrarFilaCabecera(filas);

  // Segmentar por proveedor
  const segmentos = [];
  let segActual   = null;
  let totalLineas = 0;

  for (let i = filaCabecera + 1; i < filas.length; i++) {
    const fila = filas[i];
    if (!fila || !fila.length) continue;

    // ¿Es una línea cabecera de proveedor? (col A = 8 dígitos, col D = razón social)
    const cabecera = detectarCabeceraProveedor(fila);
    if (cabecera) {
      if (segActual) segmentos.push(segActual);
      segActual = {
        codigoCuenta: cabecera.codigoCuenta,
        nombreMayor:  cabecera.nombreProveedor,
        lineas: [],
      };
      continue;
    }

    if (!segActual) continue;

    // Parsear fecha (col C) — si no hay fecha, no es un movimiento
    const fecha = parsearFecha(fila[COL.FECHA]);
    if (!fecha) continue;

    // Leer importes
    const debe     = parsearImporte(fila[COL.DEBE]);
    const haber    = parsearImporte(fila[COL.HABER]);
    if (debe == null && haber == null) continue;

    // Leer concepto (col I) y documento (col F)
    const concepto  = String(fila[COL.CONCEPTO] || '').trim();
    const documento = String(fila[COL.DOCUMENTO] || '').trim();
    const factura   = esFacturaRecibida(fila);

    totalLineas++;
    segActual.lineas.push({
      fecha,
      documento,
      concepto,
      debe,
      haber,
      esFactura:     factura,
      lineaOriginal: i + 1, // 1-based
    });
  }
  if (segActual) segmentos.push(segActual);

  if (!segmentos.length) {
    throw new Error(
      'No se encontraron proveedores en el archivo. ' +
      'Verifica que el Mayor contenga cuentas contables de 8 digitos en la columna A.'
    );
  }

  // Resolver proveedores contra la DB
  const proveedoresResueltos = await resolverProveedores(segmentos);

  return {
    proveedores:     proveedoresResueltos,
    totalLineas,
    totalProveedores: proveedoresResueltos.length,
  };
}

module.exports = { parsearMayor };
