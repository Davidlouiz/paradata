from fastapi import FastAPI, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from socketio import AsyncServer, ASGIApp
import os
from datetime import datetime, timedelta
from typing import Optional

from app.database import init_db, get_db
from app.api import auth, map_objects
from app.services.ws_manager import manager

# Initialize database
init_db()

# Create FastAPI app
app = FastAPI(
    title="Alerte Parapente API",
    description="Collaborative hazard alert map editor",
    version="0.1.0",
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_errors_middleware(request, call_next):
    """Log requests that result in 4xx/5xx responses for debugging."""
    try:
        response = await call_next(request)
    except Exception as exc:
        print(f"Exception handling request {request.method} {request.url}: {exc}")
        raise

    if response.status_code >= 400:
        # Avoid reading request body here: calling `await request.body()` after
        # the request has been processed can block or be unreliable in some ASGI
        # servers/clients. Log method and URL only to prevent blocking behavior.
        print(f"[HTTP {response.status_code}] {request.method} {request.url}")

    return response


# WebSocket/Socket.IO setup
sio = AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=[
        "*",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],  # Allow local origins
    ping_timeout=60,
    ping_interval=25,
    logger=True,
    engineio_logger=True,
)

# Wrap FastAPI with Socket.IO
socket_app = ASGIApp(sio, app)


@sio.event
async def connect(sid, environ):
    """Handle WebSocket connection."""
    origin = environ.get("HTTP_ORIGIN") or environ.get("HTTP_REFERER") or "<no-origin>"
    ua = environ.get("HTTP_USER_AGENT") or "<no-ua>"
    qs = environ.get("QUERY_STRING") or ""
    print(f"Client {sid} connected - origin={origin} ua={ua} qs={qs}")
    manager.connect(sid, user_id=None)


@sio.event
async def disconnect(sid):
    """Handle WebSocket disconnection."""
    print(f"Client {sid} disconnected")
    manager.disconnect(sid)


@sio.event
async def auth_user(sid, data):
    """Authenticate user on WebSocket connection."""
    user_id = data.get("user_id")
    if user_id:
        manager.sids_to_users[sid] = user_id
        if user_id not in manager.active_connections:
            manager.active_connections[user_id] = set()
        manager.active_connections[user_id].add(sid)
        print(f"User {user_id} authenticated on {sid}")


# Include routers
app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(map_objects.router, prefix="/map-objects", tags=["map-objects"])

# Inject Socket.IO instance into map_objects router
map_objects.set_sio(sio)

# Serve static files
# Static files are at the project root, not in app/
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/assets", StaticFiles(directory=static_dir), name="assets")
else:
    print(f"Warning: static directory not found at {static_dir}")


@app.get("/", response_class=FileResponse)
async def root():
    """Serve the SPA index.html"""
    index_path = os.path.join(static_dir, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, media_type="text/html")
    return {"message": "Alerte Parapente API - static files not found"}


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}


@app.post("/debug-echo")
async def debug_echo(request: Request):
    """Temporary debug endpoint that echoes JSON body."""
    try:
        data = await request.json()
    except Exception:
        data = None
    return {"ok": True, "body": data}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(socket_app, host="0.0.0.0", port=8000)
