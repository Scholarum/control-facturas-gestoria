const express = require('express');
const logger = require('../config/logger');
const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');
const path = require('path');
const { resolveUser, requireAuth } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const OCT8NE_BASE = 'https://shub-admin.azurewebsites.net/Oct8ne';
const OCT8NE_API_KEY = process.env.OCT8NE_API_KEY;

// ─── Definición de herramientas para Anthropic ───────────────────────────────

const tools = [
  {
    name: 'GetListadoPedidos',
    description: 'Obtiene el listado de pedidos de un cliente a partir de su email. Devuelve un array con los pedidos y su estado.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email del cliente' },
      },
      required: ['email'],
    },
  },
  {
    name: 'GetPedidoDetalle',
    description: 'Obtiene el detalle completo de un pedido concreto. Requiere el email del cliente y el número de pedido.',
    input_schema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email del cliente' },
        numeroPedido: { type: 'string', description: 'Número de pedido' },
      },
      required: ['email', 'numeroPedido'],
    },
  },
];

// ─── Ejecución real de herramientas ──────────────────────────────────────────

async function executeTool(name, input) {
  const params = new URLSearchParams();

  if (name === 'GetListadoPedidos') {
    params.set('email', input.email);
  } else if (name === 'GetPedidoDetalle') {
    params.set('email', input.email);
    params.set('numeroPedido', input.numeroPedido);
  } else {
    return { error: `Herramienta desconocida: ${name}` };
  }

  const url = `${OCT8NE_BASE}/${name}?${params}`;

  const resp = await fetch(url, {
    headers: { 'Oct8neAPIKey': OCT8NE_API_KEY },
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { error: `HTTP ${resp.status}: ${body}` };
  }

  return resp.json();
}

// ─── Cache de system prompts ─────────────────────────────────────────────────

const agentPrompts = {};

function loadAgentPrompt(agentId) {
  if (agentPrompts[agentId]) return agentPrompts[agentId];

  const filePath = path.join(__dirname, '../config/agents', `${agentId}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, 'utf-8');
  const match = raw.match(/^---[\s\S]*?---\s*([\s\S]*)$/);
  const prompt = match ? match[1].trim() : raw.trim();

  agentPrompts[agentId] = prompt;
  return prompt;
}

// ─── POST /api/chat (streaming SSE) ─────────────────────────────────────────

const MAX_TOOL_ROUNDS = 5;

router.post('/', resolveUser, requireAuth, chatLimiter, async (req, res) => {
  const { messages, agentId } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, error: 'messages es obligatorio y debe ser un array no vacío' });
  }
  if (!agentId) {
    return res.status(400).json({ ok: false, error: 'agentId es obligatorio' });
  }

  const systemPrompt = loadAgentPrompt(agentId);
  if (!systemPrompt) {
    return res.status(404).json({ ok: false, error: `Agente "${agentId}" no encontrado` });
  }

  // Configurar SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const conversation = messages.map(m => ({ role: m.role, content: m.content }));

    // ─── Rondas de tool_use (sin streaming — necesitamos respuesta completa) ─
    let needsStreaming = true;
    let rounds = 0;

    while (rounds <= MAX_TOOL_ROUNDS) {
      // Primera llamada y rondas intermedias: sin streaming
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages: conversation,
      });

      if (response.stop_reason !== 'tool_use') {
        // No hay más herramientas — preparar conversación para streaming final
        // Descartamos esta respuesta y la rehacemos con streaming
        break;
      }

      rounds++;
      conversation.push({ role: 'assistant', content: response.content });

      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      for (const block of toolUseBlocks) {
        sendEvent('tool_call', { name: block.name, input: block.input });
      }

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          try {
            const result = await executeTool(block.name, block.input);
            return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) };
          } catch (err) {
            return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Error: ${err.message}` };
          }
        })
      );

      conversation.push({ role: 'user', content: toolResults });
    }

    // ─── Respuesta final: siempre streaming real ────────────────────────
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages: conversation,
    });

    stream.on('text', (text) => {
      sendEvent('delta', { text });
    });

    stream.on('error', (err) => {
      logger.error({ err: err.message }, 'Error en stream de Anthropic');
      sendEvent('error', { error: 'Error al comunicar con la API de Anthropic' });
      res.end();
    });

    stream.on('end', () => {
      sendEvent('done', { ok: true });
      res.end();
    });

  } catch (err) {
    logger.error({ err: err.message }, 'Error al llamar a Anthropic');
    sendEvent('error', { error: 'Error al comunicar con la API de Anthropic' });
    res.end();
  }
});

module.exports = router;
