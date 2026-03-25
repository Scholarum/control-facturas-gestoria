import { useState, useEffect } from 'react';
import { fetchUsuarios, crearUsuario, editarUsuario, cambiarPassword, desactivarUsuario } from '../api.js';
import { fetchRoles, crearRol, editarRol, eliminarRol } from '../api.js';

// ─── Constantes ───────────────────────────────────────────────────────────────

const RECURSOS = [
  { id: 'facturas',        label: 'Facturas' },
  { id: 'conciliacion',    label: 'Conciliación de Mayor' },
  { id: 'historial',       label: 'Historial' },
  { id: 'proveedores',     label: 'Proveedores' },
  { id: 'usuarios',        label: 'Usuarios y Roles' },
  { id: 'configuracion',   label: 'Configuración' },
  { id: 'aplicar_cuentas', label: 'Aplicar cuentas de proveedor' },
];

const NIVELES = [
  { value: 'none', label: 'Sin acceso', cls: 'bg-gray-100 text-gray-500' },
  { value: 'read', label: 'Ver',        cls: 'bg-blue-50 text-blue-700'  },
  { value: 'edit', label: 'Editar',     cls: 'bg-emerald-50 text-emerald-700' },
];

// ─── Badges ───────────────────────────────────────────────────────────────────

function RolBadge({ rol, roles }) {
  const rolData = roles?.find(r => r.nombre === rol);
  const label   = rolData?.nombre || rol;
  const isAdmin = rol === 'ADMIN';
  const cls     = isAdmin
    ? 'bg-blue-50 text-blue-700 ring-blue-200'
    : 'bg-purple-50 text-purple-700 ring-purple-200';
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>
      {label}
    </span>
  );
}

function NivelBadge({ nivel }) {
  const n = NIVELES.find(x => x.value === nivel) || NIVELES[0];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${n.cls}`}>{n.label}</span>
  );
}

// ─── Modal crear / editar usuario ────────────────────────────────────────────

function ModalUsuario({ usuario, roles, onClose, onSaved }) {
  const editando = !!usuario;
  const [nombre,   setNombre]   = useState(usuario?.nombre  || '');
  const [email,    setEmail]    = useState(usuario?.email   || '');
  const [rol,      setRol]      = useState(usuario?.rol     || 'GESTORIA');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const saved = editando
        ? await editarUsuario(usuario.id, { nombre, email, rol })
        : await crearUsuario({ nombre, email, password, rol });
      onSaved(saved, editando);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">{editando ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre completo</label>
            <input value={nombre} onChange={e => setNombre(e.target.value)} required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {!editando && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Contraseña <span className="text-gray-400 font-normal">(mín. 8 caracteres)</span></label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rol</label>
            <select value={rol} onChange={e => setRol(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {roles.filter(r => r.activo).map(r => (
                <option key={r.id} value={r.nombre}>{r.nombre}{r.descripcion ? ` — ${r.descripcion}` : ''}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60">
              {saving ? 'Guardando…' : (editando ? 'Guardar cambios' : 'Crear usuario')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal cambiar contraseña ─────────────────────────────────────────────────

function ModalPassword({ usuario, onClose }) {
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [error,  setError]  = useState('');
  const [saving, setSaving] = useState(false);
  const [ok,     setOk]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (pw1 !== pw2) { setError('Las contraseñas no coinciden'); return; }
    setSaving(true); setError('');
    try { await cambiarPassword(usuario.id, pw1); setOk(true); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm mx-4">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Cambiar contraseña</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-5">
          {ok ? (
            <div className="text-center space-y-4">
              <p className="text-emerald-600 font-medium">✓ Contraseña actualizada</p>
              <button onClick={onClose} className="w-full py-2 text-sm font-medium bg-gray-100 hover:bg-gray-200 rounded-lg">Cerrar</button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}
              <p className="text-sm text-gray-500">Usuario: <strong>{usuario.nombre}</strong></p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva contraseña</label>
                <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} required minLength={8}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Repetir contraseña</label>
                <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} required
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={onClose}
                  className="flex-1 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg">Cancelar</button>
                <button type="submit" disabled={saving}
                  className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60">
                  {saving ? 'Guardando…' : 'Actualizar'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal crear / editar rol ─────────────────────────────────────────────────

const PERMISOS_DEFAULT = RECURSOS.reduce((acc, r) => { acc[r.id] = 'none'; return acc; }, {});

function ModalRol({ rol, onClose, onSaved }) {
  const editando   = !!rol;
  const [nombre,      setNombre]      = useState(rol?.nombre      || '');
  const [descripcion, setDescripcion] = useState(rol?.descripcion || '');
  const [permisos,    setPermisos]    = useState(rol?.permisos    || { ...PERMISOS_DEFAULT });
  const [error,  setError]  = useState('');
  const [saving, setSaving] = useState(false);

  function setNivel(recurso, nivel) {
    setPermisos(prev => ({ ...prev, [recurso]: nivel }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const saved = editando
        ? await editarRol(rol.id, { nombre, descripcion, permisos })
        : await crearRol({ nombre, descripcion, permisos });
      onSaved(saved, editando);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <h3 className="font-semibold text-gray-900">{editando ? 'Editar rol' : 'Nuevo rol'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-5">
          {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre del rol</label>
              <input value={nombre} onChange={e => setNombre(e.target.value)} required
                placeholder="ej: Revisor, Contable…"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Descripción <span className="text-gray-400 font-normal">(opcional)</span></label>
              <input value={descripcion} onChange={e => setDescripcion(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          {/* Matriz de permisos */}
          <div>
            <p className="text-sm font-medium text-gray-700 mb-3">Permisos por sección</p>
            <div className="rounded-xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Sección</th>
                    {NIVELES.map(n => (
                      <th key={n.value} className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">{n.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {RECURSOS.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-800">{r.label}</td>
                      {NIVELES.map(n => (
                        <td key={n.value} className="px-3 py-2.5 text-center">
                          <input
                            type="radio"
                            name={`perm-${r.id}`}
                            value={n.value}
                            checked={permisos[r.id] === n.value}
                            onChange={() => setNivel(r.id, n.value)}
                            className="h-4 w-4 text-blue-600 cursor-pointer"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60">
              {saving ? 'Guardando…' : (editando ? 'Guardar cambios' : 'Crear rol')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Tab Usuarios ─────────────────────────────────────────────────────────────

function TabUsuarios({ roles }) {
  const [usuarios, setUsuarios] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(null);
  const [error,    setError]    = useState('');

  useEffect(() => {
    fetchUsuarios().then(setUsuarios).catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  function handleSaved(saved, editando) {
    setUsuarios(prev => editando ? prev.map(u => u.id === saved.id ? saved : u) : [...prev, saved]);
    setModal(null);
  }

  async function handleDesactivar(u) {
    if (!confirm(`¿Desactivar a ${u.nombre}? No podrá iniciar sesión.`)) return;
    try {
      await desactivarUsuario(u.id);
      setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, activo: 0 } : x));
    } catch (err) { setError(err.message); }
  }

  async function handleActivar(u) {
    try {
      await editarUsuario(u.id, { activo: true });
      setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, activo: 1 } : x));
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Usuarios del sistema</h3>
        <button onClick={() => setModal({ tipo: 'crear' })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Nuevo usuario
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <svg className="h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Nombre', 'Email', 'Rol', 'Estado', 'Acciones'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {usuarios.map(u => (
                <tr key={u.id} className={`hover:bg-gray-50 transition-colors ${!u.activo ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 font-medium text-gray-900">{u.nombre}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{u.email}</td>
                  <td className="px-4 py-3"><RolBadge rol={u.rol} roles={roles} /></td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${u.activo ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-gray-100 text-gray-500 ring-gray-200'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setModal({ tipo: 'editar', usuario: u })}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                      <button onClick={() => setModal({ tipo: 'password', usuario: u })}
                        className="text-xs text-gray-600 hover:text-gray-800 font-medium">Contraseña</button>
                      {u.activo
                        ? <button onClick={() => handleDesactivar(u)} className="text-xs text-red-500 hover:text-red-700 font-medium">Desactivar</button>
                        : <button onClick={() => handleActivar(u)}    className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Activar</button>
                      }
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal?.tipo === 'crear'    && <ModalUsuario roles={roles} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.tipo === 'editar'   && <ModalUsuario roles={roles} usuario={modal.usuario} onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.tipo === 'password' && <ModalPassword usuario={modal.usuario} onClose={() => setModal(null)} />}
    </div>
  );
}

// ─── Tab Roles ────────────────────────────────────────────────────────────────

function TabRoles({ roles, setRoles }) {
  const [modal, setModal] = useState(null);
  const [error, setError] = useState('');

  function handleSaved(saved, editando) {
    setRoles(prev => editando ? prev.map(r => r.id === saved.id ? saved : r) : [...prev, saved]);
    setModal(null);
  }

  async function handleEliminar(rol) {
    if (!confirm(`¿Eliminar el rol "${rol.nombre}"?`)) return;
    try {
      await eliminarRol(rol.id);
      setRoles(prev => prev.filter(r => r.id !== rol.id));
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">Roles y permisos</h3>
        <button onClick={() => setModal({ tipo: 'crear' })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Nuevo rol
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Rol</th>
              {RECURSOS.map(r => (
                <th key={r.id} className="px-3 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{r.label}</th>
              ))}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {roles.map(rol => (
              <tr key={rol.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900">{rol.nombre}</span>
                    {rol.es_builtin && (
                      <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">integrado</span>
                    )}
                  </div>
                  {rol.descripcion && <p className="text-xs text-gray-400 mt-0.5">{rol.descripcion}</p>}
                </td>
                {RECURSOS.map(r => (
                  <td key={r.id} className="px-3 py-3 text-center">
                    <NivelBadge nivel={rol.permisos?.[r.id] || 'none'} />
                  </td>
                ))}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 justify-end">
                    {rol.nombre !== 'ADMIN' && (
                      <button onClick={() => setModal({ tipo: 'editar', rol })}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                    )}
                    {!rol.es_builtin && (
                      <button onClick={() => handleEliminar(rol)}
                        className="text-xs text-red-500 hover:text-red-700 font-medium">Eliminar</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal?.tipo === 'crear'  && <ModalRol onClose={() => setModal(null)} onSaved={handleSaved} />}
      {modal?.tipo === 'editar' && <ModalRol rol={modal.rol} onClose={() => setModal(null)} onSaved={handleSaved} />}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Usuarios() {
  const [subtab,  setSubtab]  = useState('usuarios');
  const [roles,   setRoles]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    fetchRoles()
      .then(setRoles)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <svg className="h-6 w-6 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Gestión de Usuarios</h2>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { id: 'usuarios', label: 'Usuarios' },
          { id: 'roles',    label: 'Roles y permisos' },
        ].map(t => (
          <button key={t.id} onClick={() => setSubtab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              subtab === t.id
                ? 'border-blue-600 text-blue-700 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {subtab === 'usuarios' && <TabUsuarios roles={roles} />}
      {subtab === 'roles'    && <TabRoles roles={roles} setRoles={setRoles} />}
    </div>
  );
}
