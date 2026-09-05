from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.domain import PLATFORM_INVARIANTS, delimit_untrusted
from app.role_packs import get_role_pack
from app.schemas import CodeBufferState, CodingTaskCreate, CodingTaskState, PanelistInput, PanelState
from app.services.evidence import lock_transcript_session
from app.services.human_interviewer import labelled_conversation
from app.services.panel_agents import complete


async def open_coding_task(
    db: AsyncSession, session_id: UUID, panelist_id: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    payload = CodingTaskCreate.model_validate(arguments)
    session = await lock_transcript_session(db, session_id)
    snapshot = session.config_snapshot
    pack = get_role_pack(snapshot.get("profession"))
    panelist = next((item for item in snapshot["panel"] if item["id"] == panelist_id), None)
    if session.status != "live" or not panelist or not pack.coding or not snapshot.get("agent_coding_enabled", True):
        raise ValueError("This agent cannot open a coding task in this session")
    if payload.language not in pack.coding.languages:
        raise ValueError("This language is not enabled for this interview")
    state = PanelState.model_validate(session.memory_state)
    old = state.coding_task
    # Retried tool calls must not repeatedly reopen a dismissed editor.
    task = CodingTaskState(
        id=old.id
        if old and old.question == payload.question and old.language == payload.language
        else f"agent-task-{uuid4().hex[:12]}",
        question=payload.question,
        language=payload.language,
        hints=payload.hints,
        author=panelist["display_name"],
        created_at=datetime.now(UTC),
    )
    state.coding_task = task
    if state.code_buffer is None:
        state.code_buffer = CodeBufferState(language=payload.language, content="")
    session.memory_state = state.model_dump(mode="json")
    # The caller persists the tool audit in this same transaction.
    return {"task": task.model_dump(mode="json"), "status": "published", "candidate_code_preserved": True}


async def consult_interviewer(
    db: AsyncSession, settings: Settings, session_id: UUID, actor_id: str, arguments: dict[str, Any]
) -> dict[str, Any]:
    question, peer_id = arguments.get("question"), arguments.get("panelist_id")
    if not isinstance(question, str) or not 1 <= len(question) <= 1500 or peer_id == actor_id:
        raise ValueError("Choose a different panel interviewer and a concise question")
    session = await lock_transcript_session(db, session_id)
    peer = next(
        (PanelistInput.model_validate(item) for item in session.config_snapshot["panel"] if item["id"] == peer_id), None
    )
    if not peer or session.status != "live":
        raise ValueError("Requested peer is not available in this panel")
    context = await labelled_conversation(db, session_id)
    await db.commit()
    reply = await complete(
        settings,
        [
            {
                "role": "system",
                "content": (
                    f"You are {peer.display_name}, the {peer.role}. Give a colleague one useful private perspective, "
                    "at most 70 words. Do not score the candidate, speak to them, or invent observations. "
                    "You cannot delegate or invoke tools in a consultation.\n"
                    + PLATFORM_INVARIANTS
                    + "\n"
                    + (peer.custom_prompt or peer.default_prompt or "")[:4000]
                ),
            },
            {"role": "user", "content": delimit_untrusted("shared-conversation", context)},
            {"role": "user", "content": delimit_untrusted("colleague-question", question)},
        ],
        [],
    )
    advice = str(reply.get("content") or "")[:2000]
    if not advice:
        raise ValueError("Peer returned no advice")
    session = await lock_transcript_session(db, session_id)
    if session.status != "live":
        raise ValueError("Interview ended during consultation")
    state = PanelState.model_validate(session.memory_state)
    state.agent_notes[peer.id] = [*state.agent_notes.get(peer.id, []), advice][-3:]
    session.memory_state = state.model_dump(mode="json")
    return {"panelist_id": peer.id, "advice": advice, "private": True}
