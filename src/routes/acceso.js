const express = require('express');
const router  = express.Router();
const facturaService = require('../services/facturaService');

router.get('/:token', async (req, res) => {
  const { token } = req.params;

  let factura;
  try {
    factura = await facturaService.accederConToken(token, {
      ip:        req.clientIp,
      userAgent: req.userAgent,
    });
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }

  res.json({
    ok:      true,
    mensaje: 'Acceso registrado. Factura visualizada.',
    data:    factura,
  });
});

module.exports = router;
