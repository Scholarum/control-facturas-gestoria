import { useState, useEffect } from 'react';
import { triggerSyncManual } from '../../api.js';
import { FRECUENCIAS, inputCls, Spinner } from './helpers.jsx';

export default function PanelSync({ config, onChange }) {
  const [local,   setLocal]   = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [ok,      setOk]      = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncRes, setSyncRes] = useState(null);

  useEffect(() => {
    if (config) setLocal({
      sync_activo:     config.sync_activo,
      sync_frecuencia: config.sync_frecuencia,
      sync_hora:       config.sync_hora,
    });
  }, [config]);

  if (!local) return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Sincronizacion con Drive</p>
      </div>
      <div className="flex justify-center py-8"><Spinner /></div>
    </div>
  );

  async function handleSave() {
    setSaving(true); setOk(false);
    try { await onChange(local); setOk(true); setTimeout(() => setOk(false), 3000); }
    catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleSyncNow() {
    setSyncing(true); setSyncRes(null);
    try {
      const r = await triggerSyncManual();
      const partes = [`${r.facturas_nuevas} nueva${r.facturas_nuevas !== 1 ? 's' : ''}`];
      if (r.extraccion?.procesada) partes.push(`${r.extraccion.procesada} extraida${r.extraccion.procesada !== 1 ? 's' : ''}`);
      if (r.extraccion?.revision)  partes.push(`${r.extraccion.revision} en revision`);
      setSyncRes({ ok: true, texto: partes.join(', ') });
    } catch (e) { setSyncRes({ ok: false, texto: e.message }); }
    finally { setSyncing(false); }
  }

  const mostrarHora = local.sync_frecuencia !== 'manual' && local.sync_frecuencia !== 'cada_hora';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Sincronizacion con Drive</p>
        <p className="text-xs text-gray-400 mt-0.5">Configura cuando se escanea automaticamente la carpeta de Drive para importar nuevas facturas.</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={local.sync_activo === 'true'}
              onChange={e => setLocal(p => ({ ...p, sync_activo: e.target.checked ? 'true' : 'false' }))}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm font-medium text-gray-700">Sincronizacion automatica activa</span>
          </label>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Frecuencia</label>
            <select value={local.sync_frecuencia}
              onChange={e => setLocal(p => ({ ...p, sync_frecuencia: e.target.value }))}
              className={inputCls}>
              {FRECUENCIAS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          {mostrarHora && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Hora de ejecucion</label>
              <input type="time" value={local.sync_hora}
                onChange={e => setLocal(p => ({ ...p, sync_hora: e.target.value }))}
                className={inputCls} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar'}
          </button>
          <button onClick={handleSyncNow} disabled={syncing}
            className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50">
            {syncing
              ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>}
            {syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
          </button>
          {syncRes && (
            <span className={`text-sm font-medium ${syncRes.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {syncRes.ok ? '✓' : '✗'} {syncRes.texto}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
