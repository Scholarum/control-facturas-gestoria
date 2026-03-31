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
| `drive_archivos` | Facturas sincronizadas desde Google Drive (datos_extraidos JSONB) |
| `proveedores` | Proveedores (razon_social, cif, cuenta_contable_id, cuenta_gasto_id) |
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

### Migraciones

Las migraciones están en `src/config/migrate.js`. Se ejecutan al arrancar con `npm run migrate`. Incluyen schema completo + seeds (plan contable, roles ADMIN/GESTORIA, permisos, empresas).

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

- **Backend**: Render (Node.js)
- **Frontend**: Netlify (SPA con redirect `/* → /index.html`)
- **Base de datos**: Supabase (PostgreSQL)
- En producción, Express sirve el build estático del cliente desde `client/dist/`

## Testing

No hay framework de testing configurado. Las pruebas son manuales.

## Lo que NO hay configurado (y está pendiente)

- Linting (ESLint) / Formatting (Prettier)
- Testing (Jest/Vitest)
- Pre-commit hooks
- Gestión centralizada de secretos (pendiente migrar a Doppler/AWS SSM/Vault)
