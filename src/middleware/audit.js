/**
 * Extrae la IP real del cliente teniendo en cuenta proxies.
 */
function getClientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'desconocida'
  );
}

/**
 * Añade req.clientIp y req.userAgent en cada petición.
 */
function attachRequestMeta(req, _res, next) {
  req.clientIp  = getClientIp(req);
  req.userAgent = req.headers['user-agent'] || null;
  next();
}

module.exports = { attachRequestMeta, getClientIp };
