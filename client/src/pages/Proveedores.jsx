import { useState, useEffect, useRef } from 'react';
import {
  fetchProveedoresCrud, fetchPlanContable,
  crearProveedor, editarProveedor, eliminarProveedor,
  descargarExcelProveedores, importarProveedoresExcel,
} from '../api.js';

const FORM_VACIO = {
  razon_social: '', nombre_carpeta: '', cif: '',
  cuenta_contable_id: '', cuenta_gasto_id: '',
};

function ModalProveedor({ form, setForm, planContable, guardando, onGuardar, onCerrar, esEdicion }) {
  const cuentas4 = planContable.filter(c => c.grupo === '4');
  const cuentas6 = planContable.filter(c => c.grupo === '6');

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{esEdicion ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Razón Social <span className="text-red-500">*</span></label>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta Contable (Grupo 4)</label>
              <select value={form.cuenta_contable_id} onChange={e => set('cuenta_contable_id', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Sin asignar —</option>
                {cuentas4.map(c => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.descripcion}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Cuenta de Gasto (Grupo 6)</label>
              <select value={form.cuenta_gasto_id} onChange={e => set('cuenta_gasto_id', e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Sin asignar —</option>
                {cuentas6.map(c => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.descripcion}</option>
                ))}
              </select>
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

export default function Proveedores() {
  const [proveedores,   setProveedores]   = useState([]);
  const [planContable,  setPlanContable]  = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [modal,         setModal]         = useState(null); // null | 'nuevo' | { proveedor }
  const [form,          setForm]          = useState(FORM_VACIO);
  const [guardando,     setGuardando]     = useState(false);
  const [error,         setError]         = useState('');
  const [exito,         setExito]         = useState('');
  const [importando,    setImportando]    = useState(false);
  const [exportando,    setExportando]    = useState(false);
  const inputFileRef = useRef(null);

  useEffect(() => {
    Promise.all([fetchProveedoresCrud(), fetchPlanContable()])
      .then(([p, pc]) => { setProveedores(p); setPlanContable(pc); })
      .catch(() => setError('Error al cargar datos'))
      .finally(() => setLoading(false));
  }, []);

  function mostrarExito(msg) {
    setExito(msg);
    setTimeout(() => setExito(''), 4000);
  }

  function abrirNuevo() {
    setForm(FORM_VACIO);
    setModal('nuevo');
    setError('');
  }

  function abrirEditar(p) {
    setForm({
      razon_social:       p.razon_social       || '',
      nombre_carpeta:     p.nombre_carpeta     || '',
      cif:                p.cif                || '',
      cuenta_contable_id: p.cuenta_contable_id ? String(p.cuenta_contable_id) : '',
      cuenta_gasto_id:    p.cuenta_gasto_id    ? String(p.cuenta_gasto_id)    : '',
    });
    setModal({ proveedor: p });
    setError('');
  }

  async function guardar() {
    setGuardando(true);
    setError('');
    try {
      const datos = {
        razon_social:       form.razon_social.trim(),
        nombre_carpeta:     form.nombre_carpeta.trim() || null,
        cif:                form.cif.trim() || null,
        cuenta_contable_id: form.cuenta_contable_id ? parseInt(form.cuenta_contable_id) : null,
        cuenta_gasto_id:    form.cuenta_gasto_id    ? parseInt(form.cuenta_gasto_id)    : null,
      };
      if (modal === 'nuevo') {
        const nuevo = await crearProveedor(datos);
        setProveedores(prev => [...prev, nuevo].sort((a, b) => a.razon_social.localeCompare(b.razon_social)));
        mostrarExito('Proveedor creado correctamente');
      } else {
        const actualizado = await editarProveedor(modal.proveedor.id, datos);
        setProveedores(prev => prev.map(p => p.id === actualizado.id ? actualizado : p));
        mostrarExito('Proveedor actualizado correctamente');
      }
      setModal(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar(p) {
    if (!confirm(`¿Eliminar el proveedor "${p.razon_social}"?`)) return;
    try {
      await eliminarProveedor(p.id);
      setProveedores(prev => prev.filter(x => x.id !== p.id));
      mostrarExito('Proveedor eliminado');
    } catch (e) {
      setError(e.message);
    }
  }

  async function exportar() {
    setExportando(true);
    try { await descargarExcelProveedores(); }
    catch (e) { setError(e.message); }
    finally { setExportando(false); }
  }

  async function importar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setImportando(true);
    setError('');
    try {
      const res = await importarProveedoresExcel(file);
      mostrarExito(`Importación completada: ${res.insertados} nuevos, ${res.actualizados} actualizados${res.errores.length ? `, ${res.errores.length} errores` : ''}`);
      const actualizados = await fetchProveedoresCrud();
      setProveedores(actualizados);
    } catch (e) {
      setError(e.message);
    } finally {
      setImportando(false);
    }
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <svg className="h-8 w-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
      </svg>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-gray-900">Proveedores</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={inputFileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importar} />
          <button onClick={() => inputFileRef.current?.click()} disabled={importando}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
            {importando ? 'Importando...' : 'Importar Excel'}
          </button>
          <button onClick={exportar} disabled={exportando || !proveedores.length}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50">
            {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            + Nuevo proveedor
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}
      {exito && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">
          {exito}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm text-gray-500">{proveedores.length} proveedor{proveedores.length !== 1 ? 'es' : ''}</span>
          <span className="text-xs text-gray-400">El nombre de carpeta debe coincidir exactamente con la carpeta en Drive</span>
        </div>
        {proveedores.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            <p>No hay proveedores registrados.</p>
            <p className="mt-1">Crea el primero o importa desde Excel.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Razón Social','Nombre Carpeta','CIF','Cta. Contable','Cta. Gasto',''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proveedores.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.razon_social}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{p.nombre_carpeta || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.cif || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {p.cuenta_contable_codigo
                        ? <span className="inline-flex items-center gap-1"><span className="font-mono font-semibold">{p.cuenta_contable_codigo}</span><span className="text-gray-400">— {p.cuenta_contable_desc}</span></span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {p.cuenta_gasto_codigo
                        ? <span className="inline-flex items-center gap-1"><span className="font-mono font-semibold">{p.cuenta_gasto_codigo}</span><span className="text-gray-400">— {p.cuenta_gasto_desc}</span></span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => abrirEditar(p)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">
                          Editar
                        </button>
                        <button onClick={() => eliminar(p)}
                          className="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modal && (
        <ModalProveedor
          form={form}
          setForm={setForm}
          planContable={planContable}
          guardando={guardando}
          onGuardar={guardar}
          onCerrar={() => { setModal(null); setError(''); }}
          esEdicion={modal !== 'nuevo'}
        />
      )}
    </div>
  );
}
