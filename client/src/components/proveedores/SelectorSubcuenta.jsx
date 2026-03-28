import { useState } from 'react';
import { crearCuentaContable, eliminarCuentaContable } from '../../api.js';

export default function SelectorSubcuenta({ cuentaBase, planContable, onCreada, onSeleccionada, onEliminada, razonSocial }) {
  const [sufijo,     setSufijo]     = useState('');
  const [creando,    setCreando]    = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [errorSub,   setErrorSub]   = useState('');

  if (!cuentaBase) return null;

  const esSubcuenta = cuentaBase.codigo.length > 4;
  const codigoCompleto = cuentaBase.codigo + sufijo;
  const yaExiste = sufijo && planContable.find(c => c.codigo === codigoCompleto);

  async function handleCrear() {
    if (!sufijo || sufijo.length !== 5) return;
    if (yaExiste) { onSeleccionada(yaExiste); setSufijo(''); return; }
    setCreando(true); setErrorSub('');
    try {
      const nueva = await crearCuentaContable({
        codigo:      codigoCompleto,
        descripcion: razonSocial || codigoCompleto,
        grupo:       cuentaBase.codigo.charAt(0),
      });
      onCreada(nueva);
      onSeleccionada(nueva);
      setSufijo('');
    } catch (e) {
      setErrorSub(e.message);
    } finally {
      setCreando(false);
    }
  }

  async function handleEliminar() {
    if (!confirm(`Eliminar subcuenta ${cuentaBase.codigo}?`)) return;
    setEliminando(true); setErrorSub('');
    try {
      await eliminarCuentaContable(cuentaBase.id);
      if (onEliminada) onEliminada();
    } catch (e) { setErrorSub(e.message); }
    finally { setEliminando(false); }
  }

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center gap-2">
        {esSubcuenta ? (
          <>
            <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded">{cuentaBase.codigo}</span>
            <span className="text-xs text-gray-400">({cuentaBase.descripcion})</span>
            <button type="button" onClick={handleEliminar} disabled={eliminando}
              className="px-2 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50">
              {eliminando ? '...' : 'Eliminar subcuenta'}
            </button>
          </>
        ) : (
          <>
            <span className="text-xs text-gray-400">Subcuenta:</span>
            <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded">{cuentaBase.codigo}</span>
            <span className="text-gray-300 text-xs">+</span>
            <input type="text" inputMode="numeric" maxLength={5} value={sufijo}
              onChange={e => { setSufijo(e.target.value.replace(/\D/g, '')); setErrorSub(''); }}
              onKeyDown={e => e.key === 'Enter' && sufijo.length === 5 && handleCrear()}
              placeholder="00001"
              className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {sufijo.length === 5 && (
              <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded">{codigoCompleto}</span>
            )}
            <button type="button" onClick={handleCrear} disabled={sufijo.length !== 5 || creando}
              className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-40 transition-colors">
              {creando ? '...' : yaExiste ? 'Seleccionar' : 'Crear y asignar'}
            </button>
          </>
        )}
      </div>
      {errorSub && <p className="text-xs text-red-500">{errorSub}</p>}
    </div>
  );
}
