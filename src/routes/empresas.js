const express = require('express');
const router  = express.Router();
const { getDb } = require('../config/database');
const { resolveUser, requireAdmin, requireAuth } = require('../middleware/auth');

router.use(resolveUser);

// GET / — listar empresas con conteos
router.get('/', requireAuth, async (req, res) => {
  const db = getDb();
  const rows = await db.all(`
    SELECT e.*,
      (SELECT COUNT(*) FROM plan_contable pc WHERE pc.empresa_id = e.id AND pc.activo = true) AS num_cuentas,
      (SELECT COUNT(*) FROM drive_archivos da WHERE da.empresa_id = e.id) AS num_facturas
    FROM empresas e WHERE e.activo = true ORDER BY e.nombre
  `);
  res.json({ ok: true, data: rows });
});

// GET /:id/detalle — detalle completo de una empresa
router.get('/:id/detalle', requireAuth, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const empresa = await db.one('SELECT * FROM empresas WHERE id = $1', [id]);
  if (!empresa) return res.status(404).json({ ok: false, error: 'No encontrada' });

  const [cuentas, facturas, proveedores, lotes, conciliaciones] = await Promise.all([
    db.one('SELECT COUNT(*) AS n FROM plan_contable WHERE empresa_id = $1 AND activo = true', [id]),
    db.one('SELECT COUNT(*) AS n FROM drive_archivos WHERE empresa_id = $1', [id]),
    db.one('SELECT COUNT(*) AS n FROM proveedor_empresa WHERE empresa_id = $1', [id]),
    db.one('SELECT COUNT(*) AS n FROM lotes_exportacion_sage WHERE empresa_id = $1', [id]),
    db.one('SELECT COUNT(*) AS n FROM historial_conciliaciones WHERE empresa_id = $1', [id]),
  ]);

  res.json({ ok: true, data: {
    ...empresa,
    num_cuentas: parseInt(cuentas?.n, 10) || 0,
    num_facturas: parseInt(facturas?.n, 10) || 0,
    num_proveedores: parseInt(proveedores?.n, 10) || 0,
    num_lotes_sage: parseInt(lotes?.n, 10) || 0,
    num_conciliaciones: parseInt(conciliaciones?.n, 10) || 0,
  }});
});

// POST / — crear empresa (admin)
router.post('/', requireAdmin, express.json(), async (req, res) => {
  const { nombre, cif, direccion, telefono, email, web } = req.body;
  if (!nombre?.trim() || !cif?.trim()) return res.status(400).json({ ok: false, error: 'nombre y cif requeridos' });
  const db = getDb();
  try {
    const row = await db.one(
      `INSERT INTO empresas (nombre, cif, direccion, telefono, email, web)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [nombre.trim(), cif.trim().toUpperCase(), direccion?.trim()||null, telefono?.trim()||null, email?.trim()||null, web?.trim()||null]
    );
    res.json({ ok: true, data: row });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe una empresa con ese CIF' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PUT /:id — editar empresa (admin)
router.put('/:id', requireAdmin, express.json(), async (req, res) => {
  const { nombre, cif, direccion, telefono, email, web } = req.body;
  const id = parseInt(req.params.id, 10);
  const db = getDb();
  const row = await db.one(
    `UPDATE empresas SET nombre=$1, cif=$2, direccion=$3, telefono=$4, email=$5, web=$6
     WHERE id=$7 AND activo=true RETURNING *`,
    [nombre?.trim(), cif?.trim().toUpperCase(), direccion?.trim()||null, telefono?.trim()||null, email?.trim()||null, web?.trim()||null, id]
  );
  if (!row) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });
  res.json({ ok: true, data: row });
});

// DELETE /:id — eliminar empresa y todos sus datos asociados (admin)
router.delete('/:id', requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const db = getDb();

  const empresa = await db.one('SELECT * FROM empresas WHERE id = $1 AND activo = true', [id]);
  if (!empresa) return res.status(404).json({ ok: false, error: 'Empresa no encontrada' });

  // Contar datos asociados para informar al usuario
  const [facturas, cuentas, proveedores, lotesSage, conciliaciones] = await Promise.all([
    db.one('SELECT COUNT(*) AS n FROM drive_archivos WHERE empresa_id = $1', [id]),
    db.one('SELECT COUNT(*) AS n FROM plan_contable WHERE empresa_id = $1', [id]),
    db.one('SELECT COUNT(*) AS n FROM proveedor_empresa WHERE empresa_id = $1', [id]),
    db.one('SELECT COUNT(*) AS n FROM lotes_exportacion_sage WHERE empresa_id = $1', [id]),
    db.one('SELECT COUNT(*) AS n FROM historial_conciliaciones WHERE empresa_id = $1', [id]),
  ]);

  // Borrado en cascada — orden correcto por dependencias FK
  await db.query('DELETE FROM historial_conciliaciones WHERE empresa_id = $1', [id]);
  await db.query('DELETE FROM historial_sincronizaciones WHERE empresa_id = $1', [id]);
  await db.query('DELETE FROM lotes_exportacion_sage WHERE empresa_id = $1', [id]);
  await db.query('DELETE FROM drive_archivos WHERE empresa_id = $1', [id]);
  await db.query('DELETE FROM plan_contable WHERE empresa_id = $1', [id]);
  // proveedor_empresa y usuario_empresa tienen ON DELETE CASCADE, pero eliminamos explícitamente por claridad
  await db.query('DELETE FROM proveedor_empresa WHERE empresa_id = $1', [id]);
  await db.query('DELETE FROM usuario_empresa WHERE empresa_id = $1', [id]);
  await db.query('DELETE FROM empresas WHERE id = $1', [id]);

  const { registrarEvento, EVENTOS } = require('../services/auditService');
  registrarEvento({
    evento: EVENTOS.ELIMINAR_EMPRESA || 'ELIMINAR_EMPRESA',
    usuarioId: req.usuario?.id,
    ip: req.clientIp, userAgent: req.userAgent,
    detalle: {
      empresa_id: id, nombre: empresa.nombre, cif: empresa.cif,
      facturas_eliminadas: parseInt(facturas.n, 10),
      cuentas_eliminadas: parseInt(cuentas.n, 10),
    },
  }).catch(() => {});

  res.json({
    ok: true,
    data: {
      empresa: empresa.nombre,
      eliminados: {
        facturas: parseInt(facturas.n, 10),
        cuentas_contables: parseInt(cuentas.n, 10),
        proveedores_vinculados: parseInt(proveedores.n, 10),
        lotes_sage: parseInt(lotesSage.n, 10),
        conciliaciones: parseInt(conciliaciones.n, 10),
      },
    },
  });
});

module.exports = router;
