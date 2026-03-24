import { useState, useEffect, useMemo } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login          from './pages/Login.jsx';
import Usuarios       from './pages/Usuarios.jsx';
import MiPerfil       from './pages/MiPerfil.jsx';
import Conciliacion   from './pages/Conciliacion.jsx';
import Historial      from './pages/Historial.jsx';
import Configuracion  from './pages/Configuracion.jsx';
import Proveedores    from './pages/Proveedores.jsx';
import SeccionFacturas from './components/SeccionFacturas.jsx';
import { fetchFacturas, fetchProveedores, exportarExcel, triggerSyncManual } from './api.js';

// ─── Stats ────────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

// ─── Inner app (requires auth context) ───────────────────────────────────────

function AppInner() {
  const { user, loading: authLoading, logout } = useAuth();

  const [tab,             setTab]             = useState('facturas');
  const [subTab,          setSubTab]          = useState('pendientes');
  const [todasFacturas,   setTodasFacturas]   = useState([]);
  const [proveedores,     setProveedores]     = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [exportandoTotal, setExportandoTotal] = useState(false);
  const [sincronizando,   setSincronizando]   = useState(false);
  const [syncMsg,         setSyncMsg]         = useState(null); // { ok, texto }

  // Redirigir tabs inaccesibles si el rol cambia
  useEffect(() => {
    if (!user) return;
    if ((tab === 'usuarios' || tab === 'configuracion') && user.rol !== 'ADMIN') {
      setTab('facturas');
    }
  }, [user, tab]);

  // Carga inicial
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    Promise.all([
      fetchFacturas().then(setTodasFacturas),
      fetchProveedores().then(setProveedores),
    ])
      .catch(() => setError('No se pudo conectar con el servidor.'))
      .finally(() => setLoading(false));
  }, [user]);

  // Listas por estado (reactivas a todasFacturas)
  const pendientes     = useMemo(() => todasFacturas.filter(f => (f.estado_gestion || 'PENDIENTE') === 'PENDIENTE'), [todasFacturas]);
  const descargadas    = useMemo(() => todasFacturas.filter(f => f.estado_gestion === 'DESCARGADA'),    [todasFacturas]);
  const contabilizadas = useMemo(() => todasFacturas.filter(f => f.estado_gestion === 'CONTABILIZADA'), [todasFacturas]);

  // Stats en tiempo real
  const stats = useMemo(() => ({
    total:          todasFacturas.length,
    pendientes:     pendientes.length,
    descargadas:    descargadas.length,
    contabilizadas: contabilizadas.length,
  }), [todasFacturas, pendientes, descargadas, contabilizadas]);

  // Callback cuando una SeccionFacturas mueve facturas de estado
  function handleEstadoActualizado(ids, nuevoEstado) {
    setTodasFacturas(prev => prev.map(f =>
      ids.includes(f.id) ? { ...f, estado_gestion: nuevoEstado } : f
    ));
    // Si contabilizamos desde Descargadas, saltar a Contabilizadas automáticamente
    if (nuevoEstado === 'CONTABILIZADA') setSubTab('contabilizadas');
    // Si descargamos desde Pendientes, saltar a Descargadas
    if (nuevoEstado === 'DESCARGADA')    setSubTab('descargadas');
  }

  // Callback para re-extracción desde Configuración
  function handleFacturaActualizada(id, estado, datos) {
    setTodasFacturas(prev => prev.map(f =>
      f.id === id ? { ...f, estado, datos_extraidos: datos } : f
    ));
  }

  // Sincronización manual con Drive (solo admin)
  async function handleSyncManual() {
    setSincronizando(true); setSyncMsg(null);
    try {
      const result = await triggerSyncManual();
      setSyncMsg({ ok: true, texto: `Sincronización completada: ${result.facturas_nuevas} facturas nuevas` });
      // Recargar lista de facturas
      const nuevas = await fetchFacturas();
      setTodasFacturas(nuevas);
    } catch (e) {
      setSyncMsg({ ok: false, texto: e.message });
    } finally {
      setSincronizando(false);
      setTimeout(() => setSyncMsg(null), 5000);
    }
  }

  // Excel con todas las facturas sin filtros
  async function handleExportarTotal() {
    if (!todasFacturas.length) return;
    setExportandoTotal(true);
    try {
      await exportarExcel(todasFacturas.map(f => f.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setExportandoTotal(false);
    }
  }

  const esAdmin = user?.rol === 'ADMIN';

  // ── Pantalla de carga del auth ──────────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <svg className="h-8 w-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      </div>
    );
  }

  // ── Login ───────────────────────────────────────────────────────────────────
  if (!user) return <Login />;

  // ── Pestañas disponibles ────────────────────────────────────────────────────
  const tabs = [
    { id: 'facturas',      label: 'Facturas' },
    { id: 'conciliacion',  label: 'Conciliación SAGE' },
    { id: 'historial',     label: 'Historial' },
    ...(esAdmin ? [
      { id: 'usuarios',      label: 'Usuarios' },
      { id: 'proveedores',   label: 'Proveedores' },
      { id: 'configuracion', label: '⚙ Configuración' },
    ] : []),
    { id: 'perfil',        label: 'Mi Perfil' },
  ];

  const subTabs = [
    { id: 'pendientes',     label: 'Pendientes',     count: stats.pendientes,     color: 'text-amber-600',   bg: 'bg-amber-600'   },
    { id: 'descargadas',    label: 'Descargadas',    count: stats.descargadas,    color: 'text-blue-600',    bg: 'bg-blue-600'    },
    { id: 'contabilizadas', label: 'Contabilizadas', count: stats.contabilizadas, color: 'text-emerald-600', bg: 'bg-emerald-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="text-xl">🧾</span>
            <span className="font-semibold text-gray-900 text-base">Control de Facturas</span>
          </div>

          {/* Pestañas */}
          <nav className="flex gap-1 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {t.label}
              </button>
            ))}
          </nav>

          {/* Usuario + logout */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-900 leading-none">{user.nombre}</p>
              <p className="text-xs text-gray-400 mt-0.5">{user.rol === 'ADMIN' ? 'Administrador' : 'Gestoría'}</p>
            </div>
            <button
              onClick={logout}
              className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">

        {/* ── Pestaña Usuarios (solo ADMIN) ── */}
        {tab === 'usuarios' && esAdmin && <Usuarios />}

        {/* ── Pestaña Proveedores (solo ADMIN) ── */}
        {tab === 'proveedores' && esAdmin && <Proveedores />}

        {/* ── Pestaña Conciliación ── */}
        {tab === 'conciliacion' && <Conciliacion proveedores={proveedores} />}

        {/* ── Pestaña Historial ── */}
        {tab === 'historial' && <Historial usuario={user} />}

        {/* ── Pestaña Configuración (solo ADMIN) ── */}
        {tab === 'configuracion' && esAdmin && (
          <Configuracion
            todasFacturas={todasFacturas}
            onFacturasActualizadas={handleFacturaActualizada}
          />
        )}

        {/* ── Pestaña Mi Perfil ── */}
        {tab === 'perfil' && <MiPerfil />}

        {/* ── Pestaña Facturas ── */}
        {tab === 'facturas' && (
          <div className="space-y-4">

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total"          value={stats.total}          color="text-gray-900" />
              <StatCard label="Pendientes"     value={stats.pendientes}     color="text-amber-600" />
              <StatCard label="Descargadas"    value={stats.descargadas}    color="text-blue-600" />
              <StatCard label="Contabilizadas" value={stats.contabilizadas} color="text-emerald-600" />
            </div>

            {/* Botón sincronización manual (solo admin) */}
            {esAdmin && (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSyncManual}
                  disabled={sincronizando}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg shadow-sm transition-colors disabled:opacity-60"
                >
                  {sincronizando ? (
                    <svg className="h-4 w-4 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {sincronizando ? 'Sincronizando...' : 'Sincronizar con Drive'}
                </button>
                {syncMsg && (
                  <span className={`text-sm font-medium ${syncMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>
                    {syncMsg.ok ? '✓' : '✗'} {syncMsg.texto}
                  </span>
                )}
              </div>
            )}

            {/* Error global */}
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">✕</button>
              </div>
            )}

            {/* Excel completo — todas las facturas, sin filtros */}
            <div className="flex justify-end">
              <button
                onClick={handleExportarTotal}
                disabled={exportandoTotal || todasFacturas.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors disabled:opacity-50"
              >
                {exportandoTotal ? (
                  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v3.586l-1.293-1.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V8z" clipRule="evenodd" />
                  </svg>
                )}
                {exportandoTotal ? 'Exportando...' : `Exportar Excel completo (${todasFacturas.length})`}
              </button>
            </div>

            {/* Sub-tabs */}
            <div className="flex gap-2 border-b border-gray-200 pb-0">
              {subTabs.map(st => (
                <button
                  key={st.id}
                  onClick={() => setSubTab(st.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                    subTab === st.id
                      ? `border-blue-600 text-blue-700 bg-blue-50`
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {st.label}
                  <span className={`inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-xs font-bold ${
                    subTab === st.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {st.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Sección activa */}
            {subTab === 'pendientes' && (
              <SeccionFacturas
                tipo="pendientes"
                facturas={pendientes}
                proveedores={proveedores}
                esAdmin={esAdmin}
                loading={loading}
                onEstadoActualizado={handleEstadoActualizado}
              />
            )}
            {subTab === 'descargadas' && (
              <SeccionFacturas
                tipo="descargadas"
                facturas={descargadas}
                proveedores={proveedores}
                esAdmin={esAdmin}
                loading={loading}
                onEstadoActualizado={handleEstadoActualizado}
              />
            )}
            {subTab === 'contabilizadas' && (
              <SeccionFacturas
                tipo="contabilizadas"
                facturas={contabilizadas}
                proveedores={proveedores}
                esAdmin={esAdmin}
                loading={loading}
                onEstadoActualizado={handleEstadoActualizado}
              />
            )}

          </div>
        )}

      </main>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
