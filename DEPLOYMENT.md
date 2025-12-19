# Guide de mise en production paradata.fr

## 🎯 Déploiement sur votre VPS

### Prérequis

- ✅ Serveur : `vps525199.ovh.net` (ou IP : 149.202.243.126)
- ✅ Domaine : `paradata.fr` pointant vers le serveur
- ✅ Docker et docker-compose installés
- ✅ Git configuré

## 🚀 Installation rapide (recommandé)

### 1. Cloner le projet

```bash
# Sur votre VPS
cd /home/david/git
git clone https://github.com/Davidlouiz/alerte-parapente.git paradata
cd paradata
```

### 2. Configuration de sécurité

Créer le fichier `.env` :

```bash
cat > .env << 'EOF'
# Générer une clé secrète sécurisée avec : openssl rand -hex 32
JWT_SECRET_KEY=$(openssl rand -hex 32)

# Domaines autorisés (production)
ALLOWED_ORIGINS=https://paradata.fr

# Mode production
DEBUG=false

# Base de données
DATABASE_PATH=/app/data/alerte_parapente.db
EOF
```

### 3. Déploiement Docker (2 options)

#### Option A : Mode simple (reverse proxy Nginx existant)

```bash
# Utilise docker-compose.simple.yml
docker compose -f docker-compose.simple.yml up -d

# L'app écoute sur 127.0.0.1:8000
# À configurer dans votre Nginx/reverse proxy existant
```

#### Option B : Mode complet (Nginx + SSL intégré - RECOMMANDÉ)

```bash
./deploy-docker.sh

# Le script vous demandera de choisir le mode
# Sélectionnez l'option 2 (Mode complet)
```

### 4. Vérification

```bash
# État des containers
docker compose ps

# Logs en temps réel
docker compose logs -f

# Test du site (une fois DNS propagé)
curl https://paradata.fr
```

## 📋 Commandes utiles

### Gestion des containers

```bash
# Démarrer
docker compose up -d

# Arrêter
docker compose down

# Redémarrer
docker compose restart

# Logs en temps réel
docker compose logs -f

# État des services
docker compose ps
```

### Sauvegardes

```bash
# Sauvegarde de la base de données
cp data/alerte_parapente.db data/alerte_parapente.db.backup-$(date +%Y%m%d)

# Restaurer une sauvegarde
cp data/alerte_parapente.db.backup-YYYYMMDD data/alerte_parapente.db

# Automatiser les sauvegardes quotidiennes
crontab -e
# Ajouter :
0 3 * * * cd /home/david/git/paradata && cp data/alerte_parapente.db data/alerte_parapente.db.backup-$(date +\%Y\%m\%d)
```

### Mise à jour du code

```bash
cd /home/david/git/paradata
git pull
docker compose up -d --build
```

### Accès à la base de données

```bash
# Via le container
docker compose exec app sqlite3 /app/data/alerte_parapente.db

# Exemples de requêtes utiles :
# > SELECT COUNT(*) FROM zones;
# > SELECT * FROM users;
# >🔒 Sécurité

### Firewall

```bash
# Autoriser SSH, HTTP, HTTPS
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Vérifier les règles
sudo ufw status
```

### Permissions Docker

```bash
# Vérifier les permissions du répertoire data
ls -la data/

# Corriger si nécessaire
chmod -R 755 data/
```

### Renouvellement SSL automatique

Le container `certbot` renouvelle automatiquement les certificats.

Vérifier manuellement :

```bash
docker compose exec certbot certbot renew --dry-run
```

## 📊 Monitoring

### Ressources utilisées

```bash
# Utilisation CPU/Mémoire des containers
docker stats

# Utilisation disque
docker system df
```

### Logs en cas de problème

```bash
# Logs de l'application
docker compose logs -f app

# Logs Nginx (mode complet)
docker compose logs -f nginx

# Logs Certbot (mode complet)
docker compose logs -f certbotomatiquement les certificats. Tester :

```bash
sudo certbot renew --dry-run
```

## 🐛 Dépannage

### Port déjà utilisé

```bash
# Trouver le processus
sudo lsof -i :80
sudo lsof -i :443

# Ou modifier le port dans docker-compose.yml
```

### Container ne démarre pas

```bash
# Voir les erreurs
docker compose logs app

# Vérifier le fichier .env
cat .env

# Reconstruire l'image
docker compose build --no-cache
```

### Erreur 502 Bad Gateway

```bash
# Vérifier que le container tourne
docker compose ps

# Vérifier que le port 8000 écoute
docker compose logs app | tail -20
```

### Permissions sur data/

```bash
# Corriger les permissions
chmod -R 755 /home/david/git/paradata/data/
```
