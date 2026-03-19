/**
 * ═══════════════════════════════════════════════════════════════
 *  PAROISSE MARIE IMMACULÉE — MIPA  |  Backend API
 *  Node.js + Express + PostgreSQL (Neon)
 * ═══════════════════════════════════════════════════════════════
 */

const express   = require('express');
const { Pool }  = require('pg');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const cors      = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Clé JWT (mettez une vraie valeur secrète en prod) ───
const JWT_SECRET = process.env.JWT_SECRET || 'mipa-secret-2025-changez-moi';

// ─── Connexion PostgreSQL Neon ───
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_r3Efjc4RaDBd@ep-cold-fire-aktg3fn4-pooler.c-3.us-west-2.aws.neon.tech/ParoisseMipa?sslmode=require&channel_binding=require',
  ssl: { rejectUnauthorized: false },
});

// ─── Middleware ───
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// INITIALISATION DES TABLES (crée si elles n'existent pas)
// ─────────────────────────────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        role        TEXT NOT NULL DEFAULT 'user',
        prenom      TEXT NOT NULL,
        nom         TEXT NOT NULL,
        email       TEXT,
        telephone   TEXT NOT NULL UNIQUE,
        adresse     TEXT,
        groupe      TEXT,
        password    TEXT NOT NULL,
        formule     TEXT,
        actif       BOOLEAN DEFAULT TRUE,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS cotisations (
        id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mois_idx        INTEGER,
        mois            TEXT,
        formule         TEXT,
        montant         INTEGER NOT NULL DEFAULT 0,
        type            TEXT DEFAULT 'cotisation',
        methode         TEXT,
        status          TEXT NOT NULL DEFAULT 'en_attente',
        transaction_id  TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS annonces (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        titre       TEXT NOT NULL,
        contenu     TEXT NOT NULL,
        categorie   TEXT DEFAULT 'événement',
        pinned      BOOLEAN DEFAULT FALSE,
        date        TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS objectifs (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        label       TEXT NOT NULL,
        montant     INTEGER NOT NULL DEFAULT 0,
        date_debut  TEXT,
        date_fin    TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS demandes_formule (
        id                    TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
        user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        formule_actuelle      TEXT,
        formule_demandee      TEXT NOT NULL,
        formule_demandee_label TEXT,
        status                TEXT NOT NULL DEFAULT 'en_attente',
        date                  TEXT,
        created_at            TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Vérifier s'il existe déjà un superadmin
    const { rows } = await client.query(`SELECT id FROM users WHERE role='superadmin' LIMIT 1`);
    if (rows.length === 0) {
      const hashed = await bcrypt.hash('Admin@2024', 10);
      await client.query(`
        INSERT INTO users (id, role, prenom, nom, email, telephone, adresse, groupe, password, formule, actif)
        VALUES ('superadmin', 'superadmin', 'Super', 'Admin', 'superadmin@paroisse.sn',
                '770000000', 'Parcelles Assainies, Dakar', 'Catéchèse', $1, NULL, TRUE)
        ON CONFLICT (id) DO NOTHING
      `, [hashed]);
      console.log('✅ Compte superadmin créé (tél: 770000000 / Admin@2024)');
    }

    console.log('✅ Base de données initialisée');
  } finally {
    client.release();
  }
}

// ─────────────────────────────────────────────────────────────
// MIDDLEWARE AUTH
// ─────────────────────────────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Non authentifié' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

function isAdmin(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'superadmin')
    return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
  next();
}

function isSuperAdmin(req, res, next) {
  if (req.user?.role !== 'superadmin')
    return res.status(403).json({ error: 'Accès réservé au Super Administrateur' });
  next();
}

// ─────────────────────────────────────────────────────────────
// ROUTES — AUTH
// ─────────────────────────────────────────────────────────────

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  const { telephone, password } = req.body;
  if (!telephone || !password) return res.status(400).json({ error: 'Champs manquants' });
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE telephone=$1 AND actif=TRUE`, [telephone]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Numéro ou mot de passe incorrect' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Numéro ou mot de passe incorrect' });
    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    const { password: _, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
  const { prenom, nom, email, telephone, adresse, groupe, password } = req.body;
  if (!prenom || !nom || !telephone || !password)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  try {
    const existing = await pool.query(`SELECT id FROM users WHERE telephone=$1`, [telephone]);
    if (existing.rows.length) return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password)
       VALUES ('user', $1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [prenom, nom, email || null, telephone, adresse || null, groupe || null, hashed]
    );
    const { password: _, ...safeUser } = rows[0];
    res.status(201).json(safeUser);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/auth/me
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id=$1`, [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { password: _, ...safeUser } = rows[0];
    res.json(safeUser);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTES — USERS
// ─────────────────────────────────────────────────────────────

// GET /api/users  (admin only)
app.get('/api/users', auth, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, role, prenom, nom, email, telephone, adresse, groupe, formule, actif, created_at FROM users ORDER BY created_at`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/users  (admin only)
app.post('/api/users', auth, isAdmin, async (req, res) => {
  const { prenom, nom, email, telephone, adresse, groupe, password, role } = req.body;
  if (!prenom || !nom || !telephone || !password)
    return res.status(400).json({ error: 'Champs obligatoires manquants' });
  try {
    const existing = await pool.query(`SELECT id FROM users WHERE telephone=$1`, [telephone]);
    if (existing.rows.length) return res.status(409).json({ error: 'Ce numéro est déjà utilisé' });
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [role || 'user', prenom, nom, email || null, telephone, adresse || null, groupe || null, hashed]
    );
    const { password: _, ...safeUser } = rows[0];
    res.status(201).json(safeUser);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id  (admin ou soi-même)
app.put('/api/users/:id', auth, async (req, res) => {
  const { id } = req.params;
  const isSelf = req.user.id === id;
  const isAdminRole = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isSelf && !isAdminRole) return res.status(403).json({ error: 'Accès refusé' });

  const { prenom, nom, email, telephone, adresse, groupe, role, actif, formule } = req.body;
  try {
    const updates = [];
    const values  = [];
    let idx = 1;
    if (prenom    !== undefined) { updates.push(`prenom=$${idx++}`);   values.push(prenom); }
    if (nom       !== undefined) { updates.push(`nom=$${idx++}`);      values.push(nom); }
    if (email     !== undefined) { updates.push(`email=$${idx++}`);    values.push(email); }
    if (telephone !== undefined) { updates.push(`telephone=$${idx++}`);values.push(telephone); }
    if (adresse   !== undefined) { updates.push(`adresse=$${idx++}`);  values.push(adresse); }
    if (groupe    !== undefined) { updates.push(`groupe=$${idx++}`);   values.push(groupe); }
    if (formule   !== undefined) { updates.push(`formule=$${idx++}`);  values.push(formule || null); }
    // Seuls les admins peuvent changer rôle/actif
    if (isAdminRole) {
      if (role  !== undefined) { updates.push(`role=$${idx++}`);  values.push(role); }
      if (actif !== undefined) { updates.push(`actif=$${idx++}`); values.push(actif); }
    }
    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à modifier' });
    values.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${updates.join(',')} WHERE id=$${idx} RETURNING *`, values
    );
    if (!rows.length) return res.status(404).json({ error: 'Utilisateur introuvable' });
    const { password: _, ...safeUser } = rows[0];
    res.json(safeUser);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/users/:id/password
app.put('/api/users/:id/password', auth, async (req, res) => {
  const { id } = req.params;
  const isSelf = req.user.id === id;
  const isAdminRole = req.user.role === 'admin' || req.user.role === 'superadmin';
  if (!isSelf && !isAdminRole) return res.status(403).json({ error: 'Accès refusé' });
  const { newPassword } = req.body;
  if (!newPassword || newPassword.length < 6)
    return res.status(400).json({ error: 'Mot de passe trop court (6 car. min)' });
  try {
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query(`UPDATE users SET password=$1 WHERE id=$2`, [hashed, id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTES — COTISATIONS
// ─────────────────────────────────────────────────────────────

// GET /api/cotisations
app.get('/api/cotisations', auth, async (req, res) => {
  try {
    let query, params;
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      query = `
        SELECT c.*, u.prenom || ' ' || u.nom AS user_name
        FROM cotisations c
        JOIN users u ON c.user_id = u.id
        ORDER BY c.created_at DESC
      `;
      params = [];
    } else {
      query = `
        SELECT c.*, u.prenom || ' ' || u.nom AS user_name
        FROM cotisations c
        JOIN users u ON c.user_id = u.id
        WHERE c.user_id = $1
        ORDER BY c.created_at DESC
      `;
      params = [req.user.id];
    }
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cotisations  (soumettre un paiement)
app.post('/api/cotisations', auth, async (req, res) => {
  const { mois_indices, formule, montant, methode, transaction_id, type, mois_suppl, montant_suppl } = req.body;
  try {
    const results = [];
    // Cotisations mensuelles classiques
    if (mois_indices && mois_indices.length > 0) {
      const MOIS = ["Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre"];
      for (const idx of mois_indices) {
        // Vérifier doublon
        const exists = await pool.query(
          `SELECT id FROM cotisations WHERE user_id=$1 AND mois_idx=$2 AND status != 'annulé'`,
          [req.user.id, idx]
        );
        if (exists.rows.length) continue; // déjà soumis pour ce mois
        const { rows } = await pool.query(
          `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, methode, status, transaction_id)
           VALUES ($1, $2, $3, $4, $5, 'cotisation', $6, 'en_attente', $7) RETURNING *`,
          [req.user.id, idx, MOIS[idx], formule, montant, methode, transaction_id || null]
        );
        results.push(rows[0]);
      }
    }
    // Supplément
    if (type === 'supplement' && montant_suppl) {
      const { rows } = await pool.query(
        `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, methode, status, transaction_id)
         VALUES ($1, NULL, 'Supplément', $2, $3, 'supplement', $4, 'en_attente', $5) RETURNING *`,
        [req.user.id, formule || null, montant_suppl, methode, transaction_id || null]
      );
      results.push(rows[0]);
    }
    res.status(201).json(results);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/cotisations/direct  (admin : valider directement)
app.post('/api/cotisations/direct', auth, isAdmin, async (req, res) => {
  const { user_id, mois_indices, formule } = req.body;
  if (!user_id || !mois_indices?.length)
    return res.status(400).json({ error: 'user_id et mois_indices requis' });
  try {
    const MOIS = ["Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre"];
    // Récupérer la formule de l'utilisateur si non précisée
    const { rows: userRows } = await pool.query(`SELECT formule FROM users WHERE id=$1`, [user_id]);
    const userFormule = formule || userRows[0]?.formule;

    const results = [];
    for (const idx of mois_indices) {
      // Vérifier si déjà validé
      const exists = await pool.query(
        `SELECT id FROM cotisations WHERE user_id=$1 AND mois_idx=$2 AND status='validé'`, [user_id, idx]
      );
      if (exists.rows.length) continue;
      // Mettre à jour ou insérer
      const existing = await pool.query(
        `SELECT id FROM cotisations WHERE user_id=$1 AND mois_idx=$2 AND status='en_attente'`, [user_id, idx]
      );
      if (existing.rows.length) {
        const { rows } = await pool.query(
          `UPDATE cotisations SET status='validé' WHERE id=$1 RETURNING *`, [existing.rows[0].id]
        );
        results.push(rows[0]);
      } else {
        const { rows } = await pool.query(
          `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, methode, status)
           VALUES ($1, $2, $3, $4, 0, 'cotisation', 'Direct', 'validé') RETURNING *`,
          [user_id, idx, MOIS[idx], userFormule || null]
        );
        results.push(rows[0]);
      }
    }
    res.json(results);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/cotisations/:id/status  (admin)
app.put('/api/cotisations/:id/status', auth, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['validé','rejeté','annulé','en_attente'].includes(status))
    return res.status(400).json({ error: 'Statut invalide' });
  try {
    const { rows } = await pool.query(
      `UPDATE cotisations SET status=$1 WHERE id=$2 RETURNING *`, [status, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Cotisation introuvable' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTES — ANNONCES
// ─────────────────────────────────────────────────────────────

// GET /api/annonces  (tous les utilisateurs connectés)
app.get('/api/annonces', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM annonces ORDER BY pinned DESC, created_at DESC`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/annonces  (admin)
app.post('/api/annonces', auth, isAdmin, async (req, res) => {
  const { titre, contenu, categorie, pinned, date } = req.body;
  if (!titre || !contenu) return res.status(400).json({ error: 'Titre et contenu requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO annonces (titre, contenu, categorie, pinned, date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [titre, contenu, categorie || 'événement', pinned || false, date || new Date().toLocaleDateString('fr-FR')]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/annonces/:id  (admin)
app.put('/api/annonces/:id', auth, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { titre, contenu, categorie, pinned, date } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE annonces SET titre=$1, contenu=$2, categorie=$3, pinned=$4, date=$5 WHERE id=$6 RETURNING *`,
      [titre, contenu, categorie, pinned, date, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Annonce introuvable' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/annonces/:id  (admin)
app.delete('/api/annonces/:id', auth, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM annonces WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTES — OBJECTIFS
// ─────────────────────────────────────────────────────────────

// GET /api/objectifs
app.get('/api/objectifs', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM objectifs ORDER BY created_at DESC`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/objectifs  (admin)
app.post('/api/objectifs', auth, isAdmin, async (req, res) => {
  const { label, montant, dateDebut, dateFin } = req.body;
  if (!label || !montant) return res.status(400).json({ error: 'label et montant requis' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO objectifs (label, montant, date_debut, date_fin) VALUES ($1, $2, $3, $4) RETURNING *`,
      [label, montant, dateDebut || null, dateFin || null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/objectifs/:id  (admin)
app.put('/api/objectifs/:id', auth, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { label, montant, dateDebut, dateFin } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE objectifs SET label=$1, montant=$2, date_debut=$3, date_fin=$4 WHERE id=$5 RETURNING *`,
      [label, montant, dateDebut || null, dateFin || null, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Objectif introuvable' });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/objectifs/:id  (admin)
app.delete('/api/objectifs/:id', auth, isAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query(`DELETE FROM objectifs WHERE id=$1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTES — DEMANDES DE FORMULE
// ─────────────────────────────────────────────────────────────

// GET /api/demandes-formule
app.get('/api/demandes-formule', auth, isAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*, u.prenom || ' ' || u.nom AS user_name
      FROM demandes_formule d
      JOIN users u ON d.user_id = u.id
      ORDER BY d.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/demandes-formule
app.post('/api/demandes-formule', auth, async (req, res) => {
  const { formuleDemandee, formuleDemandeeLabel, formuleActuelle } = req.body;
  if (!formuleDemandee) return res.status(400).json({ error: 'formuleDemandee requis' });
  try {
    // Vérifier pas de demande déjà en cours
    const existing = await pool.query(
      `SELECT id FROM demandes_formule WHERE user_id=$1 AND status='en_attente'`, [req.user.id]
    );
    if (existing.rows.length) return res.status(409).json({ error: 'Une demande est déjà en cours' });
    const { rows } = await pool.query(
      `INSERT INTO demandes_formule (user_id, formule_actuelle, formule_demandee, formule_demandee_label, date)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, formuleActuelle || null, formuleDemandee, formuleDemandeeLabel || formuleDemandee,
       new Date().toLocaleDateString('fr-FR')]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/demandes-formule/:id  (admin : approuver/rejeter)
app.put('/api/demandes-formule/:id', auth, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['approuvé','rejeté'].includes(status))
    return res.status(400).json({ error: 'Statut invalide (approuvé|rejeté)' });
  try {
    const { rows } = await pool.query(
      `UPDATE demandes_formule SET status=$1 WHERE id=$2 RETURNING *`, [status, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Demande introuvable' });
    const demande = rows[0];
    // Si approuvé, mettre à jour la formule de l'utilisateur
    if (status === 'approuvé') {
      await pool.query(`UPDATE users SET formule=$1 WHERE id=$2`, [demande.formule_demandee, demande.user_id]);
    }
    res.json(demande);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', ts: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// ─────────────────────────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`\n⛪  Serveur MIPA démarré sur http://localhost:${PORT}`);
      console.log(`📡  Base de données : Neon PostgreSQL (ParoisseMipa)`);
      console.log(`🔑  Route santé    : GET /health\n`);
    });
  })
  .catch(err => {
    console.error('❌ Erreur initialisation DB :', err.message);
    process.exit(1);
  });
