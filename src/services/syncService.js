const { getDb }              = require('../config/database');
const { buildDriveClient }   = require('./driveService');
const { ejecutarExtraccion } = require('./extractorService');

const ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || '1bJjT-9q4jca4vkhmGNGKyHj7mmFlLjr9';

// ─── Escaneo recursivo de Drive (con concurrencia limitada) ─────────────────

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

  // Separar carpetas y archivos
  const carpetas = [];
  for (const item of hijos) {
    const rutaItem = rutaActual ? `${rutaActual}/${item.name}` : item.name;
    if (item.mimeType === 'application/vnd.google-apps.folder') {
      carpetas.push({ id: item.id, ruta: rutaItem, prov: proveedor ?? item.name });
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

  // Escanear subcarpetas con concurrencia limitada (5 en paralelo)
  const BATCH = 5;
  for (let i = 0; i < carpetas.length; i += BATCH) {
    await Promise.all(
      carpetas.slice(i, i + BATCH).map(c =>
        escanearCarpeta(drive, c.id, c.ruta, c.prov, resultados)
      )
    );
  }
}

// ─── Ejecucion de sincronizacion ────────────────────────────────────────────

async function ejecutarSync(origen = 'MANUAL') {
  const db     = getDb();
  const inicio = Date.now();

  try {
    const drive    = await buildDriveClient();
    const archivos = [];
    console.log('[Sync] Escaneando Drive...');
    await escanearCarpeta(drive, ROOT_FOLDER_ID, '', null, archivos);
    console.log(`[Sync] ${archivos.length} PDFs encontrados en Drive`);

    // ─── Upsert en lotes (en vez de uno a uno) ───────────────────────────
    let facturas_nuevas = 0;

    // Obtener google_ids existentes de golpe
    const existentes = await db.all('SELECT google_id FROM drive_archivos');
    const existentesSet = new Set(existentes.map(r => r.google_id));

    // Insertar/actualizar en lotes de 50
    const BATCH_DB = 50;
    for (let i = 0; i < archivos.length; i += BATCH_DB) {
      const lote = archivos.slice(i, i + BATCH_DB);
      for (const a of lote) {
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
        if (!existentesSet.has(a.google_id)) facturas_nuevas++;
      }
    }
    console.log(`[Sync] ${facturas_nuevas} facturas nuevas insertadas`);

    // ─── Extraccion con Gemini (solo las SINCRONIZADA) ───────────────────
    const sincRows = await db.all(
      "SELECT id FROM drive_archivos WHERE estado = 'SINCRONIZADA'"
    );
    const idsParaExtraer = sincRows.map(r => r.id);

    let extraccion = { procesada: 0, revision: 0 };
    let facturas_duplicadas = 0;
    let detalleDuplicadas = [];

    if (idsParaExtraer.length > 0) {
      console.log(`[Sync] Extrayendo ${idsParaExtraer.length} facturas con Gemini...`);
      try {
        extraccion = await ejecutarExtraccion(idsParaExtraer);
      } catch (e) {
        console.error('[Sync] Error en extraccion:', e.message);
      }
      console.log(`[Sync] Extraccion completada: ${extraccion.procesada} OK, ${extraccion.revision} revision`);

      // Detectar duplicados
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
          detalleDuplicadas = duplicadas.map(d => ({
            nombre_archivo: d.nombre_archivo, ruta_drive: d.ruta_completa,
            proveedor: d.proveedor, cif_emisor: d.cif, numero_factura: d.num, nombre_emisor: d.emisor,
          }));
          await db.query('DELETE FROM drive_archivos WHERE id = ANY($1::int[])', [duplicadas.map(d => d.id)]);
          facturas_duplicadas = duplicadas.length;
        }
      } catch (e) {
        console.error('[Sync] Error duplicados:', e.message);
      }

      // Auto-asignar CC_ASIGNADA
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
                   (p.cif IS NOT NULL AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
                    AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') = normalizar_cif(p.cif))
                   OR p.nombre_carpeta = da.proveedor
                 )
             )`,
          [idsParaExtraer]
        );
      } catch (e) {
        console.error('[Sync] Error CC_ASIGNADA:', e.message);
      }

      // Rellenar nombre_carpeta
      try {
        await db.query(`
          UPDATE proveedores p
          SET nombre_carpeta = sub.proveedor, updated_at = NOW()
          FROM (
            SELECT DISTINCT da.proveedor,
                   normalizar_cif((da.datos_extraidos::jsonb)->>'cif_emisor') AS cif_norm
            FROM drive_archivos da
            WHERE da.proveedor IS NOT NULL
              AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
              AND (da.datos_extraidos::jsonb)->>'cif_emisor' IS NOT NULL
          ) sub
          WHERE p.nombre_carpeta IS NULL AND p.cif IS NOT NULL
            AND normalizar_cif(p.cif) = sub.cif_norm
        `);
      } catch (e) {
        console.error('[Sync] Error nombre_carpeta:', e.message);
      }
    }

    const countRow = await db.one("SELECT COUNT(*) AS n FROM drive_archivos WHERE estado = 'REVISION_MANUAL'");
    const facturas_error = parseInt(countRow.n, 10);
    const duracion_ms    = Date.now() - inicio;

    await db.query(
      `INSERT INTO historial_sincronizaciones
         (origen, estado, facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms, detalle)
       VALUES ($1, 'OK', $2, $3, $4, $5, $6)`,
      [origen, facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms,
       JSON.stringify({ total_escaneadas: archivos.length, extraccion, duplicadas: detalleDuplicadas })]
    );

    console.log(`[Sync] Completada en ${(duracion_ms/1000).toFixed(1)}s — ${facturas_nuevas} nuevas, ${facturas_error} error, ${facturas_duplicadas} duplicadas`);
    return { facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms, extraccion };

  } catch (err) {
    const duracion_ms = Date.now() - inicio;
    console.error(`[Sync] ERROR tras ${(duracion_ms/1000).toFixed(1)}s:`, err.message);
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
