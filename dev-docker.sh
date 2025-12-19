#!/bin/bash
# Démarrage rapide pour le développement local avec Docker

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}🐳 Démarrage de paradata.fr en mode développement${NC}"

# Créer le répertoire data si nécessaire
mkdir -p data

# Construire l'image
echo -e "${YELLOW}Construction de l'image...${NC}"
docker-compose -f docker-compose.dev.yml build

# Démarrer le container
echo -e "${YELLOW}Démarrage du container...${NC}"
docker-compose -f docker-compose.dev.yml up -d

# Attendre que l'app démarre
echo -e "${YELLOW}Attente du démarrage...${NC}"
sleep 3

echo ""
echo -e "${GREEN}✅ Application démarrée !${NC}"
echo ""
echo "Accès à l'application :"
echo "  - http://paradata.fr (si configuré dans /etc/hosts)"
echo "  - http://localhost"
echo "  - http://127.0.0.1:8000"
echo ""
echo "Commandes utiles :"
echo "  - Logs : docker-compose -f docker-compose.dev.yml logs -f"
echo "  - Arrêter : docker-compose -f docker-compose.dev.yml down"
echo "  - Shell : docker-compose -f docker-compose.dev.yml exec app bash"
echo ""
echo "Hot-reload activé : les modifications de code sont automatiquement prises en compte !"
