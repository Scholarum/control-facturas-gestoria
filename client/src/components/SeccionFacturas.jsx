import { useState, useEffect, useRef, useCallback } from 'react';
import TablaFacturas, { tieneIncidencia, tieneIncidenciaProveedor } from './TablaFacturas.jsx';
import { fetchFacturas, fetchFacturaIds, descargarZip, contabilizar, revertirEstado, eliminarFactura, asignarCGMasivo, exportarLoteA3, exportarSage, sagePreview } from '../api.js';

// Devuelve hoy en formato 'YYYY-MM-DD' usando getters locales (NO toISOString,
// que devuelve UTC y en madrugadas con offset CEST puede dar el dia anterior).
// Usado como default del input <type="date"> del modal SAGE.
function getHoyIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Filtros compactos por sección ────────────────────────────────────────────

const inputCls = 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function FiltrosSeccion({ filtros, onChange, proveedores, totalFacturas, totalFiltradas, numIncidencias, numSinProveedor }) {
  const hayFiltros = Object.values(filtros).some(Boolean);
  function set(k, v) { onChange({ ...filtros, [k]: v }); }

  return (
    <div className="flex flex-wrap gap-2 sm:gap-3 items-end">
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Proveedor</label>
        <input type="text" value={filtros.proveedor} onChange={e => set('proveedor', e.target.value)}
          placeholder="Buscar proveedor..." className={`${inputCls} sm:min-w-[160px]`} />
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">N.º Factura</label>
        <input type="text" value={filtros.numFactura} onChange={e => set('numFactura', e.target.value)}
          placeholder="Buscar num..." className={`${inputCls} sm:min-w-[120px]`} />
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">CIF</label>
        <input type="text" value={filtros.cif} onChange={e => set('cif', e.target.value)}
          placeholder="Buscar CIF..." className={`${inputCls} sm:min-w-[120px]`} />
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Fecha desde</label>
        <input type="date" value={filtros.fechaDesde} onChange={e => set('fechaDesde', e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Fecha hasta</label>
        <input type="date" value={filtros.fechaHasta} onChange={e => set('fechaHasta', e.target.value)} className={inputCls} />
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Extraccion</label>
        <select value={filtros.estadoExtraccion || ''} onChange={e => set('estadoExtraccion', e.target.value)} className={inputCls}>
          <option value="">Todos</option>
          <option value="SINCRONIZADA">Sin extraer</option>
          <option value="PROCESADA">Procesada</option>
          <option value="REVISION_MANUAL">Revision manual</option>
        </select>
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Datos</label>
        <select value={filtros.soloIncidencias || ''} onChange={e => set('soloIncidencias', e.target.value)}
          className={`${inputCls} sm:min-w-[130px] ${filtros.soloIncidencias === 'si' ? 'text-red-600 font-medium' : filtros.soloIncidencias === 'no' ? 'text-emerald-600 font-medium' : ''}`}>
          <option value="">Todos</option>
          <option value="si">Incompletos ({numIncidencias})</option>
          <option value="no">Completos ({totalFacturas - numIncidencias})</option>
        </select>
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Importe mín.</label>
        <input type="number" step="any" value={filtros.importeMin} onChange={e => set('importeMin', e.target.value)}
          placeholder="0,00" className={`${inputCls} sm:min-w-[100px]`} />
      </div>
      <div className="flex flex-col gap-1 w-[calc(50%-0.25rem)] sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Importe máx.</label>
        <input type="number" step="any" value={filtros.importeMax} onChange={e => set('importeMax', e.target.value)}
          placeholder="0,00" className={`${inputCls} sm:min-w-[100px]`} />
      </div>
      <div className="flex flex-col gap-1 w-full sm:w-auto">
        <label className="text-xs font-medium text-gray-500">Vinculacion</label>
        <select value={filtros.soloSinProveedor || ''} onChange={e => set('soloSinProveedor', e.target.value)}
          className={`${inputCls} sm:min-w-[140px] ${filtros.soloSinProveedor === 'si' ? 'text-orange-600 font-medium' : filtros.soloSinProveedor === 'no' ? 'text-emerald-600 font-medium' : ''}`}>
          <option value="">Todos</option>
          <option value="si">Sin proveedor/cta ({numSinProveedor})</option>
          <option value="no">Con proveedor ({totalFacturas - numSinProveedor})</option>
        </select>
      </div>
      {hayFiltros && (
        <button onClick={() => onChange({ proveedor: '', numFactura: '', cif: '', fechaDesde: '', fechaHasta: '', soloIncidencias: '', soloSinProveedor: '', estadoExtraccion: '', importeMin: '', importeMax: '' })}
          className="self-end px-3 py-1.5 text-sm text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors">
          Limpiar
        </button>
      )}
      {hayFiltros && (
        <span className="self-end text-xs text-gray-400 ml-auto">{totalFiltradas} de {totalFacturas}</span>
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
        className="rounded-lg border border-white/30 bg-white/10 text-white placeholder-white/50 px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-white/50 w-full sm:w-72 pr-6"
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
        <div className="absolute z-50 top-full left-0 w-full sm:w-80 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
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
const TIPO_ESTADO = { pendientes: 'PENDIENTE', descargadas: 'DESCARGADA', cc_asignada: 'CC_ASIGNADA', contabilizadas: 'CONTABILIZADA' };
const PAGE_SIZES = [25, 50, 100, 500];
const DEFAULT_PAGE_SIZE = 25;

export default function SeccionFacturas({
  tipo,
  empresaId,
  refreshKey,
  proveedores,
  esAdmin,
  soloLectura = false,
  onEstadoActualizado,
  onRefreshFacturas,
  planContable = [],
  onAsignarCG,
  onAsignarCGMasivo,
  onEliminarFactura,
  onDatosActualizados,
  onProveedorActualizado,
  modoGestoria = 'v2',
  focusFacturaId,
  onClearFocus,
  onIrAProveedorParaIrpf,   // (proveedorId, valoresPrecarga) → navega a Proveedores y expande la fila
}) {
  const esV1 = modoGestoria === 'v1';
  const [facturas,      setFacturas]     = useState([]);
  const [loading,       setLoading]      = useState(true);
  const [page,          setPage]         = useState(1);
  const [pageSize,      setPageSize]     = useState(DEFAULT_PAGE_SIZE);
  const [totalPages,    setTotalPages]   = useState(1);
  const [totalFacturas, setTotalFacturas] = useState(0);
  const [filtros,       setFiltrosRaw]   = useState({ proveedor: '', numFactura: '', cif: '', fechaDesde: '', fechaHasta: '', soloIncidencias: '', soloSinProveedor: '', estadoExtraccion: '', importeMin: '', importeMax: '' });
  const [filtrosActivos, setFiltrosActivos] = useState(filtros); // los que se envían al servidor
  const debounceRef = useRef(null);

  // Debounce de filtros: selects aplican inmediatamente, texto espera 400ms
  function setFiltros(nuevos) {
    setFiltrosRaw(nuevos);
    clearTimeout(debounceRef.current);
    // Si cambió un select (soloIncidencias, soloSinProveedor, estadoExtraccion) aplica ya
    const textoIgual = nuevos.proveedor === filtros.proveedor && nuevos.numFactura === filtros.numFactura && nuevos.cif === filtros.cif && nuevos.importeMin === filtros.importeMin && nuevos.importeMax === filtros.importeMax;
    if (textoIgual) {
      setFiltrosActivos(nuevos);
      setSeleccionados(new Set());
    } else {
      debounceRef.current = setTimeout(() => {
        setFiltrosActivos(nuevos);
        setSeleccionados(new Set());
      }, 400);
    }
  }

  // Cargar facturas paginadas con filtros server-side
  const loadFacturas = useCallback(async (p = 1, size = pageSize, f = filtrosActivos) => {
    if (!empresaId) return;
    setLoading(true);
    try {
      const limit = size === 'all' ? 10000 : size;
      const { data, pagination } = await fetchFacturas(empresaId, {
        estado: TIPO_ESTADO[tipo], page: size === 'all' ? 1 : p, limit, filtros: f,
      });
      setFacturas(data);
      setPage(pagination.page);
      setTotalPages(pagination.totalPages);
      setTotalFacturas(pagination.total);
    } catch { /* silenciar */ }
    setLoading(false);
  }, [empresaId, tipo, pageSize, filtrosActivos]);

  useEffect(() => { loadFacturas(1); }, [loadFacturas, refreshKey]);
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [descargando,        setDescargando]        = useState(false);
  const [contabilizando,     setContabilizando]     = useState(false);
  const [asignandoCC,        setAsignandoCC]        = useState(false);
  const [exportandoA3,       setExportandoA3]       = useState(false);
  const [exportandoSage,     setExportandoSage]     = useState(false);
  const [modalSageOpen,      setModalSageOpen]      = useState(false);
  const [sagePreviewData,    setSagePreviewData]    = useState(null);
  const [sageAsientoInicio,  setSageAsientoInicio]  = useState('');
  const [sageDocumentoInicio, setSageDocumentoInicio] = useState('');
  // Fecha override del asiento (pos 2/47/127). Init con hoy en local time
  // para evitar que el boton "Generar fichero" arranque disabled por valor vacio.
  const [sageFechaExportacion, setSageFechaExportacion] = useState(getHoyIso());
  const [sageError,          setSageError]          = useState('');
  const [modalA3Open,        setModalA3Open]        = useState(false);
  const [ccMasiva,           setCcMasiva]           = useState('');
  const [error,              setError]              = useState('');

  // Actualizacion optimista local sin recargar la lista: muta solo el registro tocado.
  // Se usa hoy para los dos campos SII del panel fiscal (ver PanelDetalleFiscal).
  function actualizarFacturaLocal(id, cambios) {
    setFacturas(prev => prev.map(f => f.id === id ? { ...f, ...cambios } : f));
  }

  // Limpiar selecciones cuando cambian las facturas visibles
  useEffect(() => {
    const ids = new Set(facturas.map(f => f.id));
    setSeleccionados(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)));
      return next.size !== prev.size ? next : prev;
    });
  }, [facturas]);

  function toggleSeleccion(id) {
    setSeleccionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const [seleccionandoTodo, setSeleccionandoTodo] = useState(false);

  // Select all: pide todos los IDs al servidor (no solo la página visible)
  async function toggleTodo() {
    if (seleccionados.size > 0) {
      setSeleccionados(new Set());
      return;
    }
    setSeleccionandoTodo(true);
    try {
      const ids = await fetchFacturaIds(empresaId, { estado: TIPO_ESTADO[tipo], filtros: filtrosActivos });
      setSeleccionados(new Set(ids));
    } catch {
      setSeleccionados(new Set(facturas.map(f => f.id)));
    } finally {
      setSeleccionandoTodo(false);
    }
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
    setSageError('');
    try {
      const ids = Array.from(seleccionados);
      const data = await sagePreview(ids);
      setSagePreviewData(data);
      setSageAsientoInicio(String(data.siguiente_asiento || 1));
      setSageDocumentoInicio(String(data.siguiente_documento || 1));
      setSageFechaExportacion(getHoyIso());
      setModalSageOpen(true);
    } catch (e) { setError(e.message); }
  }

  function validarEnteroPositivo(valor) {
    return /^\d+$/.test(String(valor).trim()) && parseInt(valor, 10) > 0;
  }

  async function handleExportarSage(marcarContabilizada) {
    setSageError('');
    if (!validarEnteroPositivo(sageAsientoInicio)) {
      setSageError('El asiento de inicio debe ser un número entero positivo');
      return;
    }
    if (!validarEnteroPositivo(sageDocumentoInicio)) {
      setSageError('El número de documento de inicio debe ser un entero positivo');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sageFechaExportacion)) {
      setSageError('La fecha de exportación es obligatoria y debe tener formato YYYY-MM-DD');
      return;
    }
    const ids = Array.from(seleccionados);
    setExportandoSage(true); setError(''); setModalSageOpen(false);
    try {
      const result = await exportarSage(
        ids,
        {
          asientoInicio:    parseInt(sageAsientoInicio, 10),
          documentoInicio:  parseInt(sageDocumentoInicio, 10),
          fechaExportacion: sageFechaExportacion,
        },
        marcarContabilizada
      );
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
        <FiltrosSeccion filtros={filtros} onChange={setFiltros} proveedores={proveedores}
          totalFacturas={totalFacturas} totalFiltradas={facturas.length}
          numIncidencias={facturas.filter(f => tieneIncidencia(f)).length}
          numSinProveedor={facturas.filter(f => tieneIncidenciaProveedor(f)).length} />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}

      {/* Barra de acciones — flotante cuando hay selección */}
      {haySeleccion && (
        <div className="space-y-2 sticky bottom-4 z-30">
          <div className="flex items-center gap-2 sm:gap-3 bg-blue-600 text-white rounded-xl px-3 sm:px-5 py-3 shadow-lg shadow-blue-200 flex-wrap">
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
        const sel = facturas.filter(f => seleccionados.has(f.id));
        const base    = sel.reduce((s, f) => s + parseFloat(f.datos_extraidos?.total_sin_iva ?? f.datos_extraidos?.total_factura ?? 0), 0);
        const cuota   = sel.reduce((s, f) => s + (Array.isArray(f.datos_extraidos?.iva) ? f.datos_extraidos.iva.reduce((x, e) => x + parseFloat(e.cuota ?? 0), 0) : 0), 0);
        const factura = sel.reduce((s, f) => s + parseFloat(f.datos_extraidos?.total_factura ?? 0), 0);
        const fmt     = v => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(v);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setModalA3Open(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[calc(100%-2rem)] sm:max-w-md mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
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

      {/* Modal configuracion exportacion SAGE — asiento + documento globales */}
      {modalSageOpen && sagePreviewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setModalSageOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[calc(100%-2rem)] sm:max-w-md mx-4" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">Exportar a SAGE ContaPlus (R75)</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {sagePreviewData.num_facturas} factura(s) · {sagePreviewData.proveedores.length} proveedor(es)
              </p>
            </div>

            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Asiento de Inicio
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={sageAsientoInicio}
                  onChange={e => { setSageAsientoInicio(e.target.value); setSageError(''); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Ej: 1"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Correlativo global: el mismo asiento se incrementa por cada factura del lote.
                  Último usado: <strong>{sagePreviewData.ultimo_asiento || 0}</strong>.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Número de Documento de Inicio
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={sageDocumentoInicio}
                  onChange={e => { setSageDocumentoInicio(e.target.value); setSageError(''); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Ej: 1"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Genera <span className="font-mono">F/0001</span> (cargo) o <span className="font-mono">A/0001</span> (abono) según el signo del importe.
                  Último usado: <strong>{sagePreviewData.ultimo_documento || 0}</strong>.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Fecha de exportación
                </label>
                <input
                  type="date"
                  value={sageFechaExportacion}
                  onChange={e => { setSageFechaExportacion(e.target.value); setSageError(''); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
                <p className="text-[10px] text-gray-400 mt-1">
                  Fecha que se usará para el asiento (pos 2), expedición (pos 47) y registro SII (pos 127).
                  Por defecto: hoy. La fecha de operación (pos 46) sigue siendo la fecha del PDF.
                </p>
              </div>

              {(sagePreviewData.ya_exportadas > 0 || sagePreviewData.sin_cuentas > 0) && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  {sagePreviewData.ya_exportadas > 0 && <div>⚠ {sagePreviewData.ya_exportadas} factura(s) ya exportadas previamente</div>}
                  {sagePreviewData.sin_cuentas > 0 && <div>⚠ {sagePreviewData.sin_cuentas} factura(s) sin cuenta contable o de gasto</div>}
                </div>
              )}

              {sageError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                  {sageError}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-between gap-2">
              <button onClick={() => setModalSageOpen(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors">
                Cancelar
              </button>
              <div className="flex gap-2">
                <button onClick={() => handleExportarSage(false)}
                  disabled={!validarEnteroPositivo(sageAsientoInicio) || !validarEnteroPositivo(sageDocumentoInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(sageFechaExportacion)}
                  className="px-4 py-2 text-sm font-semibold text-orange-700 bg-orange-50 hover:bg-orange-100 border border-orange-200 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  Generar fichero
                </button>
                <button onClick={() => handleExportarSage(true)}
                  disabled={!validarEnteroPositivo(sageAsientoInicio) || !validarEnteroPositivo(sageDocumentoInicio) || !/^\d{4}-\d{2}-\d{2}$/.test(sageFechaExportacion)}
                  className="px-4 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                  Generar y contabilizar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Paginación + selector de tamaño — encima de la tabla, debajo de los filtros */}
      {totalFacturas > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2 bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Mostrar</span>
            <select
              value={pageSize}
              onChange={e => {
                const v = e.target.value === 'all' ? 'all' : Number(e.target.value);
                setPageSize(v);
                loadFacturas(1, v);
              }}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white text-gray-700"
            >
              {PAGE_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
              <option value="all">Todos</option>
            </select>
            <span className="text-xs text-gray-500">
              {pageSize === 'all'
                ? `${totalFacturas} facturas`
                : `Pagina ${page} de ${totalPages} (${totalFacturas} facturas)`
              }
            </span>
          </div>
          {pageSize !== 'all' && totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => loadFacturas(1)} disabled={page <= 1}
                className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">&laquo;</button>
              <button onClick={() => loadFacturas(page - 1)} disabled={page <= 1}
                className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">&lsaquo;</button>
              <button onClick={() => loadFacturas(page + 1)} disabled={page >= totalPages}
                className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">&rsaquo;</button>
              <button onClick={() => loadFacturas(totalPages)} disabled={page >= totalPages}
                className="px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30">&raquo;</button>
            </div>
          )}
        </div>
      )}

      {/* Tabla */}
      <TablaFacturas
        facturas={facturas}
        seleccionados={seleccionados}
        onToggle={toggleSeleccion}
        onToggleTodo={toggleTodo}
        seleccionandoTodo={seleccionandoTodo}
        loading={loading}
        hayFiltros={hayFiltros}
        esAdmin={esAdmin}
        onRevertir={handleRevertir}
        onEliminar={handleEliminar}
        planContable={planContable}
        onAsignarCG={onAsignarCG}
        onDatosActualizados={onDatosActualizados}
        onActualizarFacturaLocal={actualizarFacturaLocal}
        onProveedorActualizado={onProveedorActualizado}
        modoGestoria={modoGestoria}
        focusFacturaId={focusFacturaId}
        onClearFocus={onClearFocus}
        onIrAProveedorParaIrpf={onIrAProveedorParaIrpf}
      />
    </div>
  );
}
