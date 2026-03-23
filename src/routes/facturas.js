const express = require('express');
const router  = express.Router();
const facturaService = require('../services/facturaService');
const auditService   = require('../services/auditService');

// ─── Listar facturas ──────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  const facturas = facturaService.listarFacturas();
  res.json({ ok: true, data: facturas });
});

// ─── Obtener una factura ──────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const factura = facturaService.obtenerFactura(Number(req.params.id));
  if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
  res.json({ ok: true, data: factura });
});

// ─── Crear factura ────────────────────────────────────────────────────────────
// En producción aquí irá el middleware de autenticación y multer para ficheros.
router.post('/', (req, res) => {
  const { numero, descripcion, importe, fechaEmision, subidaPor } = req.body;

  if (!numero || !importe || !fechaEmision || !subidaPor) {
    return res.status(400).json({ ok: false, error: 'Campos obligatorios: numero, importe, fechaEmision, subidaPor' });
  }

  const factura = facturaService.crearFactura({
    numero, descripcion, importe: parseFloat(importe), fechaEmision,
    subidaPor: parseInt(subidaPor),
    ip:        req.clientIp,
    userAgent: req.userAgent,
  });

  res.status(201).json({ ok: true, data: factura });
});

// ─── Generar enlace único para la gestoría ────────────────────────────────────
router.post('/:id/enlace', (req, res) => {
  const { expiraEnHoras } = req.body;
  const expiraEn = expiraEnHoras ? expiraEnHoras * 60 * 60 * 1000 : undefined;

  const resultado = facturaService.generarEnlaceGestoria(Number(req.params.id), { expiraEn });
  res.json({ ok: true, data: resultado });
});

// ─── Historial de auditoría de una factura ────────────────────────────────────
router.get('/:id/auditoria', (req, res) => {
  const logs = auditService.historialFactura(Number(req.params.id));
  res.json({ ok: true, data: logs });
});

module.exports = router;
