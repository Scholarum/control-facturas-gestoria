import { useState } from 'react';
import { crearCuentaContable, eliminarCuentaContable } from '../../api.js';

export default function SelectorSubcuenta({ cuentaBase, planContable, onCreada, onSeleccionada, onEliminada, razonSocial }) {
  const [sufijo,      setSufijo]      = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [creando,     setCreando]     = useState(false);
  const [eliminando,  setEliminando]  = useState(false);
  const [errorSub,    setErrorSub]    = useState('');

  if (!cuentaBase) return null;

  const esGasto       = cuentaBase.grupo !== '4';
  const esSubcuenta   = cuentaBase.codigo.length > 3;
  const codigoCompleto = cuentaBase.codigo + sufijo;
  const yaExiste      = sufijo && planContable.find(c => c.codigo === codigoCompleto);
  const puedeCrear    = sufijo.length === 5 && (!esGasto || descripcion.trim());

  async function handleCrear() {
    if (!sufijo || sufijo.length !== 5) return;
    if (yaExiste) { onSeleccionada(yaExiste); setSufijo(''); setDescripcion(''); return; }
    if (esGasto && !descripcion.trim()) return;
    setCreando(true); setErrorSub('');
    try {
      const descFinal = esGasto ? descripcion.trim() : (razonSocial || codigoCompleto);
      const nueva = await crearCuentaContable({
        codigo:      codigoCompleto,
        descripcion: descFinal,
        grupo:       cuentaBase.codigo.charAt(0),
      });
      onCreada(nueva);
      onSeleccionada(nueva);
      setSufijo(''); setDescripcion('');
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
      <div className="flex items-center gap-2 flex-wrap">
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
              onKeyDown={e => e.key === 'Enter' && puedeCrear && handleCrear()}
              placeholder="00001"
              className="w-20 rounded-lg border border-gray-200 px-2 py-1.5 text-sm font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {sufijo.length === 5 && (
              <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-1 rounded">{codigoCompleto}</span>
            )}
          </>
        )}
      </div>
      {/* Campo descripcion obligatorio para cuentas de gasto */}
      {esGasto && !esSubcuenta && sufijo.length === 5 && !yaExiste && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={descripcion}
            onChange={e => { setDescripcion(e.target.value); setErrorSub(''); }}
            onKeyDown={e => e.key === 'Enter' && puedeCrear && handleCrear()}
            placeholder="Descripcion de la cuenta de gasto *"
            className="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
      {!esSubcuenta && sufijo.length === 5 && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={handleCrear} disabled={!puedeCrear || creando}
            className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg disabled:opacity-40 transition-colors">
            {creando ? '...' : yaExiste ? 'Seleccionar' : 'Crear y asignar'}
          </button>
          {esGasto && !yaExiste && !descripcion.trim() && (
            <span className="text-xs text-amber-600">Debes introducir una descripcion</span>
          )}
        </div>
      )}
      {errorSub && <p className="text-xs text-red-500">{errorSub}</p>}
    </div>
  );
}
