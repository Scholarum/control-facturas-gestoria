import { useState, useEffect, useMemo } from 'react';
import Filtros           from './components/Filtros.jsx';
import TablaFacturas     from './components/TablaFacturas.jsx';
import ModalContabilizar from './components/ModalContabilizar.jsx';
import { fetchFacturas, fetchProveedores, descargarZip, contabilizar } from './api.js';

// ─── Stats ────────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [todasFacturas, setTodasFacturas] = useState([]);
  const [proveedores,   setProveedores]   = useState([]);
  const [filtros, setFiltros] = useState({ proveedor: '', estado: '', fechaDesde: '', fechaHasta: '' });
  const [seleccionados, setSeleccionados] = useState(new Set());
  const [loading,     setLoading]     = useState(true);
  const [descargando, setDescargando] = useState(false);
  const [contabilizando, setContabilizando] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState(null);

  // Carga inicial
  useEffect(() => {
    Promise.all([
      fetchFacturas().then(setTodasFacturas),
      fetchProveedores().then(setProveedores),
    ])
      .catch(() => setError('No se pudo conectar con el servidor. ¿Está corriendo npm start?'))
      .finally(() => setLoading(false));
  }, []);

  // Filtrado en cliente (sin llamadas extra al servidor)
  const facturas = useMemo(() => {
    return todasFacturas.filter(f => {
      const datos = f.datos_extraidos;
      if (filtros.proveedor && f.proveedor !== filtros.proveedor) return false;
      if (filtros.estado    && (f.estado_gestion || 'PENDIENTE') !== filtros.estado) return false;
      if (filtros.fechaDesde && datos?.fecha_emision && datos.fecha_emision < filtros.fechaDesde) return false;
      if (filtros.fechaHasta && datos?.fecha_emision && datos.fecha_emision > filtros.fechaHasta) return false;
      return true;
    });
  }, [todasFacturas, filtros]);

  // Stats globales (sobre TODAS las facturas, no el filtro actual)
  const stats = useMemo(() => ({
    total:         todasFacturas.length,
    pendientes:    todasFacturas.filter(f => (f.estado_gestion || 'PENDIENTE') === 'PENDIENTE').length,
    descargadas:   todasFacturas.filter(f => f.estado_gestion === 'DESCARGADA').length,
    contabilizadas:todasFacturas.filter(f => f.estado_gestion === 'CONTABILIZADA').length,
  }), [todasFacturas]);

  // Selección
  function toggleSeleccion(id) {
    setSeleccionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleTodo() {
    setSeleccionados(prev =>
      prev.size === facturas.length ? new Set() : new Set(facturas.map(f => f.id))
    );
  }

  // Descarga ZIP
  async function handleDescargar() {
    if (!seleccionados.size) return;
    setDescargando(true);
    setError(null);
    try {
      await descargarZip(Array.from(seleccionados));
      // Actualizar estado local a DESCARGADA
      setTodasFacturas(prev => prev.map(f =>
        seleccionados.has(f.id) && f.estado_gestion !== 'CONTABILIZADA'
          ? { ...f, estado_gestion: 'DESCARGADA' }
          : f
      ));
      setShowModal(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setDescargando(false);
    }
  }

  // Contabilizar
  async function handleContabilizar() {
    setContabilizando(true);
    try {
      await contabilizar(Array.from(seleccionados));
      setTodasFacturas(prev => prev.map(f =>
        seleccionados.has(f.id) ? { ...f, estado_gestion: 'CONTABILIZADA' } : f
      ));
      setShowModal(false);
      setSeleccionados(new Set());
    } catch (e) {
      setError(e.message);
    } finally {
      setContabilizando(false);
    }
  }

  const hayFiltros = Object.values(filtros).some(Boolean);

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">🧾</span>
            <span className="font-semibold text-gray-900 text-base">Control de Facturas</span>
          </div>
          <div className="text-xs text-gray-400">
            {facturas.length !== todasFacturas.length
              ? `Mostrando ${facturas.length} de ${todasFacturas.length} facturas`
              : `${todasFacturas.length} facturas en total`}
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total"          value={stats.total}          color="text-gray-900" />
          <StatCard label="Pendientes"     value={stats.pendientes}     color="text-amber-600" />
          <StatCard label="Descargadas"    value={stats.descargadas}    color="text-blue-600" />
          <StatCard label="Contabilizadas" value={stats.contabilizadas} color="text-emerald-600" />
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
          </div>
        )}

        {/* Filtros */}
        <Filtros filtros={filtros} onChange={setFiltros} proveedores={proveedores} />

        {/* Barra de acciones (cuando hay selección) */}
        {seleccionados.size > 0 && (
          <div className="flex items-center gap-3 bg-blue-600 text-white rounded-xl px-5 py-3 shadow-lg shadow-blue-200">
            <span className="text-sm font-medium flex-1">
              {seleccionados.size} {seleccionados.size === 1 ? 'factura seleccionada' : 'facturas seleccionadas'}
            </span>
            <button
              onClick={() => setSeleccionados(new Set())}
              className="px-3 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-400 rounded-lg transition-colors"
            >
              Deseleccionar
            </button>
            <button
              onClick={handleDescargar}
              disabled={descargando}
              className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-white text-blue-700 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-60"
            >
              {descargando ? (
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              )}
              {descargando ? 'Generando ZIP...' : `Descargar selección (${seleccionados.size})`}
            </button>
          </div>
        )}

        {/* Tabla */}
        <TablaFacturas
          facturas={facturas}
          seleccionados={seleccionados}
          onToggle={toggleSeleccion}
          onToggleTodo={toggleTodo}
          loading={loading}
          hayFiltros={hayFiltros}
        />

      </main>

      {/* Modal contabilizar */}
      {showModal && (
        <ModalContabilizar
          count={seleccionados.size}
          onContabilizar={handleContabilizar}
          onCerrar={() => setShowModal(false)}
          cargando={contabilizando}
        />
      )}

    </div>
  );
}
