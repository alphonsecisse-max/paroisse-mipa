// db/init.js - Crée toutes les tables dans Neon PostgreSQL
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  const client = await pool.connect();
  try {
    console.log('🔌 Connexion à Neon PostgreSQL...');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- ─── TABLE USERS ───
      CREATE TABLE IF NOT EXISTS users (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        role        VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin','superadmin')),
        prenom      VARCHAR(100) NOT NULL,
        nom         VARCHAR(100) NOT NULL,
        email       VARCHAR(200),
        telephone   VARCHAR(20)  NOT NULL UNIQUE,
        adresse     VARCHAR(300),
        groupe      VARCHAR(200),
        password    VARCHAR(200) NOT NULL,
        formule     VARCHAR(20)  CHECK (formule IN ('5000','10000','20000','vip')),
        actif       BOOLEAN      NOT NULL DEFAULT true,
        created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
      );

      -- ─── TABLE COTISATIONS ───
      CREATE TABLE IF NOT EXISTS cotisations (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id        UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        mois_idx       INTEGER      CHECK (mois_idx BETWEEN 0 AND 9),
        mois           VARCHAR(30),
        formule        VARCHAR(20),
        montant        INTEGER      NOT NULL,
        type           VARCHAR(20)  NOT NULL DEFAULT 'cotisation' CHECK (type IN ('cotisation','supplement')),
        methode        VARCHAR(50),
        status         VARCHAR(20)  NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','validé','rejeté','annulé')),
        transaction_id VARCHAR(100),
        created_at     TIMESTAMP    NOT NULL DEFAULT NOW()
      );

      -- ─── TABLE ANNONCES ───
      CREATE TABLE IF NOT EXISTS annonces (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        titre       VARCHAR(300) NOT NULL,
        contenu     TEXT         NOT NULL,
        categorie   VARCHAR(50)  DEFAULT 'événement',
        pinned      BOOLEAN      NOT NULL DEFAULT false,
        media_url   TEXT,
        media_type  VARCHAR(20),
        media_name  VARCHAR(200),
        auteur_id   UUID         REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMP    NOT NULL DEFAULT NOW()
      );

      -- Index pour performances
      CREATE INDEX IF NOT EXISTS idx_cotisations_user_id ON cotisations(user_id);
      CREATE INDEX IF NOT EXISTS idx_cotisations_status  ON cotisations(status);
      CREATE INDEX IF NOT EXISTS idx_annonces_pinned     ON annonces(pinned);
    `);

    console.log('✅ Tables créées avec succès !');

    // Insérer le super admin par défaut
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('Admin@2024', 10);

    await client.query(`
      INSERT INTO users (id, role, prenom, nom, email, telephone, adresse, groupe, password, actif)
      VALUES (
        uuid_generate_v4(),
        'superadmin',
        'Super', 'Admin',
        'superadmin@paroisse.sn',
        '770000000',
        'Parcelles Assainies, Dakar',
        'Catéchèse',
        $1,
        true
      )
      ON CONFLICT (telephone) DO NOTHING;
    `, [hash]);

    // Admin de démo
    const hash2 = await bcrypt.hash('Admin@2024', 10);
    await client.query(`
      INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password, formule, actif)
      VALUES ('admin','Marie','Diallo','marie.diallo@paroisse.sn','771234567','Dakar Plateau','Lecteurs',$1,'10000',true)
      ON CONFLICT (telephone) DO NOTHING;
    `, [hash2]);

    // Membre de démo
    const hash3 = await bcrypt.hash('User@2024', 10);
    await client.query(`
      INSERT INTO users (role, prenom, nom, email, telephone, adresse, groupe, password, formule, actif)
      VALUES ('user','Jean','Sow','jean.sow@gmail.com','776543210','Médina, Dakar','Jeunes Trésors',$1,'5000',true)
      ON CONFLICT (telephone) DO NOTHING;
    `, [hash3]);

    // Annonces de démo
    await client.query(`
      INSERT INTO annonces (titre, contenu, categorie, pinned) VALUES
      ('Retraite spirituelle des jeunes',
       'La retraite annuelle des jeunes de la paroisse aura lieu du 15 au 17 mars 2025 au Centre Saint-Luc. Inscriptions ouvertes jusqu''au 10 mars.',
       'événement', true),
      ('Collecte de fonds – Rénovation de l''église',
       'Dans le cadre de la rénovation de notre belle église, nous lançons une grande collecte de fonds. Chaque don, petit ou grand, compte.',
       'collecte', false),
      ('Messe des familles – 1er dimanche du mois',
       'Chaque premier dimanche du mois, la messe de 10h est dédiée aux familles. Venez nombreux avec vos enfants.',
       'liturgie', true),
      ('Formation Catéchèse – Appel aux volontaires',
       'Le groupe Catéchèse recherche des volontaires pour accompagner les enfants se préparant à la première communion.',
       'formation', false)
      ON CONFLICT DO NOTHING;
    `);

    console.log('✅ Données de démonstration insérées !');
    console.log('\n📋 Comptes de démonstration :');
    console.log('   👑 Super Admin : 770000000 / Admin@2024');
    console.log('   🛡️  Admin       : 771234567 / Admin@2024');
    console.log('   👤 Membre      : 776543210 / User@2024');

  } catch (err) {
    console.error('❌ Erreur lors de l\'initialisation :', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

init().catch(console.error);
