const express = require('express');
const { resolveUser, requireAuth } = require('../middleware/auth');
const { addClient } = require('../services/sseService');

const router = express.Router();

// EventSource no soporta headers — acepta token por query param
function tokenFromQuery(req, _res, next) {
  if (!req.headers['authorization'] && req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}

// GET /api/eventos — conexión SSE
router.get('/', tokenFromQuery, resolveUser, requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
  });

  // Heartbeat cada 30s para mantener la conexión abierta
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);
  res.on('close', () => clearInterval(heartbeat));

  addClient(res);

  // Mensaje inicial para confirmar conexión
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);
});

module.exports = router;
