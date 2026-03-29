/**
 * Capa de base de datos — PostgreSQL via pg (node-postgres)
 *
 * Expone getDb() que devuelve el pool con helpers:
 *   await db.query(sql, params)   → { rows, rowCount }
 *   await db.one(sql, params)     → row | undefined
 *   await db.all(sql, params)     → rows[]
 *   await db.run(sql, params)     → { rowCount }
 */
const { Pool } = require('pg');
const logger = require('./logger');

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost/control_facturas';

// SSL requerido para Supabase/Neon en producción
const ssl = connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
  ? false
  : { rejectUnauthorized: false };

const pool = new Pool({ connectionString, ssl });

// ─── Wrapper con helpers ──────────────────────────────────────────────────────

const db = {
  query: (sql, params = []) => pool.query(sql, params),

  async one(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows[0];
  },

  async all(sql, params = []) {
    const res = await pool.query(sql, params);
    return res.rows;
  },

  async run(sql, params = []) {
    const res = await pool.query(sql, params);
    return { rowCount: res.rowCount, rows: res.rows };
  },
};

// ─── Inicialización (test de conexión) ───────────────────────────────────────

async function initDb() {
  await pool.query('SELECT 1');
  logger.info('PostgreSQL conectado');
}

function getDb() {
  return db;
}

module.exports = { initDb, getDb };
