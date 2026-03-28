const selectCls = 'w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';
const inputCls  = 'w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

const FILTROS_VACIO = {
  razonSocial: '', cif: '', cifPresencia: '',
  carpeta: '', carpetaPresencia: '',
  cuentaContable: '', cuentaContablePresencia: '',
  cuentaGasto: '', cuentaGastoPresencia: '',
};

export { FILTROS_VACIO };

export default function BuscadorAvanzado({ filtros, onChange }) {
  function set(k, v) { onChange({ ...filtros, [k]: v }); }
  const hayFiltros = Object.values(filtros).some(v => v && v.trim ? v.trim() : v);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {/* Razon Social */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Razon Social</label>
          <input value={filtros.razonSocial} onChange={e => set('razonSocial', e.target.value)}
            placeholder="Buscar..." className={inputCls} />
        </div>

        {/* CIF */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">CIF / NIF</label>
          <div className="flex gap-1">
            <select value={filtros.cifPresencia || ''} onChange={e => set('cifPresencia', e.target.value)}
              className={`${selectCls} w-auto min-w-0 flex-shrink-0 ${filtros.cifPresencia === 'sin' ? 'text-red-600 font-medium' : filtros.cifPresencia === 'con' ? 'text-emerald-600 font-medium' : ''}`}>
              <option value="">Todo</option>
              <option value="con">Con</option>
              <option value="sin">Sin</option>
            </select>
            <input value={filtros.cif} onChange={e => set('cif', e.target.value.toUpperCase())}
              placeholder="B12345678" className={`${inputCls} font-mono`} />
          </div>
        </div>

        {/* Carpeta Drive */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Carpeta Drive</label>
          <div className="flex gap-1">
            <select value={filtros.carpetaPresencia || ''} onChange={e => set('carpetaPresencia', e.target.value)}
              className={`${selectCls} w-auto min-w-0 flex-shrink-0 ${filtros.carpetaPresencia === 'sin' ? 'text-red-600 font-medium' : filtros.carpetaPresencia === 'con' ? 'text-emerald-600 font-medium' : ''}`}>
              <option value="">Todo</option>
              <option value="con">Con</option>
              <option value="sin">Sin</option>
            </select>
            <input value={filtros.carpeta || ''} onChange={e => set('carpeta', e.target.value)}
              placeholder="Nombre..." className={inputCls} />
          </div>
        </div>

        {/* Cuenta Contable */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cta. Contable</label>
          <div className="flex gap-1">
            <select value={filtros.cuentaContablePresencia || ''} onChange={e => set('cuentaContablePresencia', e.target.value)}
              className={`${selectCls} w-auto min-w-0 flex-shrink-0 ${filtros.cuentaContablePresencia === 'sin' ? 'text-red-600 font-medium' : filtros.cuentaContablePresencia === 'con' ? 'text-emerald-600 font-medium' : ''}`}>
              <option value="">Todo</option>
              <option value="con">Con</option>
              <option value="sin">Sin</option>
            </select>
            <input value={filtros.cuentaContable} onChange={e => set('cuentaContable', e.target.value)}
              placeholder="400..." className={inputCls} />
          </div>
        </div>

        {/* Cuenta de Gasto */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cta. Gasto</label>
          <div className="flex gap-1">
            <select value={filtros.cuentaGastoPresencia || ''} onChange={e => set('cuentaGastoPresencia', e.target.value)}
              className={`${selectCls} w-auto min-w-0 flex-shrink-0 ${filtros.cuentaGastoPresencia === 'sin' ? 'text-red-600 font-medium' : filtros.cuentaGastoPresencia === 'con' ? 'text-emerald-600 font-medium' : ''}`}>
              <option value="">Todo</option>
              <option value="con">Con</option>
              <option value="sin">Sin</option>
            </select>
            <input value={filtros.cuentaGasto} onChange={e => set('cuentaGasto', e.target.value)}
              placeholder="62..." className={inputCls} />
          </div>
        </div>
      </div>
      {hayFiltros && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-400">Filtros activos</span>
          <button onClick={() => onChange({ ...FILTROS_VACIO })}
            className="text-xs text-blue-600 hover:underline">
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}
