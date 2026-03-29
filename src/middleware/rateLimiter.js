const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

// ─── Login: 10 intentos por IP cada 15 minutos ──────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos de login. Espera 15 minutos.' },
});

// ─── Chat (Anthropic): 30 mensajes por usuario cada 5 minutos ───────────────
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.usuario?.id ? String(req.usuario.id) : ipKeyGenerator(req),
  message: { ok: false, error: 'Limite de mensajes alcanzado. Espera unos minutos.' },
});

// ─── API general: 200 peticiones por IP cada minuto ─────────────────────────
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas peticiones. Espera un momento.' },
});

module.exports = { loginLimiter, chatLimiter, apiLimiter };
