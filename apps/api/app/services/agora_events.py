from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InterviewSession, PanelParticipant
from app.services.evidence import (
    lock_transcript_session,
    persist_candidate_turn,
    persist_inferred_evidence,
    persist_interviewer_turn,
)


def _find_value(value: Any, keys: set[str], depth: int = 0) -> Any:
    if depth > 4 or not isinstance(value, dict):
        return None
    for key, item in value.items():
        if key in keys and item not in (None, "", []):
            return item
    for item in value.values():
        found = _find_value(item, keys, depth + 1)
        if found is not None:
            return found
    return None


def _history_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    value = _find_value(
        payload,
        {"history", "messages", "dialogue", "dialogues", "turns", "conversation"},
    )
    if not isinstance(value, list):
        return []
    return [item for item in value[:500] if isinstance(item, dict)]


def _content(item: dict[str, Any]) -> str:
    value = item.get("content") or item.get("text") or item.get("transcript") or ""
    if isinstance(value, str):
        return value.strip()[:40_000]
    if isinstance(value, list):
        parts = []
        for part in value:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
        return " ".join(parts).strip()[:40_000]
    return ""


async def reconcile_agora_history(
    db: AsyncSession,
    payload: dict[str, Any],
    event_type: str,
) -> int:
    """Reconcile event 103 dialogue history; raw payload remains the audit source."""
    if event_type != "103":
        return 0
    session, _ = await map_agora_event(db, payload, event_type)
    if session is None:
        return 0
    await lock_transcript_session(db, session.id)

    reconciled = 0
    for item in _history_items(payload):
        content = _content(item)
        if not content:
            continue
        role = str(item.get("role") or item.get("speaker") or "").lower()
        speaker_type = "candidate" if role in {"user", "candidate", "human"} else "interviewer"
        agora_turn_id = str(
            item.get("turn_id") or item.get("turnId") or item.get("id") or ""
        ) or None
        if speaker_type == "candidate":
            turn = await persist_candidate_turn(
                db,
                session,
                content,
                source="agora-webhook-103",
                agora_turn_id=agora_turn_id,
            )
            await persist_inferred_evidence(db, session, turn)
            reconciled += 1
            continue
        await persist_interviewer_turn(
            db,
            session,
            content,
            speaker_id=str(item.get("speaker_id") or item.get("uid") or "") or None,
            source="agora-webhook-103",
            agora_turn_id=agora_turn_id,
        )
        reconciled += 1
    return reconciled


async def map_agora_event(
    db: AsyncSession,
    payload: dict[str, Any],
    event_type: str,
) -> tuple[InterviewSession | None, PanelParticipant | None]:
    agent_id = _find_value(payload, {"agentId", "agent_id"})
    channel_name = _find_value(payload, {"channelName", "channel_name"})
    participant = None
    session = None
    if agent_id:
        participant = await db.scalar(
            select(PanelParticipant).where(
                PanelParticipant.agora_agent_id == str(agent_id)
            )
        )
        if participant is not None:
            session = await db.get(InterviewSession, participant.session_id)
            participant.last_event_type = event_type
            if event_type == "101":
                participant.status = "running"
            elif event_type == "102":
                participant.status = "stopped"
            elif event_type == "110":
                participant.status = "failed"
    if session is None:
        identity_clauses = []
        if agent_id:
            identity_clauses.append(InterviewSession.agora_agent_id == str(agent_id))
        if channel_name:
            identity_clauses.append(InterviewSession.channel_name == str(channel_name))
        if identity_clauses:
            session = await db.scalar(
                select(InterviewSession).where(or_(*identity_clauses))
            )
    return session, participant
