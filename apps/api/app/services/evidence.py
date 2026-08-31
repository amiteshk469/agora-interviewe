import re
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


async def lock_transcript_session(db: AsyncSession, session_id: UUID) -> None:
    """Serialize every writer that allocates a transcript sequence for a session."""
    locked_session_id = await db.scalar(
        select(InterviewSession.id)
        .where(InterviewSession.id == session_id)
        .with_for_update()
    )
    if locked_session_id is None:
        raise LookupError("Interview session not found while locking transcript")


def infer_candidate_evidence(
    text: str, rubric: list[dict[str, Any]]
) -> list[dict[str, str]]:
    """Find explicit competency signals without inventing facts beyond the linked turn."""
    lowered = text.lower()
    inferred: list[dict[str, str]] = []
    for criterion in rubric:
        key = str(criterion.get("key", ""))
        label = str(criterion.get("label", key.replace("_", " ")))
        cues = _COMPETENCY_CUES.get(key, ())
        key_tokens = tuple(
            token for token in re.split(r"[_\W]+", key.lower()) if len(token) >= 5
        )
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
    await lock_transcript_session(db, session.id)
    if agora_turn_id:
        existing = await db.scalar(
            select(TranscriptTurn).where(
                TranscriptTurn.session_id == session.id,
                TranscriptTurn.agora_turn_id == agora_turn_id,
            )
        )
        if existing is not None:
            return existing

    latest_matching = await db.scalar(
        select(TranscriptTurn)
        .where(
            TranscriptTurn.session_id == session.id,
        )
        .order_by(TranscriptTurn.sequence.desc())
        .limit(1)
    )
    if (
        latest_matching is not None
        and latest_matching.speaker_type == "candidate"
        and latest_matching.content == content
    ):
        if agora_turn_id and latest_matching.agora_turn_id is None:
            latest_matching.agora_turn_id = agora_turn_id
            latest_matching.turn_metadata = {
                **latest_matching.turn_metadata,
                "reconciled_source": source,
            }
        return latest_matching

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
    created: list[EvidenceItem] = []
    for values in infer_candidate_evidence(turn.content, session.config_snapshot["rubric"]):
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
