import { useState, useEffect } from 'react';
import { editarProveedor } from '../../api.js';
import {
  SII_CLAVE, SII_TIPO_FACT, SII_TIPO_EXENCI, SII_TIPO_NO_SUJE, SII_TIPO_RECTIF, SII_ENTR_PREST,
  IRPF_CLAVES, TOOLTIP_IRPF_PORCENTAJE, tooltipSii,
} from '../../constants/sii.js';

// Panel de configuracion fiscal del proveedor (SII + IRPF). Vive como segundo
// <tr> de la tabla cuando la fila esta expandida (ver FilaProveedorEditable +
// Proveedores.jsx). Es el unico sitio donde se gestiona la configuracion SII
// y IRPF — antes los 6 SII estaban inline en la tabla, pero ocupaban demasiadas
// columnas y se editan rara vez (configuracion estatica, default 1/1/1/1/2/1).
//
// Concurrencia: el handler guardar() envia SII + IRPF en el mismo PUT. Razon:
// parseCamposIrpfBody (backend) exige aplica_irpf en el body para tocar IRPF, y
// si aplica_irpf=true exige los 3 restantes informados. Last-write-wins entre
// pestañas — riesgo aceptado, ver CLAUDE.md.
//
// Sincronizacion con la tabla: tras guardar, onGuardado actualiza el proveedor
// en el padre y React re-renderiza la fila → las celdas inline IRPF % y Cta. IRPF
// ven aplica_irpf actualizado y se habilitan/deshabilitan automaticamente.
export default function PanelConfigFiscal({ proveedor: p, planContable, onGuardado, precargaIrpf = null }) {
  // ─── Estado SII ────────────────────────────────────────────────────────────
  const [siiClave,    setSiiClave]    = useState(p.sii_tipo_clave   ?? 1);
  const [siiFact,     setSiiFact]     = useState(p.sii_tipo_fact    ?? 1);
  const [siiExenci,   setSiiExenci]   = useState(p.sii_tipo_exenci  ?? 1);
  const [siiNoSuje,   setSiiNoSuje]   = useState(p.sii_tipo_no_suje ?? 1);
  const [siiRectif,   setSiiRectif]   = useState(p.sii_tipo_rectif  ?? 2);
  const [siiEntrPrest, setSiiEntrPrest] = useState(p.sii_entr_prest ?? 1);

  // ─── Estado IRPF ───────────────────────────────────────────────────────────
  // Si hay precarga (llegada desde el panel fiscal de una factura via App.jsx),
  // los useState iniciales la usan en vez de los valores actuales del proveedor.
  // Asi al expandir la fila por primera vez, el panel arranca con los valores
  // sugeridos. La subcuenta NUNCA se precarga (el usuario debe elegir).
  const initAplica = precargaIrpf?.aplica_irpf ?? !!p.aplica_irpf;
  const initPct    = precargaIrpf?.irpf_porcentaje != null && precargaIrpf.irpf_porcentaje !== ''
    ? String(precargaIrpf.irpf_porcentaje)
    : (p.irpf_porcentaje == null ? '' : String(p.irpf_porcentaje));
  const initClave  = precargaIrpf?.irpf_clave != null && precargaIrpf.irpf_clave !== ''
    ? precargaIrpf.irpf_clave
    : (p.irpf_clave == null ? '' : p.irpf_clave);
  const [aplica, setAplica] = useState(initAplica);
  const [pct,    setPct]    = useState(initPct);
  const [clave,  setClave]  = useState(initClave);
  const [sub,    setSub]    = useState(p.irpf_subcuenta || '');

  // Si la precarga llega DESPUES de montar (caso raro: la fila ya estaba
  // expandida cuando se navega), aplicamos los valores via useEffect.
  useEffect(() => {
    if (!precargaIrpf) return;
    if (precargaIrpf.aplica_irpf != null)     setAplica(!!precargaIrpf.aplica_irpf);
    if (precargaIrpf.irpf_porcentaje != null && precargaIrpf.irpf_porcentaje !== '') {
      setPct(String(precargaIrpf.irpf_porcentaje));
    }
    if (precargaIrpf.irpf_clave != null && precargaIrpf.irpf_clave !== '') {
      setClave(precargaIrpf.irpf_clave);
    }
  }, [precargaIrpf]);

  const [guardando, setGuardando] = useState(false);
  const [error,     setError]     = useState('');
  const [exito,     setExito]     = useState('');

  // Subcuentas 4751xxx (HP retenciones practicadas) para el dropdown IRPF.
  const cuentas4751 = planContable.filter(c =>
    c.codigo?.startsWith('4751') && c.codigo.length > 4 && c.activo !== false
  );

  const irpfIncompleto = aplica && (
    pct === '' || pct == null ||
    clave === '' || clave == null ||
    !sub
  );
  const sinSubcuentas = aplica && cuentas4751.length === 0;

  async function guardar() {
    setGuardando(true); setError(''); setExito('');
    try {
      const datos = {
        // SII (6 campos siempre presentes — backend valida entero >= 0)
        sii_tipo_clave:    siiClave,
        sii_tipo_fact:     siiFact,
        sii_tipo_exenci:   siiExenci,
        sii_tipo_no_suje:  siiNoSuje,
        sii_tipo_rectif:   siiRectif,
        sii_entr_prest:    siiEntrPrest,
        // IRPF (4 campos: si aplica=false el backend pone los 3 restantes a NULL)
        aplica_irpf:       aplica,
        irpf_porcentaje:   aplica ? Number(pct)   : null,
        irpf_clave:        aplica ? Number(clave) : null,
        irpf_subcuenta:    aplica ? sub           : null,
      };
      const actualizado = await editarProveedor(p.id, datos);
      onGuardado({ id: p.id, ...actualizado });
      setExito('Cambios guardados');
      setTimeout(() => setExito(''), 2000);
    } catch (e) {
      setError(e.message || 'Error al guardar');
    } finally {
      setGuardando(false);
    }
  }

  function onToggleAplica(checked) {
    setAplica(checked);
    setError(''); setExito('');
    if (!checked) {
      setPct(''); setClave(''); setSub('');
    }
  }

  // Helper para los 6 inputs SII — parseo coherente del valor a entero.
  const setSiiNum = (setter) => (e) => {
    const v = e.target.value;
    setter(v === '' ? '' : parseInt(v, 10));
    setError(''); setExito('');
  };

  return (
    <div className="bg-gray-50 px-6 py-5 border-l-4 border-blue-300 space-y-5">
      {/* ─── Bloque SII ──────────────────────────────────────────────────── */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Datos SII / Libro de IVA</p>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_CLAVE)}>Clave régimen</label>
            <input type="number" min="0" step="1" value={siiClave ?? ''}
              onChange={setSiiNum(setSiiClave)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_FACT)}>Tipo factura</label>
            <input type="number" min="0" step="1" value={siiFact ?? ''}
              onChange={setSiiNum(setSiiFact)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_EXENCI)}>Tipo exención</label>
            <input type="number" min="0" step="1" value={siiExenci ?? ''}
              onChange={setSiiNum(setSiiExenci)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_NO_SUJE)}>Tipo no sujeta</label>
            <input type="number" min="0" step="1" value={siiNoSuje ?? ''}
              onChange={setSiiNum(setSiiNoSuje)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_TIPO_RECTIF)}>Tipo rectificativa</label>
            <input type="number" min="0" step="1" value={siiRectif ?? ''}
              onChange={setSiiNum(setSiiRectif)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(SII_ENTR_PREST)}>Entrega/Prestación</label>
            <input type="number" min="0" step="1" value={siiEntrPrest ?? ''}
              onChange={setSiiNum(setSiiEntrPrest)}
              className="w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          Defaults estándar 1/1/1/1/2/1. Pasa el ratón sobre cada etiqueta para ver los valores válidos.
        </p>
      </div>

      {/* ─── Bloque IRPF ─────────────────────────────────────────────────── */}
      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Retención IRPF</p>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={aplica}
              onChange={e => onToggleAplica(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Aplica retención IRPF
          </label>
        </div>

        {aplica && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={TOOLTIP_IRPF_PORCENTAJE}>
                Porcentaje IRPF <span className="text-red-500">*</span>
              </label>
              <input type="number" min="0" max="100" step="0.01"
                value={pct}
                onChange={e => { setPct(e.target.value); setError(''); setExito(''); }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="15.00" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 cursor-help" title={tooltipSii(IRPF_CLAVES)}>
                Clave IRPF <span className="text-red-500">*</span>
              </label>
              <input type="number" min="1" max="11" step="1"
                value={clave === '' || clave == null ? '' : clave}
                onChange={e => { setClave(e.target.value === '' ? '' : parseInt(e.target.value, 10)); setError(''); setExito(''); }}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="1" />
            </div>
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Subcuenta retención <span className="text-red-500">*</span>
              </label>
              {cuentas4751.length === 0 ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  No hay subcuentas <span className="font-mono">4751xxx</span> en el plan contable de esta empresa. Crea al menos una en la pestaña Plan Contable o vía importación Excel antes de marcar este proveedor con IRPF.
                </div>
              ) : (
                <select
                  value={sub}
                  onChange={e => { setSub(e.target.value); setError(''); setExito(''); }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— selecciona una subcuenta 4751 —</option>
                  {cuentas4751.map(c => (
                    <option key={c.id} value={c.codigo}>{c.codigo} — {c.descripcion}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── Botón único de guardado ─────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4">
        {error && <span className="text-xs text-red-600">{error}</span>}
        {exito && <span className="text-xs text-emerald-600">{exito}</span>}
        <button
          onClick={guardar}
          disabled={guardando || irpfIncompleto || sinSubcuentas}
          title={
            sinSubcuentas  ? 'Crea una subcuenta 4751xxx primero' :
            irpfIncompleto ? 'Completa los 3 campos IRPF o desmarca el checkbox' : undefined
          }
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {guardando ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </div>
    </div>
  );
}
