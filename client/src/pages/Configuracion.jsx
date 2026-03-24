import { useState, useEffect, useRef } from 'react';
import {
  fetchPrompt, savePrompt, resetPrompt, reextraer,
  fetchConfigSistema, saveConfigSistema,
  fetchHistorialSync, triggerSyncManual, testNotificacion,
} from '../api.js';

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

  if (!local) return null;

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
      setSyncRes({ ok: true, texto: `${r.facturas_nuevas} facturas nuevas, ${r.facturas_error} en revisión` });
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

  useEffect(() => {
    if (config) setLocal({
      notify_activo:     config.notify_activo,
      notify_frecuencia: config.notify_frecuencia,
      notify_hora:       config.notify_hora,
      notify_app_url:    config.notify_app_url,
    });
  }, [config]);

  if (!local) return null;

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
      if (r.saltado)  setTestRes({ ok: true,  texto: `No enviado: ${r.motivo}` });
      else if (r.error) setTestRes({ ok: false, texto: r.error });
      else             setTestRes({ ok: true,  texto: `Enviado a ${r.enviados} destinatario(s)` });
    } catch (e) { setTestRes({ ok: false, texto: e.message }); }
    finally { setTesting(false); }
  }

  const mostrarHora = local.notify_frecuencia !== 'cada_hora';

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">Notificaciones por email (Mailjet)</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Envía un resumen de facturas pendientes a los usuarios de Gestoría. Requiere <code className="bg-gray-100 px-1 rounded">MAILJET_API_KEY</code> y <code className="bg-gray-100 px-1 rounded">MAILJET_API_SECRET</code> en el archivo <code className="bg-gray-100 px-1 rounded">.env</code>.
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

          <div className="flex flex-col gap-1 min-w-[240px]">
            <label className="text-xs font-medium text-gray-500">URL de la aplicación (en el email)</label>
            <input type="url" value={local.notify_app_url}
              onChange={e => setLocal(p => ({ ...p, notify_app_url: e.target.value }))}
              placeholder="https://mi-app.com"
              className={`${inputCls} w-full`} />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-1.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
            {saving ? 'Guardando…' : ok ? '✓ Guardado' : 'Guardar'}
          </button>
          <button onClick={handleTest} disabled={testing}
            className="px-4 py-1.5 text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors disabled:opacity-50">
            {testing ? 'Enviando…' : 'Enviar prueba ahora'}
          </button>
          {testRes && (
            <span className={`text-sm font-medium ${testRes.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {testRes.ok ? '✓' : '✗'} {testRes.texto}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Panel: Historial de sincronizaciones ────────────────────────────────────

function PanelHistorialSync() {
  const [historial,  setHistorial]  = useState([]);
  const [cargando,   setCargando]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function cargar() {
    setRefreshing(true);
    try { setHistorial(await fetchHistorialSync()); }
    catch (_) {}
    finally { setCargando(false); setRefreshing(false); }
  }

  useEffect(() => { cargar(); }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Historial de sincronizaciones</p>
          <p className="text-xs text-gray-400 mt-0.5">Últimas 50 ejecuciones (manuales y automáticas).</p>
        </div>
        <button onClick={cargar} disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50">
          {refreshing
            ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
            : <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>}
          Actualizar
        </button>
      </div>
      <div className="overflow-x-auto">
        {cargando ? (
          <div className="flex justify-center py-10">
            <svg className="h-5 w-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          </div>
        ) : historial.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">Sin registros todavía</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha', 'Origen', 'Estado', 'Nuevas', 'En revisión', 'Duración', 'Detalle'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {historial.map(row => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtFecha(row.fecha)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${
                      row.origen === 'CRON'
                        ? 'bg-purple-50 text-purple-700 ring-purple-200'
                        : 'bg-blue-50 text-blue-700 ring-blue-200'
                    }`}>{row.origen}</span>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${
                      row.estado === 'OK'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : 'bg-red-50 text-red-700 ring-red-200'
                    }`}>{row.estado}</span>
                  </td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-gray-900">{row.facturas_nuevas}</td>
                  <td className="px-4 py-2.5">
                    {row.facturas_error > 0
                      ? <span className="text-sm font-semibold text-red-600">{row.facturas_error}</span>
                      : <span className="text-sm text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{fmtMs(row.duracion_ms)}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-400 max-w-[200px] truncate" title={row.detalle?.error || ''}>
                    {row.detalle?.error
                      ? <span className="text-red-500">{row.detalle.error}</span>
                      : row.detalle?.total_escaneadas != null
                        ? `${row.detalle.total_escaneadas} PDFs escaneados`
                        : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function Configuracion({ todasFacturas, onFacturasActualizadas }) {
  const [prompt,       setPrompt]       = useState('');
  const [promptOrig,   setPromptOrig]   = useState('');
  const [loadingPrompt,setLoadingPrompt]= useState(true);
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [savedOk,      setSavedOk]      = useState(false);

  const [ejecutando,   setEjecutando]   = useState(false);
  const [progreso,     setProgreso]     = useState(null);
  const logRef = useRef(null);

  const [sistemaConfig, setSistemaConfig] = useState(null);

  // Carga inicial
  useEffect(() => {
    fetchPrompt()
      .then(p => { setPrompt(p); setPromptOrig(p); })
      .catch(() => {})
      .finally(() => setLoadingPrompt(false));
    fetchConfigSistema()
      .then(setSistemaConfig)
      .catch(() => {});
  }, []);

  // Auto-scroll del log de extracción
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [progreso?.logs]);

  async function handleSavePrompt() {
    setSavingPrompt(true); setSavedOk(false);
    try {
      await savePrompt(prompt);
      setPromptOrig(prompt); setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e) { alert(e.message); }
    finally { setSavingPrompt(false); }
  }

  async function handleReextraer() {
    setEjecutando(true);
    setProgreso({ done: 0, total: 0, logs: [], resumen: null });
    try {
      await reextraer([], (ev) => {
        setProgreso(prev => {
          const logs = prev?.logs ?? [];
          if (ev.tipo === 'inicio') {
            return { ...prev, total: ev.total, logs: [...logs, { tipo: 'inicio', id: ev.id, nombre: ev.nombre, proveedor: ev.proveedor }] };
          }
          if (ev.tipo === 'resultado') {
            const nuevosLogs = logs.map(l =>
              l.id === ev.id && l.tipo === 'inicio' ? { ...l, tipo: 'resultado', estado: ev.estado, error: ev.error } : l
            );
            return { ...prev, done: ev.done, logs: nuevosLogs };
          }
          if (ev.tipo === 'fin') {
            return { ...prev, done: ev.total, total: ev.total, logs, resumen: ev.resumen };
          }
          return prev;
        });
        if (ev.tipo === 'resultado' && ev.estado === 'PROCESADA' && ev.datos) {
          onFacturasActualizadas(ev.id, ev.estado, ev.datos);
        } else if (ev.tipo === 'resultado' && ev.estado === 'REVISION_MANUAL') {
          onFacturasActualizadas(ev.id, ev.estado, null);
        }
      });
    } catch (e) {
      setProgreso(prev => ({ ...prev, error: e.message }));
    } finally {
      setEjecutando(false);
    }
  }

  async function handleSaveSistema(updates) {
    const saved = await saveConfigSistema(updates);
    setSistemaConfig(saved);
  }

  const promptCambiado = prompt !== promptOrig;

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="text-base font-semibold text-gray-900">Configuración</h2>

      {/* ── Sincronización con Drive ── */}
      <PanelSync config={sistemaConfig} onChange={handleSaveSistema} />

      {/* ── Notificaciones ── */}
      <PanelNotificaciones config={sistemaConfig} onChange={handleSaveSistema} />

      {/* ── Historial de sincronizaciones ── */}
      <PanelHistorialSync />

      {/* ── Prompt de Gemini ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-900">Prompt de extracción (Gemini)</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Instrucciones que recibe la IA al analizar cada factura PDF. Los cambios afectan a los próximos análisis.
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

      {/* ── Re-análisis con Gemini ── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-gray-900">Re-analizar facturas con Gemini</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Lanza el extractor sobre todas las facturas. Los datos extraídos se sobreescriben en tiempo real.
          </p>
        </div>
        <button onClick={handleReextraer} disabled={ejecutando}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50">
          {ejecutando ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/>
            </svg>
          )}
          Analizar todas las facturas
        </button>

        {progreso && (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between gap-4">
              <span className="text-xs font-medium text-gray-700">
                {progreso.resumen
                  ? `Completado — ${progreso.resumen.procesada} OK · ${progreso.resumen.revision} revisión`
                  : progreso.total > 0
                    ? `Procesando… ${progreso.done} / ${progreso.total}`
                    : 'Iniciando…'}
              </span>
              {progreso.total > 0 && (
                <div className="flex-1 max-w-xs bg-gray-200 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-300 ${progreso.resumen ? 'bg-emerald-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.round((progreso.done / progreso.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            <div ref={logRef} className="max-h-64 overflow-y-auto divide-y divide-gray-100 bg-white">
              {progreso.error && (
                <div className="px-4 py-2.5 text-xs text-red-600 bg-red-50">Error: {progreso.error}</div>
              )}
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
    </div>
  );
}
