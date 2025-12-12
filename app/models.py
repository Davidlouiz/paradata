from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ============ Auth Models ============

class LoginRequest(BaseModel):
    username: str
    password: str


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


class MapObjectCreate(BaseModel):
    geometry: dict  # GeoJSON geometry
    danger_type_id: int
    severity: str  # SAFE, LOW_RISK, RISK, HIGH_RISK, CRITICAL
    description: Optional[str] = None


class MapObjectUpdate(BaseModel):
    geometry: Optional[dict] = None
    danger_type_id: Optional[int] = None
    severity: Optional[str] = None
    description: Optional[str] = None


class MapObjectLock(BaseModel):
    locked_by: Optional[int] = None
    locked_by_username: Optional[str] = None
    lock_expires_at: Optional[str] = None


class MapObjectResponse(BaseModel):
    id: int
    geometry: dict
    danger_type_id: int
    severity: str
    description: Optional[str]
    created_by: int
    created_by_username: Optional[str]
    created_at: str
    updated_by: Optional[int]
    updated_by_username: Optional[str]
    updated_at: Optional[str]
    lock: Optional[MapObjectLock]


class MapObjectsListResponse(BaseModel):
    success: bool
    data: List[MapObjectResponse]
    error: Optional[str] = None


class SingleMapObjectResponse(BaseModel):
    success: bool
    data: Optional[MapObjectResponse] = None
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
