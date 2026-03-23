export default function Filtros({ filtros, onChange, proveedores }) {
  const hayFiltros = Object.values(filtros).some(Boolean);

  function set(campo, valor) {
    onChange({ ...filtros, [campo]: valor });
  }

  const inputCls = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3 mb-4">
      <div className="flex flex-wrap gap-3 items-end">

        {/* Proveedor */}
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-xs font-medium text-gray-500">Proveedor</label>
          <select value={filtros.proveedor} onChange={e => set('proveedor', e.target.value)} className={inputCls}>
            <option value="">Todos los proveedores</option>
            {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Estado gestión */}
        <div className="flex flex-col gap-1 min-w-[150px]">
          <label className="text-xs font-medium text-gray-500">Estado</label>
          <select value={filtros.estado} onChange={e => set('estado', e.target.value)} className={inputCls}>
            <option value="">Todos los estados</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="DESCARGADA">Descargada</option>
            <option value="CONTABILIZADA">Contabilizada</option>
          </select>
        </div>

        {/* Fecha desde */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Fecha emisión desde</label>
          <input type="date" value={filtros.fechaDesde} onChange={e => set('fechaDesde', e.target.value)} className={inputCls} />
        </div>

        {/* Fecha hasta */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">hasta</label>
          <input type="date" value={filtros.fechaHasta} onChange={e => set('fechaHasta', e.target.value)} className={inputCls} />
        </div>

        {hayFiltros && (
          <button
            onClick={() => onChange({ proveedor: '', estado: '', fechaDesde: '', fechaHasta: '' })}
            className="self-end px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Limpiar
          </button>
        )}
      </div>
    </div>
  );
}
