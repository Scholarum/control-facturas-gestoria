import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchCarpetasDrive, crearCarpetaDrive, subirFacturasUniversal } from '../../api.js';
import { Spinner } from './helpers.jsx';

export default function DriveManager() {
  const [carpetas,       setCarpetas]       = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState('');
  const [creando,        setCreando]        = useState(false);
  const [nombreNueva,    setNombreNueva]    = useState('');
  const [showCrear,      setShowCrear]      = useState(false);
  const [seleccionada,   setSeleccionada]   = useState(null);
  const [archivos,       setArchivos]       = useState([]);
  const [subiendo,       setSubiendo]       = useState(false);
  const [progreso,       setProgreso]       = useState(0);
  const [resultado,      setResultado]      = useState(null);
  const [dragOver,       setDragOver]       = useState(false);
  const inputRef = useRef(null);

  async function cargar() {
    setLoading(true); setError('');
    try { setCarpetas(await fetchCarpetasDrive()); }
    catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => { cargar(); }, []);

  async function handleCrear() {
    if (!nombreNueva.trim()) return;
    setCreando(true); setError('');
    try {
      const nueva = await crearCarpetaDrive(nombreNueva.trim());
      setCarpetas(prev => [...prev, nueva].sort((a, b) => a.name.localeCompare(b.name)));
      setNombreNueva(''); setShowCrear(false);
      setSeleccionada(nueva.id);
    } catch (e) { setError(e.message); }
    finally { setCreando(false); }
  }

  function agregarArchivos(files) {
    const nuevos = Array.from(files).filter(f =>
      f.type === 'application/pdf' || f.type.startsWith('image/')
    );
    if (nuevos.length === 0) { setError('Solo se permiten archivos PDF o imagenes'); return; }
    setArchivos(prev => [...prev, ...nuevos]);
    setResultado(null);
  }

  function quitarArchivo(idx) {
    setArchivos(prev => prev.filter((_, i) => i !== idx));
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    agregarArchivos(e.dataTransfer.files);
  }, []);

  async function handleSubir() {
    if (!seleccionada || archivos.length === 0) return;
    setSubiendo(true); setProgreso(0); setResultado(null); setError('');
    try {
      const res = await subirFacturasUniversal(seleccionada, archivos, setProgreso);
      setResultado(res);
      setArchivos([]);
    } catch (e) { setError(e.message); }
    finally { setSubiendo(false); }
  }

  const carpetaActiva = carpetas.find(c => c.id === seleccionada);

  return (
    <div className="space-y-5">
      {/* Cabecera */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Explorador de Drive</h3>
          <p className="text-xs text-gray-400 mt-0.5">Carpetas de proveedores en el repositorio central de Drive. Sube facturas y el sistema las clasifica automaticamente.</p>
        </div>
        <button onClick={() => setShowCrear(true)} disabled={showCrear}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50">
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/></svg>
          Nueva carpeta de proveedor
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-3">✕</button>
        </div>
      )}

      {/* Crear carpeta */}
      {showCrear && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-blue-700 mb-1">Nombre de la carpeta (= nombre del proveedor en Drive)</label>
            <input value={nombreNueva} onChange={e => setNombreNueva(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCrear()}
              placeholder="Ej: FACTOR LIBRE SL" autoFocus
              className="w-full rounded-lg border border-blue-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <button onClick={handleCrear} disabled={!nombreNueva.trim() || creando}
            className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
            {creando ? 'Creando...' : 'Crear'}
          </button>
          <button onClick={() => { setShowCrear(false); setNombreNueva(''); }}
            className="px-3 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancelar
          </button>
        </div>
      )}

      {/* Lista de carpetas + zona de subida */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Columna izquierda: carpetas */}
        <div className="lg:col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Carpetas ({carpetas.length})</span>
            <button onClick={cargar} disabled={loading} className="text-xs text-gray-400 hover:text-gray-600">
              {loading ? <Spinner className="h-3 w-3" /> : 'Actualizar'}
            </button>
          </div>
          <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-100">
            {loading && carpetas.length === 0 ? (
              <div className="flex justify-center py-8"><Spinner /></div>
            ) : carpetas.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">No hay carpetas</p>
            ) : carpetas.map(c => (
              <button key={c.id} onClick={() => { setSeleccionada(c.id); setResultado(null); }}
                className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                  seleccionada === c.id ? 'bg-blue-50 border-l-2 border-blue-500' : 'hover:bg-gray-50 border-l-2 border-transparent'
                }`}>
                <svg className={`h-4 w-4 flex-shrink-0 ${seleccionada === c.id ? 'text-blue-500' : 'text-amber-400'}`} fill="currentColor" viewBox="0 0 20 20">
                  <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/>
                </svg>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${seleccionada === c.id ? 'font-semibold text-blue-700' : 'text-gray-800'}`}>{c.name}</p>
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0">{c.archivos}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Columna derecha: zona de subida */}
        <div className="lg:col-span-2 space-y-4">
          {!seleccionada ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8 text-center">
              <svg className="h-10 w-10 text-gray-300 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
              </svg>
              <p className="text-sm text-gray-500">Selecciona una carpeta de proveedor para subir facturas</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <p className="text-sm font-semibold text-gray-800">
                  Subir a: <span className="text-blue-600">{carpetaActiva?.name}</span>
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Arrastra facturas (PDF o imagen) o haz clic para seleccionar. El sistema identificara automaticamente empresa y proveedor.
                </p>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
                  dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-300 hover:bg-gray-50'
                }`}
              >
                <svg className={`h-10 w-10 mx-auto mb-3 ${dragOver ? 'text-blue-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
                </svg>
                <p className="text-sm font-medium text-gray-700">Arrastra archivos aqui o haz clic para seleccionar</p>
                <p className="text-xs text-gray-400 mt-1">PDF o imagenes · Maximo 20 archivos</p>
                <input ref={inputRef} type="file" multiple accept=".pdf,image/*" className="hidden"
                  onChange={e => { agregarArchivos(e.target.files); e.target.value = ''; }} />
              </div>

              {/* Lista de archivos seleccionados */}
              {archivos.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-600">{archivos.length} archivo{archivos.length !== 1 ? 's' : ''} seleccionado{archivos.length !== 1 ? 's' : ''}</span>
                    <button onClick={() => setArchivos([])} className="text-xs text-red-500 hover:text-red-700">Limpiar</button>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-100">
                    {archivos.map((f, i) => (
                      <div key={i} className="px-4 py-2 flex items-center gap-3">
                        <svg className="h-4 w-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd"/>
                        </svg>
                        <span className="text-xs text-gray-700 flex-1 truncate">{f.name}</span>
                        <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                        <button onClick={() => quitarArchivo(i)} className="text-gray-300 hover:text-red-500 text-sm">✕</button>
                      </div>
                    ))}
                  </div>
                  <div className="px-4 py-3 border-t border-gray-100 flex items-center gap-3">
                    <button onClick={handleSubir} disabled={subiendo}
                      className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
                      {subiendo ? 'Subiendo...' : `Subir ${archivos.length} archivo${archivos.length !== 1 ? 's' : ''}`}
                    </button>
                    {subiendo && (
                      <div className="flex-1 flex items-center gap-3">
                        <div className="flex-1 bg-gray-200 rounded-full h-2">
                          <div className="bg-blue-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progreso}%` }} />
                        </div>
                        <span className="text-xs font-medium text-gray-600">{progreso}%</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Resultado */}
              {resultado && (
                <div className={`rounded-xl border p-4 ${resultado.subidos > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  <p className={`text-sm font-semibold ${resultado.subidos > 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                    {resultado.subidos > 0
                      ? `${resultado.subidos} factura${resultado.subidos !== 1 ? 's' : ''} subida${resultado.subidos !== 1 ? 's' : ''} correctamente`
                      : 'No se pudo subir ningun archivo'}
                  </p>
                  {resultado.mensaje && (
                    <p className="text-xs text-emerald-700 mt-1 flex items-center gap-1.5">
                      <svg className="h-3.5 w-3.5 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>
                      {resultado.mensaje}
                    </p>
                  )}
                  {resultado.errores > 0 && (
                    <div className="mt-2 space-y-1">
                      {resultado.archivos?.filter(a => !a.ok).map((a, i) => (
                        <p key={i} className="text-xs text-red-600">{a.nombre}: {a.error}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
