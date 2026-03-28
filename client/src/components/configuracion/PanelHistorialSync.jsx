import { useState, useEffect } from 'react';
import { fetchHistorialSync } from '../../api.js';
import { fmtFecha, fmtMs, Spinner } from './helpers.jsx';

export default function PanelHistorialSync() {
  const [historial,  setHistorial]  = useState([]);
  const [cargando,   setCargando]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtros,    setFiltros]    = useState({ fechaDesde: '', fechaHasta: '', origen: '', estado: '' });

  function setF(k, v) { setFiltros(prev => ({ ...prev, [k]: v })); }
  const hayFiltros = Object.values(filtros).some(Boolean);

  async function cargar() {
    setRefreshing(true);
    try { setHistorial(await fetchHistorialSync()); }
    catch (_) {}
    finally { setCargando(false); setRefreshing(false); }
  }

  useEffect(() => { cargar(); }, []);

  const filtrados = historial.filter(r => {
    if (filtros.origen && r.origen !== filtros.origen) return false;
    if (filtros.estado && r.estado !== filtros.estado) return false;
    if (filtros.fechaDesde && r.fecha && r.fecha.slice(0, 10) < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && r.fecha && r.fecha.slice(0, 10) > filtros.fechaHasta) return false;
    return true;
  });

  const inputCls = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Historial de sincronizaciones</p>
          <p className="text-xs text-gray-400 mt-0.5">Ultimas 50 ejecuciones (manuales y automaticas).</p>
        </div>
        <button onClick={cargar} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50">
          {refreshing
            ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>}
          Actualizar
        </button>
      </div>
      {/* Filtros */}
      {!cargando && historial.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Desde</label>
            <input type="date" value={filtros.fechaDesde} onChange={e => setF('fechaDesde', e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Hasta</label>
            <input type="date" value={filtros.fechaHasta} onChange={e => setF('fechaHasta', e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Origen</label>
            <select value={filtros.origen} onChange={e => setF('origen', e.target.value)} className={inputCls}>
              <option value="">Todos</option><option value="CRON">CRON</option><option value="MANUAL">MANUAL</option>
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Estado</label>
            <select value={filtros.estado} onChange={e => setF('estado', e.target.value)} className={inputCls}>
              <option value="">Todos</option><option value="OK">OK</option><option value="ERROR">ERROR</option>
            </select>
          </div>
          {hayFiltros && <button onClick={() => setFiltros({ fechaDesde: '', fechaHasta: '', origen: '', estado: '' })} className="text-xs text-gray-500 hover:text-gray-800 self-end pb-0.5">Limpiar</button>}
          <span className="text-[10px] text-gray-400 ml-auto self-end">{filtrados.length} de {historial.length}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-10"><Spinner /></div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">{hayFiltros ? 'Sin resultados con estos filtros' : 'Sin registros'}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha', 'Origen', 'Estado', 'Nuevas', 'Duplicadas', 'En revision', 'Duracion', 'Detalle'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(row => {
                const dups = row.detalle?.duplicadas || [];
                const numDups = row.facturas_duplicadas || dups.length || 0;
                const dupTooltip = dups.length
                  ? dups.map(d => `${d.nombre_archivo} (${d.numero_factura || '?'} - ${d.cif_emisor || '?'}) en ${d.ruta_drive || '?'}`).join('\n')
                  : '';
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtFecha(row.fecha)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${row.origen === 'CRON' ? 'bg-purple-50 text-purple-700 ring-purple-200' : 'bg-blue-50 text-blue-700 ring-blue-200'}`}>{row.origen}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${row.estado === 'OK' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>{row.estado}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">{row.facturas_nuevas}</td>
                    <td className="px-4 py-2.5" title={dupTooltip}>
                      <span className={numDups > 0 ? 'text-sm font-semibold text-amber-600 cursor-help' : 'text-sm text-gray-400'}>{numDups}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {row.facturas_error > 0 ? <span className="text-sm font-semibold text-red-600">{row.facturas_error}</span> : <span className="text-sm text-gray-400">0</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{fmtMs(row.duracion_ms)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[200px] truncate" title={row.detalle?.error || ''}>
                      {row.detalle?.error ? <span className="text-red-500">{row.detalle.error}</span> : row.detalle?.total_escaneadas != null ? `${row.detalle.total_escaneadas} PDFs escaneados` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
