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

// ─── Combobox de cuentas del Plan Contable ────────────────────────────────────

function ComboboxCuenta({ cuentas, value, onChange, placeholder }) {
  const [q,       setQ]       = useState('');
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  const seleccionada = cuentas.find(c => String(c.id) === String(value));

  const filtradas = q.trim()
    ? cuentas.filter(c =>
        c.codigo.startsWith(q.trim()) ||
        c.descripcion.toLowerCase().includes(q.toLowerCase())
      )
    : cuentas;

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function handleFocus() { setQ(''); setAbierto(true); }

  function handleSelect(cuenta) {
    onChange(String(cuenta.id));
    setQ('');
    setAbierto(false);
  }

  const displayValue = seleccionada
    ? `${seleccionada.codigo} — ${seleccionada.descripcion}`
    : '';

  return (
    <div ref={ref} className="relative">
      <input
        value={abierto ? q : displayValue}
        onChange={e => setQ(e.target.value)}
        onFocus={handleFocus}
        placeholder={placeholder || '— Sin asignar —'}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onChange(''); setQ(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-base leading-none"
        >✕</button>
      )}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtradas.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
          ) : (
            filtradas.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => { e.preventDefault(); handleSelect(c); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${String(c.id) === String(value) ? 'bg-blue-50' : ''}`}
              >
                <span className="font-mono font-semibold text-gray-900 w-12 flex-shrink-0">{c.codigo}</span>
                <span className="text-gray-500 text-xs truncate">{c.descripcion}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Modal Edición / Creación ─────────────────────────────────────────────────

function ModalProveedor({ form, setForm, planContable, guardando, onGuardar, onCerrar, esEdicion, errorModal }) {
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
          {errorModal && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{errorModal}</div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Razón Social <span className="text-red-500">*</span>
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
                placeholder="Escribe código o descripción..."
              />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cuenta de Gasto <span className="text-xs font-normal text-gray-400">(Grupo 6 — Gastos)</span>
              </label>
              <ComboboxCuenta
                cuentas={cuentas6}
                value={form.cuenta_gasto_id}
                onChange={v => set('cuenta_gasto_id', v)}
                placeholder="Escribe código o descripción..."
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

// ─── Modal Importar Excel ─────────────────────────────────────────────────────

function ModalImportar({ onImportar, onCerrar, importando }) {
  const [archivo,    setArchivo]    = useState(null);
  const [resultado,  setResultado]  = useState(null);
  const [errorLocal, setErrorLocal] = useState('');
  const inputRef = useRef(null);

  async function handleImportar() {
    if (!archivo) return;
    setErrorLocal('');
    try {
      const res = await onImportar(archivo);
      setResultado(res);
    } catch (e) {
      setErrorLocal(e.message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Importar proveedores desde Excel</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {!resultado ? (
            <>
              <p className="text-sm text-gray-600">
                El archivo debe tener las columnas:<br />
                <span className="font-mono text-xs text-gray-500">
                  Razón Social · Nombre Carpeta · CIF · Código Cuenta Contable · Código Cuenta Gasto
                </span>
              </p>
              <label className={`flex items-center gap-3 cursor-pointer rounded-lg border-2 border-dashed px-4 py-4 transition-colors ${
                archivo ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}>
                {archivo ? (
                  <>
                    <svg className="h-8 w-8 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-blue-700">{archivo.name}</p>
                      <p className="text-xs text-blue-500">{(archivo.size / 1024).toFixed(1)} KB · Clic para cambiar</p>
                    </div>
                  </>
                ) : (
                  <>
                    <svg className="h-8 w-8 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Arrastra o haz clic para seleccionar</p>
                      <p className="text-xs text-gray-400 mt-0.5">Excel (.xlsx, .xls)</p>
                    </div>
                  </>
                )}
                <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => setArchivo(e.target.files[0] || null)} />
              </label>
              {errorLocal && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{errorLocal}</div>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={onCerrar}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={handleImportar} disabled={!archivo || importando}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
                  {importando ? 'Importando...' : 'Importar'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-1">
                <p className="text-sm font-semibold text-emerald-800">Importación completada</p>
                <p className="text-sm text-emerald-700">
                  <span className="font-semibold">{resultado.insertados}</span> nuevos ·{' '}
                  <span className="font-semibold">{resultado.actualizados}</span> actualizados
                </p>
              </div>
              {resultado.errores?.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm font-semibold text-red-700 mb-2">{resultado.errores.length} errores</p>
                  <ul className="text-xs text-red-600 space-y-0.5 max-h-32 overflow-y-auto">
                    {resultado.errores.map((e, i) => (
                      <li key={i}>Fila {e.fila}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onCerrar}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Buscador avanzado ────────────────────────────────────────────────────────

function BuscadorAvanzado({ filtros, onChange }) {
  function set(k, v) { onChange({ ...filtros, [k]: v }); }
  const hayFiltros = Object.values(filtros).some(v => v.trim());

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Razón Social</label>
          <input
            value={filtros.razonSocial}
            onChange={e => set('razonSocial', e.target.value)}
            placeholder="Buscar..."
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">CIF / NIF</label>
          <input
            value={filtros.cif}
            onChange={e => set('cif', e.target.value.toUpperCase())}
            placeholder="B12345678"
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cuenta Contable</label>
          <input
            value={filtros.cuentaContable}
            onChange={e => set('cuentaContable', e.target.value)}
            placeholder="400, proveedor..."
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Cuenta de Gasto</label>
          <input
            value={filtros.cuentaGasto}
            onChange={e => set('cuentaGasto', e.target.value)}
            placeholder="62, servicios..."
            className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>
      {hayFiltros && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-gray-400">Filtros activos</span>
          <button
            onClick={() => onChange({ razonSocial: '', cif: '', cuentaContable: '', cuentaGasto: '' })}
            className="text-xs text-blue-600 hover:underline"
          >
            Limpiar filtros
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Proveedores() {
  const [proveedores,   setProveedores]   = useState([]);
  const [planContable,  setPlanContable]  = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [modal,         setModal]         = useState(null); // null | 'nuevo' | { proveedor }
  const [modalImportar, setModalImportar] = useState(false);
  const [form,          setForm]          = useState(FORM_VACIO);
  const [guardando,     setGuardando]     = useState(false);
  const [importando,    setImportando]    = useState(false);
  const [exportando,    setExportando]    = useState(false);
  const [error,         setError]         = useState('');
  const [errorModal,    setErrorModal]    = useState('');
  const [exito,         setExito]         = useState('');
  const [filtros,       setFiltros]       = useState({ razonSocial: '', cif: '', cuentaContable: '', cuentaGasto: '' });

  useEffect(() => {
    Promise.all([fetchProveedoresCrud(), fetchPlanContable()])
      .then(([p, pc]) => { setProveedores(p); setPlanContable(pc); })
      .catch(() => setError('Error al cargar datos'))
      .finally(() => setLoading(false));
  }, []);

  // Filtrado en tiempo real
  const proveedoresFiltrados = proveedores.filter(p => {
    const { razonSocial, cif, cuentaContable, cuentaGasto } = filtros;
    if (razonSocial && !p.razon_social?.toLowerCase().includes(razonSocial.toLowerCase())) return false;
    if (cif && !p.cif?.toLowerCase().includes(cif.toLowerCase())) return false;
    if (cuentaContable) {
      const hay = (p.cuenta_contable_codigo || '').includes(cuentaContable) ||
                  (p.cuenta_contable_desc   || '').toLowerCase().includes(cuentaContable.toLowerCase());
      if (!hay) return false;
    }
    if (cuentaGasto) {
      const hay = (p.cuenta_gasto_codigo || '').includes(cuentaGasto) ||
                  (p.cuenta_gasto_desc   || '').toLowerCase().includes(cuentaGasto.toLowerCase());
      if (!hay) return false;
    }
    return true;
  });

  function mostrarExito(msg) {
    setExito(msg);
    setTimeout(() => setExito(''), 4000);
  }

  function abrirNuevo() {
    setForm(FORM_VACIO);
    setModal('nuevo');
    setErrorModal('');
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
    setErrorModal('');
  }

  async function guardar() {
    setGuardando(true);
    setErrorModal('');
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
      setErrorModal(e.message);
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

  async function importar(archivo) {
    setImportando(true);
    try {
      const res = await importarProveedoresExcel(archivo);
      const actualizados = await fetchProveedoresCrud();
      setProveedores(actualizados);
      return res;
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

      {/* Buscador avanzado */}
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
              : <p>Ningún proveedor coincide con los filtros aplicados.</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Razón Social', 'Nombre Carpeta', 'CIF', 'Cta. Contable', 'Cta. Gasto', ''].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {proveedoresFiltrados.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.razon_social}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs font-mono">{p.nombre_carpeta || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 font-mono text-xs">{p.cif || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {p.cuenta_contable_codigo
                        ? <span className="inline-flex items-center gap-1">
                            <span className="font-mono font-semibold text-gray-800">{p.cuenta_contable_codigo}</span>
                            <span className="text-gray-400">— {p.cuenta_contable_desc}</span>
                          </span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs">
                      {p.cuenta_gasto_codigo
                        ? <span className="inline-flex items-center gap-1">
                            <span className="font-mono font-semibold text-gray-800">{p.cuenta_gasto_codigo}</span>
                            <span className="text-gray-400">— {p.cuenta_gasto_desc}</span>
                          </span>
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

      {/* Modales */}
      {modal && (
        <ModalProveedor
          form={form}
          setForm={setForm}
          planContable={planContable}
          guardando={guardando}
          onGuardar={guardar}
          onCerrar={() => { setModal(null); setErrorModal(''); }}
          esEdicion={modal !== 'nuevo'}
          errorModal={errorModal}
        />
      )}

      {modalImportar && (
        <ModalImportar
          onImportar={importar}
          onCerrar={() => setModalImportar(false)}
          importando={importando}
        />
      )}
    </div>
  );
}
