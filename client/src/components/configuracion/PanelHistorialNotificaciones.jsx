import { useState, useEffect } from 'react';
import { fetchHistorialNotificaciones, fetchEstadoMensaje } from '../../api.js';
import { fmtFecha, Spinner } from './helpers.jsx';

const MJ_STATUS_COLOR = {
  sent:        'text-emerald-700 bg-emerald-50',
  opened:      'text-blue-700 bg-blue-50',
  clicked:     'text-purple-700 bg-purple-50',
  bounce:      'text-red-700 bg-red-50',
  hardbounced: 'text-red-700 bg-red-50',
  softbounced: 'text-orange-700 bg-orange-50',
  spam:        'text-red-700 bg-red-50',
  blocked:     'text-red-700 bg-red-50',
  queued:      'text-gray-600 bg-gray-100',
  deferred:    'text-amber-700 bg-amber-50',
};

export default function PanelHistorialNotificaciones() {
  const [historial,  setHistorial]  = useState([]);
  const [cargando,   setCargando]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded,   setExpanded]   = useState(null);
  const [estadosMj,  setEstadosMj]  = useState({});
  const [filtros,    setFiltros]    = useState({ fechaDesde: '', fechaHasta: '', origen: '' });

  function setF(k, v) { setFiltros(prev => ({ ...prev, [k]: v })); }
  const hayFiltros = Object.values(filtros).some(Boolean);

  async function cargar() {
    setRefreshing(true);
    try { setHistorial(await fetchHistorialNotificaciones()); }
    catch (_) {}
    finally { setCargando(false); setRefreshing(false); }
  }

  useEffect(() => { cargar(); }, []);

  const filtrados = historial.filter(r => {
    if (filtros.origen && r.origen !== filtros.origen) return false;
    if (filtros.fechaDesde && r.fecha && r.fecha.slice(0, 10) < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && r.fecha && r.fecha.slice(0, 10) > filtros.fechaHasta) return false;
    return true;
  });

  async function verEstado(messageId) {
    setEstadosMj(prev => ({ ...prev, [messageId]: { loading: true } }));
    try {
      const data = await fetchEstadoMensaje(messageId);
      setEstadosMj(prev => ({ ...prev, [messageId]: { loading: false, data } }));
    } catch (e) {
      setEstadosMj(prev => ({ ...prev, [messageId]: { loading: false, error: e.message } }));
    }
  }

  const inputCls = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Historial de notificaciones</p>
          <p className="text-xs text-gray-400 mt-0.5">Ultimos 50 envios (manuales y automaticos). Haz clic en una fila para ver los detalles.</p>
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
              <option value="">Todos</option><option value="CRON">CRON</option><option value="MANUAL">MANUAL</option><option value="TEST">TEST</option>
            </select>
          </div>
          {hayFiltros && <button onClick={() => setFiltros({ fechaDesde: '', fechaHasta: '', origen: '' })} className="text-xs text-gray-500 hover:text-gray-800 self-end pb-0.5">Limpiar</button>}
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
                {['Fecha', 'Origen', 'Asunto', 'Enviados', 'Errores'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(row => {
                const dests = (() => { try { return JSON.parse(row.destinatarios || '[]'); } catch { return []; } })();
                const mjRes = (() => { try { return JSON.parse(row.respuesta_mj || '[]'); } catch { return []; } })();
                return (
                  <>
                    <tr key={row.id} onClick={() => setExpanded(prev => prev === row.id ? null : row.id)}
                      className="hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtFecha(row.fecha)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${
                          row.origen === 'CRON' ? 'bg-purple-50 text-purple-700 ring-purple-200'
                            : row.origen === 'TEST' ? 'bg-amber-50 text-amber-700 ring-amber-200'
                              : 'bg-blue-50 text-blue-700 ring-blue-200'
                        }`}>{row.origen}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 max-w-[220px] truncate">{row.asunto || '—'}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-emerald-700">{row.enviados}</td>
                      <td className="px-4 py-2.5">
                        {row.errores > 0
                          ? <span className="text-sm font-semibold text-red-600">{row.errores}</span>
                          : <span className="text-sm text-gray-400">—</span>}
                      </td>
                    </tr>
                    {expanded === row.id && (
                      <tr key={`${row.id}-detail`} className="bg-gray-50">
                        <td colSpan={5} className="px-4 py-3 text-xs text-gray-700">
                          <div className="space-y-2">
                            {dests.length > 0 && (
                              <div>
                                <p className="font-semibold text-gray-500 mb-1 uppercase tracking-wide">Destinatarios</p>
                                <div className="flex flex-col gap-1">
                                  {dests.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                      <span className={d.enviado ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                                        {d.enviado ? '✓' : '✗'}
                                      </span>
                                      <span className="text-gray-800">{d.nombre} &lt;{d.email}&gt;</span>
                                      {d.mj_id && <span className="text-gray-400">ID: {d.mj_id}</span>}
                                      {d.error && <span className="text-red-500">{d.error}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {mjRes.length > 0 && (
                              <div>
                                <p className="font-semibold text-gray-500 mb-1 uppercase tracking-wide">Respuesta Mailjet</p>
                                <div className="space-y-2">
                                  {mjRes.map((m, i) => {
                                    const eid   = m.id ?? m.mj_id;
                                    const est   = eid ? estadosMj[eid] : null;
                                    const mjData = est?.data?.Data?.[0];
                                    return (
                                      <div key={i} className="bg-white border border-gray-200 rounded p-2 space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium text-gray-700">{m.email}</span>
                                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.status === 'success' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
                                            API: {m.status ?? '—'}
                                          </span>
                                          {eid && (
                                            <button onClick={() => verEstado(eid)} disabled={est?.loading}
                                              className="px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors disabled:opacity-50">
                                              {est?.loading ? 'Consultando…' : 'Ver estado entrega'}
                                            </button>
                                          )}
                                          {mjData?.Status && (
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MJ_STATUS_COLOR[mjData.Status.toLowerCase()] ?? 'text-gray-600 bg-gray-100'}`}>
                                              Entrega: {mjData.Status}
                                            </span>
                                          )}
                                        </div>
                                        {eid && <p className="text-gray-400">ID: {eid}{m.uuid ? ` · UUID: ${m.uuid}` : ''}</p>}
                                        {m.error && <p className="text-red-500 break-all">{m.error}</p>}
                                        {mjData && (
                                          <div className="text-gray-500 space-y-0.5 mt-1">
                                            {mjData.ArrivedAt && <p>Recibido por Mailjet: {new Date(mjData.ArrivedAt).toLocaleString('es-ES')}</p>}
                                            {mjData.Subject   && <p>Asunto: {mjData.Subject}</p>}
                                            {mjData.SpamassassinScore != null && <p>SpamAssassin score: {mjData.SpamassassinScore}</p>}
                                            {mjData.IsClickTracked != null && <p>Click tracking: {mjData.IsClickTracked ? 'si' : 'no'}</p>}
                                          </div>
                                        )}
                                        {est?.error && <p className="text-red-500">{est.error}</p>}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
