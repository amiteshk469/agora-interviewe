import os
from collections.abc import AsyncIterator
from typing import Any
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

os.environ.update(
    {
        "ENVIRONMENT": "test",
        "DATABASE_URL": "sqlite+aiosqlite://",
        "DEV_AUTH_ENABLED": "true",
        "DEV_AUTH_USER_ID": "00000000-0000-4000-8000-000000000001",
        "CORS_ORIGINS": '["http://localhost:3000"]',
        "AGORA_LLM_BEARER_SECRET": "test-llm-secret",
        "LLM_BASE_URL": "https://llm.test/v1",
        "LLM_API_KEY": "test-upstream-key",
        "WEB_SEARCH_API_KEY": "test-search-key",
        "FIRECRAWL_API_KEY": "test-search-key",
        # Existing streaming/retry tests exercise the deterministic recovery path.
        # Agent-runtime tests explicitly enable and mock model function calls.
        "PANEL_REASONING_ENABLED": "false",
        "AGORA_WEBHOOK_SECRET": "test-webhook-secret",
        "SUPABASE_JWT_SECRET": "test-supabase-jwt-secret-at-least-32-bytes",
        "SUPABASE_JWT_AUDIENCE": "authenticated",
        "SUPABASE_JWT_ISSUER": "https://test.supabase.co/auth/v1",
        "SUPABASE_URL": "https://test.supabase.co",
    }
)

from app.core.database import engine, get_db, session_factory  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402
from app.services.agora import get_agora_service  # noqa: E402
from app.services.documents import get_storage_service  # noqa: E402

DEV_USER_ID = UUID("00000000-0000-4000-8000-000000000001")


class FakeStorage:
    def __init__(self) -> None:
        self.uploads: list[tuple[str, str, bytes, str]] = []

    async def upload(self, bucket: str, path: str, data: bytes, mime_type: str) -> str:
        self.uploads.append((bucket, path, data, mime_type))
        return path


class FakeAgora:
    def __init__(self) -> None:
        self.started: list[dict[str, Any]] = []
        self.stopped: list[str] = []
        self.interrupted: list[str] = []
        self.dispatched: list[dict[str, str]] = []
        self.acknowledged: list[str] = []

    async def acknowledge(self, agent_id: str, channel: str, agent_uid: int) -> None:
        self.acknowledged.append(agent_id)

    def generate_connection(
        self,
        channel: str | None = None,
        uid: int | None = None,
        agent_uid: int | None = None,
    ) -> dict[str, Any]:
        return {
            "app_id": "test-app-id",
            "token": "test-token007",
            "uid": str(uid if uid and uid > 0 else 222),
            "channel_name": channel or "roundcraft-test-channel",
            "agent_uid": str(agent_uid if agent_uid and agent_uid > 0 else 111),
        }

    def generate_panel_connection(self, panel: list[dict[str, Any]]) -> dict[str, Any]:
        participants = [
            {
                "panelist_id": member["id"],
                "display_name": member["display_name"],
                "role": member["role"],
                "agent_uid": 111 + index,
                "avatar_uid": 1001 + index,
                "avatar_vendor": None,
                "avatar_id": member.get("avatar_id"),
                "avatar_image": member.get("avatar_image"),
                "video_mode": "static" if member.get("avatar_image") else "audio",
            }
            for index, member in enumerate(panel)
        ]
        connection = self.generate_connection(agent_uid=111)
        connection["panelists"] = [
            {
                "panelist_id": item["panelist_id"],
                "agent_uid": str(item["agent_uid"]),
                "avatar_uid": str(item["avatar_uid"]),
                "video_mode": item["video_mode"],
            }
            for item in participants
        ]
        return {"connection": connection, "participants": participants}

    async def start(self, **kwargs: Any) -> dict[str, Any]:
        self.started.append(kwargs)
        return {
            "agent_id": "host-listener-1" if kwargs.get("host_listener_key") else "agent-test-1",
            "channel_name": kwargs["channel_name"],
            "status": "started",
        }

    async def start_panel(self, **kwargs: Any) -> list[dict[str, Any]]:
        self.started.append(kwargs)
        return [
            {
                "agent_id": "agent-test-1",
                "channel_name": kwargs["channel_name"],
                "status": "started",
                "panelist_id": item["panelist_id"],
            }
            for item in kwargs["participants"]
        ]

    async def stop(self, agent_id: str) -> None:
        self.stopped.append(agent_id)

    async def stop_panel(self, agent_ids: list[str]) -> None:
        self.stopped.extend(dict.fromkeys(agent_ids))

    async def interrupt_panel(self, agent_ids: list[str]) -> None:
        self.interrupted.extend(dict.fromkeys(agent_ids))

    async def dispatch_turn(
        self,
        agent_id: str,
        candidate_text: str,
        panelist_id: str,
        *,
        channel_name: str | None = None,
        agent_uid: int | None = None,
    ) -> str:
        self.dispatched.append(
            {
                "agent_id": agent_id,
                "candidate_text": candidate_text,
                "panelist_id": panelist_id,
                "channel_name": channel_name or "",
                "agent_uid": str(agent_uid or ""),
            }
        )
        return "think_injected"


@pytest.fixture(autouse=True)
async def reset_database() -> AsyncIterator[None]:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    storage = FakeStorage()
    agora = FakeAgora()

    async def override_db() -> AsyncIterator[Any]:
        async with session_factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_storage_service] = lambda: storage
    app.dependency_overrides[get_agora_service] = lambda: agora
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as value:
        value.fake_storage = storage  # type: ignore[attr-defined]
        value.fake_agora = agora  # type: ignore[attr-defined]
        yield value
    app.dependency_overrides.clear()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer dev:{DEV_USER_ID}"}
