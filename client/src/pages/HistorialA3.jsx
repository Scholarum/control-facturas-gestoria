import { useState, useEffect, useMemo } from 'react';
import { fetchHistorialSage, reDescargarSage } from '../api.js';

function fmtFecha(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtEuro(n) {
  if (n == null) return '-';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function IconoDescarga() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

const inputCls = 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function HistorialA3() {
  const [lotes,       setLotes]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [descargando, setDescargando] = useState(null);
  const [filtros,     setFiltros]     = useState({ fechaDesde: '', fechaHasta: '', usuario: '' });

  function set(k, v) { setFiltros(prev => ({ ...prev, [k]: v })); }
  const hayFiltros = Object.values(filtros).some(Boolean);

  useEffect(() => {
    fetchHistorialSage()
      .then(setLotes)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const usuariosUnicos = useMemo(() => [...new Set(lotes.map(l => l.usuario_nombre).filter(Boolean))].sort(), [lotes]);

  const filtrados = useMemo(() => lotes.filter(l => {
    if (filtros.usuario && l.usuario_nombre !== filtros.usuario) return false;
    if (filtros.fechaDesde && l.fecha && l.fecha.slice(0, 10) < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && l.fecha && l.fecha.slice(0, 10) > filtros.fechaHasta) return false;
    return true;
  }), [lotes, filtros]);

  async function handleDescargar(lote, format) {
    setDescargando(lote.id);
    try { await reDescargarSage(lote.id, lote.nombre_fichero, format); }
    catch (e) { setError(e.message); }
    finally { setDescargando(null); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Historial de Exportaciones SAGE</h2>
          <p className="text-sm text-gray-500 mt-0.5">Registro de todos los lotes exportados en formato ContaPlus R75.</p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-3">x</button>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Fecha desde</label>
          <input type="date" value={filtros.fechaDesde} onChange={e => set('fechaDesde', e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Fecha hasta</label>
          <input type="date" value={filtros.fechaHasta} onChange={e => set('fechaHasta', e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Usuario</label>
          <select value={filtros.usuario} onChange={e => set('usuario', e.target.value)} className={`${inputCls} min-w-[150px]`}>
            <option value="">Todos</option>
            {usuariosUnicos.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {hayFiltros && (
          <button onClick={() => setFiltros({ fechaDesde: '', fechaHasta: '', usuario: '' })}
            className="self-end px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">
            Limpiar
          </button>
        )}
        <span className="self-end text-xs text-gray-400 ml-auto">{filtrados.length} de {lotes.length}</span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Fecha','Fichero','Usuario','Facturas','Asiento ini.','Asiento fin','Descargar'].map((h, i) => (
                <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide ${i >= 3 && i <= 5 ? 'text-right' : i === 6 ? 'text-center' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={7} className="py-16 text-center text-sm text-gray-400">Cargando...</td></tr>}
            {!loading && filtrados.length === 0 && (
              <tr><td colSpan={7} className="py-16 text-center text-sm text-gray-400">{hayFiltros ? 'Sin resultados con estos filtros' : 'No hay exportaciones SAGE'}</td></tr>
            )}
            {filtrados.map(lote => (
              <tr key={lote.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{fmtFecha(lote.fecha)}</td>
                <td className="px-4 py-3"><span className="text-xs font-mono text-orange-700 bg-orange-50 px-2 py-0.5 rounded">{lote.nombre_fichero}</span></td>
                <td className="px-4 py-3 text-sm text-gray-700">{lote.usuario_nombre || '-'}</td>
                <td className="px-4 py-3 text-sm text-gray-900 font-semibold text-right">{lote.num_facturas}</td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right font-mono">{lote.asiento_inicio}</td>
                <td className="px-4 py-3 text-sm text-gray-700 text-right font-mono">{lote.asiento_fin}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5">
                    <button onClick={() => handleDescargar(lote, 'txt')} disabled={descargando === lote.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors disabled:opacity-60">
                      {descargando === lote.id ? <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> : <IconoDescarga />}
                      TXT
                    </button>
                    <button onClick={() => handleDescargar(lote, 'csv')} disabled={descargando === lote.id}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors disabled:opacity-60">
                      <IconoDescarga />
                      CSV
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
