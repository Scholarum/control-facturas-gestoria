/**
 * sageExporter.js
 * Genera ficheros para importacion en SAGE ContaPlus — protocolo R75.
 *
 * Dos formatos:
 *   CSV (.csv): 142 campos separados por ; (delimitado)
 *   TXT (.txt): 142 campos en posiciones fijas (longitud exacta, sin delimitador)
 *
 * Longitudes de los 142 campos del Diario segun el manual:
 *   Pos  Campo         Tipo Lon Dec | Pos  Campo         Tipo Lon Dec
 *   1    Asien         N    6       | 22   Auxiliar      C    1
 *   2    Fecha         F    8       | 23   Serie         C    1
 *   3    SubCta        C   12       | 24   Sucursal      C    4
 *   4    Contra        C   12       | 25   CodDivisa     C    5
 *   5    PtaDebe       N   16   2   | 26   ImpAuxME      N   16   2
 *   6    Concepto      C   25       | 27   MonedaUso     C    1
 *   7    PtaHaber      N   16   2   | 28   EuroDebe      N   16   2
 *   8    Factura       N    8       | 29   EuroHaber     N   16   2
 *   9    Baseimpo      N   16   2   | 30   BaseEuro      N   16   2
 *  10    IVA           N    5   2   | 31   NoConv        L    1
 *  11    Recequiv      N    5   2   | 32   NumeroInv     C   10
 *  12    Documento     C   10       | 33   Serie_RT      C    1
 *  13    Departa       C    3       | 34   Factu_RT      N    8
 *  14    Clave         C    6       | 35   BaseImp_RT    N   16   2
 *  15    Estado        C    1       | 36   BaseImp_RF    N   16   2
 *  16    NCasado       N    6       | 37   Rectifica     L    1
 *  17    TCasado       N    1       | 38   Fecha_RT      F    8
 *  18    Trans         N    6       | 39   NIC           C    1
 *  19    Cambio        N   16   6   | 40   Libre_L       L    1
 *  20    DebeME        N   16   2   | 41   Libre_N       N    6
 *  21    HaberME       N   16   2   | 42-142 (resto de campos)
 */

const CUENTAS_IVA = {
  0:  '47200000',
  4:  '47200004',
  10: '47200010',
  21: '47200021',
};

function getCuentaIva(tipo) {
  return CUENTAS_IVA[tipo] || CUENTAS_IVA[21];
}

// ─── Definicion de campos con longitudes exactas del manual ─────────────────
// Tipo: N=numerico, C=caracter, F=fecha(8), L=logico(1)

const CAMPOS = [
  /*  1 */ { lon: 6,  tipo: 'N' },  // Asien
  /*  2 */ { lon: 8,  tipo: 'F' },  // Fecha
  /*  3 */ { lon: 12, tipo: 'C' },  // SubCta
  /*  4 */ { lon: 12, tipo: 'C' },  // Contra
  /*  5 */ { lon: 16, tipo: 'N', dec: 2 },  // PtaDebe
  /*  6 */ { lon: 25, tipo: 'C' },  // Concepto
  /*  7 */ { lon: 16, tipo: 'N', dec: 2 },  // PtaHaber
  /*  8 */ { lon: 8,  tipo: 'N' },  // Factura
  /*  9 */ { lon: 16, tipo: 'N', dec: 2 },  // Baseimpo
  /* 10 */ { lon: 5,  tipo: 'N', dec: 2 },  // IVA
  /* 11 */ { lon: 5,  tipo: 'N', dec: 2 },  // Recequiv
  /* 12 */ { lon: 10, tipo: 'C' },  // Documento
  /* 13 */ { lon: 3,  tipo: 'C' },  // Departa
  /* 14 */ { lon: 6,  tipo: 'C' },  // Clave
  /* 15 */ { lon: 1,  tipo: 'C' },  // Estado
  /* 16 */ { lon: 6,  tipo: 'N' },  // NCasado
  /* 17 */ { lon: 1,  tipo: 'N' },  // TCasado
  /* 18 */ { lon: 6,  tipo: 'N' },  // Trans
  /* 19 */ { lon: 16, tipo: 'N', dec: 6 },  // Cambio
  /* 20 */ { lon: 16, tipo: 'N', dec: 2 },  // DebeME
  /* 21 */ { lon: 16, tipo: 'N', dec: 2 },  // HaberME
  /* 22 */ { lon: 1,  tipo: 'C' },  // Auxiliar
  /* 23 */ { lon: 1,  tipo: 'C' },  // Serie
  /* 24 */ { lon: 4,  tipo: 'C' },  // Sucursal
  /* 25 */ { lon: 5,  tipo: 'C' },  // CodDivisa
  /* 26 */ { lon: 16, tipo: 'N', dec: 2 },  // ImpAuxME
  /* 27 */ { lon: 1,  tipo: 'C' },  // MonedaUso
  /* 28 */ { lon: 16, tipo: 'N', dec: 2 },  // EuroDebe
  /* 29 */ { lon: 16, tipo: 'N', dec: 2 },  // EuroHaber
  /* 30 */ { lon: 16, tipo: 'N', dec: 2 },  // BaseEuro
  /* 31 */ { lon: 1,  tipo: 'L' },  // NoConv
  /* 32 */ { lon: 10, tipo: 'C' },  // NumeroInv
  /* 33 */ { lon: 1,  tipo: 'C' },  // Serie_RT
  /* 34 */ { lon: 8,  tipo: 'N' },  // Factu_RT
  /* 35 */ { lon: 16, tipo: 'N', dec: 2 },  // BaseImp_RT
  /* 36 */ { lon: 16, tipo: 'N', dec: 2 },  // BaseImp_RF
  /* 37 */ { lon: 1,  tipo: 'L' },  // Rectifica
  /* 38 */ { lon: 8,  tipo: 'F' },  // Fecha_RT
  /* 39 */ { lon: 1,  tipo: 'C' },  // NIC
  /* 40 */ { lon: 1,  tipo: 'L' },  // Libre_L
  /* 41 */ { lon: 6,  tipo: 'N' },  // Libre_N
  /* 42 */ { lon: 1,  tipo: 'L' },  // IInterrump
  /* 43 */ { lon: 6,  tipo: 'C' },  // SegActiv
  /* 44 */ { lon: 6,  tipo: 'C' },  // SegGeog
  /* 45 */ { lon: 1,  tipo: 'L' },  // IRect349
  /* 46 */ { lon: 8,  tipo: 'F' },  // Fecha_OP
  /* 47 */ { lon: 8,  tipo: 'F' },  // Fecha_EX
  /* 48 */ { lon: 5,  tipo: 'C' },  // Departa5
  /* 49 */ { lon: 10, tipo: 'C' },  // Factura10
  /* 50 */ { lon: 5,  tipo: 'N', dec: 2 },  // Porcen_Ana
  /* 51 */ { lon: 5,  tipo: 'N', dec: 2 },  // Porcen_Seg
  /* 52 */ { lon: 6,  tipo: 'N' },  // NumApunte
  /* 53 */ { lon: 16, tipo: 'N', dec: 2 },  // EuroTotal
  /* 54 */ { lon: 100,tipo: 'C' },  // RazonSoc
  /* 55 */ { lon: 50, tipo: 'C' },  // Apellido1
  /* 56 */ { lon: 50, tipo: 'C' },  // Apellido2
  /* 57 */ { lon: 1,  tipo: 'C' },  // TipoOpe
  /* 58 */ { lon: 8,  tipo: 'N' },  // nFacTick
  /* 59 */ { lon: 40, tipo: 'C' },  // NumAculni
  /* 60 */ { lon: 40, tipo: 'C' },  // NumAcuFin
  /* 61 */ { lon: 15, tipo: 'C' },  // TerIdNif
  /* 62 */ { lon: 15, tipo: 'C' },  // TerNIF
  /* 63 */ { lon: 40, tipo: 'C' },  // TerNom
  /* 64 */ { lon: 9,  tipo: 'C' },  // TerNif14
  /* 65 */ { lon: 1,  tipo: 'L' },  // TBienTran
  /* 66 */ { lon: 10, tipo: 'C' },  // TBienCod
  /* 67 */ { lon: 1,  tipo: 'L' },  // TransInm
  /* 68 */ { lon: 1,  tipo: 'L' },  // Metal
  /* 69 */ { lon: 16, tipo: 'N', dec: 2 },  // MetalImp
  /* 70 */ { lon: 12, tipo: 'C' },  // Cliente
  /* 71 */ { lon: 1,  tipo: 'N' },  // OpBienes
  /* 72 */ { lon: 40, tipo: 'C' },  // FacturaEx
  /* 73 */ { lon: 1,  tipo: 'C' },  // TipoFac
  /* 74 */ { lon: 1,  tipo: 'C' },  // TipoIVA
  /* 75 */ { lon: 40, tipo: 'C' },  // GUID
  /* 76 */ { lon: 1,  tipo: 'L' },  // L340
  /* 77 */ { lon: 4,  tipo: 'N' },  // MetalEje
  /* 78 */ { lon: 15, tipo: 'C' },  // Document15
  /* 79 */ { lon: 12, tipo: 'C' },  // ClienteSup
  /* 80 */ { lon: 8,  tipo: 'F' },  // FechaSub
  /* 81 */ { lon: 16, tipo: 'N', dec: 2 },  // ImporteSup
  /* 82 */ { lon: 40, tipo: 'C' },  // DocSup
  /* 83 */ { lon: 12, tipo: 'C' },  // ClientePro
  /* 84 */ { lon: 8,  tipo: 'F' },  // FechaPro
  /* 85 */ { lon: 16, tipo: 'N', dec: 2 },  // ImportePro
  /* 86 */ { lon: 40, tipo: 'C' },  // DocPro
  /* 87 */ { lon: 2,  tipo: 'N' },  // nClaveIRPF
  /* 88 */ { lon: 1,  tipo: 'L' },  // IArrend347
  /* 89 */ { lon: 1,  tipo: 'N' },  // nSitInmueb
  /* 90 */ { lon: 25, tipo: 'C' },  // cRefCatast
  /* 91 */ { lon: 1,  tipo: 'N' },  // Concil347
  /* 92 */ { lon: 2,  tipo: 'N' },  // TipoRegula
  /* 93 */ { lon: 2,  tipo: 'N' },  // nCritCaja
  /* 94 */ { lon: 1,  tipo: 'L' },  // ICritCaja
  /* 95 */ { lon: 8,  tipo: 'F' },  // dMaxLiqui (D=date)
  /* 96 */ { lon: 16, tipo: 'N', dec: 2 },  // nTotalFac
  /* 97 */ { lon: 32, tipo: 'C' },  // IdFactura
  /* 98 */ { lon: 16, tipo: 'N', dec: 2 },  // nCobrPago
  /* 99 */ { lon: 2,  tipo: 'N' },  // nTipoIG
  /*100 */ { lon: 50, tipo: 'C' },  // DevoIVAid
  /*101 */ { lon: 1,  tipo: 'L' },  // LDEVOLUIVA
  /*102 */ { lon: 1,  tipo: 'C' },  // MedioCrit
  /*103 */ { lon: 34, tipo: 'C' },  // CuentaCrit
  /*104 */ { lon: 1,  tipo: 'L' },  // IConAc
  /*105 */ { lon: 40, tipo: 'C' },  // GuidSPAY
  /*106 */ { lon: 2,  tipo: 'N' },  // TipoEntr
  /*107 */ { lon: 2,  tipo: 'N' },  // Mod140
  /*108 */ { lon: 8,  tipo: 'F' },  // FechaAnota (D)
  /*109 */ { lon: 2,  tipo: 'N' },  // nTipo140
  /*110 */ { lon: 11, tipo: 'C' },  // Cuenta140
  /*111 */ { lon: 16, tipo: 'N', dec: 2 },  // Importe140
  /*112 */ { lon: 1,  tipo: 'L' },  // IDepAduan
  /*113 */ { lon: 1,  tipo: 'L' },  // IDifAduan
  /*114 */ { lon: 2,  tipo: 'N' },  // nInter303
  /*115 */ { lon: 40, tipo: 'C' },  // IdRecargo
  /*116 */ { lon: 1,  tipo: 'N' },  // EstadoSII
  /*117 */ { lon: 2,  tipo: 'N' },  // TipoClave
  /*118 */ { lon: 2,  tipo: 'N' },  // TipoExenci
  /*119 */ { lon: 2,  tipo: 'N' },  // TipoNoSuje
  /*120 */ { lon: 2,  tipo: 'N' },  // TipoFact
  /*121 */ { lon: 40, tipo: 'C' },  // NAcuIniSII
  /*122 */ { lon: 40, tipo: 'C' },  // nAcuFinSII
  /*123 */ { lon: 2,  tipo: 'N', dec: 2 },  // TipoRectif
  /*124 */ { lon: 16, tipo: 'N', dec: 2 },  // BImpCoste
  /*125 */ { lon: 1,  tipo: 'L' },  // IEmiTercer
  /*126 */ { lon: 1,  tipo: 'N' },  // nEntrPrest
  /*127 */ { lon: 8,  tipo: 'F' },  // Decrecen (D)
  /*128 */ { lon: 40, tipo: 'C' },  // FactuEx_RT
  /*129 */ { lon: 2,  tipo: 'N' },  // TipoClave1
  /*130 */ { lon: 2,  tipo: 'N' },  // TipoClave2
  /*131 */ { lon: 1,  tipo: 'L' },  // ITAI
  /*132 */ { lon: 1,  tipo: 'L' },  // lExcl303
  /*133 */ { lon: 50, tipo: 'C' },  // ConcepNew
  /*134 */ { lon: 30, tipo: 'C' },  // TerNifNew
  /*135 */ { lon: 120,tipo: 'C' },  // TerNomNew
  /*136 */ { lon: 1,  tipo: 'L' },  // SII_1415
  /*137 */ { lon: 15, tipo: 'C' },  // cAutoriza
  /*138 */ { lon: 1,  tipo: 'L' },  // IEmiTerDis
  /*139 */ { lon: 9,  tipo: 'C' },  // NifSuced
  /*140 */ { lon: 120,tipo: 'C' },  // RazonSuced
  /*141 */ { lon: 1,  tipo: 'L' },  // IFSimplifi
  /*142 */ { lon: 1,  tipo: 'L' },  // IFSinIdent
];

// ─── Helpers de formateo ────────────────────────────────────────────────────

/** Texto: rellena con espacios a la derecha */
function fmtC(val, lon) {
  return String(val || '').substring(0, lon).padEnd(lon, ' ');
}

/** Numerico: ceros a la izquierda */
function fmtN(val, lon) {
  const n = String(parseInt(val, 10) || 0);
  return n.padStart(lon, '0').substring(0, lon);
}

/** Numerico con decimales: sin separador, ceros a la izquierda */
function fmtND(val, lon, dec) {
  const n = parseFloat(val) || 0;
  const entero = Math.round(Math.abs(n) * Math.pow(10, dec));
  return String(entero).padStart(lon, '0').substring(0, lon);
}

/** Fecha AAAAMMDD */
function fmtF(iso, lon) {
  if (!iso) return ' '.repeat(lon);
  return String(iso).replace(/-/g, '').substring(0, lon).padEnd(lon, ' ');
}

/** Logico .T. / .F. / vacio */
function fmtL(val, lon) {
  const s = val === true ? '.T.' : val === false ? '.F.' : '';
  return s.padEnd(lon, ' ').substring(0, lon);
}

// ─── Generar linea en ambos formatos ────────────────────────────────────────

function formatearCampoTXT(valor, campo) {
  const v = valor || '';
  if (campo.tipo === 'C') return fmtC(v, campo.lon);
  if (campo.tipo === 'F') return fmtF(v, campo.lon);
  if (campo.tipo === 'L') return fmtL(v === '.T.' ? true : v === '.F.' ? false : v === true ? true : v === false ? false : null, campo.lon);
  if (campo.tipo === 'N' && campo.dec) return fmtND(v, campo.lon, campo.dec);
  if (campo.tipo === 'N') return fmtN(v, campo.lon);
  return fmtC(v, campo.lon);
}

function lineaTXT(valores) {
  return CAMPOS.map((campo, i) => formatearCampoTXT(valores[i], campo)).join('');
}

function lineaCSV(valores) {
  const result = [];
  for (let i = 0; i < CAMPOS.length; i++) {
    result.push(valores[i] || '');
  }
  return result.join(';');
}

// ─── Construir valores por factura ──────────────────────────────────────────

function construirLineasFactura(factura, numAsiento, documento, fechaOpFmt) {
  const d = factura.datos_extraidos || {};
  const ivaList = Array.isArray(d.iva) ? d.iva.filter(e => e.base > 0 || e.cuota > 0) : [];

  const fechaEmision  = d.fecha_emision || '';
  const numFactura    = d.numero_factura || '';
  const conceptoFact  = String(numFactura).substring(0, 25);
  const conceptoLargo = String(numFactura).substring(0, 50);
  const facturaExp    = String(numFactura).substring(0, 40); // Nº factura expedición (SII/Libro IVA, pos 72 FacturaEx, 40 chars)
  const cifEmisor     = d.cif_emisor || '';
  const nombreEmisor  = d.nombre_emisor || '';
  const totalFactura  = parseFloat(d.total_factura) || 0;
  const baseSinIva    = parseFloat(d.total_sin_iva) || 0;
  const ctaProveedor  = factura.cta_proveedor_codigo || '';
  const ctaGasto      = factura.cuenta_gasto_codigo || '';
  const fechaFmt      = fechaEmision ? fechaEmision.replace(/-/g, '') : '';
  const asiento       = String(numAsiento);
  const doc           = (documento || '').substring(0, 10);
  // Campos SII parametrizables por proveedor + override por factura (resueltos con COALESCE en SQL).
  // Default 1/1 = régimen general + F1 ordinaria (caso normal español).
  const siiTipoClave  = Number.isInteger(factura.sii_tipo_clave) ? factura.sii_tipo_clave : 1;
  const siiTipoFact   = Number.isInteger(factura.sii_tipo_fact)  ? factura.sii_tipo_fact  : 1;

  const lineas = []; // cada elemento es un array de 142 valores

  // Linea 1: Proveedor en HABER
  // Fecha asiento (pos 2) = fecha de contabilización (hoy). Fecha_EX (pos 47) = fecha emisión.
  const l1 = new Array(142).fill('');
  l1[0]=asiento; l1[1]=fechaOpFmt; l1[2]=ctaProveedor; l1[3]=ctaGasto;
  l1[4]=0; l1[5]=conceptoFact; l1[6]=totalFactura;
  l1[11]=doc; l1[26]='2'; l1[27]=0;
  l1[28]=totalFactura; l1[45]=fechaOpFmt; l1[46]=fechaFmt;
  l1[75]='.T.'; l1[95]=totalFactura; l1[132]=conceptoLargo;
  lineas.push(l1);

  // Linea 2: Gasto en DEBE
  const l2 = new Array(142).fill('');
  l2[0]=asiento; l2[1]=fechaOpFmt; l2[2]=ctaGasto; l2[3]=ctaProveedor;
  l2[4]=baseSinIva; l2[5]=conceptoFact; l2[6]=0;
  l2[11]=doc; l2[26]='2';
  l2[27]=baseSinIva; l2[28]=0; l2[45]=fechaOpFmt; l2[46]=fechaFmt;
  l2[75]='.T.'; l2[132]=conceptoLargo;
  lineas.push(l2);

  // Lineas IVA
  const crearIva = (base, cuota, tipo) => {
    const l = new Array(142).fill('');
    l[0]=asiento; l[1]=fechaOpFmt; l[2]=getCuentaIva(tipo); l[3]=ctaProveedor;
    l[4]=cuota; l[5]=conceptoFact; l[6]=0;
    l[7]=numFactura.substring(0,8); l[8]=base;
    l[9]=tipo; l[10]=0; l[11]=doc;
    l[26]='2'; l[27]=cuota; l[28]=0; l[29]=base;
    l[45]=fechaOpFmt; l[46]=fechaFmt;
    l[61] = cifEmisor;                          // pos 62 TerNIF (C 15)
    l[62] = nombreEmisor.substring(0, 40);      // pos 63 TerNom (C 40)
    // l[63] pos 64 TerNif14 (C 9): NIF representante legal menores de 14 anios.
    // Debe ir vacio salvo facturacion a menor de 14, caso que esta app no soporta.
    l[71]=facturaExp;
    l[72] = 'R';               // pos 73 TipoFac. 'R' = Recibida (esta app sólo maneja facturas de proveedor).
    l[73]='O'; l[75]='.T.'; l[95]=totalFactura;
    l[116] = siiTipoClave;     // pos 117 TipoClave (N 2, marcador *15). Default 1 = Régimen general.
    l[119] = siiTipoFact;      // pos 120 TipoFact  (N 2, marcador *18). Default 1 = F1 Factura ordinaria.
    l[132]=conceptoLargo; l[133]=cifEmisor; l[134]=nombreEmisor.substring(0,120);
    return l;
  };

  if (ivaList.length === 0) {
    const totalIva = parseFloat(d.total_iva) || 0;
    if (totalIva > 0) lineas.push(crearIva(baseSinIva, totalIva, 21));
  } else {
    for (const iva of ivaList) {
      const tipo = iva.tipo || 21, base = parseFloat(iva.base)||0, cuota = parseFloat(iva.cuota)||0;
      if (cuota > 0 || tipo === 0) lineas.push(crearIva(base, cuota, tipo));
    }
  }

  return lineas;
}

// ─── Helpers numerador documento ────────────────────────────────────────────

function construirDocumento(importe, contador) {
  const prefijo = importe < 0 ? 'A/' : 'F/';
  return prefijo + String(contador).padStart(4, '0');
}

// ─── Funcion principal ──────────────────────────────────────────────────────

/**
 * Genera ficheros SAGE con numeración correlativa global.
 * @param {Array} facturas — facturas a exportar, procesadas en el orden recibido
 * @param {Object} opts
 *   @param {number} opts.asientoInicio   — número de asiento inicial (1 por factura, correlativo global)
 *   @param {number} opts.documentoInicio — número de documento inicial (F/NNNN o A/NNNN según signo)
 * @returns {{ contenidoTXT, contenidoCSV, asientoInicio, asientoFin, documentoInicio, documentoFin }}
 */
function generarFicheroSage(facturas, opts = {}) {
  const asientoInicio   = parseInt(opts.asientoInicio, 10)   > 0 ? parseInt(opts.asientoInicio, 10)   : 1;
  const documentoInicio = parseInt(opts.documentoInicio, 10) > 0 ? parseInt(opts.documentoInicio, 10) : 1;

  const registros = []; // array de arrays de 142 valores
  let numAsiento  = asientoInicio;
  let numDoc      = documentoInicio;

  // Fecha_OP (pos 46): fecha actual de generacion del archivo en formato AAAAMMDD
  const hoy = new Date();
  const fechaOpFmt = String(hoy.getFullYear())
    + String(hoy.getMonth() + 1).padStart(2, '0')
    + String(hoy.getDate()).padStart(2, '0');

  for (const factura of facturas) {
    const d = factura.datos_extraidos || {};
    const total = parseFloat(d.total_factura) || 0;
    const documento = construirDocumento(total, numDoc);
    registros.push(...construirLineasFactura(factura, numAsiento, documento, fechaOpFmt));
    numAsiento++;
    numDoc++;
  }

  const asientoFin   = numAsiento - 1;
  const documentoFin = numDoc - 1;

  const contenidoTXT = registros.map(r => lineaTXT(r)).join('\r\n') + '\r\n';
  const contenidoCSV = registros.map(r => lineaCSV(r)).join('\r\n') + '\r\n';

  return { contenidoTXT, contenidoCSV, asientoInicio, asientoFin, documentoInicio, documentoFin };
}

module.exports = { generarFicheroSage };
