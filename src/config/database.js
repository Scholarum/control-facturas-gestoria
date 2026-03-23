/**
 * Capa de base de datos — sql.js (puro WASM, sin compilación nativa)
 *
 * Expone una API compatible con better-sqlite3:
 *   db.exec(sql)
 *   db.prepare(sql).run(paramsObj | ...args)
 *   db.prepare(sql).get(paramsObj | ...args)
 *   db.prepare(sql).all(paramsObj | ...args)
 *
 * La BD se persiste en disco después de cada escritura.
 */
const initSqlJs = require('sql.js');
const fs        = require('fs');
const path      = require('path');

const DB_PATH = process.env.DB_PATH || './data/facturas.db';

// ─── Helpers de binding ───────────────────────────────────────────────────────

/**
 * Convierte el objeto de parámetros nombrados de mejor-sqlite3 ({ key: val })
 * al formato que espera sql.js ({ '@key': val, ':key': val, '$key': val }).
 */
function toSqlJsBindings(params) {
  if (!params || Array.isArray(params)) return params;   // posicionales: pasar tal cual
  const out = {};
  for (const [k, v] of Object.entries(params)) {
    // Si la clave ya lleva prefijo la dejamos; si no, añadimos '@'
    const key = /^[@:$]/.test(k) ? k : `@${k}`;
    out[key] = v ?? null;
  }
  return out;
}

// ─── Statement wrapper ────────────────────────────────────────────────────────

class Statement {
  constructor(sqlDb, sql, saveFn) {
    this._sqlDb = sqlDb;
    this._sql   = sql;
    this._save  = saveFn;
  }

  run(...args) {
    const params = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? toSqlJsBindings(args[0])
      : args;

    this._sqlDb.run(this._sql, params);
    this._save();
    return { changes: this._sqlDb.getRowsModified() };
  }

  get(...args) {
    const params = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? toSqlJsBindings(args[0])
      : args;

    const stmt = this._sqlDb.prepare(this._sql);
    if (params && (Array.isArray(params) ? params.length : Object.keys(params).length)) {
      stmt.bind(params);
    }
    const row = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return row;
  }

  all(...args) {
    const params = args.length === 1 && typeof args[0] === 'object' && !Array.isArray(args[0])
      ? toSqlJsBindings(args[0])
      : args;

    const stmt = this._sqlDb.prepare(this._sql);
    if (params && (Array.isArray(params) ? params.length : Object.keys(params).length)) {
      stmt.bind(params);
    }
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }
}

// ─── Database wrapper ─────────────────────────────────────────────────────────

class Database {
  constructor(sqlDb, dbPath) {
    this._db   = sqlDb;
    this._path = dbPath;
  }

  exec(sql) {
    this._db.run(sql);
    this._persist();
  }

  prepare(sql) {
    return new Statement(this._db, sql, () => this._persist());
  }

  _persist() {
    const data = this._db.export();
    fs.writeFileSync(this._path, Buffer.from(data));
  }
}

// ─── Inicialización (async one-time) ──────────────────────────────────────────

let _db = null;

async function initDb() {
  if (_db) return _db;

  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const SQL  = await initSqlJs();
  const data = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
  _db = new Database(new SQL.Database(data), DB_PATH);
  return _db;
}

function getDb() {
  if (!_db) throw new Error('BD no inicializada. Llama a initDb() primero.');
  return _db;
}

module.exports = { initDb, getDb };
