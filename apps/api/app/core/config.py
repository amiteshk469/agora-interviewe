import json
from functools import lru_cache
from pathlib import Path
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    database_url: str = "sqlite+aiosqlite:///./roundcraft.db"
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
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
    web_search_base_url: str = ""
    web_search_api_key: str = ""

    @field_validator("environment")
    @classmethod
    def normalize_environment(cls, value: str) -> str:
        return value.strip().lower()

    @model_validator(mode="after")
    def guard_development_auth(self) -> "Settings":
        if self.dev_auth_enabled and self.environment not in {"development", "test"}:
            raise ValueError("DEV_AUTH_ENABLED is allowed only in development or test")
        if self.agora_avatar_vendor not in {"liveavatar", "generic", "akool", "anam"}:
            raise ValueError("AGORA_AVATAR_VENDOR must be liveavatar, generic, akool, or anam")
        if self.agora_avatar_quality not in {"low", "medium", "high"}:
            raise ValueError("AGORA_AVATAR_QUALITY must be low, medium, or high")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        if self.cors_origins.strip().startswith("["):
            decoded = json.loads(self.cors_origins)
            if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
                raise ValueError("CORS_ORIGINS must be a JSON string array or comma-separated string")
            return [origin.strip() for origin in decoded if origin.strip()]
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

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
