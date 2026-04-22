import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import {
  fetchProveedoresCrud, fetchPlanContable,
  crearProveedor, editarProveedor, eliminarProveedor,
  descargarExcelProveedores, importarProveedoresExcel,
} from '../api.js';
import BuscadorAvanzado, { FILTROS_VACIO } from '../components/proveedores/BuscadorAvanzado.jsx';
import FilaProveedorEditable from '../components/proveedores/FilaProveedorEditable.jsx';
import ModalProveedor from '../components/proveedores/ModalProveedor.jsx';
import ModalImportar from '../components/proveedores/ModalImportar.jsx';

const FORM_VACIO = {
  razon_social: '', nombre_carpeta: '', cif: '',
  cuenta_contable_id: '', cuenta_gasto_id: '',
  sii_tipo_clave: 1, sii_tipo_fact: 1,
};

export default function Proveedores() {
  const { empresaActiva } = useAuth();
  const [proveedores,   setProveedores]   = useState([]);
  const [planContable,  setPlanContable]  = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [modal,         setModal]         = useState(null);
  const [modalImportar, setModalImportar] = useState(false);
  const [form,          setForm]          = useState(FORM_VACIO);
  const [guardando,     setGuardando]     = useState(false);
  const [importando,    setImportando]    = useState(false);
  const [exportando,    setExportando]    = useState(false);
  const [error,         setError]         = useState('');
  const [errorModal,    setErrorModal]    = useState('');
  const [exito,         setExito]         = useState('');
  const [filtros,       setFiltros]       = useState({ ...FILTROS_VACIO });

  useEffect(() => {
    if (!empresaActiva) return;
    setLoading(true);
    Promise.all([fetchProveedoresCrud(empresaActiva.id), fetchPlanContable(empresaActiva.id)])
      .then(([p, pc]) => { setProveedores(p); setPlanContable(pc); })
      .catch(() => setError('Error al cargar datos'))
      .finally(() => setLoading(false));
  }, [empresaActiva]);

  const proveedoresFiltrados = proveedores.filter(p => {
    const f = filtros;
    const tiene = v => !!(v && v.trim());
    if (f.razonSocial && !p.razon_social?.toLowerCase().includes(f.razonSocial.toLowerCase())) return false;
    // CIF
    if (f.cifPresencia === 'con' && !tiene(p.cif)) return false;
    if (f.cifPresencia === 'sin' && tiene(p.cif))  return false;
    if (f.cif && !p.cif?.toLowerCase().includes(f.cif.toLowerCase())) return false;
    // Carpeta Drive
    if (f.carpetaPresencia === 'con' && !tiene(p.nombre_carpeta)) return false;
    if (f.carpetaPresencia === 'sin' && tiene(p.nombre_carpeta))  return false;
    if (f.carpeta && !p.nombre_carpeta?.toLowerCase().includes(f.carpeta.toLowerCase())) return false;
    // Cuenta Contable
    if (f.cuentaContablePresencia === 'con' && !tiene(p.cuenta_contable_codigo)) return false;
    if (f.cuentaContablePresencia === 'sin' && tiene(p.cuenta_contable_codigo))  return false;
    if (f.cuentaContable) {
      if (f.cuentaContableExacto) {
        if (p.cuenta_contable_codigo !== f.cuentaContable) return false;
      } else {
        const hay = (p.cuenta_contable_codigo || '').includes(f.cuentaContable) ||
                    (p.cuenta_contable_desc   || '').toLowerCase().includes(f.cuentaContable.toLowerCase());
        if (!hay) return false;
      }
    }
    // Cuenta de Gasto
    if (f.cuentaGastoPresencia === 'con' && !tiene(p.cuenta_gasto_codigo)) return false;
    if (f.cuentaGastoPresencia === 'sin' && tiene(p.cuenta_gasto_codigo))  return false;
    if (f.cuentaGasto) {
      if (f.cuentaGastoExacto) {
        if (p.cuenta_gasto_codigo !== f.cuentaGasto) return false;
      } else {
        const hay = (p.cuenta_gasto_codigo || '').includes(f.cuentaGasto) ||
                    (p.cuenta_gasto_desc   || '').toLowerCase().includes(f.cuentaGasto.toLowerCase());
        if (!hay) return false;
      }
    }
    return true;
  });

  function mostrarExito(msg) { setExito(msg); setTimeout(() => setExito(''), 4000); }

  function abrirNuevo() { setForm(FORM_VACIO); setModal('nuevo'); setErrorModal(''); }

  function abrirEditar(p) {
    setForm({
      razon_social:       p.razon_social       || '',
      nombre_carpeta:     p.nombre_carpeta     || '',
      cif:                p.cif                || '',
      cuenta_contable_id: p.cuenta_contable_id ? String(p.cuenta_contable_id) : '',
      cuenta_gasto_id:    p.cuenta_gasto_id    ? String(p.cuenta_gasto_id)    : '',
      sii_tipo_clave:     p.sii_tipo_clave ?? 1,
      sii_tipo_fact:      p.sii_tipo_fact  ?? 1,
    });
    setModal({ proveedor: p });
    setErrorModal('');
  }

  async function guardar() {
    setGuardando(true); setErrorModal('');
    try {
      const datos = {
        razon_social:       form.razon_social.trim(),
        nombre_carpeta:     form.nombre_carpeta.trim() || null,
        cif:                form.cif.trim() || null,
        cuenta_contable_id: form.cuenta_contable_id ? parseInt(form.cuenta_contable_id) : null,
        cuenta_gasto_id:    form.cuenta_gasto_id    ? parseInt(form.cuenta_gasto_id)    : null,
        sii_tipo_clave:     form.sii_tipo_clave === '' ? undefined : form.sii_tipo_clave,
        sii_tipo_fact:      form.sii_tipo_fact  === '' ? undefined : form.sii_tipo_fact,
        empresa_id:         empresaActiva?.id || null,
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
    } catch (e) { setErrorModal(e.message); }
    finally { setGuardando(false); }
  }

  async function eliminar(p) {
    if (!confirm(`¿Eliminar el proveedor "${p.razon_social}"?`)) return;
    try {
      await eliminarProveedor(p.id);
      setProveedores(prev => prev.filter(x => x.id !== p.id));
      mostrarExito('Proveedor eliminado');
    } catch (e) { setError(e.message); }
  }

  async function exportar() {
    setExportando(true);
    try { await descargarExcelProveedores(); }
    catch (e) { setError(e.message); }
    finally { setExportando(false); }
  }

  async function importar(archivo) {
    setImportando(true);
    try {
      const res = await importarProveedoresExcel(archivo, empresaActiva?.id);
      setProveedores(await fetchProveedoresCrud(empresaActiva?.id));
      return res;
    } finally { setImportando(false); }
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
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-base font-semibold text-gray-900">Proveedores</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setModalImportar(true)} disabled={importando}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
            </svg>
            {importando ? 'Importando...' : 'Importar Excel'}
          </button>
          <button onClick={exportar} disabled={exportando || !proveedores.length}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
            </svg>
            {exportando ? 'Exportando...' : 'Exportar Excel'}
          </button>
          <button onClick={abrirNuevo}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            + Nuevo proveedor
          </button>
        </div>
      </div>

      {/* Mensajes */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}
      {exito && (
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">{exito}</div>
      )}

      <BuscadorAvanzado filtros={filtros} onChange={setFiltros} />

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
          <span className="text-sm text-gray-500">
            {proveedoresFiltrados.length !== proveedores.length
              ? `${proveedoresFiltrados.length} de ${proveedores.length} proveedor${proveedores.length !== 1 ? 'es' : ''}`
              : `${proveedores.length} proveedor${proveedores.length !== 1 ? 'es' : ''}`}
          </span>
          <span className="text-xs text-gray-400">El nombre de carpeta debe coincidir exactamente con Drive</span>
        </div>
        {proveedoresFiltrados.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            {proveedores.length === 0
              ? <><p>No hay proveedores registrados.</p><p className="mt-1">Crea el primero o importa desde Excel.</p></>
              : <p>Ningun proveedor coincide con los filtros aplicados.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Razon Social', 'Nombre Carpeta', 'CIF', 'Cta. Contable', 'Cta. Gasto', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proveedoresFiltrados.map(p => (
                  <FilaProveedorEditable
                    key={p.id}
                    proveedor={p}
                    planContable={planContable}
                    empresaId={empresaActiva?.id}
                    onGuardado={async () => { setProveedores(await fetchProveedoresCrud(empresaActiva?.id)); }}
                    onEliminar={() => eliminar(p)}
                    onCuentaCreada={nueva => {
                      if (nueva) setPlanContable(prev => [...prev, nueva].sort((a, b) => a.codigo.localeCompare(b.codigo)));
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modales */}
      {modal && (
        <ModalProveedor
          form={form} setForm={setForm} planContable={planContable}
          guardando={guardando} onGuardar={guardar}
          onCerrar={() => { setModal(null); setErrorModal(''); }}
          esEdicion={modal !== 'nuevo'} errorModal={errorModal}
          onCuentaCreada={nueva => {
            if (nueva) setPlanContable(prev => [...prev, nueva].sort((a, b) => a.codigo.localeCompare(b.codigo)));
            else fetchPlanContable(empresaActiva?.id).then(setPlanContable).catch(() => {});
          }}
        />
      )}
      {modalImportar && (
        <ModalImportar onImportar={importar} onCerrar={() => setModalImportar(false)} importando={importando} />
      )}
    </div>
  );
}
