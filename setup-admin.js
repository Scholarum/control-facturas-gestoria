/**
 * setup-admin.js — Crea o actualiza el usuario administrador maestro.
 *
 * Uso:
 *   node setup-admin.js                             → usa valores por defecto
 *   node setup-admin.js admin@empresa.com Passw0rd! → email y contraseña por arg
 */
require('dotenv').config();

const readline  = require('readline');
const { initDb, getDb }   = require('./src/config/database');
const { runMigrations }   = require('./src/config/migrate');
const { hashPassword }    = require('./src/services/authService');

async function preguntar(rl, pregunta) {
  return new Promise(resolve => rl.question(pregunta, resolve));
}

async function main() {
  await initDb();
  runMigrations();

  const db = getDb();
  const args = process.argv.slice(2);

  let email, password;

  if (args.length >= 2) {
    email    = args[0].toLowerCase();
    password = args[1];
  } else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n══════════════════════════════════════════');
    console.log('  Configuración del Administrador Maestro');
    console.log('══════════════════════════════════════════\n');
    email    = (await preguntar(rl, '  Email    : ')).trim().toLowerCase();
    password = (await preguntar(rl, '  Contraseña (mín. 8 chars): ')).trim();
    rl.close();
  }

  if (!email || !email.includes('@')) {
    console.error('\n✗ Email inválido.\n'); process.exit(1);
  }
  if (!password || password.length < 8) {
    console.error('\n✗ La contraseña debe tener al menos 8 caracteres.\n'); process.exit(1);
  }

  const hash       = hashPassword(password);
  const existente  = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);

  if (existente) {
    db.prepare("UPDATE usuarios SET password_hash=?, nombre=COALESCE(nombre,'Administrador'), rol='ADMIN', activo=1 WHERE email=?").run(hash, email);
    console.log(`\n✓ Contraseña actualizada para ${email} (rol: ADMIN)\n`);
  } else {
    db.prepare("INSERT INTO usuarios (nombre, email, password_hash, rol, activo) VALUES ('Administrador', ?, ?, 'ADMIN', 1)").run(email, hash);
    console.log(`\n✓ Administrador creado: ${email}\n`);
  }

  console.log('  Ahora puedes iniciar el servidor y acceder con estas credenciales.\n');
}

main().catch(err => { console.error('\nError:', err.message); process.exit(1); });
