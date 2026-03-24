import { useState, useEffect, useRef } from 'react';
import { BadgeGestion, BadgeExtraccion } from './Badge.jsx';
import { fetchPreviewFactura } from '../api.js';

function fmtEuro(n, { showZero = false } = {}) {
  if (n == null || n === '') return '—';
  if (n === 0 && !showZero) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(n);
}

// Para IVA: siempre muestra el valor aunque sea 0,00 € (da confianza contable)
function fmtEuroIva(n) {
  if (n == null || n === '') return '—';
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

// ─── Combobox de cuentas ──────────────────────────────────────────────────────

function ComboboxCuenta({ cuentas, value, onChange, disabled }) {
  const [q,       setQ]       = useState('');
  const [abierto, setAbierto] = useState(false);
  const ref = useRef(null);

  const seleccionada = cuentas.find(c => String(c.id) === String(value));
  const filtradas = q.trim()
    ? cuentas.filter(c =>
        c.codigo.startsWith(q.trim()) ||
        c.descripcion.toLowerCase().includes(q.toLowerCase())
      )
    : cuentas;

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setAbierto(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const displayValue = seleccionada
    ? `${seleccionada.codigo} — ${seleccionada.descripcion}`
    : '';

  if (disabled) {
    return (
      <p className="text-sm text-gray-700">
        {displayValue || <span className="text-gray-400 italic">Sin cuenta asignada</span>}
      </p>
    );
  }

  return (
    <div ref={ref} className="relative">
      <input
        value={abierto ? q : displayValue}
        onChange={e => setQ(e.target.value)}
        onFocus={() => { setQ(''); setAbierto(true); }}
        placeholder="Sin CC asignada..."
        className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 pr-7"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onChange(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-base leading-none"
        >✕</button>
      )}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-44 overflow-y-auto">
          {filtradas.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
          ) : (
            filtradas.map(c => (
              <button
                key={c.id}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  onChange(String(c.id));
                  setQ('');
                  setAbierto(false);
                }}
                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-purple-50 flex items-center gap-2 ${String(c.id) === String(value) ? 'bg-purple-50' : ''}`}
              >
                <span className="font-mono font-semibold text-gray-900 w-12 flex-shrink-0">{c.codigo}</span>
                <span className="text-gray-500 text-xs truncate">{c.descripcion}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel de detalle (acordeón) ─────────────────────────────────────────────

const TIPOS_IVA = [0, 4, 10, 21];

function PanelDetalle({ f, planContable, onAsignarCC }) {
  const d   = f.datos_extraidos || {};
  const iva = Array.isArray(d.iva) ? d.iva : [];

  const ivaMap = {};
  for (const e of iva) ivaMap[e.tipo] = e;
  const tiposPresentes = TIPOS_IVA.filter(t => ivaMap[t]);

  // CC state
  const [ccId,      setCcId]      = useState(String(f.cc_efectiva_id || ''));
  const [guardando, setGuardando] = useState(false);
  const [ccError,   setCcError]   = useState('');
  const esContabilizada = f.estado_gestion === 'CONTABILIZADA';

  useEffect(() => {
    setCcId(String(f.cc_efectiva_id || ''));
  }, [f.cc_efectiva_id]);

  async function handleCcChange(newCcId) {
    const prev = ccId;
    setCcId(newCcId);
    setCcError('');
    setGuardando(true);
    try {
      await onAsignarCC(f.id, newCcId ? parseInt(newCcId, 10) : null);
    } catch (e) {
      setCcId(prev);
      setCcError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  // Document preview state
  const [previewUrl,     setPreviewUrl]     = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError,   setPreviewError]   = useState('');

  async function cargarPreview() {
    setPreviewLoading(true);
    setPreviewError('');
    try {
      const { url, type } = await fetchPreviewFactura(f.id);
      if (!type.includes('pdf')) {
        setPreviewError('Vista previa no disponible para este formato. Descarga el archivo para verlo.');
      } else {
        setPreviewUrl(url);
      }
    } catch (e) {
      setPreviewError('No se pudo cargar la vista previa: ' + e.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <tr>
      <td colSpan={100} className="px-0 pb-0 bg-blue-50/60 border-b border-blue-100">
        <div className="px-6 py-4 space-y-5">

          {/* ── Fila 1: Datos fiscales / IVA / Totales ── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Datos fiscales */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Datos fiscales</p>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Emisor</p>
                  <p className="text-sm font-medium text-gray-900">{d.nombre_emisor || '—'}</p>
                  <p className="text-xs font-mono text-gray-500">{d.cif_emisor || '—'}</p>
                </div>
                <div className="border-t border-blue-100 pt-3">
                  <p className="text-xs text-gray-400 mb-0.5">Receptor</p>
                  <p className="text-sm font-medium text-gray-900">{d.nombre_receptor || '—'}</p>
                  <p className="text-xs font-mono text-gray-500">{d.cif_receptor || '—'}</p>
                </div>
              </div>
            </div>

            {/* Desglose IVA */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Desglose IVA</p>
              {tiposPresentes.length === 0 ? (
                <p className="text-sm text-gray-400 italic">Sin desglose disponible</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-400">
                      <th className="text-left pb-1.5 font-medium">Tipo</th>
                      <th className="text-right pb-1.5 font-medium">Base</th>
                      <th className="text-right pb-1.5 font-medium">Cuota</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-blue-100">
                    {tiposPresentes.map(tipo => (
                      <tr key={tipo}>
                        <td className="py-1.5 font-medium text-gray-700">IVA {tipo}%</td>
                        <td className="py-1.5 text-right text-gray-700">{fmtEuroIva(ivaMap[tipo].base)}</td>
                        <td className="py-1.5 text-right text-gray-700">{fmtEuroIva(ivaMap[tipo].cuota)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Totales y pago */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Totales y pago</p>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Total base (sin IVA)</span>
                  <span className="text-sm font-bold text-gray-900">{fmtEuro(d.total_sin_iva)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-xs text-gray-500">Total IVA</span>
                  <span className="text-sm font-bold text-gray-900">{fmtEuro(d.total_iva)}</span>
                </div>
                <div className="flex justify-between border-t border-blue-100 pt-2 mt-1">
                  <span className="text-xs font-semibold text-gray-700">Total factura</span>
                  <span className={`text-sm font-bold ${d.total_factura < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                    {fmtEuro(d.total_factura)}
                  </span>
                </div>
                <div className="border-t border-blue-100 pt-2 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Forma de pago</span>
                    <span className="text-xs font-medium text-gray-700">{d.forma_pago || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-gray-500">Vencimiento</span>
                    <span className="text-xs font-medium text-gray-700">{fmtFecha(d.fecha_vencimiento)}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── Fila 2: Cuenta Contable + Vista Previa ── */}
          <div className="border-t border-blue-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Cuenta Contable */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Cuenta Contable
                {f.cc_efectiva_id && !f.cc_manual_id && (
                  <span className="ml-2 text-xs font-normal text-gray-400 normal-case">(por defecto del proveedor)</span>
                )}
              </p>
              <ComboboxCuenta
                cuentas={planContable}
                value={ccId}
                onChange={handleCcChange}
                disabled={esContabilizada}
              />
              {guardando && <p className="text-xs text-purple-500 mt-1">Guardando...</p>}
              {ccError && <p className="text-xs text-red-500 mt-1">{ccError}</p>}
              {!esContabilizada && (
                <p className="text-xs text-gray-400 mt-1">
                  {ccId
                    ? 'CC asignada — esta factura aparece en la sección "CC Asignada"'
                    : 'Asigna una cuenta contable para poder contabilizar esta factura'}
                </p>
              )}
            </div>

            {/* Vista previa del documento */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Vista previa</p>
              {!previewUrl && !previewError && (
                <button
                  onClick={cargarPreview}
                  disabled={previewLoading}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors disabled:opacity-50"
                >
                  {previewLoading ? (
                    <>
                      <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                      </svg>
                      Cargando...
                    </>
                  ) : (
                    <>
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                      </svg>
                      Ver documento
                    </>
                  )}
                </button>
              )}
              {previewError && (
                <p className="text-xs text-red-500">{previewError}</p>
              )}
              {previewUrl && (
                <div className="mt-2">
                  <iframe
                    src={previewUrl}
                    className="w-full rounded-lg border border-blue-200 shadow-sm"
                    style={{ height: '480px' }}
                    title={`Vista previa — ${f.nombre_archivo}`}
                  />
                  <button
                    onClick={() => setPreviewUrl(null)}
                    className="mt-1 text-xs text-gray-400 hover:text-gray-600"
                  >
                    Cerrar vista previa
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>
      </td>
    </tr>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ hayFiltros, colspan }) {
  return (
    <tr>
      <td colSpan={colspan} className="py-20 text-center">
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

// ─── Tabla principal ──────────────────────────────────────────────────────────

export default function TablaFacturas({
  facturas, seleccionados, onToggle, onToggleTodo,
  loading, hayFiltros, esAdmin = false, onRevertir,
  planContable = [], onAsignarCC,
}) {
  const [expandidos, setExpandidos] = useState(new Set());
  const todosSeleccionados = facturas.length > 0 && seleccionados.size === facturas.length;
  const algunoSeleccionado = seleccionados.size > 0 && !todosSeleccionados;
  const colspan = esAdmin ? 11 : 10;

  function toggleExpand(id, e) {
    e.stopPropagation();
    setExpandidos(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {/* Flecha expand */}
              <th className="px-3 py-3 w-8" />
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
              {esAdmin && <Th />}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={colspan} className="py-10 text-center text-gray-400 text-sm">
                  <svg className="inline h-5 w-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Cargando...
                </td>
              </tr>
            ) : facturas.length === 0 ? (
              <EmptyState hayFiltros={hayFiltros} colspan={colspan} />
            ) : (
              facturas.flatMap(f => {
                const datos       = f.datos_extraidos;
                const selected    = seleccionados.has(f.id);
                const expanded    = expandidos.has(f.id);
                const total       = datos?.total_factura;
                const negativo    = total != null && total < 0;
                const puedeRevertir = esAdmin && f.estado_gestion && f.estado_gestion !== 'PENDIENTE';

                const mainRow = (
                  <tr
                    key={`row-${f.id}`}
                    onClick={() => onToggle(f.id)}
                    className={`cursor-pointer transition-colors ${selected ? 'bg-blue-50 hover:bg-blue-100' : expanded ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                  >
                    {/* Botón expandir */}
                    <td className="px-3 py-3" onClick={e => toggleExpand(f.id, e)}>
                      <button className="text-gray-400 hover:text-gray-600 transition-colors p-0.5 rounded">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
                          viewBox="0 0 20 20" fill="currentColor"
                        >
                          <path fillRule="evenodd" d="M7.293 4.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L11.586 10 7.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    </td>
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
                      {fmtEuro(total)}
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
                    {esAdmin && (
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {puedeRevertir && (
                          <button
                            onClick={() => onRevertir(f.id)}
                            title="Revertir a PENDIENTE"
                            className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );

                return expanded
                  ? [mainRow, <PanelDetalle key={`detail-${f.id}`} f={f} planContable={planContable} onAsignarCC={onAsignarCC} />]
                  : [mainRow];
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
