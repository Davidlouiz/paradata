# Déploiement Docker de paradata.fr

## 🐳 Pourquoi Docker ?

- ✅ Installation en une commande
- ✅ Environnement isolé et reproductible
- ✅ Mises à jour simplifiées
- ✅ Pas de conflits de dépendances
- ✅ Facile à déplacer/sauvegarder

## Déploiement rapide

### 1. Prérequis

Un serveur avec :
- Ubuntu/Debian (ou autre Linux)
- Docker et docker-compose (installés automatiquement par le script)
- Domaine pointant vers le serveur

### 2. Installation

```bash
# Sur votre serveur
cd /opt
sudo git clone https://github.com/votre-repo/alerte-parapente.git paradata
cd paradata

# Créer le fichier .env
sudo nano .env
```

Contenu du fichier `.env` :

```env
# Générer avec : openssl rand -hex 32
JWT_SECRET_KEY=votre_cle_secrete_ici

ALLOWED_ORIGINS=https://paradata.fr
DEBUG=false
```

### 3. Lancer le déploiement

```bash
sudo ./deploy-docker.sh
```

Le script vous demandera de choisir :
1. **Mode simple** : Application seule (si vous avez déjà Nginx/Caddy)
2. **Mode complet** : Application + Nginx + SSL automatique

### 4. C'est tout ! 🎉

L'application est en ligne sur **https://paradata.fr**

## Deux modes de déploiement

### Mode 1 : Simple (recommandé pour VPS avec reverse proxy)

```bash
# Utilise docker-compose.simple.yml
docker-compose -f docker-compose.simple.yml up -d
```

**Avantages :**
- Plus léger (un seul container)
- Utilise votre Nginx/Caddy/Traefik existant
- Flexibilité maximale

**Configuration Nginx externe :**

```nginx
server {
    server_name paradata.fr;
    
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    
    location /socket.io/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Puis : `sudo certbot --nginx -d paradata.fr`

### Mode 2 : Complet (tout-en-un)

```bash
# Utilise docker-compose.yml
docker-compose up -d
```

**Avantages :**
- Tout inclus : app + Nginx + SSL
- Renouvellement SSL automatique
- Zéro configuration externe

**Inconvénient :**
- Occupe les ports 80/443 (conflit si Nginx déjà installé)

## Commandes utiles

### Gestion des containers

```bash
# Voir les logs en temps réel
docker-compose logs -f

# Logs de l'application uniquement
docker-compose logs -f app

# Redémarrer
docker-compose restart

# Arrêter
docker-compose down

# Arrêter et supprimer les volumes (⚠️ efface la base de données)
docker-compose down -v
```

### Mise à jour

```bash
cd /opt/paradata
git pull
docker-compose up -d --build
```

### Sauvegardes

```bash
# Sauvegarde de la base de données
docker-compose exec app cp /app/data/alerte_parapente.db /app/data/backup-$(date +%Y%m%d).db

# Ou depuis l'hôte
sudo cp data/alerte_parapente.db data/backup-$(date +%Y%m%d).db

# Automatiser avec cron
sudo crontab -e
# Ajouter :
0 3 * * * cd /opt/paradata && cp data/alerte_parapente.db data/backup-$(date +\%Y\%m\%d).db
```

### Shell dans le container

```bash
# Accéder au shell de l'application
docker-compose exec app bash

# Exécuter une commande Python
docker-compose exec app python -c "from app.database import init_db; init_db()"
```

## Monitoring

### Vérifier l'état

```bash
# État des containers
docker-compose ps

# Utilisation des ressources
docker stats

# Logs d'erreurs
docker-compose logs --tail=50 app
```

### Health check

```bash
# Vérifier que l'app répond
curl http://localhost:8000
```

## Dépannage

### Container qui redémarre en boucle

```bash
# Voir les logs
docker-compose logs app

# Vérifier le fichier .env
cat .env
```

### Problème de permissions sur data/

```bash
sudo chmod -R 755 data/
sudo chown -R 1000:1000 data/
```

### Erreur "port already in use"

```bash
# Trouver ce qui utilise le port 8000
sudo lsof -i :8000

# Ou changer le port dans docker-compose.yml
ports:
  - "127.0.0.1:9000:8000"  # Utilise 9000 au lieu de 8000
```

### Réinitialiser complètement

```bash
# Tout supprimer (⚠️ efface aussi la base de données)
docker-compose down -v
rm -rf data/

# Redéployer
./deploy-docker.sh
```

## Performance

### Augmenter les workers

Modifier le [Dockerfile](Dockerfile) :

```dockerfile
CMD ["uvicorn", "app.main:socket_app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

Puis :
```bash
docker-compose up -d --build
```

### Limiter les ressources

Dans [docker-compose.yml](docker-compose.yml) :

```yaml
services:
  app:
    # ...
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          memory: 512M
```

## Sécurité

### Firewall

```bash
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### Mettre à jour les images

```bash
# Mettre à jour l'image de base
docker-compose pull
docker-compose up -d --build
```

## Migration depuis déploiement classique

Si vous aviez déployé sans Docker :

```bash
# Copier la base de données existante
sudo cp /var/www/paradata/alerte_parapente.db /opt/paradata/data/

# Ajuster les permissions
sudo chown 1000:1000 /opt/paradata/data/alerte_parapente.db

# Arrêter l'ancien service
sudo systemctl stop paradata
sudo systemctl disable paradata

# Démarrer Docker
cd /opt/paradata
docker-compose up -d
```

## Support

- **Logs** : `docker-compose logs -f`
- **Health** : `docker-compose ps`
- **API docs** : https://paradata.fr/docs
