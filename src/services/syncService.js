const { getDb }            = require('../config/database');
const { buildDriveClient } = require('./driveService');

const ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || '1bJjT-9q4jca4vkhmGNGKyHj7mmFlLjr9';

// ─── Escaneo recursivo de Drive ───────────────────────────────────────────────

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

// ─── Ejecución de sincronización ──────────────────────────────────────────────

async function ejecutarSync(origen = 'MANUAL') {
  const db     = getDb();
  const inicio = Date.now();

  try {
    const drive    = await buildDriveClient();
    const archivos = [];
    await escanearCarpeta(drive, ROOT_FOLDER_ID, '', null, archivos);

    let facturas_nuevas = 0;
    for (const a of archivos) {
      const existia = await db.one(
        'SELECT id FROM drive_archivos WHERE google_id = $1',
        [a.google_id]
      );
      await db.query(
        `INSERT INTO drive_archivos (google_id, nombre_archivo, ruta_completa, proveedor, fecha_subida)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (google_id) DO UPDATE SET
           nombre_archivo = EXCLUDED.nombre_archivo,
           ruta_completa  = EXCLUDED.ruta_completa,
           proveedor      = EXCLUDED.proveedor,
           fecha_subida   = EXCLUDED.fecha_subida,
           ultima_sync    = NOW()`,
        [a.google_id, a.nombre_archivo, a.ruta_completa, a.proveedor, a.fecha_subida]
      );
      if (!existia) facturas_nuevas++;
    }

    const countRow = await db.one(
      "SELECT COUNT(*) AS facturas_error FROM drive_archivos WHERE estado = 'REVISION_MANUAL'"
    );
    const facturas_error = parseInt(countRow.facturas_error, 10);
    const duracion_ms    = Date.now() - inicio;

    await db.query(
      `INSERT INTO historial_sincronizaciones
         (origen, estado, facturas_nuevas, facturas_error, duracion_ms, detalle)
       VALUES ($1, 'OK', $2, $3, $4, $5)`,
      [origen, facturas_nuevas, facturas_error, duracion_ms,
       JSON.stringify({ total_escaneadas: archivos.length })]
    );

    return { facturas_nuevas, facturas_error, duracion_ms };

  } catch (err) {
    const duracion_ms = Date.now() - inicio;
    await db.query(
      `INSERT INTO historial_sincronizaciones
         (origen, estado, facturas_nuevas, facturas_error, duracion_ms, detalle)
       VALUES ($1, 'ERROR', 0, 0, $2, $3)`,
      [origen, duracion_ms, JSON.stringify({ error: err.message })]
    );
    throw err;
  }
}

module.exports = { ejecutarSync };
