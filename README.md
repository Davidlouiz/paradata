# paradata.fr

> SPA collaborative de cartographie des zones de parapente

**Lien** : https://paradata.fr  
**Dépôt** : https://github.com/Davidlouiz/paradata

## 📋 À propos

paradata.fr est une plateforme de **lecture publique** et **écriture authentifiée** pour cartographier les zones de parapente (décollages, atterrissages, zones de préparation, accès difficiles, zones isolées).

- 🗺️ Carte interactive avec GeoJSON
- 🔒 Authentification JWT avec quotas quotidiens
- 🔄 Verrous collaboratifs (15 min) pour éviter les conflits d'édition
- 📝 Audit complet de toutes les modifications
- ⚡ WebSocket temps réel (Socket.IO)

## 🚀 Démarrage local

```bash
git clone https://github.com/Davidlouiz/paradata.git
cd paradata

# Mode développement avec Docker (recommandé)
docker compose -f docker-compose.dev.yml up -d

# Ou sans Docker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:socket_app --reload
```

Accédez à **http://localhost** (ou http://paradata.fr si configuré dans `/etc/hosts`)

## 📦 Stack technique

| Composant | Technologie |
|-----------|------------|
| Backend | FastAPI + Socket.IO |
| Base de données | SQLite |
| Frontend | JavaScript vanilla (Leaflet) |
| Authentification | JWT HS256 (30 jours) |
| Temps réel | WebSocket (Socket.IO) |
| Déploiement | Docker + Nginx |

## 📚 Documentation

- **[DEPLOYMENT-DOCKER.md](DEPLOYMENT-DOCKER.md)** - Déploiement en production
- **[COMMANDS.md](COMMANDS.md)** - Commandes utiles
- **[SECURITY.md](SECURITY.md)** - Bonnes pratiques de sécurité
- **[.github/copilot-instructions.md](.github/copilot-instructions.md)** - Architecture détaillée

## 🔐 Sécurité

- ✅ Authentification JWT HS256
- ✅ Passwords hashés (bcrypt)
- ✅ CORS restrictif
- ✅ Quotas par utilisateur (CREATE/UPDATE/DELETE)
- ✅ Verrous collaboratifs
- ✅ Audit complet
- ✅ Suppression logique (soft delete)

Voir [SECURITY.md](SECURITY.md) pour le guide complet.

## 📋 Quotas

Par utilisateur et par jour :

| Action | Limite |
|--------|--------|
| CREATE | 15 zones |
| UPDATE | 5 zones |
| DELETE | 5 zones |
| GRACE_DELETE | Restaure 1 CREATE (120 min) |

## 🔄 Verrous collaboratifs

- Durée : 15 minutes
- Évite les conflits d'édition
- Libération automatique après `PUT` ou manuelle via `POST /zones/{id}/release`
- Consultation du statut : `GET /zones/{id}/lock`

## 📝 Format de l'API

Chaque réponse : `{ success, data, error? }`

**Types de zones acceptés :**
- `DIFFICULT_ACCESS` - Zones difficiles d'accès
- `REMOTE_AREA` - Zone reculée
- `TAKEOFF` - Décollage
- `LANDING` - Atterrissage
- `PREPARATION_ZONE` - Zone de préparation

**Géométrie :** GeoJSON `Polygon` ou `MultiPolygon`

## 🤝 Contribution

Les contributions sont bienvenues !

```bash
git checkout -b feature/ma-fonctionnalite
git add .
git commit -m "feat: description"
git push origin feature/ma-fonctionnalite
```

Ouvrez une Pull Request.

## 📄 Licence

MIT

## ��‍💻 Auteur

**David Louise** - [@Davidlouiz](https://github.com/Davidlouiz)

---

## 🔗 Liens

- **Site** : https://paradata.fr
- **Dépôt** : https://github.com/Davidlouiz/paradata
- **API Docs** : https://paradata.fr/docs
- **Issues** : https://github.com/Davidlouiz/paradata/issues
