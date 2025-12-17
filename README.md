# Alerte Parapente – Documentation FastAPI (FR)

Cette documentation décrit l’API backend FastAPI, son démarrage, l’authentification, les quotas, les verrous et les événements temps réel exposés à la SPA.

## Démarrage rapide

- Environnement Python:
  ```bash
  python -m venv .venv
  source .venv/bin/activate
  pip install -r requirements.txt
  ```
- Lancer le serveur de développement:
  ```bash
  uvicorn app.main:socket_app --reload
  ```
  - La racine `/` sert la SPA.
  - Le chemin `/assets` sert les fichiers statiques.
  - Utiliser l’application `socket_app` pour que les WebSockets Socket.IO fonctionnent.

## Base de données

- Fichier SQLite: `alerte_parapente.db`.
- Tables: `users`, `zones`, `audit_log`.
- Suppression logique via champ `deleted_at` (toujours filtrer avec `WHERE deleted_at IS NULL`).
- Clés étrangères activées.
- Initialisation: voir `init_db()` et les migrations (fichiers `migrate_*.py`).

## Authentification

- Jetons JWT HS256 valables 30 jours.
- Stockés côté client dans `localStorage['token']`.
- Envoyés via l’en-tête `Authorization: Bearer <token>`.
- Mots de passe hashés avec bcrypt.
- Utilitaires et endpoints d’auth dans `app/api/auth.py`.
- Toute route d’écriture doit imposer l’auth avec `require_login`.

## Format des réponses

- Chaque endpoint retourne `{ success, data, error? }`.
- Les zones attendent du GeoJSON `Polygon` ou `MultiPolygon`.
- Codes `zone_type` acceptés: `DENSE_VEGETATION`, `REMOTE_AREA` (voir `static/js/ui.js`).

## Quotas

- Limites par utilisateur et par jour:
  - CREATE: 15
  - UPDATE: 5
  - DELETE: 5
- Constantes dans `app/services/quota.py` et dérivées de l’historique `audit_log`.
- `GRACE_DELETE`: restaure un CREATE et ne compte pas dans DELETE.
- Avant chaque écriture, appeler `check_daily_quota` et retourner `remaining_quota`.
- Endpoint d’info quotas: `/auth/quota`.

## Verrous d’édition

- Acquisition: `POST /zones/{id}/checkout` (durée 15 minutes).
- Mise à jour (`PUT`) requiert que `locked_by` corresponde à l’utilisateur.
- Un `PUT` libère automatiquement le verrou.
- Libération manuelle: `POST /zones/{id}/release`.
- Verrou expiré: HTTP 409.
- Statut du verrou: `GET /zones/{id}/lock`.

## Règles de géométrie

- Validation via Shapely.
- Uniquement `Polygon` et `MultiPolygon`.
- Garde d’intersection: érosion d’environ ~10 cm de chaque géométrie; blocage des recouvrements au-delà d’un epsilon minuscule.
- Voir l’implémentation `_geometry_intersects_existing` dans `app/api/zones.py`.

## Audit

- Chaque opération CREATE, UPDATE, DELETE, GRACE_DELETE est enregistrée dans `audit_log`.
- Les quotas sont calculés à partir de cet historique (pas de table de quotas dédiée).

## Temps réel

- Événements Socket.IO émis par le backend:
  - `zone_created`
  - `zone_updated`
  - `zone_deleted`
  - `zone_locked`
  - `zone_released`
- Le backend injecte `sio` avec `set_sio`.
- `ws_manager` gère la correspondance `sid -> user`.
- Logs du moteur activés pour le debug.

## Frontend (aperçu pour intégration)

- État: `AppState` (modes VIEW/DRAW/EDIT, polling des verrous toutes les 5s, cache des quotas).
- Réseau: wrapper `API` (`static/js/api.js`) ajoute l’en-tête du jeton et retourne le JSON parsé ou lève `{status, message, data}`.
- Socket: chargeur `SOCKET` (`static/js/socket.js`) authentifie automatiquement et bascule sur le polling si déconnecté.
- UI: tiroir pour détails/édition; panneau quotas alimenté par `/auth/quota`.

## Flux d’édition des zones

1. Sélectionner une zone.
2. `checkout` pour verrouiller.
3. Éditer `geometry` / `zone_type` / `description`.
4. `PUT` pour mettre à jour (libère le verrou et diffuse l’événement temps réel).
5. Suppression logique: `DELETE` (diffusée en temps réel).

## Endpoints principaux

- Auth:
  - `POST /auth/login` – Connexion et obtention du JWT.
  - `GET /auth/me` – Infos utilisateur.
  - `GET /auth/quota` – Quotas restants.
- Zones:
  - `GET /zones` – Liste des zones (filtre suppression logique).
  - `POST /zones` – Création (vérifier quotas et géométrie).
  - `GET /zones/{id}` – Détails.
  - `PUT /zones/{id}` – Mise à jour (requiert verrou actif).
  - `DELETE /zones/{id}` – Suppression logique (peut déclencher GRACE_DELETE).
  - `POST /zones/{id}/checkout` – Verrouillage.
  - `POST /zones/{id}/release` – Libération.
  - `GET /zones/{id}/lock` – Statut du verrou.

> Remarque: les routes exactes et les champs peuvent être inspectés dans `app/api/zones.py` et `app/api/auth.py`.

## Débogage

- Middleware de journalisation des 4xx/5xx: voir `app/main.py`.
- Inspecter les verrous:
  ```bash
  sqlite3 alerte_parapente.db "SELECT id, locked_by, lock_expires_at FROM zones;"
  ```
- Vérifier les quotas: `GET /auth/quota`.

## Migrations

- Exemples disponibles à la racine: `migrate_*.py`.
- Exécuter une migration (exemple):
  ```bash
  .venv/bin/python migrate_remove_volunteer_coverage.py
  ```

## Bonnes pratiques pour ajouter un endpoint

- Inclure le router dans `app/main.py`.
- Imposer la connexion avec `require_login` pour les écritures.
- Vérifier les quotas avant toute écriture et retourner `remaining_quota`.
- Émettre les événements Socket.IO pour synchroniser les clients.
- Diffuser les événements après `commit` DB.
- Conserver les filtres `WHERE deleted_at IS NULL` et les vérifications de verrou.

---

Pour toute question, consultez le code source des modules: `app/main.py`, `app/api/auth.py`, `app/api/zones.py`, `app/services/quota.py`, `app/services/ws_manager.py`.