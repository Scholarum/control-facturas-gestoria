/**
 * SSE (Server-Sent Events) — servicio de notificaciones en tiempo real.
 *
 * Uso en cualquier parte del backend:
 *   const { broadcast } = require('./sseService');
 *   broadcast('sync_complete', { facturas_nuevas: 5, errores: 0 });
 */

const clients = new Map(); // id -> res

let nextId = 1;

function addClient(res) {
  const id = nextId++;
  clients.set(id, res);
  res.on('close', () => clients.delete(id));
  return id;
}

/**
 * Envía un evento a todos los clientes SSE conectados.
 * @param {string} event  — nombre del evento (ej. 'sync_complete')
 * @param {object} data   — payload serializable a JSON
 */
function broadcast(event, data = {}) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, res] of clients) {
    res.write(payload);
  }
}

module.exports = { addClient, broadcast };
