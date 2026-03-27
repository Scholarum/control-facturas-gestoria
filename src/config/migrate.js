const { getDb } = require('./database');

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

  // Indices para acelerar queries
  `CREATE INDEX IF NOT EXISTS idx_proveedores_cif ON proveedores (UPPER(TRIM(cif))) WHERE activo = true AND cif IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_proveedores_carpeta ON proveedores (nombre_carpeta) WHERE activo = true AND nombre_carpeta IS NOT NULL`,
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

  console.log('Migración PostgreSQL completada.');
}

module.exports = { runMigrations };
