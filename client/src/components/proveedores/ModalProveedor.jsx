import ComboboxCuenta from './ComboboxCuenta.jsx';
import SelectorSubcuenta from './SelectorSubcuenta.jsx';
import { SII_CLAVE, SII_TIPO_FACT, SII_TIPO_EXENCI, SII_TIPO_NO_SUJE, SII_TIPO_RECTIF, SII_ENTR_PREST, IRPF_CLAVES, TOOLTIP_IRPF_PORCENTAJE, tooltipSii } from '../../constants/sii.js';

export default function ModalProveedor({ form, setForm, planContable, guardando, onGuardar, onCerrar, esEdicion, errorModal, onCuentaCreada }) {
  const cuentas4 = planContable.filter(c => c.grupo === '4');
  const cuentasImputables = planContable.filter(c => c.grupo !== '4');
  // Subcuentas 4751xxx (HP retenciones practicadas) para el dropdown IRPF.
  // planContable ya viene filtrado por empresaActiva en Proveedores.jsx; aqui
  // sumamos filtro por activo y por prefijo. No incluimos la cuenta base 4751
  // sola — solo subcuentas con codigo > 4 chars.
  const cuentas4751 = planContable.filter(c =>
    c.codigo?.startsWith('4751') && c.codigo.length > 4 && c.activo !== false
  );

  const irpfIncompleto = form.aplica_irpf && (
    form.irpf_porcentaje === '' || form.irpf_porcentaje == null ||
    form.irpf_clave      === '' || form.irpf_clave      == null ||
    !form.irpf_subcuenta
  );

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  const cuentaBaseCC = planContable.find(c => String(c.id) === String(form.cuenta_contable_id));
  const cuentaBaseCG = planContable.find(c => String(c.id) === String(form.cuenta_gasto_id));

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[calc(100%-2rem)] sm:max-w-lg">
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
            <div className="col-span-2 border-t border-gray-100 pt-4 mt-1">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Datos SII / Libro de IVA</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_CLAVE)}>Clave régimen SII</label>
                  <input type="number" min="0" step="1"
                    value={form.sii_tipo_clave ?? ''}
                    onChange={e => set('sii_tipo_clave', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_FACT)}>Tipo factura SII</label>
                  <input type="number" min="0" step="1"
                    value={form.sii_tipo_fact ?? ''}
                    onChange={e => set('sii_tipo_fact', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_EXENCI)}>Tipo exención</label>
                  <input type="number" min="0" step="1"
                    value={form.sii_tipo_exenci ?? ''}
                    onChange={e => set('sii_tipo_exenci', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="1" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_NO_SUJE)}>Tipo no sujeta</label>
                  <input type="number" min="0" step="1"
                    value={form.sii_tipo_no_suje ?? ''}
                    onChange={e => set('sii_tipo_no_suje', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_RECTIF)}>Tipo rectificativa</label>
                  <input type="number" min="0" step="1"
                    value={form.sii_tipo_rectif ?? ''}
                    onChange={e => set('sii_tipo_rectif', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="2" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_ENTR_PREST)}>Entrega / Prestación</label>
                  <input type="number" min="0" step="1"
                    value={form.sii_entr_prest ?? ''}
                    onChange={e => set('sii_entr_prest', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="3" />
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Valores estándar 1/1/1/2/2/3 (régimen general + F1 + no exenta + S1 sujeta-no exenta + por diferencias + prestación servicios).
                Sólo tocar en casos especiales (intracomunitarias, importaciones, inversión del sujeto pasivo, exenciones art. 20-25, rectificativas, etc.).
                Pasa el ratón sobre cada etiqueta para ver los valores válidos.
              </p>
            </div>
            <div className="col-span-2 border-t border-gray-100 pt-4 mt-1">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Retención IRPF</p>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!form.aplica_irpf}
                    onChange={e => setForm(prev => ({
                      ...prev,
                      aplica_irpf: e.target.checked,
                      // Al desmarcar limpiamos los 3 restantes para que el body sea coherente.
                      // Al marcar dejamos los valores anteriores (si los habia) para no obligar a teclear.
                      ...(e.target.checked ? {} : { irpf_porcentaje: '', irpf_clave: '', irpf_subcuenta: '' }),
                    }))}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Aplica retención IRPF
                </label>
              </div>
              {form.aplica_irpf && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={TOOLTIP_IRPF_PORCENTAJE}>
                        Porcentaje IRPF <span className="text-red-500">*</span>
                      </label>
                      <input type="number" min="0" max="100" step="0.01"
                        value={form.irpf_porcentaje}
                        onChange={e => set('irpf_porcentaje', e.target.value)}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="15.00" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(IRPF_CLAVES)}>
                        Clave IRPF <span className="text-red-500">*</span>
                      </label>
                      <input type="number" min="1" max="11" step="1"
                        value={form.irpf_clave === '' || form.irpf_clave == null ? '' : form.irpf_clave}
                        onChange={e => set('irpf_clave', e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="1" />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Subcuenta retención <span className="text-red-500">*</span>
                      </label>
                      {cuentas4751.length === 0 ? (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                          No hay subcuentas <span className="font-mono">4751xxx</span> en el plan contable de esta empresa. Crea al menos una en la pestaña Plan Contable o vía importación Excel antes de marcar este proveedor con IRPF.
                        </div>
                      ) : (
                        <select
                          value={form.irpf_subcuenta || ''}
                          onChange={e => set('irpf_subcuenta', e.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500">
                          <option value="">— selecciona una subcuenta 4751 —</option>
                          {cuentas4751.map(c => (
                            <option key={c.id} value={c.codigo}>{c.codigo} — {c.descripcion}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Las facturas de este proveedor llevarán retención IRPF al exportarse a SAGE: el asiento añade una línea adicional en la subcuenta seleccionada.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onCerrar}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancelar
          </button>
          <button onClick={onGuardar} disabled={!form.razon_social.trim() || guardando || irpfIncompleto}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
            {guardando ? 'Guardando...' : esEdicion ? 'Guardar cambios' : 'Crear proveedor'}
          </button>
        </div>
      </div>
    </div>
  );
}
