const express = require('express');
const JSZip   = require('jszip');
const XLSX    = require('xlsx');
const router  = express.Router();

const { getDb }                     = require('../config/database');
const { registrarEvento, EVENTOS }  = require('../services/auditService');
const { buildDriveClient }          = require('../services/driveService');
const { resolveUser, requireAdmin } = require('../middleware/auth');

function parsearArchivo(a) {
  const datos = a.datos_extraidos ? JSON.parse(a.datos_extraidos) : null;
  return { ...a, datos_extraidos: datos };
}

router.use(resolveUser);

// ─── GET /api/drive ───────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  const db = getDb();
  // JOIN con proveedores para vincular automáticamente razón social y cuentas
  const archivos = await db.all(`
    SELECT da.*,
           p.razon_social,
           p.cif                  AS proveedor_cif,
           p.cuenta_contable_id,
           pc.codigo              AS cuenta_contable_codigo,
           pc.descripcion         AS cuenta_contable_desc,
           p.cuenta_gasto_id,
           pg.codigo              AS cuenta_gasto_codigo,
           pg.descripcion         AS cuenta_gasto_desc
    FROM drive_archivos da
    LEFT JOIN proveedores p
           ON p.nombre_carpeta = da.proveedor AND p.activo = true
    LEFT JOIN plan_contable pc ON pc.id = p.cuenta_contable_id
    LEFT JOIN plan_contable pg ON pg.id = p.cuenta_gasto_id
    ORDER BY da.id DESC
  `);
  res.json({ ok: true, data: archivos.map(parsearArchivo) });
});

// ─── GET /api/drive/proveedores ───────────────────────────────────────────────

router.get('/proveedores', async (req, res) => {
  const db   = getDb();
  const rows = await db.all(
    "SELECT DISTINCT proveedor FROM drive_archivos WHERE proveedor IS NOT NULL ORDER BY proveedor"
  );
  res.json({ ok: true, data: rows.map(r => r.proveedor) });
});

// ─── POST /api/drive/descargar-zip ────────────────────────────────────────────

router.post('/descargar-zip', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db       = getDb();
  const archivos = await db.all(
    'SELECT * FROM drive_archivos WHERE id = ANY($1::int[])',
    [ids]
  );

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
      zip.file(archivo.nombre_archivo, Buffer.from(resp.data));
    } catch (err) {
      fallidos.push({ id: archivo.id, nombre: archivo.nombre_archivo, error: err.message });
    }
  }

  if (fallidos.length) zip.file('_errores.json', JSON.stringify(fallidos, null, 2));

  // Los admins no modifican el estado al descargar
  const esAdmin = req.usuario?.rol === 'ADMIN';
  if (!esAdmin) {
    const idsActualizar = archivos
      .filter(a => a.estado_gestion !== 'CONTABILIZADA')
      .map(a => a.id);
    if (idsActualizar.length) {
      await db.query(
        "UPDATE drive_archivos SET estado_gestion='DESCARGADA' WHERE id = ANY($1::int[])",
        [idsActualizar]
      );
    }
  }

  const usuarioId = req.usuario?.id ?? null;
  for (const archivo of archivos) {
    registrarEvento({
      evento:    EVENTOS.DOWNLOAD,
      usuarioId,
      ip:        req.clientIp,
      userAgent: req.userAgent,
      detalle:   {
        drive_id:      archivo.id,
        nombre:        archivo.nombre_archivo,
        proveedor:     archivo.proveedor,
        estado_previo: archivo.estado_gestion,
        google_id:     archivo.google_id,
      },
    }).catch(e => console.error('[audit]', e.message));
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

router.put('/contabilizar', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db        = getDb();
  const usuarioId = req.usuario?.id ?? null;

  const archivos = await db.all(
    'SELECT id, nombre_archivo, proveedor FROM drive_archivos WHERE id = ANY($1::int[])',
    [ids]
  );

  await db.query(
    "UPDATE drive_archivos SET estado_gestion='CONTABILIZADA' WHERE id = ANY($1::int[])",
    [ids]
  );

  if (archivos.length > 0) {
    registrarEvento({
      evento:    EVENTOS.CONTABILIZAR_MASIVO,
      usuarioId,
      ip:        req.clientIp,
      userAgent: req.userAgent,
      detalle:   { count: archivos.length, facturas: archivos },
    }).catch(e => console.error('[audit]', e.message));
  }

  res.json({ ok: true, data: { contabilizadas: archivos.length } });
});

// ─── PUT /api/drive/:id/revertir ─────────────────────────────────────────────

router.put('/:id/revertir', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const archivo = await db.one('SELECT * FROM drive_archivos WHERE id = $1', [id]);
  if (!archivo) return res.status(404).json({ ok: false, error: 'Archivo no encontrado' });

  const estadoPrevio = archivo.estado_gestion;
  await db.query("UPDATE drive_archivos SET estado_gestion='PENDIENTE' WHERE id=$1", [id]);

  await registrarEvento({
    evento:    EVENTOS.REVERTIR_ESTADO,
    usuarioId: req.usuario.id,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   {
      drive_id:      archivo.id,
      nombre:        archivo.nombre_archivo,
      proveedor:     archivo.proveedor,
      estado_previo: estadoPrevio,
      estado_nuevo:  'PENDIENTE',
    },
  });

  res.json({ ok: true, data: { id, estado_gestion: 'PENDIENTE' } });
});

// ─── POST /api/drive/exportar-excel ──────────────────────────────────────────

router.post('/exportar-excel', async (req, res) => {
  const { ids } = req.body;
  if (!ids?.length) return res.status(400).json({ ok: false, error: 'ids requeridos' });

  const db       = getDb();
  const archivos = await db.all(
    `SELECT da.*,
            p.razon_social,
            pc.codigo AS cuenta_contable_codigo,
            pg.codigo AS cuenta_gasto_codigo
     FROM drive_archivos da
     LEFT JOIN proveedores p  ON p.nombre_carpeta = da.proveedor AND p.activo = true
     LEFT JOIN plan_contable pc ON pc.id = p.cuenta_contable_id
     LEFT JOIN plan_contable pg ON pg.id = p.cuenta_gasto_id
     WHERE da.id = ANY($1::int[])`,
    [ids]
  );

  if (!archivos.length) return res.status(404).json({ ok: false, error: 'Archivos no encontrados' });

  const filas = archivos.map(a => {
    const d = a.datos_extraidos ? JSON.parse(a.datos_extraidos) : {};
    const iva = Array.isArray(d.iva) ? d.iva : [];
    const ivaMap = {};
    for (const e of iva) ivaMap[e.tipo] = e;

    return {
      'ID':                   a.id,
      'Proveedor':            a.proveedor || '',
      'Razón Social':         a.razon_social || '',
      'Cta. Contable':        a.cuenta_contable_codigo || '',
      'Cta. Gasto':           a.cuenta_gasto_codigo || '',
      'Archivo':              a.nombre_archivo,
      'Nº Factura':           d.numero_factura  || '',
      'Fecha Emisión':        d.fecha_emision    || '',
      'Nombre Emisor':        d.nombre_emisor    || '',
      'CIF Emisor':           d.cif_emisor       || '',
      'Nombre Receptor':      d.nombre_receptor  || '',
      'CIF Receptor':         d.cif_receptor     || '',
      'Base 0%':              ivaMap[0]  ? ivaMap[0].base  : '',
      'Cuota IVA 0%':         ivaMap[0]  ? ivaMap[0].cuota : '',
      'Base 4%':              ivaMap[4]  ? ivaMap[4].base  : '',
      'Cuota IVA 4%':         ivaMap[4]  ? ivaMap[4].cuota : '',
      'Base 10%':             ivaMap[10] ? ivaMap[10].base  : '',
      'Cuota IVA 10%':        ivaMap[10] ? ivaMap[10].cuota : '',
      'Base 21%':             ivaMap[21] ? ivaMap[21].base  : '',
      'Cuota IVA 21%':        ivaMap[21] ? ivaMap[21].cuota : '',
      'Total Base (sin IVA)': d.total_sin_iva  ?? '',
      'Total IVA':            d.total_iva      ?? '',
      'Total Factura':        d.total_factura  ?? '',
      'Forma de Pago':        d.forma_pago      || '',
      'Fecha Vencimiento':    d.fecha_vencimiento || '',
      'Estado Extracción':    a.estado,
      'Estado Gestión':       a.estado_gestion,
    };
  });

  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas');

  ws['!cols'] = [
    {wch:6},{wch:22},{wch:30},{wch:14},{wch:14},{wch:32},{wch:16},{wch:14},
    {wch:30},{wch:14},{wch:30},{wch:14},
    {wch:10},{wch:12},{wch:10},{wch:12},{wch:10},{wch:12},{wch:10},{wch:12},
    {wch:18},{wch:12},{wch:14},
    {wch:18},{wch:16},{wch:18},{wch:16},
  ];

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  registrarEvento({
    evento:    EVENTOS.EXPORT_EXCEL,
    usuarioId: req.usuario?.id ?? null,
    ip:        req.clientIp,
    userAgent: req.userAgent,
    detalle:   { count: archivos.length, ids },
  }).catch(() => {});

  const fecha = new Date().toISOString().slice(0, 10);
  res.set({
    'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="facturas-${fecha}.xlsx"`,
    'Content-Length':      buffer.length,
  });
  res.send(buffer);
});

module.exports = router;
