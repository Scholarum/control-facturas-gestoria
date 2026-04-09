import { useState, useEffect } from 'react';
import { fetchPendientesValidacion, confirmarEmpresaValidacion, rechazarValidacion } from '../api.js';

export default function ValidacionEntidades({ onCountChange }) {
  const [pendientes, setPendientes] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [procesando, setProcesando] = useState(null);   // id en proceso
  const [nombreEdit, setNombreEdit] = useState({});      // id → nombre editado

  async function cargar() {
    try {
      const data = await fetchPendientesValidacion();
      setPendientes(data);
      onCountChange?.(data.length);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { cargar(); }, []);

  async function handleConfirmar(pv) {
    setProcesando(pv.id); setError('');
    try {
      await confirmarEmpresaValidacion(pv.id, nombreEdit[pv.id] || pv.nombre_receptor);
      setPendientes(prev => prev.filter(p => p.id !== pv.id));
      onCountChange?.(pendientes.length - 1);
    } catch (e) { setError(e.message); }
    finally { setProcesando(null); }
  }

  async function handleRechazar(pv) {
    if (!confirm(`¿Descartar "${pv.nombre_archivo || pv.cif_receptor}"? Esta accion no se puede deshacer.`)) return;
    setProcesando(pv.id); setError('');
    try {
      await rechazarValidacion(pv.id);
      setPendientes(prev => prev.filter(p => p.id !== pv.id));
      onCountChange?.(pendientes.length - 1);
      alert(
        `Registro descartado.\n\n` +
        `Si deseas evitar que se reprocese, elimina el archivo original en Google Drive:\n` +
        `https://drive.google.com`
      );
    } catch (e) { setError(e.message); }
    finally { setProcesando(null); }
  }

  function driveUrl(googleId) {
    return googleId ? `https://drive.google.com/file/d/${googleId}/view` : null;
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <svg className="h-6 w-6 animate-spin text-amber-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
    </div>
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Bandeja de Validacion</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Facturas cuyo CIF receptor no coincide con ninguna empresa registrada. Revisa los datos y confirma o descarta cada entrada.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {pendientes.length === 0 ? (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          No hay entradas pendientes de validacion.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['CIF Detectado', 'Nombre Sugerido', 'Archivo', 'Proveedor', 'Fecha', 'Acciones'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pendientes.map(pv => {
                const url = driveUrl(pv.google_id);
                const isProcessing = procesando === pv.id;
                return (
                  <tr key={pv.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800 font-medium">{pv.cif_receptor}</td>
                    <td className="px-4 py-3">
                      <input
                        value={nombreEdit[pv.id] ?? pv.nombre_receptor ?? ''}
                        onChange={e => setNombreEdit(prev => ({ ...prev, [pv.id]: e.target.value }))}
                        className="w-full rounded border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        placeholder="Nombre de la empresa"
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                          </svg>
                          {pv.nombre_archivo || 'Ver PDF'}
                        </a>
                      ) : (
                        <span className="text-gray-400">{pv.nombre_archivo || '-'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{pv.proveedor || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-400">{new Date(pv.created_at).toLocaleDateString('es-ES')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleConfirmar(pv)} disabled={isProcessing}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-50 transition-colors">
                          {isProcessing ? '...' : 'Confirmar'}
                        </button>
                        <button onClick={() => handleRechazar(pv)} disabled={isProcessing}
                          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg disabled:opacity-50 transition-colors">
                          Rechazar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
        <strong>Nota:</strong> Al rechazar un registro, recuerda eliminar el archivo original en Google Drive para evitar que se reprocese en la proxima sincronizacion.
      </div>
    </div>
  );
}
