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


class RegisterInitRequest(BaseModel):
    """Initiate account creation - returns recovery key"""

    pass


class RegisterInitResponse(BaseModel):
    success: bool
    data: Optional[dict] = None  # { recovery_key: "XXXX-XXXX-..." }
    error: Optional[str] = None


class RegisterVerifyKeyRequest(BaseModel):
    """Verify the recovery key was saved"""

    session_id: str
    recovery_key: str  # User-entered key, with or without dashes


class RegisterVerifyKeyResponse(BaseModel):
    success: bool
    data: Optional[dict] = None  # Empty if verified
    error: Optional[str] = None


class RegisterCompleteRequest(BaseModel):
    """Complete account creation with username and password"""

    session_id: str
    username: str
    password: str
    captcha_token: str
    captcha_answer: int


class RecoverPasswordRequest(BaseModel):
    """Reset account (username + password) using recovery key as proof of identity"""

    recovery_key: str
    new_username: str
    new_password: str


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
