# 📚 Commandes Utiles - paradata.fr

## 🚀 Démarrage et arrêt

### Démarrer l'application

```bash
# Avec Make (recommandé)
make dev

# Ou avec Docker Compose directement
docker compose -f docker-compose.dev.yml up -d
```

### Arrêter l'application

```bash
# Avec Make
make dev-stop

# Ou avec Docker Compose
docker compose -f docker-compose.dev.yml down
```

### Redémarrer l'application

```bash
# Avec Make
make dev-restart

# Ou avec Docker Compose
docker compose -f docker-compose.dev.yml restart
```

---

## 📋 Logs et débogage

### Voir les logs en temps réel

```bash
# Avec Make
make dev-logs

# Ou avec Docker Compose
docker compose -f docker-compose.dev.yml logs -f

# Voir les 50 dernières lignes
docker compose -f docker-compose.dev.yml logs --tail=50

# Logs de l'application uniquement
docker compose -f docker-compose.dev.yml logs -f app
```

### Vérifier l'état des containers

```bash
# État des services
docker compose -f docker-compose.dev.yml ps

# Utilisation des ressources
docker stats

# Vérifier que l'app répond
curl http://localhost:8000
curl http://paradata.fr
```

---

## 🐚 Shell et accès direct

### Accéder au shell du container

```bash
# Avec Make
make dev-shell

# Ou avec Docker Compose
docker compose -f docker-compose.dev.yml exec app bash
```

### Exécuter une commande Python

```bash
docker compose -f docker-compose.dev.yml exec app python -c "print('Hello')"

# Exemple : réinitialiser la base de données
docker compose -f docker-compose.dev.yml exec app python -c "from app.database import init_db; init_db()"
```

### Accéder à la base de données SQLite

```bash
# Avec Make
make dev-db

# Ou directement
docker compose -f docker-compose.dev.yml exec app sqlite3 /app/data/alerte_parapente.db

# Exemples de requêtes SQL
# > SELECT * FROM users;
# > SELECT COUNT(*) FROM zones;
# > SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 5;
```

---

## 🔧 Construction et mise à jour

### Reconstruire l'image (après modification de requirements.txt)

```bash
docker compose -f docker-compose.dev.yml build --no-cache
docker compose -f docker-compose.dev.yml up -d
```

### Mettre à jour après pull du code

```bash
git pull
docker compose -f docker-compose.dev.yml up -d --build
```

---

## 🧹 Nettoyage

### Supprimer les containers et volumes

```bash
# Avec Make
make clean

# Ou manuellement
docker compose -f docker-compose.dev.yml down -v
rm -rf data/
```

### Supprimer les images inutilisées

```bash
docker image prune -a
```

### Voir l'utilisation disque

```bash
docker system df
```

---

## 🌐 Accès à l'application

- **Navigateur** : http://paradata.fr (ou http://localhost)
- **Documentation API** : http://paradata.fr/docs
- **WebSocket** : ws://paradata.fr/socket.io

---

## 🧪 Tests et validation

### Lancer les tests

```bash
make test
```

### Vérifier les dépendances Python

```bash
docker compose -f docker-compose.dev.yml exec app pip list
```

### Valider le fichier .env

```bash
cat .env
```

---

## 📊 Inspections utiles

### Voir tous les containers actifs

```bash
docker ps
docker ps -a  # Inclure les arrêtés
```

### Voir les images disponibles

```bash
docker images
```

### Voir l'historique des commandes

```bash
history | grep docker
history | grep compose
```

---

## ⚡ Shortcuts Make

```bash
make help        # Afficher toute l'aide
make dev         # Démarrer
make dev-stop    # Arrêter
make dev-logs    # Logs
make dev-restart # Redémarrer
make dev-shell   # Shell
make dev-db      # SQLite
make clean       # Nettoyer
make build       # Build l'image
make test        # Tests
make deploy      # Deploy production
```

---

## 🐛 Dépannage rapide

### Port 8000 déjà utilisé

```bash
# Trouver le processus
sudo lsof -i :8000

# Tuer le processus
sudo kill -9 <PID>

# Ou utiliser un autre port dans docker-compose.dev.yml
```

### Permission refusée sur data/

```bash
# Corriger les permissions
sudo chmod -R 755 data/
sudo chown -R 1000:1000 data/
```

### Container redémarre en boucle

```bash
# Voir les logs d'erreur
docker compose -f docker-compose.dev.yml logs app

# Vérifier le .env
cat .env
```

### Réinitialiser complètement

```bash
# Tout supprimer et recommencer
make clean
make dev
```

---

## 💡 Astuces

### Suivre les logs en temps réel dans une autre fenêtre

```bash
# Terminal 1 : Démarrer l'app
make dev

# Terminal 2 : Voir les logs
make dev-logs

# Terminal 3 : Accéder au shell
make dev-shell
```

### Hot-reload

Le code est automatiquement rechargé quand vous modifiez les fichiers dans `app/` et `static/`. Pas besoin de redémarrer !

### Sauvegarder la base de données avant tests

```bash
cp data/alerte_parapente.db data/alerte_parapente.db.backup
```

### Restaurer la base de données

```bash
cp data/alerte_parapente.db.backup data/alerte_parapente.db
```

---

## 📞 Besoin d'aide ?

- **Docs** : [DEPLOYMENT-DOCKER.md](DEPLOYMENT-DOCKER.md)
- **Configuration** : [app/config.py](app/config.py)
- **Makefile** : [Makefile](Makefile)
