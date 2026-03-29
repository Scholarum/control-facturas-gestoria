import { useState, useRef, useEffect } from 'react';
import { getStoredToken } from '../api.js';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const AGENTS = [
  { id: 'atc', label: 'ATC Scholarum' },
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(AGENTS[0].id);
  const [messages, setMessages] = useState([]);   // { role, content, html? }
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  // Auto-scroll al último mensaje
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Limpiar historial al cambiar de agente
  function handleAgentChange(e) {
    setAgentId(e.target.value);
    setMessages([]);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    // Añadir burbuja vacía del asistente que iremos rellenando
    const assistantIdx = updated.length;
    setMessages(prev => [...prev, { role: 'assistant', content: '', html: '', streaming: true }]);

    try {
      const apiMessages = updated.map(m => ({ role: m.role, content: m.content }));

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getStoredToken()}`,
        },
        body: JSON.stringify({ agentId, messages: apiMessages }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessages(prev => prev.map((m, i) =>
          i === assistantIdx ? { role: 'assistant', content: err.error || 'Error desconocido' } : m
        ));
        setLoading(false);
        return;
      }

      // Leer SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // último fragmento incompleto

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const raw = line.slice(6);
            try {
              const data = JSON.parse(raw);
              if (eventType === 'delta') {
                accumulated += data.text;
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, content: accumulated, html: accumulated } : m
                ));
              } else if (eventType === 'tool_call') {
                // Mostrar indicador de herramienta
                const toolMsg = `Consultando ${data.name}...`;
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, content: toolMsg, html: '', tooling: true } : m
                ));
              } else if (eventType === 'error') {
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { role: 'assistant', content: data.error || 'Error' } : m
                ));
              } else if (eventType === 'done') {
                // Marcar como completado
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, streaming: false, tooling: false } : m
                ));
              }
            } catch { /* ignorar líneas no-JSON */ }
          }
        }
      }

      // Si el stream terminó sin evento 'done', limpiar igualmente
      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx ? { ...m, streaming: false, tooling: false } : m
      ));

    } catch {
      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx ? { role: 'assistant', content: 'Error de conexión con el servidor.' } : m
      ));
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  // ─── Botón flotante (panel cerrado) ──────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 hover:bg-blue-700 text-white shadow-lg flex items-center justify-center transition-colors"
        title="Asistente interno"
      >
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
        </svg>
      </button>
    );
  }

  // ─── Panel abierto ───────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 sm:inset-auto sm:bottom-6 sm:right-6 z-50 w-full h-full sm:w-[360px] sm:h-[480px] flex flex-col bg-white sm:rounded-xl shadow-2xl sm:border sm:border-gray-200 overflow-hidden">

      {/* Cabecera */}
      <div className="bg-blue-600 text-white px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-sm">Asistente interno</span>
          <select
            value={agentId}
            onChange={handleAgentChange}
            className="text-xs bg-blue-700 text-white rounded px-1.5 py-0.5 border-none outline-none cursor-pointer"
          >
            {AGENTS.map(a => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white text-xl leading-none">&times;</button>
      </div>

      {/* Mensajes */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-gray-50">
        {messages.length === 0 && !loading && (
          <p className="text-center text-gray-400 text-xs mt-8">Escribe un mensaje para empezar</p>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-800 border border-gray-200 shadow-sm'
              }`}
            >
              {msg.tooling ? (
                <span className="text-gray-400 flex items-center gap-1.5">
                  <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  {msg.content}
                </span>
              ) : msg.html ? (
                <div dangerouslySetInnerHTML={{ __html: msg.html }} />
              ) : (
                msg.content
              )}
              {msg.streaming && !msg.tooling && <span className="animate-pulse">|</span>}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-3 py-2 flex items-center gap-2 shrink-0 bg-white">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Escribe un mensaje..."
          disabled={loading}
          className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg px-3 py-2 text-sm font-medium transition-colors"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
