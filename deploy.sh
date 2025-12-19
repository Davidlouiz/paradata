#!/bin/bash
# Script de déploiement pour paradata.fr

set -e  # Arrêter en cas d'erreur

echo "🚀 Déploiement de paradata.fr"

# Configuration
APP_DIR="/var/www/paradata"
APP_USER="www-data"
VENV_DIR="$APP_DIR/.venv"

# Couleurs pour l'affichage
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}1. Installation des dépendances système...${NC}"
sudo apt-get update
sudo apt-get install -y python3-pip python3-venv nginx certbot python3-certbot-nginx

echo -e "${YELLOW}2. Création du répertoire de l'application...${NC}"
sudo mkdir -p $APP_DIR
sudo chown -R $APP_USER:$APP_USER $APP_DIR

echo -e "${YELLOW}3. Copie des fichiers...${NC}"
# Adapter selon votre méthode de déploiement (git clone, rsync, etc.)
# Exemple avec rsync depuis le répertoire local :
sudo rsync -av --exclude='.venv' --exclude='__pycache__' --exclude='*.db' \
    ./ $APP_DIR/

echo -e "${YELLOW}4. Configuration de l'environnement virtuel Python...${NC}"
if [ ! -d "$VENV_DIR" ]; then
    sudo -u $APP_USER python3 -m venv $VENV_DIR
fi
sudo -u $APP_USER $VENV_DIR/bin/pip install --upgrade pip
sudo -u $APP_USER $VENV_DIR/bin/pip install -r $APP_DIR/requirements.txt

echo -e "${YELLOW}5. Configuration du fichier .env...${NC}"
if [ ! -f "$APP_DIR/.env" ]; then
    echo -e "${RED}⚠️  Fichier .env manquant !${NC}"
    echo "Créez $APP_DIR/.env avec les variables nécessaires :"
    echo "  - JWT_SECRET_KEY (générez-la avec: openssl rand -hex 32)"
    echo "  - ALLOWED_ORIGINS=https://paradata.fr,https://www.paradata.fr"
    echo "  - DEBUG=false"
    read -p "Appuyez sur Entrée une fois le fichier .env créé..."
fi

echo -e "${YELLOW}6. Initialisation de la base de données...${NC}"
cd $APP_DIR
sudo -u $APP_USER $VENV_DIR/bin/python -c "from app.database import init_db; init_db()"

echo -e "${YELLOW}7. Configuration du service systemd...${NC}"
sudo cp $APP_DIR/paradata.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable paradata
sudo systemctl restart paradata

echo -e "${YELLOW}8. Configuration de Nginx...${NC}"
sudo cp $APP_DIR/nginx-paradata.conf /etc/nginx/sites-available/paradata
sudo ln -sf /etc/nginx/sites-available/paradata /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

echo -e "${YELLOW}9. Configuration SSL avec Let's Encrypt...${NC}"
echo "Exécutez cette commande manuellement :"
echo "sudo certbot --nginx -d paradata.fr -d www.paradata.fr"
echo "Note : www.paradata.fr sera redirigé vers paradata.fr"

echo -e "${GREEN}✅ Déploiement terminé !${NC}"
echo ""
echo "Commandes utiles :"
echo "  - Voir les logs : sudo journalctl -u paradata -f"
echo "  - Redémarrer : sudo systemctl restart paradata"
echo "  - Status : sudo systemctl status paradata"
