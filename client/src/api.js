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
  return json.data; // { token, user }
}

export async function apiMe() {
  const res = await fetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
  if (!res.ok) return null;
  const { data } = await res.json();
  return data.user;
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

export async function desactivarUsuario(id) {
  const res = await fetch(`${API_BASE}/api/usuarios/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al desactivar usuario');
}

// ─── Facturas ─────────────────────────────────────────────────────────────────

export async function fetchFacturas() {
  const res = await fetch(`${API_BASE}/api/drive`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar facturas');
  const { data } = await res.json();
  return data;
}

export async function fetchProveedores() {
  const res = await fetch(`${API_BASE}/api/drive/proveedores`, { headers: authHeaders() });
  if (!res.ok) throw new Error('Error al cargar proveedores');
  const { data } = await res.json();
  return data;
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

export async function testNotificacion() {
  const res = await fetch(`${API_BASE}/api/sincronizacion/test-notificacion`, {
    method:  'POST',
    headers: authHeaders(),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Error al enviar notificación de prueba');
  return json.data;
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
