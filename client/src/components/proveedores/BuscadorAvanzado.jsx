const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

const FILTROS_VACIO = {
  razonSocial: '',
  cif: '', cifPresencia: '',
  carpeta: '', carpetaPresencia: '',
  cuentaContable: '', cuentaContablePresencia: '', cuentaContableExacto: false,
  cuentaGasto: '', cuentaGastoPresencia: '', cuentaGastoExacto: false,
};

export { FILTROS_VACIO };

function FiltroConSin({ label, valor, presencia, onCambio, placeholder, mono, exacto, onExacto }) {
  const deshabilitado = presencia === 'sin';
  const tieneExacto = typeof exacto === 'boolean';

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="flex">
        <select value={presencia || ''} onChange={e => onCambio(e.target.value === 'sin' ? '' : valor, e.target.value)}
          className={`rounded-l-lg border border-r-0 border-gray-200 px-1.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 ${
            presencia === 'sin' ? 'text-red-600 font-semibold' : presencia === 'con' ? 'text-emerald-600 font-semibold' : 'text-gray-500'
          }`}>
          <option value="">Todo</option>
          <option value="con">Con</option>
          <option value="sin">Sin</option>
        </select>
        <input value={valor} onChange={e => onCambio(e.target.value, presencia)}
          disabled={deshabilitado} placeholder={deshabilitado ? '—' : placeholder}
          className={`flex-1 min-w-0 ${tieneExacto ? 'border-r-0' : 'rounded-r-lg'} border border-gray-200 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            mono ? 'font-mono' : ''
          } ${deshabilitado ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''}`} />
        {tieneExacto && (
          <button type="button" onClick={() => onExacto(!exacto)} disabled={deshabilitado}
            title={exacto ? 'Busqueda exacta' : 'Busqueda parcial'}
            className={`rounded-r-lg border border-gray-200 px-2 py-1.5 text-[10px] font-bold transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              deshabilitado ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
              : exacto ? 'bg-blue-600 text-white' : 'bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-600'
            }`}>
            =
          </button>
        )}
      </div>
    </div>
  );
}

export default function BuscadorAvanzado({ filtros, onChange }) {
  function set(k, v) { onChange({ ...filtros, [k]: v }); }
  function set2(k1, v1, k2, v2) { onChange({ ...filtros, [k1]: v1, [k2]: v2 }); }
  const hayFiltros = Object.entries(filtros).some(([k, v]) => {
    if (typeof v === 'boolean') return v;
    return v && typeof v === 'string' && v.trim();
  });

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Razon Social</label>
          <input value={filtros.razonSocial} onChange={e => set('razonSocial', e.target.value)}
            placeholder="Buscar..." className={inputCls} />
        </div>

        <FiltroConSin label="CIF / NIF" valor={filtros.cif} presencia={filtros.cifPresencia}
          onCambio={(v, p) => set2('cif', v.toUpperCase(), 'cifPresencia', p)}
          placeholder="B12345678" mono />

        <FiltroConSin label="Carpeta Drive" valor={filtros.carpeta} presencia={filtros.carpetaPresencia}
          onCambio={(v, p) => set2('carpeta', v, 'carpetaPresencia', p)}
          placeholder="Nombre..." />

        <FiltroConSin label="Cta. Contable" valor={filtros.cuentaContable} presencia={filtros.cuentaContablePresencia}
          onCambio={(v, p) => set2('cuentaContable', v, 'cuentaContablePresencia', p)}
          placeholder="400..." exacto={filtros.cuentaContableExacto} onExacto={v => set('cuentaContableExacto', v)} />

        <FiltroConSin label="Cta. Gasto" valor={filtros.cuentaGasto} presencia={filtros.cuentaGastoPresencia}
          onCambio={(v, p) => set2('cuentaGasto', v, 'cuentaGastoPresencia', p)}
          placeholder="62..." exacto={filtros.cuentaGastoExacto} onExacto={v => set('cuentaGastoExacto', v)} />
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
