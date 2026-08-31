from typing import Any

from app.models import EvidenceItem, TranscriptTurn


def build_assessment(
    snapshot: dict[str, Any],
    turns: list[TranscriptTurn],
    evidence: list[EvidenceItem],
) -> dict[str, Any]:
    candidate_turns = [turn for turn in turns if turn.speaker_type == "candidate"]
    assessments: list[dict[str, Any]] = []
    evidence_map: list[dict[str, Any]] = []
    weighted_score = 0.0
    covered_weight = 0.0

    for criterion in snapshot["rubric"]:
        key = criterion["key"]
        matching = [item for item in evidence if item.competency == key]
        # Reports are persisted as JSON, so keep UUID references JSON-native.
        cited_turns = [str(item.transcript_turn_id) for item in matching]
        if not matching:
            score = None
            confidence = 0.0
            feedback = "Insufficient evidence. Use a replay drill to answer with a specific example."
        else:
            support = sum(item.strength == "supports" for item in matching)
            contradict = sum(item.strength == "contradicts" for item in matching)
            score = max(20.0, min(95.0, 58.0 + support * 12.0 - contradict * 15.0))
            confidence = min(1.0, 0.35 + len(matching) * 0.2)
            feedback = "Grounded in linked transcript evidence. Add measurable outcomes to strengthen it."
            weighted_score += score * criterion["weight"]
            covered_weight += criterion["weight"]
        assessments.append(
            {
                "key": key,
                "label": criterion["label"],
                "score": score,
                "confidence": confidence,
                "evidence_turn_ids": cited_turns,
                "feedback": feedback,
            }
        )
        for item in matching:
            evidence_map.append(
                {
                    "competency": key,
                    "evidence_id": str(item.id),
                    "transcript_turn_id": str(item.transcript_turn_id),
                    "strength": item.strength,
                    "note": item.note,
                }
            )

    enough_evidence = covered_weight >= 0.6 and len(candidate_turns) >= 2
    overall_score = round(weighted_score / covered_weight, 1) if covered_weight else None
    if not enough_evidence:
        readiness = "insufficient_evidence"
        summary = "More transcript-linked evidence is required before a reliable panel decision."
    elif overall_score is not None and overall_score >= 75:
        readiness = "interview_ready"
        summary = "The evidence shows consistent interview-ready performance with focused gaps."
    elif overall_score is not None and overall_score >= 60:
        readiness = "developing"
        summary = "The evidence shows a credible base with several skills to strengthen."
    else:
        readiness = "needs_practice"
        summary = "Replay the lowest-evidence competencies before the next interview."

    interviewer_assessments = [
        {
            "panelist_id": member["id"],
            "role": member["role"],
            "summary": "Assessment uses the panel's shared transcript and linked evidence.",
        }
        for member in snapshot["panel"]
    ]
    return {
        "overall_score": overall_score,
        "readiness": readiness,
        "summary": summary,
        "competencies": assessments,
        "interviewer_assessments": interviewer_assessments,
        "evidence_map": evidence_map,
    }


def build_replay_drills(report: dict[str, Any]) -> list[dict[str, Any]]:
    drills = []
    for item in report["competencies"]:
        if item["score"] is None or item["score"] < 70:
            drills.append(
                {
                    "competency": item["key"],
                    "prompt": (
                        f"Replay {item['label']}: give a structured example, explain the tradeoff, "
                        "and finish with a measurable outcome."
                    ),
                    "source_turn_ids": [str(turn_id) for turn_id in item["evidence_turn_ids"]],
                }
            )
    return drills[:5]
