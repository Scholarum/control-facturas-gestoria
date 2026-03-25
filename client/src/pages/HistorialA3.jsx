import { useState, useEffect } from 'react';
import { fetchHistorialA3, reDescargarA3 } from '../api.js';

function fmtFecha(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

function fmtEuro(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function IconoDescarga() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

export default function HistorialA3() {
  const [lotes,       setLotes]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [descargando, setDescargando] = useState(null); // id del lote descargando

  useEffect(() => {
    fetchHistorialA3()
      .then(setLotes)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  async function handleDescargar(lote) {
    setDescargando(lote.id);
    try {
      await reDescargarA3(lote.id, lote.nombre_fichero);
    } catch (e) {
      setError(e.message);
    } finally {
      setDescargando(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Historial de Exportaciones A3</h2>
          <p className="text-sm text-gray-500 mt-0.5">Registro de todos los lotes exportados al formato SICE / A3Simple.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Fecha</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Fichero</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Usuario</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Facturas</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Base</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">IVA</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Descargar</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={8} className="py-16 text-center text-sm text-gray-400">Cargando...</td>
              </tr>
            )}
            {!loading && lotes.length === 0 && (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p className="text-sm font-medium">Aún no hay exportaciones A3</p>
                  </div>
                </td>
              </tr>
            )}
            {lotes.map(lote => (
              <tr key={lote.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{fmtFecha(lote.fecha)}</td>
                <td className="px-4 py-3">
                  <span className="text-xs font-mono text-orange-700 bg-orange-50 px-2 py-0.5 rounded">
                    {lote.nombre_fichero}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">{lote.usuario_nombre || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-900 font-semibold text-right">{lote.num_facturas}</td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right">{fmtEuro(lote.total_base)}</td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right">{fmtEuro(lote.total_cuota)}</td>
                <td className="px-4 py-3 text-sm font-semibold text-gray-900 text-right">{fmtEuro(lote.total_factura)}</td>
                <td className="px-4 py-3 text-center">
                  <button
                    onClick={() => handleDescargar(lote)}
                    disabled={descargando === lote.id}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors disabled:opacity-60"
                  >
                    {descargando === lote.id ? (
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                    ) : (
                      <IconoDescarga />
                    )}
                    CSV
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
