"""Role packs, the shared code editor, and the human co-host."""

import asyncio
from typing import Any

import pytest
from httpx import AsyncClient

from app.domain import (
    apply_host_directive,
    compile_agent_prompt,
    describe_code_buffer,
    jd_recommendations,
)
from app.role_packs import ROLE_PACKS, catalog, get_role_pack, supports_coding
from app.schemas import CodeBufferState, HostState, PanelDecision, PanelState
from app.services.evidence import lock_transcript_session
from app.services.host_invite import InviteError, mint_invite, read_invite

SECRET = "a-test-signing-secret-long-enough"
SESSION_UUID = "11111111-1111-4111-8111-111111111111"


# --- catalogue integrity ----------------------------------------------------


@pytest.mark.parametrize("pack_id", sorted(ROLE_PACKS))
def test_every_pack_is_a_usable_interview(pack_id: str) -> None:
    pack = ROLE_PACKS[pack_id]
    assert 2 <= len(pack.panel) <= 5, "the platform hosts two to five logical interviewers"
    assert len({member["id"] for member in pack.panel}) == len(pack.panel)
    assert abs(sum(item["weight"] for item in pack.rubric) - 1) < 0.01
    assert pack.enabled_tools, "a panel with no tools cannot ground anything"
    for member in pack.panel:
        assert len(member["default_prompt"]) >= 40
        assert member["prompt_slug"]


def test_catalog_covers_materially_distinct_placement_role_families() -> None:
    assert {
        "data_engineering",
        "ui_ux_design",
        "cybersecurity",
        "electrical_electronics",
        "aerospace_robotics",
        "operations_management",
        "finance_risk",
        "civil_chemical_materials",
    } <= ROLE_PACKS.keys()
    slugs = [member["prompt_slug"] for pack in ROLE_PACKS.values() for member in pack.panel]
    assert len(slugs) == len(set(slugs))


@pytest.mark.parametrize(
    ("catalogue_title", "expected_pack"),
    [
        ("Software Development Engineer", "software_engineering"),
        ("Full Stack Developer", "software_engineering"),
        ("Backend Developer", "software_engineering"),
        ("Design Engineer", "core_engineering"),
        ("Embedded Software Engineer", "embedded_systems"),
        ("Data Engineer 2", "data_engineering"),
        ("UI/UX Designer", "ui_ux_design"),
        ("Security Research Specialist", "cybersecurity"),
        ("Power Electronics Engineer", "electrical_electronics"),
        ("Junior Robotics Engineer", "aerospace_robotics"),
        ("Senior Supply Chain Manager", "operations_management"),
        ("Risk Management", "finance_risk"),
        ("Civil & Structural Engineer", "civil_chemical_materials"),
    ],
)
def test_real_placement_catalogue_titles_suggest_the_right_pack(
    catalogue_title: str, expected_pack: str
) -> None:
    recommendations = jd_recommendations(f"Role: {catalogue_title}")

    assert recommendations["suggested_profession"] == expected_pack


def test_product_management_panel_is_unchanged_by_role_packs() -> None:
    """Saved configurations reference these ids, so the default pack must not rename them."""
    from app.domain import DEFAULT_PANEL

    pack = get_role_pack("product_management")
    assert [member["id"] for member in pack.panel] == [member["id"] for member in DEFAULT_PANEL]


def test_coding_packs_declare_a_default_language_they_actually_offer() -> None:
    for pack in ROLE_PACKS.values():
        if pack.coding is None:
            continue
        assert pack.coding.default_language in pack.coding.languages


def test_unknown_pack_falls_back_rather_than_failing_a_session() -> None:
    assert get_role_pack("no-such-track").id == "product_management"
    assert get_role_pack(None).id == "product_management"


def test_catalog_leads_with_the_default_track() -> None:
    entries = catalog()
    assert entries[0]["id"] == "product_management"
    assert {entry["id"] for entry in entries} == set(ROLE_PACKS)


def test_consulting_has_no_editor_but_software_does() -> None:
    assert supports_coding("software_engineering") is True
    assert supports_coding("consulting") is False


def test_live_prompt_tracks_the_role_and_only_coding_tracks_get_hint_rules() -> None:
    software = get_role_pack("software_engineering")
    software_prompt = compile_agent_prompt(
        {"profession": software.id, "difficulty": "balanced", "panel": software.panel}
    )
    assert "Software Engineering mock-interview panel" in software_prompt
    assert "Product Management mock-interview panel" not in software_prompt
    assert "exact task, inputs, outputs, constraints, and an example" in software_prompt
    assert "prefixed 'Hint:'" in software_prompt

    design = get_role_pack("ui_ux_design")
    design_prompt = compile_agent_prompt(
        {"profession": design.id, "difficulty": "balanced", "panel": design.panel}
    )
    assert "UI/UX & Product Design mock-interview panel" in design_prompt
    assert "prefixed 'Hint:'" not in design_prompt


def test_global_live_prompt_excludes_panelist_mandates() -> None:
    software = get_role_pack("software_engineering")
    member = {
        **software.panel[0],
        "custom_prompt": "CUSTOM MANDATE: test incident leadership with a concrete postmortem.",
    }

    prompt = compile_agent_prompt(
        {"profession": software.id, "difficulty": "balanced", "panel": [member, software.panel[1]]}
    )

    assert "CUSTOM MANDATE: test incident leadership" not in prompt
    assert str(software.panel[0]["default_prompt"]) not in prompt
    assert str(software.panel[1]["default_prompt"]) not in prompt
    assert f"- {member['id']}: {member['role']}" in prompt


def test_labelled_role_and_real_company_beat_generic_jd_section_headings() -> None:
    recommendations = jd_recommendations(
        "About Us\nOur data organization builds reporting systems.\nRole: Software Development Engineer\n"
        "Company: Northstar Labs"
    )

    assert recommendations["role_title"] == "Software Development Engineer"
    assert recommendations["company"] == "Northstar Labs"
    assert recommendations["suggested_profession"] == "software_engineering"


# --- role packs through the API ---------------------------------------------


async def test_role_pack_catalog_requires_auth(client: AsyncClient) -> None:
    assert (await client.get("/v1/role-packs")).status_code == 401


async def test_choosing_a_track_builds_that_track_s_panel(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    response = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={"title": "SDE loop", "profession": "software_engineering"},
    )

    assert response.status_code == 201, response.text
    config = response.json()
    assert config["profession"] == "software_engineering"
    assert [member["role"] for member in config["panel"]] == [
        "Engineering Manager",
        "Staff Engineer",
        "Systems Architect",
    ]
    assert {item["key"] for item in config["rubric"]} == {
        "problem_decomposition",
        "code_quality",
        "complexity_reasoning",
        "system_design",
        "communication",
    }
    # The pack widened the tool set beyond the platform default.
    assert "web_search" in config["enabled_tools"]


async def test_an_explicit_panel_still_beats_the_pack(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    custom = [
        {
            "id": f"custom-{index}",
            "display_name": f"Interviewer {index}",
            "role": "Quant Interviewer",
            "expertise": ["probability"],
            "voice": "indian-calm",
        }
        for index in range(2)
    ]
    response = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={"title": "Custom", "profession": "quantitative_finance", "panel": custom},
    )

    assert response.status_code == 201, response.text
    assert [member["id"] for member in response.json()["panel"]] == ["custom-0", "custom-1"]


async def test_an_unknown_track_is_rejected(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    response = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={"title": "Nope", "profession": "underwater_basket_weaving"},
    )

    assert response.status_code == 422


async def test_selected_track_stays_authoritative_when_a_jd_suggests_another(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    upload = await client.post(
        "/v1/job-descriptions",
        headers=auth_headers,
        files={
            "file": (
                "data-engineer.txt",
                b"Company: Acme Cloud\nRole: Data Engineer\nBuild Python, SQL and Spark data pipelines.",
                "text/plain",
            )
        },
    )
    assert upload.status_code == 201, upload.text
    jd = upload.json()
    assert jd["recommendations"]["company"] == "Acme Cloud"
    assert jd["recommendations"]["role_title"] == "Data Engineer"
    assert jd["recommendations"]["suggested_profession"] == "data_engineering"

    response = await client.post(
        "/v1/interview-configs",
        headers=auth_headers,
        json={
            "title": "Security interview using a data-company JD",
            "profession": "cybersecurity",
            "job_description_id": jd["id"],
            # The production wizard submits the selected pack's panel explicitly.
            # JD context must still augment that panel instead of being bypassed.
            "panel": [
                {
                    **member,
                    "expertise": [member["role"], "Challenging"],
                }
                for member in get_role_pack("cybersecurity").panel
            ],
        },
    )
    assert response.status_code == 201, response.text
    config = response.json()
    assert config["profession"] == "cybersecurity"
    assert [member["role"] for member in config["panel"]] == [
        "Security Engineering Manager",
        "Security Researcher",
        "Incident Responder",
    ]
    assert {item["key"] for item in config["rubric"]} == {
        "threat_modelling",
        "security_depth",
        "investigation",
        "mitigation_response",
        "communication",
    }
    assert all("Acme Cloud" in member["knowledge_prompt"] for member in config["panel"])
    assert any("data engineering" in member["expertise"] for member in config["panel"])
    assert "risk prioritization" in config["panel"][0]["expertise"]


# --- the shared editor ------------------------------------------------------


async def _session_for(
    client: AsyncClient,
    headers: dict[str, str],
    profession: str,
    *,
    interview_mode: str = "candidate_practice",
) -> dict[str, Any]:
    config = (
        await client.post(
            "/v1/interview-configs",
            headers=headers,
            json={
                "title": f"{profession} loop",
                "profession": profession,
                "interview_mode": interview_mode,
            },
        )
    ).json()
    return (
        await client.post("/v1/sessions", headers=headers, json={"interview_config_id": config["id"]})
    ).json()


async def test_code_round_trips_and_counts_its_lines(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")

    written = await client.post(
        f"/v1/sessions/{session['id']}/code",
        headers=auth_headers,
        json={"language": "python", "content": "def solve(nums):\n    return sorted(nums)\n"},
    )

    assert written.status_code == 200, written.text
    assert written.json()["line_count"] == 2
    read_back = await client.get(f"/v1/sessions/{session['id']}/code", headers=auth_headers)
    assert read_back.json()["content"].startswith("def solve")
    assert read_back.json()["language"] == "python"


async def test_a_track_without_a_coding_round_refuses_the_editor(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "consulting")

    response = await client.post(
        f"/v1/sessions/{session['id']}/code",
        headers=auth_headers,
        json={"language": "python", "content": "print(1)"},
    )

    assert response.status_code == 409


async def test_a_language_the_track_does_not_interview_in_is_refused(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "data_science")

    response = await client.post(
        f"/v1/sessions/{session['id']}/code",
        headers=auth_headers,
        json={"language": "verilog", "content": "module top(); endmodule"},
    )

    assert response.status_code == 422


async def test_another_users_session_code_is_not_readable(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    stranger = {"Authorization": "Bearer dev:00000000-0000-4000-8000-000000000009"}

    assert (await client.get(f"/v1/sessions/{session['id']}/code", headers=stranger)).status_code in {
        401,
        404,
    }


def test_the_panel_reads_the_editor_only_when_it_has_content() -> None:
    assert describe_code_buffer(PanelState()) is None
    assert describe_code_buffer(PanelState(code_buffer=CodeBufferState(language="python", content="   "))) is None

    described = describe_code_buffer(
        PanelState(code_buffer=CodeBufferState(language="python", content="a = 1\nb = 2\n"))
    )
    assert described is not None
    assert "python" in described and "a = 1" in described


def test_a_long_file_is_truncated_before_it_reaches_the_model() -> None:
    described = describe_code_buffer(
        PanelState(code_buffer=CodeBufferState(language="python", content="x = 1\n" * 400))
    )

    assert described is not None
    assert "[editor truncated]" in described
    assert described.count("x = 1") <= 120


# --- the human co-host ------------------------------------------------------


def test_an_invite_verifies_only_with_its_own_secret() -> None:
    token, _ = mint_invite(SESSION_UUID, SECRET)  # type: ignore[arg-type]

    assert str(read_invite(token, SECRET).session_id) == SESSION_UUID
    with pytest.raises(InviteError):
        read_invite(token, "a-completely-different-secret-value")


def test_invite_claims_keep_candidate_and_interviewer_permissions_separate() -> None:
    candidate_token, _ = mint_invite(  # type: ignore[arg-type]
        SESSION_UUID,
        SECRET,
        seat="candidate",
    )
    host_token, _ = mint_invite(SESSION_UUID, SECRET)  # type: ignore[arg-type]

    assert read_invite(candidate_token, SECRET).seat == "candidate"
    assert read_invite(host_token, SECRET).seat == "interviewer"


def test_a_tampered_invite_is_rejected() -> None:
    token, _ = mint_invite(SESSION_UUID, SECRET)  # type: ignore[arg-type]
    body, signature = token.split(".")

    with pytest.raises(InviteError):
        read_invite(f"{body}x.{signature}", SECRET)
    with pytest.raises(InviteError):
        read_invite("not-a-token", SECRET)


def test_an_expired_invite_stops_working() -> None:
    token, expires_at = mint_invite(SESSION_UUID, SECRET, ttl_seconds=60, now=1_000)  # type: ignore[arg-type]

    assert read_invite(token, SECRET, now=expires_at - 1).expires_at == expires_at
    with pytest.raises(InviteError):
        read_invite(token, SECRET, now=expires_at)


def test_the_human_question_outranks_the_director_and_is_asked_once() -> None:
    decision = PanelDecision(
        next_speaker_id="analytics",
        action="probe",
        rationale="Director objective",
        suggested_question="Ask about the guardrail metric.",
    )
    state = PanelState(host=HostState(display_name="Amitesh", pending_question="Why that data structure?"))

    updated, relayed = apply_host_directive(decision, state)

    assert relayed == "Why that data structure?"
    assert updated.suggested_question == "Why that data structure?"
    assert updated.action == "ask"
    assert "Amitesh" in updated.rationale
    # The panel returns to its own line of questioning on the next turn.
    assert state.host is not None and state.host.pending_question is None
    again, relayed_again = apply_host_directive(updated, state)
    assert relayed_again is None
    assert again is updated


def test_no_host_leaves_the_director_decision_alone() -> None:
    decision = PanelDecision(
        next_speaker_id="analytics",
        action="probe",
        rationale="Director objective",
        suggested_question="Ask about the guardrail metric.",
    )

    assert apply_host_directive(decision, PanelState()) == (decision, None)


async def test_an_invite_admits_a_guest_who_can_then_lead_the_panel(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text

    invite = await client.post(f"/v1/sessions/{session['id']}/invite", headers=auth_headers)
    assert invite.status_code == 200, invite.text
    token = invite.json()["token"]
    assert invite.json()["join_path"] == f"/join/{token}"

    joined = await client.get(f"/v1/guest/sessions/{token}", params={"display_name": "Amitesh"})
    assert joined.status_code == 200, joined.text
    body = joined.json()
    assert body["display_name"] == "Amitesh"
    assert body["role_pack"] == "Software Engineering"
    assert body["supports_coding"] is True
    assert body["heartbeat_interval_seconds"] == 10
    # The guest shares the candidate's channel on a uid of their own.
    assert body["connection"]["channel_name"]
    assert body["connection"]["uid"] != str(session.get("user_uid"))
    guest_uid = body["connection"]["uid"]

    renewed = await client.post(f"/v1/guest/sessions/{token}/token")
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()["channel_name"] == body["connection"]["channel_name"]
    assert renewed.json()["uid"] == guest_uid
    heartbeat = await client.post(f"/v1/guest/sessions/{token}/heartbeat")
    assert heartbeat.status_code == 200, heartbeat.text
    assert heartbeat.json()["connected"] is True

    asked = await client.post(
        f"/v1/guest/sessions/{token}/messages",
        json={"mode": "ask", "text": "Why did you pick a hash map over a tree here?"},
    )
    assert asked.status_code == 201, asked.text
    assert asked.json()["author"] == "Amitesh"

    view = await client.get(f"/v1/guest/sessions/{token}/state")
    assert view.status_code == 200
    assert view.json()["pending_question"] == "Why did you pick a hash map over a tree here?"

    # The candidate sees the human in the room and reads their notes.
    presence = await client.get(f"/v1/sessions/{session['id']}/host", headers=auth_headers)
    assert presence.status_code == 200
    assert presence.json()["display_name"] == "Amitesh"
    assert presence.json()["messages"][0]["mode"] == "ask"


async def test_interviewer_led_room_invites_a_candidate_with_the_reserved_agora_seat(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    session = await _session_for(
        client,
        auth_headers,
        "software_engineering",
        interview_mode="interviewer_led",
    )
    invite = await client.post(
        f"/v1/sessions/{session['id']}/invites",
        headers=auth_headers,
        json={"seat": "candidate"},
    )
    assert invite.status_code == 200, invite.text
    assert invite.json()["seat"] == "candidate"
    candidate_token = invite.json()["token"]

    preview = await client.get(f"/v1/guest/invites/{candidate_token}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["status"] == "configured"
    assert preview.json()["interview_mode"] == "interviewer_led"
    assert preview.json()["coding"]["default_language"] == "python"
    assert (await client.get(f"/v1/guest/candidates/{candidate_token}")).status_code == 409

    started = await client.post(
        f"/v1/sessions/{session['id']}/start",
        headers=auth_headers,
        json={},
    )
    assert started.status_code == 200, started.text
    candidate_uid = str(started.json()["session"]["user_uid"])

    joined = await client.get(
        f"/v1/guest/candidates/{candidate_token}",
        params={"display_name": "Riya"},
    )
    assert joined.status_code == 200, joined.text
    assert joined.json()["seat"] == "candidate"
    assert joined.json()["connection"]["uid"] == candidate_uid
    assert len(joined.json()["connection"]["panelists"]) == 3

    renewed = await client.post(f"/v1/guest/candidates/{candidate_token}/token")
    assert renewed.status_code == 200, renewed.text
    assert renewed.json()["uid"] == candidate_uid
    assert (await client.post(f"/v1/guest/candidates/{candidate_token}/heartbeat")).status_code == 200
    presence = await client.get(f"/v1/sessions/{session['id']}/candidate", headers=auth_headers)
    assert presence.status_code == 200
    assert presence.json()["display_name"] == "Riya"

    host_invite = await client.post(
        f"/v1/sessions/{session['id']}/invites",
        headers=auth_headers,
        json={"seat": "interviewer"},
    )
    host_token = host_invite.json()["token"]
    assert (await client.get(f"/v1/guest/sessions/{host_token}", params={"display_name": "Amitesh"})).status_code == 200
    assert (await client.get(f"/v1/guest/sessions/{candidate_token}")).status_code == 403
    assert (await client.get(f"/v1/guest/candidates/{host_token}")).status_code == 403

    task = await client.post(
        f"/v1/guest/sessions/{host_token}/coding-task",
        json={
            "question": "Return the first pair of indices whose values sum to the target.",
            "language": "python",
            "hints": ["Consider a value-to-index map."],
        },
    )
    assert task.status_code == 201, task.text
    candidate_view = await client.get(f"/v1/guest/candidates/{candidate_token}/state")
    assert candidate_view.status_code == 200
    assert candidate_view.json()["coding_task"]["id"] == task.json()["id"]

    code = await client.post(
        f"/v1/guest/candidates/{candidate_token}/code",
        json={"language": "python", "content": "def two_sum(values, target):\n    return []"},
    )
    assert code.status_code == 200, code.text
    host_view = await client.get(f"/v1/guest/sessions/{host_token}/state")
    assert host_view.json()["code"]["content"].startswith("def two_sum")
    assert host_view.json()["candidate"]["display_name"] == "Riya"

    turn = await client.post(
        f"/v1/guest/candidates/{candidate_token}/turns",
        json={
            "agora_turn_id": "candidate-agora-turn-1",
            "content": "I will use a hash map to keep the solution linear.",
        },
    )
    assert turn.status_code == 201, turn.text
    duplicate = await client.post(
        f"/v1/guest/candidates/{candidate_token}/turns",
        json={
            "agora_turn_id": "candidate-agora-turn-1",
            "content": "I will use a hash map to keep the solution linear.",
        },
    )
    assert duplicate.status_code == 201
    assert duplicate.json()["id"] == turn.json()["id"]

    assert (await client.post(f"/v1/guest/candidates/{candidate_token}/leave")).status_code == 204
    assert (await client.get(f"/v1/sessions/{session['id']}/candidate", headers=auth_headers)).json() is None


async def test_candidate_invite_is_rejected_for_candidate_owned_practice(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")

    response = await client.post(
        f"/v1/sessions/{session['id']}/invites",
        headers=auth_headers,
        json={"seat": "candidate"},
    )

    assert response.status_code == 409


async def test_a_forged_invite_admits_nobody(client: AsyncClient) -> None:
    assert (await client.get("/v1/guest/sessions/forged.token")).status_code == 401
    assert (await client.post("/v1/guest/sessions/forged.token/token")).status_code == 401
    assert (await client.post("/v1/guest/sessions/forged.token/heartbeat")).status_code == 401
    assert (
        await client.post("/v1/guest/sessions/forged.token/messages", json={"mode": "chat", "text": "hi"})
    ).status_code == 401


async def test_a_guest_cannot_join_before_the_interview_is_live(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    invite = await client.post(f"/v1/sessions/{session['id']}/invite", headers=auth_headers)

    response = await client.get(f"/v1/guest/sessions/{invite.json()['token']}")

    assert response.status_code == 409


async def test_an_invite_cannot_be_created_after_the_session_ends(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    ended = await client.post(f"/v1/sessions/{session['id']}/end", headers=auth_headers)
    assert ended.status_code == 200, ended.text

    invite = await client.post(f"/v1/sessions/{session['id']}/invite", headers=auth_headers)

    assert invite.status_code == 409


async def test_the_candidate_sees_nobody_until_a_guest_arrives(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")

    presence = await client.get(f"/v1/sessions/{session['id']}/host", headers=auth_headers)

    assert presence.status_code == 200
    assert presence.json() is None


async def test_guest_leave_and_heartbeat_expiry_remove_candidate_presence(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    invite = await client.post(f"/v1/sessions/{session['id']}/invite", headers=auth_headers)
    token = invite.json()["token"]
    joined = await client.get(f"/v1/guest/sessions/{token}")
    assert joined.status_code == 200, joined.text
    uid = joined.json()["connection"]["uid"]

    monkeypatch.setattr("app.api.HOST_PRESENCE_TIMEOUT_SECONDS", 0)
    expired = await client.get(f"/v1/sessions/{session['id']}/host", headers=auth_headers)
    assert expired.status_code == 200
    assert expired.json() is None
    monkeypatch.setattr("app.api.HOST_PRESENCE_TIMEOUT_SECONDS", 30)
    assert (await client.post(f"/v1/guest/sessions/{token}/heartbeat")).status_code == 200
    present = await client.get(f"/v1/sessions/{session['id']}/host", headers=auth_headers)
    assert present.status_code == 200
    assert present.json()["last_seen_at"]

    left = await client.post(f"/v1/guest/sessions/{token}/leave")
    assert left.status_code == 204, left.text
    absent = await client.get(f"/v1/sessions/{session['id']}/host", headers=auth_headers)
    assert absent.status_code == 200
    assert absent.json() is None
    assert (await client.post(f"/v1/guest/sessions/{token}/heartbeat")).status_code == 409
    assert (await client.post(f"/v1/guest/sessions/{token}/token")).status_code == 409

    rejoined = await client.get(f"/v1/guest/sessions/{token}")
    assert rejoined.status_code == 200, rejoined.text
    assert rejoined.json()["connection"]["uid"] == uid


async def test_guest_token_cannot_renew_after_the_session_ends(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    started = await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    assert started.status_code == 200, started.text
    invite = await client.post(f"/v1/sessions/{session['id']}/invite", headers=auth_headers)
    token = invite.json()["token"]
    assert (await client.get(f"/v1/guest/sessions/{token}")).status_code == 200
    ended = await client.post(f"/v1/sessions/{session['id']}/end", headers=auth_headers)
    assert ended.status_code == 200, ended.text

    renewed = await client.post(f"/v1/guest/sessions/{token}/token")
    assert renewed.status_code == 409


async def test_guest_heartbeat_does_not_erase_a_concurrent_code_update(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    assert (
        await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    ).status_code == 200
    invite = await client.post(f"/v1/sessions/{session['id']}/invite", headers=auth_headers)
    token = invite.json()["token"]
    assert (await client.get(f"/v1/guest/sessions/{token}")).status_code == 200

    first_writer_loaded = asyncio.Event()
    release_first_writer = asyncio.Event()
    lock_calls = 0

    async def delay_first_lock(db: Any, session_id: Any) -> Any:
        nonlocal lock_calls
        lock_calls += 1
        if lock_calls == 1:
            first_writer_loaded.set()
            await release_first_writer.wait()
        return await lock_transcript_session(db, session_id)

    monkeypatch.setattr("app.api.lock_transcript_session", delay_first_lock)
    heartbeat_task = asyncio.create_task(client.post(f"/v1/guest/sessions/{token}/heartbeat"))
    await asyncio.wait_for(first_writer_loaded.wait(), timeout=1)
    try:
        written = await asyncio.wait_for(
            client.post(
                f"/v1/sessions/{session['id']}/code",
                headers=auth_headers,
                json={"language": "python", "content": "answer = 42"},
            ),
            timeout=1,
        )
        assert written.status_code == 200, written.text
    finally:
        release_first_writer.set()

    heartbeat = await asyncio.wait_for(heartbeat_task, timeout=1)
    assert heartbeat.status_code == 200, heartbeat.text
    code = await client.get(f"/v1/sessions/{session['id']}/code", headers=auth_headers)
    assert code.json()["content"] == "answer = 42"


async def test_panel_state_update_does_not_erase_a_concurrent_guest_message(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: Any
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")
    assert (
        await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    ).status_code == 200
    invite = await client.post(f"/v1/sessions/{session['id']}/invite", headers=auth_headers)
    token = invite.json()["token"]
    assert (await client.get(f"/v1/guest/sessions/{token}")).status_code == 200

    first_writer_loaded = asyncio.Event()
    release_first_writer = asyncio.Event()
    lock_calls = 0

    async def delay_first_lock(db: Any, session_id: Any) -> Any:
        nonlocal lock_calls
        lock_calls += 1
        if lock_calls == 1:
            first_writer_loaded.set()
            await release_first_writer.wait()
        return await lock_transcript_session(db, session_id)

    monkeypatch.setattr("app.api.lock_transcript_session", delay_first_lock)
    decision_task = asyncio.create_task(
        client.post(
            f"/v1/sessions/{session['id']}/panel/next",
            headers=auth_headers,
            json={"last_candidate_turn": "I would start with a hash map."},
        )
    )
    await asyncio.wait_for(first_writer_loaded.wait(), timeout=1)
    try:
        message = await asyncio.wait_for(
            client.post(
                f"/v1/guest/sessions/{token}/messages",
                json={"mode": "chat", "text": "Probe the candidate's complexity analysis."},
            ),
            timeout=1,
        )
        assert message.status_code == 201, message.text
    finally:
        release_first_writer.set()

    decision = await asyncio.wait_for(decision_task, timeout=1)
    assert decision.status_code == 200, decision.text
    view = await client.get(f"/v1/guest/sessions/{token}/state")
    assert [item["text"] for item in view.json()["messages"]] == [
        "Probe the candidate's complexity analysis."
    ]
