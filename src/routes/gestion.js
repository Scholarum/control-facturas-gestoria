const express = require('express');
const JSZip   = require('jszip');
const router  = express.Router();

const { getDb }                        = require('../config/database');
const { registrarEvento, EVENTOS }     = require('../services/auditService');
const { buildDriveClient }             = require('../services/driveService');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsearArchivo(a) {
  const datos = a.datos_extraidos ? JSON.parse(a.datos_extraidos) : null;
  return { ...a, datos_extraidos: datos };
}

// ─── GET /api/drive — Listar todos los archivos ───────────────────────────────

router.get('/', (req, res) => {
  const db       = getDb();
  const archivos = db.prepare('SELECT * FROM drive_archivos ORDER BY id DESC').all();
  res.json({ ok: true, data: archivos.map(parsearArchivo) });
});

// ─── GET /api/drive/proveedores ────────────────────────────────────────────────

router.get('/proveedores', (req, res) => {
  const db   = getDb();
  const rows = db.prepare(
    "SELECT DISTINCT proveedor FROM drive_archivos WHERE proveedor IS NOT NULL ORDER BY proveedor"
  ).all();
  res.json({ ok: true, data: rows.map(r => r.proveedor) });
});

// ─── POST /api/drive/descargar-zip ────────────────────────────────────────────

router.post('/descargar-zip', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db       = getDb();
  const archivos = ids
    .map(id => db.prepare('SELECT * FROM drive_archivos WHERE id = ?').get(id))
    .filter(Boolean);

  if (!archivos.length) return res.status(404).json({ ok: false, error: 'Archivos no encontrados' });

  let drive;
  try { drive = await buildDriveClient(); }
  catch (e) { return res.status(500).json({ ok: false, error: 'Error conectando con Drive' }); }

  const zip      = new JSZip();
  const fallidos = [];

  for (const archivo of archivos) {
    try {
      const resp = await drive.files.get(
        { fileId: archivo.google_id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
      const carpeta = archivo.proveedor || 'Sin proveedor';
      zip.file(`${carpeta}/${archivo.nombre_archivo}`, Buffer.from(resp.data));
    } catch (err) {
      fallidos.push({ id: archivo.id, nombre: archivo.nombre_archivo, error: err.message });
    }
  }

  if (fallidos.length) {
    zip.file('_errores.json', JSON.stringify(fallidos, null, 2));
  }

  // Marcar como DESCARGADA (salvo las ya CONTABILIZADAS)
  for (const archivo of archivos) {
    if (archivo.estado_gestion !== 'CONTABILIZADA') {
      db.prepare("UPDATE drive_archivos SET estado_gestion='DESCARGADA' WHERE id=?").run(archivo.id);
    }
    registrarEvento({
      evento:    EVENTOS.DESCARGA,
      ip:        req.clientIp,
      userAgent: req.userAgent,
      detalle:   { drive_id: archivo.id, nombre: archivo.nombre_archivo },
    });
  }

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const fecha  = new Date().toISOString().slice(0, 10);

  res.set({
    'Content-Type':        'application/zip',
    'Content-Disposition': `attachment; filename="facturas-${fecha}.zip"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// ─── PUT /api/drive/contabilizar ──────────────────────────────────────────────

router.put('/contabilizar', (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db = getDb();
  for (const id of ids) {
    db.prepare("UPDATE drive_archivos SET estado_gestion='CONTABILIZADA' WHERE id=?").run(id);
  }

  registrarEvento({
    evento:    EVENTOS.CONTABILIZACION,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   { ids, count: ids.length },
  });

  res.json({ ok: true, data: { contabilizadas: ids.length } });
});

module.exports = router;
