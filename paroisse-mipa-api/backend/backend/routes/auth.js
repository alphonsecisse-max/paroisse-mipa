// routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const pool    = require('../db/pool');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { telephone, password } = req.body;
  if (!telephone || !password)
    return res.status(400).json({ error: 'Téléphone et mot de passe requis' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM users WHERE telephone = $1', [telephone]
    );
    const user = rows[0];
    if (!user || !user.actif)
      return res.status(401).json({ error: 'Numéro ou mot de passe incorrect' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(401).json({ error: 'Numéro ou mot de passe incorrect' });

    const token = jwt.sign(
      { id: user.id, role: user.role, prenom: user.prenom, nom: user.nom },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Récupérer les cotisations du user
    const { rows: cots } = await pool.query(
      `SELECT mois_idx, status FROM cotisations
       WHERE user_id = $1 AND type = 'cotisation'
       ORDER BY created_at ASC`,
      [user.id]
    );
    const cotisations = {};
    cots.forEach(c => { if (c.mois_idx !== null) cotisations[c.mois_idx] = c.status; });

    const { password: _, ...safeUser } = user;
    res.json({ token, user: { ...safeUser, cotisations } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { prenom, nom, email, telephone, adresse, groupe, password } = req.body;
  if (!prenom || !nom || !telephone || !password)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (6 car. min)' });

  try {
    const exist = await pool.query('SELECT id FROM users WHERE telephone = $1', [telephone]);
    if (exist.rows.length > 0)
      return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (prenom, nom, email, telephone, adresse, groupe, password, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'user') RETURNING *`,
      [prenom, nom, email||null, telephone, adresse||null, groupe||null, hash]
    );
    const { password: _, ...safeUser } = rows[0];
    res.status(201).json({ user: { ...safeUser, cotisations: {} } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me — récupère le profil complet avec cotisations à jour
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });

    const { rows: cots } = await pool.query(
      `SELECT mois_idx, status FROM cotisations
       WHERE user_id = $1 AND type = 'cotisation'
       ORDER BY created_at ASC`,
      [req.user.id]
    );
    const cotisations = {};
    cots.forEach(c => { if (c.mois_idx !== null) cotisations[c.mois_idx] = c.status; });

    const { password: _, ...safeUser } = rows[0];
    res.json({ ...safeUser, cotisations });
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
