# Copilot Instructions – Alerte Parapente

## Project Overview

**Alerte Parapente** is a real-time collaborative web map editor for paragliding hazard alerts. Non-authenticated users can view hazard polygons; authenticated users create, edit, and delete them with transactional locks and audit trails.

### Core Principles
- **Public read, authenticated write**: Anyone views; only logged-in users modify polygons
- **Transactional locks**: One user per object at a time; 15-minute expiry
- **Linear history**: Single current version per object; soft-delete only
- **Traceable changes**: All modifications record author + timestamp  
- **Daily quotas**: 20 modifications per user per day; enforced at API level

---

## Architecture

### Tech Stack
- **Backend**: FastAPI (Python 3.x) + Socket.IO for real-time sync
- **Database**: SQLite (`alerte_parapente.db`) with foreign keys enabled
- **Frontend**: Vanilla JS + Leaflet.js + Leaflet-Draw (polygon editing)
- **Real-time**: Socket.IO manages WebSocket connections; fallback to polling
- **Data**: GeoJSON polygons with `severity` enum, description, geometry validation via Shapely

### Key Architectural Points

**Backend (FastAPI + Socket.IO in app/main.py)**:
- Socket.IO wraps FastAPI via `ASGIApp(sio, app)` – single ASGI app serves both REST + WebSocket
- `ConnectionManager` (ws_manager.py) tracks `sid -> user_id` mappings and broadcasts events
- Static files served by FastAPI; frontend is pure SPA
- All responses use `{ success, data, error }` JSON format

**Database (SQLite)**:
- Schema initialized in `database.py:init_db()` – creates if missing
- Tables: `users`, `map_objects`, `audit_log`, `daily_quota`
- Indices on `deleted_at`, `locked_by`/`lock_expires_at`, `object_id` for performance
- Foreign key constraints enforced (`PRAGMA foreign_keys = ON`)

**Frontend (vanilla JS modules)**:
- `AppState` manages app-level state: `mode` (VIEW/DRAW/EDIT), `currentUser`, `selectedObject`, `lockStatus`
- `API` wraps all HTTP calls; stores JWT in `localStorage['token']`
- `SOCKET` handles real-time sync; re-connects and publishes events like `object:created`, `object:updated`, `lock:acquired`
- `DRAW` manages Leaflet-Draw for polygon creation/editing; coordinates with `AppState`
- Map layers keyed by object ID; updated on socket events

---

## Critical Implementation Details

### Lock Workflow (Central to Everything)
1. **Checkout** (`POST /map-objects/{id}/checkout`):
   - Validates object not deleted + not locked or lock expired
   - Sets `locked_by = user_id`, `lock_expires_at = now + 15 min`
   - Emits `lock:acquired` via Socket.IO; other clients see "Locked by [user]"
   - Frontend transitions to EDIT mode, enables geometry tools

2. **Update** (`PUT /map-objects/{id}`):
   - Only accepts if `locked_by == current_user` (403 if not)
   - Validates geometry via Shapely (GeoJSON → shape object)
   - **Intersection check**: `_geometry_intersects_existing()` allows boundary contacts but blocks meaningful overlaps (area > 1e-7)
   - Updates `updated_by`, `updated_at`; records in audit log
   - Auto-releases lock (sets `locked_by = NULL`)
   - Emits `object:updated` to all clients

3. **Release** (`POST /map-objects/{id}/release`):
   - Clears lock without modifying object
   - Used on cancel; lock also auto-releases after 15 min

4. **Lock Expiry**:
   - Frontend cannot know exact expiry server-side; checks timestamp sent from server
   - If `PUT` after expiry: backend returns 409 Conflict; frontend prompts "Retry checkout?"

### Quota Enforcement (quota.py)
- **Limit**: 20 per user per day (tracked in `daily_quota` table by user_id + date)
- **Check**: Before `POST /map-objects` or `PUT`, call `check_daily_quota(user_id)`; returns bool
- **Increment**: After successful write, call `increment_daily_quota(user_id)` (UPSERT pattern)
- **Remaining**: `get_remaining_quota(user_id)` returned to frontend; blocks UI if 0

### Soft Delete
- `DELETE /map-objects/{id}` sets `deleted_at = now`; never removes row
- Public API (`GET /map-objects`) filters `WHERE deleted_at IS NULL`
- Audit log preserved; deleted object visible to admins (if audit endpoint added)

### Authentication (auth.py)
- **JWT**: 30-day tokens; stored in `localStorage['token']`; sent via `Authorization: Bearer <token>` header
- **Password**: Hashed with bcrypt (`passlib[bcrypt]`)
- **Get current user**: `get_current_user()` dependency decodes JWT + queries DB; returns user dict or None
- **Require login**: `@require_login` decorator wraps authenticated endpoints; raises 401 if not authed

### Geometry Validation (map_objects.py)
- **Input**: GeoJSON dict (type + coordinates)
- **Shapely check**: `shape(geom_json)` must not raise; validates format
- **Intersection**: Compares with all non-deleted objects; blocks if area > 1e-7
- **Error**: Returns 422 with detail if invalid

---

## Frontend State Machine (app-state.js)

```
       VIEW (default)
      /    \
   DRAW    EDIT
    |        |
   (finish)  (checkout ok)
    |        |
   POST /map-objects  PUT /map-objects
    |                 |
   (callback)      (release lock)
    |                 |
   broadcast         broadcast
   all clients       all clients
```

**State shape**:
```javascript
{
  mode: 'VIEW' | 'DRAW' | 'EDIT',
  isAuthenticated: bool,
  currentUser: { id, username, ... } | null,
  selectedObjectId: int | null,
  selectedObject: MapObjectResponse | null,
  editingObject: MapObjectResponse | null, // copy before PUT
  lockStatus: { locked_by, lock_expires_at } | null,
  drawnGeometry: GeoJSON | null,
  remainingQuota: int | null,
}
```

**Subscribe to changes**: `AppState.subscribe(callback)` – called on every state mutation; re-render UI

---

## Real-Time Sync (Socket.IO in socket.js + main.py)

**Events emitted by server**:
- `object:created` – new polygon; all clients add to map
- `object:updated` – geometry/severity changed; all clients refresh
- `object:deleted` – soft-delete; remove from all clients' maps
- `lock:acquired` – user acquired lock; other clients see "In use"
- `lock:released` – lock freed; other clients can edit

**Flow**:
1. Frontend connects; sends `auth_user` event with user_id (if authed)
2. Backend stores in `ConnectionManager`; socket event handler broadcasts to all sids
3. On DB change, backend emits event; middleware can inject data or just signal change
4. Frontend re-fetches object or updates local layer

**Fallback**: If Socket.IO unavailable, frontend falls back to polling (configurable interval)

---

## Common Patterns & Conventions

**Auth guard** (API endpoints):
```python
from app.api.auth import require_login

@router.post("/map-objects")
async def create(user: dict = Depends(require_login), ...):
    # user is guaranteed non-null here
```

**Quota check** (before writes):
```python
from app.services.quota import check_daily_quota

if not check_daily_quota(user['id']):
    raise HTTPException(status_code=429, detail="Daily limit reached")
increment_daily_quota(user['id'])  # After successful insert
```

**Soft delete** (queries):
```sql
SELECT * FROM map_objects WHERE deleted_at IS NULL
```

**Lock validation** (before PUT):
```python
if obj['locked_by'] != user['id']:
    raise HTTPException(status_code=403, detail="Object locked")
```

**WebSocket broadcast** (after DB change):
```python
await sio.emit('object:updated', data, to=[user's sids])  # or to all
```

**Frontend API calls** (api.js):
```javascript
const res = await API.request('POST', '/map-objects', { geometry, severity, description });
if (res.success) {
  // update state, emit event
}
```

---

## Development Workflow

### Local Setup
```bash
cd /home/david/git/alerte-parapente
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
# Browser: http://localhost:8000
```

### Common Tasks
- **Add endpoint**: Create in `app/api/*.py`, include in `app/main.py:app.include_router()`
- **Add database field**: Modify schema in `database.py:init_db()` (SQLite auto-creates on first run; manual migration for existing DBs)
- **Add real-time event**: Emit in `map_objects.py`, handle in `socket.js` event listeners
- **Debug locks**: Check `sqlite3 alerte_parapente.db "SELECT id, locked_by, lock_expires_at FROM map_objects;"`
- **Clear quota**: `sqlite3 alerte_parapente.db "DELETE FROM daily_quota;"`

### Testing Checklist
1. **Create polygon**: POST → verify appears on all clients' maps in real-time (Socket.IO)
2. **Edit with lock**: Checkout → modify → PUT → verify lock auto-releases; other clients can edit
3. **Lock conflict**: Two users simultaneously try to edit; second sees "In use by [user]"
4. **Quota limit**: Create 20+ objects in one day; 21st blocked (429)
5. **Intersection**: Draw polygon overlapping existing; verify rejected (422)
6. **Soft delete**: Delete → verify hidden from public API; row still in DB
7. **Lock expiry**: Acquire lock → wait 15+ min → try PUT → should get 409 or forced re-checkout

### Key Files Reference
- **Backend entry**: `app/main.py`
- **API endpoints**: `app/api/map_objects.py` (CRUD + locking), `app/api/auth.py`
- **Services**: `app/services/quota.py`, `app/services/ws_manager.py`
- **Database**: `app/database.py` (schema + connection)
- **Frontend logic**: `static/js/app-state.js` (state), `static/js/socket.js` (real-time), `static/js/api.js` (HTTP)
- **UI**: `static/js/ui.js`, `static/css/style.css`

---

## When Adding Features

1. **Understand lock semantics** – most bugs involve mishandled lock state
2. **Validate geometry early** – Shapely catches bad GeoJSON; validate bbox/intersection too
3. **Check quotas before writes** – always call before `INSERT`/`UPDATE`
4. **Emit socket events** – broadcast changes so all clients stay in sync
5. **Test lock expiry** – edge case: what if user clicks save just after 15-min expiry?
6. **Preserve audit trail** – always log who changed what in `audit_log`
7. **Filter soft-deletes** – all queries should include `WHERE deleted_at IS NULL`

---

## Security Notes
- **SECRET_KEY** in `auth.py` is placeholder; set from env in production
- **CORS**: Currently allows all origins; restrict in production
- **JWT expiry**: 30 days; short for production (adjust `ACCESS_TOKEN_EXPIRE_MINUTES`)
- **SQLite**: Fine for single-server; switch to PostgreSQL for distributed deployments

