import { useState, useEffect } from 'react';
import { fetchPrompt, savePrompt, resetPrompt, fetchConfigSistema, saveConfigSistema } from '../api.js';
import PanelSync from '../components/configuracion/PanelSync.jsx';
import PanelHistorialSync from '../components/configuracion/PanelHistorialSync.jsx';
import PanelReanalizar from '../components/configuracion/PanelReanalizar.jsx';
import PanelNotificaciones from '../components/configuracion/PanelNotificaciones.jsx';
import PanelEmailTemplate from '../components/configuracion/PanelEmailTemplate.jsx';
import PanelHistorialNotificaciones from '../components/configuracion/PanelHistorialNotificaciones.jsx';
import DriveManager from '../components/configuracion/DriveManager.jsx';
import PanelChat from '../components/configuracion/PanelChat.jsx';
import PanelCuentasGasto from '../components/configuracion/PanelCuentasGasto.jsx';
import { Spinner } from '../components/configuracion/helpers.jsx';

const TABS = [
  { id: 'drive',   label: 'Drive y Subida' },
  { id: 'sync',    label: 'Sincronizacion' },
  { id: 'notif',   label: 'Notificaciones' },
  { id: 'chat',    label: 'Chat Asistente' },
  { id: 'cuentas', label: 'Cuentas Gasto' },
];

export default function Configuracion({ onFacturasActualizadas }) {
  const [activeTab,     setActiveTab]     = useState('drive');
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

  function retryConfig() {
    setLoadingConfig(true); setConfigError(null);
    fetchConfigSistema()
      .then(data => { setSistemaConfig(data); setConfigError(null); })
      .catch(e => setConfigError(e.message))
      .finally(() => setLoadingConfig(false));
  }

  const promptCambiado = prompt !== promptOrig;

  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex items-center gap-3">
        <h2 className="text-base font-semibold text-gray-900">Configuracion</h2>
        <span className="px-2 py-0.5 text-[10px] font-medium text-slate-500 bg-slate-100 rounded-full uppercase tracking-wide">Global</span>
      </div>

      {/* Pestanas */}
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

      {/* Error cargando configuracion global */}
      {configError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <p className="text-sm text-red-700">Error al cargar la configuracion del sistema: {configError}</p>
          <button onClick={retryConfig}
            className="px-3 py-1 text-xs font-medium text-red-700 bg-red-100 hover:bg-red-200 rounded-lg transition-colors">
            Reintentar
          </button>
        </div>
      )}

      {/* Cargando configuracion */}
      {loadingConfig && !configError && (
        <div className="flex justify-center py-6"><Spinner /></div>
      )}

      {/* Panel modo gestoria (siempre visible) */}
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

      {/* Pestana: Drive y Subida */}
      {activeTab === 'drive' && <DriveManager />}

      {/* Pestana: Sincronizacion */}
      {activeTab === 'sync' && (
        <div className="space-y-6">
          <PanelSync config={sistemaConfig} onChange={handleSaveSistema} />
          <PanelHistorialSync />
          <PanelReanalizar onFacturasActualizadas={onFacturasActualizadas} />

          {/* Prompt de Gemini */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Prompt de extraccion (Gemini)</p>
                <p className="text-xs text-gray-400 mt-0.5">Instrucciones que recibe la IA al analizar cada factura PDF.</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {savedOk && <span className="text-xs text-emerald-600 font-medium">Guardado ✓</span>}
                <button onClick={async () => {
                    if (!confirm('¿Restaurar el prompt por defecto? Se perderan los cambios actuales.')) return;
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
              <div className="flex justify-center py-10"><Spinner /></div>
            ) : (
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
                rows={22} spellCheck={false}
                className="w-full px-5 py-4 font-mono text-xs text-gray-800 bg-gray-50 resize-y focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500 border-0" />
            )}
          </div>
        </div>
      )}

      {/* Pestana: Notificaciones */}
      {activeTab === 'notif' && (
        <div className="space-y-6">
          <PanelNotificaciones config={sistemaConfig} onChange={handleSaveSistema} />
          <PanelEmailTemplate />
          <PanelHistorialNotificaciones />
        </div>
      )}

      {activeTab === 'chat' && (
        <PanelChat config={sistemaConfig} onChange={handleSaveSistema} />
      )}

      {/* Pestana: Cuentas de Gasto */}
      {activeTab === 'cuentas' && <PanelCuentasGasto />}
    </div>
  );
}
