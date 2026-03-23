/**
 * pdfReporte.js
 * Genera el informe PDF de conciliación para enviar a la gestoría.
 */
const PDFDocument = require('pdfkit');

const AZUL    = '#1e40af';
const GRIS    = '#6b7280';
const VERDE   = '#15803d';
const ROJO    = '#dc2626';
const NARANJA = '#d97706';
const BORDE   = '#e5e7eb';
const FONDO_H = '#f3f4f6';

function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtImporte(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + ' EUR';
}

// ─── Helpers de dibujo ────────────────────────────────────────────────────────

function cabecera(doc) {
  doc.rect(0, 0, doc.page.width, 60).fill(AZUL);
  doc.fillColor('white').font('Helvetica-Bold').fontSize(16)
    .text('INFORME DE CONCILIACION SAGE', 40, 18);
  doc.font('Helvetica').fontSize(9)
    .text('Sistema de Control de Facturas', 40, 38);
  doc.fillColor('#000000');
}

function seccionInfo(doc, resumen) {
  const y0 = 75;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(AZUL)
    .text('DATOS DE LA CONCILIACION', 40, y0);
  doc.moveTo(40, y0 + 14).lineTo(doc.page.width - 40, y0 + 14).stroke(BORDE);

  const campos = [
    ['Proveedor',       resumen.proveedor],
    ['Periodo desde',   fmtFecha(resumen.fechaDesde) || 'Sin limite'],
    ['Periodo hasta',   fmtFecha(resumen.fechaHasta) || 'Sin limite'],
    ['Fecha de informe', fmtFecha(resumen.generadoEn?.slice(0, 10))],
  ];

  let y = y0 + 22;
  campos.forEach(([etiq, valor]) => {
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(etiq + ':', 40, y);
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827').text(valor, 180, y);
    y += 16;
  });

  return y + 10;
}

function tarjetasResumen(doc, resumen, y0) {
  const cards = [
    { label: 'Analizadas',       valor: resumen.total,          color: AZUL },
    { label: 'Conciliadas (OK)', valor: resumen.ok,             color: VERDE },
    { label: 'Pend. en SAGE',    valor: resumen.pendientesSage, color: NARANJA },
    { label: 'Error importe',    valor: resumen.errorImporte,   color: ROJO },
  ];
  const cardW = 115;
  const cardH = 44;
  let x = 40;

  cards.forEach(c => {
    doc.rect(x, y0, cardW, cardH).fill(c.color);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(22)
      .text(String(c.valor), x, y0 + 5, { width: cardW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5)
      .text(c.label, x, y0 + 28, { width: cardW, align: 'center' });
    doc.fillColor('#000000');
    x += cardW + 8;
  });

  return y0 + cardH + 18;
}

function tablaCabecera(doc, columnas, anchos, y) {
  let x = 40;
  doc.rect(40, y, anchos.reduce((a, b) => a + b, 0), 16).fill(FONDO_H);
  columnas.forEach((col, i) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#374151')
      .text(col, x + 3, y + 4, { width: anchos[i] - 6, lineBreak: false });
    x += anchos[i];
  });
  doc.fillColor('#000000');
  return y + 16;
}

function tablaFila(doc, valores, anchos, y, colorTexto = '#111827') {
  let x = 40;
  const totalW = anchos.reduce((a, b) => a + b, 0);
  doc.rect(40, y, totalW, 15).stroke(BORDE);

  valores.forEach((val, i) => {
    doc.font('Helvetica').fontSize(7.5).fillColor(colorTexto)
      .text(String(val ?? '—'), x + 3, y + 4, { width: anchos[i] - 6, lineBreak: false });
    x += anchos[i];
  });
  doc.fillColor('#000000');
  return y + 15;
}

function tituloSeccion(doc, titulo, color, y) {
  doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text(titulo, 40, y);
  doc.moveTo(40, y + 13).lineTo(doc.page.width - 40, y + 13).stroke(color);
  return y + 22;
}

// ─── Secciones de tabla ───────────────────────────────────────────────────────

function seccionOk(doc, items, y) {
  y = tituloSeccion(doc, `FACTURAS CONCILIADAS CORRECTAMENTE (${items.length})`, VERDE, y);
  if (!items.length) {
    doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('Ninguna factura conciliada.', 40, y);
    return y + 20;
  }

  const cols   = ['N Factura (Drive)', 'N Factura (SAGE)', 'Fecha', 'Importe'];
  const anchos = [140, 140, 70, 80];
  y = tablaCabecera(doc, cols, anchos, y);

  for (const r of items) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
    y = tablaFila(doc, [
      r.numero_factura,
      r.sage?.numero_factura,
      fmtFecha(r.fecha_emision),
      fmtImporte(r.importe_drive),
    ], anchos, y, VERDE);
  }
  return y + 14;
}

function seccionPendientes(doc, items, y) {
  y = tituloSeccion(doc, `FACTURAS PENDIENTES EN SAGE (${items.length})`, NARANJA, y);
  if (!items.length) {
    doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('No hay facturas pendientes.', 40, y);
    return y + 20;
  }

  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('Las siguientes facturas se encuentran en Drive pero NO en el Mayor de SAGE.', 40, y);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(NARANJA)
    .text('Accion requerida: Registrar estas facturas en SAGE.', 40, y + 10);
  y += 26;

  const cols   = ['N Factura', 'Nombre archivo', 'Fecha emision', 'Importe'];
  const anchos = [110, 180, 80, 60];
  y = tablaCabecera(doc, cols, anchos, y);

  for (const r of items) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
    y = tablaFila(doc, [
      r.numero_factura,
      r.nombre_archivo,
      fmtFecha(r.fecha_emision),
      fmtImporte(r.importe_drive),
    ], anchos, y, NARANJA);
  }
  return y + 14;
}

function seccionErrores(doc, items, y) {
  y = tituloSeccion(doc, `FACTURAS CON ERROR DE IMPORTE (${items.length})`, ROJO, y);
  if (!items.length) {
    doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('Sin errores de importe.', 40, y);
    return y + 20;
  }

  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text('El numero de factura coincide entre Drive y SAGE, pero los importes difieren.', 40, y);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(ROJO)
    .text('Accion requerida: Verificar y corregir los importes en SAGE.', 40, y + 10);
  y += 26;

  const cols   = ['N Factura', 'Fecha', 'Importe Drive', 'Importe SAGE', 'Diferencia'];
  const anchos = [110, 70, 85, 85, 80];
  y = tablaCabecera(doc, cols, anchos, y);

  for (const r of items) {
    if (y > doc.page.height - 60) { doc.addPage(); y = 40; }
    y = tablaFila(doc, [
      r.numero_factura,
      fmtFecha(r.fecha_emision),
      fmtImporte(r.importe_drive),
      fmtImporte(r.sage?.importe),
      fmtImporte(r.diferencia),
    ], anchos, y, ROJO);
  }
  return y + 14;
}

function pie(doc) {
  const y = doc.page.height - 30;
  doc.font('Helvetica').fontSize(7.5).fillColor(GRIS)
    .text(
      'Generado automaticamente por el Sistema de Control de Facturas  |  ' + new Date().toLocaleString('es-ES'),
      40, y, { align: 'center', width: doc.page.width - 80 }
    );
}

// ─── Generador principal ──────────────────────────────────────────────────────

function generarPdfConciliacion(resumen, resultados) {
  return new Promise((resolve, reject) => {
    const doc      = new PDFDocument({ margin: 0, size: 'A4' });
    const buffers  = [];

    doc.on('data',  chunk => buffers.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Página 1
    cabecera(doc);
    let y = seccionInfo(doc, resumen);
    y     = tarjetasResumen(doc, resumen, y);

    const ok         = resultados.filter(r => r.estado === 'OK');
    const pendientes = resultados.filter(r => r.estado === 'PENDIENTE_EN_SAGE');
    const errores    = resultados.filter(r => r.estado === 'ERROR_IMPORTE');

    // Secciones en orden: errores primero (más urgentes), luego pendientes, luego OK
    if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
    y = seccionErrores(doc, errores, y);

    if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
    y = seccionPendientes(doc, pendientes, y);

    if (y > doc.page.height - 120) { doc.addPage(); y = 40; }
    seccionOk(doc, ok, y);

    pie(doc);
    doc.end();
  });
}

module.exports = { generarPdfConciliacion };
