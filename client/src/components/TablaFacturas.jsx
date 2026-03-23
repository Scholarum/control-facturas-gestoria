import { BadgeGestion, BadgeExtraccion } from './Badge.jsx';

function fmt€(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function Th({ children, className = '' }) {
  return (
    <th className={`px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide ${className}`}>
      {children}
    </th>
  );
}

function EmptyState({ hayFiltros }) {
  return (
    <tr>
      <td colSpan={9} className="py-20 text-center">
        <div className="flex flex-col items-center gap-2 text-gray-400">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium">
            {hayFiltros ? 'No hay facturas con esos filtros' : 'No hay facturas sincronizadas'}
          </p>
          {!hayFiltros && (
            <p className="text-xs">Ejecuta <code className="bg-gray-100 px-1 rounded">node sync.js --save</code> para importar desde Drive</p>
          )}
        </div>
      </td>
    </tr>
  );
}

export default function TablaFacturas({ facturas, seleccionados, onToggle, onToggleTodo, loading, hayFiltros }) {
  const todosSeleccionados = facturas.length > 0 && seleccionados.size === facturas.length;
  const algunoSeleccionado = seleccionados.size > 0 && !todosSeleccionados;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  type="checkbox"
                  checked={todosSeleccionados}
                  ref={el => { if (el) el.indeterminate = algunoSeleccionado; }}
                  onChange={onToggleTodo}
                  className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
              </th>
              <Th>Proveedor</Th>
              <Th>Nº Factura</Th>
              <Th>Fecha emisión</Th>
              <Th className="text-right">Total</Th>
              <Th>CIF Emisor</Th>
              <Th>Forma de pago</Th>
              <Th>Extracción</Th>
              <Th>Gestión</Th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-gray-400 text-sm">
                  <svg className="inline h-5 w-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Cargando...
                </td>
              </tr>
            ) : facturas.length === 0 ? (
              <EmptyState hayFiltros={hayFiltros} />
            ) : (
              facturas.map(f => {
                const datos    = f.datos_extraidos;
                const selected = seleccionados.has(f.id);
                const total    = datos?.total_factura;
                const negativo = total != null && total < 0;

                return (
                  <tr
                    key={f.id}
                    onClick={() => onToggle(f.id)}
                    className={`cursor-pointer transition-colors ${selected ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggle(f.id)}
                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate" title={f.proveedor}>
                      {f.proveedor || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700 font-mono text-xs">
                      {datos?.numero_factura || <span className="text-gray-400 italic">{f.nombre_archivo.slice(0, 20)}</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {fmtFecha(datos?.fecha_emision)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${negativo ? 'text-red-600' : 'text-gray-900'}`}>
                      {fmt€(total)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      {datos?.cif_emisor || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600 text-xs max-w-[120px] truncate" title={datos?.forma_pago}>
                      {datos?.forma_pago || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <BadgeExtraccion estado={f.estado} />
                    </td>
                    <td className="px-4 py-3">
                      <BadgeGestion estado={f.estado_gestion || 'PENDIENTE'} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
