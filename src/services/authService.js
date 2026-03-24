const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { getDb } = require('../config/database');

const JWT_SECRET     = process.env.JWT_SECRET || 'insecure-dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';
const BCRYPT_ROUNDS  = 10;

// ─── Contraseñas ──────────────────────────────────────────────────────────────

function hashPassword(plaintext) {
  return bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
}

function verifyPassword(plaintext, hash) {
  return bcrypt.compareSync(plaintext, hash);
}

// ─── JWT ──────────────────────────────────────────────────────────────────────

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

// ─── Login ────────────────────────────────────────────────────────────────────

async function login(email, password) {
  const db   = getDb();
  const user = await db.one(
    "SELECT * FROM usuarios WHERE email = $1 AND activo = 1",
    [email.trim().toLowerCase()]
  );

  if (!user)                                        throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });
  if (!user.password_hash)                          throw Object.assign(new Error('Este usuario no tiene contraseña asignada. Contacta con el administrador.'), { status: 401 });
  if (!verifyPassword(password, user.password_hash)) throw Object.assign(new Error('Credenciales incorrectas'), { status: 401 });

  const { password_hash: _, ...safeUser } = user;
  const token = signToken({ id: user.id, rol: user.rol });
  return { token, user: safeUser };
}

// ─── Obtener usuario desde token ──────────────────────────────────────────────

async function getUserFromToken(token) {
  if (!token) return null;
  try {
    const payload = verifyToken(token);
    const db      = getDb();
    const user    = await db.one(
      "SELECT id, nombre, email, rol, activo, created_at FROM usuarios WHERE id = $1 AND activo = 1",
      [payload.id]
    );
    return user || null;
  } catch (_) {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, login, getUserFromToken };
