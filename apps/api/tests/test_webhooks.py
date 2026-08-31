import hashlib
import hmac
import json

from httpx import AsyncClient


async def test_agora_webhook_signature_and_idempotency(client: AsyncClient) -> None:
    body = json.dumps({"id": "event-1", "eventType": "112", "payload": {"turn": "done"}}).encode()
    bad = await client.post(
        "/v1/webhooks/agora",
        content=body,
        headers={"Content-Type": "application/json", "Agora-Signature-V2": "bad"},
    )
    assert bad.status_code == 401
    signature = hmac.new(b"test-webhook-secret", body, hashlib.sha256).hexdigest()
    first = await client.post(
        "/v1/webhooks/agora",
        content=body,
        headers={"Content-Type": "application/json", "Agora-Signature-V2": signature},
    )
    second = await client.post(
        "/v1/webhooks/agora",
        content=body,
        headers={"Content-Type": "application/json", "Agora-Signature-V2": signature},
    )
    assert first.json() == {"accepted": True, "duplicate": False}
    assert second.json() == {"accepted": True, "duplicate": True}


async def test_history_webhook_reconciles_turns_and_candidate_evidence(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "History"}
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions",
            headers=auth_headers,
            json={"interview_config_id": config["id"]},
        )
    ).json()
    assert (
        await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    ).status_code == 200
    payload = {
        "noticeId": "history-1",
        "eventType": 103,
        "payload": {
            "agentId": "agent-test-1",
            "history": [
                {
                    "turn_id": "agora-user-1",
                    "role": "user",
                    "content": "I measured the retention metric after an experiment.",
                },
                {
                    "turn_id": "agora-agent-1",
                    "role": "assistant",
                    "content": "What tradeoff did you make?",
                },
            ],
        },
    }
    body = json.dumps(payload).encode()
    signature = hmac.new(b"test-webhook-secret", body, hashlib.sha256).hexdigest()
    response = await client.post(
        "/v1/webhooks/agora",
        content=body,
        headers={"Content-Type": "application/json", "Agora-Signature-V2": signature},
    )
    assert response.status_code == 200, response.text
    turns = await client.get(f"/v1/sessions/{session['id']}/turns", headers=auth_headers)
    assert [item["agora_turn_id"] for item in turns.json()] == [
        "agora-user-1",
        "agora-agent-1",
    ]
    evidence = await client.get(f"/v1/sessions/{session['id']}/evidence", headers=auth_headers)
    assert any(item["competency"] == "analytics" for item in evidence.json())
