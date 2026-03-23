require('dotenv').config();

const express        = require('express');
const { initDb }     = require('./config/database');
const { runMigrations } = require('./config/migrate');
const { attachRequestMeta } = require('./middleware/audit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(attachRequestMeta);

app.use('/facturas', require('./routes/facturas'));
app.use('/ver',      require('./routes/acceso'));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

async function start() {
  await initDb();
  runMigrations();
  app.listen(PORT, () => console.log(`Servidor arrancado en http://localhost:${PORT}`));
}

start().catch(err => { console.error('Error al arrancar:', err); process.exit(1); });

module.exports = app;
