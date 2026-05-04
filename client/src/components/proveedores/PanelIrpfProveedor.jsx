import { useState } from 'react';
import { editarProveedor } from '../../api.js';
import { IRPF_CLAVES, TOOLTIP_IRPF_PORCENTAJE, tooltipSii } from '../../constants/sii.js';

// Panel expandible "Retencion IRPF" para proveedores. Vive como segundo <tr> de
// la tabla de proveedores cuando la fila esta expandida (ver FilaProveedorEditable
// + Proveedores.jsx). Es el unico sitio de la UI donde se activa/desactiva
// aplica_irpf y se editan los 3 campos restantes (porcentaje, clave, subcuenta).
//
// Concurrencia: el handler guardar() envia el set IRPF entero (4 campos) en cada
// PUT, no parcheo aislado. Razon: parseCamposIrpfBody (backend) exige aplica_irpf
// en el body para tocar IRPF, y si aplica_irpf=true exige los 3 restantes
// informados. Last-write-wins entre pestañas — riesgo aceptado, ver CLAUDE.md.
//
// Sincronizacion con celdas inline: tras guardar, el callback onGuardado actualiza
// el estado del proveedor en el padre y React re-renderiza la fila → las celdas
// inline "IRPF %" y "Cta. IRPF" ven aplica_irpf actualizado y se habilitan o
// deshabilitan automaticamente sin refetch.
export default function PanelIrpfProveedor({ proveedor: p, planContable, onGuardado }) {
  const [aplica, setAplica] = useState(!!p.aplica_irpf);
  const [pct,    setPct]    = useState(p.irpf_porcentaje == null ? '' : String(p.irpf_porcentaje));
  const [clave,  setClave]  = useState(p.irpf_clave == null ? '' : p.irpf_clave);
  const [sub,    setSub]    = useState(p.irpf_subcuenta || '');
  const [guardando, setGuardando] = useState(false);
  const [error,     setError]     = useState('');
  const [exito,     setExito]     = useState('');

  // Mismo filtro que ModalProveedor antes del refactor: prefijo 4751 + activo +
  // codigo > 4 chars (sin la cuenta base sola).
  const cuentas4751 = planContable.filter(c =>
    c.codigo?.startsWith('4751') && c.codigo.length > 4 && c.activo !== false
  );

  const incompleto = aplica && (
    pct === '' || pct == null ||
    clave === '' || clave == null ||
    !sub
  );
  const sinSubcuentas = aplica && cuentas4751.length === 0;

  async function guardar() {
    setGuardando(true); setError(''); setExito('');
    try {
      const datos = {
        aplica_irpf:     aplica,
        irpf_porcentaje: aplica ? Number(pct)   : null,
        irpf_clave:      aplica ? Number(clave) : null,
        irpf_subcuenta:  aplica ? sub           : null,
      };
      const actualizado = await editarProveedor(p.id, datos);
      onGuardado({ id: p.id, ...actualizado });
      setExito('Cambios IRPF guardados');
      setTimeout(() => setExito(''), 2000);
    } catch (e) {
      setError(e.message || 'Error al guardar IRPF');
    } finally {
      setGuardando(false);
    }
  }

  function onToggleAplica(checked) {
    setAplica(checked);
    setError(''); setExito('');
    if (!checked) {
      // Al desmarcar limpiamos los 3 campos. Al guardar con aplica=false el
      // backend forzara los 3 a NULL en BD aunque la UI lleve valores;
      // limpiamos aqui para que el form sea coherente visualmente.
      setPct(''); setClave(''); setSub('');
    }
  }

  return (
    <div className="bg-gray-50 px-6 py-5 border-l-4 border-blue-300">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Retención IRPF</p>
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input
            type="checkbox"
            checked={aplica}
            onChange={e => onToggleAplica(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          Aplica retención IRPF
        </label>
      </div>

      {aplica && (
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={TOOLTIP_IRPF_PORCENTAJE}>
              Porcentaje IRPF <span className="text-red-500">*</span>
            </label>
            <input type="number" min="0" max="100" step="0.01"
              value={pct}
              onChange={e => { setPct(e.target.value); setError(''); setExito(''); }}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="15.00" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(IRPF_CLAVES)}>
              Clave IRPF <span className="text-red-500">*</span>
            </label>
            <input type="number" min="1" max="11" step="1"
              value={clave === '' || clave == null ? '' : clave}
              onChange={e => { setClave(e.target.value === '' ? '' : parseInt(e.target.value, 10)); setError(''); setExito(''); }}
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
                value={sub}
                onChange={e => { setSub(e.target.value); setError(''); setExito(''); }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— selecciona una subcuenta 4751 —</option>
                {cuentas4751.map(c => (
                  <option key={c.id} value={c.codigo}>{c.codigo} — {c.descripcion}</option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-3">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {exito && <span className="text-xs text-emerald-600">{exito}</span>}
        <button
          onClick={guardar}
          disabled={guardando || incompleto || sinSubcuentas}
          title={
            sinSubcuentas ? 'Crea una subcuenta 4751xxx primero' :
            incompleto    ? 'Completa los 3 campos IRPF' : undefined
          }
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {guardando ? 'Guardando…' : 'Guardar cambios IRPF'}
        </button>
      </div>
    </div>
  );
}
