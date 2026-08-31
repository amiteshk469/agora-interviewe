import hashlib
import hmac
import json
from typing import Any

import pytest
from fastapi import HTTPException
from httpx import AsyncClient

from app.core.config import Settings
from app.services.agora import AgoraAgentService


def _panel(count: int) -> list[dict[str, Any]]:
    return [
        {
            "id": f"panel-{index}",
            "display_name": f"Panelist {index}",
            "role": "Product Interviewer",
            "expertise": ["product"],
            "voice": "nova" if index % 2 == 0 else "atlas",
            "mood": "professional",
            "behavior": "evidence-seeking",
            "interruption_style": "contextual",
            "allowed_tools": ["knowledge_search"],
            "avatar_id": f"avatar-{index}",
            "avatar_vendor": "liveavatar",
            "avatar_image": f"https://images.example.test/panel-{index}.png",
        }
        for index in range(count)
    ]


def _service(settings: Settings) -> AgoraAgentService:
    service = AgoraAgentService.__new__(AgoraAgentService)
    service.settings = settings
    service.client = object()
    service._sessions = {}
    return service


def test_panel_connection_allocates_distinct_agent_and_avatar_uids() -> None:
    service = _service(
        Settings(
            agora_app_id="a" * 32,
            agora_app_certificate="c" * 32,
            agora_avatar_enabled=True,
            agora_avatar_api_key="avatar-key",
            agora_avatar_ids='{"avatar-0":"provider-avatar-0"}',
        )
    )
    for count in (2, 5):
        plan = service.generate_panel_connection(_panel(count))
        roster = plan["connection"]["panelists"]
        assert len(roster) == count
        all_uids = {
            int(plan["connection"]["uid"]),
            *(int(item["agent_uid"]) for item in roster),
            *(int(item["avatar_uid"]) for item in roster),
        }
        assert len(all_uids) == 1 + count * 2
        assert all(item["video_mode"] == "avatar" for item in roster)
        assert plan["participants"][0]["avatar_id"] == "provider-avatar-0"


def test_avatar_configuration_falls_back_without_exposing_partial_vendor_state() -> None:
    static_service = _service(
        Settings(
            agora_app_id="a" * 32,
            agora_app_certificate="c" * 32,
            agora_avatar_enabled=True,
            agora_avatar_api_key="",
        )
    )
    static = static_service.avatar_profile(_panel(2)[0], 1001)
    assert static["video_mode"] == "static"
    assert static["avatar_vendor"] is None

    audio_member = {**_panel(2)[0], "avatar_image": None}
    audio = static_service.avatar_profile(audio_member, 1002)
    assert audio["video_mode"] == "audio"

    generic_service = _service(
        Settings(
            agora_app_id="a" * 32,
            agora_app_certificate="c" * 32,
            agora_avatar_vendor="generic",
            agora_avatar_api_key="avatar-key",
            agora_avatar_api_base_url="",
        )
    )
    generic = generic_service.avatar_profile(
        {**_panel(2)[0], "avatar_vendor": "generic"}, 1003
    )
    assert generic["video_mode"] == "static"

    anam_service = _service(
        Settings(
            agora_avatar_vendor="anam",
            agora_avatar_api_key="",
            agora_anam_api_key="anam-only-key",
        )
    )
    anam = anam_service.avatar_profile(
        {**_panel(2)[0], "avatar_vendor": "anam"}, 1004
    )
    assert anam["video_mode"] == "avatar"
    assert anam["avatar_vendor"] == "anam"


async def test_group_start_binds_every_agent_and_rolls_back_partial_failure(
    monkeypatch: Any,
) -> None:
    service = _service(Settings(environment="test"))
    participants = [
        {
            "panelist_id": item["id"],
            "display_name": item["display_name"],
            "role": item["role"],
            "agent_uid": 111 + index,
            "avatar_uid": 1001 + index,
            "avatar_vendor": None,
            "avatar_id": item["avatar_id"],
            "avatar_image": item["avatar_image"],
            "video_mode": "static",
        }
        for index, item in enumerate(_panel(3))
    ]
    calls: list[dict[str, Any]] = []
    stopped: list[str] = []

    async def start(**kwargs: Any) -> dict[str, Any]:
        calls.append(kwargs)
        return {
            "agent_id": f"agent-{kwargs['panelist_id']}",
            "panelist_id": kwargs["panelist_id"],
        }

    async def stop(agent_id: str) -> None:
        stopped.append(agent_id)

    monkeypatch.setattr(service, "start", start)
    monkeypatch.setattr(service, "stop", stop)
    result = await service.start_panel(
        channel_name="one-shared-channel",
        user_uid=222,
        participants=participants,
        panel=_panel(3),
        instructions="Shared invariant prompt",
        roundcraft_session_id="session-1",
    )
    assert len(result) == 3
    assert {item["agent_uid"] for item in calls} == {111, 112, 113}
    assert all(item["channel_name"] == "one-shared-channel" for item in calls)
    assert all(item["manual_turn_control"] is True for item in calls)
    assert {item["panelist_id"] for item in calls} == {"panel-0", "panel-1", "panel-2"}
    assert sum(bool(item["greeting"]) for item in calls) == 1

    async def partially_fail(**kwargs: Any) -> dict[str, Any]:
        if kwargs["panelist_id"] == "panel-1":
            raise RuntimeError("provider start failed")
        return {
            "agent_id": f"agent-{kwargs['panelist_id']}",
            "panelist_id": kwargs["panelist_id"],
        }

    monkeypatch.setattr(service, "start", partially_fail)
    with pytest.raises(HTTPException) as error:
        await service.start_panel(
            channel_name="rollback-channel",
            user_uid=222,
            participants=participants,
            panel=_panel(3),
            instructions="Shared invariant prompt",
            roundcraft_session_id="session-2",
        )
    assert error.value.status_code == 502
    assert set(stopped) == {"agent-panel-0", "agent-panel-2"}


async def test_stateless_interrupt_fallback_signs_request_and_group_cleanup_attempts_all(
    monkeypatch: Any,
) -> None:
    captured: dict[str, Any] = {}

    class FakeAgents:
        async def interrupt(
            self,
            app_id: str,
            agent_id: str,
            *,
            request_options: dict[str, Any],
        ) -> None:
            captured.update(
                {
                    "app_id": app_id,
                    "agent_id": agent_id,
                    "request_options": request_options,
                }
            )

    class FakeAgentManagement:
        async def agent_think(
            self,
            app_id: str,
            agent_id: str,
            **kwargs: Any,
        ) -> None:
            captured["think"] = {
                "app_id": app_id,
                "agent_id": agent_id,
                **kwargs,
            }

    class FakeClient:
        agents = FakeAgents()
        agent_management = FakeAgentManagement()

    service = _service(
        Settings(
            environment="test",
            agora_app_id="a" * 32,
            agora_app_certificate="c" * 32,
        )
    )
    service.client = FakeClient()
    monkeypatch.setattr(
        "app.services.agora.generate_convo_ai_token",
        lambda **_: "short-lived-interrupt-token",
    )
    await service.interrupt("runtime-agent-2")
    assert captured == {
        "app_id": "a" * 32,
        "agent_id": "runtime-agent-2",
        "request_options": {
            "additional_headers": {
                "Authorization": "agora token=short-lived-interrupt-token"
            }
        },
    }

    dispatch_mode = await service.dispatch_turn(
        "runtime-agent-3",
        "Candidate response delivered across a stateless API request.",
        "panel-3",
        channel_name="shared-channel",
        agent_uid=113,
    )
    assert dispatch_mode == "think_injected"
    assert captured["think"]["app_id"] == "a" * 32
    assert captured["think"]["agent_id"] == "runtime-agent-3"
    assert captured["think"]["on_speaking_action"] == "interrupt"
    assert captured["think"]["metadata"] == {"roundcraft_panelist_id": "panel-3"}
    assert captured["think"]["request_options"] == {
        "additional_headers": {
            "Authorization": "agora token=short-lived-interrupt-token"
        }
    }

    attempted: list[str] = []

    async def flaky_stop(agent_id: str) -> None:
        attempted.append(agent_id)
        if agent_id == "runtime-agent-2":
            raise RuntimeError("leave rejected")

    monkeypatch.setattr(service, "stop", flaky_stop)
    with pytest.raises(HTTPException) as error:
        await service.stop_panel(
            ["runtime-agent-1", "runtime-agent-2", "runtime-agent-3"]
        )
    assert error.value.status_code == 502
    assert set(attempted) == {
        "runtime-agent-1",
        "runtime-agent-2",
        "runtime-agent-3",
    }


async def test_api_roster_dispatch_interrupt_and_webhook_mapping(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs",
            headers=auth_headers,
            json={"title": "Avatar panel", "panel": _panel(5)},
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions",
            headers=auth_headers,
            json={"interview_config_id": config["id"]},
        )
    ).json()
    started = await client.post(
        f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}
    )
    assert started.status_code == 200, started.text
    connection_roster = started.json()["connection"]["panelists"]
    assert len(connection_roster) == 5
    assert len({item["agent_uid"] for item in connection_roster}) == 5
    assert len({item["avatar_uid"] for item in connection_roster}) == 5

    roster = await client.get(
        f"/v1/sessions/{session['id']}/participants", headers=auth_headers
    )
    assert roster.status_code == 200
    assert all(item["status"] == "running" for item in roster.json())

    dispatched = await client.post(
        f"/v1/sessions/{session['id']}/panel/dispatch",
        headers=auth_headers,
        json={
            "candidate_text": "I prioritized the customer problem using research.",
            "force_panelist_id": "panel-3",
        },
    )
    assert dispatched.status_code == 200, dispatched.text
    assert dispatched.json()["participant"]["panelist_id"] == "panel-3"
    assert dispatched.json()["manual_turn"] == {
        "mode": "manual_sos_eos",
        "agent_user_id": "114",
        "send_manual_sos": True,
        "send_manual_eos": True,
        "server_dispatch": "think_injected",
    }
    assert client.fake_agora.dispatched[-1]["panelist_id"] == "panel-3"  # type: ignore[attr-defined]
    assert len(client.fake_agora.interrupted) == 4  # type: ignore[attr-defined]

    interrupted = await client.post(
        f"/v1/sessions/{session['id']}/interrupt",
        headers=auth_headers,
        json={"reason": "candidate_barge_in"},
    )
    assert interrupted.json() == {"interrupted_panelist_ids": ["panel-3"]}

    webhook_payload = {
        "noticeId": "avatar-left-1",
        "eventType": 102,
        "payload": {"agentId": "agent-test-2"},
    }
    body = json.dumps(webhook_payload).encode()
    signature = hmac.new(b"test-webhook-secret", body, hashlib.sha256).hexdigest()
    webhook = await client.post(
        "/v1/webhooks/agora",
        content=body,
        headers={"Content-Type": "application/json", "Agora-Signature-V2": signature},
    )
    assert webhook.status_code == 200
    updated_roster = (
        await client.get(
            f"/v1/sessions/{session['id']}/participants", headers=auth_headers
        )
    ).json()
    mapped = next(item for item in updated_roster if item["agora_agent_id"] == "agent-test-2")
    assert mapped["status"] == "stopped"
    assert mapped["last_event_type"] == "102"

    ended = await client.post(
        f"/v1/sessions/{session['id']}/end", headers=auth_headers
    )
    assert ended.status_code == 200, ended.text
    assert ended.json()["status"] == "ended"
    assert set(client.fake_agora.stopped) == {  # type: ignore[attr-defined]
        "agent-test-1",
        "agent-test-2",
        "agent-test-3",
        "agent-test-4",
        "agent-test-5",
    }
    final_roster = (
        await client.get(
            f"/v1/sessions/{session['id']}/participants", headers=auth_headers
        )
    ).json()
    assert all(item["status"] == "stopped" for item in final_roster)
