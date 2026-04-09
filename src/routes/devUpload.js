const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin } = require('../middleware/auth');
const logger  = require('../config/logger');

// En producción este archivo no debería cargarse (app.js lo excluye),
// pero por seguridad, si se carga, todas las rutas devuelven 404.
if (process.env.NODE_ENV !== 'production') {
  const multer = require('multer');

  const uploadDir = path.join(__dirname, '..', '..', 'temp_uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
  });
  const upload = multer({ storage, fileFilter: (_req, file, cb) => {
    cb(null, file.mimetype === 'application/pdf');
  }});

  router.use(resolveUser, requireAdmin);

  // POST /api/dev/upload-local — subir PDF local y extraer con Gemini
  router.post('/upload-local', upload.single('archivo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: 'Se requiere un archivo PDF' });

    const db = getDb();
    const nombreArchivo = req.file.originalname;
    const localPath = req.file.path;
    const proveedor = req.body.proveedor || null;

    try {
      // ID ficticio con prefijo DEV_ para distinguirlo de archivos reales de Drive
      const devFileId = `DEV_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      // Insertar en drive_archivos con la misma estructura que usa el sync de Drive
      const row = await db.one(
        `INSERT INTO drive_archivos (google_id, nombre_archivo, ruta_completa, proveedor, fecha_subida, estado)
         VALUES ($1, $2, $3, $4, NOW(), 'SINCRONIZADA')
         RETURNING *`,
        [devFileId, nombreArchivo, localPath, proveedor]
      );

      logger.info({ id: row.id, google_id: devFileId, nombre: nombreArchivo }, 'DEV upload: archivo registrado');

      // Extraer con Gemini directamente desde el archivo local
      const { buildGeminiModel, getPrompt, normalizarTotales, validarDatos, guardarResultado } = require('../services/extractorService');

      let datos = null, estado, extractionError;
      try {
        const model  = buildGeminiModel();
        const prompt = await getPrompt();

        const base64Pdf = fs.readFileSync(localPath).toString('base64');

        const resultado = await model.generateContent([
          { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
          { text: prompt },
        ]);

        const text    = resultado.response.text();
        const cleaned = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
        datos = JSON.parse(cleaned);

        // Mapear campos si vienen con nombres alternativos (igual que extractorService)
        if (datos.cif_proveedor && !datos.cif_emisor) datos.cif_emisor = datos.cif_proveedor;
        if (datos.nombre_proveedor && !datos.nombre_emisor) datos.nombre_emisor = datos.nombre_proveedor;

        const datosN = normalizarTotales(datos);
        const { valido, faltantes } = validarDatos(datosN);

        if (!valido) {
          estado = 'REVISION_MANUAL';
          extractionError = `Campos criticos ausentes: ${faltantes.join(', ')}`;
        } else {
          estado = 'PROCESADA';
          extractionError = null;
        }

        await guardarResultado(row.id, estado, datosN, extractionError);
        datos = datosN;
      } catch (e) {
        estado = 'REVISION_MANUAL';
        extractionError = e.message.slice(0, 300);
        await guardarResultado(row.id, estado, null, extractionError);
        logger.error({ err: e, archivo: nombreArchivo }, 'DEV upload: error en extracción Gemini');
      }

      // Asignar empresa_id si el CIF receptor coincide
      if (datos?.cif_receptor) {
        await db.query(`
          UPDATE drive_archivos da SET empresa_id = e.id
          FROM empresas e
          WHERE da.id = $1 AND da.empresa_id IS NULL
            AND normalizar_cif($2) = normalizar_cif(e.cif)
        `, [row.id, datos.cif_receptor]);
      }

      const updated = await db.one('SELECT * FROM drive_archivos WHERE id = $1', [row.id]);

      // Si el CIF receptor no coincide con ninguna empresa → cuarentena
      if (datos?.cif_receptor && !updated.empresa_id) {
        const cif = datos.cif_receptor.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (cif) {
          await db.query(
            `INSERT INTO pendientes_validacion (cif_receptor, nombre_receptor, drive_archivo_id, datos_extraidos, google_id, nombre_archivo, proveedor)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [cif, datos.nombre_receptor || null, row.id,
             JSON.stringify(datos), devFileId, nombreArchivo, proveedor]
          );
          logger.info({ cif, nombre: datos.nombre_receptor, drive_id: row.id }, 'DEV upload: CIF desconocido, enviado a cuarentena');
        }
      }

      // Respuesta compatible con la estructura de Google Drive API
      res.json({
        ok: true,
        data: {
          id:               updated.id,
          google_id:        devFileId,
          nombre_archivo:   nombreArchivo,
          ruta_completa:    localPath,
          proveedor:        proveedor,
          fecha_subida:     updated.fecha_subida,
          estado:           updated.estado,
          estado_gestion:   updated.estado_gestion,
          empresa_id:       updated.empresa_id,
          datos_extraidos:  updated.datos_extraidos,
          error_extraccion: updated.error_extraccion,
          procesado_at:     updated.procesado_at,
        },
      });
    } catch (e) {
      logger.error({ err: e }, 'DEV upload: error general');
      res.status(500).json({ ok: false, error: e.message });
    }
  });
}

module.exports = router;
