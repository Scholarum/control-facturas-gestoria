import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { fetchPlanContable, editarCuentaContable, eliminarCuentaContable, fetchProveedoresCuenta } from '../../api.js';
import { Spinner } from './helpers.jsx';

export default function PanelCuentasGasto() {
  const { empresaActiva } = useAuth();

  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  // Edicion inline
  const [editandoId,    setEditandoId]    = useState(null);
  const [editDesc,      setEditDesc]      = useState('');
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [errorEdit,     setErrorEdit]     = useState('');

  // Proveedores expandidos
  const [provExpand,  setProvExpand]  = useState({});
  const [provData,    setProvData]    = useState({});
  const [provLoading, setProvLoading] = useState({});

  const cargar = useCallback(async () => {
    if (!empresaActiva) return;
    setLoading(true); setError(null);
    try {
      const todas = await fetchPlanContable(empresaActiva.id);
      setCuentas(todas.filter(c => c.grupo !== '4'));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [empresaActiva]);

  useEffect(() => { cargar(); }, [cargar]);

  function iniciarEdicion(c) {
    setEditandoId(c.id);
    setEditDesc(c.descripcion);
    setErrorEdit('');
  }

  async function guardarEdicion(id) {
    if (!editDesc.trim()) { setErrorEdit('La descripcion no puede estar vacia'); return; }
    setGuardandoEdit(true); setErrorEdit('');
    try {
      await editarCuentaContable(id, { descripcion: editDesc.trim() });
      setEditandoId(null);
      await cargar();
    } catch (e) {
      setErrorEdit(e.message);
    } finally {
      setGuardandoEdit(false);
    }
  }

  async function handleEliminar(c) {
    if (!confirm(`¿Eliminar la cuenta ${c.codigo} — ${c.descripcion}?\nEsta operacion no se puede deshacer.`)) return;
    try {
      await eliminarCuentaContable(c.id);
      await cargar();
    } catch (e) {
      alert(e.message);
    }
  }

  async function toggleProveedores(id) {
    if (provExpand[id]) {
      setProvExpand(p => ({ ...p, [id]: false }));
      return;
    }
    setProvExpand(p => ({ ...p, [id]: true }));
    if (provData[id] !== undefined) return;
    setProvLoading(p => ({ ...p, [id]: true }));
    try {
      const data = await fetchProveedoresCuenta(id);
      setProvData(p => ({ ...p, [id]: data }));
    } catch {
      setProvData(p => ({ ...p, [id]: [] }));
    } finally {
      setProvLoading(p => ({ ...p, [id]: false }));
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Cuentas de Gasto</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Subcuentas de gastos (grupos 2 y 6) utilizadas para clasificar facturas.
        </p>
      </div>

      {loading && (
        <div className="flex justify-center py-10"><Spinner /></div>
      )}

      {error && (
        <div className="px-5 py-4 text-sm text-red-700 bg-red-50">
          Error al cargar: {error}
          <button onClick={cargar} className="ml-3 underline text-xs">Reintentar</button>
        </div>
      )}

      {!loading && !error && cuentas.length === 0 && (
        <div className="px-5 py-10 text-center text-sm text-gray-400">
          No hay cuentas de gasto creadas todavia. Creala desde el menu de Proveedores al asignar una cuenta de gasto.
        </div>
      )}

      {!loading && !error && cuentas.length > 0 && (
        <div className="divide-y divide-gray-100">
          {cuentas.map(c => (
            <div key={c.id}>
              <div className="px-5 py-3 flex items-center gap-3">
                <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-1 rounded w-28 flex-shrink-0">
                  {c.codigo}
                </span>

                {editandoId === c.id ? (
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <input
                      autoFocus
                      value={editDesc}
                      onChange={e => { setEditDesc(e.target.value); setErrorEdit(''); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') guardarEdicion(c.id);
                        if (e.key === 'Escape') setEditandoId(null);
                      }}
                      className="flex-1 rounded-lg border border-blue-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-0"
                    />
                    <button onClick={() => guardarEdicion(c.id)} disabled={guardandoEdit}
                      className="px-2 py-1 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 flex-shrink-0">
                      {guardandoEdit ? '...' : 'Guardar'}
                    </button>
                    <button onClick={() => setEditandoId(null)}
                      className="px-2 py-1 text-xs text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg flex-shrink-0">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <span className="flex-1 text-sm text-gray-700 truncate">{c.descripcion}</span>
                )}

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => toggleProveedores(c.id)}
                    className="px-2 py-1 text-xs text-gray-500 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200">
                    {provExpand[c.id] ? 'Ocultar' : 'Proveedores'}
                  </button>
                  {editandoId !== c.id && (
                    <button onClick={() => iniciarEdicion(c)}
                      className="px-2 py-1 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors border border-blue-200">
                      Editar
                    </button>
                  )}
                  <button onClick={() => handleEliminar(c)}
                    className="px-2 py-1 text-xs text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors border border-red-200">
                    Borrar
                  </button>
                </div>
              </div>

              {errorEdit && editandoId === c.id && (
                <p className="px-5 pb-2 text-xs text-red-500">{errorEdit}</p>
              )}

              {/* Panel proveedores asignados */}
              {provExpand[c.id] && (
                <div className="px-5 pb-3 bg-gray-50 border-t border-gray-100">
                  {provLoading[c.id] ? (
                    <div className="flex justify-center py-4"><Spinner className="h-4 w-4" /></div>
                  ) : provData[c.id]?.length === 0 ? (
                    <p className="text-xs text-gray-400 py-3">Ningun proveedor asignado a esta cuenta.</p>
                  ) : (
                    <table className="w-full text-xs mt-2">
                      <thead>
                        <tr className="text-gray-400 uppercase text-[10px] tracking-wide">
                          <th className="text-left py-1 pr-3 font-medium">Proveedor</th>
                          <th className="text-left py-1 pr-3 font-medium">CIF</th>
                          <th className="text-left py-1 font-medium">Empresa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {(provData[c.id] || []).map(p => (
                          <tr key={`${p.id}-${p.empresa_id}`}>
                            <td className="py-1.5 pr-3 text-gray-700 font-medium">
                              {p.razon_social}
                              {p.nombre_carpeta && p.nombre_carpeta !== p.razon_social && (
                                <span className="text-gray-400 font-normal ml-1">({p.nombre_carpeta})</span>
                              )}
                            </td>
                            <td className="py-1.5 pr-3 text-gray-500 font-mono">{p.cif || '—'}</td>
                            <td className="py-1.5 text-gray-500">{p.empresa_nombre || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
