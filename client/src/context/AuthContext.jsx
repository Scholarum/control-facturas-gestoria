import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiLogin, apiLoginGoogle, apiMe, storeToken, clearToken, getStoredToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,         setUser]         = useState(null);
  const [permisos,     setPermisos]     = useState({});
  const [modoGestoria, setModoGestoria] = useState('v1');
  const [loading,      setLoading]      = useState(true);

  // Emulación: guarda estado real del admin mientras emula gestoría
  const [emulacion, setEmulacion] = useState(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setLoading(false); return; }
    apiMe()
      .then(data => {
        if (data) { setUser(data.user); setPermisos(data.permisos || {}); setModoGestoria(data.modo_gestoria || 'v1'); }
        else      { clearToken(); }
      })
      .catch(() => { clearToken(); setUser(null); setPermisos({}); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const data = await apiLogin(email, password);
    storeToken(data.token);
    setUser(data.user);
    setPermisos(data.permisos || {});
    setModoGestoria(data.modo_gestoria || 'v1');
    setEmulacion(null);
    return data.user;
  }

  async function loginWithGoogle(credential) {
    const data = await apiLoginGoogle(credential);
    storeToken(data.token);
    setUser(data.user);
    setPermisos(data.permisos || {});
    setModoGestoria(data.modo_gestoria || 'v1');
    setEmulacion(null);
    return data.user;
  }

  function logout() {
    clearToken();
    setUser(null);
    setPermisos({});
    setEmulacion(null);
  }

  function updateUser(partial) {
    setUser(prev => ({ ...prev, ...partial }));
  }

  // Emular gestoría: reemplaza user y permisos temporalmente
  function emularGestoria(permisosGestoria) {
    if (!user || user.rol !== 'ADMIN') return;
    setEmulacion({ userReal: user, permisosReales: permisos });
    setUser(prev => ({ ...prev, rol: 'GESTORIA', _emulando: true }));
    setPermisos(permisosGestoria);
  }

  function detenerEmulacion() {
    if (!emulacion) return;
    setUser(emulacion.userReal);
    setPermisos(emulacion.permisosReales);
    setEmulacion(null);
  }

  const esAdmin = user?.rol === 'ADMIN';
  const estaEmulando = !!emulacion;
  // Admin siempre ve todo (v2), salvo que esté emulando
  const modoEfectivo = (esAdmin && !estaEmulando) ? 'v2' : modoGestoria;

  // ADMIN siempre tiene acceso total; el resto usa la tabla de permisos
  const puedeVer = useCallback((recurso) => {
    if (user?.rol === 'ADMIN' && !emulacion) return true;
    return (permisos[recurso] || 'none') !== 'none';
  }, [user, permisos, emulacion]);

  const puedeEditar = useCallback((recurso) => {
    if (user?.rol === 'ADMIN' && !emulacion) return true;
    return permisos[recurso] === 'edit';
  }, [user, permisos, emulacion]);

  return (
    <AuthContext.Provider value={{
      user, permisos, loading, login, loginWithGoogle, logout, updateUser,
      puedeVer, puedeEditar,
      esAdmin: esAdmin && !estaEmulando,
      estaEmulando,
      emularGestoria, detenerEmulacion,
      modoGestoria: modoEfectivo,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
