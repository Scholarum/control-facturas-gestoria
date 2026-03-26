import { useState, useMemo, useEffect, useRef } from 'react';
import TablaFacturas, { tieneIncidencia, tieneIncidenciaProveedor } from './TablaFacturas.jsx';
import { descargarZip, contabilizar, revertirEstado, eliminarFactura, asignarCGMasivo, exportarLoteA3, exportarSage, sagePreview } from '../api.js';

// ─── Filtros compactos por sección ────────────────────────────────────────────

const inputCls = 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function FiltrosSeccion({ filtros, onChange, proveedores }) {
  const hayFiltros = Object.values(filtros).some(Boolean);
  function set(k, v) { onChange({ ...filtros, [k]: v }); }

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Proveedor</label>
        <select value={filtros.proveedor} onChange={e => set('proveedor', e.target.value)}
          className={`${inputCls} min-w-[160px]`}>
          <option value="">Todos</option>
          {proveedores.map(p => <option key={p.nombre_carpeta ?? p} value={p.nombre_carpeta ?? p}>{p.label ?? p}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Fecha desde</label>
        <input type="date" value={filtros.fechaDesde} onChange={e => set('fechaDesde', e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-500">Fecha hasta</label>
        <input type="date" value={filtros.fechaHasta} onChange={e => set('fechaHasta', e.target.value)} className={inputCls} />
      </div>
      <label className="self-end flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer select-none">
        <input type="checkbox" checked={!!filtros.soloIncidencias}
          onChange={e => set('soloIncidencias', e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300 text-red-500 focus:ring-red-400" />
        <span className="text-xs font-medium text-red-600">Datos incompletos</span>
      </label>
      <label className="self-end flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer select-none">
        <input type="checkbox" checked={!!filtros.soloSinProveedor}
          onChange={e => set('soloSinProveedor', e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300 text-orange-500 focus:ring-orange-400" />
        <span className="text-xs font-medium text-orange-600">Sin proveedor/cuenta</span>
      </label>
      {hayFiltros && (
        <button onClick={() => onChange({ proveedor: '', fechaDesde: '', fechaHasta: '', soloIncidencias: false, soloSinProveedor: false })}
          className="self-end px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">
          Limpiar
        </button>
      )}
    </div>
  );
}

// ─── Iconos reutilizables ─────────────────────────────────────────────────────

function IconoDescarga() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  );
}

function IconoCheck() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
    </svg>
  );
}

// ─── ComboboxCuenta compacto (para barra de acción masiva) ───────────────────

function ComboboxCuentaMasiva({ cuentas, value, onChange }) {
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
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setAbierto(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const displayValue = seleccionada ? `${seleccionada.codigo} — ${seleccionada.descripcion}` : '';

  return (
    <div ref={ref} className="relative">
      <input
        value={abierto ? q : displayValue}
        onChange={e => setQ(e.target.value)}
        onFocus={() => { setQ(''); setAbierto(true); }}
        placeholder="Selecciona cuenta de gasto..."
        className="rounded-lg border border-white/30 bg-white/10 text-white placeholder-white/50 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-white/50 w-72 pr-6"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onChange(''); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-white/50 hover:text-white leading-none text-sm"
        >✕</button>
      )}
      {abierto && (
        <div className="absolute z-50 top-full left-0 w-80 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
          {filtradas.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
          ) : filtradas.map(c => (
            <button
              key={c.id}
              type="button"
              onMouseDown={e => {
                e.preventDefault();
                onChange(String(c.id));
                setQ('');
                setAbierto(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2 ${String(c.id) === String(value) ? 'bg-blue-50' : ''}`}
            >
              <span className="font-mono font-semibold text-gray-900 min-w-[5.5rem] flex-shrink-0">{c.codigo}</span>
              <span className="text-gray-500 truncate">{c.descripcion}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sección principal ────────────────────────────────────────────────────────

/**
 * tipo: 'pendientes' | 'descargadas' | 'cc_asignada' | 'contabilizadas'
 * onEstadoActualizado(ids: number[], nuevoEstado: string): void
 */
export default function SeccionFacturas({
  tipo,
  facturas,
  proveedores,
  esAdmin,
  soloLectura = false,
  loading,
  onEstadoActualizado,
  onRefreshFacturas,
  planContable = [],
  onAsignarCG,
  onAsignarCGMasivo,
  onEliminarFactura,
  onDatosActualizados,
  onProveedorActualizado,
  modoGestoria = 'v2',
}) {
  const esV1 = modoGestoria === 'v1';
  const [filtros,       setFiltros]       = useState({ proveedor: '', fechaDesde: '', fechaHasta: '', soloIncidencias: false, soloSinProveedor: false });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [descargando,        setDescargando]        = useState(false);
  const [contabilizando,     setContabilizando]     = useState(false);
  const [asignandoCC,        setAsignandoCC]        = useState(false);
  const [exportandoA3,       setExportandoA3]       = useState(false);
  const [exportandoSage,    setExportandoSage]    = useState(false);
  const [modalSageOpen,     setModalSageOpen]     = useState(false);
  const [sageProveedores,   setSageProveedores]   = useState([]);
  const [sageAsientos,      setSageAsientos]      = useState({});
  const [modalA3Open,        setModalA3Open]        = useState(false);
  const [ccMasiva,           setCcMasiva]           = useState('');
  const [error,              setError]              = useState('');

  const filtradas = useMemo(() => facturas.filter(f => {
    const d = f.datos_extraidos;
    if (filtros.proveedor  && f.proveedor !== filtros.proveedor) return false;
    if (filtros.fechaDesde && d?.fecha_emision && d.fecha_emision < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && d?.fecha_emision && d.fecha_emision > filtros.fechaHasta) return false;
    if (filtros.soloIncidencias && !tieneIncidencia(f)) return false;
    if (filtros.soloSinProveedor && !tieneIncidenciaProveedor(f)) return false;
    return true;
  }), [facturas, filtros]);

  // Limpiar selecciones huérfanas cuando facturas salen de la sección
  useEffect(() => {
    const ids = new Set(filtradas.map(f => f.id));
    setSeleccionados(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [filtradas]);

  function toggleSeleccion(id) {
    setSeleccionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleTodo() {
    setSeleccionados(prev =>
      prev.size === filtradas.length ? new Set() : new Set(filtradas.map(f => f.id))
    );
  }

  async function handleDescargar() {
    const ids = Array.from(seleccionados);
    setDescargando(true); setError('');
    try {
      await descargarZip(ids);
      if (!esAdmin) {
        // Solo mover a DESCARGADA las que estaban en PENDIENTE
        const idsPendientes = ids.filter(id => {
          const f = facturas.find(f => f.id === id);
          return f && (!f.estado_gestion || f.estado_gestion === 'PENDIENTE');
        });
        if (idsPendientes.length) onEstadoActualizado(idsPendientes, 'DESCARGADA');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setDescargando(false);
    }
  }

  async function handleContabilizar() {
    const ids = Array.from(seleccionados);
    setContabilizando(true); setError('');
    try {
      await contabilizar(ids);
      onEstadoActualizado(ids, 'CONTABILIZADA');
    } catch (e) {
      setError(e.message);
    } finally {
      setContabilizando(false);
    }
  }

  async function handleAsignarCGMasivaLocal() {
    if (!ccMasiva) return;
    const ids = Array.from(seleccionados);
    setAsignandoCC(true); setError('');
    try {
      await asignarCGMasivo(ids, parseInt(ccMasiva, 10));
      onAsignarCGMasivo(ids, parseInt(ccMasiva, 10));
      setCcMasiva('');
      setSeleccionados(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setAsignandoCC(false);
    }
  }

  async function handleExportarA3() {
    const ids = Array.from(seleccionados);
    setExportandoA3(true); setError(''); setModalA3Open(false);
    try {
      await exportarLoteA3(ids);
      onEstadoActualizado(ids, 'CONTABILIZADA');
      setSeleccionados(new Set());
      if (onRefreshFacturas) onRefreshFacturas();
    } catch (e) {
      setError(e.message);
    } finally {
      setExportandoA3(false);
    }
  }

  async function abrirModalSage() {
    setError('');
    try {
      const ids = Array.from(seleccionados);
      const data = await sagePreview(ids);
      setSageProveedores(data.proveedores);
      const asientos = {};
      for (const p of data.proveedores) {
        asientos[p.proveedor_id || 0] = p.siguiente_asiento;
      }
      setSageAsientos(asientos);
      setModalSageOpen(true);
    } catch (e) { setError(e.message); }
  }

  async function handleExportarSage(marcarContabilizada) {
    const ids = Array.from(seleccionados);
    setExportandoSage(true); setError(''); setModalSageOpen(false);
    try {
      const result = await exportarSage(ids, sageAsientos, marcarContabilizada);
      if (result.contabilizada) {
        onEstadoActualizado(ids, 'CONTABILIZADA');
      }
      setSeleccionados(new Set());
      if (onRefreshFacturas) onRefreshFacturas();
    } catch (e) {
      setError(e.message);
    } finally {
      setExportandoSage(false);
    }
  }

  async function handleRevertir(id) {
    try {
      await revertirEstado(id);
      onEstadoActualizado([id], 'PENDIENTE');
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleEliminar(id) {
    try {
      await eliminarFactura(id);
      if (onEliminarFactura) onEliminarFactura(id);
    } catch (e) {
      setError(e.message);
    }
  }

  const hayFiltros   = Object.values(filtros).some(Boolean);
  const haySeleccion = seleccionados.size > 0;
  const n            = seleccionados.size;

  return (
    <div className="space-y-3">

      {/* Barra de filtros */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
        <FiltrosSeccion filtros={filtros} onChange={setFiltros} proveedores={proveedores} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}

      {/* Barra de acciones — visible siempre que haya selección */}
      {haySeleccion && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 bg-blue-600 text-white rounded-xl px-5 py-3 shadow-lg shadow-blue-200 flex-wrap">
            <span className="text-sm font-medium flex-1">
              {n} {n === 1 ? 'factura seleccionada' : 'facturas seleccionadas'}
            </span>
            <button
              onClick={() => setSeleccionados(new Set())}
              className="px-3 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-400 rounded-lg transition-colors"
            >
              Deseleccionar
            </button>

            {/* Descargar ZIP — disponible en todos los estados */}
            <button
              onClick={handleDescargar}
              disabled={descargando || contabilizando || asignandoCC}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-white text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-60"
            >
              {descargando ? <Spinner /> : <IconoDescarga />}
              {descargando ? 'Generando ZIP...' : `Descargar ZIP (${n})`}
            </button>

            {/* Marcar como CONTABILIZADAS — en v1 también desde Descargadas */}
            {((esV1 ? (tipo === 'descargadas' || tipo === 'cc_asignada') : tipo === 'cc_asignada') && !soloLectura) && (
              <button
                onClick={handleContabilizar}
                disabled={contabilizando || descargando || asignandoCC || exportandoA3}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg transition-colors disabled:opacity-60"
              >
                {contabilizando ? <Spinner /> : <IconoCheck />}
                {contabilizando ? 'Contabilizando...' : `Contabilizar (${n})`}
              </button>
            )}

            {/* Exportar a SAGE — solo en CC Asignada, v2 y con permisos */}
            {!esV1 && tipo === 'cc_asignada' && !soloLectura && (
              <button
                onClick={abrirModalSage}
                disabled={exportandoSage || exportandoA3 || contabilizando || descargando || asignandoCC}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-orange-500 hover:bg-orange-400 text-white rounded-lg transition-colors disabled:opacity-60"
              >
                {exportandoSage ? <Spinner /> : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                {exportandoSage ? 'Exportando...' : `Exportar SAGE (${n})`}
              </button>
            )}
          </div>

          {/* Asignación masiva de Cta. Gasto — solo v2 */}
          {!esV1 && tipo !== 'contabilizadas' && !soloLectura && planContable.length > 0 && (
            <div className="flex items-center gap-3 bg-purple-600 text-white rounded-xl px-5 py-3 shadow-lg shadow-purple-200 flex-wrap">
              <span className="text-xs font-medium text-purple-100 flex-shrink-0">
                Asignar Cta. Gasto a {n} {n === 1 ? 'factura' : 'facturas'}:
              </span>
              <ComboboxCuentaMasiva
                cuentas={planContable.filter(c => c.grupo !== '4')}
                value={ccMasiva}
                onChange={setCcMasiva}
              />
              <button
                onClick={handleAsignarCGMasivaLocal}
                disabled={!ccMasiva || asignandoCC || descargando}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-white text-purple-700 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-60 flex-shrink-0"
              >
                {asignandoCC ? <Spinner /> : <IconoCheck />}
                {asignandoCC ? 'Asignando...' : 'Asignar Cta. Gasto'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Modal confirmación exportación A3 */}
      {modalA3Open && (() => {
        const sel = filtradas.filter(f => seleccionados.has(f.id));
        const base    = sel.reduce((s, f) => s + parseFloat(f.datos_extraidos?.total_sin_iva ?? f.datos_extraidos?.total_factura ?? 0), 0);
        const cuota   = sel.reduce((s, f) => s + (Array.isArray(f.datos_extraidos?.iva) ? f.datos_extraidos.iva.reduce((x, e) => x + parseFloat(e.cuota ?? 0), 0) : 0), 0);
        const factura = sel.reduce((s, f) => s + parseFloat(f.datos_extraidos?.total_factura ?? 0), 0);
        const fmt     = v => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setModalA3Open(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="px-6 py-5 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Exportar Lote a A3</h2>
                <p className="text-sm text-gray-500 mt-0.5">Se generará el fichero CSV y las facturas pasarán a <strong>Contabilizadas</strong>.</p>
              </div>
              <div className="px-6 py-5 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Facturas seleccionadas</span>
                  <span className="font-semibold text-gray-900">{n}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total base (sin IVA)</span>
                  <span className="font-semibold text-gray-900">{fmt(base)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Total IVA</span>
                  <span className="font-semibold text-gray-900">{fmt(cuota)}</span>
                </div>
                <div className="flex justify-between text-sm border-t border-gray-100 pt-3">
                  <span className="font-semibold text-gray-700">Total factura</span>
                  <span className="font-bold text-gray-900">{fmt(factura)}</span>
                </div>
              </div>
              <div className="px-6 py-4 bg-gray-50 flex justify-end gap-3">
                <button
                  onClick={() => setModalA3Open(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleExportarA3}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors"
                >
                  Confirmar y Exportar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal configuracion exportacion SAGE */}
      {modalSageOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setModalSageOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Exportar a SAGE ContaPlus</h3>
              <p className="text-xs text-gray-400 mt-0.5">{seleccionados.size} factura(s) de {sageProveedores.length} proveedor(es)</p>
            </div>
            <div className="px-6 py-4">
              <p className="text-xs font-medium text-gray-600 mb-2">Numero de asiento inicial por proveedor</p>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500">Proveedor</th>
                      <th className="px-3 py-2 text-left font-semibold text-gray-500">Cuenta</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500">Facturas</th>
                      <th className="px-3 py-2 text-right font-semibold text-gray-500">Asiento inicio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sageProveedores.map(p => {
                      const pid = p.proveedor_id || 0;
                      const hayError = p.ya_exportadas > 0 || p.sin_cuentas > 0;
                      return (
                        <tr key={pid} className={hayError ? 'bg-red-50/40' : ''}>
                          <td className="px-3 py-2 font-medium text-gray-900 max-w-[180px] truncate">{p.razon_social}</td>
                          <td className="px-3 py-2 font-mono text-gray-500">{p.cta_proveedor || '-'}</td>
                          <td className="px-3 py-2 text-right text-gray-700">
                            {p.num_facturas}
                            {p.ya_exportadas > 0 && <span className="ml-1 text-red-500">({p.ya_exportadas} dup.)</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <input type="number" min={1}
                              value={sageAsientos[pid] || 1}
                              onChange={e => setSageAsientos(prev => ({ ...prev, [pid]: parseInt(e.target.value, 10) || 1 }))}
                              className="w-20 rounded border border-gray-200 px-2 py-1 text-xs text-right font-mono focus:outline-none focus:ring-2 focus:ring-orange-400" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-gray-400 mt-2">Se propone el siguiente al ultimo asiento exportado para cada proveedor</p>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-between gap-2">
              <button onClick={() => setModalSageOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
                Cancelar
              </button>
              <div className="flex gap-2">
                <button onClick={() => handleExportarSage(false)}
                  className="px-4 py-2 text-sm font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors">
                  Generar fichero
                </button>
                <button onClick={() => handleExportarSage(true)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors">
                  Generar y contabilizar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabla */}
      <TablaFacturas
        facturas={filtradas}
        seleccionados={seleccionados}
        onToggle={toggleSeleccion}
        onToggleTodo={toggleTodo}
        loading={loading}
        hayFiltros={hayFiltros}
        esAdmin={esAdmin}
        onRevertir={handleRevertir}
        onEliminar={handleEliminar}
        planContable={planContable}
        onAsignarCG={onAsignarCG}
        onDatosActualizados={onDatosActualizados}
        onProveedorActualizado={onProveedorActualizado}
        modoGestoria={modoGestoria}
      />
    </div>
  );
}
