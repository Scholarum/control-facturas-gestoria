// ─── Base URL (vacía en dev con proxy Vite, URL del backend en producción) ────

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

// ─── Token de autenticación ───────────────────────────────────────────────────

const TOKEN_KEY = 'cf_token';

export function getStoredToken()       { return localStorage.getItem(TOKEN_KEY); }
export function storeToken(t)          { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken()           { localStorage.removeItem(TOKEN_KEY); }

function authHeaders(extra = {}) {
  const h = { ...extra };
  const t = getStoredToken();
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function apiLogin(email, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al iniciar sesión');
  return json.data; // { token, user, permisos }
}

export async function apiLoginGoogle(access_token) {
  const res = await fetch(`${API_BASE}/api/auth/google`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ access_token }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al iniciar sesión con Google');
  return json.data; // { token, user, permisos }
}

export async function apiMe() {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  if (!res.ok) return null;
  const { data } = await res.json();
  return data; // { user, permisos }
}

// ─── Usuarios ─────────────────────────────────────────────────────────────────

export async function fetchUsuarios() {
  const res = await fetch(`${API_BASE}/api/usuarios`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar usuarios');
  const { data } = await res.json();
  return data;
}

export async function crearUsuario(datos) {
  const res = await fetch(`${API_BASE}/api/usuarios`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al crear usuario');
  return json.data;
}

export async function editarUsuario(id, datos) {
  const res = await fetch(`${API_BASE}/api/usuarios/${id}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al actualizar usuario');
  return json.data;
}

export async function cambiarPassword(id, password) {
  const res = await fetch(`${API_BASE}/api/usuarios/${id}/password`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ password }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al cambiar contraseña');
}

export async function asignarEmpresasUsuario(userId, empresaIds) {
  const res = await fetch(`${API_BASE}/api/usuarios/${userId}/empresas`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ empresa_ids: empresaIds }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al asignar empresas');
}

export async function desactivarUsuario(id) {
  const res = await fetch(`${API_BASE}/api/usuarios/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al desactivar usuario');
}

// ─── Facturas ─────────────────────────────────────────────────────────────────

export async function fetchFacturas(empresaId) {
  const q = empresaId ? `?empresa=${empresaId}` : '';
  const res = await fetch(`${API_BASE}/api/drive${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar facturas');
  const { data } = await res.json();
  return data;
}

export async function fetchProveedores() {
  const res = await fetch(`${API_BASE}/api/proveedores/selector`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar proveedores');
  const { data } = await res.json();
  return data; // [{ nombre_carpeta, label }]
}

export async function descargarZip(ids) {
  const res = await fetch(`${API_BASE}/api/drive/descargar-zip`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error al generar el ZIP');
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `facturas-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function contabilizar(ids) {
  const res = await fetch(`${API_BASE}/api/drive/contabilizar`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Error al contabilizar');
  return res.json();
}

export async function asignarCGMasivo(ids, cgId) {
  const res = await fetch(`${API_BASE}/api/drive/cg-masivo`, {
    method:  'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body:    JSON.stringify({ ids, cuenta_gasto_id: cgId || null }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al asignar cuentas de gasto');
  return json.data;
}

export async function asignarCuentaGasto(id, cgId) {
  const res = await fetch(`${API_BASE}/api/drive/${id}/cg`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuenta_gasto_id: cgId || null }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al asignar cuenta de gasto');
  return json.data;
}

export async function fetchPreviewFactura(id) {
  const res = await fetch(`${API_BASE}/api/drive/${id}/stream`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar vista previa');
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), type: blob.type };
}

export async function revertirEstado(id) {
  const res = await fetch(`${API_BASE}/api/drive/${id}/revertir`, {
    method: 'PUT', headers: authHeaders(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Error al revertir');
  }
  return res.json();
}

export async function eliminarFactura(id) {
  const res = await fetch(`${API_BASE}/api/drive/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al eliminar factura');
  return json;
}

export async function editarDatosFactura(id, campos) {
  const res = await fetch(`${API_BASE}/api/drive/${id}/datos`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(campos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al editar datos');
  return json.data;
}

export async function asignarCuentasEmpresa(proveedorId, empresaId, cuentaContableId, cuentaGastoId) {
  const res = await fetch(`${API_BASE}/api/proveedores/${proveedorId}/cuentas-empresa`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ empresa_id: empresaId, cuenta_contable_id: cuentaContableId, cuenta_gasto_id: cuentaGastoId }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al asignar cuentas');
}

export async function asignarCuentaContableProveedor(proveedorId, cuentaContableId, empresaId) {
  const res = await fetch(`${API_BASE}/api/proveedores/${proveedorId}/cuenta-contable`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cuenta_contable_id: cuentaContableId, empresa_id: empresaId }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al asignar cuenta contable');
  return json.data;
}

export async function crearProveedorRapido(datos) {
  const res = await fetch(`${API_BASE}/api/proveedores/rapido`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al crear proveedor');
  return json.data;
}

export async function exportarExcel(ids) {
  const res = await fetch(`${API_BASE}/api/drive/exportar-excel`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Error al generar el Excel');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `facturas-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Auditoría ────────────────────────────────────────────────────────────────

export async function fetchAuditoria() {
  const res = await fetch(`${API_BASE}/api/auditoria`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar auditoría');
  const { data } = await res.json();
  return data;
}

// ─── Configuración / Prompt ───────────────────────────────────────────────────

export async function fetchPrompt() {
  const res = await fetch(`${API_BASE}/api/configuracion/prompt`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar el prompt');
  const { data } = await res.json();
  return data.prompt;
}

export async function savePrompt(prompt) {
  const res = await fetch(`${API_BASE}/api/configuracion/prompt`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => '');
    let msg = 'Error al guardar el prompt';
    try { msg = JSON.parse(texto).error || msg; } catch (_) {
      msg = `HTTP ${res.status} — ${texto.slice(0, 120) || 'sin respuesta'}`;
    }
    throw new Error(msg);
  }
}

export async function resetPrompt() {
  const res = await fetch(`${API_BASE}/api/configuracion/prompt`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ reset: true }),
  });
  if (!res.ok) throw new Error('Error al restaurar el prompt');
  const { data } = await res.json();
  return data.prompt;
}

// ─── Configuración del sistema (sync / notificaciones) ───────────────────────

export async function fetchConfigSistema() {
  const res = await fetch(`${API_BASE}/api/configuracion/sistema`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar configuración del sistema');
  const { data } = await res.json();
  return data;
}

export async function saveConfigSistema(updates) {
  const res = await fetch(`${API_BASE}/api/configuracion/sistema`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(updates),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al guardar configuración');
  return json.data;
}

// ─── Sincronización con Drive ─────────────────────────────────────────────────

export async function fetchHistorialSync() {
  const res = await fetch(`${API_BASE}/api/sincronizacion/historial`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial de sincronizaciones');
  const { data } = await res.json();
  return data;
}

export async function triggerSyncManual() {
  const res = await fetch(`${API_BASE}/api/sincronizacion/manual`, {
    method:  'POST',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al sincronizar');
  return json.data;
}

export async function fetchHistorialNotificaciones() {
  const res = await fetch(`${API_BASE}/api/sincronizacion/historial-notificaciones`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial de notificaciones');
  const { data } = await res.json();
  return data;
}

export async function fetchEmailTemplate() {
  const res = await fetch(`${API_BASE}/api/configuracion/sistema`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar plantilla de email');
  const { data } = await res.json();
  return { asunto: data.email_asunto || '', cuerpo: data.email_cuerpo || '' };
}

export async function saveEmailTemplate({ asunto, cuerpo }) {
  const res = await fetch(`${API_BASE}/api/configuracion/sistema`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ email_asunto: asunto, email_cuerpo: cuerpo }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al guardar plantilla');
}

export async function fetchEstadoMensaje(messageId) {
  const res = await fetch(`${API_BASE}/api/sincronizacion/estado-mensaje/${messageId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al consultar estado del mensaje');
  const { data } = await res.json();
  return data;
}

export async function fetchDiagnosticoNotificacion() {
  const res = await fetch(`${API_BASE}/api/sincronizacion/diagnostico-notificacion`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al obtener diagnóstico');
  const { data } = await res.json();
  return data;
}

export async function testNotificacion() {
  const res = await fetch(`${API_BASE}/api/sincronizacion/test-notificacion`, {
    method:  'POST',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al enviar notificación de prueba');
  return json.data;
}

export async function fetchHistorialConciliaciones(empresaId) {
  const q = empresaId ? `?empresa=${empresaId}` : '';
  const res = await fetch(`${API_BASE}/api/conciliacion/historial${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial de conciliaciones');
  const { data } = await res.json();
  return data;
}

export async function fetchConciliacion(id) {
  const res = await fetch(`${API_BASE}/api/conciliacion/historial/${id}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar conciliación');
  const { data } = await res.json();
  return data;
}

export async function fetchRevisionesConciliacion(conciliacionId) {
  const res = await fetch(`${API_BASE}/api/conciliacion/historial/${conciliacionId}/revisiones`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial de revisiones');
  const { data } = await res.json();
  return data;
}

export async function actualizarEstadoLineaConciliacion(conciliacionId, lineaIdx, estado_revision) {
  const res = await fetch(`${API_BASE}/api/conciliacion/historial/${conciliacionId}/lineas/${lineaIdx}`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ estado_revision }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al actualizar estado');
}

export async function descargarExcelConciliacion(resumen, resultados, lineaEstados) {
  const res = await fetch(`${API_BASE}/api/conciliacion/excel`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ resumen, resultados, lineaEstados }),
  });
  if (!res.ok) throw new Error('Error al generar Excel');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `conciliacion-${resumen.proveedor.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function descargarPdfConciliacion(resumen, resultados) {
  const res = await fetch(`${API_BASE}/api/conciliacion/pdf`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ resumen, resultados }),
  });
  if (!res.ok) throw new Error('Error al generar PDF');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `conciliacion-${resumen.proveedor.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function ejecutarConciliacion(formData) {
  const res = await fetch(`${API_BASE}/api/conciliacion`, {
    method:  'POST',
    headers: authHeaders(),
    body:    formData,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error en la conciliación');
  return json.data;
}

// ─── Conciliación V2 ─────────────────────────────────────────────────────────

export async function parsearMayorV2(formData) {
  const res = await fetch(`${API_BASE}/api/conciliacion/v2/parsear`, {
    method: 'POST',
    headers: authHeaders(),
    body: formData,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al parsear el archivo');
  return json.data;
}

export async function ejecutarConciliacionV2(proveedores, alcance, empresaId) {
  const res = await fetch(`${API_BASE}/api/conciliacion/v2/ejecutar`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ proveedores, alcance, empresa_id: empresaId }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error en la conciliación');
  return json.data;
}

export async function guardarVinculoManual(datos) {
  const res = await fetch(`${API_BASE}/api/conciliacion/v2/vincular`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al guardar vinculo');
}

export async function eliminarVinculoManual(datos) {
  const res = await fetch(`${API_BASE}/api/conciliacion/v2/vincular`, {
    method: 'DELETE',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al eliminar vinculo');
}

// ─── Plan Contable ────────────────────────────────────────────────────────────

export async function fetchPlanContable(empresaIdOrQuery = '') {
  const params = new URLSearchParams();
  if (typeof empresaIdOrQuery === 'number') {
    params.set('empresa', empresaIdOrQuery);
  } else if (empresaIdOrQuery) {
    params.set('q', empresaIdOrQuery);
  }
  const qs = params.toString();
  const url = qs ? `${API_BASE}/api/plan-contable?${qs}` : `${API_BASE}/api/plan-contable`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar plan contable');
  const { data } = await res.json();
  return data;
}

export async function crearCuentaContable(datos) {
  const res = await fetch(`${API_BASE}/api/plan-contable`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al crear cuenta');
  return json.data;
}

export async function eliminarCuentaContable(id) {
  const res = await fetch(`${API_BASE}/api/plan-contable/${id}`, {
    method: 'DELETE', headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al eliminar cuenta');
}

// ─── Proveedores ──────────────────────────────────────────────────────────────

// ─── Roles ────────────────────────────────────────────────────────────────────

export async function fetchRoles() {
  const res = await fetch(`${API_BASE}/api/roles`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar roles');
  const { data } = await res.json();
  return data;
}

export async function crearRol(datos) {
  const res = await fetch(`${API_BASE}/api/roles`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al crear rol');
  return json.data;
}

export async function editarRol(id, datos) {
  const res = await fetch(`${API_BASE}/api/roles/${id}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al editar rol');
  return json.data;
}

export async function eliminarRol(id) {
  const res = await fetch(`${API_BASE}/api/roles/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al eliminar rol');
}

export async function vincularProveedores(empresaId) {
  const q = empresaId ? `?empresa=${empresaId}` : '';
  const res = await fetch(`${API_BASE}/api/drive/vincular-proveedores${q}`, {
    method: 'PUT', headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al vincular proveedores');
  return json.data;
}

export async function aplicarCuentasProveedor(empresaId) {
  const q = empresaId ? `?empresa=${empresaId}` : '';
  const res = await fetch(`${API_BASE}/api/drive/aplicar-cuentas-proveedor${q}`, {
    method: 'PUT',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al aplicar cuentas de proveedor');
  return json.data; // { actualizadas }
}

export async function autodetectarProveedores() {
  const res = await fetch(`${API_BASE}/api/proveedores/autodetectar`, {
    method: 'POST',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al autodetectar proveedores');
  return json.data; // { creados, sinCuentas: [{id, razon_social, cif, nombre_carpeta}] }
}

export async function fetchProveedoresCrud(empresaId) {
  const q = empresaId ? `?empresa=${empresaId}` : '';
  const res = await fetch(`${API_BASE}/api/proveedores${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar proveedores');
  const { data } = await res.json();
  return data;
}

export async function crearProveedor(datos) {
  const res = await fetch(`${API_BASE}/api/proveedores`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al crear proveedor');
  return json.data;
}

export async function editarProveedor(id, datos) {
  const res = await fetch(`${API_BASE}/api/proveedores/${id}`, {
    method:  'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify(datos),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al actualizar proveedor');
  return json.data;
}

export async function eliminarProveedor(id) {
  const res = await fetch(`${API_BASE}/api/proveedores/${id}`, {
    method:  'DELETE',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al eliminar proveedor');
}

export async function descargarExcelProveedores() {
  const res = await fetch(`${API_BASE}/api/proveedores/excel`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al generar Excel');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `proveedores-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function descargarPlantillaProveedores() {
  const res = await fetch(`${API_BASE}/api/proveedores/plantilla-importacion`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al descargar plantilla');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'plantilla-proveedores.xlsx';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importarProveedoresExcel(file, empresaId) {
  const fd = new FormData();
  fd.append('archivo', file);
  const q = empresaId ? `?empresa=${empresaId}` : '';
  const res = await fetch(`${API_BASE}/api/proveedores/importar${q}`, {
    method:  'POST',
    headers: authHeaders(),
    body:    fd,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al importar');
  return json.data; // { insertados, actualizados, errores }
}

// ─── Exportación A3 ───────────────────────────────────────────────────────────

export async function exportarLoteA3(ids) {
  const res = await fetch(`${API_BASE}/api/exportacion-a3/exportar`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ ids }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al exportar lote A3');
  const { nombre_fichero, contenido_csv } = json.data;
  const blob = new Blob([contenido_csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = nombre_fichero;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return json.data;
}

export async function sagePreview(ids) {
  const res = await fetch(`${API_BASE}/api/drive/sage-preview`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ ids }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al previsualizar');
  return json.data;
}

export async function exportarSage(ids, asientosPorProveedor, contabilizar = false) {
  const res = await fetch(`${API_BASE}/api/drive/exportar-sage`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ ids, asientos_por_proveedor: asientosPorProveedor, contabilizar }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al exportar a SAGE');
  const { nombre_fichero, contenido_txt, contenido_csv } = json.data;
  // Descargar TXT
  const blobTxt = new Blob([contenido_txt], { type: 'text/plain;charset=utf-8;' });
  const urlTxt  = URL.createObjectURL(blobTxt);
  const aTxt    = document.createElement('a');
  aTxt.href = urlTxt; aTxt.download = `${nombre_fichero}.txt`;
  document.body.appendChild(aTxt); aTxt.click(); document.body.removeChild(aTxt);
  URL.revokeObjectURL(urlTxt);
  // Descargar CSV
  const blobCsv = new Blob([contenido_csv], { type: 'text/csv;charset=utf-8;' });
  const urlCsv  = URL.createObjectURL(blobCsv);
  const aCsv    = document.createElement('a');
  aCsv.href = urlCsv; aCsv.download = `${nombre_fichero}.csv`;
  document.body.appendChild(aCsv); aCsv.click(); document.body.removeChild(aCsv);
  URL.revokeObjectURL(urlCsv);
  return json.data;
}

export async function fetchHistorialSage(empresaId) {
  const q = empresaId ? `?empresa=${empresaId}` : '';
  const res = await fetch(`${API_BASE}/api/drive/sage-historial${q}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial SAGE');
  const { data } = await res.json();
  return data;
}

export async function fetchFacturasSageLote(loteId) {
  const res = await fetch(`${API_BASE}/api/drive/sage-historial/${loteId}/facturas`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar facturas del lote');
  const { data } = await res.json();
  return data;
}

export async function reDescargarSage(id, nombreFichero, format = 'txt') {
  const res = await fetch(`${API_BASE}/api/drive/sage-historial/${id}/descargar?format=${format}`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al descargar');
  const blob = await res.blob();
  const ext  = format === 'csv' ? '.csv' : '.txt';
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `${nombreFichero}${ext}`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function fetchHistorialA3() {
  const res = await fetch(`${API_BASE}/api/exportacion-a3`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar historial A3');
  const { data } = await res.json();
  return data;
}

export async function reDescargarA3(id, nombreFichero) {
  const res = await fetch(`${API_BASE}/api/exportacion-a3/${id}/descargar`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al descargar lote A3');
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = nombreFichero;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Drive: carpetas y subida universal ───────────────────────────────────────

export async function fetchCarpetasDrive() {
  const res = await fetch(`${API_BASE}/api/drive/carpetas`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar carpetas de Drive');
  const { data } = await res.json();
  return data;
}

export async function crearCarpetaDrive(nombre) {
  const res = await fetch(`${API_BASE}/api/drive/carpetas`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ nombre }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Error al crear carpeta');
  return json.data;
}

export async function subirFacturasUniversal(carpetaId, archivos, onProgress) {
  const formData = new FormData();
  formData.append('carpeta_id', carpetaId);
  for (const file of archivos) {
    formData.append('archivos', file);
  }

  const xhr = new XMLHttpRequest();
  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });
    xhr.addEventListener('load', () => {
      try {
        const json = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) reject(new Error(json.error || 'Error en la subida'));
        else resolve(json.data);
      } catch { reject(new Error('Respuesta invalida del servidor')); }
    });
    xhr.addEventListener('error', () => reject(new Error('Error de red')));
    xhr.open('POST', `${API_BASE}/api/drive/upload-universal`);
    const token = getStoredToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}

export async function reextraer(ids, onProgress) {
  const res = await fetch(`${API_BASE}/api/configuracion/reextraer`, {
    method:  'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body:    JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error('Error al iniciar re-extracción');

  const reader = res.body.getReader();
  const dec    = new TextDecoder();
  let buf      = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n\n');
    buf = lines.pop();
    for (const chunk of lines) {
      const line = chunk.replace(/^data: /, '').trim();
      if (!line) continue;
      try { onProgress(JSON.parse(line)); } catch (_) {}
    }
  }
}
