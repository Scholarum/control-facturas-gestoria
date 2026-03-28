import { useState, useRef } from 'react';
import { descargarPlantillaProveedores } from '../../api.js';

export default function ModalImportar({ onImportar, onCerrar, importando }) {
  const [archivo,    setArchivo]    = useState(null);
  const [resultado,  setResultado]  = useState(null);
  const [errorLocal, setErrorLocal] = useState('');
  const inputRef = useRef(null);

  async function handleImportar() {
    if (!archivo) return;
    setErrorLocal('');
    try {
      const res = await onImportar(archivo);
      setResultado(res);
    } catch (e) {
      setErrorLocal(e.message);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Importar proveedores desde Excel</h3>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {!resultado ? (
            <>
              <div className="text-sm text-gray-600 space-y-1.5">
                <p>
                  Columnas obligatorias: <span className="font-semibold">Razon Social</span>, <span className="font-semibold">CIF</span>, <span className="font-semibold">Cuenta Contable</span>
                </p>
                <p className="text-xs text-gray-400">
                  Opcionales: Nombre Carpeta, Cuenta Gasto
                </p>
                <p className="text-xs text-gray-400">
                  Las cuentas contables que no existan se crean automaticamente.
                </p>
                <button type="button" onClick={() => descargarPlantillaProveedores().catch(() => {})}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  Descargar plantilla de ejemplo
                </button>
              </div>
              <label className={`flex items-center gap-3 cursor-pointer rounded-lg border-2 border-dashed px-4 py-4 transition-colors ${
                archivo ? 'border-blue-300 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              }`}>
                {archivo ? (
                  <>
                    <svg className="h-8 w-8 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-blue-700">{archivo.name}</p>
                      <p className="text-xs text-blue-500">{(archivo.size / 1024).toFixed(1)} KB · Clic para cambiar</p>
                    </div>
                  </>
                ) : (
                  <>
                    <svg className="h-8 w-8 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/>
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-gray-700">Arrastra o haz clic para seleccionar</p>
                      <p className="text-xs text-gray-400 mt-0.5">Excel (.xlsx, .xls)</p>
                    </div>
                  </>
                )}
                <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
                  onChange={e => setArchivo(e.target.files[0] || null)} />
              </label>
              {errorLocal && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">{errorLocal}</div>
              )}
              <div className="flex justify-end gap-3">
                <button onClick={onCerrar}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={handleImportar} disabled={!archivo || importando}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors">
                  {importando ? 'Importando...' : 'Importar'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-4 py-3 space-y-1">
                <p className="text-sm font-semibold text-emerald-800">Importacion completada</p>
                <p className="text-sm text-emerald-700">
                  <span className="font-semibold">{resultado.insertados}</span> nuevos ·{' '}
                  <span className="font-semibold">{resultado.actualizados}</span> actualizados
                  {resultado.cuentasCreadas > 0 && (
                    <> · <span className="font-semibold">{resultado.cuentasCreadas}</span> cuentas creadas</>
                  )}
                </p>
              </div>
              {resultado.errores?.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-sm font-semibold text-red-700 mb-2">{resultado.errores.length} errores</p>
                  <ul className="text-xs text-red-600 space-y-0.5 max-h-32 overflow-y-auto">
                    {resultado.errores.map((e, i) => (
                      <li key={i}>Fila {e.fila}: {e.error}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end">
                <button onClick={onCerrar}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg">
                  Cerrar
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
