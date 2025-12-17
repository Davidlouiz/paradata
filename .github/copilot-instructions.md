# Instructions Copilot – Alerte Parapente

- Objectif : SPA de carte des dangers collaborative ; lecture publique, écriture authentifiée avec verrous, quotas et piste d’audit.
- Stack : FastAPI + wrapper Socket.IO ASGI dans [app/main.py](app/main.py) ; base SQLite ; frontend JS « vanilla » dans [static/js](static/js).
- Lancer le serveur de dev : `uvicorn app.main:socket_app --reload` (utiliser `socket_app` pour que les WebSockets fonctionnent) ; la racine sert la SPA, `/assets` sert les fichiers statiques.
- Base de données : `init_db()` crée `users`, `zones`, `audit_log` ; suppression logique via `deleted_at` ; clés étrangères activées ; fichier `alerte_parapente.db`.
- Authentification : jetons JWT HS256 valables 30 jours stockés dans `localStorage['token']`, envoyés en en-tête `Authorization: Bearer ...` ; mots de passe hashés avec bcrypt ; tous les utilitaires d’auth dans [app/api/auth.py](app/api/auth.py).
- Forme de l’API : réponses `{success, data, error?}` ; attend du GeoJSON Polygon/MultiPolygon ; codes `zone_type` `DENSE_VEGETATION`/`REMOTE_AREA` (voir [static/js/ui.js](static/js/ui.js)).
- Quotas : limites quotidiennes 15 CREATE / 5 UPDATE / 5 DELETE (constantes dans [app/services/quota.py](app/services/quota.py)) ; `GRACE_DELETE` restaure un CREATE et ne compte pas dans DELETE ; vérifier avec `check_daily_quota` et retourner `remaining_quota` lors des écritures.
- Verrous : verrou de 15 minutes via `POST /zones/{id}/checkout` ; `PUT` requiert `locked_by` correspondant ; `PUT` libère automatiquement le verrou ; libération manuelle via `POST /zones/{id}/release` ; verrou expiré renvoie 409 ; infos de verrou à `GET /zones/{id}/lock`.
- Règles de géométrie : validation Shapely ; seulement Polygon/MultiPolygon ; la garde d’intersection érode les deux géométries d’environ ~10 cm et bloque les recouvrements au-delà d’un epsilon minuscule (voir `_geometry_intersects_existing` dans [app/api/zones.py](app/api/zones.py)).
- Audit : chaque CREATE/UPDATE/DELETE/GRACE_DELETE est enregistré dans `audit_log` ; les quotas sont dérivés de l’historique d’audit (pas de table de quotas séparée).
- Temps réel : événements Socket.IO `zone_created|updated|deleted|locked|released` ; le backend injecte `sio` via `set_sio` ; `ws_manager` suit la correspondance `sid -> user` ; logs du moteur activés pour le debug.
- État frontend : `AppState` gère les modes VIEW/DRAW/EDIT, la zone sélectionnée, le polling du statut de verrou toutes les 5 s, cache de quotas (voir [static/js/app-state.js](static/js/app-state.js)).
- Réseau frontend : wrapper `API` dans [static/js/api.js](static/js/api.js) utilise `window.location.origin`, ajoute l’en-tête du jeton, retourne le JSON parsé ou lève `{status,message,data}`.
- Temps réel frontend : chargeur `SOCKET` dans [static/js/socket.js](static/js/socket.js) charge dynamiquement la lib client, s’authentifie automatiquement avec `auth_user`, et bascule sur le polling des zones en cas de déconnexion.
- Patterns UI : le tiroir affiche les détails ou le formulaire d’édition ; le panneau des quotas est alimenté par `/auth/quota`.
- Flux des zones : sélectionner → checkout → éditer geometry/zone_type/description → `PUT` update → verrou libéré et diffusé ; les suppressions sont logiques et diffusées.
- Bénévoles : fonctionnalités de périmètres supprimées ; aucun endpoint `/volunteers`.
- Conseils de debug : le middleware journalise les 4xx/5xx dans [app/main.py](app/main.py) ; inspecter les verrous avec `sqlite3 alerte_parapente.db "SELECT id, locked_by, lock_expires_at FROM zones;"` ; quotas visibles via `/auth/quota`.
- Build/installation : `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt` ; les assets statiques sont déjà servis par FastAPI.
- Ajout d’endpoints : inclure les routers dans [app/main.py](app/main.py), imposer la connexion avec `require_login`, vérifier les quotas avant écriture, émettre des événements Socket.IO pour garder les clients synchronisés, et retourner `remaining_quota` quand pertinent.
- Toujours conserver les filtres de suppression logique (`WHERE deleted_at IS NULL`) et les vérifications de verrou sur toutes les opérations de mutation ; préférer diffuser les événements `zone_*` après le commit DB.
- Tests de validation : création/édition/suppression de polygone avec conflits de verrou, quotas, `grace delete` (120 minutes), rejet d’intersection, conflit d’expiration de verrou.

