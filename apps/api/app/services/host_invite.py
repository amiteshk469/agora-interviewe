"""Signed, seat-scoped invite tokens for a RoundCraft interview room.

The guest never authenticates with Supabase, so the token *is* the credential.
It is therefore scoped as narrowly as the feature allows: it names exactly one
session, it expires, and it is signed with a key derived only for this purpose
so a leaked invite can never be replayed against another part of the system.
"""

import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Any, Literal
from uuid import UUID

# An invite outlives a long interview but not a working day.
DEFAULT_INVITE_TTL_SECONDS = 6 * 60 * 60
_KEY_DOMAIN = b"roundcraft-host-invite-v1"


class InviteError(ValueError):
    """The token was absent, malformed, forged, or expired."""


def _b64encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError) as exc:  # pragma: no cover - defensive
        raise InviteError("Invite token is malformed") from exc


def derive_key(secret: str) -> bytes:
    """Bind the signing key to this feature.

    The deployment already carries a strong shared secret. Hashing it with a
    fixed domain label means the invite key cannot verify — or be verified by —
    anything else that uses the same environment value.
    """
    if not secret:
        raise InviteError("Invite signing secret is not configured")
    return hashlib.sha256(_KEY_DOMAIN + b":" + secret.encode("utf-8")).digest()


@dataclass(frozen=True, slots=True)
class InviteClaims:
    session_id: UUID
    expires_at: int
    seat: Literal["interviewer", "candidate"] = "interviewer"


def mint_invite(
    session_id: UUID,
    secret: str,
    *,
    ttl_seconds: int = DEFAULT_INVITE_TTL_SECONDS,
    seat: Literal["interviewer", "candidate"] = "interviewer",
    now: float | None = None,
) -> tuple[str, int]:
    """Return the token and the epoch second it stops being valid."""
    issued = int(now if now is not None else time.time())
    expires_at = issued + max(60, ttl_seconds)
    payload: dict[str, Any] = {"sid": str(session_id), "exp": expires_at, "seat": seat}
    body = _b64encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = hmac.new(derive_key(secret), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64encode(signature)}", expires_at


def read_invite(token: str, secret: str, *, now: float | None = None) -> InviteClaims:
    """Verify a token and return its claims, or raise InviteError."""
    if not token or token.count(".") != 1:
        raise InviteError("Invite token is malformed")
    body, provided = token.split(".", 1)
    expected = hmac.new(derive_key(secret), body.encode("ascii"), hashlib.sha256).digest()
    # Constant-time compare: an invite is a bearer credential.
    if not hmac.compare_digest(expected, _b64decode(provided)):
        raise InviteError("Invite token signature is invalid")
    try:
        payload = json.loads(_b64decode(body))
        session_id = UUID(str(payload["sid"]))
        expires_at = int(payload["exp"])
        # Tokens minted before two-sided rooms existed were interviewer links.
        seat = str(payload.get("seat") or "interviewer")
        if seat not in {"interviewer", "candidate"}:
            raise ValueError("unknown invite seat")
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise InviteError("Invite token is malformed") from exc
    if expires_at <= int(now if now is not None else time.time()):
        raise InviteError("Invite link has expired")
    return InviteClaims(session_id=session_id, expires_at=expires_at, seat=seat)  # type: ignore[arg-type]


def invite_secret(configured: str, fallback: str) -> str:
    """Prefer a dedicated secret, fall back to the deployment's shared one.

    Keeping a fallback means the feature ships without a new required env var;
    derive_key still keeps the resulting key separate from every other use.
    """
    return configured or fallback
