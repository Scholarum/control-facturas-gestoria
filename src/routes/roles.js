const express = require('express');
const router  = express.Router();

const { getDb }                     = require('../config/database');
const { resolveUser, requireAdmin } = require('../middleware/auth');

const RECURSOS = ['facturas','conciliacion','historial','proveedores','usuarios','configuracion','aplicar_cuentas'];

router.use(resolveUser);

// ─── Helper ───────────────────────────────────────────────────────────────────

async function getRolConPermisos(db, id) {
  const roles = await db.all('SELECT * FROM roles WHERE id = $1', [id]);
  const rol   = roles[0];
  if (!rol) return null;
  const rows  = await db.all('SELECT recurso, nivel FROM rol_permisos WHERE rol_id = $1', [id]);
  const permisos = {};
  for (const { recurso, nivel } of rows) permisos[recurso] = nivel;
  return { ...rol, permisos };
}

// ─── GET /api/roles ───────────────────────────────────────────────────────────

router.get('/', requireAdmin, async (req, res) => {
  try {
    const db    = getDb();
    const roles = await db.all('SELECT * FROM roles ORDER BY id');
    const pRows = await db.all('SELECT * FROM rol_permisos ORDER BY rol_id');

    const data = roles.map(r => ({
      ...r,
      permisos: pRows
        .filter(p => p.rol_id === r.id)
        .reduce((acc, p) => { acc[p.recurso] = p.nivel; return acc; }, {}),
    }));
    res.json({ ok: true, data });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── POST /api/roles ──────────────────────────────────────────────────────────

router.post('/', requireAdmin, express.json(), async (req, res) => {
  try {
    const { nombre, descripcion, permisos = {} } = req.body;
    if (!nombre?.trim()) return res.status(400).json({ ok: false, error: 'Nombre requerido' });

    const db  = getDb();
    const ins = await db.query(
      'INSERT INTO roles (nombre, descripcion) VALUES ($1, $2) RETURNING *',
      [nombre.trim(), descripcion || null]
    );
    const rol = ins.rows[0];

    for (const recurso of RECURSOS) {
      await db.query(
        'INSERT INTO rol_permisos (rol_id, recurso, nivel) VALUES ($1, $2, $3)',
        [rol.id, recurso, permisos[recurso] || 'none']
      );
    }

    res.status(201).json({ ok: true, data: await getRolConPermisos(db, rol.id) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── PUT /api/roles/:id ───────────────────────────────────────────────────────

router.put('/:id', requireAdmin, express.json(), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const rows = await db.all('SELECT * FROM roles WHERE id = $1', [id]);
    const rol  = rows[0];
    if (!rol) return res.status(404).json({ ok: false, error: 'Rol no encontrado' });
    if (rol.nombre === 'ADMIN') return res.status(400).json({ ok: false, error: 'El rol ADMIN no se puede modificar' });

    const { nombre, descripcion, permisos = {} } = req.body;
    await db.query(
      'UPDATE roles SET nombre = $1, descripcion = $2 WHERE id = $3',
      [nombre?.trim() || rol.nombre, descripcion ?? rol.descripcion, id]
    );

    for (const recurso of RECURSOS) {
      if (permisos[recurso] !== undefined) {
        await db.query(
          `INSERT INTO rol_permisos (rol_id, recurso, nivel) VALUES ($1, $2, $3)
           ON CONFLICT (rol_id, recurso) DO UPDATE SET nivel = EXCLUDED.nivel`,
          [id, recurso, permisos[recurso]]
        );
      }
    }

    res.json({ ok: true, data: await getRolConPermisos(db, id) });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ ok: false, error: 'Ya existe un rol con ese nombre' });
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── DELETE /api/roles/:id ────────────────────────────────────────────────────

router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const db = getDb();
    const rows = await db.all('SELECT * FROM roles WHERE id = $1', [id]);
    const rol  = rows[0];
    if (!rol) return res.status(404).json({ ok: false, error: 'Rol no encontrado' });
    if (rol.es_builtin) return res.status(400).json({ ok: false, error: 'Los roles integrados no se pueden eliminar' });

    const users = await db.all("SELECT id FROM usuarios WHERE rol = $1 AND activo = 1", [rol.nombre]);
    if (users.length > 0) {
      return res.status(400).json({ ok: false, error: `${users.length} usuario(s) usan este rol. Reasígnalos primero.` });
    }

    await db.query('DELETE FROM roles WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
