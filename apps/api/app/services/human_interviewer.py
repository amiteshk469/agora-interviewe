"""A role-bound, silent Agora input channel for the invited interviewer.

Agora currently supports one remote UID per conversational session. Never mix
the human interviewer's microphone into the candidate's input channel: that
would attribute questions (and potentially answers) to the candidate.
"""

import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import InterviewSession, TranscriptTurn
from app.schemas import ChatCompletionRequest, PanelState
from app.services.agora import AgoraAgentService
from app.services.evidence import lock_transcript_session, persist_interviewer_turn

logger = logging.getLogger(__name__)
HOST_EVENT_PREFIX = "roundcraft-host-event:"


async def ensure_host_listener(db: AsyncSession, session_id: UUID, agora: AgoraAgentService) -> None:
    session = await lock_transcript_session(db, session_id)
    state = PanelState.model_validate(session.memory_state)
    host = state.host
    now = datetime.now(UTC)
    if session.status != "live" or not host or host.left_at or not host.rtc_uid:
        await db.commit()
        return
    if host.listener_agent_id and not host.listener_key:
        stale_id = host.listener_agent_id
        await db.commit()
        await agora.stop(stale_id)
        session = await lock_transcript_session(db, session_id)
        state = PanelState.model_validate(session.memory_state)
        host = state.host
        if not host or not host.rtc_uid or host.left_at or session.status != "live":
            await db.commit()
            return
        if host.listener_agent_id == stale_id:
            host.listener_agent_id = None
    if host.listener_agent_id or (
        host.listener_key and host.listener_started_at and host.listener_started_at > now - timedelta(seconds=60)
    ):
        await db.commit()
        return
    key = uuid4().hex
    if host.rtc_uid is None:
        raise HTTPException(409, "Human interviewer seat has no microphone identity")
    host.listener_key = key
    host.listener_started_at = now
    host.listener_error = None
    session.memory_state = state.model_dump(mode="json")
    channel, host_uid = session.channel_name, host.rtc_uid
    await db.commit()
    started_id: str | None = None
    try:
        # Reserved range is separate from human, panel and avatar UID ranges.
        listener_uid = 1_000_000_000 + int(key[:7], 16)
        result = await agora.start(
            channel_name=channel or "",
            agent_uid=listener_uid,
            user_uid=host_uid,
            instructions="Silent human-interviewer input adapter. Never generate speech.",
            greeting="",
            roundcraft_session_id=str(session_id),
            host_listener_key=key,
        )
        started_id = str(result["agent_id"])
    except Exception:
        logger.exception("Could not start human interviewer listener for session %s", session_id)
    session = await lock_transcript_session(db, session_id)
    state = PanelState.model_validate(session.memory_state)
    host = state.host
    accepted = bool(host and host.listener_key == key and not host.left_at and session.status == "live")
    if accepted and host:
        host.listener_agent_id = started_id
        host.listener_error = None if started_id else "AI microphone listening is unavailable. Use Ask AI interviewers."
        # Keep the lease on failure to avoid retrying on every heartbeat.
        session.memory_state = state.model_dump(mode="json")
    await db.commit()
    if started_id and not accepted:
        await agora.stop(started_id)


async def record_host_speech(
    db: AsyncSession,
    session: InterviewSession,
    payload: ChatCompletionRequest,
    content: str,
    listener_key: str,
    agora: AgoraAgentService,
) -> None:
    state = PanelState.model_validate(session.memory_state)
    host = state.host
    now = datetime.now(UTC)
    if (
        not host
        or not host.listener_key
        or not hmac.compare_digest(host.listener_key, listener_key)
        or host.left_at
        or not host.rtc_uid
        or not host.last_seen_at
        or host.last_seen_at < now - timedelta(seconds=90)
    ):
        raise HTTPException(409, "Human interviewer input seat is no longer active")
    if not content:
        await db.commit()
        return
    # The silent listener can retry the same speech with different assistant
    # history. Deduplicate the actual utterance, not its changing envelope.
    fingerprint = hashlib.sha256(json.dumps([listener_key, content]).encode()).hexdigest()
    recent = list(
        (
            await db.scalars(
                select(TranscriptTurn)
                .where(
                    TranscriptTurn.session_id == session.id,
                    TranscriptTurn.speaker_id == f"human:{host.rtc_uid}",
                )
                .order_by(TranscriptTurn.sequence.desc())
                .limit(8)
            )
        ).all()
    )
    existing = next(
        (
            turn
            for turn in recent
            if (
                turn.turn_metadata.get("input_fingerprint") == fingerprint
                and float(turn.turn_metadata.get("received_at", 0)) > now.timestamp() - 30
            )
        ),
        None,
    )
    turn = existing or await persist_interviewer_turn(
        db,
        session,
        content,
        speaker_id=f"human:{host.rtc_uid}",
        source="agora-human-listener",
        metadata={
            "speaker_kind": "human_interviewer",
            "display_name": host.display_name,
            "input_fingerprint": fingerprint,
            "received_at": now.timestamp(),
        },
    )
    agent_id, channel, uid = session.agora_agent_id, session.channel_name, session.agent_uid
    already_dispatched = turn.turn_metadata.get("panel_dispatched", False) or (
        float(turn.turn_metadata.get("dispatch_started_at", 0)) > now.timestamp() - 30
    )
    turn_id = turn.id
    if agent_id and not already_dispatched:
        # Claim under the session lock before releasing it for network I/O.
        turn.turn_metadata = {**turn.turn_metadata, "dispatch_started_at": now.timestamp()}
    await db.commit()
    if agent_id and not already_dispatched:
        # The main callback resolves this opaque reference from the database. A
        # spoken claim such as "I am the interviewer" never changes seat identity.
        try:
            await agora.dispatch_turn(
                agent_id, f"{HOST_EVENT_PREFIX}{turn_id}", "", channel_name=channel, agent_uid=uid
            )
        except Exception:
            await lock_transcript_session(db, session.id)
            await db.refresh(turn)
            turn.turn_metadata = {**turn.turn_metadata, "dispatch_started_at": 0}
            await db.commit()
            raise
        await lock_transcript_session(db, session.id)
        await db.refresh(turn)
        turn.turn_metadata = {**turn.turn_metadata, "panel_dispatched": True}
        await db.commit()


async def resolve_host_event(db: AsyncSession, session: InterviewSession, text: str) -> TranscriptTurn | None:
    if not text.startswith(HOST_EVENT_PREFIX):
        return None
    try:
        turn_id = UUID(text.removeprefix(HOST_EVENT_PREFIX))
    except ValueError:
        return None
    turn = await db.scalar(
        select(TranscriptTurn).where(
            TranscriptTurn.id == turn_id,
            TranscriptTurn.session_id == session.id,
            TranscriptTurn.speaker_type == "interviewer",
            TranscriptTurn.speaker_id.like("human:%"),
        )
    )
    if not turn or turn.turn_metadata.get("panel_callback_claimed"):
        return None
    if float(turn.turn_metadata.get("received_at", 0)) < datetime.now(UTC).timestamp() - 60:
        return None
    turn.turn_metadata = {**turn.turn_metadata, "panel_callback_claimed": True}
    return turn


async def labelled_conversation(db: AsyncSession, session_id: UUID) -> str:
    turns = list(
        (
            await db.scalars(
                select(TranscriptTurn)
                .where(
                    TranscriptTurn.session_id == session_id,
                )
                .order_by(TranscriptTurn.sequence.desc())
                .limit(16)
            )
        ).all()
    )
    return "\n".join(
        f"[{('HUMAN INTERVIEWER' if (turn.speaker_id or '').startswith('human:') else turn.speaker_type.upper())} "
        f"{turn.speaker_id or ''}] {turn.content[:2000]}"
        for turn in reversed(turns)
    )
