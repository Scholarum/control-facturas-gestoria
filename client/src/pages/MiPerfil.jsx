import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { editarUsuario, cambiarPassword } from '../api.js';

export default function MiPerfil() {
  const { user, updateUser } = useAuth();

  // ─── Datos personales ─────────────────────────────────────────────────────
  const [nombre,    setNombre]    = useState(user?.nombre || '');
  const [savingDatos, setSavingDatos] = useState(false);
  const [okDatos,   setOkDatos]   = useState(false);
  const [errDatos,  setErrDatos]  = useState('');

  async function handleGuardarDatos(e) {
    e.preventDefault();
    setSavingDatos(true); setErrDatos(''); setOkDatos(false);
    try {
      const updated = await editarUsuario(user.id, { nombre });
      updateUser({ nombre: updated.nombre });
      setOkDatos(true);
    } catch (err) {
      setErrDatos(err.message);
    } finally {
      setSavingDatos(false);
    }
  }

  // ─── Cambio de contraseña ─────────────────────────────────────────────────
  const [pw1,        setPw1]       = useState('');
  const [pw2,        setPw2]       = useState('');
  const [savingPw,   setSavingPw]  = useState(false);
  const [okPw,       setOkPw]      = useState(false);
  const [errPw,      setErrPw]     = useState('');

  async function handleCambiarPassword(e) {
    e.preventDefault();
    if (pw1 !== pw2) { setErrPw('Las contraseñas no coinciden'); return; }
    setSavingPw(true); setErrPw(''); setOkPw(false);
    try {
      await cambiarPassword(user.id, pw1);
      setOkPw(true);
      setPw1(''); setPw2('');
    } catch (err) {
      setErrPw(err.message);
    } finally {
      setSavingPw(false);
    }
  }

  const ROL_LABEL = { ADMIN: 'Administrador', GESTORIA: 'Gestoría' };

  return (
    <div className="max-w-lg space-y-6">
      <h2 className="text-base font-semibold text-gray-900">Mi Perfil</h2>

      {/* ── Datos personales ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Datos personales</h3>
        </div>
        <form onSubmit={handleGuardarDatos} className="px-6 py-5 space-y-4">
          {errDatos && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{errDatos}</div>
          )}
          {okDatos && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">✓ Datos actualizados correctamente</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nombre completo</label>
            <input value={nombre} onChange={e => { setNombre(e.target.value); setOkDatos(false); }} required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
            <input value={user?.email || ''} disabled
              className="w-full rounded-lg border border-gray-100 px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rol</label>
            <input value={ROL_LABEL[user?.rol] || user?.rol || ''} disabled
              className="w-full rounded-lg border border-gray-100 px-3 py-2 text-sm bg-gray-50 text-gray-400 cursor-not-allowed" />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={savingDatos}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60">
              {savingDatos ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>

      {/* ── Cambiar contraseña ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-800">Cambiar contraseña</h3>
        </div>
        <form onSubmit={handleCambiarPassword} className="px-6 py-5 space-y-4">
          {errPw && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{errPw}</div>
          )}
          {okPw && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-700">✓ Contraseña actualizada correctamente</div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Nueva contraseña <span className="text-gray-400 font-normal">(mín. 8 caracteres)</span></label>
            <input type="password" value={pw1} onChange={e => { setPw1(e.target.value); setOkPw(false); }} required minLength={8}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Repetir contraseña</label>
            <input type="password" value={pw2} onChange={e => { setPw2(e.target.value); setOkPw(false); }} required
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={savingPw}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60">
              {savingPw ? 'Actualizando…' : 'Actualizar contraseña'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
