import { useState, useMemo, useEffect, useRef } from 'react';
import TablaFacturas from './TablaFacturas.jsx';
import { descargarZip, contabilizar, revertirEstado, asignarCCMasivo } from '../api.js';

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
      {hayFiltros && (
        <button onClick={() => onChange({ proveedor: '', fechaDesde: '', fechaHasta: '' })}
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
        placeholder="Selecciona cuenta contable..."
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
  loading,
  onEstadoActualizado,
  planContable = [],
  onAsignarCC,
  onAsignarCCMasivo,
}) {
  const [filtros,       setFiltros]       = useState({ proveedor: '', fechaDesde: '', fechaHasta: '' });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [descargando,        setDescargando]        = useState(false);
  const [contabilizando,     setContabilizando]     = useState(false);
  const [asignandoCC,        setAsignandoCC]        = useState(false);
  const [ccMasiva,           setCcMasiva]           = useState('');
  const [error,              setError]              = useState('');

  const filtradas = useMemo(() => facturas.filter(f => {
    const d = f.datos_extraidos;
    if (filtros.proveedor  && f.proveedor !== filtros.proveedor) return false;
    if (filtros.fechaDesde && d?.fecha_emision && d.fecha_emision < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && d?.fecha_emision && d.fecha_emision > filtros.fechaHasta) return false;
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
        onEstadoActualizado(ids, 'DESCARGADA');
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

  async function handleAsignarCCMasivaLocal() {
    if (!ccMasiva) return;
    const ids = Array.from(seleccionados);
    setAsignandoCC(true); setError('');
    try {
      await asignarCCMasivo(ids, parseInt(ccMasiva, 10));
      onAsignarCCMasivo(ids, parseInt(ccMasiva, 10));
      setCcMasiva('');
      setSeleccionados(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setAsignandoCC(false);
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

            {/* Marcar como CONTABILIZADAS — solo en CC Asignada */}
            {tipo === 'cc_asignada' && (
              <button
                onClick={handleContabilizar}
                disabled={contabilizando || descargando || asignandoCC}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg transition-colors disabled:opacity-60"
              >
                {contabilizando ? <Spinner /> : <IconoCheck />}
                {contabilizando ? 'Contabilizando...' : `Contabilizar (${n})`}
              </button>
            )}
          </div>

          {/* Asignación masiva de CC — solo en Pendientes y Descargadas */}
          {(tipo === 'pendientes' || tipo === 'descargadas') && planContable.length > 0 && (
            <div className="flex items-center gap-3 bg-purple-600 text-white rounded-xl px-5 py-3 shadow-lg shadow-purple-200 flex-wrap">
              <span className="text-xs font-medium text-purple-100 flex-shrink-0">
                Asignar CC a {n} {n === 1 ? 'factura' : 'facturas'}:
              </span>
              <ComboboxCuentaMasiva
                cuentas={planContable}
                value={ccMasiva}
                onChange={setCcMasiva}
              />
              <button
                onClick={handleAsignarCCMasivaLocal}
                disabled={!ccMasiva || asignandoCC || descargando}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-white text-purple-700 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-60 flex-shrink-0"
              >
                {asignandoCC ? <Spinner /> : <IconoCheck />}
                {asignandoCC ? 'Asignando...' : 'Asignar CC'}
              </button>
            </div>
          )}
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
        planContable={planContable}
        onAsignarCC={onAsignarCC}
      />
    </div>
  );
}
