import asyncio
import time
from typing import Any

import jwt
from fastapi import HTTPException
from httpx import AsyncClient


def panel(count: int) -> list[dict[str, Any]]:
    return [
        {
            "id": f"panel-{index}",
            "display_name": f"Interviewer {index}",
            "role": "PM Interviewer",
            "expertise": ["product judgment"],
            "voice": "clear-neutral",
            "mood": "professional",
            "behavior": "evidence-seeking",
            "interruption_style": "contextual",
        }
        for index in range(count)
    ]


async def test_health_and_product_auth(client: AsyncClient) -> None:
    assert (await client.get("/healthz")).json() == {"status": "ok"}
    assert (await client.get("/health/live")).status_code == 200
    assert (await client.get("/v1/tools")).status_code == 401


async def test_supabase_hs256_jwt_authentication(client: AsyncClient) -> None:
    token = jwt.encode(
        {
            "sub": "00000000-0000-4000-8000-000000000002",
            "role": "authenticated",
            "aud": "authenticated",
            "iss": "https://test.supabase.co/auth/v1",
            "exp": int(time.time()) + 300,
        },
        "test-supabase-jwt-secret-at-least-32-bytes",
        algorithm="HS256",
    )
    response = await client.get(
        "/v1/tools", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200, response.text


async def test_prompt_templates_are_versioned_by_fork(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    created = await client.post(
        "/v1/prompt-templates",
        headers=auth_headers,
        json={
            "slug": "my-product-sense",
            "name": "My Product Sense",
            "role": "Product Sense Interviewer",
            "prompt": "Ask adaptive product questions and require concrete evidence for each important claim.",
        },
    )
    assert created.status_code == 201, created.text
    source = created.json()
    forked = await client.post(
        f"/v1/prompt-templates/{source['id']}/fork",
        headers=auth_headers,
        json={"prompt": source["prompt"] + " Increase difficulty after a strong answer."},
    )
    assert forked.status_code == 201, forked.text
    assert forked.json()["parent_id"] == source["id"]
    assert forked.json()["version"] == 2
    # No mutable template route is exposed: revisions are created only through a fork.
    assert (await client.patch(f"/v1/prompt-templates/{source['id']}", headers=auth_headers)).status_code == 404


async def test_optional_jd_applies_recommendations_or_defaults(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    jd_text = (
        b"Senior Growth Product Manager\n"
        b"Own retention metrics, funnels, experiments, and strategy.\n"
        + b"Detailed product context. " * 200
    )
    upload = await client.post(
        "/v1/job-descriptions",
        headers=auth_headers,
        files={
            "file": (
                "growth-pm.txt",
                jd_text,
                "text/plain",
            )
        },
    )
    assert upload.status_code == 201, upload.text
    jd = upload.json()
    assert jd["recommendations"]["role_title"] == "Senior Growth Product Manager"
    assert client.fake_storage.uploads  # type: ignore[attr-defined]

    with_jd = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={"title": "Growth PM", "job_description_id": jd["id"]},
    )
    assert with_jd.status_code == 201, with_jd.text
    assert any(member["id"] == "growth" for member in with_jd.json()["panel"])
    assert with_jd.json()["difficulty"] == "challenging"

    without_jd = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={"title": "Default PM"},
    )
    assert without_jd.status_code == 201, without_jd.text
    assert len(without_jd.json()["panel"]) == 3


async def test_panel_requires_two_to_five_members(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    for invalid_count in (1, 6):
        response = await client.post(
            "/v1/interview-configs",
            headers=auth_headers,
            json={"title": "Invalid panel", "panel": panel(invalid_count)},
        )
        assert response.status_code == 422
    for valid_count in (2, 5):
        response = await client.post(
            "/v1/interview-configs",
            headers=auth_headers,
            json={"title": "Valid panel", "panel": panel(valid_count)},
        )
        assert response.status_code == 201, response.text


async def test_session_start_turn_evidence_report_and_replay(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Full interview"}
        )
    ).json()
    session_response = await client.post(
        "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
    )
    assert session_response.status_code == 201, session_response.text
    session = session_response.json()
    started = await client.post(
        f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}
    )
    assert started.status_code == 200, started.text
    assert started.json()["connection"]["token"] == "test-token007"
    assert client.fake_agora.started[-1]["roundcraft_session_id"] == session["id"]  # type: ignore[attr-defined]
    renewed = await client.post(f"/v1/sessions/{session['id']}/token", headers=auth_headers)
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()["channel_name"] == started.json()["connection"]["channel_name"]
    assert renewed.json()["uid"] == started.json()["connection"]["uid"]
    assert renewed.json()["agent_uid"] == started.json()["connection"]["agent_uid"]

    turn_ids = []
    turns = [
        (1, "candidate", "I found a customer problem and prioritized it using research."),
        (2, "interviewer", "How did you execute it?"),
        (3, "candidate", "I shipped an experiment and measured the result with metrics."),
    ]
    for sequence, speaker, content in turns:
        response = await client.post(
            f"/v1/sessions/{session['id']}/turns",
            headers=auth_headers,
            json={"sequence": sequence, "speaker_type": speaker, "content": content},
        )
        assert response.status_code == 201, response.text
        turn_ids.append(response.json()["id"])

    for competency, turn_id in (
        ("product_judgment", turn_ids[0]),
        ("execution", turn_ids[2]),
        ("analytics", turn_ids[2]),
    ):
        evidence = await client.post(
            f"/v1/sessions/{session['id']}/evidence",
            headers=auth_headers,
            json={"transcript_turn_id": turn_id, "competency": competency, "note": "Observed"},
        )
        assert evidence.status_code == 201, evidence.text

    ended = await client.post(f"/v1/sessions/{session['id']}/end", headers=auth_headers)
    assert ended.status_code == 200
    report = await client.post(f"/v1/sessions/{session['id']}/report", headers=auth_headers)
    assert report.status_code == 201, report.text
    body = report.json()
    assert body["readiness"] != "insufficient_evidence"
    assert body["evidence_map"]
    drills = await client.post(
        f"/v1/sessions/{session['id']}/replay-drills", headers=auth_headers
    )
    assert drills.status_code == 201, drills.text
    assert drills.json()


async def test_report_marks_missing_evidence_honestly(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Sparse interview"}
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
        )
    ).json()
    assert (
        await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    ).status_code == 200
    assert (
        await client.post(f"/v1/sessions/{session['id']}/end", headers=auth_headers)
    ).status_code == 200
    report = await client.post(f"/v1/sessions/{session['id']}/report", headers=auth_headers)
    assert report.status_code == 201, report.text
    assert report.json()["readiness"] == "insufficient_evidence"
    assert all(item["score"] is None for item in report.json()["competencies"])


async def test_failed_agora_start_does_not_leave_session_starting(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Failure test"}
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
        )
    ).json()

    async def fail_start(**kwargs: Any) -> list[dict[str, Any]]:
        del kwargs
        raise HTTPException(502, "Agora start failed")

    client.fake_agora.start_panel = fail_start  # type: ignore[attr-defined]
    failed = await client.post(
        f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}
    )
    assert failed.status_code == 502
    stored = await client.get(f"/v1/sessions/{session['id']}", headers=auth_headers)
    assert stored.json()["status"] == "failed"


async def test_concurrent_start_atomically_claims_once(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    config = (
        await client.post(
            "/v1/interview-configs", headers=auth_headers, json={"title": "Race test"}
        )
    ).json()
    session = (
        await client.post(
            "/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]}
        )
    ).json()
    results = await asyncio.gather(
        client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}),
        client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={}),
    )
    assert sorted(response.status_code for response in results) == [200, 409]
    assert len(client.fake_agora.started) == 1  # type: ignore[attr-defined]
