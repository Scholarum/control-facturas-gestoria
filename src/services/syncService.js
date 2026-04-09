const { getDb }              = require('../config/database');
const { buildDriveClient, ROOT_FOLDER_ID } = require('./driveService');
const { ejecutarExtraccion } = require('./extractorService');
const logger                 = require('../config/logger');

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
    logger.info('Sync escaneando Drive');
    await escanearCarpeta(drive, ROOT_FOLDER_ID, '', null, archivos);
    logger.info({ count: archivos.length }, 'Sync PDFs encontrados en Drive');

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
    logger.info({ facturas_nuevas }, 'Sync facturas nuevas insertadas');

    // ─── Extraccion con Gemini (solo las SINCRONIZADA) ───────────────────
    const sincRows = await db.all(
      "SELECT id FROM drive_archivos WHERE estado = 'SINCRONIZADA'"
    );
    const idsParaExtraer = sincRows.map(r => r.id);

    let extraccion = { procesada: 0, revision: 0 };
    let facturas_duplicadas = 0;
    let detalleDuplicadas = [];

    if (idsParaExtraer.length > 0) {
      logger.info({ count: idsParaExtraer.length }, 'Sync extrayendo facturas con Gemini');
      try {
        extraccion = await ejecutarExtraccion(idsParaExtraer);
      } catch (e) {
        logger.error({ err: e }, 'Sync error en extraccion');
      }
      logger.info({ procesada: extraccion.procesada, revision: extraccion.revision }, 'Sync extraccion completada');

      // Asignar empresa_id por CIF receptor
      try {
        await db.query(`
          UPDATE drive_archivos da SET empresa_id = e.id
          FROM empresas e
          WHERE da.id = ANY($1::int[])
            AND da.empresa_id IS NULL
            AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
            AND normalizar_cif((da.datos_extraidos::jsonb)->>'cif_receptor') = normalizar_cif(e.cif)
        `, [idsParaExtraer]);

        // Facturas con CIF receptor no registrado → cuarentena (pendientes_validacion)
        const sinEmpresa = await db.all(`
          SELECT da.id, da.google_id, da.nombre_archivo, da.proveedor,
            UPPER(TRIM((da.datos_extraidos::jsonb)->>'cif_receptor')) AS cif,
            (da.datos_extraidos::jsonb)->>'nombre_receptor' AS nombre,
            da.datos_extraidos
          FROM drive_archivos da
          WHERE da.id = ANY($1::int[])
            AND da.empresa_id IS NULL
            AND da.datos_extraidos IS NOT NULL AND da.datos_extraidos ~ '^\\s*\\{'
            AND (da.datos_extraidos::jsonb)->>'cif_receptor' IS NOT NULL
            AND TRIM((da.datos_extraidos::jsonb)->>'cif_receptor') <> ''
        `, [idsParaExtraer]);

        for (const row of sinEmpresa) {
          if (!row.cif) continue;
          try {
            await db.query(
              `INSERT INTO pendientes_validacion (cif_receptor, nombre_receptor, drive_archivo_id, datos_extraidos, google_id, nombre_archivo, proveedor)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT DO NOTHING`,
              [row.cif, row.nombre?.trim() || null, row.id,
               row.datos_extraidos || '{}', row.google_id, row.nombre_archivo, row.proveedor]
            );
            logger.info({ nombre: row.nombre || row.cif, cif: row.cif }, 'Sync factura enviada a cuarentena (CIF receptor desconocido)');
          } catch (e) {
            logger.error({ err: e, cif: row.cif }, 'Sync error guardando en pendientes_validacion');
          }
        }
      } catch (e) {
        logger.error({ err: e }, 'Sync error asignando empresa_id');
      }

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
        logger.error({ err: e }, 'Sync error duplicados');
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
        logger.error({ err: e }, 'Sync error CC_ASIGNADA');
      }

      // Vinculacion carpeta-proveedor: se gestiona manualmente desde Proveedores
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

    logger.info({ duracion: (duracion_ms/1000).toFixed(1), facturas_nuevas, facturas_error, facturas_duplicadas }, 'Sync completada');
    const { broadcast } = require('./sseService');
    broadcast('sync_complete', { facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms, extraccion });
    return { facturas_nuevas, facturas_error, facturas_duplicadas, duracion_ms, extraccion };

  } catch (err) {
    const duracion_ms = Date.now() - inicio;
    logger.error({ err, duracion: (duracion_ms/1000).toFixed(1) }, 'Sync error');
    const { broadcast } = require('./sseService');
    broadcast('sync_error', { error: err.message, duracion_ms });
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
