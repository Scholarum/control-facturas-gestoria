const GESTION = {
  PENDIENTE:     { text: 'Pendiente',     cls: 'bg-gray-100 text-gray-600 ring-gray-300' },
  DESCARGADA:    { text: 'Descargada',    cls: 'bg-blue-50 text-blue-700 ring-blue-200' },
  CC_ASIGNADA:   { text: 'CC Asignada',   cls: 'bg-purple-50 text-purple-700 ring-purple-200' },
  CONTABILIZADA: { text: 'Contabilizada', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
};

const EXTRACCION = {
  PENDIENTE:       { text: 'Sin extraer', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  PROCESADA:       { text: 'OK',          cls: 'bg-green-50 text-green-700 ring-green-200' },
  REVISION_MANUAL: { text: 'Revisión',    cls: 'bg-red-50 text-red-700 ring-red-200' },
  IGNORADO:        { text: 'Ignorado',    cls: 'bg-gray-100 text-gray-400 ring-gray-200' },
};

function Badge({ cfg, estado }) {
  const c = cfg[estado] || { text: estado, cls: 'bg-gray-100 text-gray-500 ring-gray-200' };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${c.cls}`}>
      {c.text}
    </span>
  );
}

export function BadgeGestion({ estado })    { return <Badge cfg={GESTION}    estado={estado} />; }
export function BadgeExtraccion({ estado }) { return <Badge cfg={EXTRACCION} estado={estado} />; }
