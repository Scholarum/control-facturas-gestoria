import { useState, useEffect, useRef } from 'react';
import { editarProveedor, asignarCuentasEmpresa } from '../../api.js';

// ─── Celda de texto editable inline ─────────────────────────────────────────

export function CeldaTexto({ valor, onGuardar, placeholder, mono, className = '' }) {
  const [editando, setEditando] = useState(false);
  const [val, setVal] = useState(valor || '');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { setVal(valor || ''); }, [valor]);

  async function confirmar() {
    if (val.trim() === (valor || '').trim()) { setEditando(false); return; }
    setGuardando(true);
    try {
      await onGuardar(val.trim());
      setEditando(false);
    } catch {} finally { setGuardando(false); }
  }

  if (!editando) {
    return (
      <td className={`px-3 py-2 cursor-pointer hover:bg-blue-50/50 ${className}`} onClick={() => setEditando(true)}>
        <span className={`text-xs ${mono ? 'font-mono' : ''} ${valor ? 'text-gray-800' : 'text-gray-300'}`}>
          {valor || '—'}
        </span>
      </td>
    );
  }

  return (
    <td className={`px-1 py-1 ${className}`}>
      <input value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder}
        autoFocus onBlur={confirmar} onKeyDown={e => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') { setVal(valor || ''); setEditando(false); } }}
        disabled={guardando}
        className={`w-full rounded border border-blue-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 ${mono ? 'font-mono' : ''} ${guardando ? 'opacity-50' : ''}`} />
    </td>
  );
}

// ─── Celda de cuenta editable inline ────────────────────────────────────────

export function CeldaCuenta({ valor, valorDesc, cuentas, onGuardar, grupo, className = '' }) {
  const [editando, setEditando] = useState(false);
  const [q, setQ] = useState('');
  const [guardando, setGuardando] = useState(false);
  const ref = useRef(null);

  const filtradas = q.trim()
    ? cuentas.filter(c => c.codigo.startsWith(q) || c.descripcion.toLowerCase().includes(q.toLowerCase()))
    : cuentas.filter(c => grupo ? c.grupo === grupo || c.codigo.length > 4 : true).slice(0, 30);

  useEffect(() => {
    if (!editando) return;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setEditando(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [editando]);

  async function seleccionar(cuenta) {
    setGuardando(true);
    try {
      await onGuardar(cuenta.id);
      setEditando(false); setQ('');
    } catch {} finally { setGuardando(false); }
  }

  if (!editando) {
    return (
      <td className={`px-3 py-2 cursor-pointer hover:bg-blue-50/50 ${className}`} onClick={() => setEditando(true)}>
        {valor ? (
          <span className="text-xs"><span className="font-mono font-semibold text-gray-800">{valor}</span> <span className="text-gray-400">{valorDesc}</span></span>
        ) : <span className="text-xs text-gray-300">—</span>}
      </td>
    );
  }

  return (
    <td className={`px-1 py-1 relative ${className}`}>
      <div ref={ref}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar cuenta..."
          autoFocus className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
        <div className="absolute z-50 top-full left-0 w-64 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-xl max-h-40 overflow-y-auto">
          {filtradas.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
          ) : filtradas.map(c => (
            <button key={c.id} type="button" onMouseDown={e => { e.preventDefault(); seleccionar(c); }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2">
              <span className="font-mono font-semibold text-gray-900 min-w-[5rem]">{c.codigo}</span>
              <span className="text-gray-500 truncate">{c.descripcion}</span>
            </button>
          ))}
        </div>
      </div>
    </td>
  );
}

// ─── Fila completa de proveedor ─────────────────────────────────────────────

export default function FilaProveedorEditable({ proveedor: p, planContable, empresaId, onGuardado, onEliminar }) {
  const [error, setError] = useState('');
  const cuentas4 = planContable.filter(c => c.grupo === '4');
  const cuentasGasto = planContable.filter(c => c.grupo !== '4');

  async function guardarCampo(campo, valor) {
    setError('');
    try {
      await editarProveedor(p.id, { razon_social: p.razon_social, nombre_carpeta: p.nombre_carpeta, cif: p.cif, empresa_id: empresaId, [campo]: valor });
      await onGuardado();
    } catch (e) { setError(e.message); throw e; }
  }

  async function guardarCuenta(tipo, cuentaId) {
    setError('');
    try {
      await asignarCuentasEmpresa(p.id, empresaId, tipo === 'contable' ? cuentaId : null, tipo === 'gasto' ? cuentaId : null);
      await onGuardado();
    } catch (e) { setError(e.message); throw e; }
  }

  return (
    <tr className={`hover:bg-gray-50 transition-colors ${error ? 'bg-red-50/30' : ''}`} title={error || undefined}>
      <CeldaTexto valor={p.razon_social} placeholder="Razon social" onGuardar={v => guardarCampo('razon_social', v)} className="font-medium" />
      <CeldaTexto valor={p.nombre_carpeta} placeholder="Carpeta Drive" onGuardar={v => guardarCampo('nombre_carpeta', v || null)} mono />
      <CeldaTexto valor={p.cif} placeholder="CIF/VAT" onGuardar={v => guardarCampo('cif', v || null)} mono />
      <CeldaCuenta valor={p.cuenta_contable_codigo} valorDesc={p.cuenta_contable_desc} cuentas={cuentas4} grupo="4" onGuardar={id => guardarCuenta('contable', id)} />
      <CeldaCuenta valor={p.cuenta_gasto_codigo} valorDesc={p.cuenta_gasto_desc} cuentas={cuentasGasto} onGuardar={id => guardarCuenta('gasto', id)} />
      <td className="px-3 py-2 text-right">
        <button onClick={onEliminar} className="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">Eliminar</button>
      </td>
    </tr>
  );
}
