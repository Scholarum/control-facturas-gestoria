import { useState, useEffect, useRef } from 'react';

export default function ComboboxCuenta({ cuentas, value, onChange, placeholder }) {
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

  function handleFocus() { setQ(''); setAbierto(true); }

  function handleSelect(cuenta) {
    onChange(String(cuenta.id));
    setQ('');
    setAbierto(false);
  }

  const displayValue = seleccionada
    ? `${seleccionada.codigo} — ${seleccionada.descripcion}`
    : '';

  return (
    <div ref={ref} className="relative">
      <input
        value={abierto ? q : displayValue}
        onChange={e => setQ(e.target.value)}
        onFocus={handleFocus}
        placeholder={placeholder || '— Sin asignar —'}
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 pr-7"
        autoComplete="off"
      />
      {value && (
        <button
          type="button"
          onMouseDown={e => { e.preventDefault(); onChange(''); setQ(''); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500 text-base leading-none"
        >✕</button>
      )}
      {abierto && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtradas.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
          ) : filtradas.map(c => (
            <button
              key={c.id}
              type="button"
              onMouseDown={e => { e.preventDefault(); handleSelect(c); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 flex items-center gap-2 ${String(c.id) === String(value) ? 'bg-blue-50' : ''}`}
            >
              <span className="font-mono font-semibold text-gray-900 min-w-[6rem] flex-shrink-0">{c.codigo}</span>
              <span className="text-gray-500 text-xs truncate">{c.descripcion}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
