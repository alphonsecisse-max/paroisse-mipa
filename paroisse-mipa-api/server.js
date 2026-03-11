// server.js
require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const app = express();

// ── CORS ──
const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('CORS non autorisé pour : ' + origin));
  },
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// ── HEALTH CHECK ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── ROUTES ──
app.use('/api/auth',             require('./routes/auth'));
app.use('/api/users',            require('./routes/users'));
app.use('/api/cotisations',      require('./routes/cotisations'));
app.use('/api/annonces',         require('./routes/annonces'));
app.use('/api/objectifs',        require('./routes/objectifs'));
app.use('/api/demandes-formule', require('./routes/demandes-formule'));

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` });
});

// ── ERREUR GLOBALE ──
app.use((err, req, res, next) => {
  console.error('Erreur :', err.message);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

// ── DÉMARRAGE ──
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 Serveur Paroisse MIPA démarré — port ${PORT}`);
  console.log(`   DB  : ${process.env.DATABASE_URL ? '✅ Neon connecté' : '❌ DATABASE_URL manquante'}`);
  console.log(`   JWT : ${process.env.JWT_SECRET  ? '✅ configuré'     : '❌ JWT_SECRET manquant'}`);
});
