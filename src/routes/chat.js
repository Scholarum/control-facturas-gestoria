const express = require('express');
const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');
const path = require('path');
const { resolveUser, requireAuth } = require('../middleware/auth');

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

// ─── POST /api/chat ──────────────────────────────────────────────────────────

const MAX_TOOL_ROUNDS = 5;

router.post('/', resolveUser, requireAuth, async (req, res) => {
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

  try {
    // Copia de trabajo del historial — no muta el array original
    const conversation = messages.map(m => ({ role: m.role, content: m.content }));

    let response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages: conversation,
    });

    // ─── Bucle de tool_use ─────────────────────────────────────────────
    let rounds = 0;
    while (response.stop_reason === 'tool_use' && rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      // Añadir la respuesta del asistente (con bloques tool_use) al historial
      conversation.push({ role: 'assistant', content: response.content });

      // Ejecutar cada tool_use en paralelo
      const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => {
          try {
            const result = await executeTool(block.name, block.input);
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            };
          } catch (err) {
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              is_error: true,
              content: `Error al ejecutar ${block.name}: ${err.message}`,
            };
          }
        })
      );

      // Añadir los resultados como mensaje del usuario
      conversation.push({ role: 'user', content: toolResults });

      // Siguiente llamada a Anthropic
      response = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages: conversation,
      });
    }

    // ─── Extraer texto final ───────────────────────────────────────────
    const reply = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('');

    res.json({ ok: true, reply });
  } catch (err) {
    console.error('Error al llamar a Anthropic:', err.message);
    res.status(502).json({ ok: false, error: 'Error al comunicar con la API de Anthropic' });
  }
});

module.exports = router;
