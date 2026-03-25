import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  actualizarEstadoLineaConciliacion,
  fetchRevisionesConciliacion,
  guardarVinculoManual,
  eliminarVinculoManual,
} from '../api.js';

const ESTADO_CFG = {
  CONCILIADA:       { label: 'Conciliada',       cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  CONCILIADA_MANUAL:{ label: 'Conciliada manual', cls: 'bg-teal-50   text-teal-700   ring-teal-200'    },
  PARCIAL:          { label: 'Parcial',           cls: 'bg-amber-50  text-amber-700  ring-amber-200'   },
  SIN_MATCH:        { label: 'Sin match',         cls: 'bg-red-50    text-red-700    ring-red-200'      },
  SIN_FACTURA:      { label: 'Sin factura',       cls: 'bg-violet-50 text-violet-700 ring-violet-200'  },
};

function fmtFecha(iso) {
  if (!iso) return '\u2014';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtEuro(n) {
  if (n == null) return '\u2014';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function Badge({ estado }) {
  const c = ESTADO_CFG[estado] || { label: estado, cls: 'bg-gray-100 text-gray-600 ring-gray-200' };
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c.cls}`}>{c.label}</span>;
}

function StatCard({ label, value, color, bg }) {
  return (
    <div className={`${bg} rounded-xl p-4 flex flex-col gap-1`}>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      <span className="text-xs font-medium text-gray-500">{label}</span>
    </div>
  );
}

// ─── Selector de factura para vincular manualmente ──────────────────────────

function SelectorVincular({ anchorRef, facturasSinMatch, onVincular, onCerrar }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, openUp: false });
  const [q, setQ] = useState('');

  const calcPos = useCallback(() => {
    if (!anchorRef?.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const dropH = 280;
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < dropH && rect.top > dropH;
    setPos({
      left: Math.min(rect.left, window.innerWidth - 440),
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4, top: undefined, openUp: true }
        : { top: rect.bottom + 4, bottom: undefined, openUp: false }),
    });
  }, [anchorRef]);

  useEffect(() => { calcPos(); }, [calcPos]);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-vincular-btn]')) onCerrar();
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onCerrar]);

  const filtradas = q.trim()
    ? facturasSinMatch.filter(f => {
        const txt = `${f.factura.numero_factura} ${fmtFecha(f.factura.fecha_emision)} ${f.factura.total_factura}`.toLowerCase();
        return txt.includes(q.toLowerCase());
      })
    : facturasSinMatch;

  const style = {
    position: 'fixed', left: pos.left, zIndex: 9999, width: 420,
    ...(pos.top != null ? { top: pos.top } : {}),
    ...(pos.bottom != null ? { bottom: pos.bottom } : {}),
  };

  return createPortal(
    <div ref={ref} style={style} className="bg-white border border-gray-200 rounded-xl shadow-2xl overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
        <p className="text-xs font-semibold text-gray-700 mb-1.5">Vincular con factura sin match</p>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por numero, fecha o importe..."
          className="w-full rounded-md border border-gray-200 px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
          autoFocus autoComplete="off" />
      </div>
      <div className="max-h-52 overflow-y-auto">
        {filtradas.length === 0 ? (
          <p className="px-3 py-4 text-xs text-gray-400 text-center">Sin facturas disponibles</p>
        ) : filtradas.map(f => (
          <button key={f._globalIdx} type="button"
            onMouseDown={e => { e.preventDefault(); onVincular(f); }}
            className="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center gap-3 border-b border-gray-50 last:border-0">
            <span className="font-mono font-semibold text-gray-900 min-w-[6rem]">{f.factura.numero_factura || '\u2014'}</span>
            <span className="text-gray-500 min-w-[5rem]">{fmtFecha(f.factura.fecha_emision)}</span>
            <span className="font-semibold text-gray-700">{fmtEuro(f.factura.total_factura)}</span>
            <span className="text-gray-400 truncate ml-auto">{f.factura.nombre_archivo}</span>
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

// ─── Fila de resultado ──────────────────────────────────────────────────────

function FilaResultado({ r, globalIdx, conciliacionId, revisiones, guardando, onCambiarRevision, facturasSinMatch, onVincularManual }) {
  const bgMap = {
    CONCILIADA: 'bg-emerald-50/50', CONCILIADA_MANUAL: 'bg-teal-50/50',
    PARCIAL: 'bg-amber-50/50', SIN_MATCH: 'bg-red-50/50', SIN_FACTURA: 'bg-violet-50/50',
  };
  const bgCls = bgMap[r.estado] || '';
  const rev    = revisiones[globalIdx];
  const estRev = rev?.estado_revision || (r.estado === 'CONCILIADA' || r.estado === 'CONCILIADA_MANUAL' ? null : 'PENDIENTE');
  const [selectorAbierto, setSelectorAbierto] = useState(false);
  const btnRef = useRef(null);

  return (
    <tr className={`${bgCls} transition-colors hover:brightness-95`}>
      <td className="px-3 py-2 font-mono text-xs font-medium text-gray-900">{r.factura?.numero_factura || '\u2014'}</td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{r.factura ? fmtFecha(r.factura.fecha_emision) : '\u2014'}</td>
      <td className="px-3 py-2 text-right font-semibold text-gray-900 whitespace-nowrap text-xs">{r.factura ? fmtEuro(r.factura.total_factura) : '\u2014'}</td>
      <td className="px-3 py-2 text-center text-gray-300 text-xs">&harr;</td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{r.mayor ? fmtFecha(r.mayor.fecha) : '\u2014'}</td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.mayor?.documento || '\u2014'}</td>
      <td className="px-3 py-2 text-xs text-gray-700 max-w-[220px] truncate" title={r.mayor?.concepto}>{r.mayor?.concepto || '\u2014'}</td>
      <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap text-xs">{r.mayor ? fmtEuro(r.mayor.importe) : '\u2014'}</td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500 text-center">
        {r.detalleMatch.refSimplificada || '\u2014'}
        {r.detalleMatch.referenciaEncontrada && <span className="ml-1 text-emerald-600">&#10003;</span>}
      </td>
      <td className="px-3 py-2"><Badge estado={r.estado} /></td>
      <td className="px-3 py-2 relative">
        {r.estado === 'SIN_FACTURA' && facturasSinMatch.length > 0 && (
          <>
            <button ref={btnRef} data-vincular-btn onClick={() => setSelectorAbierto(v => !v)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
              </svg>
              Vincular
            </button>
            {selectorAbierto && (
              <SelectorVincular
                anchorRef={btnRef}
                facturasSinMatch={facturasSinMatch}
                onVincular={f => { onVincularManual(globalIdx, f._globalIdx); setSelectorAbierto(false); }}
                onCerrar={() => setSelectorAbierto(false)}
              />
            )}
          </>
        )}
        {estRev && conciliacionId && r.estado !== 'SIN_FACTURA' && (
          <select value={estRev} disabled={guardando[globalIdx]}
            onChange={e => onCambiarRevision(globalIdx, e.target.value)}
            className={`text-[11px] rounded-lg border px-1.5 py-1 font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              estRev === 'REVISADA' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
            } disabled:cursor-not-allowed disabled:opacity-50`}>
            <option value="PENDIENTE">Pendiente</option>
            <option value="REVISADA">Revisada</option>
          </select>
        )}
      </td>
    </tr>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────

export default function ResultadoConciliacionV2({ resultadosPorProveedor: resultadosIniciales, resumenGlobal: resumenInicial, conciliacionId, lineaEstados: lineaEstadosIniciales, lineasHistorial: lineasHistorialIniciales, vinculosManuales: vinculosDB }) {
  const [filtro, setFiltro]                       = useState('');
  const [provAbiertos, setProvAbiertos]           = useState(() => new Set(resultadosIniciales.map(p => p.codigoCuenta)));
  const [revisiones, setRevisiones]               = useState(() => {
    const m = {};
    if (lineaEstadosIniciales) { for (const [k, v] of Object.entries(lineaEstadosIniciales)) m[Number(k)] = v; }
    return m;
  });
  const [guardando, setGuardando]                 = useState({});
  const [lineasHistorial, setLineasHistorial]      = useState(lineasHistorialIniciales ?? []);
  const [mostrarHistorial, setMostrarHistorial]   = useState(false);

  // Reconstruir vínculos manuales desde la DB
  const [vinculos, setVinculos] = useState(() => {
    if (!vinculosDB?.length) return {};
    // Calcular índices globales
    let idx = 0;
    const todosConIdx = resultadosIniciales.flatMap(prov =>
      prov.resultados.map(r => ({ ...r, _globalIdx: idx++ }))
    );
    const map = {};
    for (const v of vinculosDB) {
      // Buscar la fila SIN_FACTURA que coincide con la línea del Mayor del vínculo
      const sinFactura = todosConIdx.find(r =>
        r.estado === 'SIN_FACTURA' && r.mayor &&
        r.mayor.fecha === v.mayor_fecha &&
        Math.round((r.mayor.importe || 0) * 100) === Math.round((parseFloat(v.mayor_importe) || 0) * 100)
      );
      // Buscar la fila SIN_MATCH que coincide con la factura del vínculo
      const sinMatch = todosConIdx.find(r =>
        r.estado === 'SIN_MATCH' && r.factura && r.factura.id === v.factura_id
      );
      if (sinFactura && sinMatch) {
        map[sinFactura._globalIdx] = sinMatch._globalIdx;
      }
    }
    return map;
  });

  function toggleProveedor(codigo) {
    setProvAbiertos(prev => { const n = new Set(prev); n.has(codigo) ? n.delete(codigo) : n.add(codigo); return n; });
  }

  async function cambiarRevision(idx, nuevoEstado) {
    if (!conciliacionId) return;
    setGuardando(prev => ({ ...prev, [idx]: true }));
    const anterior = revisiones[idx]?.estado_revision || 'PENDIENTE';
    setRevisiones(prev => ({ ...prev, [idx]: { ...prev[idx], estado_revision: nuevoEstado } }));
    try {
      await actualizarEstadoLineaConciliacion(conciliacionId, idx, nuevoEstado);
      const nuevas = await fetchRevisionesConciliacion(conciliacionId);
      setLineasHistorial(nuevas);
    } catch {
      setRevisiones(prev => ({ ...prev, [idx]: { ...prev[idx], estado_revision: anterior } }));
    } finally {
      setGuardando(prev => ({ ...prev, [idx]: false }));
    }
  }

  async function vincularManual(sinFacturaIdx, sinMatchIdx) {
    // Encontrar los datos para persistir
    const todos = provConIndices.flatMap(p => p.resultadosConIdx);
    const sinFactura = todos.find(r => r._globalIdx === sinFacturaIdx);
    const sinMatch   = todos.find(r => r._globalIdx === sinMatchIdx);
    if (!sinFactura?.mayor || !sinMatch?.factura) return;

    // Guardar en backend (memoria persistente)
    try {
      await guardarVinculoManual({
        factura_id:     sinMatch.factura.id,
        mayor_fecha:    sinFactura.mayor.fecha,
        mayor_documento: sinFactura.mayor.documento,
        mayor_concepto: sinFactura.mayor.concepto,
        mayor_importe:  sinFactura.mayor.importe,
        cuenta_mayor:   provConIndices.find(p => p.resultadosConIdx.some(r => r._globalIdx === sinFacturaIdx))?.codigoCuenta,
      });
    } catch (e) {
      console.error('Error guardando vinculo:', e.message);
    }

    setVinculos(prev => ({ ...prev, [sinFacturaIdx]: sinMatchIdx }));
  }

  async function desvincularManual(sinFacturaIdx) {
    const todos = provConIndices.flatMap(p => p.resultadosConIdx);
    const sinFactura = todos.find(r => r._globalIdx === sinFacturaIdx);
    const sinMatchIdx = vinculos[sinFacturaIdx];
    const sinMatch = todos.find(r => r._globalIdx === sinMatchIdx);

    if (sinMatch?.factura && sinFactura?.mayor) {
      try {
        await eliminarVinculoManual({
          factura_id:  sinMatch.factura.id,
          cuenta_mayor: provConIndices.find(p => p.resultadosConIdx.some(r => r._globalIdx === sinFacturaIdx))?.codigoCuenta,
          mayor_fecha: sinFactura.mayor.fecha,
          mayor_importe: sinFactura.mayor.importe,
        });
      } catch (e) {
        console.error('Error eliminando vinculo:', e.message);
      }
    }

    setVinculos(prev => { const n = { ...prev }; delete n[sinFacturaIdx]; return n; });
  }

  // Calcular índice global
  let globalIdx = 0;
  const provConIndices = resultadosIniciales.map(prov => ({
    ...prov,
    resultadosConIdx: prov.resultados.map(r => ({ ...r, _globalIdx: globalIdx++ })),
  }));

  // Aplicar vinculaciones manuales (locales)
  const sinMatchVinculados = new Set(Object.values(vinculos));

  const provConVinculos = provConIndices.map(prov => {
    const resultadosTransformados = prov.resultadosConIdx
      .filter(r => !sinMatchVinculados.has(r._globalIdx))
      .map(r => {
        if (r.estado === 'SIN_FACTURA' && vinculos[r._globalIdx] != null) {
          const orig = provConIndices.flatMap(p => p.resultadosConIdx).find(x => x._globalIdx === vinculos[r._globalIdx]);
          if (orig) return { ...r, estado: 'CONCILIADA_MANUAL', factura: orig.factura, detalleMatch: { ...r.detalleMatch, referenciaEncontrada: false, refSimplificada: null } };
        }
        return r;
      });
    return { ...prov, resultadosConIdx: resultadosTransformados };
  });

  const todosResultados = provConVinculos.flatMap(p => p.resultadosConIdx);
  const totalPorEstado = {
    CONCILIADA:        todosResultados.filter(r => r.estado === 'CONCILIADA').length,
    CONCILIADA_MANUAL: todosResultados.filter(r => r.estado === 'CONCILIADA_MANUAL').length,
    PARCIAL:           todosResultados.filter(r => r.estado === 'PARCIAL').length,
    SIN_MATCH:         todosResultados.filter(r => r.estado === 'SIN_MATCH').length,
    SIN_FACTURA:       todosResultados.filter(r => r.estado === 'SIN_FACTURA').length,
  };
  const totalOk = totalPorEstado.CONCILIADA + totalPorEstado.CONCILIADA_MANUAL;

  function getFacturasSinMatchDisponibles(codigoCuenta) {
    const prov = provConIndices.find(p => p.codigoCuenta === codigoCuenta);
    if (!prov) return [];
    return prov.resultadosConIdx.filter(r => r.estado === 'SIN_MATCH' && !sinMatchVinculados.has(r._globalIdx));
  }

  const filtrarFn = filtro === 'CONCILIADA'
    ? r => r.estado === 'CONCILIADA' || r.estado === 'CONCILIADA_MANUAL'
    : filtro ? r => r.estado === filtro : () => true;

  return (
    <div className="space-y-4">

      {/* Resumen global */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 text-base mb-4">Resultado de la conciliacion</h3>
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <StatCard label="Proveedores" value={resumenInicial.totalProveedores} color="text-gray-900" bg="bg-gray-50" />
          <StatCard label="Total" value={todosResultados.length} color="text-gray-900" bg="bg-gray-50" />
          <StatCard label="Conciliadas" value={totalOk} color="text-emerald-700" bg="bg-emerald-50" />
          <StatCard label="Parciales" value={totalPorEstado.PARCIAL} color="text-amber-700" bg="bg-amber-50" />
          <StatCard label="Sin match" value={totalPorEstado.SIN_MATCH} color="text-red-700" bg="bg-red-50" />
          <StatCard label="Sin factura" value={totalPorEstado.SIN_FACTURA} color="text-violet-700" bg="bg-violet-50" />
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-500">Filtrar:</span>
        {[
          { id: '', label: `Todos (${todosResultados.length})` },
          { id: 'CONCILIADA', label: `Conciliadas (${totalOk})` },
          { id: 'PARCIAL', label: `Parciales (${totalPorEstado.PARCIAL})` },
          { id: 'SIN_MATCH', label: `Sin match (${totalPorEstado.SIN_MATCH})` },
          { id: 'SIN_FACTURA', label: `Sin factura (${totalPorEstado.SIN_FACTURA})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filtro === f.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{f.label}</button>
        ))}
      </div>

      {/* Tabla por proveedor */}
      {provConVinculos.map(prov => {
        const abierto = provAbiertos.has(prov.codigoCuenta);
        const resultadosFiltrados = prov.resultadosConIdx.filter(filtrarFn);
        if (filtro && resultadosFiltrados.length === 0) return null;

        const provStats = {
          ok:  prov.resultadosConIdx.filter(r => r.estado === 'CONCILIADA' || r.estado === 'CONCILIADA_MANUAL').length,
          par: prov.resultadosConIdx.filter(r => r.estado === 'PARCIAL').length,
          sm:  prov.resultadosConIdx.filter(r => r.estado === 'SIN_MATCH').length,
          sf:  prov.resultadosConIdx.filter(r => r.estado === 'SIN_FACTURA').length,
        };

        return (
          <div key={prov.codigoCuenta} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <button onClick={() => toggleProveedor(prov.codigoCuenta)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-gray-400 transition-transform ${abierto ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                <span className="font-mono text-xs text-gray-400">{prov.codigoCuenta}</span>
                <span className="font-semibold text-gray-900 text-sm">{prov.razonSocial || prov.nombreMayor || prov.codigoCuenta}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-700 font-medium">{provStats.ok} OK</span>
                {provStats.par > 0 && <span className="text-amber-700 font-medium">{provStats.par} parcial</span>}
                {provStats.sm > 0 && <span className="text-red-700 font-medium">{provStats.sm} sin match</span>}
                {provStats.sf > 0 && <span className="text-violet-700 font-medium">{provStats.sf} sin factura</span>}
              </div>
            </button>

            {abierto && (
              <div className="border-t border-gray-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['N\u00ba Factura','Fecha','Importe','','Fecha Mayor','Doc.','Concepto Mayor','Importe Mayor','Ref.','Estado',''].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {resultadosFiltrados.length === 0 ? (
                      <tr><td colSpan={11} className="py-6 text-center text-sm text-gray-400">Sin resultados con este filtro</td></tr>
                    ) : resultadosFiltrados.map(r => {
                      if (r.estado === 'CONCILIADA_MANUAL') {
                        return (
                          <tr key={r._globalIdx} className="bg-teal-50/50 transition-colors hover:brightness-95">
                            <td className="px-3 py-2 font-mono text-xs font-medium text-gray-900">{r.factura?.numero_factura || '\u2014'}</td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{r.factura ? fmtFecha(r.factura.fecha_emision) : '\u2014'}</td>
                            <td className="px-3 py-2 text-right font-semibold text-gray-900 whitespace-nowrap text-xs">{r.factura ? fmtEuro(r.factura.total_factura) : '\u2014'}</td>
                            <td className="px-3 py-2 text-center text-teal-500 text-xs">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/>
                              </svg>
                            </td>
                            <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{r.mayor ? fmtFecha(r.mayor.fecha) : '\u2014'}</td>
                            <td className="px-3 py-2 font-mono text-xs text-gray-500">{r.mayor?.documento || '\u2014'}</td>
                            <td className="px-3 py-2 text-xs text-gray-700 max-w-[220px] truncate">{r.mayor?.concepto || '\u2014'}</td>
                            <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap text-xs">{r.mayor ? fmtEuro(r.mayor.importe) : '\u2014'}</td>
                            <td className="px-3 py-2 text-center text-xs text-gray-400">\u2014</td>
                            <td className="px-3 py-2"><Badge estado="CONCILIADA_MANUAL" /></td>
                            <td className="px-3 py-2">
                              <button onClick={() => desvincularManual(r._globalIdx)}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors whitespace-nowrap">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                                Deshacer
                              </button>
                            </td>
                          </tr>
                        );
                      }
                      return (
                        <FilaResultado key={r._globalIdx} r={r} globalIdx={r._globalIdx}
                          conciliacionId={conciliacionId} revisiones={revisiones} guardando={guardando}
                          onCambiarRevision={cambiarRevision}
                          facturasSinMatch={getFacturasSinMatchDisponibles(prov.codigoCuenta)}
                          onVincularManual={vincularManual} />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {/* Historial de revisiones */}
      {lineasHistorial.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <button onClick={() => setMostrarHistorial(v => !v)}
            className="w-full px-4 py-3 flex items-center justify-between text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
            <span>Historial de revisiones ({lineasHistorial.length})</span>
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-gray-400 transition-transform ${mostrarHistorial ? 'rotate-180' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
          </button>
          {mostrarHistorial && (
            <div className="border-t border-gray-100 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    {['Fecha / Hora','Referencia','Estado anterior','Estado nuevo','Usuario'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lineasHistorial.map((e, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">{new Date(e.creado_en).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-800">{e.numero_factura || '\u2014'}</td>
                      <td className="px-4 py-2.5"><Badge estado={e.estado_anterior === 'REVISADA' ? 'CONCILIADA' : 'SIN_MATCH'} /></td>
                      <td className="px-4 py-2.5"><Badge estado={e.estado_nuevo === 'REVISADA' ? 'CONCILIADA' : 'PARCIAL'} /></td>
                      <td className="px-4 py-2.5 text-gray-600">{e.usuario_nombre || '\u2014'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
