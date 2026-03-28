import { useState, useEffect } from 'react';
import { fetchEmailTemplate, saveEmailTemplate } from '../../api.js';
import { inputCls, Spinner } from './helpers.jsx';

export default function PanelEmailTemplate() {
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
        <p className="text-sm font-semibold text-gray-900">Plantilla de email de notificacion</p>
        <p className="text-xs text-gray-400 mt-0.5">
          Variables disponibles: <code className="bg-gray-100 px-1 rounded">{'{{total}}'}</code> (num facturas),{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{s}}'}</code> (plural),{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{nombre}}'}</code> (destinatario),{' '}
          <code className="bg-gray-100 px-1 rounded">{'{{url}}'}</code> (enlace a la app).
        </p>
      </div>
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
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
