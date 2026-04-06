/**
 * Formatea un número como moneda EUR en formato español (1.250,50 €).
 * No modifica el valor original — solo para visualización.
 */
const euroFormatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });

export function formatCurrency(n, { showZero = false } = {}) {
  if (n == null || n === '') return '—';
  if (n === 0 && !showZero) return '—';
  return euroFormatter.format(n);
}

/** Variante que muestra 0 €  (útil para desgloses de IVA donde 0 es un valor válido) */
export function formatCurrencyIva(n) {
  if (n == null || n === '') return '—';
  return euroFormatter.format(n);
}
