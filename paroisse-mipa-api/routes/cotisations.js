// routes/cotisations.js
const express = require('express');
const pool    = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

const MOIS = ["Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre"];

// GET /api/cotisations — liste (admin: tous, user: les siennes)
router.get('/', async (req, res) => {
  try {
    let query, params;
    if (['admin','superadmin'].includes(req.user.role)) {
      query  = `SELECT c.*, u.prenom||' '||u.nom AS user_name
                FROM cotisations c JOIN users u ON c.user_id = u.id
                ORDER BY c.created_at DESC`;
      params = [];
    } else {
      query  = `SELECT * FROM cotisations WHERE user_id = $1 ORDER BY created_at DESC`;
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cotisations — soumettre un ou plusieurs mois
router.post('/', async (req, res) => {
  const { mois_indices, methode, transaction_id, type, montant } = req.body;

  if (type === 'supplement') {
    if (!montant || montant < 100)
      return res.status(400).json({ error: 'Montant minimum 100 FCFA' });
    try {
      const { rows } = await pool.query(
        `INSERT INTO cotisations (user_id, mois, type, montant, methode, transaction_id, status)
         VALUES ($1, 'Supplément', 'supplement', $2, $3, $4, 'en_attente') RETURNING *`,
        [req.user.id, montant, methode||null, transaction_id||null]
      );
      return res.status(201).json(rows);
    } catch (err) {
      return res.status(500).json({ error: 'Erreur serveur' });
    }
  }

  // Cotisations normales
  if (!mois_indices || !Array.isArray(mois_indices) || mois_indices.length === 0)
    return res.status(400).json({ error: 'Sélectionnez au moins un mois' });

  try {
    // Récupérer le montant mensuel depuis la formule du user
    const { rows: userRows } = await pool.query('SELECT formule FROM users WHERE id=$1', [req.user.id]);
    const formule = userRows[0]?.formule;
    const FORMULES = { '5000':500, '10000':1000, '20000':2000 };
    const monthly = montant || (formule === 'vip' ? montant : FORMULES[formule] || 0);

    const created = [];
    for (const idx of mois_indices) {
      const { rows } = await pool.query(
        `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, methode, transaction_id, status)
         VALUES ($1,$2,$3,$4,$5,'cotisation',$6,$7,'en_attente')
         ON CONFLICT DO NOTHING RETURNING *`,
        [req.user.id, idx, MOIS[idx], formule, monthly, methode||null, transaction_id||null]
      );
      if (rows[0]) created.push(rows[0]);
    }
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/cotisations/:id/status — valider/rejeter (admin+)
router.put('/:id/status', requireRole('admin','superadmin'), async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const VALID = ['en_attente','validé','rejeté','annulé'];
  if (!VALID.includes(status))
    return res.status(400).json({ error: 'Statut invalide' });

  try {
    const { rows } = await pool.query(
      `UPDATE cotisations SET status=$1 WHERE id=$2 RETURNING *`,
      [status, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Paiement introuvable' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cotisations/direct — validation directe superadmin
router.post('/direct', requireRole('superadmin'), async (req, res) => {
  const { user_id, mois_indices, formule } = req.body;
  if (!user_id || !mois_indices?.length)
    return res.status(400).json({ error: 'user_id et mois_indices requis' });

  try {
    // Mettre à jour la formule si précisée
    if (formule) await pool.query('UPDATE users SET formule=$1 WHERE id=$2', [formule, user_id]);

    const { rows: userRows } = await pool.query('SELECT formule FROM users WHERE id=$1', [user_id]);
    const f = formule || userRows[0]?.formule;
    const FORMULES = { '5000':500, '10000':1000, '20000':2000 };
    const monthly = FORMULES[f] || 0;

    for (const idx of mois_indices) {
      // Upsert: si déjà en attente → valider, sinon créer validé
      const exist = await pool.query(
        `SELECT id FROM cotisations WHERE user_id=$1 AND mois_idx=$2 AND type='cotisation'`,
        [user_id, idx]
      );
      if (exist.rows.length > 0) {
        await pool.query(`UPDATE cotisations SET status='validé' WHERE id=$1`, [exist.rows[0].id]);
      } else {
        await pool.query(
          `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, status)
           VALUES ($1,$2,$3,$4,$5,'cotisation','validé')`,
          [user_id, idx, MOIS[idx], f, monthly]
        );
      }
    }
    res.json({ success: true, count: mois_indices.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
