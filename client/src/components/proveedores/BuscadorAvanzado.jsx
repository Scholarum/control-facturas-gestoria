export default function BuscadorAvanzado({ filtros, onChange }) {
  function set(k, v) { onChange({ ...filtros, [k]: v }); }
  const hayFiltros = Object.values(filtros).some(v => v.trim());

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Razon Social</label>
          <input
            value={filtros.razonSocial}
            onChange={e => set('razonSocial', e.target.value)}
            placeholder="Buscar..."
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">CIF / NIF</label>
          <input
            value={filtros.cif}
            onChange={e => set('cif', e.target.value.toUpperCase())}
            placeholder="B12345678"
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cuenta Contable</label>
          <input
            value={filtros.cuentaContable}
            onChange={e => set('cuentaContable', e.target.value)}
            placeholder="400, proveedor..."
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cuenta de Gasto</label>
          <input
            value={filtros.cuentaGasto}
            onChange={e => set('cuentaGasto', e.target.value)}
            placeholder="62, servicios..."
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      {hayFiltros && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-400">Filtros activos</span>
          <button
            onClick={() => onChange({ razonSocial: '', cif: '', cuentaContable: '', cuentaGasto: '' })}
            className="text-xs text-blue-600 hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}
