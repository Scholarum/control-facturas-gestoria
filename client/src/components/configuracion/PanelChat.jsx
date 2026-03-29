import { useState, useEffect, useRef, useCallback } from 'react';
import { getStoredToken } from '../../api.js';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const ROLES_DISPONIBLES = ['ADMIN', 'GESTORIA'];
const AGENTES_DISPONIBLES = [
  { id: 'atc', label: 'ATC Scholarum' },
];

function SaveIndicator({ visible }) {
  if (!visible) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium animate-fade-in">
      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      Guardado
    </span>
  );
}

export default function PanelChat({ config, onChange }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [bienvenida, setBienvenida] = useState('');
  const [savedFlag, setSavedFlag] = useState(null); // key del campo guardado
  const debounceRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/usuarios`, {
      headers: { 'Authorization': `Bearer ${getStoredToken()}` },
    })
      .then(r => r.json())
      .then(d => { if (d.ok) setUsuarios(d.data); })
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  }, []);

  // Sync bienvenida con config cuando llega del servidor
  useEffect(() => {
    if (config?.chat_mensaje_bienvenida != null) setBienvenida(config.chat_mensaje_bienvenida);
  }, [config?.chat_mensaje_bienvenida]);

  // Guardar con feedback visual
  const saveWithFeedback = useCallback((updates) => {
    onChange(updates);
    const key = Object.keys(updates)[0];
    setSavedFlag(key);
    setTimeout(() => setSavedFlag(prev => prev === key ? null : prev), 2000);
  }, [onChange]);

  // Debounce para textarea
  function handleBienvenidaChange(e) {
    const val = e.target.value;
    setBienvenida(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => saveWithFeedback({ chat_mensaje_bienvenida: val }), 800);
  }

  if (!config) return null;

  const chatActivo = config.chat_activo === 'true';
  const rolesActivos = (config.chat_roles || '').split(',').map(r => r.trim()).filter(Boolean);
  const agenteDefecto = config.chat_agente_defecto || 'atc';
  const maxMensajes = parseInt(config.chat_max_mensajes_dia) || 100;

  function toggleActivo() {
    saveWithFeedback({ chat_activo: chatActivo ? 'false' : 'true' });
  }

  function toggleRol(rol) {
    const next = rolesActivos.includes(rol)
      ? rolesActivos.filter(r => r !== rol)
      : [...rolesActivos, rol];
    saveWithFeedback({ chat_roles: next.join(',') });
  }

  async function toggleBloqueoUsuario(userId, bloqueado) {
    await fetch(`${API_BASE}/api/usuarios/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getStoredToken()}` },
      body: JSON.stringify({ chat_bloqueado: !bloqueado }),
    });
    setUsuarios(prev => prev.map(u => u.id === userId ? { ...u, chat_bloqueado: !bloqueado } : u));
  }

  return (
    <div className="space-y-6">

      {/* Activar/Desactivar */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Chat Asistente</p>
              <SaveIndicator visible={savedFlag === 'chat_activo'} />
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Activa o desactiva el widget de chat para todos los usuarios</p>
          </div>
          <button
            onClick={toggleActivo}
            className={`relative w-11 h-6 rounded-full transition-colors ${chatActivo ? 'bg-blue-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${chatActivo ? 'translate-x-5' : ''}`} />
          </button>
        </div>
      </div>

      {/* Roles con acceso */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1"><p className="text-sm font-semibold text-gray-900">Perfiles con acceso al chat</p><SaveIndicator visible={savedFlag === 'chat_roles'} /></div>
        <p className="text-xs text-gray-500 mb-3">Selecciona que roles pueden ver y usar el widget del asistente</p>
        <div className="flex flex-wrap gap-2">
          {ROLES_DISPONIBLES.map(rol => (
            <button key={rol} onClick={() => toggleRol(rol)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                rolesActivos.includes(rol)
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : 'bg-gray-50 text-gray-400 border-gray-200 hover:bg-gray-100'
              }`}>
              {rolesActivos.includes(rol) ? '✓ ' : ''}{rol}
            </button>
          ))}
        </div>
      </div>

      {/* Agente por defecto */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1"><p className="text-sm font-semibold text-gray-900">Agente por defecto</p><SaveIndicator visible={savedFlag === 'chat_agente_defecto'} /></div>
        <p className="text-xs text-gray-500 mb-3">El agente que se selecciona automaticamente al abrir el chat</p>
        <select
          value={agenteDefecto}
          onChange={e => saveWithFeedback({ chat_agente_defecto: e.target.value })}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 w-full sm:w-auto"
        >
          {AGENTES_DISPONIBLES.map(a => (
            <option key={a.id} value={a.id}>{a.label}</option>
          ))}
        </select>
      </div>

      {/* Límite de mensajes diarios */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1"><p className="text-sm font-semibold text-gray-900">Limite de mensajes por usuario/dia</p><SaveIndicator visible={savedFlag === 'chat_max_mensajes_dia'} /></div>
        <p className="text-xs text-gray-500 mb-3">Controla el uso de la API de Anthropic estableciendo un maximo diario por usuario</p>
        <div className="flex items-center gap-3">
          <input
            type="number" min="1" max="1000" value={maxMensajes}
            onChange={e => saveWithFeedback({ chat_max_mensajes_dia: e.target.value })}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 w-24"
          />
          <span className="text-xs text-gray-500">mensajes/dia por usuario</span>
        </div>
      </div>

      {/* Mensaje de bienvenida */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-1"><p className="text-sm font-semibold text-gray-900">Mensaje de bienvenida</p><SaveIndicator visible={savedFlag === 'chat_mensaje_bienvenida'} /></div>
        <p className="text-xs text-gray-500 mb-3">Se muestra al abrir una nueva conversacion. Dejalo vacio para no mostrar nada.</p>
        <textarea
          value={bienvenida}
          onChange={handleBienvenidaChange}
          placeholder="Ej: Hola, soy el asistente de Scholarum. ¿En qué puedo ayudarte?"
          rows={3}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 w-full resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Usuarios con acceso bloqueado */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <p className="text-sm font-semibold text-gray-900 mb-1">Usuarios bloqueados</p>
        <p className="text-xs text-gray-500 mb-3">
          Usuarios individuales a los que se les deniega el acceso al chat, independientemente de su rol
        </p>
        {loadingUsers ? (
          <p className="text-xs text-gray-400">Cargando usuarios...</p>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden max-h-60 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Usuario</th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Rol</th>
                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Chat bloqueado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {usuarios.filter(u => u.activo).map(u => (
                  <tr key={u.id} className={u.chat_bloqueado ? 'bg-red-50/50' : ''}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-800">{u.nombre}</p>
                      <p className="text-xs text-gray-400">{u.email}</p>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{u.rol}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleBloqueoUsuario(u.id, u.chat_bloqueado)}
                        className={`relative w-9 h-5 rounded-full transition-colors ${u.chat_bloqueado ? 'bg-red-500' : 'bg-gray-300'}`}
                      >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${u.chat_bloqueado ? 'translate-x-4' : ''}`} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
