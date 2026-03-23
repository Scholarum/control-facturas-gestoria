/**
 * sync.js — Sincronizador de Google Drive
 *
 * Uso:
 *   node sync.js           → Dry Run (solo muestra, no escribe en BD)
 *   node sync.js --save    → Guarda/actualiza en BD
 */
require('dotenv').config();

const { google }       = require('googleapis');
const path             = require('path');
const { initDb }       = require('./src/config/database');
const { runMigrations } = require('./src/config/migrate');
const { getDb }        = require('./src/config/database');

const ROOT_FOLDER_ID   = '1bJjT-9q4jca4vkhmGNGKyHj7mmFlLjr9';
const CREDENTIALS_FILE = path.resolve(__dirname, 'credentials..json');
const DRY_RUN          = !process.argv.includes('--save');

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function buildDriveClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_FILE,
    scopes:  ['https://www.googleapis.com/auth/drive.readonly'],
  });
  return google.drive({ version: 'v3', auth });
}

// ─── Escaneo recursivo ────────────────────────────────────────────────────────

async function listarHijos(drive, folderId) {
  const items = [];
  let pageToken;
  do {
    const res = await drive.files.list({
      q:         `'${folderId}' in parents and trashed = false`,
      fields:    'nextPageToken, files(id, name, mimeType, createdTime)',
      pageSize:  1000,
      pageToken,
    });
    items.push(...(res.data.files || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  return items;
}

async function escanearCarpeta(drive, folderId, rutaActual, proveedor, resultados) {
  const hijos = await listarHijos(drive, folderId);
  for (const item of hijos) {
    const rutaItem = rutaActual ? `${rutaActual}/${item.name}` : item.name;
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      await escanearCarpeta(drive, item.id, rutaItem, proveedor ?? item.name, resultados);
    } else if (item.name.toLowerCase().endsWith('.pdf')) {
      resultados.push({
        google_id:      item.id,
        nombre_archivo: item.name,
        ruta_completa:  rutaItem,
        proveedor:      proveedor ?? null,
        fecha_subida:   item.createdTime ?? null,
      });
    }
  }
}

// ─── Persistencia ─────────────────────────────────────────────────────────────

function guardarEnBD(archivos) {
  const db = getDb();
  for (const a of archivos) {
    db.prepare(`
      INSERT INTO drive_archivos (google_id, nombre_archivo, ruta_completa, proveedor, fecha_subida)
      VALUES (@google_id, @nombre_archivo, @ruta_completa, @proveedor, @fecha_subida)
      ON CONFLICT(google_id) DO UPDATE SET
        nombre_archivo = excluded.nombre_archivo,
        ruta_completa  = excluded.ruta_completa,
        proveedor      = excluded.proveedor,
        fecha_subida   = excluded.fecha_subida,
        ultima_sync    = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).run(a);
  }
}

// ─── Presentación ─────────────────────────────────────────────────────────────

function imprimirResumen(archivos) {
  const porProveedor = {};
  for (const a of archivos) {
    const key = a.proveedor || '(sin proveedor)';
    porProveedor[key] = (porProveedor[key] || 0) + 1;
  }

  console.log('\n══════════════════════════════════════════════');
  console.log(`  DRY RUN — Archivos PDF detectados: ${archivos.length}`);
  console.log('══════════════════════════════════════════════');
  console.log('\nDesglose por proveedor:\n');
  for (const [p, n] of Object.entries(porProveedor).sort()) {
    console.log(`  ${p.padEnd(40)} ${n} PDF(s)`);
  }
  console.log('\nPrimeros 10 archivos:\n');
  archivos.slice(0, 10).forEach((a, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. [${a.proveedor || '-'}] ${a.ruta_completa}`);
  });
  if (archivos.length > 10) console.log(`  ... y ${archivos.length - 10} más`);
  console.log('\n──────────────────────────────────────────────');
  console.log('  Para guardar en BD: node sync.js --save');
  console.log('══════════════════════════════════════════════\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nIniciando escaneo de Drive...`);
  console.log(`Carpeta raíz : ${ROOT_FOLDER_ID}`);
  console.log(`Modo         : ${DRY_RUN ? 'DRY RUN (sin escritura)' : 'SAVE (escribe en BD)'}\n`);

  await initDb();
  runMigrations();

  const drive = await buildDriveClient();
  const archivos = [];
  await escanearCarpeta(drive, ROOT_FOLDER_ID, '', null, archivos);

  if (DRY_RUN) {
    imprimirResumen(archivos);
  } else {
    guardarEnBD(archivos);
    console.log(`\n✓ ${archivos.length} archivos sincronizados en BD.\n`);
  }
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
