const express = require('express');
const router  = express.Router();
const facturaService = require('../services/facturaService');
const auditService   = require('../services/auditService');

router.get('/', async (_req, res) => {
  const facturas = await facturaService.listarFacturas();
  res.json({ ok: true, data: facturas });
});

router.get('/:id', async (req, res) => {
  const factura = await facturaService.obtenerFactura(Number(req.params.id));
  if (!factura) return res.status(404).json({ ok: false, error: 'Factura no encontrada' });
  res.json({ ok: true, data: factura });
});

router.post('/', async (req, res) => {
  const { numero, descripcion, importe, fechaEmision, subidaPor } = req.body;

  if (!numero || !importe || !fechaEmision || !subidaPor) {
    return res.status(400).json({ ok: false, error: 'Campos obligatorios: numero, importe, fechaEmision, subidaPor' });
  }

  const factura = await facturaService.crearFactura({
    numero, descripcion, importe: parseFloat(importe), fechaEmision,
    subidaPor: parseInt(subidaPor),
    ip:        req.clientIp,
    userAgent: req.userAgent,
  });

  res.status(201).json({ ok: true, data: factura });
});

router.post('/:id/enlace', async (req, res) => {
  const { expiraEnHoras } = req.body;
  const expiraEn = expiraEnHoras ? expiraEnHoras * 60 * 60 * 1000 : undefined;
  const resultado = await facturaService.generarEnlaceGestoria(Number(req.params.id), { expiraEn });
  res.json({ ok: true, data: resultado });
});

router.get('/:id/auditoria', async (req, res) => {
  const logs = await auditService.historialFactura(Number(req.params.id));
  res.json({ ok: true, data: logs });
});

module.exports = router;
