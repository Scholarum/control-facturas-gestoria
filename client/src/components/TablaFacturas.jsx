import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BadgeGestion, BadgeExtraccion } from './Badge.jsx';
import { fetchPreviewFactura, editarDatosFactura, asignarCuentaContableProveedor, crearProveedorRapido, crearCuentaContable, eliminarCuentaContable } from '../api.js';

// Campos obligatorios para considerar una factura sin incidencia
const CAMPOS_OBLIGATORIOS = [
  'numero_factura', 'fecha_emision', 'nombre_emisor', 'cif_emisor',
  'nombre_receptor', 'cif_receptor', 'total_factura',
];

export function detectarIncidencia(datos) {
  if (!datos) return CAMPOS_OBLIGATORIOS.slice(); // todos faltan
  const faltantes = CAMPOS_OBLIGATORIOS.filter(c => datos[c] == null || datos[c] === '');
  // IVA: al menos un desglose con base
  const iva = Array.isArray(datos.iva) ? datos.iva : [];
  if (!iva.some(e => e.base > 0 || e.cuota > 0)) faltantes.push('iva');
  return faltantes;
}

export function tieneIncidencia(f) {
  return detectarIncidencia(f.datos_extraidos).length > 0;
}

// Sin proveedor vinculado o proveedor sin cuenta contable
export function tieneIncidenciaProveedor(f) {
  if (!f.proveedor_id) return 'SIN_PROVEEDOR';
  if (!f.cta_proveedor_codigo) return 'SIN_CUENTA_CONTABLE';
  return null;
}

function fmtEuro(n, { showZero = false } = {}) {
  if (n == null || n === '') return '—';
  if (n === 0 && !showZero) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function fmtEuroIva(n) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function Th({ children, className = '' }) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${className}`}>
      {children}
    </th>
  );
}

// ─── Combobox de cuentas del Plan Contable ────────────────────────────────────

function ComboboxCuenta({ cuentas, value, onChange, disabled }) {
  const [q,       setQ]       = useState('');
  const [abierto, setAbierto] = useState(false);
  const [pos,     setPos]     = useState({ top: 0, left: 0, width: 0 });
  const ref      = useRef(null);
  const inputRef = useRef(null);

  const seleccionada = cuentas.find(c => String(c.id) === String(value));
  const filtradas = q.trim()
    ? cuentas.filter(c =>
        c.codigo.startsWith(q.trim()) ||
        c.descripcion.toLowerCase().includes(q.toLowerCase())
      )
    : cuentas;

  const calcPos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const dropdownH = 180; // max-h-44 ≈ 176px
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < dropdownH && rect.top > dropdownH;
    setPos({
      left:  rect.left,
      width: Math.max(rect.width, 288), // w-72 = 18rem = 288px
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4, top: undefined }
        : { top: rect.bottom + 4, bottom: undefined }),
    });
  }, []);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target) &&
          !e.target.closest('[data-combobox-portal]')) setAbierto(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!abierto) return;
    calcPos();
    window.addEventListener('scroll', calcPos, true);
    window.addEventListener('resize', calcPos);
    return () => {
      window.removeEventListener('scroll', calcPos, true);
      window.removeEventListener('resize', calcPos);
    };
  }, [abierto, calcPos]);

  const displayValue = seleccionada
    ? `${seleccionada.codigo} — ${seleccionada.descripcion}`
    : '';

  if (disabled) {
    return (
      <span className="text-xs text-gray-600">
        {displayValue || <span className="text-gray-400 italic">Sin cuenta asignada</span>}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative" onClick={e => e.stopPropagation()}>
      <input
        ref={inputRef}
        value={abierto ? q : displayValue}
        onChange={e => setQ(e.target.value)}
        onFocus={() => { setQ(''); setAbierto(true); }}
        placeholder="Sin Cta. Gasto asignada..."
        className="w-full rounded-md border border-gray-200 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 pr-6"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onChange(''); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 leading-none text-sm"
        >✕</button>
      )}
      {abierto && createPortal(
        <div
          data-combobox-portal
          style={{
            position: 'fixed',
            left: pos.left,
            width: pos.width,
            ...(pos.top != null ? { top: pos.top } : {}),
            ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
            zIndex: 9999,
          }}
          className="bg-white border border-gray-200 rounded-lg shadow-xl max-h-44 overflow-y-auto"
        >
          {filtradas.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
          ) : (
            filtradas.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  onChange(String(c.id));
                  setQ('');
                  setAbierto(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-purple-50 flex items-center gap-2 ${String(c.id) === String(value) ? 'bg-purple-50' : ''}`}
              >
                <span className="font-mono font-semibold text-gray-900 min-w-[5.5rem] flex-shrink-0">{c.codigo}</span>
                <span className="text-gray-500 truncate">{c.descripcion}</span>
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ─── Selector de subcuenta (código base + sufijo 5 dígitos) ─────────────────

function SelectorSubcuenta({ cuentaBase, planContable, onCreada, onSeleccionada, onEliminada, razonSocial }) {
  const [sufijo, setSufijo]         = useState('');
  const [creando, setCreando]       = useState(false);
  const [eliminando, setEliminando] = useState(false);
  const [errorSub, setErrorSub]     = useState('');

  if (!cuentaBase) return null;

  // Si la cuenta base ya es una subcuenta (>4 dígitos), ofrecer eliminar
  const esSubcuenta = cuentaBase.codigo.length > 4;

  const codigoCompleto = cuentaBase.codigo + sufijo;
  const yaExiste = sufijo && planContable.find(c => c.codigo === codigoCompleto);

  async function handleCrear() {
    if (!sufijo || sufijo.length !== 5) return;
    if (yaExiste) { onSeleccionada(yaExiste); setSufijo(''); return; }
    setCreando(true); setErrorSub('');
    try {
      const nueva = await crearCuentaContable({
        codigo: codigoCompleto,
        descripcion: razonSocial || codigoCompleto,
        grupo: cuentaBase.codigo.charAt(0),
      });
      if (onCreada) onCreada(nueva);
      onSeleccionada(nueva);
      setSufijo('');
    } catch (e) { setErrorSub(e.message); }
    finally { setCreando(false); }
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
    <div className="mt-1.5 flex items-center gap-2 flex-wrap">
      {esSubcuenta ? (
        <>
          <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">{cuentaBase.codigo}</span>
          <span className="text-xs text-gray-400">({cuentaBase.descripcion})</span>
          <button type="button" onClick={handleEliminar} disabled={eliminando}
            className="px-2 py-0.5 text-[11px] font-medium text-red-600 bg-red-50 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50">
            {eliminando ? '...' : 'Eliminar subcuenta'}
          </button>
        </>
      ) : (
        <>
          <span className="text-xs text-gray-400">Subcuenta:</span>
          <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">{cuentaBase.codigo}</span>
          <span className="text-gray-300 text-xs">+</span>
          <input type="text" inputMode="numeric" maxLength={5} value={sufijo}
            onChange={e => { setSufijo(e.target.value.replace(/\D/g, '')); setErrorSub(''); }}
            onKeyDown={e => e.key === 'Enter' && sufijo.length === 5 && handleCrear()}
            placeholder="00001"
            className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {sufijo.length === 5 && (
            <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{codigoCompleto}</span>
          )}
          <button type="button" onClick={handleCrear} disabled={sufijo.length !== 5 || creando}
            className="px-2 py-0.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded disabled:opacity-40 transition-colors">
            {creando ? '...' : yaExiste ? 'Seleccionar' : 'Crear'}
          </button>
        </>
      )}
      {errorSub && <span className="text-xs text-red-500">{errorSub}</span>}
    </div>
  );
}

// ─── Sub-fila: CC + Vista previa (siempre visible) ───────────────────────────

function FilaCcPreview({ f, planContable, onAsignarCG, selected, esPar = true, onProveedorActualizado, modoGestoria = 'v2' }) {
  const esV1 = modoGestoria === 'v1';
  const cuentasGasto = planContable.filter(c => c.grupo !== '4');
  const cuentas4     = planContable.filter(c => c.grupo === '4');
  const [cgId,          setCgId]          = useState(String(f.cg_efectiva_id || ''));
  const [guardando,     setGuardando]     = useState(false);
  const [cgError,       setCgError]       = useState('');
  const [previewUrl,    setPreviewUrl]    = useState(null);
  const [previewLoading,setPreviewLoading]= useState(false);
  const [previewError,  setPreviewError]  = useState('');

  const esContabilizada = f.estado_gestion === 'CONTABILIZADA';
  const incProv = tieneIncidenciaProveedor(f);

  // Estado para asignar cuenta contable al proveedor
  const [ccProvId,       setCcProvId]       = useState('');
  const [guardandoCC,    setGuardandoCC]    = useState(false);
  const [ccProvError,    setCcProvError]    = useState('');

  // Estado para crear proveedor al vuelo
  const [modalProv,      setModalProv]      = useState(false);
  const [provForm,       setProvForm]       = useState({ razon_social: '', cif: '', nombre_carpeta: '', cuenta_contable_id: '' });
  const [creandoProv,    setCreandoProv]    = useState(false);
  const [provError,      setProvError]      = useState('');

  async function handleAsignarCCProv() {
    if (!ccProvId || !f.proveedor_id) return;
    setGuardandoCC(true); setCcProvError('');
    try {
      await asignarCuentaContableProveedor(f.proveedor_id, parseInt(ccProvId, 10));
      if (onProveedorActualizado) onProveedorActualizado();
    } catch (e) { setCcProvError(e.message); }
    finally { setGuardandoCC(false); }
  }

  async function handleCrearProveedor() {
    if (!provForm.razon_social.trim()) return;
    setCreandoProv(true); setProvError('');
    try {
      await crearProveedorRapido({
        razon_social: provForm.razon_social.trim(),
        cif:          provForm.cif.trim() || null,
        nombre_carpeta: provForm.nombre_carpeta.trim() || f.proveedor || null,
        cuenta_contable_id: provForm.cuenta_contable_id ? parseInt(provForm.cuenta_contable_id, 10) : null,
      });
      setModalProv(false);
      if (onProveedorActualizado) onProveedorActualizado();
    } catch (e) { setProvError(e.message); }
    finally { setCreandoProv(false); }
  }

  useEffect(() => {
    setCgId(String(f.cg_efectiva_id || ''));
  }, [f.cg_efectiva_id]);

  async function handleCgChange(newCgId) {
    const prev = cgId;
    setCgId(newCgId);
    setCgError('');
    setGuardando(true);
    try {
      await onAsignarCG(f.id, newCgId ? parseInt(newCgId, 10) : null);
    } catch (e) {
      setCgId(prev);
      setCgError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function cargarPreview() {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const { url, type } = await fetchPreviewFactura(f.id);
      // Verificar si es PDF tanto por MIME como por extensión del archivo
      const ext = (f.nombre_archivo || '').split('.').pop().toLowerCase();
      if (type.includes('pdf') || ext === 'pdf') {
        setPreviewUrl(url);
      } else {
        setPreviewError(`Este archivo (${ext.toUpperCase()}) no admite vista previa. Descárgalo para verlo.`);
      }
    } catch (e) {
      setPreviewError('No se pudo cargar: ' + e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  const bgCls = selected ? 'bg-blue-50/70' : esPar ? 'bg-white' : 'bg-slate-50/70';

  return (
    <>
      {/* Fila de controles: CC + preview */}
      <tr className={`${bgCls} border-b-2 border-gray-200`}>
        {/* Columna vacía (alineada con el botón expand) */}
        <td className="px-3 py-1.5 w-8" />
        {/* Columna vacía (alineada con el checkbox) */}
        <td className="px-4 py-1.5 w-10" />
        {/* Contenido */}
        <td colSpan={100} className="px-2 py-1.5">
          <div className="flex items-center gap-3 flex-wrap" onClick={e => e.stopPropagation()}>

            {/* Cuenta de Gasto — solo v2 */}
            {!esV1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 flex-shrink-0">Cta. Gasto:</span>
                <div className="w-64">
                  <ComboboxCuenta
                    cuentas={cuentasGasto}
                    value={cgId}
                    onChange={handleCgChange}
                    disabled={esContabilizada}
                  />
                </div>
                {guardando && <span className="text-xs text-purple-400">Guardando...</span>}
                {cgError  && <span className="text-xs text-red-500">{cgError}</span>}
                {!cgId && !esContabilizada && (
                  <span className="text-xs text-amber-500">Asigna Cta. Gasto para poder contabilizar</span>
                )}
                {cgId && !esContabilizada && f.cg_efectiva_id && !f.cg_manual_id && (
                  <span className="text-xs text-gray-400">(por defecto del proveedor)</span>
                )}
              </div>
            )}

            {/* Incidencia proveedor: asignar cuenta contable — solo v2 */}
            {!esV1 && incProv === 'SIN_CUENTA_CONTABLE' && (
              <>
                <span className="text-gray-200 select-none">|</span>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-orange-500 font-medium flex-shrink-0">Cta. contable:</span>
                    <div className="w-52">
                      <ComboboxCuenta cuentas={cuentas4} value={ccProvId} onChange={setCcProvId} />
                    </div>
                    {ccProvId && (
                      <button onClick={handleAsignarCCProv} disabled={guardandoCC}
                        className="px-2 py-0.5 text-[11px] font-medium bg-orange-100 text-orange-700 border border-orange-200 rounded hover:bg-orange-200 disabled:opacity-50">
                        {guardandoCC ? '...' : 'Asignar'}
                      </button>
                    )}
                    {ccProvError && <span className="text-xs text-red-500">{ccProvError}</span>}
                  </div>
                  <SelectorSubcuenta
                    cuentaBase={planContable.find(c => String(c.id) === ccProvId)}
                    planContable={planContable}
                    razonSocial={f.razon_social || f.datos_extraidos?.nombre_emisor || ''}
                    onCreada={() => { if (onProveedorActualizado) onProveedorActualizado(); }}
                    onSeleccionada={c => { setCcProvId(String(c.id)); }}
                    onEliminada={() => { setCcProvId(''); if (onProveedorActualizado) onProveedorActualizado(); }}
                  />
                </div>
              </>
            )}

            {/* Incidencia proveedor: crear proveedor — solo v2 */}
            {!esV1 && incProv === 'SIN_PROVEEDOR' && (
              <>
                <span className="text-gray-200 select-none">|</span>
                <button onClick={() => { setProvForm({ razon_social: f.datos_extraidos?.nombre_emisor || '', cif: f.datos_extraidos?.cif_emisor || '', nombre_carpeta: f.proveedor || '', cuenta_contable_id: '' }); setModalProv(true); }}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-orange-700 bg-orange-50 border border-orange-200 rounded-md hover:bg-orange-100 transition-colors flex-shrink-0">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
                  </svg>
                  Crear proveedor
                </button>
              </>
            )}

            {/* Botón Vista previa */}
            {!previewUrl && !previewError && (
              <button
                onClick={cargarPreview}
                disabled={previewLoading}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-600 bg-white border border-blue-200 rounded-md hover:bg-blue-50 disabled:opacity-50 transition-colors flex-shrink-0"
              >
                {previewLoading ? (
                  <>
                    <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                    Cargando...
                  </>
                ) : (
                  <>
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    </svg>
                    Ver documento
                  </>
                )}
              </button>
            )}
            {previewUrl && (
              <button
                onClick={() => setPreviewUrl(null)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                </svg>
                Cerrar vista previa
              </button>
            )}
            {previewError && (
              <span className="text-xs text-amber-600">{previewError}</span>
            )}
          </div>
        </td>
      </tr>

      {/* Fila del iframe (solo cuando preview está cargado) */}
      {previewUrl && (
        <tr className={`${bgCls} border-b border-gray-200`}>
          <td colSpan={100} className="px-4 pb-4 pt-1">
            <iframe
              src={previewUrl}
              className="w-full rounded-lg border border-blue-200 shadow-sm"
              style={{ height: '520px' }}
              title={`Vista previa — ${f.nombre_archivo}`}
            />
          </td>
        </tr>
      )}

      {/* Modal crear proveedor al vuelo */}
      {modalProv && createPortal(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setModalProv(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-900">Crear proveedor</h3>
            {provError && <p className="text-xs text-red-600 bg-red-50 rounded px-2 py-1">{provError}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Razon Social *</label>
                <input value={provForm.razon_social} onChange={e => setProvForm(p => ({ ...p, razon_social: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">CIF</label>
                <input value={provForm.cif} onChange={e => setProvForm(p => ({ ...p, cif: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de carpeta</label>
                <input value={provForm.nombre_carpeta} onChange={e => setProvForm(p => ({ ...p, nombre_carpeta: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Cuenta contable <span className="text-[10px] font-normal text-gray-400">(Grupo 4)</span>
                </label>
                <ComboboxCuenta cuentas={cuentas4} value={provForm.cuenta_contable_id}
                  onChange={v => setProvForm(p => ({ ...p, cuenta_contable_id: v }))} />
                <SelectorSubcuenta
                  cuentaBase={planContable.find(c => String(c.id) === provForm.cuenta_contable_id)}
                  planContable={planContable}
                  razonSocial={provForm.razon_social}
                  onCreada={() => { if (onProveedorActualizado) onProveedorActualizado(); }}
                  onSeleccionada={c => setProvForm(p => ({ ...p, cuenta_contable_id: String(c.id) }))}
                  onEliminada={() => { setProvForm(p => ({ ...p, cuenta_contable_id: '' })); if (onProveedorActualizado) onProveedorActualizado(); }}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalProv(false)} className="px-4 py-1.5 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              <button onClick={handleCrearProveedor} disabled={creandoProv || !provForm.razon_social.trim()}
                className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
                {creandoProv ? 'Creando...' : 'Crear proveedor'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Panel de detalle fiscal (acordeón) ──────────────────────────────────────

const TIPOS_IVA = [0, 4, 10, 21];

function CampoEditable({ label, valor, campo, datosOriginales, onGuardar, tipo = 'text' }) {
  const esVacio = datosOriginales[campo] == null || datosOriginales[campo] === '';
  const [editando, setEditando] = useState(false);
  const [val, setVal]           = useState(valor || '');
  const [guardando, setGuardando] = useState(false);

  // Sincronizar val cuando el valor externo cambia
  useEffect(() => { setVal(valor || ''); }, [valor]);

  if (!editando) {
    const display = tipo === 'number' && valor != null
      ? fmtEuro(valor)
      : tipo === 'date' && valor
        ? fmtFecha(valor)
        : (valor || 'Sin datos');
    return (
      <button onClick={() => setEditando(true)}
        className={`text-sm transition-colors cursor-pointer ${esVacio ? 'text-red-400 italic hover:text-red-600' : 'font-medium text-gray-900 hover:text-blue-600'} hover:underline`}>
        {display} <span className="text-gray-300 text-xs">&#9998;</span>
      </button>
    );
  }

  async function guardar() {
    const v = String(val).trim();
    if (!v && tipo !== 'number') return;
    setGuardando(true);
    try {
      const enviar = tipo === 'number' ? (parseFloat(val) || 0) : String(val).trim();
      await onGuardar({ [campo]: enviar });
      setEditando(false);
    } catch { /* error manejado arriba */ }
    finally { setGuardando(false); }
  }

  return (
    <span className="inline-flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <input value={val} onChange={e => setVal(e.target.value)}
        type={tipo === 'number' ? 'number' : tipo === 'date' ? 'date' : 'text'}
        step={tipo === 'number' ? '0.01' : undefined}
        className="rounded border border-red-300 px-1.5 py-0.5 text-xs w-32 focus:outline-none focus:ring-2 focus:ring-red-400"
        autoFocus onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setEditando(false); }} />
      <button onClick={guardar} disabled={guardando} className="text-emerald-600 hover:text-emerald-800 text-xs font-bold">
        {guardando ? '...' : '✓'}
      </button>
      <button onClick={() => setEditando(false)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
    </span>
  );
}

function PanelDetalleFiscal({ f, onDatosActualizados }) {
  const d   = f.datos_extraidos || {};
  const iva = Array.isArray(d.iva) ? d.iva : [];
  const faltantes = detectarIncidencia(d);
  const hayIncidencia = faltantes.length > 0;

  const ivaMap = {};
  for (const e of iva) ivaMap[e.tipo] = e;
  const tiposPresentes = TIPOS_IVA.filter(t => ivaMap[t]);
  const ivaVacio = !iva.some(e => e.base > 0 || e.cuota > 0);

  // Estado para edición IVA inline
  const [editandoIva, setEditandoIva] = useState(false);
  const [ivaForm, setIvaForm]         = useState({ tipo: '21', base: '', cuota: '' });
  const [guardandoIva, setGuardandoIva] = useState(false);

  async function handleGuardar(campos) {
    const result = await editarDatosFactura(f.id, campos);
    if (onDatosActualizados) onDatosActualizados(f.id, result.datos_extraidos);
  }

  async function guardarIva() {
    const base  = parseFloat(ivaForm.base) || 0;
    const tipo  = parseInt(ivaForm.tipo) || 0;
    const cuota = parseFloat(ivaForm.cuota) || Math.round(base * tipo) / 100;
    if (!base) return;
    setGuardandoIva(true);
    try {
      const nuevoIva = [...iva, { tipo, base, cuota }];
      await handleGuardar({ iva: nuevoIva });
      setEditandoIva(false);
      setIvaForm({ tipo: '21', base: '', cuota: '' });
    } catch { /* */ }
    finally { setGuardandoIva(false); }
  }

  return (
    <tr>
      <td colSpan={100} className={`px-0 pb-0 border-b ${hayIncidencia ? 'bg-red-50/60 border-red-100' : 'bg-blue-50/60 border-blue-100'}`}>
        {hayIncidencia && (
          <div className="px-6 pt-3 pb-1">
            <p className="text-xs font-semibold text-red-600 flex items-center gap-1.5">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>
              </svg>
              Campos pendientes: {faltantes.map(c => c === 'iva' ? 'desglose IVA' : c.replace(/_/g, ' ')).join(', ')}
            </p>
          </div>
        )}
        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* Datos fiscales */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Datos fiscales</p>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">N.º factura</p>
                  <CampoEditable label="Numero factura" valor={d.numero_factura} campo="numero_factura" datosOriginales={d} onGuardar={handleGuardar} />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Fecha emision</p>
                  <CampoEditable label="Fecha emision" valor={d.fecha_emision} campo="fecha_emision" datosOriginales={d} onGuardar={handleGuardar} tipo="date" />
                </div>
              </div>
              <div className={`border-t pt-3 ${hayIncidencia ? 'border-red-100' : 'border-blue-100'}`}>
                <p className="text-xs text-gray-400 mb-0.5">Emisor</p>
                <CampoEditable label="Nombre emisor" valor={d.nombre_emisor} campo="nombre_emisor" datosOriginales={d} onGuardar={handleGuardar} />
                <div className="mt-0.5">
                  <CampoEditable label="CIF emisor" valor={d.cif_emisor} campo="cif_emisor" datosOriginales={d} onGuardar={handleGuardar} />
                </div>
              </div>
              <div className={`border-t pt-3 ${hayIncidencia ? 'border-red-100' : 'border-blue-100'}`}>
                <p className="text-xs text-gray-400 mb-0.5">Receptor</p>
                <CampoEditable label="Nombre receptor" valor={d.nombre_receptor} campo="nombre_receptor" datosOriginales={d} onGuardar={handleGuardar} />
                <div className="mt-0.5">
                  <CampoEditable label="CIF receptor" valor={d.cif_receptor} campo="cif_receptor" datosOriginales={d} onGuardar={handleGuardar} />
                </div>
              </div>
            </div>
          </div>

          {/* Desglose IVA */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Desglose IVA</p>
            {tiposPresentes.length > 0 && (
              <table className="w-full text-xs mb-2">
                <thead>
                  <tr className="text-gray-400">
                    <th className="text-left pb-1.5 font-medium">Tipo</th>
                    <th className="text-right pb-1.5 font-medium">Base</th>
                    <th className="text-right pb-1.5 font-medium">Cuota</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${hayIncidencia ? 'divide-red-100' : 'divide-blue-100'}`}>
                  {tiposPresentes.map(tipo => (
                    <tr key={tipo}>
                      <td className="py-1.5 font-medium text-gray-700">IVA {tipo}%</td>
                      <td className="py-1.5 text-right text-gray-700">{fmtEuroIva(ivaMap[tipo].base)}</td>
                      <td className="py-1.5 text-right text-gray-700">{fmtEuroIva(ivaMap[tipo].cuota)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!editandoIva && (
              <button onClick={() => setEditandoIva(true)} className={`text-xs hover:underline ${ivaVacio ? 'text-red-400 italic hover:text-red-600' : 'text-blue-500 hover:text-blue-700'}`}>
                {ivaVacio ? 'Sin desglose disponible' : 'Editar desglose'} <span className="text-gray-300">&#9998;</span>
              </button>
            )}
            {editandoIva && (
              <div className="space-y-2 bg-white/60 rounded-lg p-2 border border-red-200" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2">
                  <select value={ivaForm.tipo} onChange={e => setIvaForm(p => ({ ...p, tipo: e.target.value }))}
                    className="rounded border border-gray-200 px-1.5 py-0.5 text-xs w-20">
                    {TIPOS_IVA.map(t => <option key={t} value={t}>IVA {t}%</option>)}
                  </select>
                  <input value={ivaForm.base} onChange={e => setIvaForm(p => ({ ...p, base: e.target.value }))}
                    type="number" step="0.01" placeholder="Base" className="rounded border border-red-300 px-1.5 py-0.5 text-xs w-20" />
                  <input value={ivaForm.cuota} onChange={e => setIvaForm(p => ({ ...p, cuota: e.target.value }))}
                    type="number" step="0.01" placeholder="Cuota" className="rounded border border-red-300 px-1.5 py-0.5 text-xs w-20" />
                </div>
                <div className="flex gap-1">
                  <button onClick={guardarIva} disabled={guardandoIva} className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200">
                    {guardandoIva ? '...' : 'Guardar'}
                  </button>
                  <button onClick={() => setEditandoIva(false)} className="px-2 py-0.5 text-xs text-gray-500 hover:text-gray-700">Cancelar</button>
                </div>
              </div>
            )}
          </div>

          {/* Totales y pago */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Totales y pago</p>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Total base (sin IVA)</span>
                <CampoEditable label="Total sin IVA" valor={d.total_sin_iva} campo="total_sin_iva" datosOriginales={d} onGuardar={handleGuardar} tipo="number" />
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-gray-500">Total IVA</span>
                <CampoEditable label="Total IVA" valor={d.total_iva} campo="total_iva" datosOriginales={d} onGuardar={handleGuardar} tipo="number" />
              </div>
              <div className={`flex justify-between items-center border-t pt-2 mt-1 ${hayIncidencia ? 'border-red-100' : 'border-blue-100'}`}>
                <span className="text-xs font-semibold text-gray-700">Total factura</span>
                <CampoEditable label="Total factura" valor={d.total_factura} campo="total_factura" datosOriginales={d} onGuardar={handleGuardar} tipo="number" />
              </div>
              <div className={`border-t pt-2 space-y-1.5 ${hayIncidencia ? 'border-red-100' : 'border-blue-100'}`}>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Forma de pago</span>
                  <span className="text-xs font-medium text-gray-700">{d.forma_pago || '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Vencimiento</span>
                  <span className="text-xs font-medium text-gray-700">{fmtFecha(d.fecha_vencimiento)}</span>
                </div>
              </div>
              {f.lote_a3_nombre && (
                <div className={`border-t pt-2 mt-2 ${hayIncidencia ? 'border-red-100' : 'border-blue-100'}`}>
                  <p className="text-xs text-gray-400 mb-1">Lote A3 exportado</p>
                  <p className="text-xs font-mono font-medium text-orange-700 break-all">{f.lote_a3_nombre}</p>
                  {f.lote_a3_fecha && <p className="text-xs text-gray-500 mt-0.5">{new Date(f.lote_a3_fecha).toLocaleString('es-ES')}</p>}
                </div>
              )}
            </div>
          </div>

        </div>
      </td>
    </tr>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ hayFiltros, colspan }) {
  return (
    <tr>
      <td colSpan={colspan} className="py-20 text-center">
        <div className="flex flex-col items-center gap-2 text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium">
            {hayFiltros ? 'No hay facturas con esos filtros' : 'No hay facturas sincronizadas'}
          </p>
          {!hayFiltros && (
            <p className="text-xs">Ejecuta <code className="bg-gray-100 px-1 rounded">node sync.js --save</code> para importar desde Drive</p>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Tabla principal ──────────────────────────────────────────────────────────

export default function TablaFacturas({
  facturas, seleccionados, onToggle, onToggleTodo,
  loading, hayFiltros, esAdmin = false, onRevertir, onEliminar,
  planContable = [], onAsignarCG, onDatosActualizados, onProveedorActualizado, modoGestoria = 'v2',
}) {
  const [expandidos, setExpandidos] = useState(new Set());
  const todosSeleccionados = facturas.length > 0 && seleccionados.size === facturas.length;
  const algunoSeleccionado = seleccionados.size > 0 && !todosSeleccionados;
  const colspan = esAdmin ? 11 : 10;

  function toggleExpand(id, e) {
    e.stopPropagation();
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-3 py-3 w-8" />
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={todosSeleccionados}
                  ref={el => { if (el) el.indeterminate = algunoSeleccionado; }}
                  onChange={onToggleTodo}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </th>
              <Th>Proveedor</Th>
              <Th>Nº Factura</Th>
              <Th>Fecha emisión</Th>
              <Th className="text-right">Total</Th>
              <Th>CIF Emisor</Th>
              <Th>Forma de pago</Th>
              <Th>Extracción</Th>
              <Th>Gestión</Th>
              {esAdmin && <Th />}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={colspan} className="py-10 text-center text-gray-400 text-sm">
                  <svg className="inline h-5 w-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Cargando...
                </td>
              </tr>
            ) : facturas.length === 0 ? (
              <EmptyState hayFiltros={hayFiltros} colspan={colspan} />
            ) : (
              facturas.flatMap((f, fIdx) => {
                const datos    = f.datos_extraidos;
                const selected = seleccionados.has(f.id);
                const expanded = expandidos.has(f.id);
                const total    = datos?.total_factura;
                const negativo = total != null && total < 0;
                const puedeRevertir = esAdmin && f.estado_gestion && f.estado_gestion !== 'PENDIENTE';
                const puedeEliminar = esAdmin && (!f.estado_gestion || f.estado_gestion === 'PENDIENTE');
                const incidencia    = tieneIncidencia(f);
                const incProv       = modoGestoria !== 'v1' ? tieneIncidenciaProveedor(f) : null;
                const hayAlerta     = incidencia || incProv;
                const esPar = fIdx % 2 === 0;

                // Tooltip detallado de incidencias
                const camposFaltantes = detectarIncidencia(datos);
                const tooltipDatos = camposFaltantes.length
                  ? 'Faltan: ' + camposFaltantes.map(c => c === 'iva' ? 'desglose IVA' : c.replace(/_/g, ' ')).join(', ')
                  : '';
                const tooltipProv = incProv === 'SIN_PROVEEDOR'
                  ? 'Proveedor no registrado (no hay coincidencia por CIF)'
                  : incProv === 'SIN_CUENTA_CONTABLE'
                    ? 'Proveedor sin cuenta contable asignada'
                    : '';

                const mainRow = (
                  <tr
                    key={`row-${f.id}`}
                    onClick={() => onToggle(f.id)}
                    className={`cursor-pointer transition-colors ${selected ? 'bg-blue-50 hover:bg-blue-100' : incidencia ? 'bg-red-50/40 hover:bg-red-50' : incProv ? 'bg-orange-50/40 hover:bg-orange-50' : esPar ? 'bg-white hover:bg-gray-50' : 'bg-slate-50/70 hover:bg-slate-100/70'}`}
                  >
                    {/* Botón expandir (solo datos fiscales) */}
                    <td className="px-3 py-3" onClick={e => toggleExpand(f.id, e)}>
                      <button className="text-gray-400 hover:text-gray-600 transition-colors p-0.5 rounded" title="Ver datos fiscales">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
                          viewBox="0 0 20 20" fill="currentColor"
                        >
                          <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggle(f.id)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate" title={incProv ? tooltipProv : f.proveedor}>
                      <span className="flex items-center gap-1">
                        {incProv && (
                          <span title={tooltipProv} className="flex-shrink-0 cursor-help">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>
                            </svg>
                          </span>
                        )}
                        <span title={f.proveedor}>{f.proveedor || '—'}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs" title={incidencia ? tooltipDatos : ''}>
                      <span className="flex items-center gap-1">
                        {incidencia && (
                          <span title={tooltipDatos} className="flex-shrink-0 cursor-help">
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/>
                            </svg>
                          </span>
                        )}
                        {datos?.numero_factura || <span className="text-gray-400 italic">{f.nombre_archivo.slice(0, 20)}</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {fmtFecha(datos?.fecha_emision)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${negativo ? 'text-red-600' : 'text-gray-900'}`}>
                      {fmtEuro(total)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {datos?.cif_emisor || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[120px] truncate" title={datos?.forma_pago}>
                      {datos?.forma_pago || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <BadgeExtraccion estado={f.estado} />
                    </td>
                    <td className="px-4 py-3">
                      <BadgeGestion estado={f.estado_gestion || 'PENDIENTE'} />
                    </td>
                    {esAdmin && (
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          {puedeRevertir && (
                            <button
                              onClick={() => onRevertir(f.id)}
                              title="Revertir a PENDIENTE"
                              className="p-1 text-gray-400 hover:text-amber-500 transition-colors rounded"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                              </svg>
                            </button>
                          )}
                          {puedeEliminar && onEliminar && (
                            <button
                              onClick={() => { if (confirm('Eliminar esta factura? Esta accion no se puede deshacer.')) onEliminar(f.id); }}
                              title="Eliminar factura"
                              className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );

                // Sub-fila siempre visible: CC + Vista previa
                const ccPreviewRow = planContable.length > 0 && (
                  <FilaCcPreview
                    key={`cc-${f.id}`}
                    f={f}
                    planContable={planContable}
                    onAsignarCG={onAsignarCG}
                    selected={selected}
                    esPar={esPar}
                    onProveedorActualizado={onProveedorActualizado}
                    modoGestoria={modoGestoria}
                  />
                );

                // Panel de detalle fiscal (solo cuando se expande)
                const detailRow = expanded && (
                  <PanelDetalleFiscal key={`detail-${f.id}`} f={f} onDatosActualizados={onDatosActualizados} />
                );

                return [mainRow, ccPreviewRow, detailRow].filter(Boolean);
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
