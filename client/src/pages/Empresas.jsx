import { useState, useEffect } from 'react';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
function authHeaders(extra = {}) {
  const token = localStorage.getItem('cf_token');
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

export default function Empresas() {
  const [empresas,  setEmpresas]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  const [form,      setForm]      = useState({ nombre: '', cif: '', direccion: '', telefono: '', email: '', web: '' });
  const [guardando, setGuardando] = useState(false);
  const [error,     setError]     = useState('');

  async function cargar() {
    try {
      const res = await fetch(`${API_BASE}/api/empresas`, { headers: authHeaders() });
      const json = await res.json();
      setEmpresas(json.data || []);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { cargar(); }, []);

  function abrirNueva() {
    setForm({ nombre: '', cif: '', direccion: '', telefono: '', email: '', web: '' });
    setModal('nueva'); setError('');
  }

  function abrirEditar(e) {
    setForm({ nombre: e.nombre || '', cif: e.cif || '', direccion: e.direccion || '', telefono: e.telefono || '', email: e.email || '', web: e.web || '' });
    setModal({ empresa: e }); setError('');
  }

  async function guardar() {
    if (!form.nombre.trim() || !form.cif.trim()) { setError('Nombre y CIF son obligatorios'); return; }
    setGuardando(true); setError('');
    try {
      const method = modal === 'nueva' ? 'POST' : 'PUT';
      const url = modal === 'nueva' ? `${API_BASE}/api/empresas` : `${API_BASE}/api/empresas/${modal.empresa.id}`;
      const res = await fetch(url, { method, headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(form) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setModal(null);
      cargar();
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Empresas</h2>
          <p className="text-xs text-gray-400 mt-0.5">Gestiona las sociedades del sistema</p>
        </div>
        <button onClick={abrirNueva}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Nueva empresa
        </button>
      </div>

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
                {['Nombre', 'CIF', 'Direccion', 'Contacto', 'Acciones'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {empresas.map(e => (
                <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{e.nombre}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600">{e.cif}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">{e.direccion || '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {e.email || e.telefono || '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => abrirEditar(e)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal crear/editar */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md mx-4">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">{modal === 'nueva' ? 'Nueva empresa' : 'Editar empresa'}</h3>
              <button onClick={() => setModal(null)} className="text-gray-400 hover:text-gray-600 text-xl">x</button>
            </div>
            <div className="px-6 py-5 space-y-3">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{error}</div>}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Nombre *</label>
                <input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">CIF *</label>
                <input value={form.cif} onChange={e => setForm(p => ({ ...p, cif: e.target.value.toUpperCase() }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Direccion</label>
                <input value={form.direccion} onChange={e => setForm(p => ({ ...p, direccion: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Telefono</label>
                  <input value={form.telefono} onChange={e => setForm(p => ({ ...p, telefono: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
                  <input value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Web</label>
                <input value={form.web} onChange={e => setForm(p => ({ ...p, web: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
              <button onClick={() => setModal(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancelar</button>
              <button onClick={guardar} disabled={guardando}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
                {guardando ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
