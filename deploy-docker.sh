#!/bin/bash
# Script de déploiement Docker pour paradata.fr

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}🐳 Déploiement Docker de paradata.fr${NC}"

# Vérifier que Docker est installé
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker n'est pas installé !${NC}"
    echo "Installation de Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo -e "${YELLOW}⚠️  Déconnectez-vous et reconnectez-vous pour utiliser Docker sans sudo${NC}"
fi

# Vérifier que docker-compose est installé
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Installation de docker-compose...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Vérifier le fichier .env
if [ ! -f .env ]; then
    echo -e "${RED}❌ Fichier .env manquant !${NC}"
    echo "Créez le fichier .env avec :"
    echo "  JWT_SECRET_KEY=\$(openssl rand -hex 32)"
    echo "  ALLOWED_ORIGINS=https://paradata.fr"
    echo "  DEBUG=false"
    exit 1
fi

# Créer le répertoire pour la base de données
mkdir -p data
chmod 755 data

# Choix du mode de déploiement
echo ""
echo "Choisissez le mode de déploiement :"
echo "  1) Simple (app seulement, Nginx externe recommandé)"
echo "  2) Complet (app + Nginx + Certbot intégré)"
read -p "Votre choix [1]: " DEPLOY_MODE
DEPLOY_MODE=${DEPLOY_MODE:-1}

if [ "$DEPLOY_MODE" = "2" ]; then
    COMPOSE_FILE="docker-compose.yml"
    
    # Obtenir le premier certificat SSL
    if [ ! -d "./certbot/conf/live/paradata.fr" ]; then
        echo -e "${YELLOW}Configuration initiale SSL...${NC}"
        mkdir -p certbot/conf certbot/www
        
        # Démarrer temporairement pour la validation HTTP
        docker-compose -f $COMPOSE_FILE up -d nginx
        
        # Obtenir le certificat
        docker-compose -f $COMPOSE_FILE run --rm certbot certonly \
            --webroot \
            --webroot-path=/var/www/certbot \
            --email admin@paradata.fr \
            --agree-tos \
            --no-eff-email \
            -d paradata.fr \
            -d www.paradata.fr
        
        docker-compose -f $COMPOSE_FILE down
    fi
else
    COMPOSE_FILE="docker-compose.simple.yml"
    echo -e "${YELLOW}⚠️  N'oubliez pas de configurer votre reverse proxy (Nginx, Caddy, etc.)${NC}"
    echo "Le service écoute sur 127.0.0.1:8000"
fi

# Construire et démarrer les containers
echo -e "${YELLOW}Construction de l'image Docker...${NC}"
docker-compose -f $COMPOSE_FILE build --no-cache

echo -e "${YELLOW}Démarrage des containers...${NC}"
docker-compose -f $COMPOSE_FILE up -d

# Attendre que l'application démarre
echo -e "${YELLOW}Vérification du démarrage...${NC}"
sleep 5

# Vérifier le statut
docker-compose -f $COMPOSE_FILE ps

echo ""
echo -e "${GREEN}✅ Déploiement terminé !${NC}"
echo ""
echo "Commandes utiles :"
echo "  - Logs en temps réel : docker-compose -f $COMPOSE_FILE logs -f"
echo "  - Redémarrer : docker-compose -f $COMPOSE_FILE restart"
echo "  - Arrêter : docker-compose -f $COMPOSE_FILE down"
echo "  - Mise à jour : docker-compose -f $COMPOSE_FILE up -d --build"
echo ""
if [ "$DEPLOY_MODE" = "1" ]; then
    echo "Application disponible sur : http://127.0.0.1:8000"
    echo "Configurez votre reverse proxy pour pointer vers ce port."
else
    echo "Application disponible sur : https://paradata.fr"
fi
