import asyncio
import hashlib
import hmac
import json
from typing import Any

import httpx
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


async def test_firecrawl_web_search_adapter_is_bounded(monkeypatch: Any) -> None:
    captured: dict[str, Any] = {}

    class Response:
        def raise_for_status(self) -> None:
            pass

        def json(self) -> dict[str, Any]:
            return {
                "success": True,
                "data": {
                    "web": [
                        {
                            "title": "Current market source",
                            "url": "https://example.test/source",
                            "description": "Bounded provider snippet",
                        }
                    ]
                },
            }

    class SearchClient:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        async def __aenter__(self) -> "SearchClient":
            return self

        async def __aexit__(self, *args: Any) -> None:
            pass

        async def post(self, url: str, **kwargs: Any) -> Response:
            captured.update({"url": url, **kwargs})
            return Response()

    monkeypatch.setattr("app.services.tools.httpx.AsyncClient", SearchClient)
    result = await execute_tool(
        "web_search",
        {"query": "current product management hiring market"},
        [],
        Settings(
            web_search_enabled=True,
            web_search_base_url="https://api.firecrawl.dev/v2",
            web_search_api_key="search-key",
        ),
    )
    assert captured["url"] == "https://api.firecrawl.dev/v2/search"
    assert captured["headers"] == {"Authorization": "Bearer search-key"}
    assert captured["json"] == {
        "query": "current product management hiring market",
        "limit": 5,
        "sources": ["web"],
        "ignoreInvalidURLs": True,
        "timeout": 8_000,
    }
    assert result["results"][0]["url"] == "https://example.test/source"
    assert result["results"][0]["age"] is None


async def test_firecrawl_web_search_requires_key() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await execute_tool(
            "web_search",
            {"query": "current product management hiring market"},
            [],
            Settings(web_search_enabled=True, web_search_api_key=""),
        )
    assert exc_info.value.status_code == 503


async def test_firecrawl_web_search_rejects_oversized_query() -> None:
    with pytest.raises(ValueError, match="at most 500"):
        await execute_tool(
            "web_search",
            {"query": "x" * 501},
            [],
            Settings(web_search_enabled=True, web_search_api_key="search-key"),
        )


async def _create_session(client: AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    config = (await client.post("/v1/interview-configs", headers=headers, json={"title": "Tool test"})).json()
    return (await client.post("/v1/sessions", headers=headers, json={"interview_config_id": config["id"]})).json()


async def test_panel_dispatch_rejects_whitespace_only_candidate_text(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _create_session(client, auth_headers)
    response = await client.post(
        f"/v1/sessions/{session['id']}/panel/dispatch",
        headers=auth_headers,
        json={"candidate_text": "  \n  "},
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][-1] == "candidate_text"


async def test_tool_registry_executes_and_audits(client: AsyncClient, auth_headers: dict[str, str]) -> None:
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


async def test_internal_evidence_and_replay_are_not_interviewer_tools(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _create_session(client, auth_headers)
    turn = await client.post(
        f"/v1/sessions/{session['id']}/turns",
        headers=auth_headers,
        json={"sequence": 1, "speaker_type": "candidate", "content": "Here is my answer."},
    )
    assert turn.status_code == 201, turn.text
    denied_bookmark = await client.post(
        f"/v1/sessions/{session['id']}/tools/evidence_bookmark",
        headers=auth_headers,
        json={
            "panelist_id": "hiring-manager",
            "transcript_turn_id": turn.json()["id"],
            "arguments": {"competency": "leadership", "note": "Candidate claim to assess"},
        },
    )
    assert denied_bookmark.status_code == 403
    denied_replay = await client.post(
        f"/v1/sessions/{session['id']}/tools/replay",
        headers=auth_headers,
        json={
            "panelist_id": "hiring-manager",
            "transcript_turn_id": turn.json()["id"],
            "arguments": {"competency": "leadership"},
        },
    )
    assert denied_replay.status_code == 403

    bookmarked = await client.post(
        f"/v1/sessions/{session['id']}/evidence",
        headers=auth_headers,
        json={
            "transcript_turn_id": turn.json()["id"],
            "competency": "leadership",
            "note": "Candidate claim to assess",
        },
    )
    assert bookmarked.status_code == 201, bookmarked.text
    evidence = await client.get(f"/v1/sessions/{session['id']}/evidence", headers=auth_headers)
    assert len(evidence.json()) == 1


async def test_agora_rtm_turn_reallocates_a_stale_sequence_and_is_idempotent(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _create_session(client, auth_headers)
    synthetic = await client.post(
        f"/v1/sessions/{session['id']}/turns",
        headers=auth_headers,
        json={
            "sequence": 1,
            "speaker_type": "candidate",
            "content": "A custom LLM candidate turn.",
            "metadata": {"source": "agora-custom-llm"},
        },
    )
    assert synthetic.status_code == 201, synthetic.text

    rtm_payload = {
        "sequence": 1,
        "agora_turn_id": "agora-interviewer-turn-1",
        "speaker_type": "interviewer",
        "content": "What happened next?",
        "metadata": {"source": "agora_rtm"},
    }
    rtm = await client.post(
        f"/v1/sessions/{session['id']}/turns",
        headers=auth_headers,
        json=rtm_payload,
    )
    assert rtm.status_code == 201, rtm.text
    assert rtm.json()["sequence"] == 2

    duplicate = await client.post(
        f"/v1/sessions/{session['id']}/turns",
        headers=auth_headers,
        json={**rtm_payload, "content": "A replayed delivery must not duplicate me."},
    )
    assert duplicate.status_code == 201, duplicate.text
    assert duplicate.json()["id"] == rtm.json()["id"]


async def test_official_quickstart_routes_keep_envelopes(client: AsyncClient) -> None:
    config = await client.get("/get_config", params={"uid": 0, "channel": "official-test"})
    assert config.status_code == 200
    assert config.json()["data"]["uid"] == "222"
    assert config.json()["data"]["channel_name"] == "official-test"
    started = await client.post("/startAgent", json={"channelName": "official-test", "rtcUid": 111, "userUid": 222})
    assert started.status_code == 200, started.text
    assert started.json()["code"] == 0
    stopped = await client.post("/stopAgent", json={"agentId": "agent-test-1"})
    assert stopped.status_code == 200
    assert client.fake_agora.stopped == ["agent-test-1"]  # type: ignore[attr-defined]


async def test_quickstart_compatibility_is_disabled_outside_local_environments() -> None:
    with pytest.raises(HTTPException) as error:
        await require_agora_compat_access(
            None,
            Settings(environment="staging", dev_auth_enabled=False),
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
        raise AssertionError("stream must not be polled after the terminal event")

    async def aclose(self) -> None:
        pass


class FakeRejectedStreamResponse:
    def __init__(self, status_code: int = 429, retry_after: str = "0") -> None:
        self.status_code = status_code
        self.headers = {"retry-after": retry_after, "x-request-id": "request-test"}
        self.text = '{"error":"temporary capacity limit"}'

    async def aread(self) -> bytes:
        return self.text.encode()

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
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    payload = {
        "model": "roundcraft-panel",
        "messages": [
            {
                "role": "user",
                "content": "For the metrics, calculate 20 * 3.",
                "name": "agora-extension-that-groq-does-not-need",
            }
        ],
        "stream": True,
        "stream_options": {"include_usage": True},
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
    assert first["metadata"]["tts_params"]["params"] == {
        "voice_setting": {
            "voice_id": "hindi_female_1_v2",
            "speed": 1.02,
            "vol": 1.03,
            "pitch": 0,
            "emotion": "fluent",
            "english_normalization": True,
        },
        "language_boost": "English",
    }
    assert first["metadata"]["roundcraft"]["selected_panelist"]["id"] == "analytics"
    assert first["metadata"]["roundcraft"]["replayed_candidate_turn"] is False
    audits = first["metadata"]["roundcraft"]["tool_audits"]
    assert audits[0]["name"] == "calculator"
    assert audits[0]["result"]["value"] == "6E+1"
    assert first["metadata"]["roundcraft"]["evidence_bookmarks"][0]["competency"] == "analytics"
    persisted_evidence = await client.get(f"/v1/sessions/{session['id']}/evidence", headers=auth_headers)
    assert any(item["competency"] == "analytics" for item in persisted_evidence.json())
    upstream_system = FakeUpstreamClient.captured["json"]["messages"][0]["content"]
    assert "UNTRUSTED_DATA" in upstream_system
    assert upstream_system.endswith(PLATFORM_INVARIANTS)
    assert "stream_options" not in FakeUpstreamClient.captured["json"]
    assert FakeUpstreamClient.captured["json"]["max_tokens"] == 384
    assert FakeUpstreamClient.captured["json"]["messages"][-1] == {
        "role": "user",
        "content": "For the metrics, calculate 20 * 3.",
    }


@pytest.mark.parametrize("stream", [False, True])
async def test_custom_llm_empty_user_content_returns_benign_completion_without_persisting(
    client: AsyncClient, auth_headers: dict[str, str], stream: bool
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text

    responses = [
        await client.post(
            "/llm/chat/completions",
            headers={
                "Authorization": "Bearer test-llm-secret",
                "X-RoundCraft-Session-Id": session["id"],
            },
            json={
                "model": "roundcraft-panel",
                "messages": [{"role": "user", "content": "  \n  "}],
                "stream": stream,
            },
        )
        for _ in range(2)
    ]

    for response in responses:
        assert response.status_code == 200, response.text
        assert "Please repeat" not in response.text
        if stream:
            assert response.text.rstrip().endswith("data: [DONE]")
        else:
            assert response.json()["choices"][0]["message"]["content"] == ""
    turns = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    assert not [item for item in turns.json() if item["speaker_type"] == "candidate"]


async def test_custom_llm_keeps_distinct_prefix_answers_and_filters_empty_history(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    headers = {
        "Authorization": "Bearer test-llm-secret",
        "X-RoundCraft-Session-Id": session["id"],
    }

    first = await client.post(
        "/llm/chat/completions",
        headers=headers,
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "I improved the metric"}],
            "stream": True,
        },
    )
    second = await client.post(
        "/llm/chat/completions",
        headers=headers,
        json={
            "model": "roundcraft-panel",
            "messages": [
                {"role": "assistant", "content": "   "},
                {
                    "role": "user",
                    "content": "I improved the metric by 20 percent.",
                },
            ],
            "stream": True,
        },
    )

    assert first.status_code == second.status_code == 200
    turns = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    candidates = [item for item in turns.json() if item["speaker_type"] == "candidate"]
    assert [item["content"] for item in candidates] == [
        "I improved the metric",
        "I improved the metric by 20 percent.",
    ]
    assert FakeUpstreamClient.captured["json"]["messages"][-1]["content"] == candidates[-1]["content"]
    assert not any(not message["content"].strip() for message in FakeUpstreamClient.captured["json"]["messages"])


async def test_custom_llm_candidate_reconciles_with_whitespace_varied_agora_turn(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "I measured retention weekly."}],
            "stream": True,
        },
    )
    assert response.status_code == 200, response.text

    reconciled = await client.post(
        f"/v1/sessions/{session['id']}/turns",
        headers=auth_headers,
        json={
            "sequence": 1,
            "agora_turn_id": "agora-candidate-turn-1",
            "speaker_type": "candidate",
            "content": "I  measured\nretention weekly.",
            "metadata": {"source": "agora-rtm"},
        },
    )
    assert reconciled.status_code == 201, reconciled.text
    turns = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    candidates = [item for item in turns.json() if item["speaker_type"] == "candidate"]
    assert len(candidates) == 1
    assert candidates[0]["agora_turn_id"] == "agora-candidate-turn-1"


async def test_agora_history_reconciles_repeated_custom_llm_answers_one_to_one(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    llm_headers = {
        "Authorization": "Bearer test-llm-secret",
        "X-RoundCraft-Session-Id": session["id"],
    }
    candidate_text = "I measured retention weekly after an experiment."
    request = {
        "model": "roundcraft-panel",
        "messages": [{"role": "user", "content": candidate_text}],
        "stream": True,
    }
    for _ in range(2):
        response = await client.post(
            "/llm/chat/completions",
            headers=llm_headers,
            json=request,
        )
        assert response.status_code == 200, response.text

    before = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    before_candidates = [item for item in before.json() if item["speaker_type"] == "candidate"]
    assert len(before_candidates) == 2
    original_ids = [item["id"] for item in before_candidates]

    history = {
        "noticeId": "repeated-history-1",
        "eventType": 103,
        "payload": {
            "agentId": "agent-test-1",
            "history": [
                {
                    "turn_id": "agora-repeated-user-1",
                    "role": "user",
                    "content": candidate_text,
                },
                {
                    "turn_id": "agora-repeated-user-2",
                    "role": "user",
                    "content": "I  measured retention weekly\nafter an experiment.",
                },
            ],
        },
    }
    body = json.dumps(history).encode()
    signature = hmac.new(b"test-webhook-secret", body, hashlib.sha256).hexdigest()
    webhook = await client.post(
        "/v1/webhooks/agora",
        content=body,
        headers={"Content-Type": "application/json", "Agora-Signature-V2": signature},
    )
    assert webhook.status_code == 200, webhook.text

    after = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    after_candidates = [item for item in after.json() if item["speaker_type"] == "candidate"]
    assert [item["id"] for item in after_candidates] == original_ids
    assert [item["agora_turn_id"] for item in after_candidates] == [
        "agora-repeated-user-1",
        "agora-repeated-user-2",
    ]
    evidence = await client.get(f"/v1/sessions/{session['id']}/evidence", headers=auth_headers)
    assert {item["transcript_turn_id"] for item in evidence.json()} == set(original_ids)
    tool_runs = await client.get(f"/v1/sessions/{session['id']}/tool-runs", headers=auth_headers)
    panel_bids = [item for item in tool_runs.json() if item["tool_name"] == "panel.bid"]
    assert {item["transcript_turn_id"] for item in panel_bids} == set(original_ids)


async def test_network_tool_runs_after_the_session_lock_is_released(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    writer_completed = False

    async def execute_while_writing(
        name: str,
        arguments: dict[str, Any],
        corpus: list[dict[str, str]],
        settings: Settings,
    ) -> dict[str, Any]:
        nonlocal writer_completed
        assert name == "calculator"
        concurrent_turn = await asyncio.wait_for(
            client.post(
                f"/v1/sessions/{session['id']}/turns",
                headers=auth_headers,
                json={
                    "sequence": 999,
                    "speaker_type": "interviewer",
                    "content": "A concurrent transcript writer was not blocked.",
                    "metadata": {"source": "lock-test"},
                },
            ),
            timeout=1,
        )
        assert concurrent_turn.status_code == 201, concurrent_turn.text
        writer_completed = True
        return {"value": "60"}

    monkeypatch.setattr("app.custom_llm.execute_tool", execute_while_writing)
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "For the metrics, calculate 20 * 3."}],
            "stream": True,
        },
    )
    assert response.status_code == 200, response.text
    assert writer_completed is True


async def test_custom_llm_retries_transient_stream_failure_once(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    delays: list[float] = []

    async def capture_sleep(delay: float) -> None:
        delays.append(delay)

    class RetryThenSuccessClient(FakeUpstreamClient):
        attempts = 0

        async def send(self, request: Any, stream: bool) -> Any:
            type(self).attempts += 1
            if type(self).attempts == 1:
                return FakeRejectedStreamResponse(retry_after="0.25")
            return FakeStreamResponse()

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", RetryThenSuccessClient)
    monkeypatch.setattr("app.custom_llm.asyncio.sleep", capture_sleep)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Here is my decision."}],
            "stream": True,
        },
    )

    assert response.status_code == 200, response.text
    assert RetryThenSuccessClient.attempts == 2
    assert delays == [0.25]
    assert "Next question" in response.text


async def test_custom_llm_retries_transport_failure_once(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    class RetryTransportClient(FakeUpstreamClient):
        attempts = 0

        async def send(self, request: Any, stream: bool) -> Any:
            type(self).attempts += 1
            if type(self).attempts == 1:
                raise httpx.ConnectError(
                    "temporary connection failure",
                    request=httpx.Request("POST", "https://llm.test"),
                )
            return FakeStreamResponse()

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", RetryTransportClient)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Here is my decision."}],
            "stream": True,
        },
    )

    assert response.status_code == 200, response.text
    assert RetryTransportClient.attempts == 2
    assert "Next question" in response.text


async def test_custom_llm_recovers_when_stream_disconnects_before_content(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    class DisconnectingResponse(FakeStreamResponse):
        headers = {"x-request-id": "safe-request"}

        async def aiter_bytes(self) -> Any:
            if False:
                yield b""
            raise httpx.ReadError(
                "stream disconnected",
                request=httpx.Request("POST", "https://llm.test"),
            )

    class DisconnectingClient(FakeUpstreamClient):
        async def send(self, request: Any, stream: bool) -> Any:
            assert stream is True
            return DisconnectingResponse()

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", DisconnectingClient)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Here is my evidence."}],
            "stream": True,
        },
    )

    assert response.status_code == 200, response.text
    assert response.text.rstrip().endswith("data: [DONE]")
    assert '"content":"' in response.text
    assert response.text.count("data: [DONE]") == 1


async def test_custom_llm_replaces_clean_non_audible_stream(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    class NonAudibleResponse(FakeStreamResponse):
        headers = {"x-request-id": "safe-request"}

        async def aiter_bytes(self) -> Any:
            yield b": keepalive\n\n"
            yield b"data: {malformed}\n\n"
            yield (
                b'data: {"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n'
            )
            yield b"data: [DONE]\n\n"
            raise AssertionError("stream must not be polled after the terminal event")

    class NonAudibleClient(FakeUpstreamClient):
        async def send(self, request: Any, stream: bool) -> Any:
            assert stream is True
            return NonAudibleResponse()

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", NonAudibleClient)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Here is my evidence."}],
            "stream": True,
        },
    )

    assert response.status_code == 200, response.text
    events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: {")]
    spoken = [
        choice["delta"]["content"]
        for event in events
        for choice in event.get("choices", [])
        if choice.get("delta", {}).get("content")
    ]
    assert len(spoken) == 1
    assert response.text.count("data: [DONE]") == 1


async def test_custom_llm_times_out_heartbeat_only_stream(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    class HeartbeatResponse(FakeStreamResponse):
        headers = {"x-request-id": "safe-request"}

        async def aiter_bytes(self) -> Any:
            yield b": keepalive\n\n"
            await asyncio.sleep(60)
            yield b": unreachable\n\n"

    class HeartbeatClient(FakeUpstreamClient):
        async def send(self, request: Any, stream: bool) -> Any:
            assert stream is True
            return HeartbeatResponse()

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", HeartbeatClient)
    monkeypatch.setattr("app.custom_llm._FIRST_CONTENT_TIMEOUT_SECONDS", 0.01)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Here is my evidence."}],
            "stream": True,
        },
    )

    assert response.status_code == 200, response.text
    assert response.text.count("data: [DONE]") == 1
    assert '"content":"' in response.text


async def test_custom_llm_recognizes_split_stream_content_and_terminates_it(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    class SplitContentResponse(FakeStreamResponse):
        async def aiter_bytes(self) -> Any:
            yield (b'data: {"id":"split","choices":[{"index":0,"delta":{"role":"assistant","content":"Split')
            yield b' question"},"finish_reason":null}]}\n\n'

    class SplitContentClient(FakeUpstreamClient):
        async def send(self, request: Any, stream: bool) -> Any:
            assert stream is True
            return SplitContentResponse()

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", SplitContentClient)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Here is my evidence."}],
            "stream": True,
        },
    )

    assert response.status_code == 200, response.text
    assert "Split question" in response.text
    assert "Could you expand on that" not in response.text
    assert response.text.count("data: [DONE]") == 1


async def test_custom_llm_replaces_malformed_non_stream_completion(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    class MalformedResponse:
        status_code = 200
        headers = {"x-request-id": "safe-request"}

        def json(self) -> dict[str, Any]:
            return {"choices": []}

    class MalformedClient(FakeUpstreamClient):
        async def __aenter__(self) -> "MalformedClient":
            return self

        async def __aexit__(self, *args: Any) -> None:
            pass

        async def send(self, request: Any, stream: bool) -> Any:
            assert stream is False
            return MalformedResponse()

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", MalformedClient)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Here is my decision."}],
            "stream": False,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["choices"][0]["message"]["content"]
    assert response.json()["roundcraft"]["selected_panelist"]


async def test_custom_llm_uses_director_continuation_after_transient_retries_exhausted(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: Any,
    caplog: Any,
) -> None:
    class AlwaysLimitedClient(FakeUpstreamClient):
        attempts = 0

        async def send(self, request: Any, stream: bool) -> Any:
            type(self).attempts += 1
            response = FakeRejectedStreamResponse()
            response.text = '{"error":"private candidate transcript must not be logged"}'
            return response

    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", AlwaysLimitedClient)

    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "I would prioritize it."}],
            "stream": True,
        },
    )

    assert response.status_code == 200, response.text
    assert AlwaysLimitedClient.attempts == 2
    assert "What evidence would let us verify that claim?" in response.text
    assert "chat.completion.custom_metadata" in response.text
    assert response.text.rstrip().endswith("data: [DONE]")
    assert "private candidate transcript" not in caplog.text
    assert "test-upstream-key" not in caplog.text


async def test_custom_llm_consumes_role_template_metadata_without_internal_tool_claims(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    template = await client.post(
        "/v1/prompt-templates",
        headers=auth_headers,
        json={
            "slug": "retention-forensics",
            "name": "Retention Forensics",
            "role": "Retention Specialist",
            "prompt": (
                "Investigate retention decisions with evidence-grounded follow-ups. "
                "Never request a human reviewer or escalation."
            ),
            "knowledge": {
                "case_type": "Metric diagnosis case",
                "domains": ["retention diagnostics"],
                "scenario_seeds": ["Week-four retention fell after the onboarding flow changed."],
                "scoring_focus": ["analytics"],
                "rubric": [
                    {
                        "key": "retention_diagnosis",
                        "label": "Retention diagnosis",
                        "evidence": "Separates cohort, instrumentation, and product explanations.",
                        "anchors": {
                            "1": "Jumps directly to a cause or solution.",
                            "3": "Ranks plausible causes and identifies useful cohort cuts.",
                            "5": "Uses disconfirming tests and updates the diagnosis from evidence.",
                        },
                    }
                ],
            },
            "behavior": {
                "mood": "forensic-calm",
                "style": "forensic-retention",
                "interruption": "only-on-unsupported-metrics",
                "adaptive_probe": "Ask which cohort disproves the retention hypothesis.",
                "panel_selection": "non_round_robin",
                "evidence_policy": "final_transcript_turn_ids_only",
                "allowed_tools": [
                    "knowledge_search",
                    "web_search",
                    "evidence_bookmark",
                    "replay",
                ],
            },
        },
    )
    assert template.status_code == 201, template.text
    assert template.json()["behavior"]["allowed_tools"] == [
        "knowledge_search",
        "web_search",
    ]

    config = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={
            "title": "Metadata runtime",
            "enabled_tools": ["knowledge_search", "web_search"],
            "panel": [
                {
                    "id": "retention-specialist",
                    "display_name": "Rina Shah",
                    "role": "Retention Specialist",
                    "expertise": ["retention"],
                    "prompt_template_id": template.json()["id"],
                },
                {
                    "id": "leadership-partner",
                    "display_name": "Leah Morgan",
                    "role": "Leadership Interviewer",
                    "expertise": ["stakeholders"],
                },
            ],
        },
    )
    assert config.status_code == 201, config.text
    session = await client.post(
        "/v1/sessions",
        headers=auth_headers,
        json={"interview_config_id": config.json()["id"]},
    )
    assert session.status_code == 201, session.text
    started = await client.post(
        f"/v1/sessions/{session.json()['id']}/start",
        headers=auth_headers,
        json={},
    )
    assert started.status_code == 200, started.text

    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session.json()["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [
                {
                    "role": "user",
                    "content": "My retention diagnostics focused on the week-four cohort.",
                }
            ],
            "stream": True,
        },
    )
    assert response.status_code == 200, response.text
    first = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    roundcraft = first["metadata"]["roundcraft"]
    assert roundcraft["selected_panelist"]["id"] == "retention-specialist"
    assert roundcraft["enabled_tools"] == ["knowledge_search", "web_search"]
    assert roundcraft["selected_panelist"]["template_knowledge"] == {
        "case_type": "Metric diagnosis case",
        "domains": ["retention diagnostics"],
        "scenario_seeds": ["Week-four retention fell after the onboarding flow changed."],
        "scoring_focus": ["analytics"],
        "rubric": [
            {
                "key": "retention_diagnosis",
                "label": "Retention diagnosis",
                "evidence": "Separates cohort, instrumentation, and product explanations.",
                "anchors": {
                    "1": "Jumps directly to a cause or solution.",
                    "3": "Ranks plausible causes and identifies useful cohort cuts.",
                    "5": "Uses disconfirming tests and updates the diagnosis from evidence.",
                },
            }
        ],
    }
    assert roundcraft["selected_panelist"]["template_behavior"]["allowed_tools"] == [
        "knowledge_search",
        "web_search",
    ]
    assert [item["key"] for item in roundcraft["selected_panelist"]["role_rubric"]] == ["retention_diagnosis"]
    assert [item["competency"] for item in roundcraft["evidence_bookmarks"]] == ["retention_diagnosis"]

    upstream_system = FakeUpstreamClient.captured["json"]["messages"][0]["content"]
    assert "- Style: forensic-retention" in upstream_system
    assert "- Interruption policy: only-on-unsupported-metrics" in upstream_system
    assert "- Adaptive probe: Ask which cohort disproves the retention hypothesis." in upstream_system
    assert "- Scoring focus: Retention diagnosis" in upstream_system
    assert "- Live interviewer tools: knowledge_search, web_search" in upstream_system
    assert "evidence_bookmark" not in upstream_system
    assert "replay tool" not in upstream_system.lower()
    assert "you may request a human reviewer" not in upstream_system.lower()
    assert upstream_system.endswith(PLATFORM_INVARIANTS)


async def test_pending_dispatch_reuses_its_turn_but_a_repeated_answer_is_new(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
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
    first = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    roundcraft = first["metadata"]["roundcraft"]
    assert roundcraft["selected_panelist"]["id"] == "analytics"
    assert roundcraft["director"]["rationale"].startswith("Explicit panel floor selection")
    assert roundcraft["replayed_candidate_turn"] is False
    assert roundcraft["evidence_bookmarks"][0]["competency"] == "analytics"

    duplicate = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json=payload,
    )
    assert duplicate.status_code == 200, duplicate.text
    duplicate_first = json.loads(next(line[6:] for line in duplicate.text.splitlines() if line.startswith("data: ")))
    assert duplicate_first["metadata"]["roundcraft"]["replayed_candidate_turn"] is False

    turns = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    matching = [item for item in turns.json() if item["content"] == candidate_text]
    assert len(matching) == 2
    tool_runs = await client.get(f"/v1/sessions/{session['id']}/tool-runs", headers=auth_headers)
    assert sum(item["tool_name"] == "panel.bid" for item in tool_runs.json()) == 2


async def test_stale_pending_dispatch_cannot_capture_the_next_candidate_answer(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _create_session(client, auth_headers)
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    stale_text = "I calculated activation after the experiment."
    current_text = "I would prioritize the customer segment with the clearest unmet need."
    dispatched = await client.post(
        f"/v1/sessions/{session['id']}/panel/dispatch",
        headers=auth_headers,
        json={"candidate_text": stale_text, "force_panelist_id": "analytics"},
    )
    assert dispatched.status_code == 200, dispatched.text

    monkeypatch.setattr("app.custom_llm.httpx.AsyncClient", FakeUpstreamClient)
    response = await client.post(
        "/llm/chat/completions",
        headers={
            "Authorization": "Bearer test-llm-secret",
            "X-RoundCraft-Session-Id": session["id"],
        },
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": current_text}],
            "stream": True,
        },
    )
    assert response.status_code == 200, response.text
    first = json.loads(next(line[6:] for line in response.text.splitlines() if line.startswith("data: ")))
    roundcraft = first["metadata"]["roundcraft"]
    assert not roundcraft["director"]["rationale"].startswith("Explicit panel floor selection")

    turns = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    candidates = [item for item in turns.json() if item["speaker_type"] == "candidate"]
    assert [item["content"] for item in candidates] == [stale_text, current_text]
    stale_id, current_id = (item["id"] for item in candidates)

    tool_runs = await client.get(f"/v1/sessions/{session['id']}/tool-runs", headers=auth_headers)
    dispatch_run = next(item for item in tool_runs.json() if item["tool_name"] == "panel.dispatch")
    bid_run = next(item for item in tool_runs.json() if item["tool_name"] == "panel.bid")
    assert dispatch_run["transcript_turn_id"] == stale_id
    assert bid_run["transcript_turn_id"] == current_id

    refreshed = await client.get(f"/v1/sessions/{session['id']}", headers=auth_headers)
    assert refreshed.status_code == 200, refreshed.text
    assert refreshed.json()["memory_state"]["pending_candidate_turn_id"] is None
    assert refreshed.json()["memory_state"]["pending_panelist_id"] is None


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
    )
    assert result["agent_id"] == "sdk-agent"
    assert captured["session"]["agent_uid"] == "111"
    assert captured["session"]["remote_uids"] == ["222"]
    assert captured["session"]["name"].startswith("roundcraft-interviewer-")
    assert captured["llm"]["headers"]["X-RoundCraft-Session-Id"].endswith("0123")
    assert "X-RoundCraft-Panelist-Id" not in captured["llm"]["headers"]
    assert captured["agent"]["turn_detection"] == {
        "config": {
            "speech_threshold": 0.5,
            "start_of_speech": {
                "mode": "vad",
                "vad_config": {"interrupt_duration_ms": 160, "prefix_padding_ms": 300},
            },
            "end_of_speech": {
                "mode": "vad",
                "vad_config": {"silence_duration_ms": 900},
            },
        }
    }
    assert captured["agent"]["advanced_features"]["enable_rtm"] is True
    assert "avatar" not in captured
    assert captured["tts"]["sample_rate"] is None
    assert captured["tts"]["voice_id"] == "hindi_female_2_v1"
    assert captured["tts"]["speed"] == 0.94
    assert captured["tts"]["vol"] == 1.0
    assert captured["tts"]["pitch"] == -1
    assert captured["tts"]["emotion"] == "calm"
    assert captured["tts"]["english_normalization"] is True
    assert captured["tts"]["language_boost"] == "English"
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
        environment="staging",
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
