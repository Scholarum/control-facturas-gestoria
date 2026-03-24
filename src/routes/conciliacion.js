const express   = require('express');
const multer    = require('multer');
const XLSX      = require('xlsx');
const router    = express.Router();

const { getDb }                       = require('../config/database');
const { parsearSage }                 = require('../services/sageParser');
const { ejecutarConciliacion }        = require('../services/conciliacionService');
const { generarPdfConciliacion }      = require('../services/pdfReporte');
const { registrarEvento, EVENTOS }    = require('../services/auditService');
const { resolveUser }                 = require('../middleware/auth');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /\.(pdf|csv|xls|xlsx)$/i.test(file.originalname) ||
               ['application/pdf','text/csv','text/plain',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
               .includes(file.mimetype);
    cb(ok ? null : new Error('Formato no soportado. Use PDF, Excel o CSV.'), ok);
  },
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function motivoError(r) {
  if (r.estado === 'OK') return '';
  if (r.estado === 'PENDIENTE_EN_SAGE') return 'No localizada en el Mayor SAGE';
  if (r.estado === 'ERROR_IMPORTE') {
    const importeDif = r.importe_drive !== r.sage?.importe;
    const fechaDif   = r.fecha_emision !== r.sage?.fecha;
    if (importeDif && fechaDif) return `Importe y fecha no coinciden (Drive: ${r.importe_drive}€ / SAGE: ${r.sage?.importe}€)`;
    if (importeDif)             return `Diferencia de importe (Drive: ${r.importe_drive}€ / SAGE: ${r.sage?.importe}€)`;
    if (fechaDif)               return `Fecha diferente (Drive: ${r.fecha_emision} / SAGE: ${r.sage?.fecha})`;
  }
  return '';
}

function buildLineaEstados(lineas) {
  const m = {};
  for (const l of lineas) {
    m[l.linea_idx] = {
      estado_revision: l.estado_revision,
      usuario_nombre:  l.usuario_nombre  || null,
      actualizado_en:  l.actualizado_en  || null,
    };
  }
  return m;
}

// ─── POST /api/conciliacion ───────────────────────────────────────────────────

router.post('/', resolveUser, upload.single('archivo'), async (req, res) => {
  const { proveedor, fechaDesde, fechaHasta } = req.body;

  if (!proveedor) return res.status(400).json({ ok: false, error: 'proveedor requerido' });
  if (!req.file)  return res.status(400).json({ ok: false, error: 'archivo SAGE requerido' });

  let entradasSage;
  try {
    entradasSage = await parsearSage(req.file.buffer, req.file.mimetype, req.file.originalname);
  } catch (err) {
    return res.status(422).json({ ok: false, error: `Error al analizar el archivo SAGE: ${err.message}` });
  }

  if (!entradasSage.length) {
    return res.status(422).json({ ok: false, error: 'No se encontraron entradas de factura en el archivo SAGE. Verifica el formato.' });
  }

  let resultado;
  try {
    resultado = await ejecutarConciliacion(proveedor, fechaDesde || null, fechaHasta || null, entradasSage);
  } catch (err) {
    return res.status(err.status || 500).json({ ok: false, error: err.message });
  }

  const usuarioId     = req.usuario?.id     ?? null;
  const usuarioNombre = req.usuario?.nombre ?? null;

  // Guardar en historial
  let conciliacionId = null;
  const lineaEstados = {};
  try {
    const db = getDb();
    const row = await db.one(
      `INSERT INTO historial_conciliaciones
         (proveedor, fecha_desde, fecha_hasta, total, ok, pendientes_sage, error_importe, resultado_json, usuario_id, usuario_nombre)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        proveedor,
        fechaDesde || null,
        fechaHasta || null,
        resultado.resumen.total,
        resultado.resumen.ok,
        resultado.resumen.pendientesSage,
        resultado.resumen.errorImporte,
        JSON.stringify(resultado),
        usuarioId,
        usuarioNombre,
      ]
    );
    conciliacionId = row.id;

    // Insertar estado inicial PENDIENTE para cada línea con incidencia
    for (let idx = 0; idx < resultado.resultados.length; idx++) {
      const r = resultado.resultados[idx];
      if (r.estado !== 'OK') {
        await db.query(
          `INSERT INTO conciliacion_lineas_estado (conciliacion_id, linea_idx, numero_factura)
           VALUES ($1, $2, $3)`,
          [conciliacionId, idx, r.numero_factura || null]
        );
        lineaEstados[idx] = { estado_revision: 'PENDIENTE', usuario_nombre: null, actualizado_en: null };
      }
    }
  } catch (e) {
    console.error('[Conciliacion] Error guardando historial:', e.message);
  }

  registrarEvento({
    evento:    EVENTOS.UPLOAD_CONCILIACION,
    usuarioId,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   {
      proveedor,
      fechaDesde:     fechaDesde || null,
      fechaHasta:     fechaHasta || null,
      archivo:        req.file.originalname,
      total:          resultado.resumen.total,
      ok:             resultado.resumen.ok,
      pendientesSage: resultado.resumen.pendientesSage,
      errorImporte:   resultado.resumen.errorImporte,
    },
  }).catch(() => {});

  res.json({ ok: true, data: { ...resultado, conciliacionId, lineaEstados, lineasHistorial: [] } });
});

// ─── GET /api/conciliacion/historial ─────────────────────────────────────────

router.get('/historial', resolveUser, async (req, res) => {
  const db   = getDb();
  const rows = await db.all(
    `SELECT id, creado_en, proveedor, fecha_desde, fecha_hasta,
            total, ok, pendientes_sage, error_importe,
            usuario_nombre
     FROM historial_conciliaciones
     ORDER BY creado_en DESC
     LIMIT 100`
  );
  res.json({ ok: true, data: rows });
});

// ─── GET /api/conciliacion/historial/:id ─────────────────────────────────────

router.get('/historial/:id', resolveUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db  = getDb();

  const row = await db.one(
    'SELECT resultado_json FROM historial_conciliaciones WHERE id = $1',
    [id]
  );
  if (!row) return res.status(404).json({ ok: false, error: 'No encontrado' });

  const resultado = typeof row.resultado_json === 'string'
    ? JSON.parse(row.resultado_json)
    : row.resultado_json;

  const [lineas, historial] = await Promise.all([
    db.all(
      `SELECT linea_idx, estado_revision, usuario_nombre, actualizado_en
       FROM conciliacion_lineas_estado
       WHERE conciliacion_id = $1`,
      [id]
    ),
    db.all(
      `SELECT linea_idx, numero_factura, estado_anterior, estado_nuevo, usuario_nombre, creado_en
       FROM conciliacion_lineas_historial
       WHERE conciliacion_id = $1
       ORDER BY creado_en DESC`,
      [id]
    ),
  ]);

  res.json({ ok: true, data: { ...resultado, conciliacionId: id, lineaEstados: buildLineaEstados(lineas), lineasHistorial: historial } });
});

// ─── GET /api/conciliacion/historial/:id/revisiones ──────────────────────────

router.get('/historial/:id/revisiones', resolveUser, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const rows = await db.all(
    `SELECT linea_idx, numero_factura, estado_anterior, estado_nuevo, usuario_nombre, creado_en
     FROM conciliacion_lineas_historial
     WHERE conciliacion_id = $1
     ORDER BY creado_en DESC`,
    [id]
  );
  res.json({ ok: true, data: rows });
});

// ─── PUT /api/conciliacion/historial/:id/lineas/:idx ─────────────────────────

router.put('/historial/:id/lineas/:idx', resolveUser, express.json(), async (req, res) => {
  const conciliacionId = parseInt(req.params.id,  10);
  const lineaIdx       = parseInt(req.params.idx, 10);
  const { estado_revision } = req.body;

  if (!['PENDIENTE', 'REVISADA'].includes(estado_revision)) {
    return res.status(400).json({ ok: false, error: 'estado_revision inválido' });
  }

  const db            = getDb();
  const usuarioId     = req.usuario?.id     ?? null;
  const usuarioNombre = req.usuario?.nombre ?? null;

  // Obtener estado actual (puede no existir para conciliaciones antiguas)
  const actual = await db.one(
    `SELECT estado_revision, numero_factura
     FROM conciliacion_lineas_estado
     WHERE conciliacion_id = $1 AND linea_idx = $2`,
    [conciliacionId, lineaIdx]
  );
  const estadoAnterior = actual?.estado_revision ?? null;

  // UPSERT: funciona tanto si el registro existe como si no
  await db.query(
    `INSERT INTO conciliacion_lineas_estado
       (conciliacion_id, linea_idx, estado_revision, usuario_id, usuario_nombre, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (conciliacion_id, linea_idx) DO UPDATE
       SET estado_revision = EXCLUDED.estado_revision,
           usuario_id      = EXCLUDED.usuario_id,
           usuario_nombre  = EXCLUDED.usuario_nombre,
           actualizado_en  = NOW()`,
    [conciliacionId, lineaIdx, estado_revision, usuarioId, usuarioNombre]
  );

  await db.query(
    `INSERT INTO conciliacion_lineas_historial
       (conciliacion_id, linea_idx, numero_factura, estado_anterior, estado_nuevo, usuario_id, usuario_nombre)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [conciliacionId, lineaIdx, actual?.numero_factura ?? null, estadoAnterior, estado_revision, usuarioId, usuarioNombre]
  );

  res.json({ ok: true });
});

// ─── POST /api/conciliacion/pdf ───────────────────────────────────────────────

router.post('/pdf', express.json(), async (req, res) => {
  const { resumen, resultados } = req.body;
  if (!resumen || !resultados) return res.status(400).json({ ok: false, error: 'resumen y resultados requeridos' });

  let buffer;
  try {
    buffer = await generarPdfConciliacion(resumen, resultados);
  } catch (err) {
    return res.status(500).json({ ok: false, error: `Error al generar PDF: ${err.message}` });
  }

  const fecha = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': `attachment; filename="conciliacion-${resumen.proveedor.replace(/\s+/g,'-')}-${fecha}.pdf"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

// ─── POST /api/conciliacion/excel ─────────────────────────────────────────────

router.post('/excel', express.json(), async (req, res) => {
  const { resumen, resultados, lineaEstados } = req.body;
  if (!resumen || !resultados) return res.status(400).json({ ok: false, error: 'resumen y resultados requeridos' });

  const estadoLabel    = { OK: 'OK', PENDIENTE_EN_SAGE: 'Pendiente SAGE', ERROR_IMPORTE: 'Error importe' };
  const revisionLabel  = { PENDIENTE: 'Pendiente revisión', REVISADA: 'Revisada' };

  const filas = resultados.map((r, idx) => {
    const rev = lineaEstados?.[idx];
    return {
      'Estado':              estadoLabel[r.estado] || r.estado,
      'Motivo':              motivoError(r),
      'Revisión':            r.estado !== 'OK' ? (revisionLabel[rev?.estado_revision] || 'Pendiente revisión') : '',
      'Revisado por':        r.estado !== 'OK' ? (rev?.usuario_nombre || '') : '',
      'Nº Factura Drive':    r.numero_factura || '',
      'Archivo':             r.nombre_archivo  || '',
      'Fecha emisión':       r.fecha_emision   || '',
      'Importe Drive':       r.importe_drive   ?? '',
      'Nº Factura SAGE':     r.sage?.numero_factura || '',
      'Fecha SAGE':          r.sage?.fecha          || '',
      'Importe SAGE':        r.sage?.importe        ?? '',
      'Diferencia':          r.diferencia           ?? '',
    };
  });

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Conciliación');

  ws['!cols'] = [
    {wch:16},{wch:50},{wch:20},{wch:22},{wch:18},{wch:36},
    {wch:14},{wch:14},{wch:18},{wch:14},{wch:14},{wch:12},
  ];

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const fecha  = new Date().toISOString().slice(0, 10);

  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="conciliacion-${resumen.proveedor.replace(/\s+/g,'-')}-${fecha}.xlsx"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

module.exports = router;
