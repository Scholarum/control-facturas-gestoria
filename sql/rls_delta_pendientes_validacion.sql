-- =============================================================================
-- RLS Delta — Aviso Supabase: pendientes_validacion + proveedores_seguro
-- =============================================================================
-- Fecha: 2026-04-15
--
-- CONTEXTO:
-- Supabase ha marcado dos entidades sin RLS correcto:
--   1) pendientes_validacion  → TABLA nueva (no estaba en rls_seguridad.sql original)
--   2) proveedores_seguro     → VIEW (SECURITY DEFINER por defecto, bypassa RLS)
--
-- Recordatorio arquitectónico:
--   - El backend se conecta como rol postgres/service_role → bypassa RLS siempre.
--   - Las políticas "TO authenticated" son defensa en profundidad contra el
--     endpoint PostgREST de Supabase (API REST expuesta con anon key).
--   - La app NO usa Supabase Auth; por eso authenticated nunca coincide desde
--     la app (se conecta como postgres). La defensa real es "RLS activado sin
--     políticas que cubran a anon" → PostgREST devuelve vacío a anon.
--
-- EJECUCIÓN:
-- SQL Editor de Supabase Dashboard (dev primero: fothahxvwswlmnkssjqf).
-- Idempotente: se puede ejecutar múltiples veces sin errores.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. TABLA: pendientes_validacion
-- =============================================================================
-- Cuarentena de facturas con CIF receptor desconocido. Contiene datos_extraidos
-- (JSONB con info sensible de facturas) y cif_receptor.
-- Patrón: mismo que drive_archivos — admin total, gestoría no accede
-- (la validación es tarea de admin cuando el CIF no coincide con ninguna empresa).

ALTER TABLE pendientes_validacion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pendientes_val_select_admin ON pendientes_validacion;
CREATE POLICY pendientes_val_select_admin ON pendientes_validacion
  FOR SELECT TO authenticated
  USING (es_admin());

DROP POLICY IF EXISTS pendientes_val_insert_admin ON pendientes_validacion;
CREATE POLICY pendientes_val_insert_admin ON pendientes_validacion
  FOR INSERT TO authenticated
  WITH CHECK (es_admin());

DROP POLICY IF EXISTS pendientes_val_update_admin ON pendientes_validacion;
CREATE POLICY pendientes_val_update_admin ON pendientes_validacion
  FOR UPDATE TO authenticated
  USING (es_admin())
  WITH CHECK (es_admin());

DROP POLICY IF EXISTS pendientes_val_delete_admin ON pendientes_validacion;
CREATE POLICY pendientes_val_delete_admin ON pendientes_validacion
  FOR DELETE TO authenticated
  USING (es_admin());

-- Revocar acceso directo al rol anon (defensa en profundidad)
REVOKE ALL ON pendientes_validacion FROM anon;

-- =============================================================================
-- 2. VIEW: proveedores_seguro (y empresas_seguro por consistencia)
-- =============================================================================
-- El aviso de Supabase sobre "RLS en vista" se debe a que las vistas en
-- PostgreSQL se ejecutan por defecto como SECURITY DEFINER (permisos del
-- creador → postgres, que bypassa RLS). Esto significa que si un usuario
-- con rol anon/authenticated consulta la vista vía PostgREST, ve TODO.
--
-- Fix (PostgreSQL 15+): security_invoker=true → la vista usa los permisos
-- del caller, respetando el RLS de la tabla subyacente (proveedores, empresas).

ALTER VIEW proveedores_seguro SET (security_invoker = true);
ALTER VIEW empresas_seguro    SET (security_invoker = true);

-- Adicionalmente, revocar acceso anon a las vistas si no se usan públicamente
REVOKE ALL ON proveedores_seguro FROM anon;
REVOKE ALL ON empresas_seguro    FROM anon;

-- =============================================================================
-- 3. VERIFICACIÓN
-- =============================================================================
-- Tras ejecutar, comprobar en Supabase Dashboard → Database → Tables:
--   - pendientes_validacion aparece con el icono de RLS activo (candado verde)
--   - Linter de Supabase (Database → Advisors) no debería listar ni la tabla
--     ni las vistas como issues.

COMMIT;

-- =============================================================================
-- CHECKLIST POST-EJECUCIÓN
-- =============================================================================
-- [ ] Ejecutar en Supabase DEV (fothahxvwswlmnkssjqf)
-- [ ] Verificar que la app en dev sigue funcionando (flujo: sync → extracción
--     → validación pendiente → aceptar/rechazar en /validacion)
-- [ ] Verificar que el Advisor de Supabase ya no reporta las alertas
-- [ ] Ejecutar en Supabase PROD (drjdkcfygevlnrvzgzan)
-- [ ] Verificar flujo en producción
