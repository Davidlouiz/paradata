# Guide de mise en production paradata.fr

## Prérequis

- Serveur Ubuntu/Debian avec accès root
- Nom de domaine paradata.fr pointant vers le serveur
- Python 3.8+ installé

## Installation rapide

### 1. Préparation du serveur

```bash
# Se connecter au serveur
ssh user@votre-serveur

# Cloner le projet
cd /var/www
sudo git clone https://github.com/votre-repo/alerte-parapente.git paradata
cd paradata
```

### 2. Configuration de sécurité

Créer le fichier `.env` :

```bash
sudo nano /var/www/paradata/.env
```

Contenu minimum :

```env
# IMPORTANT : Générer une clé secrète forte
JWT_SECRET_KEY=VOTRE_CLE_SECRETE_ICI

# Domaines autorisés (production)
ALLOWED_ORIGINS=https://paradata.fr

# Mode production
DEBUG=false

# Base de données
DATABASE_PATH=/var/www/paradata/alerte_parapente.db
```

**Générer une clé secrète sécurisée :**

```bash
openssl rand -hex 32
```

### 3. Déploiement automatique

```bash
cd /var/www/paradata
sudo ./deploy.sh
```

### 4. Configuration SSL (Let's Encrypt)

```bash
sudo certbot --nginx -d paradata.fr -d www.paradata.fr
```

Suivez les instructions et choisissez la redirection HTTPS automatique.

**Note :** Le sous-domaine www.paradata.fr est automatiquement redirigé vers paradata.fr (configuration Nginx).

### 5. Vérification

```bash
# Statut du service
sudo systemctl status paradata

# Logs en temps réel
sudo journalctl -u paradata -f

# Test du site
curl https://paradata.fr
```

## Commandes utiles

### Gestion du service

```bash
# Démarrer
sudo systemctl start paradata

# Arrêter
sudo systemctl stop paradata

# Redémarrer
sudo systemctl restart paradata

# Activer au démarrage
sudo systemctl enable paradata
```

### Logs et débogage

```bash
# Logs de l'application
sudo journalctl -u paradata -f

# Logs Nginx
sudo tail -f /var/log/nginx/paradata_error.log
sudo tail -f /var/log/nginx/paradata_access.log

# Test de configuration Nginx
sudo nginx -t
```

### Sauvegardes

```bash
# Sauvegarde de la base de données
sudo cp /var/www/paradata/alerte_parapente.db \
    /var/backups/paradata-$(date +%Y%m%d-%H%M%S).db

# Automatiser avec cron (tous les jours à 3h)
sudo crontab -e
# Ajouter :
0 3 * * * cp /var/www/paradata/alerte_parapente.db /var/backups/paradata-$(date +\%Y\%m\%d).db
```

### Mise à jour du code

```bash
cd /var/www/paradata
sudo git pull
sudo systemctl restart paradata
```

## Sécurité

### Firewall (UFW)

```bash
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable
```

### Permissions

```bash
# Les fichiers doivent appartenir à www-data
sudo chown -R www-data:www-data /var/www/paradata

# La base de données doit être protégée
sudo chmod 640 /var/www/paradata/alerte_parapente.db
```

## Monitoring

### Vérifier l'utilisation des ressources

```bash
# Utilisation mémoire/CPU du service
systemctl status paradata

# Processus Python
ps aux | grep uvicorn
```

### Renouvellement automatique SSL

Let's Encrypt renouvelle automatiquement les certificats. Tester :

```bash
sudo certbot renew --dry-run
```

## Dépannage

### Le service ne démarre pas

```bash
# Vérifier les logs
sudo journalctl -u paradata -n 50

# Tester manuellement
cd /var/www/paradata
sudo -u www-data .venv/bin/uvicorn app.main:socket_app --host 127.0.0.1 --port 8000
```

### Erreur 502 Bad Gateway

```bash
# Vérifier que le service tourne
sudo systemctl status paradata

# Vérifier que le port 8000 écoute
sudo netstat -tlnp | grep 8000
```

### Problèmes de WebSocket

Vérifier la configuration Nginx, notamment les en-têtes `Upgrade` et `Connection` dans la section `/socket.io/`.

## Performance

### Augmenter le nombre de workers

Modifier `/etc/systemd/system/paradata.service` :

```ini
ExecStart=/var/www/paradata/.venv/bin/uvicorn app.main:socket_app --host 127.0.0.1 --port 8000 --workers 4
```

Formule : `workers = (2 x nombre_coeurs) + 1`

Redémarrer :

```bash
sudo systemctl daemon-reload
sudo systemctl restart paradata
```

## Support

- Documentation API : https://paradata.fr/docs
- Logs : `/var/log/nginx/paradata_*.log`
- Service : `sudo journalctl -u paradata`
