import { useState, useEffect, useCallback, useRef } from 'react';
import { getStoredToken } from '../api.js';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const ICONS = {
  success: (
    <svg className="h-5 w-5 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  error: (
    <svg className="h-5 w-5 text-red-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  info: (
    <svg className="h-5 w-5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

function formatEvent(event, data) {
  switch (event) {
    case 'sync_complete': {
      const parts = [];
      if (data.facturas_nuevas) parts.push(`${data.facturas_nuevas} nuevas`);
      if (data.facturas_error)  parts.push(`${data.facturas_error} con error`);
      if (data.facturas_duplicadas) parts.push(`${data.facturas_duplicadas} duplicadas`);
      const secs = ((data.duracion_ms || 0) / 1000).toFixed(1);
      return {
        type: data.facturas_error ? 'error' : 'success',
        title: 'Sincronizacion completada',
        body: parts.length ? `${parts.join(', ')} (${secs}s)` : `Sin cambios (${secs}s)`,
      };
    }
    case 'sync_error':
      return { type: 'error', title: 'Error de sincronizacion', body: data.error || 'Error desconocido' };
    case 'facturas_contabilizadas':
      return { type: 'success', title: 'Facturas contabilizadas', body: `${data.count} factura(s) contabilizadas por ${data.usuario || 'un usuario'}` };
    case 'upload_complete':
      return { type: 'info', title: 'Subida completada', body: `${data.count} factura(s) procesadas` };
    default:
      return { type: 'info', title: event, body: JSON.stringify(data) };
  }
}

export default function Notificaciones() {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(0);

  const addToast = useCallback((event, data) => {
    const formatted = formatEvent(event, data);
    const id = nextId.current++;
    setToasts(prev => [...prev, { id, ...formatted, ts: Date.now() }]);
    // Auto-dismiss after 8s
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 8000);
  }, []);

  const dismiss = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    const url = `${API_BASE}/api/eventos`;
    let es;
    let retryTimeout;

    function connect() {
      // EventSource no soporta headers, pasamos token por query param
      es = new EventSource(`${url}?token=${encodeURIComponent(token)}`);

      es.addEventListener('sync_complete', e => addToast('sync_complete', JSON.parse(e.data)));
      es.addEventListener('sync_error', e => addToast('sync_error', JSON.parse(e.data)));
      es.addEventListener('facturas_contabilizadas', e => addToast('facturas_contabilizadas', JSON.parse(e.data)));
      es.addEventListener('upload_complete', e => addToast('upload_complete', JSON.parse(e.data)));

      es.onerror = () => {
        es.close();
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[60] space-y-2 w-80 max-w-[calc(100%-2rem)]">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`bg-white rounded-xl shadow-lg border px-4 py-3 flex items-start gap-3 animate-fade-in ${
            t.type === 'error' ? 'border-red-200' : t.type === 'success' ? 'border-emerald-200' : 'border-blue-200'
          }`}
        >
          {ICONS[t.type]}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">{t.title}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.body}</p>
          </div>
          <button onClick={() => dismiss(t.id)} className="text-gray-400 hover:text-gray-600 text-lg leading-none flex-shrink-0">&times;</button>
        </div>
      ))}
    </div>
  );
}
