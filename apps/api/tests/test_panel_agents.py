import json
from typing import Any
from uuid import UUID

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.database import session_factory
from app.schemas import PanelistInput
from app.services.agent_tools import consult_interviewer, open_coding_task
from app.services.panel_agents import InterviewerAgent, interviewer_tools


async def test_ai_only_agent_opens_coding_pane_and_preserves_the_candidate_buffer(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "panel_reasoning_enabled", True)
    config = (
        await client.post(
            "/v1/interview-configs",
            headers=auth_headers,
            json={"title": "Engineering agents", "profession": "software_engineering"},
        )
    ).json()
    session = (
        await client.post("/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]})
    ).json()
    sid = session["id"]
    await client.post(f"/v1/sessions/{sid}/start", headers=auth_headers, json={})
    await client.post(
        f"/v1/sessions/{sid}/code", headers=auth_headers, json={"language": "python", "content": "# My existing draft"}
    )
    selected = session["config_snapshot"]["panel"][1]["id"]
    calls = 0

    async def model(settings: Any, messages: Any, tools: Any, **kwargs: Any) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        if kwargs.get("forced"):
            assert "capabilities-and-peer-notes" in messages[0]["content"]
            return {
                "tool_calls": [
                    {
                        "function": {
                            "name": "select_interviewer",
                            "arguments": json.dumps(
                                {
                                    "panelist_id": selected,
                                    "objective": "Ask for a coding implementation",
                                    "rationale": "This interviewer covers implementation",
                                    "speak": True,
                                }
                            ),
                        }
                    }
                ]
            }
        if calls == 2:
            assert "open_coding_task" in {tool["function"]["name"] for tool in tools}
            return {
                "content": None,
                "tool_calls": [
                    {
                        "id": "call-code",
                        "type": "function",
                        "function": {
                            "name": "open_coding_task",
                            "arguments": json.dumps(
                                {
                                    "question": "Implement a bounded queue.",
                                    "language": "python",
                                    "hints": ["Start with capacity."],
                                }
                            ),
                        },
                    }
                ],
            }
        assert json.loads(messages[-1]["content"])["candidate_code_preserved"] is True
        return {"content": "I have opened the queue task. Talk me through your approach."}

    monkeypatch.setattr("app.services.panel_agents.complete", model)
    result = await client.post(
        "/llm/chat/completions",
        headers={"Authorization": "Bearer test-llm-secret", "X-RoundCraft-Session-Id": sid},
        json={"model": "roundcraft-panel", "messages": [{"role": "user", "content": "Let's do a coding question."}]},
    )
    assert result.status_code == 200, result.text
    assert calls == 3
    task = (await client.get(f"/v1/sessions/{sid}/coding-task", headers=auth_headers)).json()
    assert task["question"] == "Implement a bounded queue."
    assert task["hints"] == ["Start with capacity."]
    code = (await client.get(f"/v1/sessions/{sid}/code", headers=auth_headers)).json()
    assert code["content"] == "# My existing draft"
    # Repeating the same tool action returns the same task id rather than reopening it.
    async with session_factory() as db:
        again = await open_coding_task(
            db, UUID(sid), selected, {"question": task["question"], "language": "python", "hints": []}
        )
        assert again["task"]["id"] == task["id"]
        await db.rollback()


async def test_agent_cannot_invoke_an_ungranted_tool(monkeypatch: pytest.MonkeyPatch) -> None:
    actor = PanelistInput(display_name="Test expert", role="Analytics", allowed_tools=["calculator"])
    calls = 0

    async def model(*args: Any, **kwargs: Any) -> dict[str, Any]:
        nonlocal calls
        calls += 1
        if calls == 1:
            return {
                "tool_calls": [
                    {
                        "id": "bad",
                        "type": "function",
                        "function": {
                            "name": "web_search",
                            "arguments": '{"query":"forbidden"}',
                        },
                    }
                ]
            }
        assert "not authorized" in args[1][-1]["content"]
        return {"content": "What assumptions did you use?"}

    async def denied(*args: Any) -> dict[str, Any]:
        raise AssertionError("A denied tool must never reach the executor")

    monkeypatch.setattr("app.services.panel_agents.complete", model)
    tools = interviewer_tools(["calculator"], [actor], actor.id, [])
    response = await InterviewerAgent(actor, get_settings()).respond(
        "Interview the candidate.", [], tools, denied, [actor]
    )
    assert response == "What assumptions did you use?"


async def test_non_coding_track_cannot_publish_agent_task(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    config = (await client.post("/v1/interview-configs", headers=auth_headers, json={"title": "PM"})).json()
    session = (
        await client.post("/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]})
    ).json()
    await client.post(f"/v1/sessions/{session['id']}/start", headers=auth_headers, json={})
    async with session_factory() as db:
        with pytest.raises(ValueError, match="cannot open"):
            await open_coding_task(
                db,
                UUID(session["id"]),
                config["panel"][0]["id"],
                {"question": "Write code anyway.", "language": "python", "hints": []},
            )


async def test_peer_consultation_uses_shared_context_and_persists_private_notes(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    config = (await client.post("/v1/interview-configs", headers=auth_headers, json={"title": "Peers"})).json()
    session = (
        await client.post("/v1/sessions", headers=auth_headers, json={"interview_config_id": config["id"]})
    ).json()
    sid = session["id"]
    await client.post(f"/v1/sessions/{sid}/start", headers=auth_headers, json={})
    await client.post(
        f"/v1/sessions/{sid}/turns",
        headers=auth_headers,
        json={
            "speaker_type": "candidate",
            "content": "I would measure retention.",
            "sequence": 1,
        },
    )

    async def peer_model(settings: Any, messages: Any, tools: Any, **kwargs: Any) -> dict[str, Any]:
        assert tools == []  # Peers cannot recursively delegate.
        assert "measure retention" in messages[1]["content"]
        assert "CANDIDATE" in messages[1]["content"]
        return {"content": "Ask which retention window matches the product."}

    monkeypatch.setattr("app.services.agent_tools.complete", peer_model)
    async with session_factory() as db:
        result = await consult_interviewer(
            db,
            get_settings(),
            UUID(sid),
            config["panel"][0]["id"],
            {
                "panelist_id": config["panel"][1]["id"],
                "question": "What follow-up would clarify this metric?",
            },
        )
        assert result["private"] is True
        await db.commit()
    state = (await client.get(f"/v1/sessions/{sid}", headers=auth_headers)).json()["memory_state"]
    assert state["agent_notes"][config["panel"][1]["id"]] == [result["advice"]]
