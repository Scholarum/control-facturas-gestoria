import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiLogin, apiMe, storeToken, clearToken, getStoredToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,     setUser]     = useState(null);
  const [permisos, setPermisos] = useState({});
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setLoading(false); return; }
    apiMe()
      .then(data => {
        if (data) { setUser(data.user); setPermisos(data.permisos || {}); }
        else      { clearToken(); }
      })
      .catch(() => { clearToken(); setUser(null); setPermisos({}); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const { token, user: u, permisos: p } = await apiLogin(email, password);
    storeToken(token);
    setUser(u);
    setPermisos(p || {});
    return u;
  }

  function logout() {
    clearToken();
    setUser(null);
    setPermisos({});
  }

  function updateUser(partial) {
    setUser(prev => ({ ...prev, ...partial }));
  }

  // ADMIN siempre tiene acceso total; el resto usa la tabla de permisos
  const puedeVer     = useCallback((recurso) => {
    if (user?.rol === 'ADMIN') return true;
    return (permisos[recurso] || 'none') !== 'none';
  }, [user, permisos]);

  const puedeEditar  = useCallback((recurso) => {
    if (user?.rol === 'ADMIN') return true;
    return permisos[recurso] === 'edit';
  }, [user, permisos]);

  return (
    <AuthContext.Provider value={{ user, permisos, loading, login, logout, updateUser, puedeVer, puedeEditar }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
