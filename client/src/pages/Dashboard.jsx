import { useState, useEffect } from 'react';
import { getStoredToken } from '../api.js';
import { formatCurrency } from '../utils/formatCurrency.js';

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

const fmtEuro = n => formatCurrency(n, { showZero: true });
const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function fmtMes(yyyymm) {
  const [y, m] = yyyymm.split('-');
  return `${MESES[+m - 1]} ${y.slice(2)}`;
}

const ESTADO_COLORS = {
  PENDIENTE: 'bg-amber-500',
  DESCARGADA: 'bg-blue-500',
  CC_ASIGNADA: 'bg-purple-500',
  CONTABILIZADA: 'bg-emerald-500',
};

function BarChart({ data, labelKey, valueKey, formatValue, color = 'bg-blue-500' }) {
  if (!data.length) return <p className="text-sm text-gray-400 text-center py-4">Sin datos</p>;
  const max = Math.max(...data.map(d => Number(d[valueKey]) || 0), 1);
  return (
    <div className="space-y-2">
      {data.map((d, i) => {
        const val = Number(d[valueKey]) || 0;
        const pct = (val / max) * 100;
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 w-16 sm:w-20 text-right flex-shrink-0 truncate" title={d[labelKey]}>
              {d[labelKey]}
            </span>
            <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
              <div className={`h-full rounded-full ${typeof color === 'function' ? color(d) : color} transition-all`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-700 w-20 sm:w-24 flex-shrink-0">
              {formatValue ? formatValue(val) : val}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard({ empresaId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!empresaId) return;
    setLoading(true);
    const params = new URLSearchParams({ empresa_id: empresaId });
    fetch(`${API_BASE}/api/dashboard?${params}`, {
      headers: { 'Authorization': `Bearer ${getStoredToken()}` },
    })
      .then(r => r.json())
      .then(json => { if (json.ok) setData(json.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [empresaId]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <svg className="h-8 w-8 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
      </div>
    );
  }

  if (!data) return <p className="text-center text-gray-400 py-12">No se pudo cargar el dashboard</p>;

  const { porMes, porEstado, porProveedor, totales } = data;

  return (
    <div className="space-y-6">

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPI label="Total facturas" value={totales.total_facturas} color="text-gray-900" />
        <KPI label="Importe total" value={fmtEuro(totales.importe_total)} color="text-blue-600" />
        <KPI label="Proveedores activos" value={totales.total_proveedores} color="text-purple-600" />
        <KPI label="Pendientes" value={totales.pendientes} color="text-amber-600" />
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Facturas por mes */}
        <Card title="Facturas por mes">
          <BarChart
            data={porMes}
            labelKey="mes"
            valueKey="total"
            formatValue={v => `${v} fact.`}
            color="bg-blue-500"
          />
        </Card>

        {/* Importe por mes */}
        <Card title="Importe por mes">
          <BarChart
            data={porMes}
            labelKey="mes"
            valueKey="importe"
            formatValue={v => fmtEuro(v)}
            color="bg-emerald-500"
          />
        </Card>

        {/* Por estado */}
        <Card title="Por estado de gestion">
          <BarChart
            data={porEstado}
            labelKey="estado"
            valueKey="total"
            color={d => ESTADO_COLORS[d.estado] || 'bg-gray-400'}
          />
        </Card>

        {/* Top proveedores */}
        <Card title="Top 10 proveedores por importe">
          <BarChart
            data={porProveedor}
            labelKey="proveedor"
            valueKey="importe"
            formatValue={v => fmtEuro(v)}
            color="bg-purple-500"
          />
        </Card>
      </div>
    </div>
  );
}

function KPI({ label, value, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 sm:px-5 py-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl sm:text-2xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-5">
      <h3 className="font-semibold text-gray-900 text-sm mb-4">{title}</h3>
      {children}
    </div>
  );
}
