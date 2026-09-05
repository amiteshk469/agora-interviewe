from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import Settings
from app.services.agora import AgoraAgentService, build_turn_detection


@pytest.mark.parametrize("mode,expected", [("balanced", True), ("let_me_finish", False)])
async def test_backchannel_mode_cooldown_and_owner_auth(
    client: AsyncClient, auth_headers: dict[str, str], mode: str, expected: bool
) -> None:
    config = (await client.post("/v1/interview-configs", headers=auth_headers, json={"title": "Pace"})).json()
    session = (
        await client.post(
            "/v1/sessions",
            headers=auth_headers,
            json={
                "interview_config_id": config["id"],
                "conversation_mode": mode,
            },
        )
    ).json()
    sid = session["id"]
    await client.post(f"/v1/sessions/{sid}/start", headers=auth_headers, json={})
    assert (await client.post(f"/v1/sessions/{sid}/backchannel")).status_code == 401
    first = await client.post(f"/v1/sessions/{sid}/backchannel", headers=auth_headers)
    assert first.json() == {"requested": expected}
    second = await client.post(f"/v1/sessions/{sid}/backchannel", headers=auth_headers)
    assert second.json() == {"requested": False}
    fake = client.fake_agora  # type: ignore[attr-defined]
    assert len(fake.acknowledged) == int(expected)


def test_conversation_modes_have_distinct_pause_tolerance() -> None:
    settings = Settings(environment="test")
    balanced = build_turn_detection(settings, manual_turn_control=False, conversation_mode="balanced")["config"][
        "end_of_speech"
    ]
    finish = build_turn_detection(settings, manual_turn_control=False, conversation_mode="let_me_finish")["config"][
        "end_of_speech"
    ]
    assert balanced["semantic_config"]["max_wait_ms"] == 2000
    assert finish["semantic_config"]["max_wait_ms"] == 6000
    assert finish["semantic_config"]["pause_state_enabled"] is True


async def test_acknowledgment_uses_low_priority_and_session_bound_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class Agents:
        async def speak(self, *args: Any, **kwargs: Any) -> None:
            captured.update(kwargs)

    class Client:
        agents = Agents()

    service = AgoraAgentService.__new__(AgoraAgentService)
    service.settings = Settings(environment="test", agora_app_id="test-app", agora_app_certificate="test-cert")
    service.client = Client()  # type: ignore[assignment]

    def token(**kwargs: Any) -> str:
        assert kwargs["channel_name"] == "owned-room"
        assert kwargs["uid"] == 111
        return "scoped-token"

    monkeypatch.setattr("app.services.agora.generate_convo_ai_token", token)
    await service.acknowledge("agent", "owned-room", 111)
    assert captured["priority"] == "IGNORE"
    assert captured["interruptable"] is False
    assert captured["request_options"]["additional_headers"]["Authorization"] == "agora token=scoped-token"
