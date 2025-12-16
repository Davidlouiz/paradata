# Copilot Instructions – Alerte Parapente

- Goal: collaborative hazard map SPA; public read, authenticated write with locks, quotas, and audit trail.
- Stack: FastAPI + Socket.IO ASGI wrapper in [app/main.py](app/main.py); SQLite DB; vanilla JS frontend in [static/js](static/js).
- Run dev server: `uvicorn app.main:socket_app --reload` (use `socket_app` so WebSockets work); root serves the SPA, `/assets` serves static.
- DB: `init_db()` creates `users`, `map_objects`, `audit_log`; soft-delete via `deleted_at`; foreign keys on; stored at `alerte_parapente.db`.
- Auth: JWT HS256 30-day tokens stored in `localStorage['token']`, attached as `Authorization: Bearer ...`; bcrypt password hashes; all auth helpers in [app/api/auth.py](app/api/auth.py).
- API shape: responses are `{success, data, error?}`; expect Polygon/MultiPolygon GeoJSON; severity enum currently `NO_ALERT`/`ALERT_STANDARD` (see [static/js/ui.js](static/js/ui.js)).
- Quotas: daily limits 15 CREATE / 5 UPDATE / 5 DELETE (constants in [app/services/quota.py](app/services/quota.py)); GRACE_DELETE restores one CREATE and does not count toward DELETE; check with `check_daily_quota` and return `remaining_quota` on writes.
- Locks: 15-minute lock via `POST /map-objects/{id}/checkout`; PUT requires matching `locked_by`; PUT auto-clears lock; manual release via `POST /map-objects/{id}/release`; expired lock yields 409; lock info exposed at `GET /map-objects/{id}/lock`.
- Geometry rules: Shapely validation; only Polygon/MultiPolygon; intersection guard erodes both geometries by ~10cm and blocks overlaps above tiny epsilon (see `_geometry_intersects_existing` in [app/api/map_objects.py](app/api/map_objects.py)).
- Audit: every CREATE/UPDATE/DELETE/GRACE_DELETE entry recorded in `audit_log`; quotas derive from audit history (no separate quota table).
- Real-time: Socket.IO events `map_object_created|updated|deleted|locked|released`; backend injects `sio` via `set_sio`; `ws_manager` tracks `sid -> user` mapping; engine logs enabled for debugging.
- Frontend state: `AppState` handles modes VIEW/DRAW/EDIT, selected object, lockStatus polling every 5s, quota cache (see [static/js/app-state.js](static/js/app-state.js)).
- Frontend networking: `API` wrapper in [static/js/api.js](static/js/api.js) uses `window.location.origin`, sets token header, returns parsed JSON or throws `{status,message,data}`.
- Frontend realtime: `SOCKET` loader in [static/js/socket.js](static/js/socket.js) dynamically loads client lib, auto-authenticates with `auth_user`, and falls back to map polling if disconnected.
- UI patterns: drawer shows details or edit form; quota panel fed by `/auth/quota`.
- Map objects flow: select → checkout → edit geometry/severity/description copy → PUT update → lock released and broadcast; deletions are soft and broadcast.
- Volunteers: fonctionnalités de périmètres supprimées; aucun endpoint `/volunteers`.
- Debug tips: middleware logs 4xx/5xx in [app/main.py](app/main.py); inspect locks with `sqlite3 alerte_parapente.db "SELECT id, locked_by, lock_expires_at FROM map_objects;"`; quotas visible via `/auth/quota`.
- Build/install: `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`; static assets already served by FastAPI.
- When adding endpoints: include routers in [app/main.py](app/main.py), enforce login with `require_login`, quota-check before writes, emit Socket.IO events to keep clients in sync, and return `remaining_quota` when relevant.
- Keep soft-delete filters (`WHERE deleted_at IS NULL`) and lock checks on all mutating operations; prefer broadcasting `map_object_*` events after DB commit.
- Tests to sanity-check: create/edit/delete polygon avec conflits de verrou, quotas, grace delete (120 minutes), rejet d'intersection, conflit d'expiration de verrou.

