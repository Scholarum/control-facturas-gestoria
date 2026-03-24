const express = require('express');
const router  = express.Router();

const { resolveUser, requireAdmin }                       = require('../middleware/auth');
const { getPrompt, savePrompt, resetPromptToDefault,
        PROMPT_DEFAULT, ejecutarExtraccion }              = require('../services/extractorService');
const { getSistemaConfig, setSistemaConfig }             = require('../services/sistemaConfigService');
const { iniciarCrons }                                   = require('../services/cronService');

router.use(resolveUser);

// ─── GET /api/configuracion/prompt ───────────────────────────────────────────

router.get('/prompt', requireAdmin, async (req, res) => {
  const prompt = await getPrompt();
  res.json({ ok: true, data: { prompt } });
});

// ─── PUT /api/configuracion/prompt ───────────────────────────────────────────

router.put('/prompt', requireAdmin, async (req, res) => {
  const { prompt, reset } = req.body;
  if (reset) {
    await resetPromptToDefault();
    return res.json({ ok: true, data: { prompt: PROMPT_DEFAULT } });
  }
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 20) {
    return res.status(400).json({ ok: false, error: 'El prompt no puede estar vacío' });
  }
  await savePrompt(prompt.trim());
  res.json({ ok: true });
});

// ─── POST /api/configuracion/reextraer (SSE streaming) ───────────────────────

router.post('/reextraer', requireAdmin, async (req, res) => {
  const ids = Array.isArray(req.body.ids) && req.body.ids.length ? req.body.ids : null;

  res.setHeader('Content-Type',      'text/event-stream');
  res.setHeader('Cache-Control',     'no-cache');
  res.setHeader('Connection',        'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (res.flush) res.flush();
  };

  try {
    await ejecutarExtraccion(ids, send);
  } catch (err) {
    send({ tipo: 'error', mensaje: err.message });
  }

  res.end();
});

// ─── GET /api/configuracion/sistema ──────────────────────────────────────────

router.get('/sistema', requireAdmin, async (req, res) => {
  const data = await getSistemaConfig();
  res.json({ ok: true, data });
});

// ─── PUT /api/configuracion/sistema ──────────────────────────────────────────

const CAMPOS_SISTEMA = [
  'sync_activo', 'sync_frecuencia', 'sync_hora',
  'notify_activo', 'notify_frecuencia', 'notify_hora', 'notify_app_url',
  'email_asunto', 'email_cuerpo',
];

router.put('/sistema', requireAdmin, async (req, res) => {
  const updates = {};
  for (const k of CAMPOS_SISTEMA) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  await setSistemaConfig(updates);
  iniciarCrons().catch(e => console.error('[Cron]', e.message));
  const data = await getSistemaConfig();
  res.json({ ok: true, data });
});

module.exports = router;
