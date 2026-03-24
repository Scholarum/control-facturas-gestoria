import { useState } from 'react';
import { descargarPdfConciliacion, descargarExcelConciliacion } from '../api.js';

const ESTADO_CFG = {
  OK:               { label: 'OK',             cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  PENDIENTE_EN_SAGE:{ label: 'Pendiente SAGE', cls: 'bg-amber-50  text-amber-700  ring-amber-200'   },
  ERROR_IMPORTE:    { label: 'Error importe',  cls: 'bg-red-50    text-red-700    ring-red-200'      },
};

function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtEuro(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function motivoError(r) {
  if (r.estado === 'PENDIENTE_EN_SAGE') return 'No localizada en el Mayor SAGE';
  if (r.estado === 'ERROR_IMPORTE') {
    const importeDif = r.importe_drive !== r.sage?.importe;
    const fechaDif   = r.fecha_emision !== r.sage?.fecha;
    if (importeDif && fechaDif) return `Importe y fecha no coinciden (Drive: ${fmtEuro(r.importe_drive)} · SAGE: ${fmtEuro(r.sage?.importe)})`;
    if (importeDif)             return `Diferencia de importe (Drive: ${fmtEuro(r.importe_drive)} · SAGE: ${fmtEuro(r.sage?.importe)})`;
    if (fechaDif)               return `Fecha diferente (Drive: ${fmtFecha(r.fecha_emision)} · SAGE: ${fmtFecha(r.sage?.fecha)})`;
  }
  return '';
}

function Badge({ estado }) {
  const c = ESTADO_CFG[estado] || { label: estado, cls: 'bg-gray-100 text-gray-600 ring-gray-200' };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c.cls}`}>
      {c.label}
    </span>
  );
}

function StatCard({ label, value, color, bg }) {
  return (
    <div className={`${bg} rounded-xl p-4 flex flex-col gap-1`}>
      <span className={`text-2xl font-bold ${color}`}>{value}</span>
      <span className="text-xs font-medium text-gray-500">{label}</span>
    </div>
  );
}

export default function ResultadoConciliacion({ resumen, resultados }) {
  const [filtroEstado, setFiltroEstado] = useState('');
  const [descargandoPdf,   setDescargandoPdf]   = useState(false);
  const [descargandoExcel, setDescargandoExcel] = useState(false);

  const filtrados = filtroEstado
    ? resultados.filter(r => r.estado === filtroEstado)
    : resultados;

  const conError = resultados.filter(r => r.estado !== 'OK');

  async function descargarPdf() {
    setDescargandoPdf(true);
    try { await descargarPdfConciliacion(resumen, resultados); }
    finally { setDescargandoPdf(false); }
  }

  async function descargarExcel() {
    setDescargandoExcel(true);
    try { await descargarExcelConciliacion(resumen, resultados); }
    finally { setDescargandoExcel(false); }
  }

  return (
    <div className="space-y-4">

      {/* Resumen */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="font-semibold text-gray-900 text-base">Resultado de la conciliación</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {resumen.proveedor} &nbsp;·&nbsp;
              {fmtFecha(resumen.fechaDesde) || 'Sin inicio'} → {fmtFecha(resumen.fechaHasta) || 'Sin fin'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              onClick={descargarExcel}
              disabled={descargandoExcel}
              className="flex items-center gap-2 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              {descargandoExcel ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M10 3v18M14 3v18" />
                </svg>
              )}
              {descargandoExcel ? 'Generando...' : 'Exportar Excel'}
            </button>
            <button
              onClick={descargarPdf}
              disabled={descargandoPdf}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60 whitespace-nowrap"
            >
              {descargandoPdf ? (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              )}
              {descargandoPdf ? 'Generando...' : 'Descargar PDF'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total analizadas" value={resumen.total}          color="text-gray-900"    bg="bg-gray-50"    />
          <StatCard label="OK"               value={resumen.ok}             color="text-emerald-700" bg="bg-emerald-50" />
          <StatCard label="Pendientes SAGE"  value={resumen.pendientesSage} color="text-amber-700"   bg="bg-amber-50"   />
          <StatCard label="Error importe"    value={resumen.errorImporte}   color="text-red-700"     bg="bg-red-50"     />
        </div>
      </div>

      {/* Detalle de errores */}
      {conError.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-red-50/60">
            <h4 className="text-sm font-semibold text-red-800">
              Facturas con incidencias ({conError.length})
            </h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {['Estado','Nº Factura Drive','Archivo','Fecha','Importe Drive','Nº SAGE','Importe SAGE','Motivo'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {conError.map((r, i) => (
                  <tr key={i} className={r.estado === 'ERROR_IMPORTE' ? 'bg-red-50/40' : 'bg-amber-50/40'}>
                    <td className="px-4 py-3"><Badge estado={r.estado} /></td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">{r.numero_factura || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500 max-w-[180px] truncate">{r.nombre_archivo || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(r.fecha_emision)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtEuro(r.importe_drive)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.sage?.numero_factura || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{fmtEuro(r.sage?.importe)}</td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[260px]">{motivoError(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tabla completa con filtro */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">

        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-500">Filtrar:</span>
          {['', 'OK', 'PENDIENTE_EN_SAGE', 'ERROR_IMPORTE'].map(estado => (
            <button
              key={estado}
              onClick={() => setFiltroEstado(estado)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filtroEstado === estado
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {estado === '' ? `Todos (${resultados.length})` : `${ESTADO_CFG[estado]?.label} (${resultados.filter(r=>r.estado===estado).length})`}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Estado','Nº Drive','Fecha emis.','Importe Drive','Nº SAGE','Importe SAGE','Diferencia'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-gray-400">
                    No hay resultados con este filtro
                  </td>
                </tr>
              ) : filtrados.map((r, i) => {
                const difNeg = r.diferencia != null && r.diferencia < 0;
                const difPos = r.diferencia != null && r.diferencia > 0;
                return (
                  <tr key={i} className={`hover:bg-gray-50 transition-colors ${
                    r.estado === 'ERROR_IMPORTE'    ? 'bg-red-50/40'   :
                    r.estado === 'PENDIENTE_EN_SAGE'? 'bg-amber-50/40' : ''
                  }`}>
                    <td className="px-4 py-3"><Badge estado={r.estado} /></td>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-gray-900">{r.numero_factura || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(r.fecha_emision)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900 whitespace-nowrap">{fmtEuro(r.importe_drive)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.sage?.numero_factura || '—'}</td>
                    <td className="px-4 py-3 text-right text-gray-600 whitespace-nowrap">{fmtEuro(r.sage?.importe)}</td>
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${difNeg ? 'text-red-600' : difPos ? 'text-amber-600' : 'text-gray-400'}`}>
                      {r.diferencia != null ? fmtEuro(r.diferencia) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
