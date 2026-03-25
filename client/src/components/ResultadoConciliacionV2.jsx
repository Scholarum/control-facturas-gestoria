import { useState } from 'react';
import {
  actualizarEstadoLineaConciliacion,
  fetchRevisionesConciliacion,
} from '../api.js';

const ESTADO_CFG = {
  CONCILIADA: { label: 'Conciliada',  cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  PARCIAL:    { label: 'Parcial',     cls: 'bg-amber-50  text-amber-700  ring-amber-200'   },
  SIN_MATCH:  { label: 'Sin match',   cls: 'bg-red-50    text-red-700    ring-red-200'      },
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

function FilaResultado({ r, globalIdx, conciliacionId, revisiones, guardando, onCambiarRevision }) {
  const bgMap = { CONCILIADA: 'bg-emerald-50/50', PARCIAL: 'bg-amber-50/50', SIN_MATCH: 'bg-red-50/50' };
  const bgCls = bgMap[r.estado] || '';

  const rev    = revisiones[globalIdx];
  const estRev = rev?.estado_revision || (r.estado === 'CONCILIADA' ? null : 'PENDIENTE');

  return (
    <tr className={`${bgCls} transition-colors hover:brightness-95`}>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{fmtFecha(r.mayor.fecha)}</td>
      <td className="px-3 py-2 text-xs text-gray-700 max-w-[250px] truncate" title={r.mayor.concepto}>{r.mayor.concepto || '\u2014'}</td>
      <td className="px-3 py-2 text-right font-semibold text-gray-900 whitespace-nowrap text-xs">{fmtEuro(r.mayor.importe)}</td>
      <td className="px-3 py-2 text-center text-gray-300 text-xs">&harr;</td>
      <td className="px-3 py-2 font-mono text-xs font-medium text-gray-900">{r.factura?.numero_factura || '\u2014'}</td>
      <td className="px-3 py-2 text-gray-600 whitespace-nowrap text-xs">{r.factura ? fmtFecha(r.factura.fecha_emision) : '\u2014'}</td>
      <td className="px-3 py-2 text-right text-gray-600 whitespace-nowrap text-xs">{r.factura ? fmtEuro(r.factura.total_factura) : '\u2014'}</td>
      <td className="px-3 py-2 font-mono text-xs text-gray-500 text-center">
        {r.detalleMatch.refSimplificada || '\u2014'}
        {r.detalleMatch.referenciaEncontrada && <span className="ml-1 text-emerald-600" title="Referencia encontrada en concepto">&#10003;</span>}
      </td>
      <td className="px-3 py-2"><Badge estado={r.estado} /></td>
      <td className="px-3 py-2">
        {estRev && conciliacionId && (
          <select
            value={estRev}
            disabled={guardando[globalIdx]}
            onChange={e => onCambiarRevision(globalIdx, e.target.value)}
            className={`text-[11px] rounded-lg border px-1.5 py-1 font-medium cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              estRev === 'REVISADA' || estRev === 'CONCILIADA'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-amber-50 text-amber-700 border-amber-200'
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <option value="PENDIENTE">Pendiente</option>
            <option value="REVISADA">Revisada</option>
          </select>
        )}
      </td>
    </tr>
  );
}

export default function ResultadoConciliacionV2({ resultadosPorProveedor, resumenGlobal, conciliacionId, lineaEstados: lineaEstadosIniciales, lineasHistorial: lineasHistorialIniciales }) {
  const [filtro, setFiltro]                       = useState('');
  const [provAbiertos, setProvAbiertos]           = useState(() => new Set(resultadosPorProveedor.map(p => p.codigoCuenta)));
  const [revisiones, setRevisiones]               = useState(() => {
    const m = {};
    if (lineaEstadosIniciales) {
      for (const [k, v] of Object.entries(lineaEstadosIniciales)) m[Number(k)] = v;
    }
    return m;
  });
  const [guardando, setGuardando]                 = useState({});
  const [lineasHistorial, setLineasHistorial]      = useState(lineasHistorialIniciales ?? []);
  const [mostrarHistorial, setMostrarHistorial]   = useState(false);

  function toggleProveedor(codigo) {
    setProvAbiertos(prev => {
      const next = new Set(prev);
      next.has(codigo) ? next.delete(codigo) : next.add(codigo);
      return next;
    });
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

  // Calcular índice global para cada resultado
  let globalIdx = 0;
  const provConIndices = resultadosPorProveedor.map(prov => ({
    ...prov,
    resultadosConIdx: prov.resultados.map(r => ({ ...r, _globalIdx: globalIdx++ })),
  }));

  // Totales para filtros
  const todosResultados = provConIndices.flatMap(p => p.resultadosConIdx);
  const totalPorEstado = {
    CONCILIADA: todosResultados.filter(r => r.estado === 'CONCILIADA').length,
    PARCIAL:    todosResultados.filter(r => r.estado === 'PARCIAL').length,
    SIN_MATCH:  todosResultados.filter(r => r.estado === 'SIN_MATCH').length,
  };

  return (
    <div className="space-y-4">

      {/* Resumen global */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h3 className="font-semibold text-gray-900 text-base mb-4">Resultado de la conciliacion</h3>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Proveedores"   value={resumenGlobal.totalProveedores} color="text-gray-900"    bg="bg-gray-50"    />
          <StatCard label="Total lineas"  value={resumenGlobal.totalLineas}      color="text-gray-900"    bg="bg-gray-50"    />
          <StatCard label="Conciliadas"   value={resumenGlobal.conciliadas}      color="text-emerald-700" bg="bg-emerald-50" />
          <StatCard label="Parciales"     value={resumenGlobal.parciales}        color="text-amber-700"   bg="bg-amber-50"   />
          <StatCard label="Sin match"     value={resumenGlobal.sinMatch}         color="text-red-700"     bg="bg-red-50"     />
        </div>
      </div>

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-medium text-gray-500">Filtrar:</span>
        {[
          { id: '',           label: `Todos (${todosResultados.length})` },
          { id: 'CONCILIADA', label: `Conciliadas (${totalPorEstado.CONCILIADA})` },
          { id: 'PARCIAL',    label: `Parciales (${totalPorEstado.PARCIAL})` },
          { id: 'SIN_MATCH',  label: `Sin match (${totalPorEstado.SIN_MATCH})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFiltro(f.id)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filtro === f.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{f.label}</button>
        ))}
      </div>

      {/* Tabla por proveedor */}
      {provConIndices.map(prov => {
        const abierto = provAbiertos.has(prov.codigoCuenta);
        const resultadosFiltrados = filtro
          ? prov.resultadosConIdx.filter(r => r.estado === filtro)
          : prov.resultadosConIdx;

        if (filtro && resultadosFiltrados.length === 0) return null;

        return (
          <div key={prov.codigoCuenta} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {/* Cabecera de proveedor */}
            <button
              onClick={() => toggleProveedor(prov.codigoCuenta)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 text-gray-400 transition-transform ${abierto ? 'rotate-90' : ''}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
                </svg>
                <span className="font-mono text-xs text-gray-400">{prov.codigoCuenta}</span>
                <span className="font-semibold text-gray-900 text-sm">{prov.razonSocial || prov.nombreMayor || prov.codigoCuenta}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-700 font-medium">{prov.resumen.conciliadas} OK</span>
                {prov.resumen.parciales > 0 && <span className="text-amber-700 font-medium">{prov.resumen.parciales} parcial</span>}
                {prov.resumen.sinMatch > 0 && <span className="text-red-700 font-medium">{prov.resumen.sinMatch} sin match</span>}
              </div>
            </button>

            {/* Tabla de resultados */}
            {abierto && (
              <div className="border-t border-gray-100 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      {['Fecha Mayor','Concepto Mayor','Importe Mayor','','N\u00ba Factura DB','Fecha DB','Importe DB','Ref.','Estado','Rev.'].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {resultadosFiltrados.length === 0 ? (
                      <tr><td colSpan={10} className="py-6 text-center text-sm text-gray-400">Sin resultados con este filtro</td></tr>
                    ) : resultadosFiltrados.map(r => (
                      <FilaResultado
                        key={r._globalIdx}
                        r={r}
                        globalIdx={r._globalIdx}
                        conciliacionId={conciliacionId}
                        revisiones={revisiones}
                        guardando={guardando}
                        onCambiarRevision={cambiarRevision}
                      />
                    ))}
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
              fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
            </svg>
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
                      <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap text-xs">
                        {new Date(e.creado_en).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
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
