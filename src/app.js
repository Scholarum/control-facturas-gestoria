require('dotenv').config();

const express           = require('express');
const cors              = require('cors');
const path              = require('path');
const fs                = require('fs');
const { initDb }        = require('./config/database');
const { runMigrations } = require('./config/migrate');
const { attachRequestMeta } = require('./middleware/audit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(attachRequestMeta);

// API routes
app.use('/api/drive',    require('./routes/gestion'));
app.use('/api/facturas', require('./routes/facturas'));
app.use('/ver',          require('./routes/acceso'));
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Servir el cliente React en producción
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api') && !req.path.startsWith('/ver')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    }
  });
}

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
