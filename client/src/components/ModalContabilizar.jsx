export default function ModalContabilizar({ count, onContabilizar, onCerrar, cargando }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[calc(100%-2rem)] sm:max-w-md animate-fade-in">

        {/* Cabecera */}
        <div className="flex items-start gap-4 p-6 border-b border-gray-100">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-gray-900">Descarga iniciada</h3>
            <p className="text-sm text-gray-500 mt-0.5">
              {count} {count === 1 ? 'factura incluida' : 'facturas incluidas'} en el ZIP
            </p>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="p-6">
          <p className="text-gray-700 text-sm leading-relaxed">
            ¿Deseas marcar {count === 1 ? 'esta factura' : <>estas <strong>{count} facturas</strong></>} como{' '}
            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              CONTABILIZADAS
            </span>
            ?
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Esta acción quedará registrada en el log de auditoría con la fecha y hora exactas.
          </p>
        </div>

        {/* Acciones */}
        <div className="flex gap-3 justify-end px-6 pb-6">
          <button
            onClick={onCerrar}
            disabled={cargando}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-50"
          >
            No, solo descargar
          </button>
          <button
            onClick={onContabilizar}
            disabled={cargando}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {cargando && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
            )}
            Sí, marcar como contabilizadas
          </button>
        </div>

      </div>
    </div>
  );
}
