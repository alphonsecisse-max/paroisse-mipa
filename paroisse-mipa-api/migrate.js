// migrate.js — Script d'initialisation de la base Neon ParoisseMipa
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function migrate() {
  const client = await pool.connect();
  console.log('✅ Connecté à Neon — ParoisseMipa');

  try {
    await client.query('BEGIN');

    // ── 1. TABLE USERS ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        role        VARCHAR(20)  NOT NULL DEFAULT 'user'
                      CHECK (role IN ('user','admin','superadmin')),
        prenom      VARCHAR(100) NOT NULL,
        nom         VARCHAR(100) NOT NULL,
        email       VARCHAR(200),
        telephone   VARCHAR(20)  NOT NULL UNIQUE,
        adresse     VARCHAR(300),
        groupe      VARCHAR(150),
        password    VARCHAR(255) NOT NULL,
        formule     VARCHAR(20)
                      CHECK (formule IN ('5000','10000','20000','vip') OR formule IS NULL),
        actif       BOOLEAN      NOT NULL DEFAULT true,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    console.log('  ✅ Table users');

    // ── 2. TABLE COTISATIONS ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS cotisations (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mois_idx       INT          CHECK (mois_idx BETWEEN 0 AND 9),
        mois           VARCHAR(20),
        formule        VARCHAR(20),
        montant        INT          NOT NULL DEFAULT 0,
        type           VARCHAR(20)  NOT NULL DEFAULT 'cotisation'
                         CHECK (type IN ('cotisation','supplement')),
        methode        VARCHAR(30)
                         CHECK (methode IN ('Wave','Orange Money','Virement Bancaire') OR methode IS NULL),
        transaction_id VARCHAR(100),
        status         VARCHAR(20)  NOT NULL DEFAULT 'en_attente'
                         CHECK (status IN ('en_attente','validé','rejeté','annulé')),
        created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    // Contrainte unique : un seul enregistrement par user/mois (cotisations normales)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS cotisations_user_mois_uniq
      ON cotisations(user_id, mois_idx)
      WHERE type = 'cotisation' AND mois_idx IS NOT NULL
    `);
    console.log('  ✅ Table cotisations');

    // ── 3. TABLE ANNONCES ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS annonces (
        id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        titre        VARCHAR(300) NOT NULL,
        contenu      TEXT         NOT NULL,
        categorie    VARCHAR(50)  DEFAULT 'événement'
                       CHECK (categorie IN ('événement','collecte','liturgie','formation')),
        pinned       BOOLEAN      NOT NULL DEFAULT false,
        media        TEXT,
        media_type   VARCHAR(20)
                       CHECK (media_type IN ('image','video','pdf','document') OR media_type IS NULL),
        media_name   VARCHAR(300),
        auteur       UUID         REFERENCES users(id) ON DELETE SET NULL,
        date_annonce VARCHAR(20),
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    console.log('  ✅ Table annonces');

    // ── 4. TABLE OBJECTIFS ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS objectifs (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        label       VARCHAR(200) NOT NULL,
        montant     INT          NOT NULL,
        date_debut  VARCHAR(20)  NOT NULL,
        date_fin    VARCHAR(20)  NOT NULL,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
    console.log('  ✅ Table objectifs');

    // ── 5. TABLE DEMANDES_FORMULE ──
    await client.query(`
      CREATE TABLE IF NOT EXISTS demandes_formule (
        id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        formule_actuelle    VARCHAR(20),
        formule_demandee    VARCHAR(20) NOT NULL,
        status              VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                              CHECK (status IN ('en_attente','approuvé','refusé')),
        traite_par          VARCHAR(200),
        traite_date         VARCHAR(20),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log('  ✅ Table demandes_formule');

    // ── 6. DONNÉES INITIALES ──
    const count = await client.query('SELECT COUNT(*) FROM users');
    if (parseInt(count.rows[0].count) === 0) {
      console.log('\n  🌱 Insertion des données initiales…');

      // Hacher les mots de passe
      const hashAdmin = await bcrypt.hash('Admin@2024', 10);
      const hashUser  = await bcrypt.hash('User@2024', 10);

      // Super Admin
      const sa = await client.query(
        `INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password, formule)
         VALUES ('superadmin','Super','Admin','superadmin@paroisse.sn','770000000',
                 'Parcelles Assainies, Dakar','Catéchèse',$1, NULL)
         RETURNING id`,
        [hashAdmin]
      );

      // Admin
      const adm = await client.query(
        `INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password, formule)
         VALUES ('admin','Marie','Diallo','marie.diallo@paroisse.sn','771234567',
                 'Dakar Plateau','Lecteurs',$1,'10000')
         RETURNING id`,
        [hashAdmin]
      );

      // User 1
      const u1 = await client.query(
        `INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password, formule)
         VALUES ('user','Jean','Sow','jean.sow@gmail.com','776543210',
                 'Médina, Dakar','Jeunes Trésors',$1,'5000')
         RETURNING id`,
        [hashUser]
      );

      // User 2
      const u2 = await client.query(
        `INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password, formule)
         VALUES ('user','Fatou','Ndiaye','fatou.ndiaye@gmail.com','775432109',
                 'Parcelles Assainies, Dakar','Chorale Marie Immaculée',$1,'20000')
         RETURNING id`,
        [hashUser]
      );

      const admId = adm.rows[0].id;
      const u1Id  = u1.rows[0].id;
      const u2Id  = u2.rows[0].id;

      // Cotisations pour admin (Marie Diallo) — 0=validé, 1=validé, 2=en_attente
      await client.query(
        `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, status)
         VALUES ($1, 0, 'Février', '10000', 1000, 'cotisation', 'validé'),
                ($1, 1, 'Mars',    '10000', 1000, 'cotisation', 'validé'),
                ($1, 2, 'Avril',   '10000', 1000, 'cotisation', 'en_attente')`,
        [admId]
      );

      // Cotisations pour Jean Sow — 0=validé, 1=en_attente
      await client.query(
        `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, methode, transaction_id, status)
         VALUES ($1, 0, 'Février', '5000', 500, 'cotisation', 'Wave', 'WAVE-1741000001', 'validé'),
                ($1, 1, 'Mars',    '5000', 500, 'cotisation', 'Wave', 'WAVE-1741234567', 'en_attente')`,
        [u1Id]
      );

      // Cotisations pour Fatou Ndiaye — 4 mois validés
      for (const [idx, mois] of [
        [0,'Février'],[1,'Mars'],[2,'Avril'],[3,'Mai']
      ]) {
        await client.query(
          `INSERT INTO cotisations (user_id, mois_idx, mois, formule, montant, type, status)
           VALUES ($1, $2, $3, '20000', 2000, 'cotisation', 'validé')`,
          [u2Id, idx, mois]
        );
      }

      // Annonces
      await client.query(
        `INSERT INTO annonces (titre, contenu, categorie, pinned, date_annonce)
         VALUES
          ('Retraite spirituelle des jeunes',
           'La retraite annuelle des jeunes de la paroisse aura lieu du 15 au 17 mars 2025 au Centre Saint-Luc. Inscriptions ouvertes jusqu''au 10 mars. Prévoir tenue décontractée et Bible.',
           'événement', true, '20/02/2025'),
          ('Collecte de fonds – Rénovation de l''église',
           'Dans le cadre de la rénovation de notre belle église, nous lançons une grande collecte de fonds. Chaque don, petit ou grand, compte pour embellir notre maison commune.',
           'collecte', false, '15/02/2025'),
          ('Messe des familles – 1er dimanche du mois',
           'Chaque premier dimanche du mois, la messe de 10h est dédiée aux familles. Venez nombreux avec vos enfants. Des activités sont prévues pour les plus jeunes après la célébration.',
           'liturgie', true, '01/03/2025'),
          ('Formation Catéchèse – Appel aux volontaires',
           'Le groupe Catéchèse recherche des volontaires pour accompagner les enfants se préparant à la première communion. Une formation sera organisée le samedi 15 mars.',
           'formation', false, '05/03/2025')`
      );

      // Objectifs
      await client.query(
        `INSERT INTO objectifs (label, montant, date_debut, date_fin)
         VALUES
          ('Objectif T1 (Fév–Avr)', 150000, '01/02/2025', '30/04/2025'),
          ('Objectif Annuel 2025',   500000, '01/01/2025', '31/12/2025')`
      );

      console.log('  ✅ Super Admin : 770000000 / Admin@2024');
      console.log('  ✅ Admin       : 771234567 / Admin@2024');
      console.log('  ✅ Membre 1    : 776543210 / User@2024');
      console.log('  ✅ Membre 2    : 775432109 / User@2024');
      console.log('  ✅ 4 annonces insérées');
      console.log('  ✅ 2 objectifs insérés');
    } else {
      console.log(`\n  ℹ️  Données déjà présentes (${count.rows[0].count} utilisateurs) — migration ignorée`);
    }

    await client.query('COMMIT');
    console.log('\n🎉 Migration terminée avec succès !');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Erreur migration :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
