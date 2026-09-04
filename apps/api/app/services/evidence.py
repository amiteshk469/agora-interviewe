import re
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import EvidenceItem, InterviewSession, TranscriptTurn

_COMPETENCY_CUES: dict[str, tuple[str, ...]] = {
    "product_judgment": (
        "customer",
        "user problem",
        "research",
        "segment",
        "priorit",
        "customer need",
    ),
    "execution": (
        "ship",
        "launch",
        "scope",
        "roadmap",
        "dependency",
        "tradeoff",
        "deliver",
    ),
    "analytics": (
        "metric",
        "measur",
        "experiment",
        "conversion",
        "retention",
        "funnel",
        "data",
        "%",
    ),
    "leadership": (
        "stakeholder",
        "influence",
        "aligned",
        "conflict",
        "led ",
        "leadership",
        "cross-functional",
    ),
    "communication": ("structured", "concise", "first,", "second,", "because"),
}


def normalize_transcript_content(content: str) -> str:
    """Canonicalize transcript whitespace at every ingestion boundary."""
    return re.sub(r"\s+", " ", content).strip()


async def lock_transcript_session(db: AsyncSession, session_id: UUID) -> InterviewSession:
    """Lock and reload the session before changing transcript or live-state data."""
    session = await db.scalar(
        select(InterviewSession)
        .where(InterviewSession.id == session_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if session is None:
        raise LookupError("Interview session not found while locking transcript")
    return session


def infer_candidate_evidence(text: str, rubric: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Find explicit competency signals without inventing facts beyond the linked turn."""
    lowered = text.lower()
    inferred: list[dict[str, str]] = []
    for criterion in rubric:
        key = str(criterion.get("key", ""))
        label = str(criterion.get("label", key.replace("_", " ")))
        cues = _COMPETENCY_CUES.get(key, ())
        key_tokens = tuple(token for token in re.split(r"[_\W]+", key.lower()) if len(token) >= 5)
        if not any(cue in lowered for cue in (*cues, *key_tokens)):
            continue
        inferred.append(
            {
                "competency": key,
                "strength": "supports",
                "note": (
                    f"Candidate stated content relevant to {label}; the linked transcript "
                    "turn is the source of truth for assessment."
                ),
            }
        )
    return inferred


async def persist_candidate_turn(
    db: AsyncSession,
    session: InterviewSession,
    content: str,
    *,
    source: str,
    agora_turn_id: str | None = None,
) -> TranscriptTurn:
    """Idempotently reconcile a candidate turn from RTM, custom LLM, or history."""
    content = normalize_transcript_content(content)
    if not content:
        raise ValueError("Candidate transcript content cannot be empty")
    await lock_transcript_session(db, session.id)
    if agora_turn_id:
        existing = await db.scalar(
            select(TranscriptTurn).where(
                TranscriptTurn.session_id == session.id,
                TranscriptTurn.agora_turn_id == agora_turn_id,
            )
        )
        if existing is not None:
            if len(content) > len(existing.content):
                existing.content = content
                existing.turn_metadata = {
                    **existing.turn_metadata,
                    "reconciled_source": source,
                    "stable_turn_updated": True,
                }
            return existing

        # Agora's history update contains the full conversation and can arrive
        # after the custom-LLM callback. Attach its stable id to the oldest
        # matching synthetic row. Oldest-first matching keeps repeated,
        # text-identical answers one-to-one with chronological history items.
        unmatched_candidates = list(
            (
                await db.execute(
                    select(TranscriptTurn)
                    .where(
                        TranscriptTurn.session_id == session.id,
                        TranscriptTurn.speaker_type == "candidate",
                        TranscriptTurn.agora_turn_id.is_(None),
                    )
                    .order_by(TranscriptTurn.sequence)
                )
            ).scalars()
        )
        synthetic = next(
            (
                turn
                for turn in unmatched_candidates
                if turn.turn_metadata.get("source") in {"agora-custom-llm", "panel-dispatch"}
                and normalize_transcript_content(turn.content) == content
            ),
            None,
        )
        if synthetic is not None:
            synthetic.agora_turn_id = agora_turn_id
            synthetic.content = content
            synthetic.turn_metadata = {
                **synthetic.turn_metadata,
                "reconciled_source": source,
                "stable_turn_reconciled": True,
            }
            return synthetic

    max_sequence = await db.scalar(
        select(func.max(TranscriptTurn.sequence)).where(TranscriptTurn.session_id == session.id)
    )
    turn = TranscriptTurn(
        id=uuid4(),
        session_id=session.id,
        sequence=(max_sequence or 0) + 1,
        agora_turn_id=agora_turn_id,
        speaker_type="candidate",
        content=content,
        turn_metadata={"source": source, "reconciled": True},
    )
    db.add(turn)
    await db.flush()
    return turn


async def persist_interviewer_turn(
    db: AsyncSession,
    session: InterviewSession,
    content: str,
    *,
    speaker_id: str | None,
    source: str,
    agora_turn_id: str | None = None,
    metadata: dict[str, Any] | None = None,
    interrupted: bool = False,
    confidence: float | None = None,
    started_at: datetime | None = None,
    ended_at: datetime | None = None,
) -> TranscriptTurn:
    """Persist a generated question, then attach Agora's stable turn id later."""
    content = normalize_transcript_content(content)
    if not content:
        raise ValueError("Interviewer transcript content cannot be empty")
    await lock_transcript_session(db, session.id)
    extra_metadata = {key: value for key, value in (metadata or {}).items() if key != "source"}
    if agora_turn_id:
        existing = await db.scalar(
            select(TranscriptTurn).where(
                TranscriptTurn.session_id == session.id,
                TranscriptTurn.agora_turn_id == agora_turn_id,
            )
        )
        if existing is not None:
            if existing.speaker_type != "interviewer":
                return existing
            if len(content) > len(normalize_transcript_content(existing.content)):
                existing.content = content
            if existing.speaker_id is None:
                existing.speaker_id = speaker_id
            existing.interrupted = interrupted
            existing.confidence = confidence if confidence is not None else existing.confidence
            existing.started_at = started_at or existing.started_at
            existing.ended_at = ended_at or existing.ended_at
            existing.turn_metadata = {
                **existing.turn_metadata,
                **extra_metadata,
                "reconciled_source": source,
                "stable_turn_updated": True,
            }
            return existing

        unmatched = list(
            (
                await db.execute(
                    select(TranscriptTurn)
                    .where(
                        TranscriptTurn.session_id == session.id,
                        TranscriptTurn.speaker_type == "interviewer",
                        TranscriptTurn.agora_turn_id.is_(None),
                    )
                    .order_by(TranscriptTurn.sequence)
                )
            ).scalars()
        )
        synthetic = next(
            (
                turn
                for turn in unmatched
                if turn.turn_metadata.get("source") == "agora-custom-llm"
                and normalize_transcript_content(turn.content) == content
            ),
            None,
        )
        if synthetic is not None:
            synthetic.agora_turn_id = agora_turn_id
            synthetic.content = content
            if synthetic.speaker_id is None:
                synthetic.speaker_id = speaker_id
            synthetic.interrupted = interrupted
            synthetic.confidence = confidence
            synthetic.started_at = started_at or synthetic.started_at
            synthetic.ended_at = ended_at or synthetic.ended_at
            synthetic.turn_metadata = {
                **synthetic.turn_metadata,
                **extra_metadata,
                "reconciled_source": source,
                "stable_turn_reconciled": True,
            }
            return synthetic

    max_sequence = await db.scalar(
        select(func.max(TranscriptTurn.sequence)).where(TranscriptTurn.session_id == session.id)
    )
    turn = TranscriptTurn(
        id=uuid4(),
        session_id=session.id,
        sequence=(max_sequence or 0) + 1,
        agora_turn_id=agora_turn_id,
        speaker_type="interviewer",
        speaker_id=speaker_id,
        content=content,
        interrupted=interrupted,
        confidence=confidence,
        started_at=started_at,
        ended_at=ended_at,
        turn_metadata={
            "source": source,
            "reconciled": True,
            **extra_metadata,
        },
    )
    db.add(turn)
    await db.flush()
    return turn


async def persist_inferred_evidence(
    db: AsyncSession,
    session: InterviewSession,
    turn: TranscriptTurn,
) -> list[EvidenceItem]:
    if turn.speaker_type != "candidate":
        return []
    existing = set(
        (
            await db.execute(
                select(EvidenceItem.competency).where(
                    EvidenceItem.session_id == session.id,
                    EvidenceItem.transcript_turn_id == turn.id,
                )
            )
        ).scalars()
    )
    role_rubric = {
        str(criterion.get("key")): criterion
        for panelist in session.config_snapshot.get("panel", [])
        for criterion in panelist.get("role_rubric", [])
        if criterion.get("key")
    }
    rubric = list(role_rubric.values()) or session.config_snapshot["rubric"]
    created: list[EvidenceItem] = []
    for values in infer_candidate_evidence(turn.content, rubric):
        if values["competency"] in existing:
            continue
        item = EvidenceItem(
            session_id=session.id,
            transcript_turn_id=turn.id,
            **values,
        )
        db.add(item)
        created.append(item)
    if created:
        await db.flush()
    return created


def competency_for_subject(subject: str, rubric: list[dict[str, Any]]) -> str | None:
    """Map a contradicted metric subject onto a rubric competency using existing cues."""
    for criterion in rubric:
        key = str(criterion.get("key", ""))
        if subject in _COMPETENCY_CUES.get(key, ()):
            return key
    return None


async def persist_contradiction_evidence(
    db: AsyncSession,
    session: InterviewSession,
    turn: TranscriptTurn,
    *,
    subject: str,
    earlier_turn_id: str,
    detail: str,
) -> EvidenceItem | None:
    """Record a contradiction against the turn that made it, citing the earlier turn.

    The unique (session, turn, competency) constraint means an inferred "supports" row for
    this turn may already exist. A contradiction is the stronger finding, so it upgrades
    that row in place rather than being dropped.
    """
    role_rubric = {
        str(criterion.get("key")): criterion
        for panelist in session.config_snapshot.get("panel", [])
        for criterion in panelist.get("role_rubric", [])
        if criterion.get("key")
    }
    rubric = list(role_rubric.values()) or session.config_snapshot["rubric"]
    competency = competency_for_subject(subject, rubric)
    if competency is None:
        return None
    note = (
        f"Candidate restated {subject} with different numbers than transcript turn "
        f"{earlier_turn_id}. {detail}"
    )[:2_000]
    existing = await db.scalar(
        select(EvidenceItem).where(
            EvidenceItem.session_id == session.id,
            EvidenceItem.transcript_turn_id == turn.id,
            EvidenceItem.competency == competency,
        )
    )
    if existing is not None:
        existing.strength = "contradicts"
        existing.note = note
        await db.flush()
        return existing
    item = EvidenceItem(
        session_id=session.id,
        transcript_turn_id=turn.id,
        competency=competency,
        strength="contradicts",
        note=note,
    )
    db.add(item)
    await db.flush()
    return item
