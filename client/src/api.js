// Todas las llamadas van a /api/drive (proxied a localhost:3000 en dev)

export async function fetchFacturas() {
  const res = await fetch('/api/drive');
  if (!res.ok) throw new Error('Error al cargar facturas');
  const { data } = await res.json();
  return data;
}

export async function fetchProveedores() {
  const res = await fetch('/api/drive/proveedores');
  if (!res.ok) throw new Error('Error al cargar proveedores');
  const { data } = await res.json();
  return data;
}

export async function descargarZip(ids) {
  const res = await fetch('/api/drive/descargar-zip', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error al generar el ZIP');
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `facturas-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function contabilizar(ids) {
  const res = await fetch('/api/drive/contabilizar', {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Error al contabilizar');
  return res.json();
}
