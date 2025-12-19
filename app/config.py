"""Configuration de l'application avec variables d'environnement."""

import os
from pathlib import Path

# Charger .env si présent
env_file = Path(__file__).parent.parent / ".env"
if env_file.exists():
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())

# JWT Configuration
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 30 * 24 * 60  # 30 jours

# CORS Configuration
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "*").split(",")

# Database
DATABASE_PATH = os.getenv("DATABASE_PATH", "./alerte_parapente.db")

# Debug mode
DEBUG = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")
