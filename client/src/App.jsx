import { useState, useEffect, useMemo, useRef } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import Login          from './pages/Login.jsx';
import Usuarios       from './pages/Usuarios.jsx';
import MiPerfil       from './pages/MiPerfil.jsx';
import Conciliacion   from './pages/Conciliacion.jsx';
import Historial      from './pages/Historial.jsx';
import Configuracion  from './pages/Configuracion.jsx';
import Proveedores    from './pages/Proveedores.jsx';
import SeccionFacturas from './components/SeccionFacturas.jsx';
import HistorialA3    from './pages/HistorialA3.jsx';
import { fetchFacturas, fetchProveedores, exportarExcel, triggerSyncManual, fetchPlanContable, asignarCuentaGasto, asignarCGMasivo, autodetectarProveedores, aplicarCuentasProveedor } from './api.js';

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
  const { user, loading: authLoading, logout, puedeVer, puedeEditar } = useAuth();

  const [tab,             setTab]             = useState('facturas');
  const [subTab,          setSubTab]          = useState('pendientes');
  const [todasFacturas,   setTodasFacturas]   = useState([]);
  const [proveedores,     setProveedores]     = useState([]);
  const [loading,         setLoading]         = useState(true);
  const [error,           setError]           = useState(null);
  const [exportandoTotal, setExportandoTotal] = useState(false);
  const [sincronizando,      setSincronizando]      = useState(false);
  const [aplicandoCuentas,   setAplicandoCuentas]   = useState(false);
  const [syncMsg,         setSyncMsg]         = useState(null); // { ok, texto }
  const [planContable,    setPlanContable]    = useState([]);
  const [alertaProveedores, setAlertaProveedores] = useState([]); // proveedores sin cuentas
  const [adminMenuOpen,   setAdminMenuOpen]   = useState(false);
  const [userMenuOpen,    setUserMenuOpen]    = useState(false);
  const adminMenuRef = useRef(null);
  const userMenuRef  = useRef(null);

  // Redirigir tabs inaccesibles si el rol cambia
  useEffect(() => {
    if (!user) return;
    if ((tab === 'usuarios' || tab === 'configuracion') && user.rol !== 'ADMIN') {
      setTab('facturas');
    }
  }, [user, tab]);

  // Carga inicial — facturas y proveedores controlan el spinner de carga
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

  // Plan contable — carga independiente, no bloquea la UI
  useEffect(() => {
    if (!user) return;
    fetchPlanContable().then(setPlanContable).catch(() => {});
  }, [user]);

  // Autodetectar proveedores nuevos por CIF tras cargar facturas
  useEffect(() => {
    if (!user || loading) return;
    autodetectarProveedores()
      .then(({ sinCuentas }) => setAlertaProveedores(sinCuentas))
      .catch(() => {});
  }, [user, loading]);

  // Cerrar dropdowns al clicar fuera
  useEffect(() => {
    function handler(e) {
      if (adminMenuRef.current && !adminMenuRef.current.contains(e.target)) setAdminMenuOpen(false);
      if (userMenuRef.current  && !userMenuRef.current.contains(e.target))  setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Listas por estado (reactivas a todasFacturas)
  const pendientes     = useMemo(() => todasFacturas.filter(f => (f.estado_gestion || 'PENDIENTE') === 'PENDIENTE'), [todasFacturas]);
  const descargadas    = useMemo(() => todasFacturas.filter(f => f.estado_gestion === 'DESCARGADA'),    [todasFacturas]);
  const ccAsignadas    = useMemo(() => todasFacturas.filter(f => f.estado_gestion === 'CC_ASIGNADA'),   [todasFacturas]);
  const contabilizadas = useMemo(() => todasFacturas.filter(f => f.estado_gestion === 'CONTABILIZADA'), [todasFacturas]);

  // Stats en tiempo real
  const stats = useMemo(() => ({
    total:          todasFacturas.length,
    pendientes:     pendientes.length,
    descargadas:    descargadas.length,
    ccAsignadas:    ccAsignadas.length,
    contabilizadas: contabilizadas.length,
  }), [todasFacturas, pendientes, descargadas, ccAsignadas, contabilizadas]);

  // Callback cuando una SeccionFacturas mueve facturas de estado
  function handleEstadoActualizado(ids, nuevoEstado) {
    setTodasFacturas(prev => prev.map(f =>
      ids.includes(f.id) ? { ...f, estado_gestion: nuevoEstado } : f
    ));
    // Si contabilizamos desde Descargadas, saltar a Contabilizadas automáticamente
    if (nuevoEstado === 'CONTABILIZADA') setSubTab('contabilizadas');
    // Si descargamos desde Pendientes, saltar a Descargadas
    if (nuevoEstado === 'DESCARGADA')    setSubTab('descargadas');
    if (nuevoEstado === 'CC_ASIGNADA')   setSubTab('cc_asignada');
  }

  async function handleAsignarCG(id, cgId) {
    try {
      const result = await asignarCuentaGasto(id, cgId);
      setTodasFacturas(prev => prev.map(f =>
        f.id === id
          ? { ...f, cg_manual_id: cgId, cg_efectiva_id: result.cg_efectiva_id, estado_gestion: result.estado_gestion }
          : f
      ));
      if (result.estado_gestion === 'CC_ASIGNADA') setSubTab('cc_asignada');
    } catch (e) {
      setError(e.message);
    }
  }

  function handleAsignarCGMasivo(ids, cgId) {
    setTodasFacturas(prev => prev.map(f =>
      ids.includes(f.id)
        ? { ...f, cg_manual_id: cgId, cg_efectiva_id: cgId, estado_gestion: 'CC_ASIGNADA' }
        : f
    ));
    setSubTab('cc_asignada');
  }

  async function handleRefreshFacturas() {
    try {
      const nuevas = await fetchFacturas();
      setTodasFacturas(nuevas);
    } catch (_) {}
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

  async function handleAplicarCuentasProveedor() {
    setAplicandoCuentas(true); setError('');
    try {
      const result = await aplicarCuentasProveedor();
      const nuevas = await fetchFacturas();
      setTodasFacturas(nuevas);
      setSyncMsg({ ok: true, texto: `${result.actualizadas} factura${result.actualizadas !== 1 ? 's' : ''} pasada${result.actualizadas !== 1 ? 's' : ''} a "Cta. Gasto"` });
      setTimeout(() => setSyncMsg(null), 5000);
    } catch (e) {
      setError(e.message);
    } finally {
      setAplicandoCuentas(false);
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

  // ── Pestañas principales (nav) ──────────────────────────────────────────────
  const tabs = [
    { id: 'facturas',     label: 'Facturas',              visible: puedeVer('facturas')     },
    { id: 'conciliacion', label: 'Conciliación de Mayor', visible: puedeVer('conciliacion') },
    { id: 'historial_a3', label: 'Historial A3',          visible: puedeVer('facturas')     },
    { id: 'historial',    label: 'Historial',             visible: puedeVer('historial')    },
  ].filter(t => t.visible);

  const ADMIN_TABS = ['usuarios', 'proveedores', 'configuracion'];
  const tabAdminActivo  = ADMIN_TABS.includes(tab);
  const hayMenuAdmin    = puedeVer('usuarios') || puedeVer('proveedores') || puedeVer('configuracion');

  const subTabs = [
    { id: 'pendientes',     label: 'Pendientes',     count: stats.pendientes,     color: 'text-amber-600',   bg: 'bg-amber-600'   },
    { id: 'descargadas',    label: 'Descargadas',    count: stats.descargadas,    color: 'text-blue-600',    bg: 'bg-blue-600'    },
    { id: 'cc_asignada',    label: 'Cta. Gasto',     count: stats.ccAsignadas,    color: 'text-purple-600',  bg: 'bg-purple-600'  },
    { id: 'contabilizadas', label: 'Contabilizadas', count: stats.contabilizadas, color: 'text-emerald-600', bg: 'bg-emerald-600' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
        <div className="max-w-screen-xl mx-auto px-6 h-14 flex items-center gap-4">

          {/* Logo */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xl">🧾</span>
            <span className="font-semibold text-gray-900 text-sm hidden sm:block">Control de Facturas</span>
          </div>

          {/* Pestañas principales */}
          <nav className="flex gap-1 flex-1">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  tab === t.id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                {t.label}
              </button>
            ))}
          </nav>

          {/* Dropdown Administración */}
          {hayMenuAdmin && (
            <div ref={adminMenuRef} className="relative flex-shrink-0">
              <button
                onClick={() => setAdminMenuOpen(o => !o)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  tabAdminActivo ? 'bg-gray-800 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
                <span className="hidden md:inline">Administración</span>
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 transition-transform ${adminMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
                </svg>
              </button>
              {adminMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
                  {[
                    { id: 'proveedores',   icon: '🏢', label: 'Proveedores',  visible: puedeVer('proveedores')   },
                    { id: 'usuarios',      icon: '👥', label: 'Usuarios',     visible: puedeVer('usuarios')      },
                    { id: 'configuracion', icon: '⚙️',  label: 'Configuración', visible: puedeVer('configuracion') },
                  ].filter(i => i.visible).map(item => (
                    <button
                      key={item.id}
                      onClick={() => { setTab(item.id); setAdminMenuOpen(false); }}
                      className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors ${
                        tab === item.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <span>{item.icon}</span>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Menú de usuario */}
          <div ref={userMenuRef} className="relative flex-shrink-0">
            <button
              onClick={() => setUserMenuOpen(o => !o)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors ${
                tab === 'perfil' ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              <div className="h-6 w-6 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {user.nombre?.charAt(0).toUpperCase()}
              </div>
              <span className="hidden sm:block max-w-[120px] truncate">{user.nombre}</span>
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-xs font-medium text-gray-900 truncate">{user.nombre}</p>
                  <p className="text-xs text-gray-400">{esAdmin ? 'Administrador' : 'Gestoría'}</p>
                </div>
                <button
                  onClick={() => { setTab('perfil'); setUserMenuOpen(false); }}
                  className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 transition-colors ${
                    tab === 'perfil' ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
                  </svg>
                  Mi Perfil
                </button>
                <button
                  onClick={logout}
                  className="w-full text-left px-4 py-2 text-sm flex items-center gap-2.5 text-red-600 hover:bg-red-50 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
                  </svg>
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>

        </div>
      </header>

      <main className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">

        {/* ── Banner: proveedores detectados sin cuentas ── */}
        {alertaProveedores.length > 0 && esAdmin && (
          <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-4 flex items-start gap-4">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-800">
                {alertaProveedores.length} {alertaProveedores.length === 1 ? 'proveedor detectado' : 'proveedores detectados'} sin cuenta contable
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Se han identificado por CIF en las facturas importadas. Ve a <button onClick={() => setTab('proveedores')} className="font-semibold underline hover:text-amber-900">Proveedores</button> y registra su cuenta contable para poder gestionar sus facturas.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {alertaProveedores.slice(0, 8).map(p => (
                  <span key={p.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
                    {p.razon_social}
                    {p.cif && <span className="font-mono text-amber-600">({p.cif})</span>}
                  </span>
                ))}
                {alertaProveedores.length > 8 && (
                  <span className="text-xs text-amber-600">+{alertaProveedores.length - 8} más</span>
                )}
              </div>
            </div>
            <button onClick={() => setAlertaProveedores([])} className="text-amber-400 hover:text-amber-600 flex-shrink-0 text-lg leading-none">✕</button>
          </div>
        )}

        {/* ── Pestaña Usuarios ── */}
        {tab === 'usuarios' && puedeVer('usuarios') && <Usuarios />}

        {/* ── Pestaña Proveedores ── */}
        {tab === 'proveedores' && puedeVer('proveedores') && <Proveedores />}

        {/* ── Pestaña Conciliación ── */}
        {tab === 'conciliacion' && <Conciliacion proveedores={proveedores} />}

        {/* ── Pestaña Historial A3 ── */}
        {tab === 'historial_a3' && <HistorialA3 />}

        {/* ── Pestaña Historial ── */}
        {tab === 'historial' && <Historial usuario={user} />}

        {/* ── Pestaña Configuración ── */}
        {tab === 'configuracion' && puedeVer('configuracion') && (
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard label="Total"          value={stats.total}          color="text-gray-900" />
              <StatCard label="Pendientes"     value={stats.pendientes}     color="text-amber-600" />
              <StatCard label="Descargadas"    value={stats.descargadas}    color="text-blue-600" />
              <StatCard label="Cta. Gasto"     value={stats.ccAsignadas}    color="text-purple-600" />
              <StatCard label="Contabilizadas" value={stats.contabilizadas} color="text-emerald-600" />
            </div>

            {/* Botones de administración */}
            {(esAdmin || puedeEditar('aplicar_cuentas')) && (
              <div className="flex items-center gap-3 flex-wrap">
                {esAdmin && (
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
                )}
                {puedeEditar('aplicar_cuentas') && (
                  <button
                    onClick={handleAplicarCuentasProveedor}
                    disabled={aplicandoCuentas || sincronizando}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg shadow-sm transition-colors disabled:opacity-60"
                  >
                    {aplicandoCuentas ? (
                      <svg className="h-4 w-4 animate-spin text-purple-500" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    )}
                    {aplicandoCuentas ? 'Aplicando...' : 'Aplicar cuentas de proveedor'}
                  </button>
                )}
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
                soloLectura={!puedeEditar('facturas')}
                loading={loading}
                planContable={planContable}
                onEstadoActualizado={handleEstadoActualizado}
                onAsignarCG={handleAsignarCG}
                onAsignarCGMasivo={handleAsignarCGMasivo}
              />
            )}
            {subTab === 'descargadas' && (
              <SeccionFacturas
                tipo="descargadas"
                facturas={descargadas}
                proveedores={proveedores}
                esAdmin={esAdmin}
                soloLectura={!puedeEditar('facturas')}
                loading={loading}
                planContable={planContable}
                onEstadoActualizado={handleEstadoActualizado}
                onAsignarCG={handleAsignarCG}
                onAsignarCGMasivo={handleAsignarCGMasivo}
              />
            )}
            {subTab === 'cc_asignada' && (
              <SeccionFacturas
                tipo="cc_asignada"
                facturas={ccAsignadas}
                proveedores={proveedores}
                esAdmin={esAdmin}
                soloLectura={!puedeEditar('facturas')}
                loading={loading}
                planContable={planContable}
                onEstadoActualizado={handleEstadoActualizado}
                onRefreshFacturas={handleRefreshFacturas}
                onAsignarCG={handleAsignarCG}
              />
            )}
            {subTab === 'contabilizadas' && (
              <SeccionFacturas
                tipo="contabilizadas"
                facturas={contabilizadas}
                proveedores={proveedores}
                esAdmin={esAdmin}
                soloLectura={!puedeEditar('facturas')}
                loading={loading}
                planContable={planContable}
                onEstadoActualizado={handleEstadoActualizado}
                onAsignarCG={handleAsignarCG}
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
