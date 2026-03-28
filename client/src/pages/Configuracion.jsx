import { useState, useEffect, useRef } from 'react';
import {
  fetchPrompt, savePrompt, resetPrompt, reextraer,
  fetchConfigSistema, saveConfigSistema,
  fetchHistorialSync, triggerSyncManual, testNotificacion,
  fetchHistorialNotificaciones, fetchEmailTemplate, saveEmailTemplate,
  fetchFacturas, fetchDiagnosticoNotificacion, fetchEstadoMensaje,
} from '../api.js';
import { tieneIncidencia } from '../components/TablaFacturas.jsx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function IconEstado({ estado }) {
  if (estado === 'PROCESADA')      return <span className="text-emerald-500 font-bold text-sm">✓</span>;
  if (estado === 'REVISION_MANUAL') return <span className="text-red-500 font-bold text-sm">✗</span>;
  return <span className="text-blue-400 animate-pulse text-sm">…</span>;
}

function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function fmtMs(ms) {
  if (!ms) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

const FRECUENCIAS = [
  { value: 'manual',    label: 'Solo manual' },
  { value: 'cada_hora', label: 'Cada hora' },
  { value: 'cada_6h',   label: 'Cada 6 horas' },
  { value: 'diaria',    label: 'Diaria' },
  { value: 'semanal',   label: 'Semanal (lunes)' },
];

const inputCls = 'rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

// ─── Panel: Sincronización con Drive ──────────────────────────────────────────

function PanelSync({ config, onChange }) {
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
      <div className="flex justify-center py-8">
        <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      </div>
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
      if (r.extraccion?.procesada) partes.push(`${r.extraccion.procesada} extraída${r.extraccion.procesada !== 1 ? 's' : ''}`);
      if (r.extraccion?.revision)  partes.push(`${r.extraccion.revision} en revisión`);
      setSyncRes({ ok: true, texto: partes.join(', ') });
    } catch (e) { setSyncRes({ ok: false, texto: e.message }); }
    finally { setSyncing(false); }
  }

  const mostrarHora = local.sync_frecuencia !== 'manual' && local.sync_frecuencia !== 'cada_hora';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Sincronización con Drive</p>
        <p className="text-xs text-gray-400 mt-0.5">Configura cuándo se escanea automáticamente la carpeta de Drive para importar nuevas facturas.</p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={local.sync_activo === 'true'}
              onChange={e => setLocal(p => ({ ...p, sync_activo: e.target.checked ? 'true' : 'false' }))}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm font-medium text-gray-700">Sincronización automática activa</span>
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
              <label className="text-xs font-medium text-gray-500">Hora de ejecución</label>
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

// ─── Panel: Notificaciones ────────────────────────────────────────────────────

function PanelNotificaciones({ config, onChange }) {
  const [local,   setLocal]   = useState(null);
  const [saving,  setSaving]  = useState(false);
  const [ok,      setOk]      = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState(null);
  const [diag,    setDiag]    = useState(null);
  const [diagLoad,setDiagLoad]= useState(false);

  useEffect(() => {
    if (config) setLocal({
      notify_activo:     config.notify_activo,
      notify_frecuencia: config.notify_frecuencia,
      notify_hora:       config.notify_hora,
      notify_app_url:    config.notify_app_url,
      email_remitente:   config.email_remitente || '',
    });
  }, [config]);

  if (!local) return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Configuracion de notificaciones (Mailjet)</p>
      </div>
      <div className="flex justify-center py-8">
        <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      </div>
    </div>
  );

  async function handleSave() {
    setSaving(true); setOk(false);
    try { await onChange(local); setOk(true); setTimeout(() => setOk(false), 3000); }
    catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  async function handleTest() {
    setTesting(true); setTestRes(null);
    try {
      const r = await testNotificacion();
      if (r.saltado)    setTestRes({ ok: true,  texto: `No enviado: ${r.motivo}` });
      else if (r.error) setTestRes({ ok: false, texto: r.error });
      else              setTestRes({ ok: true,  texto: `Enviado a ${r.enviados} destinatario(s)` });
    } catch (e) { setTestRes({ ok: false, texto: e.message }); }
    finally { setTesting(false); }
  }

  async function handleDiag() {
    setDiagLoad(true);
    try { setDiag(await fetchDiagnosticoNotificacion()); }
    catch (e) { setDiag({ advertencias: [e.message] }); }
    finally { setDiagLoad(false); }
  }

  const mostrarHora = local.notify_frecuencia !== 'cada_hora';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Configuración de notificaciones (Mailjet)</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Envía un resumen de facturas pendientes a los usuarios con rol Gestoría.
          Requiere <code className="bg-gray-100 px-1 rounded">MAILJET_API_KEY</code> y <code className="bg-gray-100 px-1 rounded">MAILJET_API_SECRET</code> en las variables de entorno del servidor.
        </p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={local.notify_activo === 'true'}
              onChange={e => setLocal(p => ({ ...p, notify_activo: e.target.checked ? 'true' : 'false' }))}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm font-medium text-gray-700">Notificaciones automáticas activas</span>
          </label>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Frecuencia</label>
            <select value={local.notify_frecuencia}
              onChange={e => setLocal(p => ({ ...p, notify_frecuencia: e.target.value }))}
              className={inputCls}>
              {FRECUENCIAS.filter(f => f.value !== 'manual').map(f =>
                <option key={f.value} value={f.value}>{f.label}</option>
              )}
            </select>
          </div>

          {mostrarHora && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Hora de envío</label>
              <input type="time" value={local.notify_hora}
                onChange={e => setLocal(p => ({ ...p, notify_hora: e.target.value }))}
                className={inputCls} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-4">
          <div className="flex flex-col gap-1 min-w-[260px]">
            <label className="text-xs font-medium text-gray-500">Email remitente <span className="text-red-500">*</span></label>
            <input type="email" value={local.email_remitente}
              onChange={e => setLocal(p => ({ ...p, email_remitente: e.target.value }))}
              placeholder="notificaciones@tudominio.com"
              className={`${inputCls} w-full`} />
            <p className="text-xs text-gray-400">Debe ser un dominio verificado en Mailjet.</p>
          </div>
          <div className="flex flex-col gap-1 min-w-[260px]">
            <label className="text-xs font-medium text-gray-500">URL de la aplicación (en el email)</label>
            <input type="url" value={local.notify_app_url}
              onChange={e => setLocal(p => ({ ...p, notify_app_url: e.target.value }))}
              placeholder="https://mi-app.com"
              className={`${inputCls} w-full`} />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar'}
          </button>
          <button onClick={handleTest} disabled={testing}
            className="px-4 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors disabled:opacity-50">
            {testing ? 'Enviando…' : 'Enviar prueba ahora'}
          </button>
          <button onClick={handleDiag} disabled={diagLoad}
            className="px-4 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50">
            {diagLoad ? 'Comprobando…' : 'Diagnóstico'}
          </button>
          {testRes && (
            <span className={`text-sm font-medium ${testRes.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {testRes.ok ? '✓' : '✗'} {testRes.texto}
            </span>
          )}
        </div>

        {/* Resultado del diagnóstico */}
        {diag && (
          <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
            <div className="bg-gray-50 px-4 py-2 font-semibold text-gray-600 border-b border-gray-200">Resultado del diagnóstico</div>
            <div className="px-4 py-3 space-y-1.5">
              <div className="flex gap-2">
                <span className={diag.mailjet_key_presente ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                  {diag.mailjet_key_presente ? '✓' : '✗'}
                </span>
                <span>MAILJET_API_KEY {diag.mailjet_key_presente ? 'presente' : 'NO configurada'}</span>
              </div>
              <div className="flex gap-2">
                <span className={diag.mailjet_secret_presente ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                  {diag.mailjet_secret_presente ? '✓' : '✗'}
                </span>
                <span>MAILJET_API_SECRET {diag.mailjet_secret_presente ? 'presente' : 'NO configurada'}</span>
              </div>
              <div className="flex gap-2">
                <span className={diag.from_email && !diag.from_email.includes('(sin') ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                  {diag.from_email && !diag.from_email.includes('(sin') ? '✓' : '✗'}
                </span>
                <span>Email remitente: <strong>{diag.from_email}</strong></span>
              </div>
              <div className="flex gap-2">
                <span className={diag.destinatarios?.length ? 'text-emerald-500 font-bold' : 'text-amber-500 font-bold'}>
                  {diag.destinatarios?.length ? '✓' : '⚠'}
                </span>
                <span>
                  Destinatarios GESTORIA: {diag.destinatarios?.length
                    ? diag.destinatarios.map(d => `${d.nombre} <${d.email}>`).join(', ')
                    : 'ninguno'}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-blue-500 font-bold">i</span>
                <span>Facturas pendientes: <strong>{diag.facturas_pendientes}</strong> · Notificaciones automáticas: <strong>{diag.notify_activo === 'true' ? 'activas' : 'desactivadas'}</strong></span>
              </div>
              {diag.advertencias?.length > 0 && (
                <div className="mt-2 space-y-1">
                  {diag.advertencias.map((a, i) => (
                    <div key={i} className="flex gap-2 text-amber-700 bg-amber-50 rounded px-3 py-1.5">
                      <span className="font-bold flex-shrink-0">⚠</span>
                      <span>{a}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Panel: Historial de sincronizaciones ────────────────────────────────────

function PanelHistorialSync() {
  const [historial,  setHistorial]  = useState([]);
  const [cargando,   setCargando]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filtros,    setFiltros]    = useState({ fechaDesde: '', fechaHasta: '', origen: '', estado: '' });

  function setF(k, v) { setFiltros(prev => ({ ...prev, [k]: v })); }
  const hayFiltros = Object.values(filtros).some(Boolean);

  async function cargar() {
    setRefreshing(true);
    try { setHistorial(await fetchHistorialSync()); }
    catch (_) {}
    finally { setCargando(false); setRefreshing(false); }
  }

  useEffect(() => { cargar(); }, []);

  const filtrados = historial.filter(r => {
    if (filtros.origen && r.origen !== filtros.origen) return false;
    if (filtros.estado && r.estado !== filtros.estado) return false;
    if (filtros.fechaDesde && r.fecha && r.fecha.slice(0, 10) < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && r.fecha && r.fecha.slice(0, 10) > filtros.fechaHasta) return false;
    return true;
  });

  const inputCls = 'rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Historial de sincronizaciones</p>
          <p className="text-xs text-gray-400 mt-0.5">Ultimas 50 ejecuciones (manuales y automaticas).</p>
        </div>
        <button onClick={cargar} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50">
          {refreshing
            ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>}
          Actualizar
        </button>
      </div>
      {/* Filtros */}
      {!cargando && historial.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Desde</label>
            <input type="date" value={filtros.fechaDesde} onChange={e => setF('fechaDesde', e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Hasta</label>
            <input type="date" value={filtros.fechaHasta} onChange={e => setF('fechaHasta', e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Origen</label>
            <select value={filtros.origen} onChange={e => setF('origen', e.target.value)} className={inputCls}>
              <option value="">Todos</option><option value="CRON">CRON</option><option value="MANUAL">MANUAL</option>
            </select>
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Estado</label>
            <select value={filtros.estado} onChange={e => setF('estado', e.target.value)} className={inputCls}>
              <option value="">Todos</option><option value="OK">OK</option><option value="ERROR">ERROR</option>
            </select>
          </div>
          {hayFiltros && <button onClick={() => setFiltros({ fechaDesde: '', fechaHasta: '', origen: '', estado: '' })} className="text-xs text-gray-500 hover:text-gray-800 self-end pb-0.5">Limpiar</button>}
          <span className="text-[10px] text-gray-400 ml-auto self-end">{filtrados.length} de {historial.length}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-10">
            <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
          </div>
        ) : filtrados.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">{hayFiltros ? 'Sin resultados con estos filtros' : 'Sin registros'}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha', 'Origen', 'Estado', 'Nuevas', 'Duplicadas', 'En revision', 'Duracion', 'Detalle'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.map(row => {
                const dups = row.detalle?.duplicadas || [];
                const numDups = row.facturas_duplicadas || dups.length || 0;
                const dupTooltip = dups.length
                  ? dups.map(d => `${d.nombre_archivo} (${d.numero_factura || '?'} - ${d.cif_emisor || '?'}) en ${d.ruta_drive || '?'}`).join('\n')
                  : '';
                return (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtFecha(row.fecha)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${row.origen === 'CRON' ? 'bg-purple-50 text-purple-700 ring-purple-200' : 'bg-blue-50 text-blue-700 ring-blue-200'}`}>{row.origen}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${row.estado === 'OK' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : 'bg-red-50 text-red-700 ring-red-200'}`}>{row.estado}</span>
                    </td>
                    <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">{row.facturas_nuevas}</td>
                    <td className="px-4 py-2.5" title={dupTooltip}>
                      <span className={numDups > 0 ? 'text-sm font-semibold text-amber-600 cursor-help' : 'text-sm text-gray-400'}>{numDups}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {row.facturas_error > 0 ? <span className="text-sm font-semibold text-red-600">{row.facturas_error}</span> : <span className="text-sm text-gray-400">0</span>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500">{fmtMs(row.duracion_ms)}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[200px] truncate" title={row.detalle?.error || ''}>
                      {row.detalle?.error ? <span className="text-red-500">{row.detalle.error}</span> : row.detalle?.total_escaneadas != null ? `${row.detalle.total_escaneadas} PDFs escaneados` : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Panel: Plantilla de email ────────────────────────────────────────────────

function PanelEmailTemplate() {
  const [asunto,  setAsunto]  = useState('');
  const [cuerpo,  setCuerpo]  = useState('');
  const [orig,    setOrig]    = useState({ asunto: '', cuerpo: '' });
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [ok,      setOk]      = useState(false);

  useEffect(() => {
    fetchEmailTemplate()
      .then(t => { setAsunto(t.asunto); setCuerpo(t.cuerpo); setOrig(t); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true); setOk(false);
    try {
      await saveEmailTemplate({ asunto, cuerpo });
      setOrig({ asunto, cuerpo }); setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (e) { alert(e.message); }
    finally { setSaving(false); }
  }

  const cambiado = asunto !== orig.asunto || cuerpo !== orig.cuerpo;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Plantilla de email de notificación</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Variables disponibles: <code className="bg-gray-100 px-1 rounded">{'{{total}}'}</code> (nº facturas),{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{s}}'}</code> (plural),{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{nombre}}'}</code> (destinatario),{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{url}}'}</code> (enlace a la app).
        </p>
      </div>
      {loading ? (
        <div className="flex justify-center py-8">
          <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
        </div>
      ) : (
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Asunto</label>
            <input type="text" value={asunto} onChange={e => setAsunto(e.target.value)}
              className={`${inputCls} w-full`} placeholder="Asunto del email" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Cuerpo del mensaje</label>
            <textarea value={cuerpo} onChange={e => setCuerpo(e.target.value)}
              rows={4} className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y w-full"
              placeholder="Texto del email…" />
          </div>
          <div className="flex items-center gap-3">
            <button onClick={handleSave} disabled={saving || !cambiado}
              className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar plantilla'}
            </button>
            <button onClick={() => { setAsunto(orig.asunto); setCuerpo(orig.cuerpo); }}
              disabled={!cambiado}
              className="px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40">
              Descartar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Panel: Historial de notificaciones ──────────────────────────────────────

const MJ_STATUS_COLOR = {
  sent:      'text-emerald-700 bg-emerald-50',
  opened:    'text-blue-700 bg-blue-50',
  clicked:   'text-purple-700 bg-purple-50',
  bounce:    'text-red-700 bg-red-50',
  hardbounced: 'text-red-700 bg-red-50',
  softbounced: 'text-orange-700 bg-orange-50',
  spam:      'text-red-700 bg-red-50',
  blocked:   'text-red-700 bg-red-50',
  queued:    'text-gray-600 bg-gray-100',
  deferred:  'text-amber-700 bg-amber-50',
};

function PanelHistorialNotificaciones() {
  const [historial,     setHistorial]     = useState([]);
  const [cargando,      setCargando]      = useState(true);
  const [refreshing,    setRefreshing]    = useState(false);
  const [expanded,      setExpanded]      = useState(null);
  const [estadosMj,     setEstadosMj]     = useState({});
  const [filtros,       setFiltros]       = useState({ fechaDesde: '', fechaHasta: '', origen: '' });

  function setF(k, v) { setFiltros(prev => ({ ...prev, [k]: v })); }
  const hayFiltrosN = Object.values(filtros).some(Boolean);

  async function cargar() {
    setRefreshing(true);
    try { setHistorial(await fetchHistorialNotificaciones()); }
    catch (_) {}
    finally { setCargando(false); setRefreshing(false); }
  }

  useEffect(() => { cargar(); }, []);

  const filtradosN = historial.filter(r => {
    if (filtros.origen && r.origen !== filtros.origen) return false;
    if (filtros.fechaDesde && r.fecha && r.fecha.slice(0, 10) < filtros.fechaDesde) return false;
    if (filtros.fechaHasta && r.fecha && r.fecha.slice(0, 10) > filtros.fechaHasta) return false;
    return true;
  });

  function toggleRow(id) {
    setExpanded(prev => prev === id ? null : id);
  }

  async function verEstado(messageId) {
    setEstadosMj(prev => ({ ...prev, [messageId]: { loading: true } }));
    try {
      const data = await fetchEstadoMensaje(messageId);
      setEstadosMj(prev => ({ ...prev, [messageId]: { loading: false, data } }));
    } catch (e) {
      setEstadosMj(prev => ({ ...prev, [messageId]: { loading: false, error: e.message } }));
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Historial de notificaciones</p>
          <p className="text-xs text-gray-400 mt-0.5">Últimos 50 envíos (manuales y automáticos). Haz clic en una fila para ver los detalles.</p>
        </div>
        <button onClick={cargar} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50">
          {refreshing
            ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>}
          Actualizar
        </button>
      </div>
      {/* Filtros */}
      {!cargando && historial.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Desde</label>
            <input type="date" value={filtros.fechaDesde} onChange={e => setF('fechaDesde', e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Hasta</label>
            <input type="date" value={filtros.fechaHasta} onChange={e => setF('fechaHasta', e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[10px] font-medium text-gray-500">Origen</label>
            <select value={filtros.origen} onChange={e => setF('origen', e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Todos</option><option value="CRON">CRON</option><option value="MANUAL">MANUAL</option><option value="TEST">TEST</option>
            </select>
          </div>
          {hayFiltrosN && <button onClick={() => setFiltros({ fechaDesde: '', fechaHasta: '', origen: '' })} className="text-xs text-gray-500 hover:text-gray-800 self-end pb-0.5">Limpiar</button>}
          <span className="text-[10px] text-gray-400 ml-auto self-end">{filtradosN.length} de {historial.length}</span>
        </div>
      )}
      <div className="overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-10">
            <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
          </div>
        ) : filtradosN.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">{hayFiltrosN ? 'Sin resultados con estos filtros' : 'Sin registros'}</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha', 'Origen', 'Asunto', 'Enviados', 'Errores'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtradosN.map(row => {
                const dests = (() => { try { return JSON.parse(row.destinatarios || '[]'); } catch { return []; } })();
                const mjRes = (() => { try { return JSON.parse(row.respuesta_mj || '[]'); } catch { return []; } })();
                return (
                  <>
                    <tr key={row.id} onClick={() => toggleRow(row.id)}
                      className="hover:bg-gray-50 cursor-pointer">
                      <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtFecha(row.fecha)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${
                          row.origen === 'CRON'
                            ? 'bg-purple-50 text-purple-700 ring-purple-200'
                            : row.origen === 'TEST'
                              ? 'bg-amber-50 text-amber-700 ring-amber-200'
                              : 'bg-blue-50 text-blue-700 ring-blue-200'
                        }`}>{row.origen}</span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 max-w-[220px] truncate">{row.asunto || '—'}</td>
                      <td className="px-4 py-2.5 text-sm font-semibold text-emerald-700">{row.enviados}</td>
                      <td className="px-4 py-2.5">
                        {row.errores > 0
                          ? <span className="text-sm font-semibold text-red-600">{row.errores}</span>
                          : <span className="text-sm text-gray-400">—</span>}
                      </td>
                    </tr>
                    {expanded === row.id && (
                      <tr key={`${row.id}-detail`} className="bg-gray-50">
                        <td colSpan={5} className="px-4 py-3 text-xs text-gray-700">
                          <div className="space-y-2">
                            {dests.length > 0 && (
                              <div>
                                <p className="font-semibold text-gray-500 mb-1 uppercase tracking-wide">Destinatarios</p>
                                <div className="flex flex-col gap-1">
                                  {dests.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                      <span className={d.enviado ? 'text-emerald-500 font-bold' : 'text-red-500 font-bold'}>
                                        {d.enviado ? '✓' : '✗'}
                                      </span>
                                      <span className="text-gray-800">{d.nombre} &lt;{d.email}&gt;</span>
                                      {d.mj_id && <span className="text-gray-400">ID: {d.mj_id}</span>}
                                      {d.error && <span className="text-red-500">{d.error}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {mjRes.length > 0 && (
                              <div>
                                <p className="font-semibold text-gray-500 mb-1 uppercase tracking-wide">Respuesta Mailjet</p>
                                <div className="space-y-2">
                                  {mjRes.map((m, i) => {
                                    const eid   = m.id ?? m.mj_id;
                                    const est   = eid ? estadosMj[eid] : null;
                                    const mjData = est?.data?.Data?.[0];
                                    return (
                                      <div key={i} className="bg-white border border-gray-200 rounded p-2 space-y-1">
                                        <div className="flex items-center gap-2 flex-wrap">
                                          <span className="font-medium text-gray-700">{m.email}</span>
                                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${m.status === 'success' ? 'text-emerald-700 bg-emerald-50' : 'text-red-700 bg-red-50'}`}>
                                            API: {m.status ?? '—'}
                                          </span>
                                          {eid && (
                                            <button onClick={() => verEstado(eid)} disabled={est?.loading}
                                              className="px-2 py-0.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors disabled:opacity-50">
                                              {est?.loading ? 'Consultando…' : 'Ver estado entrega'}
                                            </button>
                                          )}
                                          {mjData?.Status && (
                                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${MJ_STATUS_COLOR[mjData.Status.toLowerCase()] ?? 'text-gray-600 bg-gray-100'}`}>
                                              Entrega: {mjData.Status}
                                            </span>
                                          )}
                                        </div>
                                        {eid && <p className="text-gray-400">ID: {eid}{m.uuid ? ` · UUID: ${m.uuid}` : ''}</p>}
                                        {m.error && <p className="text-red-500 break-all">{m.error}</p>}
                                        {mjData && (
                                          <div className="text-gray-500 space-y-0.5 mt-1">
                                            {mjData.ArrivedAt && <p>Recibido por Mailjet: {new Date(mjData.ArrivedAt).toLocaleString('es-ES')}</p>}
                                            {mjData.Subject   && <p>Asunto: {mjData.Subject}</p>}
                                            {mjData.SpamassassinScore != null && <p>SpamAssassin score: {mjData.SpamassassinScore}</p>}
                                            {mjData.IsClickTracked != null && <p>Click tracking: {mjData.IsClickTracked ? 'sí' : 'no'}</p>}
                                          </div>
                                        )}
                                        {est?.error && <p className="text-red-500">{est.error}</p>}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Panel: Re-analizar facturas ─────────────────────────────────────────────

const ESTADO_COLOR = {
  PENDIENTE:       'bg-blue-50 text-blue-700 ring-blue-200',
  PROCESADA:       'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REVISION_MANUAL: 'bg-red-50 text-red-700 ring-red-200',
};

function PanelReanalizar({ onFacturasActualizadas }) {
  const [facturas,         setFacturas]         = useState([]);
  const [cargando,         setCargando]         = useState(true);
  const [filtroEstado,     setFiltroEstado]     = useState('');
  const [filtroGestion,    setFiltroGestion]    = useState('');
  const [filtroDatos,      setFiltroDatos]      = useState('');
  const [filtroProveedor,  setFiltroProveedor]  = useState('');
  const [busqueda,         setBusqueda]         = useState('');
  const [fechaDesde,       setFechaDesde]       = useState('');
  const [fechaHasta,       setFechaHasta]       = useState('');
  const [seleccionados,    setSeleccionados]    = useState(new Set());
  const [ejecutando,      setEjecutando]      = useState(false);
  const [progreso,        setProgreso]        = useState(null);
  const logRef = useRef(null);

  async function cargarFacturas() {
    setCargando(true);
    try { setFacturas(await fetchFacturas()); } catch (_) {}
    finally { setCargando(false); }
  }

  useEffect(() => { cargarFacturas(); }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progreso?.logs]);

  const proveedores = [...new Set(facturas.map(f => f.proveedor).filter(Boolean))].sort();

  const filtradas = facturas.filter(f => {
    if (filtroEstado    && f.estado    !== filtroEstado)                              return false;
    if (filtroGestion   && (f.estado_gestion || 'PENDIENTE') !== filtroGestion)       return false;
    if (filtroDatos === 'si' && !tieneIncidencia(f))                                  return false;
    if (filtroDatos === 'no' && tieneIncidencia(f))                                   return false;
    if (filtroProveedor && f.proveedor !== filtroProveedor)                           return false;
    if (busqueda        && !f.nombre_archivo?.toLowerCase().includes(busqueda.toLowerCase())) return false;
    if (fechaDesde || fechaHasta) {
      const datos = (() => { try { return f.datos_extraidos ? JSON.parse(f.datos_extraidos) : null; } catch { return null; } })();
      const fe = datos?.fecha_emision ?? null;
      if (fe) {
        if (fechaDesde && fe < fechaDesde) return false;
        if (fechaHasta && fe > fechaHasta) return false;
      }
    }
    return true;
  });

  const filtradosIds       = filtradas.map(f => f.id);
  const todosSeleccionados = filtradosIds.length > 0 && filtradosIds.every(id => seleccionados.has(id));
  const algunoSeleccionado = filtradosIds.some(id => seleccionados.has(id));

  function toggleAll() {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (todosSeleccionados) { filtradosIds.forEach(id => next.delete(id)); }
      else                    { filtradosIds.forEach(id => next.add(id)); }
      return next;
    });
  }

  function toggleOne(id) {
    setSeleccionados(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const idsParaReanalizar = filtradosIds.filter(id => seleccionados.has(id));

  async function handleReanalizar() {
    if (!idsParaReanalizar.length) return;
    setEjecutando(true);
    setProgreso({ done: 0, total: 0, logs: [], resumen: null });
    try {
      await reextraer(idsParaReanalizar, (ev) => {
        setProgreso(prev => {
          const logs = prev?.logs ?? [];
          if (ev.tipo === 'inicio') {
            return { ...prev, total: ev.total, logs: [...logs, { tipo: 'inicio', id: ev.id, nombre: ev.nombre, proveedor: ev.proveedor }] };
          }
          if (ev.tipo === 'resultado') {
            return { ...prev, done: ev.done, logs: logs.map(l =>
              l.id === ev.id && l.tipo === 'inicio' ? { ...l, tipo: 'resultado', estado: ev.estado, error: ev.error } : l
            )};
          }
          if (ev.tipo === 'fin') {
            return { ...prev, done: ev.total, total: ev.total, resumen: ev.resumen };
          }
          return prev;
        });
        if (ev.tipo === 'resultado') {
          if (ev.estado === 'PROCESADA' && ev.datos) onFacturasActualizadas(ev.id, ev.estado, ev.datos);
          else if (ev.estado === 'REVISION_MANUAL')  onFacturasActualizadas(ev.id, ev.estado, null);
        }
      });
      await cargarFacturas(); // refresca estados tras extracción
    } catch (e) {
      setProgreso(prev => ({ ...prev, error: e.message }));
    } finally {
      setEjecutando(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Re-analizar facturas con Gemini</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Filtra y selecciona las facturas que quieres volver a analizar. Los datos extraídos se sobreescriben.
        </p>
      </div>

      {/* ── Filtros ── */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Extraccion</label>
          <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            <option value="SINCRONIZADA">Sin extraer</option>
            <option value="PROCESADA">Procesada</option>
            <option value="REVISION_MANUAL">Revision manual</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Estado gestion</label>
          <select value={filtroGestion} onChange={e => setFiltroGestion(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="DESCARGADA">Descargada</option>
            <option value="CC_ASIGNADA">Cta. Gasto</option>
            <option value="CONTABILIZADA">Contabilizada</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Datos</label>
          <select value={filtroDatos} onChange={e => setFiltroDatos(e.target.value)}
            className={`${inputCls} ${filtroDatos === 'si' ? 'text-red-600 font-medium' : filtroDatos === 'no' ? 'text-emerald-600 font-medium' : ''}`}>
            <option value="">Todos</option>
            <option value="si">Incompletos</option>
            <option value="no">Completos</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Proveedor</label>
          <select value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)} className={inputCls}>
            <option value="">Todos</option>
            {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Buscar</label>
          <input type="text" value={busqueda} onChange={e => setBusqueda(e.target.value)}
            placeholder="Nombre de archivo…" className={`${inputCls} w-48`} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Fecha factura desde</label>
          <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
            className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Fecha factura hasta</label>
          <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
            className={inputCls} />
        </div>
        <div className="ml-auto flex items-end">
          <button onClick={handleReanalizar} disabled={ejecutando || !idsParaReanalizar.length}
            className="flex items-center gap-2 px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
            {ejecutando
              ? <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
              : <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>}
            {ejecutando
              ? 'Analizando…'
              : idsParaReanalizar.length
                ? `Re-analizar (${idsParaReanalizar.length})`
                : 'Re-analizar seleccionadas'}
          </button>
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="overflow-x-auto" style={{ maxHeight: '320px', overflowY: 'auto' }}>
        {cargando ? (
          <div className="flex justify-center py-8">
            <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          </div>
        ) : filtradas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Sin facturas que coincidan con los filtros</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2.5 w-10">
                  <input type="checkbox"
                    checked={todosSeleccionados}
                    onChange={toggleAll}
                    ref={el => { if (el) el.indeterminate = algunoSeleccionado && !todosSeleccionados; }}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                </th>
                {['Archivo', 'Proveedor', 'Estado', 'Fecha subida'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtradas.map(f => (
                <tr key={f.id} onClick={() => toggleOne(f.id)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={seleccionados.has(f.id)} onChange={() => toggleOne(f.id)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-800 max-w-[220px] truncate" title={f.nombre_archivo}>{f.nombre_archivo}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">{f.proveedor || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${ESTADO_COLOR[f.estado] || 'bg-gray-50 text-gray-600 ring-gray-200'}`}>
                      {f.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">{fmtFecha(f.fecha_subida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Log de progreso ── */}
      {progreso && (
        <div className="border-t border-gray-200">
          <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-gray-700">
              {progreso.resumen
                ? `Completado — ${progreso.resumen.procesada} OK · ${progreso.resumen.revision} revisión`
                : progreso.total > 0 ? `Procesando… ${progreso.done} / ${progreso.total}` : 'Iniciando…'}
            </span>
            {progreso.total > 0 && (
              <div className="flex-1 max-w-xs bg-gray-200 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full transition-all duration-300 ${progreso.resumen ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${Math.round((progreso.done / progreso.total) * 100)}%` }} />
              </div>
            )}
          </div>
          <div ref={logRef} className="max-h-52 overflow-y-auto divide-y divide-gray-100 bg-white">
            {progreso.error && <div className="px-4 py-2.5 text-xs text-red-600 bg-red-50">Error: {progreso.error}</div>}
            {progreso.logs.map((log, i) => (
              <div key={i} className="px-4 py-2 flex items-start gap-3">
                <div className="mt-0.5 w-4 flex-shrink-0 text-center"><IconEstado estado={log.estado} /></div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium text-gray-800 truncate block">
                    {log.proveedor ? `${log.proveedor} / ` : ''}{log.nombre}
                  </span>
                  {log.error && <span className="text-xs text-red-500 mt-0.5 block">{log.error}</span>}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">id={log.id}</span>
              </div>
            ))}
            {progreso.logs.length === 0 && !progreso.error && (
              <div className="px-4 py-4 text-xs text-gray-400 text-center">Esperando respuesta del servidor…</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

const TABS = [
  { id: 'sync',  label: 'Sincronización de facturas' },
  { id: 'notif', label: 'Notificaciones' },
];

export default function Configuracion({ todasFacturas, onFacturasActualizadas }) {
  const [activeTab,     setActiveTab]     = useState('sync');
  const [prompt,        setPrompt]        = useState('');
  const [promptOrig,    setPromptOrig]    = useState('');
  const [loadingPrompt, setLoadingPrompt] = useState(true);
  const [savingPrompt,  setSavingPrompt]  = useState(false);
  const [savedOk,       setSavedOk]       = useState(false);
  const [sistemaConfig, setSistemaConfig] = useState(null);
  const [configError,   setConfigError]   = useState(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    fetchPrompt()
      .then(p => { setPrompt(p); setPromptOrig(p); })
      .catch(() => {})
      .finally(() => setLoadingPrompt(false));
    fetchConfigSistema()
      .then(data => { setSistemaConfig(data); setConfigError(null); })
      .catch(e => setConfigError(e.message))
      .finally(() => setLoadingConfig(false));
  }, []);

  async function handleSavePrompt() {
    setSavingPrompt(true); setSavedOk(false);
    try {
      await savePrompt(prompt);
      setPromptOrig(prompt); setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e) { alert(e.message); }
    finally { setSavingPrompt(false); }
  }

  async function handleSaveSistema(updates) {
    const saved = await saveConfigSistema(updates);
    setSistemaConfig(saved);
  }

  const promptCambiado = prompt !== promptOrig;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-gray-900">Configuracion</h2>
        <span className="px-2 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-100 rounded-full uppercase tracking-wide">Global</span>
      </div>

      {/* ── Pestañas ── */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              activeTab === t.id
                ? 'bg-white border border-b-white border-gray-200 text-blue-700 -mb-px'
                : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Error cargando configuración global ── */}
      {configError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-red-700">Error al cargar la configuracion del sistema: {configError}</p>
          <button onClick={() => {
            setLoadingConfig(true); setConfigError(null);
            fetchConfigSistema()
              .then(data => { setSistemaConfig(data); setConfigError(null); })
              .catch(e => setConfigError(e.message))
              .finally(() => setLoadingConfig(false));
          }} className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors">
            Reintentar
          </button>
        </div>
      )}

      {/* ── Cargando configuración ── */}
      {loadingConfig && !configError && (
        <div className="flex justify-center py-6">
          <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
        </div>
      )}

      {/* ── Panel modo gestoría (siempre visible) ── */}
      {sistemaConfig && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">Modo de funcionamiento para Gestoria</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {sistemaConfig.modo_gestoria === 'v1'
                  ? 'v1: La gestoria solo descarga facturas y las contabiliza. Sin cuentas contables ni exportacion A3.'
                  : 'v2: Flujo completo con cuentas contables, cuentas de gasto y exportacion A3/SICE.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {['v1', 'v2'].map(m => (
                <button key={m}
                  onClick={() => handleSaveSistema({ modo_gestoria: m })}
                  className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-colors ${
                    sistemaConfig.modo_gestoria === m
                      ? m === 'v1' ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' : 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Pestaña: Sincronización de facturas ── */}
      {activeTab === 'sync' && (
        <div className="space-y-6">
          <PanelSync config={sistemaConfig} onChange={handleSaveSistema} />
          <PanelHistorialSync />
          <PanelReanalizar onFacturasActualizadas={onFacturasActualizadas} />

          {/* Prompt de Gemini */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Prompt de extracción (Gemini)</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Instrucciones que recibe la IA al analizar cada factura PDF.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {savedOk && <span className="text-xs text-emerald-600 font-medium">Guardado ✓</span>}
                <button onClick={async () => {
                    if (!confirm('¿Restaurar el prompt por defecto? Se perderán los cambios actuales.')) return;
                    const p = await resetPrompt();
                    setPrompt(p); setPromptOrig(p);
                  }}
                  disabled={savingPrompt}
                  className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40">
                  Restaurar defecto
                </button>
                <button onClick={() => setPrompt(promptOrig)}
                  disabled={!promptCambiado || savingPrompt}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40">
                  Descartar
                </button>
                <button onClick={handleSavePrompt}
                  disabled={!promptCambiado || savingPrompt}
                  className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-40">
                  {savingPrompt ? 'Guardando…' : 'Guardar prompt'}
                </button>
              </div>
            </div>
            {loadingPrompt ? (
              <div className="flex justify-center py-10">
                <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              </div>
            ) : (
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                rows={22} spellCheck={false}
                className="w-full px-5 py-4 font-mono text-xs text-gray-800 bg-gray-50 resize-y focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 border-0" />
            )}
          </div>
        </div>
      )}

      {/* ── Pestaña: Notificaciones ── */}
      {activeTab === 'notif' && (
        <div className="space-y-6">
          <PanelNotificaciones config={sistemaConfig} onChange={handleSaveSistema} />
          <PanelEmailTemplate />
          <PanelHistorialNotificaciones />
        </div>
      )}
    </div>
  );
}
