import { useState, useEffect, useRef } from 'react';
import { fetchFacturas, reextraer } from '../../api.js';
import { tieneIncidencia } from '../TablaFacturas.jsx';
import { fmtFecha, inputCls, Spinner } from './helpers.jsx';

const ESTADO_COLOR = {
  PENDIENTE:       'bg-blue-50 text-blue-700 ring-blue-200',
  PROCESADA:       'bg-emerald-50 text-emerald-700 ring-emerald-200',
  REVISION_MANUAL: 'bg-red-50 text-red-700 ring-red-200',
};

function IconEstado({ estado }) {
  if (estado === 'PROCESADA')       return <span className="text-emerald-500 font-bold text-sm">✓</span>;
  if (estado === 'REVISION_MANUAL') return <span className="text-red-500 font-bold text-sm">✗</span>;
  return <span className="text-blue-400 animate-pulse text-sm">…</span>;
}

export default function PanelReanalizar({ onFacturasActualizadas }) {
  const [facturas,        setFacturas]        = useState([]);
  const [cargando,        setCargando]        = useState(true);
  const [filtroEstado,    setFiltroEstado]    = useState('');
  const [filtroGestion,   setFiltroGestion]   = useState('');
  const [filtroDatos,     setFiltroDatos]     = useState('');
  const [filtroProveedor, setFiltroProveedor] = useState('');
  const [busqueda,        setBusqueda]        = useState('');
  const [fechaDesde,      setFechaDesde]      = useState('');
  const [fechaHasta,      setFechaHasta]      = useState('');
  const [seleccionados,   setSeleccionados]   = useState(new Set());
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
      await cargarFacturas();
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
          Filtra y selecciona las facturas que quieres volver a analizar. Los datos extraidos se sobreescriben.
        </p>
      </div>

      {/* Filtros */}
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
          <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className={inputCls} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Fecha factura hasta</label>
          <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className={inputCls} />
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

      {/* Tabla */}
      <div className="overflow-x-auto" style={{ maxHeight: '320px', overflowY: 'auto' }}>
        {cargando ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : filtradas.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Sin facturas que coincidan con los filtros</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="px-4 py-2.5 w-10">
                  <input type="checkbox" checked={todosSeleccionados} onChange={toggleAll}
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

      {/* Log de progreso */}
      {progreso && (
        <div className="border-t border-gray-200">
          <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between gap-4">
            <span className="text-xs font-medium text-gray-700">
              {progreso.resumen
                ? `Completado — ${progreso.resumen.procesada} OK · ${progreso.resumen.revision} revision`
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
