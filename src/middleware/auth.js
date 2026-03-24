const { getUserFromToken } = require('../services/authService');

async function resolveUser(req, _res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    req.usuario = token ? await getUserFromToken(token) : null;
  } catch (_) {
    req.usuario = null;
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.usuario || req.usuario.rol !== 'ADMIN') {
    return res.status(403).json({ ok: false, error: 'Acción reservada para administradores' });
  }
  next();
}

module.exports = { resolveUser, requireAuth, requireAdmin };
