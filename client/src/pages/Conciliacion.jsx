import { useState, useEffect } from 'react';
import ResultadoConciliacion from '../components/ResultadoConciliacion.jsx';
import ResultadoConciliacionV2 from '../components/ResultadoConciliacionV2.jsx';
import {
  parsearMayorV2,
  ejecutarConciliacionV2,
  fetchHistorialConciliaciones,
  fetchConciliacion,
} from '../api.js';

const FASES = {
  FORM: 'form',
  PARSEANDO: 'parseando',
  SELECCION: 'seleccion',
  EJECUTANDO: 'ejecutando',
  RESULTADO: 'resultado',
  ERROR: 'error',
};

function fmtFecha(iso) {
  if (!iso) return '\u2014';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtFechaHora(iso) {
  if (!iso) return '\u2014';
  return new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Historial ────────────────────────────────────────────────────────────────

function HistorialConciliaciones({ historial, cargandoHistorial, onVerResumen }) {
  if (cargandoHistorial) return <div className="mt-6 text-center text-sm text-gray-400 py-6">Cargando historial...</div>;
  if (!historial.length) {
    return <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm p-5 text-sm text-gray-400 text-center">No hay conciliaciones anteriores</div>;
  }

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Historial de conciliaciones</h3>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha / Hora','Proveedor(es)','OK','Incidencias','Ver.',''].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {historial.map(h => {
                const errores = (h.pendientes_sage || 0) + (h.error_importe || 0);
                return (
                  <tr key={h.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{fmtFechaHora(h.creado_en)}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800 max-w-[300px] truncate">{h.proveedor}</td>
                    <td className="px-4 py-2.5"><span className="text-emerald-700 font-semibold">{h.ok}</span></td>
                    <td className="px-4 py-2.5">
                      {errores > 0
                        ? <span className="text-red-600 font-semibold">{errores}</span>
                        : <span className="text-gray-400">\u2014</span>}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ring-inset ${
                        h.version === 'v2' ? 'bg-blue-50 text-blue-700 ring-blue-200' : 'bg-gray-50 text-gray-500 ring-gray-200'
                      }`}>{h.version || 'v1'}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button onClick={() => onVerResumen(h.id)} className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap">
                        Ver resumen &rarr;
                      </button>
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

// ─── Pantalla de selección de proveedores ────────────────────────────────────

function PantallaSeleccion({ datosParseo, onEjecutar, onVolver }) {
  const [alcance, setAlcance]       = useState('todo');
  const [seleccion, setSeleccion]   = useState(new Set());
  const [unicoSel, setUnicoSel]     = useState('');

  const provs = datosParseo.proveedores;

  function toggleSeleccion(codigo) {
    setSeleccion(prev => {
      const next = new Set(prev);
      next.has(codigo) ? next.delete(codigo) : next.add(codigo);
      return next;
    });
  }

  function handleEjecutar() {
    let seleccionados;
    if (alcance === 'todo') {
      seleccionados = provs;
    } else if (alcance === 'uno') {
      seleccionados = provs.filter(p => p.codigoCuenta === unicoSel);
    } else {
      seleccionados = provs.filter(p => seleccion.has(p.codigoCuenta));
    }
    if (!seleccionados.length) return;
    onEjecutar(seleccionados, alcance);
  }

  const numSeleccionados = alcance === 'todo' ? provs.length
    : alcance === 'uno' ? (unicoSel ? 1 : 0)
    : seleccion.size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Proveedores detectados en el Mayor</h2>
        <button onClick={onVolver} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg>
          Volver
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 space-y-4">
        <p className="text-sm text-gray-600">
          Se han detectado <span className="font-semibold text-gray-900">{provs.length}</span> proveedores
          con <span className="font-semibold text-gray-900">{datosParseo.totalLineas}</span> lineas en total.
        </p>

        {/* Alcance */}
        <div className="flex items-center gap-4 flex-wrap">
          <span className="text-sm font-medium text-gray-700">Alcance:</span>
          {[
            { id: 'todo',  label: 'Todo el fichero' },
            { id: 'uno',   label: 'Solo un proveedor' },
            { id: 'grupo', label: 'Grupo seleccionado' },
          ].map(opt => (
            <label key={opt.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="radio" name="alcance" value={opt.id} checked={alcance === opt.id}
                onChange={() => setAlcance(opt.id)}
                className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500" />
              {opt.label}
            </label>
          ))}
        </div>

        {/* Tabla de proveedores */}
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {alcance !== 'todo' && <th className="px-3 py-2 w-10" />}
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Cuenta Mayor</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Nombre en Mayor</th>
                <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Vinculado a</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Lineas</th>
                <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Facturas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {provs.map(p => {
                const checked = alcance === 'uno'
                  ? unicoSel === p.codigoCuenta
                  : seleccion.has(p.codigoCuenta);
                return (
                  <tr key={p.codigoCuenta} className={`hover:bg-gray-50 transition-colors ${alcance === 'todo' ? 'bg-emerald-50/30' : checked ? 'bg-blue-50/40' : ''}`}>
                    {alcance !== 'todo' && (
                      <td className="px-3 py-2">
                        {alcance === 'uno' ? (
                          <input type="radio" name="prov-unico" checked={checked}
                            onChange={() => setUnicoSel(p.codigoCuenta)}
                            className="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500" />
                        ) : (
                          <input type="checkbox" checked={checked}
                            onChange={() => toggleSeleccion(p.codigoCuenta)}
                            className="h-4 w-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500" />
                        )}
                      </td>
                    )}
                    <td className="px-4 py-2 font-mono text-xs font-medium text-gray-900">{p.codigoCuenta}</td>
                    <td className="px-4 py-2 text-gray-800">{p.nombreMayor || '\u2014'}</td>
                    <td className="px-4 py-2">
                      {p.proveedorId
                        ? <span className="text-emerald-700 font-medium">{p.razonSocial || p.nombreCarpeta}</span>
                        : <span className="text-amber-600 text-xs italic">No vinculado</span>}
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">{p.numLineas}</td>
                    <td className="px-4 py-2 text-right font-semibold text-gray-900">{p.numFacturas}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          onClick={handleEjecutar}
          disabled={numSeleccionados === 0}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Ejecutar conciliacion ({numSeleccionados} {numSeleccionados === 1 ? 'proveedor' : 'proveedores'})
        </button>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Conciliacion({ proveedores }) {
  const [fase, setFase]                           = useState(FASES.FORM);
  const [archivo, setArchivo]                     = useState(null);
  const [datosParseo, setDatosParseo]             = useState(null);
  const [resultado, setResultado]                 = useState(null);
  const [resultadoVersion, setResultadoVersion]   = useState(null);
  const [error, setError]                         = useState('');
  const [historial, setHistorial]                 = useState([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(true);

  useEffect(() => {
    fetchHistorialConciliaciones()
      .then(setHistorial)
      .catch(() => {})
      .finally(() => setCargandoHistorial(false));
  }, []);

  function refrescarHistorial() {
    fetchHistorialConciliaciones().then(setHistorial).catch(() => {});
  }

  // Paso 1: parsear archivo
  async function handleSubirArchivo(e) {
    e.preventDefault();
    if (!archivo) return;
    setFase(FASES.PARSEANDO);
    setError('');
    try {
      const fd = new FormData();
      fd.append('archivo', archivo);
      const data = await parsearMayorV2(fd);
      setDatosParseo(data);
      setFase(FASES.SELECCION);
    } catch (err) {
      setError(err.message);
      setFase(FASES.ERROR);
    }
  }

  // Paso 2: ejecutar matching
  async function handleEjecutar(proveedoresSeleccionados, alcance) {
    setFase(FASES.EJECUTANDO);
    setError('');
    try {
      const data = await ejecutarConciliacionV2(proveedoresSeleccionados, alcance);
      setResultado(data);
      setResultadoVersion('v2');
      setFase(FASES.RESULTADO);
      refrescarHistorial();
    } catch (err) {
      setError(err.message);
      setFase(FASES.ERROR);
    }
  }

  // Ver desde historial
  async function verDesdeHistorial(id) {
    try {
      const data = await fetchConciliacion(id);
      setResultado(data);
      // Detectar versión por estructura del JSON
      setResultadoVersion(data.resultadosPorProveedor ? 'v2' : 'v1');
      setFase(FASES.RESULTADO);
    } catch (err) {
      setError(err.message);
      setFase(FASES.ERROR);
    }
  }

  function resetear() {
    setFase(FASES.FORM);
    setResultado(null);
    setResultadoVersion(null);
    setDatosParseo(null);
    setArchivo(null);
    setError('');
  }

  // ─── CARGANDO (parseando o ejecutando) ─────────────────────────────────────
  if (fase === FASES.PARSEANDO || fase === FASES.EJECUTANDO) {
    const msg = fase === FASES.PARSEANDO
      ? 'Analizando el archivo del Mayor...'
      : 'Ejecutando conciliacion...';
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="relative w-16 h-16">
          <svg className="absolute inset-0 animate-spin text-blue-600" viewBox="0 0 64 64" fill="none">
            <circle className="opacity-20" cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6"/>
            <path className="opacity-80" stroke="currentColor" strokeWidth="6" strokeLinecap="round" d="M32 4a28 28 0 0 1 28 28"/>
          </svg>
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-gray-800">{msg}</p>
          <p className="text-sm text-gray-400 mt-1">
            {fase === FASES.PARSEANDO ? 'Detectando proveedores y lineas...' : 'Cruzando datos con la base de datos...'}
          </p>
        </div>
      </div>
    );
  }

  // ─── SELECCION ─────────────────────────────────────────────────────────────
  if (fase === FASES.SELECCION && datosParseo) {
    return (
      <PantallaSeleccion
        datosParseo={datosParseo}
        onEjecutar={handleEjecutar}
        onVolver={resetear}
      />
    );
  }

  // ─── RESULTADO ─────────────────────────────────────────────────────────────
  if (fase === FASES.RESULTADO && resultado) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Conciliacion de Mayor</h2>
          <button onClick={resetear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
            </svg>
            Nueva conciliacion
          </button>
        </div>
        {resultadoVersion === 'v2' ? (
          <ResultadoConciliacionV2
            resultadosPorProveedor={resultado.resultadosPorProveedor}
            resumenGlobal={resultado.resumenGlobal}
            conciliacionId={resultado.conciliacionId ?? null}
            lineaEstados={resultado.lineaEstados ?? {}}
            lineasHistorial={resultado.lineasHistorial ?? []}
            vinculosManuales={resultado.vinculosManuales ?? []}
          />
        ) : (
          <ResultadoConciliacion
            resumen={resultado.resumen}
            resultados={resultado.resultados}
            conciliacionId={resultado.conciliacionId ?? null}
            lineaEstados={resultado.lineaEstados ?? {}}
            lineasHistorial={resultado.lineasHistorial ?? []}
          />
        )}
      </div>
    );
  }

  // ─── FORMULARIO / ERROR ────────────────────────────────────────────────────
  return (
    <div className="space-y-0">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Conciliacion de Mayor</h2>

      <div className="max-w-xl space-y-4">
        {fase === FASES.ERROR && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <div>
              <p className="font-medium">Error</p>
              <p className="mt-0.5 text-red-600">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubirArchivo} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Archivo del Mayor <span className="text-red-500">*</span>
              <span className="ml-2 text-xs font-normal text-gray-400">Excel (.xlsx/.xls) o CSV</span>
            </label>
            <label className={`flex items-center gap-3 cursor-pointer rounded-lg border-2 border-dashed px-4 py-4 transition-colors ${
              archivo ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
            }`}>
              {archivo ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-blue-700">{archivo.name}</p>
                    <p className="text-xs text-blue-500">{(archivo.size / 1024).toFixed(1)} KB</p>
                  </div>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-700">Arrastra aqui o haz clic para seleccionar</p>
                    <p className="text-xs text-gray-400 mt-0.5">XLSX, XLS, CSV</p>
                  </div>
                </>
              )}
              <input type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e => setArchivo(e.target.files[0] || null)} />
            </label>
          </div>

          <button type="submit" disabled={!archivo}
            className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            Analizar archivo
          </button>
        </form>

        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 space-y-1">
          <p className="font-semibold">Como funciona la nueva conciliacion</p>
          <p>1. Sube el archivo del Mayor completo (Excel o CSV).</p>
          <p>2. El sistema detecta automaticamente los proveedores por cuenta contable.</p>
          <p>3. Elige conciliar todo el fichero, un grupo o un solo proveedor.</p>
          <p>4. Se cruzan las lineas del Mayor con las facturas en base de datos por Fecha + Importe + Referencia.</p>
        </div>
      </div>

      <HistorialConciliaciones
        historial={historial}
        cargandoHistorial={cargandoHistorial}
        onVerResumen={verDesdeHistorial}
      />
    </div>
  );
}
