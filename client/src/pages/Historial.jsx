import { useState, useEffect } from 'react';
import TablaAuditoria from '../components/TablaAuditoria.jsx';
import { fetchAuditoria } from '../api.js';

export default function Historial({ usuario }) {
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    if (!usuario) { setLoading(false); return; }
    setLoading(true);
    fetchAuditoria()
      .then(setLogs)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [usuario]);

  if (!usuario) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400 gap-2">
        <span className="text-3xl">👤</span>
        <p className="text-sm">Selecciona un usuario para ver el historial.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Historial de Actividad</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {usuario.rol === 'ADMIN'
              ? 'Ves todas las acciones del sistema.'
              : 'Ves solo tus propias acciones.'}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchAuditoria().then(setLogs).catch(e => setError(e.message)).finally(() => setLoading(false)); }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualizar
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <TablaAuditoria logs={logs} loading={loading} />
    </div>
  );
}
