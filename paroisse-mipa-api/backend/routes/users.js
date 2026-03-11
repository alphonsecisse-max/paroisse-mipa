// routes/users.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
const { authMiddleware, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// GET /api/users — liste tous les users (admin+)
router.get('/', requireRole('admin','superadmin'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, role, prenom, nom, email, telephone, adresse, groupe,
              formule, actif, created_at
       FROM users ORDER BY created_at ASC`
    );

    // Récupérer toutes les cotisations pour construire l'objet cotisations par user
    const { rows: cots } = await pool.query(
      `SELECT user_id, mois_idx, status FROM cotisations WHERE type = 'cotisation'`
    );
    const cotMap = {};
    cots.forEach(c => {
      if (!cotMap[c.user_id]) cotMap[c.user_id] = {};
      if (c.mois_idx !== null) cotMap[c.user_id][c.mois_idx] = c.status;
    });

    res.json(rows.map(u => ({ ...u, cotisations: cotMap[u.id] || {} })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id — modifier un profil
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  // Un user ne peut modifier que son propre profil, sauf admin
  if (req.user.id !== id && !['admin','superadmin'].includes(req.user.role))
    return res.status(403).json({ error: 'Accès refusé' });

  const { prenom, nom, email, telephone, adresse, groupe, role, actif, formule } = req.body;
  try {
    // Vérifier doublon téléphone
    if (telephone) {
      const exist = await pool.query('SELECT id FROM users WHERE telephone=$1 AND id!=$2', [telephone, id]);
      if (exist.rows.length > 0)
        return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });
    }

    // Un user normal ne peut pas changer son rôle
    const isAdmin = ['admin','superadmin'].includes(req.user.role);
    const isSuperAdmin = req.user.role === 'superadmin';

    const { rows } = await pool.query(
      `UPDATE users SET
         prenom    = COALESCE($1, prenom),
         nom       = COALESCE($2, nom),
         email     = COALESCE($3, email),
         telephone = COALESCE($4, telephone),
         adresse   = COALESCE($5, adresse),
         groupe    = COALESCE($6, groupe),
         role      = CASE WHEN $7 AND $8::text IS NOT NULL THEN $8::varchar ELSE role END,
         actif     = CASE WHEN $9 AND $10::boolean IS NOT NULL THEN $10 ELSE actif END,
         formule   = CASE WHEN $11 AND $12::text IS NOT NULL THEN $12::varchar ELSE formule END
       WHERE id = $13 RETURNING *`,
      [prenom, nom, email, telephone, adresse, groupe,
       isSuperAdmin, role,
       isAdmin, actif,
       isAdmin, formule,
       id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { password: _, ...safe } = rows[0];
    res.json(safe);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id/password — changer son mot de passe
router.put('/:id/password', async (req, res) => {
  const { id } = req.params;
  const { oldPassword, newPassword } = req.body;
  const isSuperAdmin = req.user.role === 'superadmin';

  if (req.user.id !== id && !isSuperAdmin)
    return res.status(403).json({ error: 'Accès refusé' });

  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Nouveau mot de passe trop court' });

  try {
    const { rows } = await pool.query('SELECT password FROM users WHERE id=$1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable' });

    // Super admin peut changer sans l'ancien mot de passe
    if (!isSuperAdmin) {
      if (!oldPassword) return res.status(400).json({ error: 'Ancien mot de passe requis' });
      const ok = await bcrypt.compare(oldPassword, rows[0].password);
      if (!ok) return res.status(401).json({ error: 'Ancien mot de passe incorrect' });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password=$1 WHERE id=$2', [hash, id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users — créer un user (superadmin)
router.post('/', requireRole('superadmin'), async (req, res) => {
  const { prenom, nom, email, telephone, adresse, groupe, password, role } = req.body;
  if (!prenom || !nom || !telephone || !password)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court' });

  try {
    const exist = await pool.query('SELECT id FROM users WHERE telephone=$1', [telephone]);
    if (exist.rows.length > 0)
      return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (prenom, nom, email, telephone, adresse, groupe, password, role)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [prenom, nom, email||null, telephone, adresse||null, groupe||null, hash, role||'user']
    );
    const { password: _, ...safe } = rows[0];
    res.status(201).json({ ...safe, cotisations: {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
