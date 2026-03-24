const express = require('express');
const router  = express.Router();
const { resolveUser }  = require('../middleware/auth');
const { getAuditoria } = require('../services/auditService');

router.get('/', resolveUser, async (req, res) => {
  if (!req.usuario) {
    return res.status(401).json({ ok: false, error: 'Usuario no identificado' });
  }
  const limite = Math.min(parseInt(req.query.limite, 10) || 200, 500);
  const logs   = await getAuditoria(req.usuario.id, req.usuario.rol, { limite });

  const data = logs.map(l => ({
    ...l,
    detalle: l.detalle ? (() => { try { return JSON.parse(l.detalle); } catch { return l.detalle; } })() : null,
  }));

  res.json({ ok: true, data });
});

module.exports = router;
