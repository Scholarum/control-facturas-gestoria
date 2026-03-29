import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiLogin, apiLoginGoogle, apiMe, storeToken, clearToken, getStoredToken } from '../api.js';

const AuthContext = createContext(null);
const EMPRESA_KEY = 'empresa_activa_id';

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(null);
  const [permisos,     setPermisos]     = useState({});
  const [modoGestoria, setModoGestoria] = useState('v1');
  const [empresas,     setEmpresas]     = useState([]);
  const [empresaActiva,setEmpresaActiva]= useState(null);
  const [loading,      setLoading]      = useState(true);
  const [emulacion,    setEmulacion]    = useState(null);
  const [chatAcceso,   setChatAcceso]   = useState(false);

  function initEmpresas(lista) {
    setEmpresas(lista || []);
    if (lista?.length) {
      const stored = localStorage.getItem(EMPRESA_KEY);
      const found  = stored ? lista.find(e => e.id === parseInt(stored, 10)) : null;
      setEmpresaActiva(found || lista[0]);
    }
  }

  function cambiarEmpresa(empresa) {
    setEmpresaActiva(empresa);
    if (empresa) localStorage.setItem(EMPRESA_KEY, String(empresa.id));
  }

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setLoading(false); return; }
    apiMe()
      .then(data => {
        if (data) {
          setUser(data.user); setPermisos(data.permisos || {});
          setModoGestoria(data.modo_gestoria || 'v1');
          setChatAcceso(!!data.chatAcceso);
          initEmpresas(data.empresas);
        } else { clearToken(); }
      })
      .catch(() => { clearToken(); setUser(null); setPermisos({}); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const data = await apiLogin(email, password);
    storeToken(data.token); setUser(data.user); setPermisos(data.permisos || {});
    setModoGestoria(data.modo_gestoria || 'v1'); setChatAcceso(!!data.chatAcceso);
    initEmpresas(data.empresas); setEmulacion(null);
    return data.user;
  }

  async function loginWithGoogle(credential) {
    const data = await apiLoginGoogle(credential);
    storeToken(data.token); setUser(data.user); setPermisos(data.permisos || {});
    setModoGestoria(data.modo_gestoria || 'v1'); setChatAcceso(!!data.chatAcceso);
    initEmpresas(data.empresas); setEmulacion(null);
    return data.user;
  }

  function logout() { clearToken(); setUser(null); setPermisos({}); setEmulacion(null); setEmpresas([]); setEmpresaActiva(null); localStorage.removeItem(EMPRESA_KEY); }
  function updateUser(partial) { setUser(prev => ({ ...prev, ...partial })); }

  function emularGestoria(permisosGestoria) {
    if (!user || user.rol !== 'ADMIN') return;
    setEmulacion({ userReal: user, permisosReales: permisos });
    setUser(prev => ({ ...prev, rol: 'GESTORIA', _emulando: true }));
    setPermisos(permisosGestoria);
  }
  function detenerEmulacion() {
    if (!emulacion) return;
    setUser(emulacion.userReal); setPermisos(emulacion.permisosReales); setEmulacion(null);
  }

  const esAdmin = user?.rol === 'ADMIN';
  const estaEmulando = !!emulacion;
  const modoEfectivo = (esAdmin && !estaEmulando) ? 'v2' : modoGestoria;

  const puedeVer = useCallback((recurso) => {
    if (user?.rol === 'ADMIN' && !emulacion) return true;
    return (permisos[recurso] || 'none') !== 'none';
  }, [user, permisos, emulacion]);

  const puedeEditar = useCallback((recurso) => {
    if (user?.rol === 'ADMIN' && !emulacion) return true;
    return permisos[recurso] === 'edit';
  }, [user, permisos, emulacion]);

  async function recargarEmpresas() {
    try {
      const data = await apiMe();
      if (data?.empresas) initEmpresas(data.empresas);
    } catch {}
  }

  return (
    <AuthContext.Provider value={{
      user, permisos, loading, login, loginWithGoogle, logout, updateUser,
      puedeVer, puedeEditar,
      esAdmin: esAdmin && !estaEmulando,
      estaEmulando, emularGestoria, detenerEmulacion,
      modoGestoria: modoEfectivo,
      empresas, empresaActiva, cambiarEmpresa, recargarEmpresas,
      chatAcceso,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() { return useContext(AuthContext); }
