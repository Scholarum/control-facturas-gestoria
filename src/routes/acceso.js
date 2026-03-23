const express = require('express');
const router  = express.Router();
const facturaService = require('../services/facturaService');

/**
 * GET /ver/:token
 *
 * Punto de entrada para la gestoría. Al acceder con el enlace único:
 *  1. Se valida el token.
 *  2. Se registran automáticamente los eventos APERTURA y VISTO.
 *  3. Se devuelve la información de la factura.
 *
 * En producción aquí se renderizaría una vista HTML con los datos.
 */
router.get('/:token', (req, res) => {
  const { token } = req.params;

  let factura;
  try {
    factura = facturaService.accederConToken(token, {
      ip:        req.clientIp,
      userAgent: req.userAgent,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }

  // En producción: res.render('factura', { factura })
  res.json({
    ok:      true,
    mensaje: 'Acceso registrado. Factura visualizada.',
    data:    factura,
  });
});

module.exports = router;
