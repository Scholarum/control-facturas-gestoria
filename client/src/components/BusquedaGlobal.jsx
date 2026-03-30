import { useState, useRef, useEffect, useCallback } from 'react';
import { getStoredToken } from '../api.js';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export default function BusquedaGlobal({ empresaId, onSelectFactura, onSelectProveedor }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const debounceRef = useRef(null);

  // Cerrar al clicar fuera
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback(async (text) => {
    if (text.length < 2) { setResults(null); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: text });
      if (empresaId) params.set('empresa_id', empresaId);
      const res = await fetch(`${API_BASE}/api/busqueda?${params}`, {
        headers: { 'Authorization': `Bearer ${getStoredToken()}` },
      });
      const json = await res.json();
      if (json.ok) { setResults(json.data); setOpen(true); }
    } catch { /* silenciar */ }
    setLoading(false);
  }, [empresaId]);

  function handleChange(e) {
    const val = e.target.value;
    setQ(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(val.trim()), 300);
  }

  function selectFactura(f) {
    setOpen(false); setQ('');
    onSelectFactura?.(f);
  }

  function selectProveedor(p) {
    setOpen(false); setQ('');
    onSelectProveedor?.(p);
  }

  const hasResults = results && (results.facturas.length > 0 || results.proveedores.length > 0);
  const noResults = results && results.facturas.length === 0 && results.proveedores.length === 0;

  return (
    <div ref={ref} className="relative w-48 sm:w-56 lg:w-72 flex-shrink-0 hidden sm:block">
      <div className="relative">
        <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={q}
          onChange={handleChange}
          onFocus={() => results && setOpen(true)}
          placeholder="Buscar facturas, proveedores..."
          className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-600 text-sm bg-slate-700 text-white placeholder-slate-400 focus:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
        />
        {loading && (
          <svg className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
          </svg>
        )}
      </div>

      {/* Dropdown resultados */}
      {open && (hasResults || noResults) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-50 max-h-80 overflow-y-auto">
          {noResults && (
            <p className="px-4 py-3 text-sm text-gray-400 text-center">Sin resultados para "{q}"</p>
          )}

          {results.facturas.length > 0 && (
            <>
              <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                Facturas ({results.facturas.length})
              </p>
              {results.facturas.map(f => (
                <button
                  key={f.id}
                  onClick={() => selectFactura(f)}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 flex items-center gap-3"
                >
                  <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {f.numero_factura || f.nombre_archivo}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {f.proveedor_nombre || f.proveedor || 'Sin proveedor'}{f.total_factura ? ` — ${Number(f.total_factura).toFixed(2)}€` : ''}
                    </p>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                    f.estado_gestion === 'CONTABILIZADA' ? 'bg-emerald-100 text-emerald-700' :
                    f.estado_gestion === 'DESCARGADA' ? 'bg-blue-100 text-blue-700' :
                    'bg-amber-100 text-amber-700'
                  }`}>
                    {f.estado_gestion || 'PENDIENTE'}
                  </span>
                </button>
              ))}
            </>
          )}

          {results.proveedores.length > 0 && (
            <>
              <p className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase bg-gray-50 border-b border-gray-100">
                Proveedores ({results.proveedores.length})
              </p>
              {results.proveedores.map(p => (
                <button
                  key={p.id}
                  onClick={() => selectProveedor(p)}
                  className="w-full text-left px-4 py-2.5 hover:bg-blue-50 transition-colors border-b border-gray-50 flex items-center gap-3"
                >
                  <svg className="h-4 w-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.razon_social}</p>
                    <p className="text-xs text-gray-500">{p.cif || p.nombre_carpeta}</p>
                  </div>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
