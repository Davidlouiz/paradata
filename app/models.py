from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ============ Auth Models ============


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str
    captcha_token: str
    captcha_answer: int


class LoginResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    created_at: str


class AuthMeResponse(BaseModel):
    success: bool
    data: Optional[UserResponse] = None
    error: Optional[str] = None


# ============ Map Objects Models ============


class MapObjectGeometry(BaseModel):
    type: str  # "Polygon" or "MultiPolygon"
    coordinates: List


class ZoneCreate(BaseModel):
    geometry: dict  # GeoJSON geometry
    zone_type: str  # DENSE_VEGETATION, REMOTE_AREA
    description: Optional[str] = None


class ZoneUpdate(BaseModel):
    geometry: Optional[dict] = None
    zone_type: Optional[str] = None
    description: Optional[str] = None


class MapObjectLock(BaseModel):
    locked_by: Optional[int] = None
    locked_by_username: Optional[str] = None
    lock_expires_at: Optional[str] = None


class ZoneResponse(BaseModel):
    id: int
    geometry: dict
    zone_type: str
    description: Optional[str]
    created_by: int
    created_by_username: Optional[str]
    created_at: str
    updated_by: Optional[int]
    updated_by_username: Optional[str]
    updated_at: Optional[str]
    lock: Optional[MapObjectLock]


class ZonesListResponse(BaseModel):
    success: bool
    data: List[ZoneResponse]
    error: Optional[str] = None


class SingleZoneResponse(BaseModel):
    success: bool
    data: Optional[ZoneResponse] = None
    error: Optional[str] = None


class CheckoutResponse(BaseModel):
    success: bool
    data: Optional[dict] = None
    error: Optional[str] = None


class BoundingBox(BaseModel):
    minLat: float
    minLng: float
    maxLat: float
    maxLng: float


class ZonesByCoordinateResponse(BaseModel):
    success: bool
    data: List[ZoneResponse]
    error: Optional[str] = None
