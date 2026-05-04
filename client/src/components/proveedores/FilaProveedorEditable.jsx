import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { editarProveedor, asignarCuentasEmpresa, crearCuentaContable, eliminarCuentaContable } from '../../api.js';
import PanelConfigFiscal from './PanelConfigFiscal.jsx';

// ─── Celda IRPF % editable inline (decimal 0-100, deshabilitada si no aplica) ──

function CeldaNumeroIrpfPorcentaje({ valor, habilitada, onGuardar, className = '' }) {
  const [val, setVal] = useState(valor == null ? '' : String(valor));
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  useEffect(() => { setVal(valor == null ? '' : String(valor)); }, [valor]);

  async function guardar() {
    const raw = val.trim();
    if (raw === '') { setVal(valor == null ? '' : String(valor)); return; }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 100) { setVal(valor == null ? '' : String(valor)); return; }
    if (n === Number(valor)) return;
    setStatus('saving'); setErrorMsg('');
    try {
      await onGuardar(n);
      setStatus('ok');
      setTimeout(() => setStatus('idle'), 500);
    } catch (e) {
      setStatus('error'); setErrorMsg(e.message || 'Error al guardar');
      setVal(valor == null ? '' : String(valor));
    }
  }

  const bg =
    status === 'saving' ? 'bg-blue-50' :
    status === 'ok'     ? 'bg-emerald-50' :
    status === 'error'  ? 'bg-red-50' : '';

  if (!habilitada) {
    return (
      <td className={`px-2 py-1 ${className}`}>
        <span className="text-xs text-gray-300 select-none" title="Marca 'Aplica IRPF' en el modal del proveedor para activar.">—</span>
      </td>
    );
  }

  return (
    <td className={`px-2 py-1 ${className}`}>
      <input
        type="number" min="0" max="100" step="0.01"
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={guardar}
        onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setVal(valor == null ? '' : String(valor)); e.currentTarget.blur(); } }}
        title={errorMsg || undefined}
        className={`w-20 rounded border border-transparent px-2 py-1 text-xs text-center transition-colors
          hover:border-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-200
          ${bg}`} />
    </td>
  );
}

// ─── Celda subcuenta IRPF editable inline (dropdown de cuentas 4751xxx) ────────

function CeldaSubcuentaIrpf({ valor, habilitada, cuentas4751, onGuardar, className = '' }) {
  const [editando, setEditando] = useState(false);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!editando) return;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setEditando(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [editando]);

  async function elegir(codigo) {
    setEditando(false);
    if (codigo === valor) return;
    setStatus('saving'); setErrorMsg('');
    try {
      await onGuardar(codigo);
      setStatus('ok');
      setTimeout(() => setStatus('idle'), 500);
    } catch (e) {
      setStatus('error'); setErrorMsg(e.message || 'Error al guardar');
    }
  }

  if (!habilitada) {
    return (
      <td className={`px-3 py-2 ${className}`}>
        <span className="text-xs text-gray-300 select-none" title="Marca 'Aplica IRPF' en el modal del proveedor para activar.">—</span>
      </td>
    );
  }

  const bg =
    status === 'saving' ? 'bg-blue-50' :
    status === 'ok'     ? 'bg-emerald-50' :
    status === 'error'  ? 'bg-red-50' : '';

  if (!editando) {
    return (
      <td className={`px-3 py-2 cursor-pointer hover:bg-blue-50/50 ${bg} ${className}`}
          onClick={() => setEditando(true)}
          title={errorMsg || undefined}>
        {valor
          ? <span className="text-xs font-mono font-semibold text-gray-800">{valor}</span>
          : <span className="text-xs text-amber-600">— elegir —</span>}
      </td>
    );
  }

  return (
    <td className={`px-1 py-1 ${className}`}>
      <div ref={ref}>
        {cuentas4751.length === 0 ? (
          <span className="text-[10px] text-amber-600 px-1">Sin subcuentas 4751xxx en plan contable</span>
        ) : (
          <select
            autoFocus
            value={valor || ''}
            onChange={e => elegir(e.target.value)}
            onBlur={() => setEditando(false)}
            className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400">
            <option value="">— elegir —</option>
            {cuentas4751.map(c => (
              <option key={c.id} value={c.codigo}>{c.codigo} — {c.descripcion}</option>
            ))}
          </select>
        )}
      </div>
    </td>
  );
}

// ─── Celda de texto editable inline ─────────────────────────────────────────

export function CeldaTexto({ valor, onGuardar, placeholder, mono, className = '' }) {
  const [editando, setEditando] = useState(false);
  const [val, setVal] = useState(valor || '');
  const inputRef = useRef(null);

  useEffect(() => { if (editando && inputRef.current) inputRef.current.focus(); }, [editando]);

  function confirmar() {
    if (val.trim() === (valor || '').trim()) { setEditando(false); return; }
    onGuardar(val.trim());
    setEditando(false);
  }

  if (!editando) {
    return (
      <td className={`px-3 py-2 cursor-pointer hover:bg-blue-50/50 ${className}`} onClick={() => { setVal(valor || ''); setEditando(true); }}>
        {valor ? <span className={`text-xs ${mono ? 'font-mono font-semibold text-gray-800' : 'text-gray-700'}`}>{valor}</span>
               : <span className="text-xs text-gray-300">{placeholder || '—'}</span>}
      </td>
    );
  }

  return (
    <td className={`px-1 py-1 ${className}`}>
      <input ref={inputRef} value={val} onChange={e => setVal(e.target.value)}
        onBlur={confirmar} onKeyDown={e => { if (e.key === 'Enter') confirmar(); if (e.key === 'Escape') setEditando(false); }}
        className={`w-full rounded border border-blue-300 px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400 ${mono ? 'font-mono' : ''}`} />
    </td>
  );
}

// ─── Celda de cuenta con dropdown portal + subcuenta ────────────────────────

export function CeldaCuenta({ valor, valorDesc, cuentas, onGuardar, onCuentaCreada, grupo, razonSocial, className = '' }) {
  const [editando, setEditando] = useState(false);
  const [q, setQ] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [pendiente, setPendiente] = useState(null);
  const [cuentaBase, setCuentaBase] = useState(null);
  const [sufijo, setSufijo] = useState('');
  const [descGasto, setDescGasto] = useState('');
  const [creando, setCreando] = useState(false);
  const [errorSub, setErrorSub] = useState('');
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 300 });
  const ref = useRef(null);
  const inputRef = useRef(null);
  const ignorarCierreRef = useRef(false);

  // Variables derivadas de cuentaBase (para modo crear subcuenta)
  const esGasto = cuentaBase ? cuentaBase.grupo !== '4' : false;
  const codigoCompleto = cuentaBase ? cuentaBase.codigo + sufijo : '';
  const yaExiste = cuentaBase && sufijo.length === 5 ? cuentas.find(c => c.codigo === codigoCompleto) : null;
  const puedeCrear = cuentaBase && sufijo.length === 5 && (!esGasto || yaExiste || descGasto.trim());

  const filtradas = q.trim()
    ? cuentas.filter(c => c.codigo.startsWith(q) || c.descripcion.toLowerCase().includes(q.toLowerCase()))
    : cuentas.filter(c => grupo ? c.grupo === grupo || c.codigo.length > 3 : true).slice(0, 30);

  // Calcular posición del dropdown (portal)
  const calcPos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    const w = Math.min(Math.max(rect.width, 300), window.innerWidth - 16);
    const l = Math.min(rect.left, window.innerWidth - w - 8);
    const spaceBelow = window.innerHeight - rect.bottom;
    setDropPos(spaceBelow > 200
      ? { top: rect.bottom + 2, left: l, width: w }
      : { bottom: window.innerHeight - rect.top + 2, left: l, width: w }
    );
  }, []);

  useEffect(() => {
    if (!editando) return;
    calcPos();
    function onClick(e) {
      if (ignorarCierreRef.current) { ignorarCierreRef.current = false; return; }
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('[data-cuenta-portal]')) cerrar();
    }
    document.addEventListener('mousedown', onClick);
    window.addEventListener('scroll', calcPos, true);
    return () => { document.removeEventListener('mousedown', onClick); window.removeEventListener('scroll', calcPos, true); };
  }, [editando, calcPos]);

  function cerrar() {
    setEditando(false); setQ(''); setCuentaBase(null); setSufijo('');
    setDescGasto(''); setErrorSub(''); setPendiente(null);
  }

  function seleccionar(cuenta) {
    ignorarCierreRef.current = true;
    if (cuenta.codigo.length <= 3) {
      // Cuenta base: ofrecer crear subcuenta O asignar directamente
      setCuentaBase(cuenta); setSufijo(''); setErrorSub(''); setPendiente(null);
      return;
    }
    setPendiente({ id: cuenta.id, codigo: cuenta.codigo, descripcion: cuenta.descripcion });
    setCuentaBase(null); setQ('');
  }

  // Asignar cuenta base directamente (sin subcuenta) — guarda inmediatamente
  async function asignarCuentaBase() {
    if (!cuentaBase) return;
    setGuardando(true);
    try {
      await onGuardar(cuentaBase.id);
      cerrar();
    } catch {} finally { setGuardando(false); }
  }

  async function confirmarGuardado() {
    if (!pendiente) return;
    setGuardando(true);
    try {
      await onGuardar(pendiente.id);
      cerrar();
    } catch {} finally { setGuardando(false); }
  }

  async function eliminarSubcuenta() {
    if (!confirm('¿Eliminar esta subcuenta del plan contable? Se desvinculará de este proveedor.')) return;
    setGuardando(true);
    try {
      await eliminarCuentaContable(Number(valor ? cuentas.find(c => c.codigo === valor)?.id : pendiente?.id));
      await onGuardar(null); // Desvincular
      cerrar();
    } catch {} finally { setGuardando(false); }
  }

  async function desvincular() {
    setGuardando(true);
    try {
      await onGuardar(null);
    } catch {} finally { setGuardando(false); }
  }

  // ─── Vista: no editando ─────────────────────────────────────────────
  if (!editando) {
    return (
      <td className={`px-3 py-2 cursor-pointer hover:bg-blue-50/50 group ${className}`} onClick={() => setEditando(true)}>
        {valor ? (
          <span className="text-xs flex items-center gap-1">
            <span className="font-mono font-semibold text-gray-800">{valor}</span>
            <span className="text-gray-400 truncate">{valorDesc}</span>
            <button
              onClick={e => { e.stopPropagation(); desvincular(); }}
              title="Quitar cuenta"
              className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity ml-auto flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </span>
        ) : <span className="text-xs text-gray-300">—</span>}
      </td>
    );
  }

  // ─── Vista: editando ───────────────────────────────────────────────
  return (
    <td className={`px-1 py-1 ${className}`}>
      <div ref={ref}>
        {/* Modo: cuenta pendiente de confirmar */}
        {pendiente ? (
          <div className="flex items-center gap-1">
            <span className="font-mono text-xs font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded truncate">
              {pendiente.codigo}
            </span>
            <span className="text-xs text-gray-400 truncate flex-1">{pendiente.descripcion}</span>
            <button onMouseDown={e => { e.preventDefault(); confirmarGuardado(); }} disabled={guardando}
              title="Guardar" className="text-emerald-600 hover:text-emerald-700 font-bold text-sm px-1 disabled:opacity-50">✓</button>
            {/* Eliminar subcuenta (solo si tiene sufijo, código > 3 chars) */}
            {pendiente.codigo.length > 3 && (
              <button onMouseDown={e => { e.preventDefault(); eliminarSubcuenta(); }} disabled={guardando}
                title="Eliminar subcuenta" className="text-gray-400 hover:text-red-500 text-xs px-0.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            <button onMouseDown={e => { e.preventDefault(); cerrar(); }}
              title="Cancelar" className="text-gray-400 hover:text-red-500 text-sm px-1">✕</button>
          </div>
        ) : cuentaBase ? (
          /* Modo: crear subcuenta o asignar directamente */
          <div className="space-y-1.5">
            <div className="flex items-center gap-1">
              <button onMouseDown={e => { e.preventDefault(); setCuentaBase(null); setSufijo(''); setDescGasto(''); setErrorSub(''); }}
                className="text-gray-400 hover:text-gray-600 text-xs px-1">←</button>
              <span className="font-mono text-xs font-semibold text-gray-700 bg-gray-100 px-1.5 py-0.5 rounded">{cuentaBase.codigo}</span>
              <span className="text-gray-300 text-xs">+</span>
              <input type="text" inputMode="numeric" maxLength={5} value={sufijo}
                onChange={e => { setSufijo(e.target.value.replace(/\D/g, '')); setErrorSub(''); }}
                onKeyDown={e => { if (e.key === 'Enter' && puedeCrear) crearSubcuenta(); if (e.key === 'Escape') cerrar(); }}
                placeholder="00001" autoFocus
                className="w-16 rounded border border-blue-300 px-1.5 py-0.5 text-xs font-mono text-center focus:outline-none focus:ring-2 focus:ring-blue-400" />
              {sufijo.length === 5 && (
                <span className="font-mono text-[10px] font-bold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">{codigoCompleto}</span>
              )}
            </div>
            {/* Campo descripcion obligatorio para cuentas de gasto — visible siempre que esGasto */}
            {esGasto && (
              <div>
                <input
                  type="text"
                  value={descGasto}
                  onChange={e => { setDescGasto(e.target.value); setErrorSub(''); }}
                  onKeyDown={e => { if (e.key === 'Enter' && puedeCrear) crearSubcuenta(); if (e.key === 'Escape') cerrar(); }}
                  placeholder="Descripcion de la cuenta de gasto (obligatorio)"
                  className="w-full rounded border border-amber-400 bg-amber-50 px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {sufijo.length === 5 && !yaExiste && !descGasto.trim() && (
                  <p className="text-[10px] text-amber-600 mt-0.5">Debes introducir una descripcion para crear la cuenta</p>
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 flex-wrap">
              <button onMouseDown={e => { e.preventDefault(); crearSubcuenta(); }}
                disabled={!puedeCrear || creando}
                className="px-2 py-0.5 text-[10px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded disabled:opacity-40 transition-colors">
                {creando ? '...' : yaExiste ? 'Seleccionar' : 'Crear subcuenta'}
              </button>
              <button onMouseDown={e => { e.preventDefault(); asignarCuentaBase(); }}
                className="px-2 py-0.5 text-[10px] font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 rounded transition-colors">
                Usar {cuentaBase.codigo} directamente
              </button>
              {errorSub && <span className="text-[10px] text-red-500 truncate">{errorSub}</span>}
            </div>
          </div>
        ) : (
          /* Modo: buscar/seleccionar */
          <>
            <input ref={inputRef} value={q} onChange={e => { setQ(e.target.value); calcPos(); }} placeholder="Buscar o crear cuenta..."
              autoFocus onKeyDown={e => { if (e.key === 'Escape') cerrar(); }}
              className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-400" />
            {createPortal(
              <div data-cuenta-portal style={{
                position: 'fixed', left: dropPos.left, width: dropPos.width, zIndex: 9999,
                ...(dropPos.top != null ? { top: dropPos.top } : { bottom: dropPos.bottom }),
              }} className="bg-white border border-gray-200 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                {filtradas.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-gray-400">Sin resultados</p>
                ) : filtradas.map(c => (
                  <button key={c.id} type="button" onMouseDown={e => { e.preventDefault(); seleccionar(c); }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-blue-50 flex items-center gap-2">
                    <span className="font-mono font-semibold text-gray-900 min-w-[5rem] flex-shrink-0">{c.codigo}</span>
                    <span className="text-gray-500 truncate flex-1">{c.descripcion}</span>
                    {c.codigo.length <= 3 && (
                      <span className="text-[9px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium flex-shrink-0">+ sub</span>
                    )}
                  </button>
                ))}
              </div>,
              document.body
            )}
          </>
        )}
      </div>
    </td>
  );

  async function crearSubcuenta() {
    if (!cuentaBase || sufijo.length !== 5) return;
    const cod = cuentaBase.codigo + sufijo;
    const existe = cuentas.find(c => c.codigo === cod);

    if (existe) {
      setPendiente({ id: existe.id, codigo: existe.codigo, descripcion: existe.descripcion });
      setCuentaBase(null);
      return;
    }

    const esGastoLocal = cuentaBase.grupo !== '4';
    if (esGastoLocal && !descGasto.trim()) {
      setErrorSub('Introduce una descripcion para la cuenta de gasto');
      return;
    }

    setCreando(true); setErrorSub('');
    try {
      const nueva = await crearCuentaContable({
        codigo: cod,
        descripcion: esGastoLocal ? descGasto.trim() : (razonSocial || cod),
        grupo: cuentaBase.codigo.charAt(0),
      });
      if (onCuentaCreada) onCuentaCreada(nueva);
      setPendiente({ id: nueva.id, codigo: nueva.codigo, descripcion: nueva.descripcion });
      setCuentaBase(null);
    } catch (e) {
      setErrorSub(e.message);
    } finally {
      setCreando(false);
    }
  }
}

// ─── Fila completa de proveedor ─────────────────────────────────────────────

// onGuardado recibe un patch parcial: { id, ...camposActualizados }. El padre hace
// setProveedores(prev => prev.map(x => x.id === patch.id ? { ...x, ...patch } : x))
// sin refetchear la lista completa.
//
// Fila expandible: cuando expandida=true, renderizamos un <tr> adicional con el
// panel de gestion IRPF (PanelIrpfProveedor). Solo una fila puede estar expandida
// a la vez — el padre (Proveedores.jsx) controla el filaExpandidaId.
export default function FilaProveedorEditable({
  proveedor: p, planContable, empresaId, onGuardado, onEliminar, onCuentaCreada, soloLectura = false,
  expandida = false, onToggleExpandir,
  numColumnas,
}) {
  const [error, setError] = useState('');
  const rowRef = useRef(null);

  // Scroll automatico cuando se expande la fila para que el panel quede visible.
  // 'nearest' evita scroll si ya esta visible.
  useEffect(() => {
    if (expandida && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [expandida]);

  async function guardarCampo(campo, valor) {
    try {
      const actualizado = await editarProveedor(p.id, { [campo]: valor });
      onGuardado({ id: p.id, ...actualizado });
    } catch (e) { setError(e.message); throw e; }
  }

  // El backend (parseCamposIrpfBody en src/routes/proveedores.js) exige que
  // 'aplica_irpf' venga en el body para tocar cualquier campo IRPF; si no
  // viene, no se modifica ninguno. Por eso al editar inline una sola celda
  // enviamos el set IRPF entero, manteniendo aplica_irpf y los otros 3 campos
  // tal como estan en el proveedor + el override del campo modificado.
  async function guardarCampoIrpf(patch) {
    try {
      const datos = {
        aplica_irpf:     !!p.aplica_irpf,
        irpf_porcentaje: p.irpf_porcentaje,
        irpf_clave:      p.irpf_clave,
        irpf_subcuenta:  p.irpf_subcuenta,
        ...patch,
      };
      const actualizado = await editarProveedor(p.id, datos);
      onGuardado({ id: p.id, ...actualizado });
    } catch (e) { setError(e.message); throw e; }
  }

  async function guardarCuenta(tipo, cuentaId) {
    try {
      const ccId = tipo === 'contable' ? cuentaId : (p.cuenta_contable_id || null);
      const cgId = tipo === 'gasto'    ? cuentaId : (p.cuenta_gasto_id || null);
      await asignarCuentasEmpresa(p.id, empresaId, ccId, cgId);
      // asignarCuentasEmpresa no devuelve el proveedor; resolvemos cuenta desde planContable local.
      const cuenta = cuentaId ? planContable.find(c => c.id === cuentaId) : null;
      const patch = tipo === 'contable'
        ? { id: p.id, cuenta_contable_id: cuentaId, cuenta_contable_codigo: cuenta?.codigo || null, cuenta_contable_desc: cuenta?.descripcion || null }
        : { id: p.id, cuenta_gasto_id:    cuentaId, cuenta_gasto_codigo:    cuenta?.codigo || null, cuenta_gasto_desc:    cuenta?.descripcion || null };
      onGuardado(patch);
    } catch (e) { setError(e.message); }
  }

  const cuentas4 = planContable.filter(c => c.grupo === '4');
  const cuentasGasto = planContable.filter(c => c.grupo !== '4');
  // Subcuentas 4751xxx para el dropdown de Cta. IRPF inline. Mismos criterios
  // que ModalProveedor: prefijo + activas + codigo > 4 chars (sin la cuenta base).
  const cuentas4751 = planContable.filter(c =>
    c.codigo?.startsWith('4751') && c.codigo.length > 4 && c.activo !== false
  );

  return (
    <>
      <tr ref={rowRef} className={`hover:bg-gray-50 transition-colors ${error ? 'bg-red-50' : ''} ${expandida ? 'bg-blue-50/40' : ''}`}>
        <td className="px-2 py-2 w-8 text-center">
          <button
            onClick={onToggleExpandir}
            title={expandida ? 'Colapsar IRPF' : 'Expandir IRPF'}
            aria-label={expandida ? 'Colapsar fila' : 'Expandir fila'}
            className="text-gray-400 hover:text-blue-600 transition-colors"
          >
            <svg className={`h-4 w-4 transition-transform ${expandida ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </td>
        <CeldaTexto valor={p.razon_social} onGuardar={v => guardarCampo('razon_social', v)} placeholder="Razon social" className="font-medium" />
        <CeldaTexto valor={p.nombre_carpeta} onGuardar={v => guardarCampo('nombre_carpeta', v)} placeholder="Carpeta Drive" />
        <CeldaTexto valor={p.cif} onGuardar={v => guardarCampo('cif', v)} placeholder="CIF" mono />
        <CeldaCuenta valor={p.cuenta_contable_codigo} valorDesc={p.cuenta_contable_desc}
          cuentas={cuentas4} grupo="4" razonSocial={p.razon_social}
          onGuardar={id => guardarCuenta('contable', id)} onCuentaCreada={onCuentaCreada} />
        <CeldaCuenta valor={p.cuenta_gasto_codigo} valorDesc={p.cuenta_gasto_desc}
          cuentas={cuentasGasto} razonSocial={p.razon_social}
          onGuardar={id => guardarCuenta('gasto', id)} onCuentaCreada={onCuentaCreada} />
        <CeldaNumeroIrpfPorcentaje
          valor={p.aplica_irpf ? p.irpf_porcentaje : null}
          habilitada={!!p.aplica_irpf && !soloLectura}
          onGuardar={v => guardarCampoIrpf({ irpf_porcentaje: v })}
        />
        <CeldaSubcuentaIrpf
          valor={p.aplica_irpf ? p.irpf_subcuenta : null}
          habilitada={!!p.aplica_irpf && !soloLectura}
          cuentas4751={cuentas4751}
          onGuardar={v => guardarCampoIrpf({ irpf_subcuenta: v })}
        />
        <td className="px-2 py-2 text-center">
          {error && <span className="text-[10px] text-red-500 block mb-1">{error}</span>}
          <button onClick={onEliminar} title="Eliminar proveedor"
            className="text-gray-300 hover:text-red-500 transition-colors">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </td>
      </tr>
      {expandida && (
        <tr className="bg-gray-50">
          <td colSpan={numColumnas} className="p-0">
            <PanelConfigFiscal
              proveedor={p}
              planContable={planContable}
              onGuardado={onGuardado}
            />
          </td>
        </tr>
      )}
    </>
  );
}
