import { useState, useEffect, useRef } from 'react';
import { editarProveedor, asignarCuentasEmpresa, crearCuentaContable } from '../../api.js';

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

// ─── Celda de cuenta editable inline (con creacion de subcuentas) ───────────

export function CeldaCuenta({ valor, valorDesc, cuentas, onGuardar, onCuentaCreada, grupo, razonSocial, className = '' }) {
  const [editando, setEditando] = useState(false);
  const [q, setQ] = useState('');
  const [guardando, setGuardando] = useState(false);
  // Estado para crear subcuenta
  const [cuentaBase, setCuentaBase] = useState(null);
  const [sufijo, setSufijo] = useState('');
  const [creando, setCreando] = useState(false);
  const [errorSub, setErrorSub] = useState('');
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

  function cerrar() {
    setEditando(false); setQ(''); setCuentaBase(null); setSufijo(''); setErrorSub('');
  }

  async function seleccionar(cuenta) {
    // Si es cuenta base (<=4 digitos), ofrecer crear subcuenta
    if (cuenta.codigo.length <= 4) {
      setCuentaBase(cuenta);
      setSufijo(''); setErrorSub('');
      return;
    }
    // Si es subcuenta, asignar directamente
    setGuardando(true);
    try {
      await onGuardar(cuenta.id);
      cerrar();
    } catch {} finally { setGuardando(false); }
  }

  async function crearSubcuenta() {
    if (!cuentaBase || sufijo.length !== 5) return;
    const codigoCompleto = cuentaBase.codigo + sufijo;
    const yaExiste = cuentas.find(c => c.codigo === codigoCompleto);

    if (yaExiste) {
      // Ya existe, asignar directamente
      setGuardando(true);
      try {
        await onGuardar(yaExiste.id);
        cerrar();
      } catch {} finally { setGuardando(false); }
      return;
    }

    setCreando(true); setErrorSub('');
    try {
      const nueva = await crearCuentaContable({
        codigo:      codigoCompleto,
        descripcion: razonSocial || codigoCompleto,
        grupo:       cuentaBase.codigo.charAt(0),
      });
      if (onCuentaCreada) onCuentaCreada(nueva);
      setGuardando(true);
      try {
        await onGuardar(nueva.id);
        cerrar();
      } catch {} finally { setGuardando(false); }
    } catch (e) {
      setErrorSub(e.message);
    } finally {
      setCreando(false);
    }
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
        {/* Modo crear subcuenta */}
        {cuentaBase ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <button onMouseDown={e => { e.preventDefault(); setCuentaBase(null); setSufijo(''); setErrorSub(''); }}
                className="text-gray-400 hover:text-gray-600 text-xs px-1">←</button>
              <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">{cuentaBase.codigo}</span>
              <span className="text-gray-300 text-xs">+</span>
              <input type="text" inputMode="numeric" maxLength={5} value={sufijo}
                onChange={e => { setSufijo(e.target.value.replace(/\D/g, '')); setErrorSub(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && sufijo.length === 5) crearSubcuenta(); if (e.key === 'Escape') cerrar(); }}
                placeholder="00001" autoFocus
                className="w-16 rounded border border-blue-300 px-1.5 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-400" />
              {sufijo.length === 5 && (
                <span className="font-mono text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{cuentaBase.codigo + sufijo}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button onMouseDown={e => { e.preventDefault(); crearSubcuenta(); }}
                disabled={sufijo.length !== 5 || creando || guardando}
                className="px-2 py-0.5 text-[10px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded disabled:opacity-40 transition-colors">
                {creando ? '...' : cuentas.find(c => c.codigo === cuentaBase.codigo + sufijo) ? 'Asignar' : 'Crear y asignar'}
              </button>
              {errorSub && <span className="text-[10px] text-red-500 truncate">{errorSub}</span>}
            </div>
          </div>
        ) : (
          <>
            {/* Modo buscar/seleccionar */}
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar o crear cuenta..."
              autoFocus onKeyDown={e => { if (e.key === 'Escape') cerrar(); }}
              className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            <div className="absolute z-50 top-full left-0 w-72 mt-0.5 bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
              {filtradas.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
              ) : filtradas.map(c => (
                <button key={c.id} type="button" onMouseDown={e => { e.preventDefault(); seleccionar(c); }}
                  className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2">
                  <span className="font-mono font-semibold text-gray-900 min-w-[5rem]">{c.codigo}</span>
                  <span className="text-gray-500 truncate flex-1">{c.descripcion}</span>
                  {c.codigo.length <= 4 && (
                    <span className="text-[9px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">+ sub</span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </td>
  );
}

// ─── Fila completa de proveedor ─────────────────────────────────────────────

export default function FilaProveedorEditable({ proveedor: p, planContable, empresaId, onGuardado, onEliminar, onCuentaCreada }) {
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
      <CeldaCuenta valor={p.cuenta_contable_codigo} valorDesc={p.cuenta_contable_desc} cuentas={cuentas4} grupo="4"
        razonSocial={p.razon_social} onGuardar={id => guardarCuenta('contable', id)} onCuentaCreada={onCuentaCreada} />
      <CeldaCuenta valor={p.cuenta_gasto_codigo} valorDesc={p.cuenta_gasto_desc} cuentas={cuentasGasto}
        razonSocial={p.razon_social} onGuardar={id => guardarCuenta('gasto', id)} onCuentaCreada={onCuentaCreada} />
      <td className="px-3 py-2 text-right">
        <button onClick={onEliminar} className="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">Eliminar</button>
      </td>
    </tr>
  );
}
