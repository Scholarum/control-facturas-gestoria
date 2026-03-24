import { createContext, useContext, useState, useEffect } from 'react';
import { apiLogin, apiMe, storeToken, clearToken, getStoredToken } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true); // validando token inicial

  // Al montar: validar token guardado en localStorage
  useEffect(() => {
    const token = getStoredToken();
    if (!token) { setLoading(false); return; }
    apiMe()
      .then(u => setUser(u || null))
      .catch(() => { clearToken(); setUser(null); })
      .finally(() => setLoading(false));
  }, []);

  async function login(email, password) {
    const { token, user: u } = await apiLogin(email, password);
    storeToken(token);
    setUser(u);
    return u;
  }

  function logout() {
    clearToken();
    setUser(null);
  }

  function updateUser(partial) {
    setUser(prev => ({ ...prev, ...partial }));
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
