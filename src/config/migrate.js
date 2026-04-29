const { getDb } = require('./database');
const logger = require('./logger');
const { PROMPT_DEFAULT, PROMPT_DEFAULT_V1 } = require('../services/extractorService');

// ─── Schema ───────────────────────────────────────────────────────────────────

const tablas = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id            SERIAL PRIMARY KEY,
    nombre        TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE,
    rol           TEXT    NOT NULL DEFAULT 'admin',
    password_hash TEXT,
    activo        INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS facturas (
    id              SERIAL PRIMARY KEY,
    numero          TEXT    NOT NULL UNIQUE,
    descripcion     TEXT,
    importe         REAL    NOT NULL,
    fecha_emision   TEXT    NOT NULL,
    estado          TEXT    NOT NULL DEFAULT 'PENDIENTE',
    archivo_nombre  TEXT,
    archivo_ruta    TEXT,
    subida_por      INTEGER NOT NULL REFERENCES usuarios(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS tokens_acceso (
    id          SERIAL PRIMARY KEY,
    token       TEXT    NOT NULL UNIQUE,
    factura_id  INTEGER NOT NULL REFERENCES facturas(id),
    usado       INTEGER NOT NULL DEFAULT 0,
    expira_at   TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS logs_auditoria (
    id          SERIAL PRIMARY KEY,
    evento      TEXT    NOT NULL,
    factura_id  INTEGER REFERENCES facturas(id),
    usuario_id  INTEGER REFERENCES usuarios(id),
    ip          TEXT    NOT NULL,
    user_agent  TEXT,
    token_usado TEXT,
    detalle     TEXT,
    timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS drive_archivos (
    id                SERIAL PRIMARY KEY,
    google_id         TEXT    NOT NULL UNIQUE,
    nombre_archivo    TEXT    NOT NULL,
    ruta_completa     TEXT    NOT NULL,
    proveedor         TEXT,
    fecha_subida      TEXT,
    estado            TEXT    NOT NULL DEFAULT 'PENDIENTE',
    estado_gestion    TEXT    NOT NULL DEFAULT 'PENDIENTE',
    datos_extraidos   TEXT,
    error_extraccion  TEXT,
    procesado_at      TIMESTAMPTZ,
    ultima_sync       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS configuracion (
    clave      TEXT PRIMARY KEY,
    valor      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS configuracion_sistema (
    clave      TEXT PRIMARY KEY,
    valor      TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS historial_sincronizaciones (
    id               SERIAL PRIMARY KEY,
    origen           TEXT    NOT NULL DEFAULT 'MANUAL',
    fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    estado           TEXT    NOT NULL DEFAULT 'OK',
    facturas_nuevas  INTEGER NOT NULL DEFAULT 0,
    facturas_error   INTEGER NOT NULL DEFAULT 0,
    duracion_ms      INTEGER,
    detalle          TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS historial_notificaciones (
    id            SERIAL PRIMARY KEY,
    fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    origen        TEXT    NOT NULL DEFAULT 'MANUAL',
    asunto        TEXT,
    destinatarios TEXT,
    enviados      INTEGER NOT NULL DEFAULT 0,
    errores       INTEGER NOT NULL DEFAULT 0,
    respuesta_mj  TEXT,
    detalle       TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS historial_conciliaciones (
    id              SERIAL PRIMARY KEY,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    proveedor       TEXT NOT NULL,
    fecha_desde     TEXT,
    fecha_hasta     TEXT,
    total           INTEGER NOT NULL DEFAULT 0,
    ok              INTEGER NOT NULL DEFAULT 0,
    pendientes_sage INTEGER NOT NULL DEFAULT 0,
    error_importe   INTEGER NOT NULL DEFAULT 0,
    resultado_json  JSONB NOT NULL,
    usuario_id      INTEGER REFERENCES usuarios(id),
    usuario_nombre  TEXT
  )`,

  // Columnas de usuario añadidas a posteriori (idempotentes)
  `ALTER TABLE historial_conciliaciones ADD COLUMN IF NOT EXISTS usuario_id     INTEGER REFERENCES usuarios(id)`,
  `ALTER TABLE historial_conciliaciones ADD COLUMN IF NOT EXISTS usuario_nombre TEXT`,

  // ─── MULTIEMPRESA ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS empresas (
    id          SERIAL PRIMARY KEY,
    nombre      TEXT NOT NULL,
    cif         TEXT NOT NULL UNIQUE,
    direccion   TEXT,
    telefono    TEXT,
    email       TEXT,
    web         TEXT,
    activo      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS direccion TEXT`,
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS telefono TEXT`,
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS web TEXT`,
  `CREATE TABLE IF NOT EXISTS proveedor_empresa (
    id                 SERIAL PRIMARY KEY,
    proveedor_id       INTEGER NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
    empresa_id         INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    cuenta_contable_id INTEGER REFERENCES plan_contable(id),
    cuenta_gasto_id    INTEGER REFERENCES plan_contable(id),
    ultimo_asiento_sage INTEGER,
    UNIQUE(proveedor_id, empresa_id)
  )`,
  `CREATE TABLE IF NOT EXISTS usuario_empresa (
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    empresa_id  INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, empresa_id)
  )`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)`,
  `ALTER TABLE plan_contable ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)`,
  `ALTER TABLE lotes_exportacion_sage ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)`,
  `ALTER TABLE historial_conciliaciones ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)`,
  `ALTER TABLE historial_sincronizaciones ADD COLUMN IF NOT EXISTS empresa_id INTEGER REFERENCES empresas(id)`,

  // Exportación SAGE: historial de lotes y control de duplicados
  `CREATE TABLE IF NOT EXISTS lotes_exportacion_sage (
    id               SERIAL PRIMARY KEY,
    fecha            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    nombre_fichero   TEXT NOT NULL,
    num_facturas     INTEGER NOT NULL DEFAULT 0,
    asiento_inicio   INTEGER NOT NULL DEFAULT 1,
    asiento_fin      INTEGER NOT NULL DEFAULT 1,
    contenido_csv    TEXT,
    usuario_id       INTEGER REFERENCES usuarios(id),
    usuario_nombre   TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sage_facturas_exportadas (
    id               SERIAL PRIMARY KEY,
    lote_id          INTEGER NOT NULL REFERENCES lotes_exportacion_sage(id) ON DELETE CASCADE,
    factura_id       INTEGER NOT NULL REFERENCES drive_archivos(id) ON DELETE CASCADE,
    cif_emisor       TEXT,
    numero_factura   TEXT,
    UNIQUE(cif_emisor, numero_factura)
  )`,
  `ALTER TABLE lotes_exportacion_sage ADD COLUMN IF NOT EXISTS contenido_txt TEXT`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS lote_sage_id INTEGER REFERENCES lotes_exportacion_sage(id)`,

  // Último asiento SAGE por proveedor
  `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS ultimo_asiento_sage INTEGER`,

  // Campos SII para SAGE R75 (pos 117 TipoClave, pos 120 TipoFact).
  // En proveedores: defaults 1/1 = regimen general + F1 ordinaria (caso normal español).
  // En drive_archivos: nullable; NULL = heredar del proveedor, valor explicito = override por factura.
  `ALTER TABLE proveedores    ADD COLUMN IF NOT EXISTS sii_tipo_clave SMALLINT NOT NULL DEFAULT 1`,
  `ALTER TABLE proveedores    ADD COLUMN IF NOT EXISTS sii_tipo_fact  SMALLINT NOT NULL DEFAULT 1`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS sii_tipo_clave SMALLINT`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS sii_tipo_fact  SMALLINT`,

  // Campos SII adicionales R75 (pos 118 TipoExenci, pos 119 TipoNoSuje,
  // pos 123 TipoRectif, pos 126 nEntrPrest). Mismo patron override:
  // proveedor NOT NULL con default = valor tipico de facturas de proveedor de servicios;
  // drive_archivos nullable para override por factura.
  //
  // Default de sii_tipo_rectif=2 ("por diferencias"): solo aplica cuando la
  // factura esta marcada como rectificativa. Si es_rectificativa=false el
  // exportador fuerza pos 123 = 1 (defensa en profundidad, ver commit 3).
  //
  // sii_decrecen (pos 127 Decrecen) NO se parametriza: siempre vale la fecha
  // del asiento; se calcula en el exportador.
  `ALTER TABLE proveedores    ADD COLUMN IF NOT EXISTS sii_tipo_exenci  SMALLINT NOT NULL DEFAULT 1`,
  // Defaults sii_tipo_no_suje=1 y sii_entr_prest=1: replican el "vacio logico" que
  // ContaPlus Flex emite en alta manual de operacion normal (confirmado 2026-04-29).
  // Defaults antiguos 2/3 (recomendados por el manual R75) se cambiaron porque
  // ContaPlus en la practica no los marca asi. Los proveedores existentes con
  // 2/3 se actualizan via UPDATE retroactivo manual en el SQL Editor de Supabase.
  `ALTER TABLE proveedores    ADD COLUMN IF NOT EXISTS sii_tipo_no_suje SMALLINT NOT NULL DEFAULT 1`,
  `ALTER TABLE proveedores    ADD COLUMN IF NOT EXISTS sii_tipo_rectif  SMALLINT NOT NULL DEFAULT 2`,
  `ALTER TABLE proveedores    ADD COLUMN IF NOT EXISTS sii_entr_prest   SMALLINT NOT NULL DEFAULT 1`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS sii_tipo_exenci  SMALLINT`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS sii_tipo_no_suje SMALLINT`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS sii_tipo_rectif  SMALLINT`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS sii_entr_prest   SMALLINT`,

  // Soporte facturas rectificativas (SAGE R75 pos 33-38 + 128 + flag pos 37).
  // es_rectificativa: flag propio de la factura. Cuando true, el exportador rellena
  //   Rectifica (pos 37) = .T., mapea TipoFact (pos 120) F1→R1 / F2→R5 y permite
  //   forzar R2/R3/R4 via override sii_tipo_fact nivel factura.
  // rect_serie/numero/fecha/base_imp: datos de la factura original rectificada
  //   (opcionales — muchos proveedores no los proporcionan y el SII acepta rectificativas
  //   "por diferencias" sin referencia a la original).
  // Estos 5 campos viven SIEMPRE como columnas (nunca dentro de datos_extraidos)
  // para evitar divergencia entre extraccion Gemini y ediciones manuales del usuario.
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS es_rectificativa BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS rect_serie       VARCHAR(1)`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS rect_numero      VARCHAR(40)`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS rect_fecha       DATE`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS rect_base_imp    NUMERIC(14,2)`,

  // Indices y restricciones
  `CREATE INDEX IF NOT EXISTS idx_proveedores_cif ON proveedores (UPPER(TRIM(cif))) WHERE activo = true AND cif IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_proveedores_carpeta ON proveedores (nombre_carpeta) WHERE activo = true AND nombre_carpeta IS NOT NULL`,
  // Unicidad de nombre_carpeta: se valida en el codigo (POST/PUT/rapido)
  // No se usa indice UNIQUE porque puede haber datos historicos duplicados
  `CREATE INDEX IF NOT EXISTS idx_drive_estado_gestion ON drive_archivos (estado_gestion)`,

  // Duplicados: columna en historial de sincronizaciones
  `ALTER TABLE historial_sincronizaciones ADD COLUMN IF NOT EXISTS facturas_duplicadas INTEGER NOT NULL DEFAULT 0`,

  // Conciliación: vínculos manuales (memoria entre ejecuciones)
  `CREATE TABLE IF NOT EXISTS conciliacion_vinculos_manuales (
    id               SERIAL PRIMARY KEY,
    factura_id       INTEGER NOT NULL REFERENCES drive_archivos(id) ON DELETE CASCADE,
    mayor_fecha      TEXT NOT NULL,
    mayor_documento  TEXT,
    mayor_concepto   TEXT,
    mayor_importe    NUMERIC(12,2),
    cuenta_mayor     TEXT,
    usuario_id       INTEGER REFERENCES usuarios(id),
    usuario_nombre   TEXT,
    creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(factura_id, cuenta_mayor, mayor_fecha, mayor_importe)
  )`,

  // Conciliación v2: columnas adicionales
  `ALTER TABLE historial_conciliaciones ADD COLUMN IF NOT EXISTS version TEXT NOT NULL DEFAULT 'v1'`,
  `ALTER TABLE historial_conciliaciones ADD COLUMN IF NOT EXISTS alcance TEXT`,
  `ALTER TABLE historial_conciliaciones ADD COLUMN IF NOT EXISTS num_proveedores INTEGER DEFAULT 1`,
  `ALTER TABLE historial_conciliaciones ADD COLUMN IF NOT EXISTS conciliadas_manual INTEGER NOT NULL DEFAULT 0`,

  // Estado SINCRONIZADA: nueva columna default (idempotente)
  `ALTER TABLE drive_archivos ALTER COLUMN estado SET DEFAULT 'SINCRONIZADA'`,

  `CREATE TABLE IF NOT EXISTS conciliacion_lineas_estado (
    id              SERIAL PRIMARY KEY,
    conciliacion_id INTEGER NOT NULL REFERENCES historial_conciliaciones(id) ON DELETE CASCADE,
    linea_idx       INTEGER NOT NULL,
    numero_factura  TEXT,
    estado_revision TEXT NOT NULL DEFAULT 'PENDIENTE',
    usuario_id      INTEGER REFERENCES usuarios(id),
    usuario_nombre  TEXT,
    actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(conciliacion_id, linea_idx)
  )`,

  `CREATE TABLE IF NOT EXISTS conciliacion_lineas_historial (
    id              SERIAL PRIMARY KEY,
    conciliacion_id INTEGER NOT NULL,
    linea_idx       INTEGER NOT NULL,
    numero_factura  TEXT,
    estado_anterior TEXT,
    estado_nuevo    TEXT NOT NULL,
    usuario_id      INTEGER REFERENCES usuarios(id),
    usuario_nombre  TEXT,
    creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS plan_contable (
    id          SERIAL PRIMARY KEY,
    codigo      TEXT NOT NULL UNIQUE,
    descripcion TEXT NOT NULL,
    grupo       TEXT NOT NULL,
    activo      BOOLEAN NOT NULL DEFAULT true
  )`,

  `CREATE TABLE IF NOT EXISTS proveedores (
    id                 SERIAL PRIMARY KEY,
    razon_social       TEXT NOT NULL,
    nombre_carpeta     TEXT,
    cif                TEXT,
    cuenta_contable_id INTEGER REFERENCES plan_contable(id),
    cuenta_gasto_id    INTEGER REFERENCES plan_contable(id),
    activo             BOOLEAN NOT NULL DEFAULT true,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS cuenta_contable_id INTEGER REFERENCES plan_contable(id)`,
  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS cuenta_gasto_id INTEGER REFERENCES plan_contable(id)`,

  `CREATE TABLE IF NOT EXISTS roles (
    id          SERIAL PRIMARY KEY,
    nombre      TEXT NOT NULL UNIQUE,
    descripcion TEXT,
    es_builtin  BOOLEAN NOT NULL DEFAULT false,
    activo      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS rol_permisos (
    rol_id  INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    recurso TEXT NOT NULL,
    nivel   TEXT NOT NULL DEFAULT 'none',
    PRIMARY KEY (rol_id, recurso)
  )`,

  `CREATE TABLE IF NOT EXISTS lotes_exportacion_a3 (
    id             SERIAL PRIMARY KEY,
    fecha          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usuario_id     INTEGER REFERENCES usuarios(id),
    usuario_nombre TEXT,
    nombre_fichero TEXT NOT NULL,
    num_facturas   INTEGER NOT NULL DEFAULT 0,
    total_base     NUMERIC,
    total_cuota    NUMERIC,
    total_factura  NUMERIC,
    ids_facturas   JSONB NOT NULL DEFAULT '[]',
    contenido_csv  TEXT NOT NULL
  )`,

  `ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS lote_a3_id INTEGER REFERENCES lotes_exportacion_a3(id)`,

  // Índices
  `CREATE INDEX IF NOT EXISTS idx_logs_factura    ON logs_auditoria(factura_id)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_evento     ON logs_auditoria(evento)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_timestamp  ON logs_auditoria(timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_tokens_token    ON tokens_acceso(token)`,
  `CREATE INDEX IF NOT EXISTS idx_drive_estado    ON drive_archivos(estado)`,
  `CREATE INDEX IF NOT EXISTS idx_drive_proveedor ON drive_archivos(proveedor)`,

  // ─── Conversaciones del chat ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS chat_conversaciones (
    id          SERIAL PRIMARY KEY,
    usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
    agente_id   TEXT    NOT NULL,
    titulo      TEXT,
    origen      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS chat_mensajes (
    id                SERIAL PRIMARY KEY,
    conversacion_id   INTEGER NOT NULL REFERENCES chat_conversaciones(id) ON DELETE CASCADE,
    role              TEXT    NOT NULL,
    content           TEXT    NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  `CREATE INDEX IF NOT EXISTS idx_chat_conv_usuario ON chat_conversaciones(usuario_id, agente_id)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_msg_conv     ON chat_mensajes(conversacion_id)`,

  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS chat_bloqueado BOOLEAN NOT NULL DEFAULT false`,

  // Índice para acelerar LATERAL JOIN de proveedores por CIF normalizado
  `CREATE INDEX IF NOT EXISTS idx_prov_cif_norm ON proveedores (normalizar_cif(cif)) WHERE cif IS NOT NULL AND activo = true`,
  `CREATE INDEX IF NOT EXISTS idx_drive_estado_gestion ON drive_archivos(estado_gestion, empresa_id)`,
  `ALTER TABLE chat_conversaciones ADD COLUMN IF NOT EXISTS oculta BOOLEAN NOT NULL DEFAULT false`,

  // ─── Cuarentena de facturas con CIF receptor desconocido ─────────────────
  `CREATE TABLE IF NOT EXISTS pendientes_validacion (
    id               SERIAL PRIMARY KEY,
    cif_receptor     TEXT NOT NULL,
    nombre_receptor  TEXT,
    drive_archivo_id INTEGER REFERENCES drive_archivos(id) ON DELETE CASCADE,
    datos_extraidos  JSONB NOT NULL DEFAULT '{}',
    google_id        TEXT,
    nombre_archivo   TEXT,
    proveedor        TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_pendientes_val_cif ON pendientes_validacion(cif_receptor)`,
];

// ─── Seeds ────────────────────────────────────────────────────────────────────

const usuariosSeed = [
  // Usuarios de demo eliminados — los usuarios se crean desde la UI
];

const confDefaults = {
  sync_activo:       'true',
  sync_frecuencia:   'diaria',
  sync_hora:         '08:00',
  notify_activo:     'false',
  notify_frecuencia: 'diaria',
  notify_hora:       '09:00',
  notify_app_url:    'http://localhost:5173',
  email_asunto:      '{{total}} factura{{s}} pendiente{{s}} de revisar',
  email_cuerpo:      'Tienes {{total}} factura{{s}} pendiente{{s}} de revisar en el sistema de Control de Facturas.',
  email_remitente:   '',
};

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runMigrations() {
  const db = getDb();

  // Crear tablas e índices
  for (const sql of tablas) {
    await db.query(sql);
  }

  // Función para normalizar CIF: quita caracteres no alfanuméricos (guiones, puntos, espacios)
  // y luego quita prefijo de país de 2 letras si lo tiene
  await db.query(`
    CREATE OR REPLACE FUNCTION normalizar_cif(cif TEXT)
    RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
      SELECT CASE
        WHEN REGEXP_REPLACE(UPPER(TRIM(cif)), '[^A-Z0-9]', '', 'g') ~ '^[A-Z]{2}[A-Z0-9]'
        THEN SUBSTRING(REGEXP_REPLACE(UPPER(TRIM(cif)), '[^A-Z0-9]', '', 'g') FROM 3)
        ELSE REGEXP_REPLACE(UPPER(TRIM(cif)), '[^A-Z0-9]', '', 'g')
      END
    $$
  `);

  // Seed usuarios
  for (const u of usuariosSeed) {
    await db.query(
      `INSERT INTO usuarios (nombre, email, rol, activo)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (email) DO NOTHING`,
      [u.nombre, u.email, u.rol]
    );
  }

  // Seed configuracion_sistema
  for (const [clave, valor] of Object.entries(confDefaults)) {
    await db.query(
      `INSERT INTO configuracion_sistema (clave, valor)
       VALUES ($1, $2)
       ON CONFLICT (clave) DO NOTHING`,
      [clave, valor]
    );
  }

  // Seed plan contable (solo inserta si la tabla está vacía)
  const yaSeeded = await db.one('SELECT COUNT(*) as n FROM plan_contable');
  if (parseInt(yaSeeded.n) === 0) {
    const cuentas = [
      { codigo: '400',  descripcion: 'Proveedores',                                        grupo: '4' },
      { codigo: '4000', descripcion: 'Proveedores (euros)',                                grupo: '4' },
      { codigo: '401',  descripcion: 'Proveedores, efectos comerciales a pagar',           grupo: '4' },
      { codigo: '404',  descripcion: 'Proveedores de inmovilizado a largo plazo',          grupo: '4' },
      { codigo: '405',  descripcion: 'Proveedores de inmovilizado a corto plazo',          grupo: '4' },
      { codigo: '407',  descripcion: 'Anticipos a proveedores',                            grupo: '4' },
      { codigo: '410',  descripcion: 'Acreedores por prestaciones de servicios',           grupo: '4' },
      { codigo: '411',  descripcion: 'Acreedores, efectos comerciales a pagar',            grupo: '4' },
      { codigo: '472',  descripcion: 'Hacienda Pública, IVA soportado',                    grupo: '4' },
      { codigo: '473',  descripcion: 'Hacienda Pública, retenciones y pagos a cuenta',    grupo: '4' },
      { codigo: '477',  descripcion: 'Hacienda Pública, IVA repercutido',                  grupo: '4' },
      // Grupo 2 — Inmovilizado (activos que pueden aparecer en facturas)
      { codigo: '200',  descripcion: 'Investigación',                                      grupo: '2' },
      { codigo: '201',  descripcion: 'Desarrollo',                                         grupo: '2' },
      { codigo: '202',  descripcion: 'Concesiones administrativas',                        grupo: '2' },
      { codigo: '203',  descripcion: 'Propiedad industrial',                               grupo: '2' },
      { codigo: '205',  descripcion: 'Derechos de traspaso',                               grupo: '2' },
      { codigo: '206',  descripcion: 'Aplicaciones informáticas',                          grupo: '2' },
      { codigo: '210',  descripcion: 'Terrenos y bienes naturales',                        grupo: '2' },
      { codigo: '211',  descripcion: 'Construcciones',                                     grupo: '2' },
      { codigo: '212',  descripcion: 'Instalaciones técnicas',                             grupo: '2' },
      { codigo: '213',  descripcion: 'Maquinaria',                                         grupo: '2' },
      { codigo: '214',  descripcion: 'Utillaje',                                           grupo: '2' },
      { codigo: '215',  descripcion: 'Otras instalaciones',                                grupo: '2' },
      { codigo: '216',  descripcion: 'Mobiliario',                                         grupo: '2' },
      { codigo: '217',  descripcion: 'Equipos para procesos de información',               grupo: '2' },
      { codigo: '218',  descripcion: 'Elementos de transporte',                            grupo: '2' },
      { codigo: '219',  descripcion: 'Otro inmovilizado material',                         grupo: '2' },
      // Grupo 6 — Gastos de explotación
      { codigo: '600',  descripcion: 'Compras de mercaderías',                             grupo: '6' },
      { codigo: '601',  descripcion: 'Compras de materias primas',                         grupo: '6' },
      { codigo: '602',  descripcion: 'Compras de otros aprovisionamientos',                grupo: '6' },
      { codigo: '606',  descripcion: 'Descuentos sobre compras por pronto pago',           grupo: '6' },
      { codigo: '608',  descripcion: 'Devoluciones de compras y operaciones similares',    grupo: '6' },
      { codigo: '609',  descripcion: 'Rappels por compras',                                grupo: '6' },
      { codigo: '621',  descripcion: 'Arrendamientos y cánones',                           grupo: '6' },
      { codigo: '622',  descripcion: 'Reparaciones y conservación',                        grupo: '6' },
      { codigo: '623',  descripcion: 'Servicios de profesionales independientes',          grupo: '6' },
      { codigo: '624',  descripcion: 'Transportes',                                        grupo: '6' },
      { codigo: '625',  descripcion: 'Primas de seguros',                                  grupo: '6' },
      { codigo: '626',  descripcion: 'Servicios bancarios y similares',                    grupo: '6' },
      { codigo: '627',  descripcion: 'Publicidad, propaganda y relaciones públicas',       grupo: '6' },
      { codigo: '628',  descripcion: 'Suministros',                                        grupo: '6' },
      { codigo: '629',  descripcion: 'Otros servicios',                                    grupo: '6' },
      { codigo: '631',  descripcion: 'Otros tributos',                                     grupo: '6' },
      { codigo: '640',  descripcion: 'Sueldos y salarios',                                 grupo: '6' },
      { codigo: '641',  descripcion: 'Indemnizaciones',                                    grupo: '6' },
      { codigo: '642',  descripcion: 'Seguridad Social a cargo de la empresa',             grupo: '6' },
    ];
    for (const c of cuentas) {
      await db.query(
        'INSERT INTO plan_contable (codigo, descripcion, grupo) VALUES ($1, $2, $3) ON CONFLICT (codigo) DO NOTHING',
        [c.codigo, c.descripcion, c.grupo]
      );
    }
  }

  // Asegurar cuentas grupo 2 (inversiones/inmovilizado) en bases existentes
  const cuentasGrupo2 = [
    { codigo: '200', descripcion: 'Investigación',                        grupo: '2' },
    { codigo: '201', descripcion: 'Desarrollo',                           grupo: '2' },
    { codigo: '202', descripcion: 'Concesiones administrativas',          grupo: '2' },
    { codigo: '203', descripcion: 'Propiedad industrial',                 grupo: '2' },
    { codigo: '205', descripcion: 'Derechos de traspaso',                 grupo: '2' },
    { codigo: '206', descripcion: 'Aplicaciones informáticas',            grupo: '2' },
    { codigo: '210', descripcion: 'Terrenos y bienes naturales',          grupo: '2' },
    { codigo: '211', descripcion: 'Construcciones',                       grupo: '2' },
    { codigo: '212', descripcion: 'Instalaciones técnicas',               grupo: '2' },
    { codigo: '213', descripcion: 'Maquinaria',                           grupo: '2' },
    { codigo: '214', descripcion: 'Utillaje',                             grupo: '2' },
    { codigo: '215', descripcion: 'Otras instalaciones',                  grupo: '2' },
    { codigo: '216', descripcion: 'Mobiliario',                           grupo: '2' },
    { codigo: '217', descripcion: 'Equipos para procesos de información', grupo: '2' },
    { codigo: '218', descripcion: 'Elementos de transporte',              grupo: '2' },
    { codigo: '219', descripcion: 'Otro inmovilizado material',           grupo: '2' },
  ];
  for (const c of cuentasGrupo2) {
    await db.query(
      'INSERT INTO plan_contable (codigo, descripcion, grupo) VALUES ($1, $2, $3) ON CONFLICT (codigo) DO NOTHING',
      [c.codigo, c.descripcion, c.grupo]
    );
  }

  // Seed roles built-in
  await db.query(`
    INSERT INTO roles (nombre, descripcion, es_builtin) VALUES
      ('ADMIN',    'Administrador del sistema', true),
      ('GESTORIA', 'Usuario de gestoría',       true)
    ON CONFLICT (nombre) DO NOTHING
  `);

  const RECURSOS = ['facturas','conciliacion','historial','proveedores','usuarios','configuracion','aplicar_cuentas'];

  // ADMIN: todo → edit
  for (const recurso of RECURSOS) {
    await db.query(
      `INSERT INTO rol_permisos (rol_id, recurso, nivel)
       SELECT id, $1, 'edit' FROM roles WHERE nombre = 'ADMIN'
       ON CONFLICT (rol_id, recurso) DO NOTHING`,
      [recurso]
    );
  }

  // GESTORIA: permisos por defecto
  const gestoriaPerms = {
    facturas:        'edit',
    conciliacion:    'read',
    historial:       'read',
    proveedores:     'none',
    usuarios:        'none',
    configuracion:   'none',
    aplicar_cuentas: 'edit',
  };
  for (const [recurso, nivel] of Object.entries(gestoriaPerms)) {
    await db.query(
      `INSERT INTO rol_permisos (rol_id, recurso, nivel)
       SELECT id, $1, $2 FROM roles WHERE nombre = 'GESTORIA'
       ON CONFLICT (rol_id, recurso) DO NOTHING`,
      [recurso, nivel]
    );
  }

  // Migración de datos: renombrar PENDIENTE → SINCRONIZADA
  // Las facturas en PENDIENTE son archivos que llegaron por sync pero aún
  // no pasaron por Gemini; el nuevo estado equivalente es SINCRONIZADA.
  await db.query(
    "UPDATE drive_archivos SET estado = 'SINCRONIZADA' WHERE estado = 'PENDIENTE'"
  );

  // ─── Seed empresas ──────────────────────────────────────────────────────────
  const empresasSeed = [
    { nombre: 'Scholarum Digital SL', cif: 'B86610821', direccion: 'C/ Alcala 518, 28027 Madrid', telefono: '911 231 089', email: 'admin@scholarum.es', web: 'https://scholarum.es' },
    { nombre: 'Laredo Tech SL',      cif: 'B19822352', direccion: 'C/ Alcala 518, 28027 Madrid', telefono: '911 231 089', email: 'admin@laredotech.com', web: 'https://laredotech.com' },
  ];
  for (const e of empresasSeed) {
    await db.query(
      `INSERT INTO empresas (nombre, cif, direccion, telefono, email, web)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cif) DO UPDATE SET
         direccion = COALESCE(EXCLUDED.direccion, empresas.direccion),
         telefono  = COALESCE(EXCLUDED.telefono, empresas.telefono),
         email     = COALESCE(EXCLUDED.email, empresas.email),
         web       = COALESCE(EXCLUDED.web, empresas.web)`,
      [e.nombre, e.cif, e.direccion, e.telefono, e.email, e.web]
    );
  }

  // Migrar datos existentes a multiempresa (una sola vez)
  // 1. Asignar empresa_id a plan_contable existente (Scholarum por defecto)
  await db.query(`
    UPDATE plan_contable SET empresa_id = (SELECT id FROM empresas WHERE cif = 'B86610821' LIMIT 1)
    WHERE empresa_id IS NULL
  `);
  // 2. Mover cuentas de proveedores a proveedor_empresa para la empresa por defecto
  await db.query(`
    INSERT INTO proveedor_empresa (proveedor_id, empresa_id, cuenta_contable_id, cuenta_gasto_id, ultimo_asiento_sage)
    SELECT p.id, (SELECT id FROM empresas WHERE cif = 'B86610821' LIMIT 1),
           p.cuenta_contable_id, p.cuenta_gasto_id, p.ultimo_asiento_sage
    FROM proveedores p
    WHERE p.activo = true AND (p.cuenta_contable_id IS NOT NULL OR p.cuenta_gasto_id IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM proveedor_empresa pe
        WHERE pe.proveedor_id = p.id AND pe.empresa_id = (SELECT id FROM empresas WHERE cif = 'B86610821' LIMIT 1)
      )
  `);
  // 3. Asignar empresa_id a facturas existentes por CIF receptor
  await db.query(`
    UPDATE drive_archivos da SET empresa_id = e.id
    FROM empresas e
    WHERE da.empresa_id IS NULL
      AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
      AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_receptor') = normalizar_cif(e.cif)
  `);
  // 4. Facturas sin empresa: crear empresas al vuelo por CIF receptor
  await db.query(`
    INSERT INTO empresas (nombre, cif)
    SELECT DISTINCT
      COALESCE(NULLIF(TRIM((da.datos_extraidos::jsonb)->>'nombre_receptor'), ''), 'Empresa ' || UPPER(TRIM((da.datos_extraidos::jsonb)->>'cif_receptor'))),
      UPPER(TRIM((da.datos_extraidos::jsonb)->>'cif_receptor'))
    FROM drive_archivos da
    WHERE da.empresa_id IS NULL
      AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
      AND (da.datos_extraidos::jsonb)->>'cif_receptor' IS NOT NULL
      AND TRIM((da.datos_extraidos::jsonb)->>'cif_receptor') <> ''
      AND NOT EXISTS (SELECT 1 FROM empresas e WHERE normalizar_cif(e.cif) = normalizar_cif((da.datos_extraidos::jsonb)->>'cif_receptor'))
    ON CONFLICT (cif) DO NOTHING
  `);
  // Reasignar facturas a las empresas recien creadas
  await db.query(`
    UPDATE drive_archivos da SET empresa_id = e.id
    FROM empresas e
    WHERE da.empresa_id IS NULL
      AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
      AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_receptor') = normalizar_cif(e.cif)
  `);
  // 5. Historiales sin empresa_id → asignar a Scholarum
  await db.query(`
    UPDATE lotes_exportacion_sage SET empresa_id = (SELECT id FROM empresas WHERE cif = 'B86610821' LIMIT 1)
    WHERE empresa_id IS NULL
  `);
  await db.query(`
    UPDATE historial_conciliaciones SET empresa_id = (SELECT id FROM empresas WHERE cif = 'B86610821' LIMIT 1)
    WHERE empresa_id IS NULL
  `);
  // 6. Asignar usuarios ADMIN a todas las empresas
  await db.query(`
    INSERT INTO usuario_empresa (usuario_id, empresa_id)
    SELECT u.id, e.id FROM usuarios u CROSS JOIN empresas e
    WHERE u.activo = 1 AND e.activo = true
    ON CONFLICT DO NOTHING
  `);

  // historial_sincronizaciones es global (no se filtra por empresa)

  // ─── Auto-healing columnas de rectificativa ─────────────────────────────────
  // Garantizamos que las 5 columnas del soporte rectificativas existen. Si alguna
  // no se creo en el bucle de ALTER de arriba (por un deploy parcial, error
  // transitorio, o lo que sea), la creamos aqui explicitamente con log. Idempotente.
  const RECT_COLS = {
    es_rectificativa: 'BOOLEAN NOT NULL DEFAULT FALSE',
    rect_serie:       'VARCHAR(1)',
    rect_numero:      'VARCHAR(40)',
    rect_fecha:       'DATE',
    rect_base_imp:    'NUMERIC(14,2)',
  };
  const colsActuales = await db.all(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'drive_archivos'
       AND column_name = ANY($1::text[])`,
    [Object.keys(RECT_COLS)]
  );
  const presentes = new Set(colsActuales.map(r => r.column_name));
  const faltantes = Object.keys(RECT_COLS).filter(c => !presentes.has(c));
  if (faltantes.length) {
    logger.warn({ faltantes }, '[MIGRATION] Columnas de rectificativa faltantes tras ALTER en bucle, reintentando explicitamente');
    for (const col of faltantes) {
      await db.query(`ALTER TABLE drive_archivos ADD COLUMN IF NOT EXISTS ${col} ${RECT_COLS[col]}`);
      logger.info({ columna: col }, '[MIGRATION] Columna de rectificativa creada (auto-healing)');
    }
  }

  // ─── Migracion idempotente: prompt Gemini V1 → V2 ───────────────────────────
  // El V2 anyade deteccion de rectificativas. Si el prompt en BD coincide
  // byte-a-byte con V1, se actualiza automaticamente. Si el admin lo customizo
  // (no coincide con V1 ni con V2), respetamos su version y avisamos por log.
  // Si la fila no existe, ensurePromptSeeded creara el V2 tras las migraciones.
  const promptRow = await db.one("SELECT valor FROM configuracion WHERE clave = 'prompt_gemini'");
  if (promptRow) {
    if (promptRow.valor === PROMPT_DEFAULT_V1) {
      await db.query(
        `UPDATE configuracion SET valor = $1, updated_at = NOW() WHERE clave = 'prompt_gemini'`,
        [PROMPT_DEFAULT]
      );
      logger.info('[MIGRATION] prompt_gemini actualizado de V1 a V2 (deteccion de rectificativas)');
    } else if (promptRow.valor === PROMPT_DEFAULT) {
      // Ya esta en V2, no hacer nada.
    } else {
      logger.warn(
        '[MIGRATION WARN] prompt_gemini en BD ha sido modificado manualmente. ' +
        'No se actualiza automaticamente. Para incluir deteccion de rectificativas, ' +
        'resetea desde la UI de configuracion o aplica el nuevo PROMPT_DEFAULT manualmente.'
      );
    }
  }

  // ─── Backfill retroactivo de es_rectificativa por heuristica ────────────────
  // Las facturas extraidas con el prompt V1 (pre-rectificativas) tienen todas
  // es_rectificativa=false (default de columna). Aplicamos la misma heuristica
  // del extractor (total_factura < 0 && total_iva = 0|null) para no obligar a
  // re-extraer con Gemini. Idempotente: solo afecta filas donde sigue en false
  // y cumplen la heuristica; tras marcarlas a true, la WHERE no las vuelve a tocar.
  // Claves JSON: total_factura, total_iva (ver mapearRespuestaGemini).
  const backfillRes = await db.query(
    `UPDATE drive_archivos
     SET es_rectificativa = true
     WHERE es_rectificativa = false
       AND datos_extraidos IS NOT NULL
       AND datos_extraidos ~ '^\\s*\\{'
       AND ((datos_extraidos::jsonb)->>'total_factura') IS NOT NULL
       AND ((datos_extraidos::jsonb)->>'total_factura')::numeric < 0
       AND (
         (datos_extraidos::jsonb)->>'total_iva' IS NULL
         OR ((datos_extraidos::jsonb)->>'total_iva')::numeric = 0
       )`
  );
  if (backfillRes.rowCount > 0) {
    logger.info(
      { marcadas: backfillRes.rowCount },
      '[MIGRATION] Backfill es_rectificativa: facturas marcadas por heuristica (total<0, iva=0/null)'
    );
  }

  logger.info('Migración PostgreSQL completada');
}

module.exports = { runMigrations };
