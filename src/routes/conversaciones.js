const express = require('express');
const { getDb } = require('../config/database');
const { resolveUser, requireAuth } = require('../middleware/auth');
const { getSistemaConfig } = require('../services/sistemaConfigService');

const router = express.Router();
router.use(resolveUser, requireAuth);

// GET /api/chat/conversaciones/config — config pública del chat
router.get('/config', async (_req, res) => {
  const config = await getSistemaConfig();
  res.json({
    ok: true,
    data: {
      mensaje_bienvenida: config.chat_mensaje_bienvenida || '',
      agente_defecto: config.chat_agente_defecto || 'atc',
      max_mensajes_dia: parseInt(config.chat_max_mensajes_dia) || 100,
    },
  });
});

// GET /api/chat/conversaciones?agente=atc — listar conversaciones del usuario
router.get('/', async (req, res) => {
  const db = getDb();
  const { agente } = req.query;
  const userId = req.usuario.id;

  const convs = await db.all(`
    SELECT c.id, c.agente_id, c.titulo, c.origen, c.created_at, c.updated_at,
           (SELECT COUNT(*)::int FROM chat_mensajes WHERE conversacion_id = c.id) AS num_mensajes
    FROM chat_conversaciones c
    WHERE c.usuario_id = $1 ${agente ? 'AND c.agente_id = $2' : ''}
    ORDER BY c.updated_at DESC
    LIMIT 20
  `, agente ? [userId, agente] : [userId]);

  res.json({ ok: true, data: convs });
});

// POST /api/chat/conversaciones — crear nueva conversación
router.post('/', async (req, res) => {
  const db = getDb();
  const { agentId, origen } = req.body;
  if (!agentId) return res.status(400).json({ ok: false, error: 'agentId requerido' });

  const conv = await db.one(`
    INSERT INTO chat_conversaciones (usuario_id, agente_id, origen)
    VALUES ($1, $2, $3) RETURNING *
  `, [req.usuario.id, agentId, origen || null]);

  res.json({ ok: true, data: conv });
});

// GET /api/chat/conversaciones/:id/mensajes — mensajes de una conversación
router.get('/:id/mensajes', async (req, res) => {
  const db = getDb();
  const convId = parseInt(req.params.id, 10);

  // Verificar que la conversación es del usuario
  const conv = await db.one(
    'SELECT id FROM chat_conversaciones WHERE id = $1 AND usuario_id = $2',
    [convId, req.usuario.id]
  );
  if (!conv) return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });

  const msgs = await db.all(
    'SELECT id, role, content, created_at FROM chat_mensajes WHERE conversacion_id = $1 ORDER BY created_at ASC',
    [convId]
  );

  res.json({ ok: true, data: msgs });
});

// POST /api/chat/conversaciones/:id/mensajes — guardar un mensaje
router.post('/:id/mensajes', async (req, res) => {
  const db = getDb();
  const convId = parseInt(req.params.id, 10);
  const { role, content } = req.body;

  if (!role || !content) return res.status(400).json({ ok: false, error: 'role y content requeridos' });

  // Verificar propiedad
  const conv = await db.one(
    'SELECT id FROM chat_conversaciones WHERE id = $1 AND usuario_id = $2',
    [convId, req.usuario.id]
  );
  if (!conv) return res.status(404).json({ ok: false, error: 'Conversación no encontrada' });

  const msg = await db.one(`
    INSERT INTO chat_mensajes (conversacion_id, role, content)
    VALUES ($1, $2, $3) RETURNING *
  `, [convId, role, content]);

  // Actualizar titulo si es el primer mensaje del usuario
  await db.query(`
    UPDATE chat_conversaciones SET updated_at = NOW(),
      titulo = COALESCE(titulo, LEFT($2, 60))
    WHERE id = $1
  `, [convId, role === 'user' ? content : null]);

  res.json({ ok: true, data: msg });
});

module.exports = router;
