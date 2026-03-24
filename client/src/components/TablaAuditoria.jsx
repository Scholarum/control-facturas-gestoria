const EVENTO_CFG = {
  DOWNLOAD:            { label: 'Descarga',        cls: 'bg-blue-50   text-blue-700   ring-blue-200'   },
  SET_CONTABILIZADA:   { label: 'Contabilizada',   cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  UPLOAD_CONCILIACION: { label: 'Conciliación',    cls: 'bg-purple-50 text-purple-700  ring-purple-200'  },
  REVERTIR_ESTADO:     { label: 'Revertido',       cls: 'bg-red-50    text-red-700     ring-red-200'     },
  EXPORT_EXCEL:        { label: 'Excel',           cls: 'bg-green-50  text-green-700   ring-green-200'   },
  DESCARGA:            { label: 'Descarga (v1)',    cls: 'bg-blue-50   text-blue-700   ring-blue-200'   },
  CONTABILIZACION:     { label: 'Contab. (v1)',     cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  SUBIDA:              { label: 'Subida',           cls: 'bg-gray-50   text-gray-600   ring-gray-200'   },
  APERTURA:            { label: 'Apertura',         cls: 'bg-gray-50   text-gray-600   ring-gray-200'   },
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
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'medium' });
}

function DetalleCell({ detalle }) {
  if (!detalle) return <span className="text-gray-400">—</span>;
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
        {detalle.proveedor} · {detalle.total} facturas analizadas
        {detalle.pendientesSage > 0
          ? <span className="ml-1 text-amber-600">({detalle.pendientesSage} pend.)</span>
          : null}
      </span>
    );
  }
  return <span className="text-gray-400 text-xs font-mono">{JSON.stringify(detalle).slice(0, 80)}</span>;
}

export default function TablaAuditoria({ logs, loading }) {
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
    return (
      <div className="text-center py-16 text-gray-400 text-sm">
        No hay actividad registrada aún.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Fecha', 'Acción', 'Usuario', 'Detalle', 'IP'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtTs(log.timestamp)}</td>
                <td className="px-4 py-3"><Badge evento={log.evento} /></td>
                <td className="px-4 py-3">
                  <span className="text-sm text-gray-800">{log.usuario_nombre || '—'}</span>
                  {log.usuario_rol && (
                    <span className="ml-1.5 text-xs text-gray-400">{log.usuario_rol}</span>
                  )}
                </td>
                <td className="px-4 py-3 max-w-xs"><DetalleCell detalle={log.detalle} /></td>
                <td className="px-4 py-3 text-xs text-gray-400 font-mono">{log.ip}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
