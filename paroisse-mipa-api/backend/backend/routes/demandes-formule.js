// routes/demandes-formule.js
const express = require('express');
const pool    = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');
const router = express.Router();
router.use(authMiddleware);

// GET /api/demandes-formule
router.get('/', async (req, res) => {
  try {
    let query, params;
    if (['admin','superadmin'].includes(req.user.role)) {
      query  = `SELECT d.*, u.prenom||' '||u.nom AS user_name FROM demandes_formule d
                JOIN users u ON d.user_id=u.id ORDER BY d.created_at DESC`;
      params = [];
    } else {
      query  = 'SELECT * FROM demandes_formule WHERE user_id=$1 ORDER BY created_at DESC';
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    // Normaliser les champs
    res.json(rows.map(d => ({
      ...d,
      userId: d.user_id,
      userName: d.user_name || '',
      formuleActuelle: d.formule_actuelle,
      formuleDemandee: d.formule_demandee,
      date: d.created_at ? new Date(d.created_at).toLocaleDateString('fr-FR') : '',
    })));
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

// POST /api/demandes-formule
router.post('/', async (req, res) => {
  const { formule_actuelle, formule_demandee } = req.body;
  if (!formule_demandee) return res.status(400).json({ error: 'Formule demandée requise' });
  try {
    // Vérifier pas de demande en cours
    const exist = await pool.query(
      "SELECT id FROM demandes_formule WHERE user_id=$1 AND status='en_attente'", [req.user.id]
    );
    if (exist.rows.length > 0) return res.status(409).json({ error: 'Demande déjà en cours' });

    const { rows } = await pool.query(
      `INSERT INTO demandes_formule (user_id, formule_actuelle, formule_demandee)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.user.id, formule_actuelle || null, formule_demandee]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: 'Erreur serveur' }); }
});

// PUT /api/demandes-formule/:id  — approuver ou refuser
router.put('/:id', requireRole('admin','superadmin'), async (req, res) => {
  const { action, traite_par } = req.body;
  const status = action === 'approuver' ? 'approuvé' : 'refusé';
  try {
    const { rows } = await pool.query(
      `UPDATE demandes_formule SET status=$1, traite_par=$2, traite_date=$3 WHERE id=$4 RETURNING *`,
      [status, traite_par || req.user.prenom + ' ' + req.user.nom,
       new Date().toLocaleDateString('fr-FR'), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Demande introuvable' });
    // Si approuvé → mettre à jour la formule du user
    if (status === 'approuvé') {
      await pool.query('UPDATE users SET formule=$1 WHERE id=$2', [rows[0].formule_demandee, rows[0].user_id]);
    }
    res.json(rows[0]);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erreur serveur' }); }
});

module.exports = router;
