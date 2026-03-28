const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

const FILTROS_VACIO = {
  razonSocial: '',
  cif: '', cifPresencia: '',
  carpeta: '', carpetaPresencia: '',
  cuentaContable: '', cuentaContablePresencia: '',
  cuentaGasto: '', cuentaGastoPresencia: '',
};

export { FILTROS_VACIO };

function FiltroConSin({ label, valor, presencia, onValor, onPresencia, placeholder, mono }) {
  const deshabilitado = presencia === 'sin';

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="flex">
        <select value={presencia || ''} onChange={e => { onPresencia(e.target.value); if (e.target.value === 'sin') onValor(''); }}
          className={`rounded-l-lg border border-r-0 border-gray-200 px-1.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${
            presencia === 'sin' ? 'text-red-600 font-semibold' : presencia === 'con' ? 'text-emerald-600 font-semibold' : 'text-gray-500'
          }`}>
          <option value="">Todo</option>
          <option value="con">Con</option>
          <option value="sin">Sin</option>
        </select>
        <input value={valor} onChange={e => onValor(e.target.value)}
          disabled={deshabilitado} placeholder={deshabilitado ? '—' : placeholder}
          className={`flex-1 min-w-0 rounded-r-lg border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            mono ? 'font-mono' : ''
          } ${deshabilitado ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`} />
      </div>
    </div>
  );
}

export default function BuscadorAvanzado({ filtros, onChange }) {
  function set(k, v) { onChange({ ...filtros, [k]: v }); }
  const hayFiltros = Object.values(filtros).some(v => v && (typeof v === 'string' ? v.trim() : v));

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Razon Social — solo texto */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Razon Social</label>
          <input value={filtros.razonSocial} onChange={e => set('razonSocial', e.target.value)}
            placeholder="Buscar..." className={inputCls} />
        </div>

        <FiltroConSin label="CIF / NIF" valor={filtros.cif} presencia={filtros.cifPresencia}
          onValor={v => set('cif', v.toUpperCase())} onPresencia={v => set('cifPresencia', v)}
          placeholder="B12345678" mono />

        <FiltroConSin label="Carpeta Drive" valor={filtros.carpeta} presencia={filtros.carpetaPresencia}
          onValor={v => set('carpeta', v)} onPresencia={v => set('carpetaPresencia', v)}
          placeholder="Nombre..." />

        <FiltroConSin label="Cta. Contable" valor={filtros.cuentaContable} presencia={filtros.cuentaContablePresencia}
          onValor={v => set('cuentaContable', v)} onPresencia={v => set('cuentaContablePresencia', v)}
          placeholder="400..." />

        <FiltroConSin label="Cta. Gasto" valor={filtros.cuentaGasto} presencia={filtros.cuentaGastoPresencia}
          onValor={v => set('cuentaGasto', v)} onPresencia={v => set('cuentaGastoPresencia', v)}
          placeholder="62..." />
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
