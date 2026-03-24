const express   = require('express');
const multer    = require('multer');
const router    = express.Router();

const { parsearSage }             = require('../services/sageParser');
const { ejecutarConciliacion }    = require('../services/conciliacionService');
const { generarPdfConciliacion }  = require('../services/pdfReporte');
const { registrarEvento, EVENTOS } = require('../services/auditService');
const { resolveUser }             = require('../middleware/auth');

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

module.exports = router;
