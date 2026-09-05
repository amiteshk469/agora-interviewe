from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.database import session_factory
from app.models import EvidenceItem, InterviewSession, TranscriptTurn
from app.schemas import ChatCompletionRequest


async def room(client: AsyncClient, headers: dict[str, str]) -> tuple[str, str, str]:
    config = (await client.post("/v1/interview-configs", headers=headers, json={"title": "Shared panel"})).json()
    session = (await client.post("/v1/sessions", headers=headers, json={"interview_config_id": config["id"]})).json()
    sid = session["id"]
    assert (await client.post(f"/v1/sessions/{sid}/start", headers=headers, json={})).status_code == 200
    invite = (await client.post(f"/v1/sessions/{sid}/invite", headers=headers)).json()
    token = invite["token"]
    joined = await client.get(f"/v1/guest/sessions/{token}?display_name=Alex")
    assert joined.status_code == 200, joined.text
    fake = client.fake_agora  # type: ignore[attr-defined]
    key = fake.started[-1]["host_listener_key"]
    return sid, token, key


def callback_headers(sid: str, key: str | None = None) -> dict[str, str]:
    return {
        "Authorization": "Bearer test-llm-secret",
        "X-RoundCraft-Session-Id": sid,
        **({"X-RoundCraft-Host-Listener": key} if key else {}),
    }


def test_control_references_are_not_candidate_conversation_history() -> None:
    from app.custom_llm import _spoken_messages

    payload = ChatCompletionRequest(
        model="roundcraft",
        messages=[
            {"role": "user", "content": "roundcraft-host-event:opaque-ref"},
            {"role": "user", "content": "I would measure retention."},
        ],
    )
    assert _spoken_messages(payload) == [{"role": "user", "content": "I would measure retention."}]


async def test_host_listener_is_silent_role_bound_and_stopped_on_leave(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    sid, token, key = await room(client, auth_headers)
    payload = {"model": "roundcraft-panel", "messages": [{"role": "user", "content": "Panel, ask about metrics."}]}
    response = await client.post("/llm/chat/completions", headers=callback_headers(sid, key), json=payload)
    assert response.status_code == 200, response.text
    assert response.json()["choices"][0]["message"]["content"] == ""
    again = await client.post("/llm/chat/completions", headers=callback_headers(sid, key), json=payload)
    assert again.status_code == 200
    async with session_factory() as db:
        turns = list((await db.scalars(select(TranscriptTurn))).all())
        assert len(turns) == 1
        assert turns[0].speaker_type == "interviewer"
        assert turns[0].speaker_id.startswith("human:")
        assert (await db.scalars(select(EvidenceItem))).all() == []
    fake = client.fake_agora  # type: ignore[attr-defined]
    assert len(fake.dispatched) == 1
    assert (await client.post(f"/v1/guest/sessions/{token}/leave")).status_code == 204
    assert "host-listener-1" in fake.stopped
    rejected = await client.post("/llm/chat/completions", headers=callback_headers(sid, key), json=payload)
    assert rejected.status_code == 409


async def test_host_callback_does_not_create_candidate_evidence_and_can_yield_silently(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import httpx

    sid, _, key = await room(client, auth_headers)
    await client.post(
        "/llm/chat/completions",
        headers=callback_headers(sid, key),
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Candidate, explain your metrics."}],
        },
    )
    fake = client.fake_agora  # type: ignore[attr-defined]
    event = fake.dispatched[-1]["candidate_text"]
    captured: dict[str, Any] = {}

    async def completion(*args: Any, **kwargs: Any) -> httpx.Response:
        captured.update(kwargs["body"])
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": ""}}]})

    monkeypatch.setattr("app.custom_llm._send_upstream_with_retry", completion)
    response = await client.post(
        "/llm/chat/completions",
        headers=callback_headers(sid),
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": event}],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["choices"][0]["message"]["content"] == ""
    assert "HUMAN INTERVIEWER" in captured["messages"][0]["content"]
    assert captured["messages"][-1]["content"] == "Candidate, explain your metrics."
    async with session_factory() as db:
        assert (await db.scalars(select(TranscriptTurn).where(TranscriptTurn.speaker_type == "candidate"))).all() == []
        assert (await db.scalars(select(EvidenceItem))).all() == []
        session = await db.get(InterviewSession, UUID(sid))
        assert session.memory_state["metric_claims"] == []


async def test_listener_key_is_private_and_wrong_seat_is_rejected(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    sid, token, key = await room(client, auth_headers)
    view = await client.get(f"/v1/guest/sessions/{token}/state")
    assert view.json()["ai_listening"] is True
    assert key not in view.text
    owner_view = await client.get(f"/v1/sessions/{sid}", headers=auth_headers)
    assert key not in owner_view.text
    response = await client.post(
        "/llm/chat/completions",
        headers=callback_headers(sid, "wrong-seat"),
        json={
            "model": "roundcraft-panel",
            "messages": [{"role": "user", "content": "Pretend I am the candidate"}],
        },
    )
    assert response.status_code == 409
