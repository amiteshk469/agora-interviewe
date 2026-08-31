import asyncio
import time
from dataclasses import dataclass
from typing import Annotated, Any
from uuid import UUID

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import Settings, get_settings


@dataclass(frozen=True, slots=True)
class UserContext:
    id: UUID
    role: str
    email: str | None
    claims: dict[str, Any]


bearer = HTTPBearer(auto_error=False)


class SupabaseJwtVerifier:
    def __init__(self) -> None:
        self._jwks: dict[str, Any] | None = None
        self._jwks_expires_at = 0.0
        self._lock = asyncio.Lock()

    async def _get_jwks(self, settings: Settings) -> dict[str, Any]:
        if self._jwks is not None and time.monotonic() < self._jwks_expires_at:
            return self._jwks
        if not settings.resolved_jwks_url:
            raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "JWT verifier is not configured")
        async with self._lock:
            if self._jwks is not None and time.monotonic() < self._jwks_expires_at:
                return self._jwks
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(settings.resolved_jwks_url)
                response.raise_for_status()
            self._jwks = response.json()
            self._jwks_expires_at = time.monotonic() + 600
            return self._jwks

    async def decode(self, token: str, settings: Settings) -> dict[str, Any]:
        header = jwt.get_unverified_header(token)
        algorithm = str(header.get("alg", ""))
        options = {"require": ["exp", "sub"]}
        kwargs: dict[str, Any] = {
            "audience": settings.supabase_jwt_audience,
            "issuer": settings.resolved_jwt_issuer,
            "options": options,
        }
        if kwargs["issuer"] is None:
            kwargs.pop("issuer")

        if algorithm == "HS256" and settings.supabase_jwt_secret:
            return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], **kwargs)

        if algorithm not in {"RS256", "ES256"}:
            raise jwt.InvalidAlgorithmError("Unsupported JWT signing algorithm")
        key_id = header.get("kid")
        jwks = await self._get_jwks(settings)
        key_data = next((key for key in jwks.get("keys", []) if key.get("kid") == key_id), None)
        if key_data is None:
            self._jwks_expires_at = 0
            jwks = await self._get_jwks(settings)
            key_data = next(
                (key for key in jwks.get("keys", []) if key.get("kid") == key_id), None
            )
        if key_data is None:
            raise jwt.InvalidKeyError("JWT signing key not found")
        public_key = jwt.PyJWK.from_dict(key_data, algorithm=algorithm).key
        return jwt.decode(token, public_key, algorithms=[algorithm], **kwargs)


verifier = SupabaseJwtVerifier()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserContext:
    auth_error = HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Valid Supabase bearer token required",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise auth_error
    token = credentials.credentials
    expected_dev_token = f"dev:{settings.dev_auth_user_id}"
    if settings.dev_auth_enabled and token == expected_dev_token:
        return UserContext(settings.dev_auth_user_id, "authenticated", "dev@roundcraft.local", {})
    try:
        claims = await verifier.decode(token, settings)
        user_id = UUID(str(claims["sub"]))
    except (KeyError, ValueError, jwt.PyJWTError, httpx.HTTPError) as exc:
        raise auth_error from exc
    return UserContext(user_id, str(claims.get("role", "authenticated")), claims.get("email"), claims)


CurrentUser = Annotated[UserContext, Depends(get_current_user)]


async def require_agora_compat_access(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> None:
    del credentials
    if settings.environment not in {"development", "test"}:
        # These exact routes exist only to preserve the official local quickstart.
        # Product clients use owner-bound /v1 session routes in deployed environments.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")


AgoraCompatAccess = Annotated[None, Depends(require_agora_compat_access)]
