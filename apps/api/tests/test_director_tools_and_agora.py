import json
from typing import Any

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.core.config import Settings
from app.core.security import require_agora_compat_access
from app.domain import PLATFORM_INVARIANTS, PanelDirector
from app.schemas import PanelistInput, PanelState
from app.services.agora import AgoraAgentService
from app.services.tools import calculate, execute_tool


def test_panel_director_can_repeat_or_jump_non_linearly() -> None:
    panel = [
        PanelistInput(
            id="one",
            display_name="One",
            role="Hiring Manager",
            expertise=["leadership"],
        ),
        PanelistInput(
            id="two",
            display_name="Two",
            role="Product Sense",
            expertise=["customers"],
        ),
        PanelistInput(
            id="three",
            display_name="Three",
            role="Analytics",
            expertise=["metrics"],
        ),
    ]
    state = PanelState(current_speaker_id="one")
    repeated = PanelDirector.choose_next(panel, state, "Because the result improved by 20%")
    assert repeated.next_speaker_id == "one"
    jumped = PanelDirector.choose_next(panel, PanelState(), "The metrics changed after launch")
    assert jumped.next_speaker_id == "three"


def test_safe_calculator() -> None:
    assert str(calculate("(120 * 1.25) / 3")) == "50.00"
    for unsafe in ("__import__('os')", "2 ** 100", "open('/tmp/x')"):
        try:
            calculate(unsafe)
        except ValueError:
            pass
        else:
            raise AssertionError(f"unsafe expression accepted: {unsafe}")


async def test_brave_web_search_adapter_is_bounded(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    class Response:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, Any]:
            return {
                "web": {
                    "results": [
                        {
                            "title": "Current market source",
                            "url": "https://example.test/source",
                            "description": "Bounded provider snippet",
                            "age": "1 day ago",
                        }
                    ]
                }
            }

    class SearchClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> "SearchClient":
            return self

        async def __aexit__(self, *args: Any) -> None:
            pass

        async def get(self, url: str, **kwargs: Any) -> Response:
            captured.update({"url": url, **kwargs})
            return Response()

    monkeypatch.setattr("app.services.tools.httpx.AsyncClient", SearchClient)
    result = await execute_tool(
        "web_search",
        {"query": "current product management hiring market"},
        [],
        Settings(
            web_search_enabled=True,
            web_search_base_url="https://api.search.brave.com/res/v1",
            web_search_api_key="search-key",
        ),
    )
    assert captured["url"].endswith("/res/v1/web/search")
    assert captured["headers"] == {"X-Subscription-Token": "search-key"}
    assert captured["params"] == {
        "q": "current product management hiring market",
        "count": 5,
        "safesearch": "strict",
    }
    assert result["results"][0]["url"] == "https://example.test/source"


async def _create_session(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    config = (
        await client.post("/v1/interview-configs", headers=headers, json={"title": "Tool test"})
    ).json()
    return (
        await client.post(
            "/v1/sessions", headers=headers, json={"interview_config_id": config["id"]}
        )
    ).json()


async def test_tool_registry_executes_and_audits(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _create_session(client, auth_headers)
    response = await client.post(
        f"/v1/sessions/{session['id']}/tools/calculator",
        headers=auth_headers,
        json={"panelist_id": "analytics", "arguments": {"expression": "20 * 3"}},
    )
    assert response.status_code == 201, response.text
    assert response.json()["result"] == {"value": "6E+1"}

    denied = await client.post(
        f"/v1/sessions/{session['id']}/tools/calculator",
        headers=auth_headers,
        json={"panelist_id": "product-sense", "arguments": {"expression": "20 * 3"}},
    )
    assert denied.status_code == 403


async def test_state_changing_tools_persist_candidate_evidence_and_replay(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _create_session(client, auth_headers)
    turn = await client.post(
        f"/v1/sessions/{session['id']}/turns",
        headers=auth_headers,
        json={"sequence": 1, "speaker_type": "candidate", "content": "Here is my answer."},
    )
    assert turn.status_code == 201, turn.text
    bookmarked = await client.post(
        f"/v1/sessions/{session['id']}/tools/evidence_bookmark",
        headers=auth_headers,
        json={
            "panelist_id": "hiring-manager",
            "transcript_turn_id": turn.json()["id"],
            "arguments": {"competency": "leadership", "note": "Candidate claim to assess"},
        },
    )
    assert bookmarked.status_code == 201, bookmarked.text
    assert bookmarked.json()["result"]["evidence_id"]
    replay = await client.post(
        f"/v1/sessions/{session['id']}/tools/replay",
        headers=auth_headers,
        json={
            "panelist_id": "hiring-manager",
            "transcript_turn_id": turn.json()["id"],
            "arguments": {"competency": "leadership"},
        },
    )
    assert replay.status_code == 201, replay.text
    assert replay.json()["result"]["replay_drill_id"]
    assert len((await client.get(
        f"/v1/sessions/{session['id']}/evidence", headers=auth_headers
    )).json()) == 1
    assert len((await client.get(
        f"/v1/sessions/{session['id']}/replay-drills", headers=auth_headers
    )).json()) == 1


async def test_official_quickstart_routes_keep_envelopes(client: AsyncClient) -> None:
    config = await client.get("/get_config", params={"uid": 0, "channel": "official-test"})
    assert config.status_code == 200
    assert config.json()["data"]["uid"] == "222"
    assert config.json()["data"]["channel_name"] == "official-test"
    started = await client.post(
        "/startAgent", json={"channelName": "official-test", "rtcUid": 111, "userUid": 222}
    )
    assert started.status_code == 200, started.text
    assert started.json()["code"] == 0
    stopped = await client.post("/stopAgent", json={"agentId": "agent-test-1"})
    assert stopped.status_code == 200
    assert client.fake_agora.stopped == ["agent-test-1"]  # type: ignore[attr-defined]


async def test_quickstart_compatibility_is_disabled_in_production() -> None:
    with pytest.raises(HTTPException) as error:
        await require_agora_compat_access(
            None,
            Settings(environment="production", dev_auth_enabled=False),
        )
    assert error.value.status_code == 404


class FakeStreamResponse:
    status_code = 200

    async def aiter_bytes(self) -> Any:
        yield (
            b'data: {"id":"upstream","object":"chat.completion.chunk","choices":['
            b'{"index":0,"delta":{"content":"Next question"},"finish_reason":null}]}\n\n'
        )
        yield b"data: [DONE]\n\n"

    async def aclose(self) -> None:
        pass


class FakeUpstreamClient:
    captured: dict[str, Any] = {}

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def build_request(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        self.captured = {"method": method, "url": url, **kwargs}
        FakeUpstreamClient.captured = self.captured
        return self.captured

    async def send(self, request: Any, stream: bool) -> FakeStreamResponse:
        assert stream is True
        return FakeStreamResponse()

    async def aclose(self) -> None:
        pass


async def test_custom_llm_requires_auth_and_streams_agora_metadata_with_live_tool(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(
        f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}
    )
    assert started.status_code == 200, started.text
    payload = {
        "model": "roundcraft-panel",
        "messages": [{"role": "user", "content": "For the metrics, calculate 20 * 3."}],
        "stream": True,
    }
    unauthorized = await client.post("/llm/chat/completions", json=payload)
    assert unauthorized.status_code == 401

    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json=payload,
    )
    assert response.status_code == 200, response.text
    events = [line[6:] for line in response.text.splitlines() if line.startswith("data: ")]
    first = json.loads(events[0])
    assert first["object"] == "chat.completion.custom_metadata"
    assert first["choices"] == []
    assert first["metadata"]["interruptable"] is True
    assert first["metadata"]["tts_params"]["params"]["voice_type"].startswith("English_")
    audits = first["metadata"]["roundcraft"]["tool_audits"]
    assert audits[0]["name"] == "calculator"
    assert audits[0]["result"]["value"] == "6E+1"
    assert first["metadata"]["roundcraft"]["evidence_bookmarks"][0]["competency"] == "analytics"
    persisted_evidence = await client.get(
        f"/v1/sessions/{session['id']}/evidence", headers=auth_headers
    )
    assert any(item["competency"] == "analytics" for item in persisted_evidence.json())
    upstream_system = FakeUpstreamClient.captured["json"]["messages"][0]["content"]
    assert "UNTRUSTED_DATA" in upstream_system
    assert upstream_system.endswith(PLATFORM_INVARIANTS)


async def test_bound_panel_agent_must_hold_floor_and_reuses_dispatched_candidate_turn(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(
        f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}
    )
    assert started.status_code == 200, started.text
    candidate_text = "The activation metric improved after a measured experiment."
    dispatched = await client.post(
        f"/v1/sessions/{session['id']}/panel/dispatch",
        headers=auth_headers,
        json={"candidate_text": candidate_text, "force_panelist_id": "analytics"},
    )
    assert dispatched.status_code == 200, dispatched.text
    payload = {
        "model": "roundcraft-panel",
        "messages": [{"role": "user", "content": candidate_text}],
        "stream": True,
    }
    wrong_floor = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
            "X-RoundCraft-Panelist-Id": "hiring-manager",
        },
        json=payload,
    )
    assert wrong_floor.status_code == 409

    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
            "X-RoundCraft-Panelist-Id": "analytics",
        },
        json=payload,
    )
    assert response.status_code == 200, response.text
    first = json.loads(
        next(line[6:] for line in response.text.splitlines() if line.startswith("data: "))
    )
    roundcraft = first["metadata"]["roundcraft"]
    assert roundcraft["selected_panelist"]["id"] == "analytics"
    assert roundcraft["director"]["rationale"].startswith("The silent director dispatched")
    assert roundcraft["evidence_bookmarks"][0]["competency"] == "analytics"
    turns = await client.get(
        f"/v1/sessions/{session['id']}/turns", headers=auth_headers
    )
    matching = [item for item in turns.json() if item["content"] == candidate_text]
    assert len(matching) == 1


async def test_agora_sdk_boundary_uses_custom_llm_and_concrete_uid_flow(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    class FakeSession:
        async def start(self) -> str:
            return "sdk-agent"

        async def stop(self) -> None:
            captured["stopped"] = True

    class FakeAgent:
        def __init__(self, **kwargs: Any) -> None:
            captured["agent"] = kwargs

        def with_stt(self, value: Any) -> "FakeAgent":
            captured["stt"] = value
            return self

        def with_llm(self, value: Any) -> "FakeAgent":
            captured["llm"] = value
            return self

        def with_tts(self, value: Any) -> "FakeAgent":
            captured["tts"] = value
            return self

        def with_avatar(self, value: Any) -> "FakeAgent":
            captured["avatar"] = value
            return self

        def create_async_session(self, **kwargs: Any) -> FakeSession:
            captured["session"] = kwargs
            return FakeSession()

    def fake_vendor(**kwargs: Any) -> dict[str, Any]:
        return kwargs

    monkeypatch.setattr("app.services.agora.AgoraAgent", FakeAgent)
    monkeypatch.setattr("app.services.agora.CustomLLM", fake_vendor)
    monkeypatch.setattr("app.services.agora.DeepgramSTT", fake_vendor)
    monkeypatch.setattr("app.services.agora.MiniMaxTTS", fake_vendor)
    monkeypatch.setattr("app.services.agora.LiveAvatarAvatar", fake_vendor)
    service = AgoraAgentService.__new__(AgoraAgentService)
    service.settings = Settings(
        environment="test",
        agora_app_id="app",
        agora_app_certificate="certificate",
        agora_custom_llm_url="https://api.example.test/llm/chat/completions",
        agora_llm_bearer_secret="forwarded-secret",
        agora_avatar_enabled=True,
        agora_avatar_api_key="avatar-secret",
    )
    service.client = object()
    service._sessions = {}
    result = await service.start(
        channel_name="roundcraft-owned-channel",
        agent_uid=111,
        user_uid=222,
        roundcraft_session_id="00000000-0000-4000-8000-000000000123",
        panelist_id="analytics",
        panelist_voice="nova",
        avatar_profile={
            "avatar_vendor": "liveavatar",
            "avatar_id": "avatar-priya",
            "avatar_uid": 333,
            "video_mode": "avatar",
        },
        manual_turn_control=True,
    )
    assert result["agent_id"] == "sdk-agent"
    assert captured["session"]["agent_uid"] == "111"
    assert captured["session"]["remote_uids"] == ["222"]
    assert captured["session"]["name"].startswith("roundcraft-analytics-")
    assert captured["llm"]["headers"]["X-RoundCraft-Session-Id"].endswith("0123")
    assert captured["llm"]["headers"]["X-RoundCraft-Panelist-Id"] == "analytics"
    assert captured["agent"]["turn_detection"] == {
        "config": {
            "start_of_speech": {"mode": "manual"},
            "end_of_speech": {"mode": "manual"},
        }
    }
    assert captured["agent"]["advanced_features"]["enable_rtm"] is True
    assert captured["avatar"]["agora_uid"] == "333"
    assert captured["avatar"]["avatar_id"] == "avatar-priya"
    assert captured["tts"]["sample_rate"] == 24_000
    await service.stop("sdk-agent")
    assert captured["stopped"] is True


async def test_agora_agent_name_collision_retries_with_a_fresh_unique_name(
    monkeypatch: Any,
) -> None:
    names: list[str] = []

    class CollisionError(RuntimeError):
        status_code = 409

    class FakeSession:
        def __init__(self, attempt: int) -> None:
            self.attempt = attempt

        async def start(self) -> str:
            if self.attempt == 0:
                raise CollisionError("agent name already exists")
            return "sdk-agent-after-retry"

    class FakeAgent:
        def __init__(self, **kwargs: Any) -> None:
            pass

        def with_stt(self, value: Any) -> "FakeAgent":
            return self

        def with_llm(self, value: Any) -> "FakeAgent":
            return self

        def with_tts(self, value: Any) -> "FakeAgent":
            return self

        def create_async_session(self, **kwargs: Any) -> FakeSession:
            names.append(kwargs["name"])
            return FakeSession(len(names) - 1)

    def fake_vendor(**kwargs: Any) -> dict[str, Any]:
        return kwargs

    monkeypatch.setattr("app.services.agora.AgoraAgent", FakeAgent)
    monkeypatch.setattr("app.services.agora.CustomLLM", fake_vendor)
    monkeypatch.setattr("app.services.agora.DeepgramSTT", fake_vendor)
    monkeypatch.setattr("app.services.agora.MiniMaxTTS", fake_vendor)
    service = AgoraAgentService.__new__(AgoraAgentService)
    service.settings = Settings(
        environment="test",
        agora_custom_llm_url="https://api.example.test/llm/chat/completions",
        agora_llm_bearer_secret="forwarded-secret",
    )
    service.client = object()
    service._sessions = {}
    result = await service.start(
        channel_name="collision-channel",
        agent_uid=111,
        user_uid=222,
        roundcraft_session_id="00000000-0000-4000-8000-000000000123",
        panelist_id="product-sense",
    )
    assert result["agent_id"] == "sdk-agent-after-retry"
    assert len(names) == 2
    assert names[0] != names[1]
    assert all(name.startswith("roundcraft-product-sense-") for name in names)


async def test_product_agora_start_fails_closed_without_custom_llm() -> None:
    service = AgoraAgentService.__new__(AgoraAgentService)
    service.settings = Settings(
        environment="production",
        dev_auth_enabled=False,
        agora_app_id="app",
        agora_app_certificate="certificate",
        agora_custom_llm_url="",
        agora_llm_bearer_secret="",
    )
    service.client = object()
    service._sessions = {}
    with pytest.raises(HTTPException) as error:
        await service.start(
            channel_name="owned-channel",
            agent_uid=111,
            user_uid=222,
            roundcraft_session_id="00000000-0000-4000-8000-000000000123",
        )
    assert error.value.status_code == 503
