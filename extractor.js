/**
 * extractor.js — CLI para extracción de datos de facturas via Gemini
 *
 * Uso:
 *   node extractor.js              → Procesa todos los archivos PENDIENTES
 *   node extractor.js --id 3       → Procesa solo el archivo con id=3
 *   node extractor.js --reprocess  → Reprocesa también los REVISION_MANUAL y PROCESADA
 */
require('dotenv').config();

const { initDb, getDb }      = require('./src/config/database');
const { runMigrations }      = require('./src/config/migrate');
const { ensurePromptSeeded, ejecutarExtraccion } = require('./src/services/extractorService');

async function main() {
  const args      = process.argv.slice(2);
  const idFiltro  = args.includes('--id') ? parseInt(args[args.indexOf('--id') + 1]) : null;
  const reprocess = args.includes('--reprocess');

  await initDb();
  runMigrations();
  ensurePromptSeeded();

  const db = getDb();
  let ids = null;

  if (idFiltro) {
    ids = [idFiltro];
  } else if (!reprocess) {
    // Solo PENDIENTES (comportamiento por defecto)
    const filas = db.prepare("SELECT id FROM drive_archivos WHERE estado = 'PENDIENTE' ORDER BY id").all();
    ids = filas.map(r => r.id);
    if (ids.length === 0) {
      console.log('\nNo hay archivos PENDIENTES. Usa --reprocess para reprocesar los existentes.\n');
      return;
    }
  }
  // reprocess + sin --id → ids=null → el servicio coge todos (PENDIENTE + REVISION_MANUAL + PROCESADA)

  console.log('\n══════════════════════════════════════════════');
  console.log('  Extractor Gemini (via extractorService)');
  console.log('══════════════════════════════════════════════');

  const resumen = { procesada: 0, revision: 0 };

  await ejecutarExtraccion(ids, (ev) => {
    if (ev.tipo === 'inicio') {
      process.stdout.write(`\n  → [${ev.id}] ${ev.proveedor || ''} / ${ev.nombre}\n`);
    } else if (ev.tipo === 'resultado') {
      if (ev.estado === 'PROCESADA') {
        const d = ev.datos || {};
        console.log(`     ✓ PROCESADA — ${d.numero_factura || '?'} | ${d.total_factura} € | ${d.nombre_emisor || d.cif_emisor || ''}`);
        resumen.procesada++;
      } else {
        console.log(`     ✗ REVISION_MANUAL — ${ev.error || ''}`);
        resumen.revision++;
      }
    } else if (ev.tipo === 'fin') {
      console.log('\n──────────────────────────────────────────────');
      console.log(`  PROCESADA:       ${ev.resumen.procesada}`);
      console.log(`  REVISION_MANUAL: ${ev.resumen.revision}`);
      console.log('══════════════════════════════════════════════\n');
    }
  });
}

main().catch(err => { console.error('\nError fatal:', err.message); process.exit(1); });
