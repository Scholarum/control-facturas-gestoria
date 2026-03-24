import { useState, useEffect } from 'react';
import ResultadoConciliacion from '../components/ResultadoConciliacion.jsx';
import { ejecutarConciliacion, fetchHistorialConciliaciones, fetchConciliacion } from '../api.js';

const FASES = { FORM: 'form', CARGANDO: 'cargando', RESULTADO: 'resultado', ERROR: 'error' };

const MENSAJES_CARGA = [
  'Analizando el archivo SAGE con IA...',
  'Extrayendo entradas del mayor...',
  'Buscando facturas en Drive...',
  'Aplicando reglas de conciliación...',
  'Calculando diferencias...',
];

function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtFechaHora(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Historial ────────────────────────────────────────────────────────────────

function HistorialConciliaciones({ historial, cargandoHistorial, onVerResumen }) {
  if (cargandoHistorial) {
    return (
      <div className="mt-6 text-center text-sm text-gray-400 py-6">Cargando historial...</div>
    );
  }
  if (!historial.length) {
    return (
      <div className="mt-6 rounded-xl border border-gray-200 bg-white shadow-sm p-5 text-sm text-gray-400 text-center">
        No hay conciliaciones anteriores
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-700 mb-2">Historial de conciliaciones</h3>
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['Fecha / Hora','Proveedor','Desde','Hasta','OK','Incidencias',''].map(h => (
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
                    <td className="px-4 py-2.5 font-medium text-gray-800">{h.proveedor}</td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(h.fecha_desde)}</td>
                    <td className="px-4 py-2.5 text-gray-500 whitespace-nowrap">{fmtFecha(h.fecha_hasta)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                        {h.ok}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {errores > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-600 font-semibold">{errores}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => onVerResumen(h.id)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline whitespace-nowrap"
                      >
                        Ver resumen →
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

// ─── Página principal ─────────────────────────────────────────────────────────

export default function Conciliacion({ proveedores }) {
  const [proveedor,         setProveedor]         = useState('');
  const [fechaDesde,        setFechaDesde]        = useState('');
  const [fechaHasta,        setFechaHasta]        = useState('');
  const [archivo,           setArchivo]           = useState(null);
  const [fase,              setFase]              = useState(FASES.FORM);
  const [resultado,         setResultado]         = useState(null);
  const [error,             setError]             = useState('');
  const [msgIdx,            setMsgIdx]            = useState(0);
  const [historial,         setHistorial]         = useState([]);
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

  async function handleSubmit(e) {
    e.preventDefault();
    if (!proveedor || !archivo) return;

    setFase(FASES.CARGANDO);
    setError('');
    setMsgIdx(0);

    const intervalo = setInterval(() => {
      setMsgIdx(prev => (prev + 1) % MENSAJES_CARGA.length);
    }, 3500);

    try {
      const fd = new FormData();
      fd.append('proveedor',  proveedor);
      fd.append('fechaDesde', fechaDesde);
      fd.append('fechaHasta', fechaHasta);
      fd.append('archivo',    archivo);

      const data = await ejecutarConciliacion(fd);
      setResultado(data);
      setFase(FASES.RESULTADO);
      refrescarHistorial();
    } catch (err) {
      setError(err.message);
      setFase(FASES.ERROR);
    } finally {
      clearInterval(intervalo);
    }
  }

  async function verDesdeHistorial(id) {
    try {
      const data = await fetchConciliacion(id);
      setResultado(data);
      setFase(FASES.RESULTADO);
    } catch (err) {
      setError(err.message);
      setFase(FASES.ERROR);
    }
  }

  function resetear() {
    setFase(FASES.FORM);
    setResultado(null);
    setArchivo(null);
    setError('');
  }

  // ─── LOADING ───────────────────────────────────────────────────────────────
  if (fase === FASES.CARGANDO) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-6">
        <div className="relative w-16 h-16">
          <svg className="absolute inset-0 animate-spin text-blue-600" viewBox="0 0 64 64" fill="none">
            <circle className="opacity-20" cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="6"/>
            <path className="opacity-80" stroke="currentColor" strokeWidth="6" strokeLinecap="round"
              d="M32 4a28 28 0 0 1 28 28"/>
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-2xl">🧠</span>
        </div>
        <div className="text-center">
          <p className="text-base font-semibold text-gray-800">{MENSAJES_CARGA[msgIdx]}</p>
          <p className="text-sm text-gray-400 mt-1">Esto puede tardar hasta 30 segundos</p>
        </div>
      </div>
    );
  }

  // ─── RESULTADO ─────────────────────────────────────────────────────────────
  if (fase === FASES.RESULTADO && resultado) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Conciliación SAGE</h2>
          <button onClick={resetear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
            </svg>
            Nueva conciliación
          </button>
        </div>
        <ResultadoConciliacion resumen={resultado.resumen} resultados={resultado.resultados} />
      </div>
    );
  }

  // ─── FORMULARIO / ERROR ────────────────────────────────────────────────────
  return (
    <div className="max-w-xl">
      <h2 className="text-base font-semibold text-gray-900 mb-4">Conciliación SAGE</h2>

      {fase === FASES.ERROR && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          <div>
            <p className="font-medium">Error en la conciliación</p>
            <p className="mt-0.5 text-red-600">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">

        {/* Proveedor */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Proveedor <span className="text-red-500">*</span>
          </label>
          <select
            value={proveedor}
            onChange={e => setProveedor(e.target.value)}
            required
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">— Selecciona un proveedor —</option>
            {proveedores.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {/* Rango de fechas */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fecha desde</label>
            <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Fecha hasta</label>
            <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>

        {/* Archivo SAGE */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Mayor de SAGE <span className="text-red-500">*</span>
            <span className="ml-2 text-xs font-normal text-gray-400">PDF, Excel (.xlsx/.xls) o CSV</span>
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
                  <p className="text-xs text-blue-500">{(archivo.size / 1024).toFixed(1)} KB · Clic para cambiar</p>
                </div>
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-700">Arrastra aquí o haz clic para seleccionar</p>
                  <p className="text-xs text-gray-400 mt-0.5">PDF, XLSX, XLS, CSV — máx. 20 MB</p>
                </div>
              </>
            )}
            <input type="file" accept=".pdf,.csv,.xlsx,.xls" className="hidden"
              onChange={e => setArchivo(e.target.files[0] || null)} />
          </label>
        </div>

        <button
          type="submit"
          disabled={!proveedor || !archivo}
          className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Iniciar conciliación
        </button>
      </form>

      {/* Explicación */}
      <div className="mt-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">¿Cómo funciona?</p>
        <p>1. El sistema extrae automáticamente las entradas del Mayor SAGE usando IA.</p>
        <p>2. Busca las facturas de ese proveedor en Drive dentro del rango de fechas.</p>
        <p>3. Compara por número de factura (tolerante a prefijos y ceros), importe y fecha.</p>
        <p>4. Puedes descargar el resultado como PDF o Excel para enviarlo a la gestoría.</p>
      </div>

      {/* Historial */}
      <HistorialConciliaciones
        historial={historial}
        cargandoHistorial={cargandoHistorial}
        onVerResumen={verDesdeHistorial}
      />
    </div>
  );
}
