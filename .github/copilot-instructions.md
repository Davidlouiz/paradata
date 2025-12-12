# Copilot Instructions – Alerte Parapente

## Project Overview

**Alerte Parapente** is a collaborative, real-time web map editor for paragliding hazard alerts. Non-authenticated users can view hazard polygons; authenticated users can create, edit, and delete them with transactional integrity and audit trails.

### Core Principles
- **Public read, authenticated write**: Anyone views the map; only logged-in users modify polygons
- **Transactional locks**: Only one user can edit an object at a time via a temporary lock mechanism
- **Linear history**: No branching; each object has one current version
- **Traceable changes**: All modifications record author + timestamp
- **Daily quotas**: Users have rate limits on modifications

---

## Architecture

### Tech Stack
- **Backend**: FastAPI (Python) – RESTful API, type-hinted, serves static files
- **Database**: SQLite – simple, deployable, schema evolution-friendly
- **Frontend**: Single-page app (SPA) using Leaflet for lightweight, performant maps
- **Data Model**: GeoJSON polygons with danger type, severity level, description, metadata

### Key Components

#### Backend API (`FastAPI`)
- **Public endpoints** (no auth):
  - `GET /map-objects` – fetch polygons in bbox
  - `GET /map-objects/{id}` – fetch single object
  - `GET /auth/me` – return current user or null
  
- **Authenticated endpoints** (require login):
  - `POST /map-objects` – create polygon
  - `POST /map-objects/{id}/checkout` – acquire lock
  - `POST /map-objects/{id}/release` – release lock
  - `PUT /map-objects/{id}` – update (only if locked by current user)
  - `DELETE /map-objects/{id}` – soft-delete (marks deleted, hides from public API)
  - `POST /auth/login`, `POST /auth/logout`

- **Quota enforcement**: Check daily usage before each write; block if exceeded

#### Frontend (Leaflet SPA)
- **States**:
  - Visitor (read-only)
  - Authenticated (can create/edit/delete)
  - In-draw (creating new polygon)
  - Locked (editing reserved polygon)
  
- **Key interactions**:
  - Click polygon → open detail drawer
  - "Create polygon" → activate draw mode → record type/severity/description → save
  - "Edit" → `POST /checkout` → enable geometry tools → save → `PUT` → auto-release lock
  - Lock conflict → show "Edited by [user]" + disable edit button
  - Esc key cancels drawing/editing

#### Database Schema
- `map_objects` table:
  - `id`, `geometry` (GeoJSON), `danger_type`, `severity`, `description`
  - `created_by` (user_id), `created_at`, `updated_by`, `updated_at`, `deleted_at`
  - `locked_by` (user_id or null), `lock_expires_at`
  
- `users` table:
  - `id`, `username`, `password_hash`, `created_at`
  
- `audit_log` table (optional):
  - `id`, `object_id`, `action`, `user_id`, `timestamp`, `before_data`, `after_data`

---

## Critical Workflows

### Creating a Polygon
1. User clicks "Create"
2. Frontend enters draw mode (Leaflet draw plugin or custom)
3. User completes polygon → form opens with danger_type, severity, description
4. On "Save": `POST /map-objects` with geometry + metadata
5. Backend validates geometry, checks quotas, inserts, returns object with ID
6. Frontend adds to map locally

### Editing a Polygon
1. User selects polygon → clicks "Edit"
2. `POST /map-objects/{id}/checkout` to acquire lock
3. If lock acquired:
   - Unlock geometry for modification
   - Show "Locked until [time]" indicator
   - Enable save/cancel buttons
4. User modifies geometry/metadata
5. On "Save": `PUT /map-objects/{id}` with new data
6. Backend validates, updates object, auto-releases lock
7. Frontend updates map, refreshes UI
8. On "Cancel": `POST /map-objects/{id}/release` → discard changes

### Lock Expiry Handling
- Lock expires after (e.g.) 15 minutes
- If user tries to save after expiry: backend returns 409 Conflict
- Frontend should prompt: "Lock expired. Acquire new lock?" → retry checkout

### Deletion
- User clicks "Delete" on selected polygon
- Confirmation dialog
- `DELETE /map-objects/{id}`
- Backend sets `deleted_at`, removes from public API responses
- Frontend removes from map immediately

---

## Project-Specific Conventions

### API Response Format
All endpoints return JSON with consistent structure:
```json
{
  "success": true,
  "data": {...},
  "error": null
}
```

### Validation Rules
- **Geometry**: Must be valid GeoJSON Polygon or MultiPolygon; coordinate bounds checked
- **Severity level**: Enum (`SAFE`, `LOW_RISK`, `RISK`, `HIGH_RISK`, `CRITICAL`)
- **Description**: Max 500 chars
- **Danger type**: Predefined set via foreign key; to be defined (placeholder: danger_types table)

### Lock Semantics
- Lock acquired on `checkout` = only this user can call `PUT /map-objects/{id}`
- Attempting `PUT` without lock returns 403 Forbidden
- Lock expires automatically; user can re-checkout anytime
- `release` clears lock without modifying data

### Frontend State Management
- Use React hooks or similar for:
  - Current user + auth state
  - Selected polygon
  - Draw mode active / edit mode active
  - Lock status of selected object
  - Local unsaved changes flag

### Error Handling
- 401 Unauthorized → redirect to login
- 403 Forbidden (object locked) → show "In use by [user]" + disable edit
- 409 Conflict (lock expired) → prompt retry
- 422 Unprocessable (invalid geometry) → show field-level errors
- 429 Too Many Requests (quota) → show "Daily limit reached; retry after [time]"

---

## Key Files & Patterns

### Backend Structure
- `app/main.py` – FastAPI app initialization, CORS, middleware
- `app/api/map_objects.py` – endpoints for CRUD + locking
- `app/api/auth.py` – login/logout/me endpoints
- `app/models.py` – Pydantic schemas (request/response)
- `app/database.py` – SQLite setup, session management
- `app/services/quota.py` – daily usage tracking
- `app/static/` – served by FastAPI (HTML, JS, CSS)

### Frontend Structure
- `static/index.html` – single page
- `static/js/app.js` – main app entry, Leaflet map setup, state
- `static/js/api.js` – HTTP client wrapper for all endpoints
- `static/js/ui.js` – drawer, toolbar, dialogs
- `static/js/draw.js` – polygon draw/edit modes
- `static/css/style.css` – map, drawer, responsive

### Common Patterns
- **Auth guard**: Wrap authenticated endpoints with `@require_login` decorator
- **Quota check**: Call `check_daily_quota(user_id)` before writes
- **Lock validation**: Before `PUT`, verify `lock_owner == current_user`
- **Soft delete**: Never hard-delete; set `deleted_at`, filter from queries
- **CORS**: Allow frontend domain in FastAPI CORS middleware

---

## Deployment & Development

### Local Development
```bash
# Backend
python -m venv venv
source venv/bin/activate
pip install fastapi uvicorn sqlite3
uvicorn app.main:app --reload

# Frontend
# Browser: http://localhost:8000
```

### Database Initialization
- SQLite creates schema on first run if tables don't exist
- Or run migration script to seed initial state

### Real-Time Synchronization (WebSocket/SSE)
- Implement WebSocket or Server-Sent Events for live updates
- Broadcast on create/edit/delete: notify all connected clients
- Lock status propagates in real-time; other users see when object becomes editable
- Frontend unsubscribes/resubscribes on connection loss

### Testing Checklist
- Create polygon as authenticated user → verify appears on map + real-time propagation to other clients
- Edit it → confirm lock acquired → modify geometry → save → lock released
- Second user tries edit while first locks → should see "In use" message (real-time)
- Delete polygon → confirm soft-delete, hidden from public API, removed from all clients' maps
- Quota: create 10+ objects one day, verify 11th blocked
- Verify lock expiry after 15 minutes

---

## When Adding Features

1. **Understand the lock model first** – it's non-obvious and central to correctness
2. **Preserve soft-delete semantics** – never actually remove rows, filter by `deleted_at`
3. **Keep geometry validation strict** – invalid polygons break the map layer
4. **Always check quotas** before accepting writes
5. **Test lock expiry race conditions** – what if user saves after lock expires?
6. **Maintain audit trail** – log who changed what and when

---

## References

- **Leaflet**: https://leafletjs.com (map layer, draw plugin)
- **FastAPI**: https://fastapi.tiangolo.com (API framework)
- **GeoJSON**: https://geojson.org (polygon format)
- **SQLite**: https://sqlite.org (database)

