export function fmtFecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function fmtMs(ms) {
  if (!ms) return '—';
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export const FRECUENCIAS = [
  { value: 'manual',    label: 'Solo manual' },
  { value: 'cada_hora', label: 'Cada hora' },
  { value: 'cada_6h',   label: 'Cada 6 horas' },
  { value: 'diaria',    label: 'Diaria' },
  { value: 'semanal',   label: 'Semanal (lunes)' },
];

export const inputCls = 'rounded-lg border border-gray-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export function Spinner({ className = 'h-5 w-5' }) {
  return (
    <svg className={`${className} animate-spin text-blue-500`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
    </svg>
  );
}
