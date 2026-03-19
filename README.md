# ⛪ Paroisse MIPA — Backend API

Backend Node.js/Express connecté à **Neon PostgreSQL** pour la plateforme de gestion paroissiale.

---

## 🚀 Installation locale

```bash
# 1. Installer les dépendances
npm install

# 2. Configurer les variables d'environnement
# Le fichier .env est déjà prêt avec votre chaîne Neon

# 3. Démarrer en développement
npm run dev

# 4. Démarrer en production
npm start
```

Le serveur démarre sur **http://localhost:3001**

---

## 🌐 Déploiement sur Render (recommandé — gratuit)

1. Créez un compte sur [render.com](https://render.com)
2. **New → Web Service** → connectez votre dépôt GitHub
3. Paramètres :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Environment** : `Node`
4. Ajoutez les variables d'environnement dans l'interface Render :
   - `DATABASE_URL` = votre chaîne Neon
   - `JWT_SECRET` = une valeur secrète forte

Une fois déployé, vous obtenez une URL comme `https://paroisse-mipa-api.onrender.com`.

---

## 🔗 Connecter le frontend

Dans votre `index.html`, la ligne suivante pointe vers le backend :

```javascript
const API_BASE = window.API_URL || 'https://paroisse-mipa-api.onrender.com';
```

→ Remplacez `'https://paroisse-mipa-api.onrender.com'` par l'URL de votre backend Render.

---

## 📋 Routes disponibles

| Méthode | Route | Description | Accès |
|---------|-------|-------------|-------|
| POST | `/api/auth/login` | Connexion | Public |
| POST | `/api/auth/register` | Inscription | Public |
| GET | `/api/auth/me` | Profil courant | Connecté |
| GET | `/api/users` | Liste membres | Admin |
| POST | `/api/users` | Créer membre | Admin |
| PUT | `/api/users/:id` | Modifier membre | Admin/Soi |
| PUT | `/api/users/:id/password` | Changer mot de passe | Admin/Soi |
| GET | `/api/cotisations` | Cotisations | Connecté |
| POST | `/api/cotisations` | Soumettre paiement | Connecté |
| POST | `/api/cotisations/direct` | Valider directement | Admin |
| PUT | `/api/cotisations/:id/status` | Changer statut | Admin |
| GET | `/api/annonces` | Annonces | Connecté |
| POST | `/api/annonces` | Créer annonce | Admin |
| PUT | `/api/annonces/:id` | Modifier annonce | Admin |
| DELETE | `/api/annonces/:id` | Supprimer annonce | Admin |
| GET | `/api/objectifs` | Objectifs financiers | Connecté |
| POST | `/api/objectifs` | Créer objectif | Admin |
| PUT | `/api/objectifs/:id` | Modifier objectif | Admin |
| DELETE | `/api/objectifs/:id` | Supprimer objectif | Admin |
| GET | `/api/demandes-formule` | Demandes formule | Admin |
| POST | `/api/demandes-formule` | Faire une demande | Connecté |
| PUT | `/api/demandes-formule/:id` | Approuver/rejeter | Admin |
| GET | `/health` | Santé du serveur | Public |

---

## 🗄️ Base de données

Les tables sont **créées automatiquement** au premier démarrage :
- `users` — membres de la paroisse
- `cotisations` — paiements et cotisations
- `annonces` — annonces paroissiales
- `objectifs` — objectifs financiers
- `demandes_formule` — demandes de changement de formule

**Compte superadmin par défaut** (créé au 1er démarrage si absent) :
- Téléphone : `770000000`
- Mot de passe : `Admin@2024`

⚠️ **Changez ce mot de passe immédiatement après la première connexion !**
