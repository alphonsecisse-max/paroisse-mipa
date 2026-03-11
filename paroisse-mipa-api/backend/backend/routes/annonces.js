// routes/annonces.js
const express = require('express');
const pool    = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

// GET /api/annonces
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM annonces ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/annonces
router.post('/', requireRole('admin','superadmin'), async (req, res) => {
  const { titre, contenu, categorie, pinned, media, media_type, media_name, date_annonce } = req.body;
  if (!titre || !contenu) return res.status(400).json({ error: 'Titre et contenu requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO annonces (titre, contenu, categorie, pinned, media, media_type, media_name, auteur, date_annonce)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [titre, contenu, categorie||'événement', pinned||false,
       media||null, media_type||null, media_name||null, req.user.id,
       date_annonce||new Date().toLocaleDateString('fr-FR')]
    );
    res.status(201).json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/annonces/:id
router.put('/:id', requireRole('admin','superadmin'), async (req, res) => {
  const { titre, contenu, categorie, pinned, media, media_type, media_name } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE annonces SET
         titre      = COALESCE($1, titre),
         contenu    = COALESCE($2, contenu),
         categorie  = COALESCE($3, categorie),
         pinned     = COALESCE($4, pinned),
         media      = $5,
         media_type = $6,
         media_name = $7
       WHERE id = $8 RETURNING *`,
      [titre, contenu, categorie, pinned, media||null, media_type||null, media_name||null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Annonce introuvable' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// DELETE /api/annonces/:id
router.delete('/:id', requireRole('admin','superadmin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM annonces WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
