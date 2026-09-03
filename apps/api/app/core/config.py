import json
import re
from functools import lru_cache
from ipaddress import ip_address
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import SplitResult, urlsplit
from uuid import UUID

from fastapi import Depends
from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER_PATTERN = re.compile(
    r"(?:replace[_-]?with|placeholder|change[_-]?me|<[^>]+>|\$\{[^}]+\}|"
    r"your(?:[_-][a-z0-9]+)*[_-](?:key|url|id|host|project|secret|model))",
    re.IGNORECASE,
)

AGORA_LIVE_LLM_MODES = {"roundcraft_custom", "agora_managed_preview"}
AGORA_MANAGED_OPENAI_MODELS = {
    "gpt-4o-mini",
    "gpt-4.1-mini",
    "gpt-5-nano",
    "gpt-5-mini",
}


def _public_https_url(value: str, name: str, *, origin_only: bool = False) -> SplitResult:
    if PLACEHOLDER_PATTERN.search(value):
        raise ValueError(f"{name} contains a placeholder")
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        _ = parsed.port
    except ValueError as exc:
        raise ValueError(f"{name} must be a valid public HTTPS URL") from exc

    if parsed.scheme != "https" or not hostname:
        raise ValueError(f"{name} must be a public HTTPS URL")
    if parsed.username or parsed.password:
        raise ValueError(f"{name} must not contain credentials")

    normalized_host = hostname.rstrip(".").lower()
    example_host = (
        normalized_host.endswith((".example", ".invalid", ".test", ".localhost"))
        or normalized_host in {"localhost", "example.com", "example.net", "example.org"}
        or normalized_host.endswith((".example.com", ".example.net", ".example.org"))
    )
    try:
        non_public_ip = not ip_address(normalized_host).is_global
    except ValueError:
        non_public_ip = False
    if example_host or non_public_ip:
        raise ValueError(f"{name} must use a public non-example host")
    if origin_only and (parsed.path not in {"", "/"} or parsed.query or parsed.fragment):
        raise ValueError(f"{name} must contain only an HTTPS origin")
    return parsed


def _url_origin(value: SplitResult) -> tuple[str, str, int | None]:
    return value.scheme, value.hostname.rstrip(".").lower() if value.hostname else "", value.port


def _required_secret(value: str, name: str, *, minimum_length: int = 16) -> str:
    stripped = value.strip()
    if len(stripped) < minimum_length or PLACEHOLDER_PATTERN.search(stripped):
        raise ValueError(f"{name} must contain a non-placeholder production credential")
    return stripped


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path(".env"), Path("../../.env")),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "RoundCraft API"
    environment: str = "development"
    api_base_url: str = "http://localhost:8000"
    web_base_url: str = "http://localhost:3000"
    cors_origins: str = "http://localhost:3000"
    release_sha: str = Field(
        default="local",
        validation_alias=AliasChoices("RENDER_GIT_COMMIT", "RELEASE_SHA", "release_sha"),
    )

    database_url: str = "sqlite+aiosqlite:///./roundcraft.db"
    supabase_url: str = ""
    supabase_anon_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "supabase_anon_key"
        ),
    )
    supabase_service_role_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_SECRET_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "supabase_service_role_key",
        ),
    )
    supabase_jwt_secret: str = ""
    supabase_jwks_url: str = ""
    supabase_jwt_audience: str = "authenticated"
    supabase_jwt_issuer: str = ""
    supabase_documents_bucket: str = Field(
        default="candidate-documents",
        validation_alias=AliasChoices(
            "SUPABASE_STORAGE_DOCUMENTS_BUCKET", "SUPABASE_DOCUMENTS_BUCKET"
        ),
    )
    supabase_artifacts_bucket: str = Field(
        default="session-artifacts",
        validation_alias=AliasChoices(
            "SUPABASE_STORAGE_ARTIFACTS_BUCKET", "SUPABASE_ARTIFACTS_BUCKET"
        ),
    )

    dev_auth_enabled: bool = False
    dev_auth_user_id: UUID = UUID("00000000-0000-4000-8000-000000000001")

    agora_app_id: str = ""
    agora_app_certificate: str = ""
    agora_area: str = "INDIA"
    agora_agent_idle_timeout_seconds: int = Field(default=30, ge=5, le=3600)
    agora_session_expires_seconds: int = Field(default=3600, ge=60, le=86400)
    agora_webhook_secret: str = ""
    # Signs the human-interviewer invite links. Left empty, the invite service
    # derives a key from the Agora LLM secret under its own domain label, so the
    # feature ships without a new required environment variable.
    session_invite_secret: str = ""
    # End-of-speech detection. "semantic" lets Agora decide the candidate has finished
    # rather than cutting them off after a fixed silence, which matters when they pause
    # mid-answer to think. "vad" restores the previous fixed-silence behavior.
    agora_end_of_speech_mode: Literal["semantic", "vad"] = "semantic"
    agora_semantic_silence_ms: int = Field(default=320, ge=100, le=5000)
    agora_semantic_max_wait_ms: int = Field(default=3000, ge=500, le=15000)
    agora_pause_state_enabled: bool = True
    agora_vad_silence_ms: int = Field(default=900, ge=100, le=5000)
    agora_live_llm_mode: str = "roundcraft_custom"
    agora_managed_openai_model: str = "gpt-4.1-mini"
    agora_custom_llm_url: str = ""
    agora_llm_bearer_secret: str = ""
    agora_avatar_enabled: bool = True
    agora_avatar_vendor: str = "liveavatar"
    agora_avatar_api_key: str = ""
    agora_liveavatar_api_key: str = ""
    agora_generic_avatar_api_key: str = ""
    agora_akool_api_key: str = ""
    agora_anam_api_key: str = ""
    agora_avatar_api_base_url: str = ""
    agora_avatar_quality: str = "medium"
    agora_avatar_ids: str = "{}"

    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-4o-mini"

    jd_max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1024)
    web_search_enabled: bool = False
    web_search_base_url: str = Field(
        default="https://api.firecrawl.dev/v2",
        validation_alias=AliasChoices(
            "FIRECRAWL_BASE_URL", "WEB_SEARCH_BASE_URL", "web_search_base_url"
        ),
    )
    web_search_api_key: str = Field(
        default="",
        validation_alias=AliasChoices(
            "FIRECRAWL_API_KEY", "WEB_SEARCH_API_KEY", "web_search_api_key"
        ),
    )

    @field_validator("environment")
    @classmethod
    def normalize_environment(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("agora_live_llm_mode")
    @classmethod
    def validate_agora_live_llm_mode(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in AGORA_LIVE_LLM_MODES:
            choices = ", ".join(sorted(AGORA_LIVE_LLM_MODES))
            raise ValueError(f"AGORA_LIVE_LLM_MODE must be one of: {choices}")
        return normalized

    @field_validator("agora_managed_openai_model")
    @classmethod
    def validate_agora_managed_openai_model(cls, value: str) -> str:
        normalized = value.strip()
        if normalized not in AGORA_MANAGED_OPENAI_MODELS:
            choices = ", ".join(sorted(AGORA_MANAGED_OPENAI_MODELS))
            raise ValueError(f"AGORA_MANAGED_OPENAI_MODEL must be one of: {choices}")
        return normalized

    @model_validator(mode="after")
    def guard_development_auth(self) -> "Settings":
        if self.dev_auth_enabled and self.environment not in {"development", "test"}:
            raise ValueError("DEV_AUTH_ENABLED is allowed only in development or test")
        if self.agora_avatar_vendor not in {"liveavatar", "generic", "akool", "anam"}:
            raise ValueError(
                "AGORA_AVATAR_VENDOR must be liveavatar, generic, akool, or anam"
            )
        if self.agora_avatar_quality not in {"low", "medium", "high"}:
            raise ValueError("AGORA_AVATAR_QUALITY must be low, medium, or high")
        if self.environment == "production":
            api_url = _public_https_url(self.api_base_url, "API_BASE_URL", origin_only=True)
            web_url = _public_https_url(self.web_base_url, "WEB_BASE_URL", origin_only=True)
            supabase_url = _public_https_url(self.supabase_url, "SUPABASE_URL", origin_only=True)
            groq_url = _public_https_url(self.llm_base_url, "LLM_BASE_URL")

            if not re.match(r"^postgres(?:ql)?(?:\+asyncpg)?://", self.database_url):
                raise ValueError("DATABASE_URL must use PostgreSQL in production")
            try:
                database_host = urlsplit(self.database_url).hostname
                if not database_host or PLACEHOLDER_PATTERN.search(database_host):
                    raise ValueError("DATABASE_URL must include a PostgreSQL host")
            except ValueError as exc:
                raise ValueError("DATABASE_URL must be a valid PostgreSQL URL") from exc
            if not re.fullmatch(r"[a-fA-F0-9]{7,40}", self.release_sha):
                raise ValueError("RENDER_GIT_COMMIT must identify the production release commit")

            if not re.fullmatch(r"[a-fA-F0-9]{32}", self.agora_app_id) or self.agora_app_id == "0" * 32:
                raise ValueError("AGORA_APP_ID must be a valid 32-character Agora App ID")
            if (
                not re.fullmatch(r"[a-fA-F0-9]{32}", self.agora_app_certificate)
                or self.agora_app_certificate == "0" * 32
            ):
                raise ValueError(
                    "AGORA_APP_CERTIFICATE must be a valid 32-character Agora App Certificate"
                )
            _required_secret(self.agora_webhook_secret, "AGORA_WEBHOOK_SECRET")

            if self.agora_live_llm_mode == "roundcraft_custom":
                custom_llm_url = _public_https_url(
                    self.agora_custom_llm_url, "AGORA_CUSTOM_LLM_URL"
                )
                _required_secret(
                    self.agora_llm_bearer_secret,
                    "AGORA_LLM_BEARER_SECRET",
                    minimum_length=24,
                )
                if custom_llm_url.path.rstrip("/") != "/llm/chat/completions":
                    raise ValueError(
                        "AGORA_CUSTOM_LLM_URL must end with /llm/chat/completions"
                    )
                if custom_llm_url.query or custom_llm_url.fragment:
                    raise ValueError(
                        "AGORA_CUSTOM_LLM_URL must not contain a query or fragment"
                    )
                if _url_origin(custom_llm_url) != _url_origin(api_url):
                    raise ValueError(
                        "AGORA_CUSTOM_LLM_URL must use the API_BASE_URL origin"
                    )

            supabase_secret = _required_secret(
                self.supabase_service_role_key, "SUPABASE_SECRET_KEY", minimum_length=20
            )
            if not (
                supabase_secret.startswith("sb_secret_")
                or (supabase_secret.startswith("eyJ") and supabase_secret.count(".") == 2)
            ):
                raise ValueError("SUPABASE_SECRET_KEY must be a Supabase secret or service-role key")
            if _url_origin(supabase_url)[0] != "https":
                raise ValueError("SUPABASE_URL must use HTTPS")

            if groq_url.hostname != "api.groq.com" or groq_url.path.rstrip("/") != "/openai/v1":
                raise ValueError("LLM_BASE_URL must be the Groq OpenAI-compatible API base URL")
            if groq_url.query or groq_url.fragment:
                raise ValueError("LLM_BASE_URL must not contain a query or fragment")
            if not _required_secret(self.llm_api_key, "LLM_API_KEY", minimum_length=20).startswith("gsk_"):
                raise ValueError("LLM_API_KEY must be a Groq API key")
            if (
                not self.llm_model.strip()
                or self.llm_model == "gpt-4o-mini"
                or PLACEHOLDER_PATTERN.search(self.llm_model)
            ):
                raise ValueError("LLM_MODEL must name a non-placeholder Groq model")

            origins = self.allowed_origins
            if not origins or "*" in origins:
                raise ValueError("CORS_ORIGINS must list explicit production HTTPS origins")
            parsed_origins = [
                _public_https_url(origin, "CORS_ORIGINS", origin_only=True)
                for origin in origins
            ]
            if _url_origin(web_url) not in {_url_origin(origin) for origin in parsed_origins}:
                raise ValueError("CORS_ORIGINS must include WEB_BASE_URL")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        if self.cors_origins.strip().startswith("["):
            decoded = json.loads(self.cors_origins)
            if not isinstance(decoded, list) or not all(
                isinstance(item, str) for item in decoded
            ):
                raise ValueError(
                    "CORS_ORIGINS must be a JSON string array or comma-separated string"
                )
            return [origin.strip() for origin in decoded if origin.strip()]
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]

    @property
    def resolved_jwks_url(self) -> str:
        if self.supabase_jwks_url:
            return self.supabase_jwks_url
        if self.supabase_url:
            return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        return ""

    @property
    def resolved_jwt_issuer(self) -> str | None:
        if self.supabase_jwt_issuer:
            return self.supabase_jwt_issuer
        if self.supabase_url:
            return f"{self.supabase_url.rstrip('/')}/auth/v1"
        return None

    @property
    def avatar_id_map(self) -> dict[str, str]:
        if not self.agora_avatar_ids.strip():
            return {}
        decoded = json.loads(self.agora_avatar_ids)
        if not isinstance(decoded, dict) or not all(
            isinstance(key, str) and isinstance(value, str)
            for key, value in decoded.items()
        ):
            raise ValueError("AGORA_AVATAR_IDS must be a JSON string-to-string object")
        return decoded


@lru_cache
def get_settings() -> Settings:
    return Settings()


SettingsDep = Annotated[Settings, Depends(get_settings)]
