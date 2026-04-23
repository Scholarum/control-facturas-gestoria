# CLAUDE.md — Control Facturas Gestoría

## Descripción del proyecto

Aplicación full-stack de control y gestión de facturas para una gestoría con trazabilidad total.
El objetivo principal es la **trazabilidad**: saber exactamente cuándo y desde qué IP la gestoría visualiza cada factura. Los logs de auditoría son inmutables (solo INSERT).

Flujo central: admin sube factura → sync desde Google Drive → extracción IA (Gemini) → conciliación con mayor contable → exportación SAGE/A3 → notificación a gestoría.

## Stack

| Capa | Tecnología |
|------|-----------|
| **Backend** | Node.js + Express 4 |
| **Frontend** | React 18 + Vite 5 + Tailwind CSS 3 |
| **Base de datos** | PostgreSQL (pg driver, SQL raw con helpers) |
| **Auth** | JWT + bcryptjs, Google OAuth |
| **IA** | Anthropic Claude (chat con tool_use), Google Gemini (extracción OCR de PDFs) |
| **Storage** | Google Drive (sync automático) |
| **Email** | Mailjet |
| **Cron** | node-cron |
| **PDF** | PDFKit |
| **Excel** | xlsx |
| **Deploy** | Backend en Render, Frontend en Netlify, BD en Supabase |

## Comandos principales

```bash
# Backend
npm run dev              # Arranca backend con nodemon (puerto 3000)
npm start                # Arranca backend en producción
npm run migrate          # Ejecuta migraciones PostgreSQL (src/config/migrate.js)

# Frontend
npm run client:dev       # Arranca Vite dev server (puerto 5173, proxy /api → :3000)
npm run client:build     # Build de producción del cliente
npm run build            # Install + build del cliente (usado en deploy)

# CLI
npm run sync             # Sincroniza archivos desde Google Drive
npm run extraer          # Extrae datos de PDFs con Gemini
npm run reprocess        # Reprocesa PDFs fallidos con Gemini
node setup-admin.js      # Crea usuario admin inicial
```

## Estructura del proyecto

```
├── src/                       # Backend Express
│   ├── app.js                 # Entry point, setup Express + middleware
│   ├── config/
│   │   ├── database.js        # Pool PostgreSQL con helpers (query, one, all, run)
│   │   ├── logger.js          # Pino (JSON en prod, pretty en dev)
│   │   └── migrate.js         # Schema PostgreSQL + seeds
│   ├── middleware/
│   │   ├── auth.js            # resolveUser, requireAuth, requireAdmin
│   │   ├── audit.js           # attachRequestMeta (IP, user-agent)
│   │   └── rateLimiter.js     # express-rate-limit
│   ├── routes/                # 15 routers (~42 archivos)
│   └── services/              # 16 servicios de lógica de negocio
│
├── client/                    # Frontend React
│   ├── src/
│   │   ├── App.jsx            # Componente raíz
│   │   ├── api.js             # Cliente HTTP centralizado (~80 funciones)
│   │   ├── pages/             # 10 páginas (PascalCase.jsx)
│   │   ├── components/        # 20+ componentes reutilizables
│   │   ├── context/           # AuthContext.jsx (estado global)
│   │   └── hooks/             # useCache.js (stale-while-revalidate)
│   ├── vite.config.js         # Proxy /api y /ver → localhost:3000
│   └── tailwind.config.js
│
├── extractor.js               # CLI extracción Gemini
├── sync.js                    # CLI sync Google Drive
└── setup-admin.js             # Setup inicial
```

## Arquitectura backend

```
routes/ (controladores) → services/ (lógica de negocio) → config/database.js (acceso a datos)
```

**Middleware stack:**
```
cors → express.json → apiLimiter → attachRequestMeta → routes
                                                         ↓
                                        resolveUser → requireAuth → requireAdmin
```

**Formato de respuesta JSON:**
```javascript
// Éxito
{ ok: true, data: { /* payload */ } }

// Error
{ ok: false, error: "mensaje de error" }
```

**Errores custom:**
```javascript
throw Object.assign(new Error('No autorizado'), { status: 403 });
```

**UPDATE dinámico para edición parcial:** los endpoints PUT que acepten ediciones parciales (p.ej. un campo inline aislado) deben construir el `SET` sólo con las columnas presentes en `req.body`, usando `'campo' in req.body` como detector uniforme. Nunca poner todas las columnas fijas con `$n` directo sin COALESCE: pisa con NULL los campos que el cliente no envió (ver patrón en `router.put('/:id')` de `src/routes/proveedores.js`).

**Database helpers (config/database.js):**
- `db.query(sql, params)` — query genérica
- `db.one(sql, params)` — una fila o null
- `db.all(sql, params)` — array de filas
- `db.run(sql, params)` — rowCount (para INSERT/UPDATE/DELETE)

## Arquitectura frontend

- **Sin router**: SPA con navegación manual por tabs/vistas
- **State**: React Context (AuthContext) + useState local
- **HTTP**: fetch nativo centralizado en `api.js`
- **Cache**: hook `useCache` con stale-while-revalidate (TTL 5min)
- **Auth**: Token JWT en localStorage, Google OAuth con `@react-oauth/google`
- **Permisos**: `puedeVer(recurso)`, `puedeEditar(recurso)` desde AuthContext

## Convenciones de código

### Naming

| Contexto | Convención | Ejemplo |
|----------|-----------|---------|
| Variables/funciones JS | camelCase | `ejecutarSync`, `fetchStats` |
| Constantes | SCREAMING_SNAKE_CASE | `JWT_SECRET`, `CAMPOS_CRITICOS` |
| Componentes React | PascalCase | `ModalContabilizar`, `SeccionFacturas` |
| Archivos pages/components | PascalCase.jsx | `Usuarios.jsx`, `ChatWidget.jsx` |
| Archivos routes | lowercase.js | `facturas.js`, `auth.js` |
| Archivos services | camelCase.js | `authService.js`, `syncService.js` |
| Tablas BD | snake_case | `drive_archivos`, `plan_contable` |
| Columnas BD | snake_case | `fecha_emision`, `estado_gestion` |
| Foreign keys | sufijo `_id` | `factura_id`, `empresa_id` |
| Endpoints API | kebab-case, plural | `/api/plan-contable`, `/api/usuarios` |

### Idioma

- El código (variables, funciones, comentarios) está en **español**
- Las respuestas al usuario deben ser siempre en **español**

### CSS / UI

- Tailwind utility-first, sin librería de componentes externa
- Colores semánticos: `blue-*` (info), `emerald-*` (success), `amber-*` (warning), `red-*` (error)

## Base de datos

### Tablas principales

| Tabla | Propósito |
|-------|----------|
| `usuarios` | Usuarios del sistema (email, rol, password_hash, activo) |
| `empresas` | Multi-empresa (nombre, cif, direccion) |
| `usuario_empresa` | Relación N:M usuarios-empresas |
| `drive_archivos` | Facturas sincronizadas desde Google Drive (datos_extraidos **TEXT** con JSON serializado; ver nota) |
| `proveedores` | Proveedores (razon_social, cif, cuenta_contable_id, cuenta_gasto_id, sii_tipo_clave, sii_tipo_fact) |
| `proveedor_empresa` | Cuentas de proveedor por empresa |
| `plan_contable` | Cuentas contables (codigo, descripcion, grupo, empresa_id) |
| `configuracion` | Config local por empresa (clave/valor) |
| `configuracion_sistema` | Config global (sync, notificaciones, chat) |
| `historial_sincronizaciones` | Registros de syncs (origen, estado, duracion_ms) |
| `historial_conciliaciones` | Resultados de conciliación con mayor contable |
| `lotes_exportacion_sage` | Lotes exportados a SAGE (CSV) |
| `lotes_exportacion_a3` | Lotes exportados a A3 |
| `chat_conversaciones` / `chat_mensajes` | Chat IA con Claude |
| `logs_auditoria` | Log inmutable de eventos (SUBIDA, APERTURA, VISTO, REGISTRO) |
| `tokens_acceso` | Tokens UUID para acceso público a facturas |
| `roles` / `rol_permisos` | Roles y permisos granulares (recurso + nivel: none/read/edit) |

### Estados de archivo (drive_archivos)

`PENDIENTE` → `PROCESADA` (extracción OK) o `REVISION_MANUAL` (error extracción)

### Columna `drive_archivos.datos_extraidos` — TEXT, no JSONB

La columna está declarada `TEXT` (ver `src/config/migrate.js`). Almacena el JSON de la extracción Gemini serializado como string. **No** es JSONB (pese a que el contenido sea JSON). Razones históricas — la tabla se creó antes de la migración a PostgreSQL y nunca se cambió el tipo para no romper los `JSON.parse(a.datos_extraidos)` del código JS (con JSONB el driver `pg` devolvería objeto directo y esos `JSON.parse` fallarían).

**Reglas obligatorias:**

1. **Acceso desde SQL**: siempre con cast `::jsonb` antes de los operadores `->>` o `->`. Patrón estándar: `(da.datos_extraidos::jsonb)->>'clave'`. Sin cast los operadores dan error `operator does not exist: text ->> unknown`.
2. **Acceso desde JS**: `JSON.parse(row.datos_extraidos)`. El driver devuelve string.
3. **Guard frente a JSON inválido**: las filas antiguas pueden tener `datos_extraidos` vacío o corrupto. En SELECTs que castean a `jsonb`, proteger con `da.datos_extraidos ~ '^\s*\{'` antes del cast (patrón usado en todos los SELECT de `src/routes/gestion.js` y `src/config/migrate.js`). Sin este guard, una fila con texto no-JSON puede hacer fallar la consulta entera.

Las columnas nuevas que vayan a parametrizar comportamientos del export SAGE o SII deben crearse **fuera del JSONB** como columnas separadas de `drive_archivos` (patrón `sii_tipo_*`, `rect_*`, `es_rectificativa`). Mucho más rápido de indexar y no dependen de casts.

### Migraciones

Las migraciones están en `src/config/migrate.js`. Se ejecutan al arrancar con `npm run migrate`. Incluyen schema completo + seeds (plan contable, roles ADMIN/GESTORIA, permisos, empresas).

### Seguridad RLS en Supabase

El schema de `migrate.js` es portable (Postgres vanilla). Las políticas RLS son específicas de Supabase y viven aparte, en `sql/`. **Orden de ejecución tras un reset o instancia nueva de Supabase:**

1. `npm run migrate` — crea schema + seeds.
2. Ejecutar `sql/rls_seguridad.sql` en el SQL Editor de Supabase — activa RLS en las 25 tablas base, crea helpers (`es_admin()`, `app_user_id()`, `usuario_tiene_empresa()`) y vistas seguras.
3. Ejecutar los deltas `sql/rls_delta_*.sql` por orden cronológico — cubren tablas/vistas añadidas posteriormente.

No meter `ENABLE RLS` en `migrate.js`: rompería entornos Postgres locales (los roles `anon`/`authenticated` y las funciones helper solo existen en Supabase).

Contexto arquitectónico: el backend se conecta con el rol `postgres` del `DATABASE_URL` y **bypassa RLS siempre**. Las políticas `TO authenticated` son defensa en profundidad contra accesos vía PostgREST (API REST de Supabase expuesta con anon key), no protegen ni afectan al backend.

## Exportación SAGE ContaPlus (R75)

El protocolo R75 define **142 campos** por registro (ver `src/services/sageExporter.js`). Se generan dos formatos en paralelo: `.csv` (delimitado por `;`) y `.txt` (posiciones fijas). Cada factura produce entre 2 y N+2 líneas: proveedor (HABER) + gasto (DEBE) + una línea por tipo de IVA.

**Gotcha del campo Concepto:** ContaPlus tiene dos campos de concepto:
- **Pos 6 — `Concepto`** (legacy, 25 chars) → sólo `numero_factura` (25 chars no dan margen para nombre útil).
- **Pos 133 — `ConcepNew`** (ampliado, 50 chars) → formato `"{numero_factura}|{nombre_emisor}"` truncado a 50 chars. Aplica a las tres líneas del asiento (proveedor HABER, gasto DEBE, cada línea de IVA). Si falta uno de los dos, el separador `|` se omite.

Las versiones modernas de ContaPlus muestran en la UI el valor de `ConcepNew` (pos 133), **no** el `Concepto` legacy (pos 6). Por eso el nombre del proveedor va en pos 133 y no en pos 6.

**Mapeo de fechas (criterio fiscal correcto, tras corrección 2026-04-23):**
- **Pos 2 — `Fecha`** (asiento) → fecha de contabilización = día en que se genera el fichero (hoy).
- **Pos 46 — `Fecha_OP`** → fecha de operación = `fecha_emision` de la factura.
- **Pos 47 — `Fecha_EX`** → fecha de expedición = día en que se genera el fichero (hoy).

En ContaPlus, el cuadro "Fecha" de Gestión de Asientos muestra pos 2; "F.operación" muestra pos 46; "F.expedición" muestra pos 47.

Historial de correcciones:
- **2026-04-21**: antes de este cambio se ponía la fecha de emisión en pos 2 (y pos 47 vacío), lo que hacía que el asiento quedase fechado con la fecha del documento del proveedor en vez de la de contabilización.
- **2026-04-23**: las pos 46 (Fecha_OP) y 47 (Fecha_EX) estaban invertidas respecto al criterio fiscal — pos 46 ponía "hoy" (debía ser fecha emisión) y pos 47 ponía fecha emisión (debía ser "hoy"). Los lotes SAGE exportados entre 2026-04-21 y 2026-04-23 llevan las fechas de operación/expedición invertidas; ContaPlus las muestra cruzadas en el Libro de IVA.

**Campos SII / Libro de IVA:**
- **Pos 72 — `FacturaEx`** (40 chars) → número de factura del emisor (`numero_factura`). Es el valor que ContaPlus muestra en el "Cuadro de impuestos" como "Nº factura expedición". Sólo se rellena en las líneas de IVA.
- **Pos 76 — `L340`** (lógico) → `.T.` en todas las líneas del asiento (proveedor, gasto y cada IVA). Para que ContaPlus marque efectivamente la casilla "340/SII" al importar, cuando `L340=.T.` deben venir informados los campos SII asociados (pos 117 `TipoClave` y pos 120 `TipoFact`); si falta alguno de los críticos, ContaPlus descarta el flag entero (manual R75, Nota 6, pág. 12).
- **Pos 73 — `TipoFac`** → literal `'R'` (Recibida) en todas las líneas de IVA. Esta app sólo maneja facturas de proveedor, por lo que no requiere parametrización. El soporte correcto de facturas rectificativas (que afectaría a `TipoFact` pos 120 y a `Rectifica` pos 37) queda pendiente: requiere un flag explícito en la factura, no derivado del signo del importe.
- **Pos 117 — `TipoClave`** (N 2, marcador *15 para 472 Deducible) → clave del régimen SII. Default `1` = operación de régimen general (caso normal español).
- **Pos 120 — `TipoFact`** (N 2, marcador *18 para 472 Deducible) → tipo de factura SII. Default `1` = F1 Factura ordinaria.

**Parametrización de `TipoClave` / `TipoFact`:** ambos viven como columnas `sii_tipo_clave` y `sii_tipo_fact` en dos tablas:
- `proveedores`: `SMALLINT NOT NULL DEFAULT 1`. Valor por proveedor.
- `drive_archivos`: `SMALLINT NULL`. Override por factura; `NULL` = heredar del proveedor.

El SELECT del exportador resuelve el valor efectivo en SQL con `COALESCE(da.sii_tipo_clave, p.sii_tipo_clave, 1)` (análogo para `sii_tipo_fact`), evitando que el exportador tenga que conocer la tabla de proveedores. Las columnas se rellenan en `crearIva` únicamente; proveedor (HABER) y gasto (DEBE) no llevan campos SII.

Edición: el endpoint `PUT /api/drive/:id/datos` acepta ambos campos como columnas separadas (fuera del JSONB `datos_extraidos`). Si la factura ya está exportada (`lote_sage_id IS NOT NULL`), el endpoint responde `409` para cambios en `sii_tipo_*` pero mantiene editables el resto de `CAMPOS_EDITABLES`.

**Nota CSV:** `lineaCSV()` no escapa `;` ni comillas. Si algún campo de texto libre llegase a contener `;`, desplazaría columnas. Hoy los campos alimentados son controlados (números de factura, códigos, fechas); revisar escape si se introduce texto libre del usuario.

## Mantenimiento masivo de proveedores vía Excel

Flujo "exportar filtrado → editar offline → reimportar", pensado para correcciones puntuales sin pisar el resto de la base de proveedores.

- `GET /api/proveedores/excel?ids=1,2,3` — exporta sólo esos proveedores (nombre de fichero `proveedores-filtrados-YYYY-MM-DD-Nreg.xlsx`). Sin `?ids` exporta todos los activos. El frontend del listado calcula los `ids` a partir de `proveedoresFiltrados` (filtrado hoy 100% cliente-side) y los manda.
- `POST /api/proveedores/importar` — matching por **prioridad `ID → CIF → razón social`** (la columna `ID (no modificar)` va siempre como primera columna del export). Si la fila trae un `ID` que **no existe** en BD, se descarta y se reporta como error (`"Fila N: ID X no encontrado"`) — nunca crea un proveedor nuevo por una fila con ID corrupto. Si no trae ID, cae a CIF; si tampoco, a razón social. Es UPSERT estricto: los proveedores no incluidos en el fichero **no se tocan**.
- Campos vacíos en el Excel son "no tocar" (se traducen a `COALESCE` en el UPDATE), no "borrar".

## Variables de entorno

Ver `.env.example` para el template. Variables necesarias:

```
PORT                  # Puerto del backend (default 3000)
DATABASE_URL          # PostgreSQL connection string
SECRET_TOKEN_SALT     # Salt para tokens de acceso
JWT_SECRET            # Secreto para firmar JWT
JWT_EXPIRES_IN        # Expiración JWT (default 8h)
GEMINI_API_KEY        # Google AI Studio API key
GEMINI_MODEL          # Modelo Gemini (ej: gemini-2.5-flash)
DRIVE_ROOT_FOLDER_ID  # ID de la carpeta raíz en Google Drive
MAILJET_API_KEY       # API key de Mailjet (cuenta principal, NO subcuenta)
MAILJET_API_SECRET    # API secret de Mailjet
MAILJET_FROM_EMAIL    # Email remitente
GOOGLE_CLIENT_ID      # Google OAuth client ID
VITE_GOOGLE_CLIENT_ID # Mismo client ID para el frontend
ANTHROPIC_API_KEY     # Anthropic Claude API key
OCT8NE_API_KEY        # API key Oct8ne (pedidos)
CORS_ORIGIN           # Orígenes permitidos (CSV), vacío = todos en dev
```

**Nota Mailjet:** Usar siempre la clave de la cuenta principal, no de subcuentas. Las subcuentas aceptan la petición pero no entregan el email.

## Deploy

- **Backend**: Render (Node.js) — escucha el repo completo, redespliega ante cualquier commit en `main`.
- **Frontend**: Netlify (SPA con redirect `/* → /index.html`) — `netlify.toml` define `base = "client"`.
- **Base de datos**: Supabase (PostgreSQL)
- En producción, Express sirve el build estático del cliente desde `client/dist/`

**Netlify cancela builds "sin cambios" por diseño:** al tener `base = "client"`, Netlify compara el diff del commit contra esa carpeta y si no hay cambios dentro, marca el deploy como *Canceled* (optimización integrada, no es un error). Por tanto los commits que sólo tocan backend (`src/`), CLI (`extractor.js`, `sync.js`), `CLAUDE.md` o SQL aparecerán como cancelados en Netlify — es correcto, el frontend servido sigue siendo el del último build que sí tocó `client/`.

### Instancias Supabase

| Entorno | Project ID | Rama Git |
|---------|-----------|----------|
| **Dev** | `fothahxvwswlmnkssjqf` | `dev` |
| **Producción** | `drjdkcfygevlnrvzgzan` | `main` |

Dashboard dev: `https://supabase.com/dashboard/project/fothahxvwswlmnkssjqf`
Dashboard prod: `https://supabase.com/dashboard/project/drjdkcfygevlnrvzgzan`

## Testing

No hay framework de testing configurado. Las pruebas son manuales.

## Lo que NO hay configurado (y está pendiente)

- Linting (ESLint) / Formatting (Prettier)
- Testing (Jest/Vitest)
- Pre-commit hooks
- Gestión centralizada de secretos (pendiente migrar a Doppler/AWS SSM/Vault)
- Edición optimista en panel fiscal de facturas: aplicada sólo a los dos campos SII (`sii_tipo_clave`, `sii_tipo_fact`) mediante el callback `onActualizarFacturaLocal` hilado `SeccionFacturas → TablaFacturas → PanelDetalleFiscal`. El resto de campos del panel (`numero_factura`, fechas, importes, IVA, etc.) sigue disparando `onDatosActualizados → invalidate() → refetch completo`, lo que cierra el panel expandido y pierde scroll. Patrón replicable si se priorizase.
