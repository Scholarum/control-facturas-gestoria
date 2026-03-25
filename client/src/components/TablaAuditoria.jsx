import { useState, useMemo } from 'react';

const EVENTO_CFG = {
  DOWNLOAD:              { label: 'Descarga',          cls: 'bg-blue-50   text-blue-700   ring-blue-200'   },
  SET_CONTABILIZADA:     { label: 'Contabilizada',     cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  CONTABILIZAR_MASIVO:   { label: 'Contabilizar',      cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  UPLOAD_CONCILIACION:   { label: 'Conciliacion',      cls: 'bg-purple-50 text-purple-700  ring-purple-200'  },
  REVERTIR_ESTADO:       { label: 'Revertido',         cls: 'bg-red-50    text-red-700     ring-red-200'     },
  EXPORT_EXCEL:          { label: 'Excel',             cls: 'bg-green-50  text-green-700   ring-green-200'   },
  EXPORT_A3:             { label: 'Export A3',         cls: 'bg-orange-50 text-orange-700  ring-orange-200'  },
  ELIMINAR_FACTURA:      { label: 'Eliminada',         cls: 'bg-red-50    text-red-700     ring-red-200'     },
  EDICION_DATOS_FACTURA: { label: 'Edicion datos',     cls: 'bg-amber-50  text-amber-700   ring-amber-200'   },
  DESCARGA:              { label: 'Descarga (v1)',     cls: 'bg-blue-50   text-blue-700   ring-blue-200'   },
  CONTABILIZACION:       { label: 'Contab. (v1)',      cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  SUBIDA:                { label: 'Subida',            cls: 'bg-gray-50   text-gray-600   ring-gray-200'   },
  APERTURA:              { label: 'Apertura',          cls: 'bg-gray-50   text-gray-600   ring-gray-200'   },
};

function Badge({ evento }) {
  const c = EVENTO_CFG[evento] || { label: evento, cls: 'bg-gray-100 text-gray-600 ring-gray-200' };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c.cls}`}>
      {c.label}
    </span>
  );
}

function fmtTs(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' });
}

function DetalleCell({ detalle }) {
  if (!detalle) return <span className="text-gray-400">-</span>;
  if (detalle.nombre) {
    return (
      <span className="text-gray-700 text-xs">
        {detalle.nombre}
        {detalle.proveedor ? <span className="text-gray-400"> · {detalle.proveedor}</span> : null}
      </span>
    );
  }
  if (detalle.proveedor && detalle.total != null) {
    return (
      <span className="text-gray-700 text-xs">
        {detalle.proveedor} · {detalle.total} facturas
        {detalle.pendientesSage > 0
          ? <span className="ml-1 text-amber-600">({detalle.pendientesSage} pend.)</span>
          : null}
      </span>
    );
  }
  if (detalle.campos_editados) {
    return <span className="text-gray-700 text-xs">{detalle.nombre} · campos: {detalle.campos_editados.join(', ')}</span>;
  }
  return <span className="text-gray-400 text-xs font-mono">{JSON.stringify(detalle).slice(0, 80)}</span>;
}

const inputCls = 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function TablaAuditoria({ logs, loading }) {
  const [filtros, setFiltros] = useState({ fechaDesde: '', fechaHasta: '', evento: '', usuario: '' });

  function set(k, v) { setFiltros(prev => ({ ...prev, [k]: v })); }
  const hayFiltros = Object.values(filtros).some(Boolean);

  // Extraer opciones únicas para los selects
  const eventosUnicos  = useMemo(() => [...new Set(logs.map(l => l.evento))].sort(), [logs]);
  const usuariosUnicos = useMemo(() => [...new Set(logs.map(l => l.usuario_nombre).filter(Boolean))].sort(), [logs]);

  const filtrados = useMemo(() => logs.filter(l => {
    if (filtros.evento && l.evento !== filtros.evento) return false;
    if (filtros.usuario && l.usuario_nombre !== filtros.usuario) return false;
    if (filtros.fechaDesde) {
      const ts = l.timestamp ? l.timestamp.slice(0, 10) : '';
      if (ts < filtros.fechaDesde) return false;
    }
    if (filtros.fechaHasta) {
      const ts = l.timestamp ? l.timestamp.slice(0, 10) : '';
      if (ts > filtros.fechaHasta) return false;
    }
    return true;
  }), [logs, filtros]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <svg className="h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      </div>
    );
  }

  if (!logs.length) {
    return <div className="text-center py-16 text-gray-400 text-sm">No hay actividad registrada.</div>;
  }

  return (
    <div className="space-y-3">
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
          <label className="text-xs font-medium text-gray-500">Accion</label>
          <select value={filtros.evento} onChange={e => set('evento', e.target.value)} className={`${inputCls} min-w-[150px]`}>
            <option value="">Todas</option>
            {eventosUnicos.map(ev => (
              <option key={ev} value={ev}>{EVENTO_CFG[ev]?.label || ev}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Usuario</label>
          <select value={filtros.usuario} onChange={e => set('usuario', e.target.value)} className={`${inputCls} min-w-[150px]`}>
            <option value="">Todos</option>
            {usuariosUnicos.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        {hayFiltros && (
          <button onClick={() => setFiltros({ fechaDesde: '', fechaHasta: '', evento: '', usuario: '' })}
            className="self-end px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">
            Limpiar
          </button>
        )}
        <span className="self-end text-xs text-gray-400 ml-auto">{filtrados.length} de {logs.length} registros</span>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha / Hora', 'Accion', 'Usuario', 'Detalle', 'IP'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-gray-400">
                    {hayFiltros ? 'Sin resultados con estos filtros' : 'No hay actividad registrada'}
                  </td>
                </tr>
              ) : filtrados.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtTs(log.timestamp)}</td>
                  <td className="px-4 py-3"><Badge evento={log.evento} /></td>
                  <td className="px-4 py-3">
                    <span className="text-sm text-gray-800">{log.usuario_nombre || '-'}</span>
                    {log.usuario_rol && <span className="ml-1.5 text-xs text-gray-400">{log.usuario_rol}</span>}
                  </td>
                  <td className="px-4 py-3 max-w-xs"><DetalleCell detalle={log.detalle} /></td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono">{log.ip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
