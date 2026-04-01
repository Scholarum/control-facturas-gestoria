-- =============================================================================
-- RLS (Row Level Security) para Supabase — Control Facturas Gestoría
-- =============================================================================
-- Fecha: 2026-04-01
--
-- CONTEXTO:
-- La app usa JWT propio (Express + pg driver), NO Supabase Auth.
-- El backend se conecta como postgres/service_role → bypassa RLS automáticamente.
-- Este script protege contra acceso directo via API REST de Supabase (PostgREST)
-- y opcionalmente soporta RLS a nivel de app usando variables de sesión.
--
-- EJECUCIÓN:
-- Ejecutar en el SQL Editor de Supabase Dashboard o via psql.
-- Es idempotente: se puede ejecutar múltiples veces sin errores.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. ACTIVAR RLS EN TODAS LAS TABLAS
-- =============================================================================
-- Al activar RLS sin políticas, se bloquea TODO acceso para roles no-owner.
-- El backend (service_role/postgres) sigue funcionando sin cambios.

ALTER TABLE usuarios                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE facturas                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tokens_acceso                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_auditoria                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE drive_archivos                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE configuracion_sistema           ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_sincronizaciones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_notificaciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE historial_conciliaciones        ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedor_empresa               ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuario_empresa                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes_exportacion_sage          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sage_facturas_exportadas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacion_vinculos_manuales  ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacion_lineas_estado      ENABLE ROW LEVEL SECURITY;
ALTER TABLE conciliacion_lineas_historial   ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_contable                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles                           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rol_permisos                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes_exportacion_a3            ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversaciones             ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_mensajes                   ENABLE ROW LEVEL SECURITY;

-- Forzar RLS también para el owner de las tablas (importante si el backend
-- usa el mismo rol que creó las tablas y quieres RLS end-to-end).
-- NOTA: Descomentar SOLO si migras a un rol de app dedicado (no postgres).
-- ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;
-- ... (repetir para cada tabla)

-- =============================================================================
-- 2. FUNCIONES HELPER PARA CONTEXTO DE SESIÓN
-- =============================================================================
-- El backend Express debe ejecutar al inicio de cada request:
--   SET LOCAL app.current_user_id = '42';
--   SET LOCAL app.current_user_role = 'ADMIN';
--   SET LOCAL app.current_empresa_id = '1';
-- SET LOCAL dura solo hasta el fin de la transacción.

CREATE OR REPLACE FUNCTION app_user_id() RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::INTEGER
$$;

CREATE OR REPLACE FUNCTION app_user_role() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_user_role', true), '')
$$;

CREATE OR REPLACE FUNCTION app_empresa_id() RETURNS INTEGER
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_empresa_id', true), '')::INTEGER
$$;

-- Helper: ¿el usuario actual tiene acceso a una empresa?
CREATE OR REPLACE FUNCTION usuario_tiene_empresa(p_empresa_id INTEGER) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuario_empresa
    WHERE usuario_id = app_user_id()
      AND empresa_id = p_empresa_id
  )
$$;

-- Helper: ¿el usuario actual es ADMIN?
CREATE OR REPLACE FUNCTION es_admin() RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT app_user_role() = 'ADMIN'
$$;

-- =============================================================================
-- 3. POLÍTICAS DE SEGURIDAD POR TABLA
-- =============================================================================
-- Convención de nombres: {tabla}_{operacion}_{quien}
-- Se usa DROP POLICY IF EXISTS para idempotencia.

-- ─── USUARIOS ────────────────────────────────────────────────────────────────
-- Columnas sensibles: password_hash, email
-- ADMIN: lectura/escritura total
-- GESTORIA: solo puede ver su propio registro (sin password_hash)

DROP POLICY IF EXISTS usuarios_select_admin ON usuarios;
CREATE POLICY usuarios_select_admin ON usuarios
  FOR SELECT TO authenticated
  USING (es_admin());

DROP POLICY IF EXISTS usuarios_select_self ON usuarios;
CREATE POLICY usuarios_select_self ON usuarios
  FOR SELECT TO authenticated
  USING (id = app_user_id());

DROP POLICY IF EXISTS usuarios_update_admin ON usuarios;
CREATE POLICY usuarios_update_admin ON usuarios
  FOR UPDATE TO authenticated
  USING (es_admin());

DROP POLICY IF EXISTS usuarios_insert_admin ON usuarios;
CREATE POLICY usuarios_insert_admin ON usuarios
  FOR INSERT TO authenticated
  WITH CHECK (es_admin());

DROP POLICY IF EXISTS usuarios_delete_admin ON usuarios;
CREATE POLICY usuarios_delete_admin ON usuarios
  FOR DELETE TO authenticated
  USING (es_admin());

-- ─── EMPRESAS ────────────────────────────────────────────────────────────────
-- Columnas sensibles: cif, telefono, email, direccion
-- Solo accesible si el usuario pertenece a la empresa

DROP POLICY IF EXISTS empresas_select_member ON empresas;
CREATE POLICY empresas_select_member ON empresas
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(id)
  );

DROP POLICY IF EXISTS empresas_modify_admin ON empresas;
CREATE POLICY empresas_modify_admin ON empresas
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── USUARIO_EMPRESA ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS usuario_empresa_select ON usuario_empresa;
CREATE POLICY usuario_empresa_select ON usuario_empresa
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_id = app_user_id()
  );

DROP POLICY IF EXISTS usuario_empresa_modify_admin ON usuario_empresa;
CREATE POLICY usuario_empresa_modify_admin ON usuario_empresa
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── DRIVE_ARCHIVOS (facturas) ───────────────────────────────────────────────
-- Columnas sensibles: datos_extraidos (contiene CIF emisor/receptor)
-- Acceso filtrado por empresa

DROP POLICY IF EXISTS drive_archivos_select ON drive_archivos;
CREATE POLICY drive_archivos_select ON drive_archivos
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS drive_archivos_insert ON drive_archivos;
CREATE POLICY drive_archivos_insert ON drive_archivos
  FOR INSERT TO authenticated
  WITH CHECK (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS drive_archivos_update ON drive_archivos;
CREATE POLICY drive_archivos_update ON drive_archivos
  FOR UPDATE TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS drive_archivos_delete_admin ON drive_archivos;
CREATE POLICY drive_archivos_delete_admin ON drive_archivos
  FOR DELETE TO authenticated
  USING (es_admin());

-- ─── FACTURAS ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS facturas_select ON facturas;
CREATE POLICY facturas_select ON facturas
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR subida_por = app_user_id()
  );

DROP POLICY IF EXISTS facturas_modify_admin ON facturas;
CREATE POLICY facturas_modify_admin ON facturas
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── PROVEEDORES ─────────────────────────────────────────────────────────────
-- Columnas sensibles: cif, razon_social
-- GESTORIA: no tiene acceso por defecto (nivel 'none' en rol_permisos)

DROP POLICY IF EXISTS proveedores_select ON proveedores;
CREATE POLICY proveedores_select ON proveedores
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR EXISTS (
      SELECT 1 FROM proveedor_empresa pe
      WHERE pe.proveedor_id = proveedores.id
        AND usuario_tiene_empresa(pe.empresa_id)
    )
  );

DROP POLICY IF EXISTS proveedores_modify_admin ON proveedores;
CREATE POLICY proveedores_modify_admin ON proveedores
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── PROVEEDOR_EMPRESA ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS proveedor_empresa_select ON proveedor_empresa;
CREATE POLICY proveedor_empresa_select ON proveedor_empresa
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS proveedor_empresa_modify_admin ON proveedor_empresa;
CREATE POLICY proveedor_empresa_modify_admin ON proveedor_empresa
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── PLAN_CONTABLE ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS plan_contable_select ON plan_contable;
CREATE POLICY plan_contable_select ON plan_contable
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS plan_contable_modify_admin ON plan_contable;
CREATE POLICY plan_contable_modify_admin ON plan_contable
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── TOKENS_ACCESO ───────────────────────────────────────────────────────────
-- Sensible: permite acceso público a facturas
DROP POLICY IF EXISTS tokens_acceso_admin ON tokens_acceso;
CREATE POLICY tokens_acceso_admin ON tokens_acceso
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── LOGS_AUDITORIA ─────────────────────────────────────────────────────────
-- Inmutable: solo INSERT, nunca UPDATE/DELETE
-- Columnas sensibles: ip, user_agent

DROP POLICY IF EXISTS logs_auditoria_select ON logs_auditoria;
CREATE POLICY logs_auditoria_select ON logs_auditoria
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_id = app_user_id()
  );

DROP POLICY IF EXISTS logs_auditoria_insert ON logs_auditoria;
CREATE POLICY logs_auditoria_insert ON logs_auditoria
  FOR INSERT TO authenticated
  WITH CHECK (true);  -- El backend siempre puede insertar logs

-- NO hay política de UPDATE/DELETE: los logs son inmutables

-- ─── CONFIGURACION (por empresa) ────────────────────────────────────────────
DROP POLICY IF EXISTS configuracion_admin ON configuracion;
CREATE POLICY configuracion_admin ON configuracion
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── CONFIGURACION_SISTEMA ───────────────────────────────────────────────────
DROP POLICY IF EXISTS configuracion_sistema_admin ON configuracion_sistema;
CREATE POLICY configuracion_sistema_admin ON configuracion_sistema
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── HISTORIAL_SINCRONIZACIONES ──────────────────────────────────────────────
DROP POLICY IF EXISTS historial_sync_select ON historial_sincronizaciones;
CREATE POLICY historial_sync_select ON historial_sincronizaciones
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS historial_sync_modify_admin ON historial_sincronizaciones;
CREATE POLICY historial_sync_modify_admin ON historial_sincronizaciones
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── HISTORIAL_NOTIFICACIONES ────────────────────────────────────────────────
-- Columnas sensibles: destinatarios (emails)
DROP POLICY IF EXISTS historial_notif_admin ON historial_notificaciones;
CREATE POLICY historial_notif_admin ON historial_notificaciones
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── HISTORIAL_CONCILIACIONES ────────────────────────────────────────────────
DROP POLICY IF EXISTS historial_conc_select ON historial_conciliaciones;
CREATE POLICY historial_conc_select ON historial_conciliaciones
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS historial_conc_modify_admin ON historial_conciliaciones;
CREATE POLICY historial_conc_modify_admin ON historial_conciliaciones
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── LOTES_EXPORTACION_SAGE ─────────────────────────────────────────────────
DROP POLICY IF EXISTS lotes_sage_select ON lotes_exportacion_sage;
CREATE POLICY lotes_sage_select ON lotes_exportacion_sage
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_tiene_empresa(empresa_id)
  );

DROP POLICY IF EXISTS lotes_sage_modify_admin ON lotes_exportacion_sage;
CREATE POLICY lotes_sage_modify_admin ON lotes_exportacion_sage
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── SAGE_FACTURAS_EXPORTADAS ────────────────────────────────────────────────
-- Columnas sensibles: cif_emisor
DROP POLICY IF EXISTS sage_export_select ON sage_facturas_exportadas;
CREATE POLICY sage_export_select ON sage_facturas_exportadas
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR EXISTS (
      SELECT 1 FROM lotes_exportacion_sage l
      WHERE l.id = sage_facturas_exportadas.lote_id
        AND usuario_tiene_empresa(l.empresa_id)
    )
  );

DROP POLICY IF EXISTS sage_export_modify_admin ON sage_facturas_exportadas;
CREATE POLICY sage_export_modify_admin ON sage_facturas_exportadas
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── LOTES_EXPORTACION_A3 ───────────────────────────────────────────────────
DROP POLICY IF EXISTS lotes_a3_admin ON lotes_exportacion_a3;
CREATE POLICY lotes_a3_admin ON lotes_exportacion_a3
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── CONCILIACION_VINCULOS_MANUALES ──────────────────────────────────────────
DROP POLICY IF EXISTS conc_vinculos_select ON conciliacion_vinculos_manuales;
CREATE POLICY conc_vinculos_select ON conciliacion_vinculos_manuales
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_id = app_user_id()
  );

DROP POLICY IF EXISTS conc_vinculos_insert ON conciliacion_vinculos_manuales;
CREATE POLICY conc_vinculos_insert ON conciliacion_vinculos_manuales
  FOR INSERT TO authenticated
  WITH CHECK (
    es_admin()
    OR usuario_id = app_user_id()
  );

DROP POLICY IF EXISTS conc_vinculos_delete_admin ON conciliacion_vinculos_manuales;
CREATE POLICY conc_vinculos_delete_admin ON conciliacion_vinculos_manuales
  FOR DELETE TO authenticated
  USING (es_admin());

-- ─── CONCILIACION_LINEAS_ESTADO ──────────────────────────────────────────────
DROP POLICY IF EXISTS conc_lineas_estado_select ON conciliacion_lineas_estado;
CREATE POLICY conc_lineas_estado_select ON conciliacion_lineas_estado
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR EXISTS (
      SELECT 1 FROM historial_conciliaciones hc
      WHERE hc.id = conciliacion_lineas_estado.conciliacion_id
        AND usuario_tiene_empresa(hc.empresa_id)
    )
  );

DROP POLICY IF EXISTS conc_lineas_estado_modify ON conciliacion_lineas_estado;
CREATE POLICY conc_lineas_estado_modify ON conciliacion_lineas_estado
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── CONCILIACION_LINEAS_HISTORIAL ───────────────────────────────────────────
DROP POLICY IF EXISTS conc_lineas_hist_select ON conciliacion_lineas_historial;
CREATE POLICY conc_lineas_hist_select ON conciliacion_lineas_historial
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR EXISTS (
      SELECT 1 FROM historial_conciliaciones hc
      WHERE hc.id = conciliacion_lineas_historial.conciliacion_id
        AND usuario_tiene_empresa(hc.empresa_id)
    )
  );

DROP POLICY IF EXISTS conc_lineas_hist_insert ON conciliacion_lineas_historial;
CREATE POLICY conc_lineas_hist_insert ON conciliacion_lineas_historial
  FOR INSERT TO authenticated
  WITH CHECK (true);  -- El backend registra cambios

-- ─── ROLES ───────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles
  FOR SELECT TO authenticated
  USING (true);  -- Todos pueden ver los roles disponibles

DROP POLICY IF EXISTS roles_modify_admin ON roles;
CREATE POLICY roles_modify_admin ON roles
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── ROL_PERMISOS ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS rol_permisos_select ON rol_permisos;
CREATE POLICY rol_permisos_select ON rol_permisos
  FOR SELECT TO authenticated
  USING (true);  -- Necesario para que el frontend resuelva permisos

DROP POLICY IF EXISTS rol_permisos_modify_admin ON rol_permisos;
CREATE POLICY rol_permisos_modify_admin ON rol_permisos
  FOR ALL TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

-- ─── CHAT_CONVERSACIONES ─────────────────────────────────────────────────────
DROP POLICY IF EXISTS chat_conv_select ON chat_conversaciones;
CREATE POLICY chat_conv_select ON chat_conversaciones
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR usuario_id = app_user_id()
  );

DROP POLICY IF EXISTS chat_conv_insert ON chat_conversaciones;
CREATE POLICY chat_conv_insert ON chat_conversaciones
  FOR INSERT TO authenticated
  WITH CHECK (usuario_id = app_user_id() OR es_admin());

DROP POLICY IF EXISTS chat_conv_update ON chat_conversaciones;
CREATE POLICY chat_conv_update ON chat_conversaciones
  FOR UPDATE TO authenticated
  USING (usuario_id = app_user_id() OR es_admin());

DROP POLICY IF EXISTS chat_conv_delete ON chat_conversaciones;
CREATE POLICY chat_conv_delete ON chat_conversaciones
  FOR DELETE TO authenticated
  USING (usuario_id = app_user_id() OR es_admin());

-- ─── CHAT_MENSAJES ───────────────────────────────────────────────────────────
DROP POLICY IF EXISTS chat_msg_select ON chat_mensajes;
CREATE POLICY chat_msg_select ON chat_mensajes
  FOR SELECT TO authenticated
  USING (
    es_admin()
    OR EXISTS (
      SELECT 1 FROM chat_conversaciones cc
      WHERE cc.id = chat_mensajes.conversacion_id
        AND cc.usuario_id = app_user_id()
    )
  );

DROP POLICY IF EXISTS chat_msg_insert ON chat_mensajes;
CREATE POLICY chat_msg_insert ON chat_mensajes
  FOR INSERT TO authenticated
  WITH CHECK (
    es_admin()
    OR EXISTS (
      SELECT 1 FROM chat_conversaciones cc
      WHERE cc.id = chat_mensajes.conversacion_id
        AND cc.usuario_id = app_user_id()
    )
  );

-- =============================================================================
-- 4. VISTA SEGURA PARA DATOS SENSIBLES DE PROVEEDORES
-- =============================================================================
-- Los usuarios GESTORIA no deberían ver CIF completos de proveedores.
-- Esta vista enmascara el CIF mostrando solo los últimos 3 caracteres.

CREATE OR REPLACE VIEW proveedores_seguro AS
SELECT
  id,
  razon_social,
  nombre_carpeta,
  CASE
    WHEN es_admin() THEN cif
    WHEN cif IS NOT NULL AND LENGTH(cif) > 3
      THEN REPEAT('*', LENGTH(cif) - 3) || RIGHT(cif, 3)
    ELSE cif
  END AS cif,
  cuenta_contable_id,
  cuenta_gasto_id,
  activo,
  created_at,
  updated_at
FROM proveedores;

-- Vista segura para empresas (enmascara CIF, telefono, email)
CREATE OR REPLACE VIEW empresas_seguro AS
SELECT
  id,
  nombre,
  CASE
    WHEN es_admin() THEN cif
    WHEN cif IS NOT NULL AND LENGTH(cif) > 3
      THEN REPEAT('*', LENGTH(cif) - 3) || RIGHT(cif, 3)
    ELSE cif
  END AS cif,
  CASE WHEN es_admin() THEN direccion ELSE NULL END AS direccion,
  CASE WHEN es_admin() THEN telefono  ELSE NULL END AS telefono,
  CASE WHEN es_admin() THEN email     ELSE NULL END AS email,
  web,
  activo,
  created_at
FROM empresas;

-- =============================================================================
-- 5. BLOQUEAR ACCESO ANÓNIMO (rol anon de Supabase)
-- =============================================================================
-- Sin políticas para 'anon', RLS bloquea todo acceso anónimo por defecto.
-- Excepción: tokens_acceso para acceso público a facturas vía token.

DROP POLICY IF EXISTS tokens_acceso_anon_select ON tokens_acceso;
CREATE POLICY tokens_acceso_anon_select ON tokens_acceso
  FOR SELECT TO anon
  USING (
    usado = 0
    AND (expira_at IS NULL OR expira_at::TIMESTAMPTZ > NOW())
  );

-- =============================================================================
-- 6. REVOCAR PERMISOS DIRECTOS DEL ROL anon EN COLUMNAS SENSIBLES
-- =============================================================================
-- Defensa en profundidad: aunque RLS bloquee, revocamos acceso a columnas.

REVOKE ALL ON usuarios FROM anon;
REVOKE ALL ON logs_auditoria FROM anon;
REVOKE ALL ON configuracion FROM anon;
REVOKE ALL ON configuracion_sistema FROM anon;
REVOKE ALL ON historial_notificaciones FROM anon;
REVOKE ALL ON chat_conversaciones FROM anon;
REVOKE ALL ON chat_mensajes FROM anon;

-- Solo permitir SELECT en tokens_acceso para anon (acceso público por token)
GRANT SELECT ON tokens_acceso TO anon;

COMMIT;

-- =============================================================================
-- INSTRUCCIONES DE INTEGRACIÓN CON EXPRESS (OPCIONAL)
-- =============================================================================
-- Si quieres RLS end-to-end (no solo protección contra PostgREST),
-- modifica database.js para inyectar el contexto del usuario en cada query:
--
--   async function queryConContexto(sql, params, { userId, role, empresaId }) {
--     const client = await pool.connect();
--     try {
--       await client.query('BEGIN');
--       await client.query(`SET LOCAL app.current_user_id = '${userId}'`);
--       await client.query(`SET LOCAL app.current_user_role = '${role}'`);
--       await client.query(`SET LOCAL app.current_empresa_id = '${empresaId}'`);
--       const result = await client.query(sql, params);
--       await client.query('COMMIT');
--       return result;
--     } catch (e) {
--       await client.query('ROLLBACK');
--       throw e;
--     } finally {
--       client.release();
--     }
--   }
--
-- Y en el middleware de auth, tras resolver el usuario:
--   req.dbContext = { userId: user.id, role: user.rol, empresaId: empresaActiva };
