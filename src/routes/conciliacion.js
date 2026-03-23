const express   = require('express');
const multer    = require('multer');
const router    = express.Router();

const { parsearSage }             = require('../services/sageParser');
const { ejecutarConciliacion }    = require('../services/conciliacionService');
const { generarPdfConciliacion }  = require('../services/pdfReporte');

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
// Procesa el archivo SAGE y devuelve el resultado de la conciliación.

router.post('/', upload.single('archivo'), async (req, res) => {
  const { proveedor, fechaDesde, fechaHasta } = req.body;

  if (!proveedor)    return res.status(400).json({ ok: false, error: 'proveedor requerido' });
  if (!req.file)     return res.status(400).json({ ok: false, error: 'archivo SAGE requerido' });

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
    resultado = ejecutarConciliacion(proveedor, fechaDesde || null, fechaHasta || null, entradasSage);
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }

  res.json({ ok: true, data: resultado });
});

// ─── POST /api/conciliacion/pdf ───────────────────────────────────────────────
// Recibe los resultados JSON y devuelve el informe en PDF.

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
