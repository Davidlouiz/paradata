# Makefile pour faciliter le développement

.PHONY: help dev dev-stop dev-logs dev-restart dev-shell test clean build deploy

help: ## Afficher cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

dev: ## Démarrer en mode développement (Docker)
	@echo "🚀 Démarrage en mode développement..."
	@mkdir -p data
	@docker-compose -f docker-compose.dev.yml up -d --build
	@sleep 2
	@echo "✅ Application démarrée sur http://paradata.fr (ou http://localhost)"
	@echo "📝 Logs : make dev-logs"

dev-stop: ## Arrêter le mode développement
	@docker-compose -f docker-compose.dev.yml down

dev-logs: ## Voir les logs en temps réel
	@docker-compose -f docker-compose.dev.yml logs -f

dev-restart: ## Redémarrer le container de dev
	@docker-compose -f docker-compose.dev.yml restart

dev-shell: ## Ouvrir un shell dans le container
	@docker-compose -f docker-compose.dev.yml exec app bash

dev-db: ## Ouvrir la base de données SQLite
	@docker-compose -f docker-compose.dev.yml exec app sqlite3 /app/data/alerte_parapente.db

test: ## Lancer les tests
	@docker-compose -f docker-compose.dev.yml exec app python -m pytest

clean: ## Nettoyer les containers et volumes
	@docker-compose -f docker-compose.dev.yml down -v
	@rm -rf data/*.db

build: ## Construire l'image Docker
	@docker build -t paradata:latest .

deploy: ## Déployer en production (avec confirmation)
	@echo "⚠️  Déploiement en production !"
	@read -p "Êtes-vous sûr ? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		./deploy-docker.sh; \
	fi
