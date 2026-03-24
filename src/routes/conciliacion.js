const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const router    = express.Router();

const { getDb }                       = require('../config/database');
const { parsearSage }                 = require('../services/sageParser');
const { ejecutarConciliacion }        = require('../services/conciliacionService');
const { generarPdfConciliacion }      = require('../services/pdfReporte');
const { registrarEvento, EVENTOS }    = require('../services/auditService');
const { resolveUser }                 = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|csv|xls|xlsx)$/i.test(file.originalname) ||
               ['application/pdf','text/csv','text/plain',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
               .includes(file.mimetype);
    cb(ok ? null : new Error('Formato no soportado. Use PDF, Excel o CSV.'), ok);
  },
});

// ─── Descripción de motivo de error ──────────────────────────────────────────

function motivoError(r) {
  if (r.estado === 'OK') return '';
  if (r.estado === 'PENDIENTE_EN_SAGE') return 'No localizada en el Mayor SAGE';
  if (r.estado === 'ERROR_IMPORTE') {
    const importeDif = r.importe_drive !== r.sage?.importe;
    const fechaDif   = r.fecha_emision !== r.sage?.fecha;
    if (importeDif && fechaDif) return `Importe y fecha no coinciden (Drive: ${r.importe_drive}€ / SAGE: ${r.sage?.importe}€)`;
    if (importeDif)             return `Diferencia de importe (Drive: ${r.importe_drive}€ / SAGE: ${r.sage?.importe}€)`;
    if (fechaDif)               return `Fecha diferente (Drive: ${r.fecha_emision} / SAGE: ${r.sage?.fecha})`;
  }
  return '';
}

// ─── POST /api/conciliacion ───────────────────────────────────────────────────

router.post('/', resolveUser, upload.single('archivo'), async (req, res) => {
  const { proveedor, fechaDesde, fechaHasta } = req.body;

  if (!proveedor) return res.status(400).json({ ok: false, error: 'proveedor requerido' });
  if (!req.file)  return res.status(400).json({ ok: false, error: 'archivo SAGE requerido' });

  let entradasSage;
  try {
    entradasSage = await parsearSage(req.file.buffer, req.file.mimetype, req.file.originalname);
  } catch (err) {
    return res.status(422).json({ ok: false, error: `Error al analizar el archivo SAGE: ${err.message}` });
  }

  if (!entradasSage.length) {
    return res.status(422).json({ ok: false, error: 'No se encontraron entradas de factura en el archivo SAGE. Verifica el formato.' });
  }

  let resultado;
  try {
    resultado = await ejecutarConciliacion(proveedor, fechaDesde || null, fechaHasta || null, entradasSage);
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }

  // Guardar en historial
  try {
    const db = getDb();
    await db.query(
      `INSERT INTO historial_conciliaciones
         (proveedor, fecha_desde, fecha_hasta, total, ok, pendientes_sage, error_importe, resultado_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        proveedor,
        fechaDesde || null,
        fechaHasta || null,
        resultado.resumen.total,
        resultado.resumen.ok,
        resultado.resumen.pendientesSage,
        resultado.resumen.errorImporte,
        JSON.stringify(resultado),
      ]
    );
  } catch (e) {
    console.error('[Conciliacion] Error guardando historial:', e.message);
  }

  registrarEvento({
    evento:    EVENTOS.UPLOAD_CONCILIACION,
    usuarioId: req.usuario?.id ?? null,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   {
      proveedor,
      fechaDesde:     fechaDesde || null,
      fechaHasta:     fechaHasta || null,
      archivo:        req.file.originalname,
      total:          resultado.resumen.total,
      ok:             resultado.resumen.ok,
      pendientesSage: resultado.resumen.pendientesSage,
      errorImporte:   resultado.resumen.errorImporte,
    },
  }).catch(() => {});

  res.json({ ok: true, data: resultado });
});

// ─── GET /api/conciliacion/historial ─────────────────────────────────────────

router.get('/historial', resolveUser, async (req, res) => {
  const db   = getDb();
  const rows = await db.all(
    `SELECT id, creado_en, proveedor, fecha_desde, fecha_hasta,
            total, ok, pendientes_sage, error_importe
     FROM historial_conciliaciones
     ORDER BY creado_en DESC
     LIMIT 100`
  );
  res.json({ ok: true, data: rows });
});

// ─── GET /api/conciliacion/historial/:id ─────────────────────────────────────

router.get('/historial/:id', resolveUser, async (req, res) => {
  const db  = getDb();
  const row = await db.one(
    'SELECT resultado_json FROM historial_conciliaciones WHERE id = $1',
    [parseInt(req.params.id, 10)]
  );
  if (!row) return res.status(404).json({ ok: false, error: 'No encontrado' });
  const resultado = typeof row.resultado_json === 'string'
    ? JSON.parse(row.resultado_json)
    : row.resultado_json;
  res.json({ ok: true, data: resultado });
});

// ─── POST /api/conciliacion/pdf ───────────────────────────────────────────────

router.post('/pdf', express.json(), async (req, res) => {
  const { resumen, resultados } = req.body;
  if (!resumen || !resultados) return res.status(400).json({ ok: false, error: 'resumen y resultados requeridos' });

  let buffer;
  try {
    buffer = await generarPdfConciliacion(resumen, resultados);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Error al generar PDF: ${err.message}` });
  }

  const fecha = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': `attachment; filename="conciliacion-${resumen.proveedor.replace(/\s+/g,'-')}-${fecha}.pdf"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// ─── POST /api/conciliacion/excel ─────────────────────────────────────────────

router.post('/excel', express.json(), async (req, res) => {
  const { resumen, resultados } = req.body;
  if (!resumen || !resultados) return res.status(400).json({ ok: false, error: 'resumen y resultados requeridos' });

  const estadoLabel = { OK: 'OK', PENDIENTE_EN_SAGE: 'Pendiente SAGE', ERROR_IMPORTE: 'Error importe' };

  const filas = resultados.map(r => ({
    'Estado':          estadoLabel[r.estado] || r.estado,
    'Motivo':          motivoError(r),
    'Nº Factura Drive': r.numero_factura || '',
    'Archivo':         r.nombre_archivo  || '',
    'Fecha emisión':   r.fecha_emision   || '',
    'Importe Drive':   r.importe_drive   ?? '',
    'Nº Factura SAGE': r.sage?.numero_factura || '',
    'Fecha SAGE':      r.sage?.fecha          || '',
    'Importe SAGE':    r.sage?.importe        ?? '',
    'Diferencia':      r.diferencia           ?? '',
  }));

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Conciliación');

  ws['!cols'] = [
    {wch:16},{wch:50},{wch:18},{wch:36},{wch:14},
    {wch:14},{wch:18},{wch:14},{wch:14},{wch:12},
  ];

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fecha  = new Date().toISOString().slice(0, 10);

  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="conciliacion-${resumen.proveedor.replace(/\s+/g,'-')}-${fecha}.xlsx"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

module.exports = router;
