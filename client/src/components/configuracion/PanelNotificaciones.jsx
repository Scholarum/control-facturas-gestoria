import { useState, useEffect } from 'react';
import { testNotificacion, fetchDiagnosticoNotificacion } from '../../api.js';
import { FRECUENCIAS, inputCls, Spinner } from './helpers.jsx';

export default function PanelNotificaciones({ config, onChange }) {
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
      <div className="flex justify-center py-8"><Spinner /></div>
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
        <p className="text-sm font-semibold text-gray-900">Configuracion de notificaciones (Mailjet)</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Envia un resumen de facturas pendientes a los usuarios con rol Gestoria.
          Requiere <code className="bg-gray-100 px-1 rounded">MAILJET_API_KEY</code> y <code className="bg-gray-100 px-1 rounded">MAILJET_API_SECRET</code> en las variables de entorno del servidor.
        </p>
      </div>
      <div className="px-5 py-4 space-y-4">
        <div className="flex flex-wrap gap-4 items-end">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={local.notify_activo === 'true'}
              onChange={e => setLocal(p => ({ ...p, notify_activo: e.target.checked ? 'true' : 'false' }))}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <span className="text-sm font-medium text-gray-700">Notificaciones automaticas activas</span>
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
              <label className="text-xs font-medium text-gray-500">Hora de envio</label>
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
            <label className="text-xs font-medium text-gray-500">URL de la aplicacion (en el email)</label>
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
            {diagLoad ? 'Comprobando…' : 'Diagnostico'}
          </button>
          {testRes && (
            <span className={`text-sm font-medium ${testRes.ok ? 'text-emerald-600' : 'text-red-600'}`}>
              {testRes.ok ? '✓' : '✗'} {testRes.texto}
            </span>
          )}
        </div>

        {/* Resultado del diagnostico */}
        {diag && (
          <div className="border border-gray-200 rounded-lg overflow-hidden text-xs">
            <div className="bg-gray-50 px-4 py-2 font-semibold text-gray-600 border-b border-gray-200">Resultado del diagnostico</div>
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
                <span>Facturas pendientes: <strong>{diag.facturas_pendientes}</strong> · Notificaciones automaticas: <strong>{diag.notify_activo === 'true' ? 'activas' : 'desactivadas'}</strong></span>
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
