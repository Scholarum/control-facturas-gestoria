require('dotenv').config();
require('./config/migrate'); // Ejecuta las migraciones al arrancar

const express = require('express');
const { attachRequestMeta } = require('./middleware/audit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(attachRequestMeta);

// Rutas
app.use('/facturas', require('./routes/facturas'));
app.use('/ver',      require('./routes/acceso'));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));

// Manejador de errores genérico
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Error interno del servidor' });
});

app.listen(PORT, () => {
  console.log(`Servidor arrancado en http://localhost:${PORT}`);
});

module.exports = app;
