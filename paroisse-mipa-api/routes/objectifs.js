// routes/objectifs.js
const express = require('express');
const pool    = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

// GET /api/objectifs — tous les users voient les objectifs
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM objectifs ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/objectifs
router.post('/', requireRole('superadmin'), async (req, res) => {
  const { label, montant, date_debut, date_fin } = req.body;
  if (!label || !montant || !date_debut || !date_fin) return res.status(400).json({ error: 'Champs manquants' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO objectifs (label, montant, date_debut, date_fin) VALUES ($1,$2,$3,$4) RETURNING *',
      [label, parseInt(montant), date_debut, date_fin]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/objectifs/:id
router.put('/:id', requireRole('superadmin'), async (req, res) => {
  const { label, montant, date_debut, date_fin } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE objectifs SET label=$1, montant=$2, date_debut=$3, date_fin=$4 WHERE id=$5 RETURNING *',
      [label, parseInt(montant), date_debut, date_fin, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Objectif introuvable' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/objectifs/:id
router.delete('/:id', requireRole('superadmin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM objectifs WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
