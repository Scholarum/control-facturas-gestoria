const { getDb }              = require('../config/database');
const { buildDriveClient }   = require('./driveService');
const { ejecutarExtraccion } = require('./extractorService');

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
    const nuevosIds = [];

    for (const a of archivos) {
      const existia = await db.one(
        'SELECT id FROM drive_archivos WHERE google_id = $1',
        [a.google_id]
      );
      await db.query(
        `INSERT INTO drive_archivos (google_id, nombre_archivo, ruta_completa, proveedor, fecha_subida, estado)
         VALUES ($1, $2, $3, $4, $5, 'SINCRONIZADA')
         ON CONFLICT (google_id) DO UPDATE SET
           nombre_archivo = EXCLUDED.nombre_archivo,
           ruta_completa  = EXCLUDED.ruta_completa,
           proveedor      = EXCLUDED.proveedor,
           fecha_subida   = EXCLUDED.fecha_subida,
           ultima_sync    = NOW()`,
        [a.google_id, a.nombre_archivo, a.ruta_completa, a.proveedor, a.fecha_subida]
      );
      if (!existia) {
        const nuevo = await db.one('SELECT id FROM drive_archivos WHERE google_id = $1', [a.google_id]);
        nuevosIds.push(nuevo.id);
        facturas_nuevas++;
      }
    }

    // Extraer con Gemini todos los archivos recién sincronizados (estado SINCRONIZADA).
    // Este estado lo asigna el sync al insertar; tras la extracción pasa a
    // PROCESADA o REVISION_MANUAL, por lo que no se reprocesarán en la siguiente sync.
    const sincRows = await db.all(
      "SELECT id FROM drive_archivos WHERE estado = 'SINCRONIZADA'"
    );
    const idsParaExtraer = sincRows.map(r => r.id);

    let extraccion = { procesada: 0, revision: 0 };
    let facturas_duplicadas = 0;
    let detalleDuplicadas = [];
    if (idsParaExtraer.length > 0) {
      try {
        extraccion = await ejecutarExtraccion(idsParaExtraer);
      } catch (e) {
        console.error('[Sync] Error en extracción:', e.message);
      }

      // Tras extracción: detectar duplicados (mismo CIF emisor + mismo nº factura)
      // Las duplicadas se eliminan de drive_archivos y se registran en el detalle del historial
      try {
        const duplicadas = await db.all(`
          SELECT da.id, da.nombre_archivo, da.ruta_completa, da.google_id, da.proveedor,
                 (da.datos_extraidos::jsonb)->>'cif_emisor'     AS cif,
                 (da.datos_extraidos::jsonb)->>'numero_factura' AS num,
                 (da.datos_extraidos::jsonb)->>'nombre_emisor'  AS emisor
          FROM drive_archivos da
          WHERE da.id = ANY($1::int[])
            AND da.estado = 'PROCESADA'
            AND da.datos_extraidos IS NOT NULL
            AND da.datos_extraidos ~ '^\\s*\\{'
            AND EXISTS (
              SELECT 1 FROM drive_archivos otro
              WHERE otro.id <> da.id
                AND otro.estado IN ('PROCESADA','REVISION_MANUAL')
                AND otro.datos_extraidos IS NOT NULL
                AND otro.datos_extraidos ~ '^\\s*\\{'
                AND normalizar_cif((otro.datos_extraidos::jsonb)->>'cif_emisor')
                    = normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor')
                AND UPPER(TRIM((otro.datos_extraidos::jsonb)->>'numero_factura'))
                    = UPPER(TRIM((da.datos_extraidos::jsonb)->>'numero_factura'))
                AND (da.datos_extraidos::jsonb)->>'numero_factura' IS NOT NULL
                AND TRIM((da.datos_extraidos::jsonb)->>'numero_factura') <> ''
            )
        `, [idsParaExtraer]);

        if (duplicadas.length > 0) {
          const dupIds = duplicadas.map(d => d.id);
          detalleDuplicadas = duplicadas.map(d => ({
            nombre_archivo: d.nombre_archivo,
            ruta_drive:     d.ruta_completa,
            proveedor:      d.proveedor,
            cif_emisor:     d.cif,
            numero_factura: d.num,
            nombre_emisor:  d.emisor,
          }));
          await db.query('DELETE FROM drive_archivos WHERE id = ANY($1::int[])', [dupIds]);
          facturas_duplicadas = duplicadas.length;
          console.log(`[Sync] ${facturas_duplicadas} factura(s) duplicada(s) eliminada(s)`);
        }
      } catch (e) {
        console.error('[Sync] Error al detectar duplicados:', e.message);
      }

      // Tras extracción: pasar a CC_ASIGNADA las facturas cuyo proveedor
      // ya tiene cuenta de gasto definida (match por carpeta o por CIF extraído)
      try {
        await db.query(
          `UPDATE drive_archivos da
           SET estado_gestion = 'CC_ASIGNADA'
           WHERE da.id = ANY($1::int[])
             AND da.estado_gestion = 'PENDIENTE'
             AND EXISTS (
               SELECT 1 FROM proveedores p
               WHERE p.activo = true
                 AND p.cuenta_gasto_id IS NOT NULL
                 AND p.cuenta_contable_id IS NOT NULL
                 AND (
                   (
                     p.cif IS NOT NULL
                     AND da.datos_extraidos IS NOT NULL
                     AND da.datos_extraidos ~ '^\\s*\\{'
                     AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p.cif)
                   )
                   OR p.nombre_carpeta = da.proveedor
                 )
             )`,
          [idsParaExtraer]
        );
      } catch (e) {
        console.error('[Sync] Error al asignar estado CC_ASIGNADA:', e.message);
      }
    }

    const countRow = await db.one(
      "SELECT COUNT(*) AS facturas_error FROM drive_archivos WHERE estado = 'REVISION_MANUAL'"
    );
    const facturas_error = parseInt(countRow.facturas_error, 10);
    const duracion_ms    = Date.now() - inicio;

    await db.query(
      `INSERT INTO historial_sincronizaciones
         (origen, estado, facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms, detalle)
       VALUES ($1, 'OK', $2, $3, $4, $5, $6)`,
      [origen, facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms,
       JSON.stringify({ total_escaneadas: archivos.length, extraccion, duplicadas: detalleDuplicadas })]
    );

    return { facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms, extraccion };

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
