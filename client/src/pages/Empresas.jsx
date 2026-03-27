import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
function authHeaders(extra = {}) {
  const token = localStorage.getItem('cf_token');
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra };
}

async function fetchEmpresas() {
  const res = await fetch(`${API_BASE}/api/empresas`, { headers: authHeaders() });
  const json = await res.json();
  return json.data || [];
}

async function fetchEmpresaDetalle(id) {
  const res = await fetch(`${API_BASE}/api/empresas/${id}/detalle`, { headers: authHeaders() });
  const json = await res.json();
  return json.data || {};
}

export default function Empresas() {
  const { empresas: empresasCtx, cambiarEmpresa, empresaActiva, recargarEmpresas } = useAuth();
  const [empresas,  setEmpresas]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(null);
  const [detalle,   setDetalle]   = useState(null); // empresa expandida
  const [detalleData, setDetalleData] = useState(null);
  const [form,      setForm]      = useState({ nombre: '', cif: '', direccion: '', telefono: '', email: '', web: '' });
  const [guardando, setGuardando] = useState(false);
  const [error,     setError]     = useState('');

  async function cargar() {
    try { setEmpresas(await fetchEmpresas()); }
    catch {} finally { setLoading(false); }
  }

  useEffect(() => { cargar(); }, []);

  async function toggleDetalle(id) {
    if (detalle === id) { setDetalle(null); return; }
    setDetalle(id); setDetalleData(null);
    try { setDetalleData(await fetchEmpresaDetalle(id)); } catch {}
  }

  function abrirNueva() {
    setForm({ nombre: '', cif: '', direccion: '', telefono: '', email: '', web: '' });
    setModal('nueva'); setError('');
  }

  function abrirEditar(e) {
    setForm({ nombre: e.nombre||'', cif: e.cif||'', direccion: e.direccion||'', telefono: e.telefono||'', email: e.email||'', web: e.web||'' });
    setModal({ empresa: e }); setError('');
  }

  const [importandoPdf, setImportandoPdf] = useState(null);

  async function handleImportarPlanPdf(empresaId, file) {
    if (!file) return;
    setImportandoPdf(empresaId);
    const fd = new FormData();
    fd.append('archivo', file);
    try {
      const res = await fetch(`${API_BASE}/api/plan-contable/importar-pdf?empresa=${empresaId}`, {
        method: 'POST', headers: authHeaders(), body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      alert(`Plan contable extraido con Gemini: ${json.data.total_extraidas} cuentas detectadas, ${json.data.insertadas} nuevas, ${json.data.actualizadas} actualizadas`);
      if (detalle === empresaId) {
        setDetalleData(null);
        setDetalleData(await fetchEmpresaDetalle(empresaId));
      }
      cargar();
    } catch (e) { alert('Error: ' + e.message); }
    finally { setImportandoPdf(null); }
  }

  async function handleImportarPlanContable(empresaId, file) {
    if (!file) return;
    const fd = new FormData();
    fd.append('archivo', file);
    try {
      const res = await fetch(`${API_BASE}/api/plan-contable/importar?empresa=${empresaId}`, {
        method: 'POST', headers: authHeaders(), body: fd,
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      alert(`Plan contable importado: ${json.data.insertadas} nuevas, ${json.data.actualizadas} actualizadas${json.data.errores?.length ? `, ${json.data.errores.length} errores` : ''}`);
      // Recargar detalle
      if (detalle === empresaId) {
        setDetalleData(null);
        setDetalleData(await fetchEmpresaDetalle(empresaId));
      }
      cargar();
    } catch (e) { alert('Error: ' + e.message); }
  }

  async function handleDescargarPlantillaPlan() {
    try {
      const res = await fetch(`${API_BASE}/api/plan-contable/plantilla`, { headers: authHeaders() });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'plantilla-plan-contable.xlsx';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {}
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
      await cargar();
      // Recargar empresas en el contexto global para actualizar el selector
      await recargarEmpresas();
    } catch (e) { setError(e.message); }
    finally { setGuardando(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Empresas</h2>
          <p className="text-xs text-gray-400 mt-0.5">Gestiona las sociedades del sistema. Cada empresa receptora de facturas debe estar registrada aqui.</p>
        </div>
        <button onClick={abrirNueva}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
          </svg>
          Nueva empresa
        </button>
      </div>

      {/* Info */}
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
        <p>Cada empresa tiene su propio plan contable, cuentas de proveedor y ficheros SAGE. Las facturas se asignan automaticamente a la empresa cuyo CIF coincide con el receptor de la factura.</p>
      </div>

      {/* Tabla */}
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
                {['','Nombre', 'CIF', 'Direccion', 'Plan contable', 'Facturas', 'Acciones'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {empresas.map(e => {
                const isOpen = detalle === e.id;
                const esActiva = empresaActiva?.id === e.id;
                return [
                  <tr key={e.id} className={`hover:bg-gray-50 transition-colors cursor-pointer ${esActiva ? 'bg-blue-50/30' : ''}`} onClick={() => toggleDetalle(e.id)}>
                    <td className="px-4 py-3 w-8">
                      <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {e.nombre}
                      {esActiva && <span className="ml-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 ring-1 ring-inset ring-blue-200">Activa</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{e.cif}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{e.direccion || '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{e.num_cuentas != null ? `${e.num_cuentas} cuentas` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{e.num_facturas != null ? e.num_facturas : '-'}</td>
                    <td className="px-4 py-3" onClick={ev => ev.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <button onClick={() => abrirEditar(e)} className="text-xs text-blue-600 hover:text-blue-800 font-medium">Editar</button>
                        {!esActiva && (
                          <button onClick={() => cambiarEmpresa(e)} className="text-xs text-emerald-600 hover:text-emerald-800 font-medium">Activar</button>
                        )}
                      </div>
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`det-${e.id}`}>
                      <td colSpan={7} className="px-6 py-4 bg-gray-50/60 border-b-2 border-gray-200">
                        {!detalleData ? (
                          <div className="flex justify-center py-4"><svg className="h-5 w-5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg></div>
                        ) : (
                          <div className="space-y-4">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                              <div>
                                <p className="text-gray-400 mb-1">Telefono</p>
                                <p className="text-gray-800">{detalleData.telefono || '-'}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-1">Email</p>
                                <p className="text-gray-800">{detalleData.email || '-'}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-1">Web</p>
                                <p className="text-gray-800">{detalleData.web || '-'}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-1">Plan contable</p>
                                <p className="text-gray-800 font-semibold">{detalleData.num_cuentas || 0} cuentas</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-1">Facturas totales</p>
                                <p className="text-gray-800 font-semibold">{detalleData.num_facturas || 0}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-1">Proveedores vinculados</p>
                                <p className="text-gray-800 font-semibold">{detalleData.num_proveedores || 0}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-1">Exportaciones SAGE</p>
                                <p className="text-gray-800 font-semibold">{detalleData.num_lotes_sage || 0}</p>
                              </div>
                              <div>
                                <p className="text-gray-400 mb-1">Conciliaciones</p>
                                <p className="text-gray-800 font-semibold">{detalleData.num_conciliaciones || 0}</p>
                              </div>
                            </div>

                            {/* Importar plan contable */}
                            <div className="border-t border-gray-200 pt-3">
                              <p className="text-xs font-semibold text-gray-700 mb-2">Plan contable</p>
                              <div className="flex items-center gap-3 flex-wrap">
                                <label className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer transition-colors">
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                                  </svg>
                                  Importar Excel
                                  <input type="file" accept=".xlsx,.xls" className="hidden" onChange={ev => handleImportarPlanContable(e.id, ev.target.files[0])} />
                                </label>
                                <label className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg cursor-pointer transition-colors ${importandoPdf === e.id ? 'opacity-60' : ''}`}>
                                  {importandoPdf === e.id ? (
                                    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                                  ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
                                    </svg>
                                  )}
                                  {importandoPdf === e.id ? 'Analizando PDF...' : 'Importar PDF (Gemini)'}
                                  <input type="file" accept=".pdf" className="hidden" disabled={importandoPdf === e.id}
                                    onChange={ev => handleImportarPlanPdf(e.id, ev.target.files[0])} />
                                </label>
                                <button onClick={() => handleDescargarPlantillaPlan()}
                                  className="text-xs text-blue-600 hover:text-blue-800 hover:underline">
                                  Descargar plantilla Excel
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ),
                ].filter(Boolean);
              })}
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
                <label className="block text-xs font-medium text-gray-700 mb-1">Razon Social *</label>
                <input value={form.nombre} onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">CIF / VAT *</label>
                <input value={form.cif} onChange={e => setForm(p => ({ ...p, cif: e.target.value.toUpperCase() }))}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <p className="text-[10px] text-gray-400 mt-0.5">El CIF debe coincidir con el receptor (cif_receptor) de las facturas</p>
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
