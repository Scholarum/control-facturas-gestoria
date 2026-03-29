import { useState, useRef, useEffect, useCallback } from 'react';
import { getStoredToken, fetchChatConfig, fetchConversaciones, crearConversacion, fetchMensajes, guardarMensaje } from '../api.js';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const AGENTS = [
  { id: 'atc', label: 'ATC Scholarum' },
];

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState(AGENTS[0].id);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [convId, setConvId] = useState(null);
  const [convList, setConvList] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [chatConfig, setChatConfig] = useState({});
  const bottomRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Cargar config y conversaciones al abrir
  useEffect(() => {
    if (!open) return;
    fetchChatConfig().then(setChatConfig);
    loadConversaciones();
  }, [open, agentId]);

  async function loadConversaciones() {
    const convs = await fetchConversaciones(agentId);
    setConvList(convs);
    if (convs.length > 0 && !convId) {
      await loadConversacion(convs[0].id);
    }
  }

  async function loadConversacion(id) {
    const msgs = await fetchMensajes(id);
    setMessages(msgs.map(m => ({
      role: m.role,
      content: m.content,
      html: m.role === 'assistant' ? m.content : undefined,
    })));
    setConvId(id);
    setShowHistory(false);
  }

  async function startNewConversation() {
    const conv = await crearConversacion(agentId, window.location.pathname);
    setConvId(conv.id);
    const bienvenida = chatConfig.mensaje_bienvenida;
    if (bienvenida) {
      setMessages([{ role: 'assistant', content: bienvenida, html: bienvenida }]);
      guardarMensaje(conv.id, 'assistant', bienvenida);
    } else {
      setMessages([]);
    }
    setShowHistory(false);
    setConvList(prev => [conv, ...prev]);
  }

  function handleAgentChange(e) {
    setAgentId(e.target.value);
    setConvId(null);
    setMessages([]);
    setConvList([]);
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    // Crear conversación si no existe
    let activeConvId = convId;
    if (!activeConvId) {
      const conv = await crearConversacion(agentId, window.location.pathname);
      activeConvId = conv.id;
      setConvId(conv.id);
      setConvList(prev => [conv, ...prev]);
    }

    const userMsg = { role: 'user', content: text };
    const updated = [...messages, userMsg];
    setMessages(updated);
    setInput('');
    setLoading(true);

    // Persistir mensaje del usuario
    guardarMensaje(activeConvId, 'user', text);

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

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        let eventType = '';
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (eventType === 'delta') {
                accumulated += data.text;
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, content: accumulated, html: accumulated } : m
                ));
              } else if (eventType === 'tool_call') {
                const toolMsg = `Consultando ${data.name}...`;
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, content: toolMsg, html: '', tooling: true } : m
                ));
              } else if (eventType === 'error') {
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { role: 'assistant', content: data.error || 'Error' } : m
                ));
              } else if (eventType === 'done') {
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, streaming: false, tooling: false } : m
                ));
              }
            } catch { /* ignorar */ }
          }
        }
      }

      // Persistir respuesta del asistente
      if (accumulated) {
        guardarMensaje(activeConvId, 'assistant', accumulated);
      }

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

  // ─── Botón flotante ──────────────────────────────────────────────────────
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
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowHistory(h => !h)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              showHistory ? 'bg-white text-blue-700' : 'bg-blue-500 text-white hover:bg-blue-400'
            }`}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Historial
          </button>
          <button onClick={startNewConversation}
            className="flex items-center gap-1 px-2 py-1 rounded bg-blue-500 text-white text-xs font-medium hover:bg-blue-400 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Nuevo
          </button>
          <button onClick={() => setOpen(false)} className="text-white/80 hover:text-white text-xl leading-none ml-1">&times;</button>
        </div>
      </div>

      {/* Lista de conversaciones anteriores */}
      {showHistory ? (
        <div className="flex-1 overflow-y-auto bg-gray-50">
          {convList.length === 0 ? (
            <p className="text-center text-gray-400 text-xs mt-8">Sin conversaciones</p>
          ) : convList.map(c => (
            <button key={c.id} onClick={() => loadConversacion(c.id)}
              className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-blue-50 transition-colors ${c.id === convId ? 'bg-blue-50' : ''}`}>
              <p className="text-sm font-medium text-gray-800 truncate">{c.titulo || 'Conversación sin título'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {new Date(c.updated_at).toLocaleDateString('es-ES')} — {c.num_mensajes} mensaje(s)
              </p>
            </button>
          ))}
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
