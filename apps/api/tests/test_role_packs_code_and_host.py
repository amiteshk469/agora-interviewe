"""Role packs, the shared code editor, and the human co-host."""

from typing import Any

import pytest
from httpx import AsyncClient

from app.domain import apply_host_directive, describe_code_buffer
from app.role_packs import ROLE_PACKS, catalog, get_role_pack, supports_coding
from app.schemas import CodeBufferState, HostState, PanelDecision, PanelState
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


# --- the shared editor ------------------------------------------------------


async def _session_for(client: AsyncClient, headers: dict[str, str], profession: str) -> dict[str, Any]:
    config = (
        await client.post(
            "/v1/interview-configs",
            headers=headers,
            json={"title": f"{profession} loop", "profession": profession},
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
    # The guest shares the candidate's channel on a uid of their own.
    assert body["connection"]["channel_name"]
    assert body["connection"]["uid"] != str(session.get("user_uid"))

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


async def test_a_forged_invite_admits_nobody(client: AsyncClient) -> None:
    assert (await client.get("/v1/guest/sessions/forged.token")).status_code == 401
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


async def test_the_candidate_sees_nobody_until_a_guest_arrives(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    session = await _session_for(client, auth_headers, "software_engineering")

    presence = await client.get(f"/v1/sessions/{session['id']}/host", headers=auth_headers)

    assert presence.status_code == 200
    assert presence.json() is None
