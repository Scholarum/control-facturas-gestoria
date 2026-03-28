import ComboboxCuenta from './ComboboxCuenta.jsx';
import SelectorSubcuenta from './SelectorSubcuenta.jsx';

export default function ModalProveedor({ form, setForm, planContable, guardando, onGuardar, onCerrar, esEdicion, errorModal, onCuentaCreada }) {
  const cuentas4 = planContable.filter(c => c.grupo === '4');
  const cuentasImputables = planContable.filter(c => c.grupo !== '4');

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  const cuentaBaseCC = planContable.find(c => String(c.id) === String(form.cuenta_contable_id));
  const cuentaBaseCG = planContable.find(c => String(c.id) === String(form.cuenta_gasto_id));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {errorModal && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{errorModal}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Razon Social <span className="text-red-500">*</span>
              </label>
              <input value={form.razon_social} onChange={e => set('razon_social', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="FACTOR LIBRE S.L." />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Carpeta Drive</label>
              <input value={form.nombre_carpeta} onChange={e => set('nombre_carpeta', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Factor Libre SL" />
              <p className="text-xs text-gray-400 mt-0.5">Nombre exacto de la carpeta en Drive</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CIF / NIF</label>
              <input value={form.cif} onChange={e => set('cif', e.target.value.toUpperCase())}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="B12345678" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cuenta Contable <span className="text-xs font-normal text-gray-400">(Grupo 4 — Proveedores)</span>
              </label>
              <ComboboxCuenta
                cuentas={cuentas4}
                value={form.cuenta_contable_id}
                onChange={v => set('cuenta_contable_id', v)}
                placeholder="Escribe codigo o descripcion..."
              />
              <SelectorSubcuenta
                cuentaBase={cuentaBaseCC}
                planContable={planContable}
                razonSocial={form.razon_social}
                onCreada={onCuentaCreada}
                onSeleccionada={c => set('cuenta_contable_id', String(c.id))}
                onEliminada={() => { set('cuenta_contable_id', ''); onCuentaCreada(null); }}
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cuenta de Gasto <span className="text-xs font-normal text-gray-400">(Activos grupo 2 / Gastos grupo 6)</span>
              </label>
              <ComboboxCuenta
                cuentas={cuentasImputables}
                value={form.cuenta_gasto_id}
                onChange={v => set('cuenta_gasto_id', v)}
                placeholder="Escribe codigo o descripcion..."
              />
              <SelectorSubcuenta
                cuentaBase={cuentaBaseCG}
                planContable={planContable}
                razonSocial={form.razon_social}
                onCreada={onCuentaCreada}
                onSeleccionada={c => set('cuenta_gasto_id', String(c.id))}
                onEliminada={() => { set('cuenta_gasto_id', ''); onCuentaCreada(null); }}
              />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onCerrar}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={onGuardar} disabled={!form.razon_social.trim() || guardando}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear proveedor'}
          </button>
        </div>
      </div>
    </div>
  );
}
