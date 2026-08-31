import hmac
import json
import re
from typing import Annotated, Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select

from app.core.config import Settings, SettingsDep
from app.core.database import Db
from app.domain import (
    PLATFORM_INVARIANTS,
    PanelDirector,
    compile_agent_prompt,
    delimit_untrusted,
)
from app.models import (
    EvidenceItem,
    InterviewConfig,
    InterviewSession,
    JobDescription,
    PanelParticipant,
    ToolRun,
    TranscriptTurn,
)
from app.schemas import ChatCompletionRequest, PanelDecision, PanelistInput, PanelState
from app.services.evidence import persist_candidate_turn, persist_inferred_evidence
from app.services.tools import execute_tool

router = APIRouter(tags=["Agora custom LLM"])


def _bearer_value(header: str | None) -> str:
    if not header or not header.lower().startswith("bearer "):
        return ""
    return header[7:].strip()


def _latest_user_text(payload: ChatCompletionRequest) -> str:
    for message in reversed(payload.messages):
        if message.role != "user":
            continue
        if isinstance(message.content, str):
            return message.content
        if isinstance(message.content, list):
            return " ".join(
                str(item.get("text", "")) for item in message.content if item.get("type") == "text"
            )
    return "Continue the interview."


def _upstream_url(base_url: str) -> str:
    clean = base_url.rstrip("/")
    return clean if clean.endswith("/chat/completions") else f"{clean}/chat/completions"


_ARITHMETIC = re.compile(r"(?<!\w)([-+]?\d+(?:\.\d+)?(?:\s*[-+*/%]\s*[-+]?\d+(?:\.\d+)?)+)")
_MINIMAX_VOICE_TYPES = {
    "clear-neutral": "English_CalmWoman",
    "warm-analytical": "English_Graceful_Lady",
    "precise": "English_Debator",
    "direct": "English_Trustworth_Man",
    "nova": "English_expressive_narrator",
    "atlas": "English_Trustworth_Man",
    "sage": "English_Steadymentor",
    "ember": "English_Debator",
    "lumen": "English_Graceful_Lady",
}
_MINIMAX_VOICE_WHITELIST = {
    "English_CalmWoman",
    "English_Trustworth_Man",
    "English_Debator",
    "English_Steadymentor",
    "English_Graceful_Lady",
    "English_expressive_narrator",
    "English_captivating_female1",
}


async def _run_live_tools(
    db: Db,
    settings: Settings,
    session: InterviewSession,
    transcript_turn_id: UUID,
    panelist_id: str,
    candidate_text: str,
    enabled_tools: list[str],
) -> tuple[list[dict[str, Any]], list[str]]:
    corpus = [
        {"source": f"transcript:{turn.id}", "text": turn.content}
        for turn in (
            await db.execute(select(TranscriptTurn).where(TranscriptTurn.session_id == session.id))
        ).scalars()
    ]
    config = await db.scalar(
        select(InterviewConfig).where(InterviewConfig.id == session.interview_config_id)
    )
    has_jd = False
    if config and config.job_description_id:
        document = await db.scalar(
            select(JobDescription).where(JobDescription.id == config.job_description_id)
        )
        if document:
            has_jd = True
            corpus.append({"source": f"job-description:{document.id}", "text": document.raw_text})

    plans: list[tuple[str, dict[str, Any]]] = []
    expression = _ARITHMETIC.search(candidate_text)
    if expression and "calculator" in enabled_tools:
        plans.append(("calculator", {"expression": expression.group(1)}))
    if has_jd and "knowledge_search" in enabled_tools:
        plans.append(("knowledge_search", {"query": candidate_text[-500:]}))
    if (
        settings.web_search_enabled
        and "web_search" in enabled_tools
        and any(
            cue in candidate_text.lower()
            for cue in (
                "current market",
                "latest market",
                "verify this fact",
                "current company",
                "as of today",
                "recent benchmark",
            )
        )
    ):
        plans.append(("web_search", {"query": candidate_text[-300:]}))

    audits: list[dict[str, Any]] = []
    prompt_context: list[str] = []
    for name, arguments in plans[:1]:
        run = ToolRun(
            id=uuid4(),
            session_id=session.id,
            transcript_turn_id=transcript_turn_id,
            panelist_id=panelist_id,
            tool_name=name,
            arguments=arguments,
            result={},
            status="started",
        )
        db.add(run)
        try:
            result = await execute_tool(name, arguments, corpus, settings)
            run.result = result
            run.status = "completed"
            prompt_context.append(delimit_untrusted(f"tool:{name}", json.dumps(result)))
        except Exception as exc:
            run.status = "failed"
            run.error = type(exc).__name__
            result = {"error": "Tool execution failed; do not infer a result."}
        audits.append(
            {
                "tool_run_id": str(run.id),
                "name": name,
                "status": run.status,
                "arguments": arguments,
                "result": result,
            }
        )
    return audits, prompt_context


@router.post("/llm/chat/completions", response_model=None)
async def panel_chat_completions(
    payload: ChatCompletionRequest,
    db: Db,
    settings: SettingsDep,
    authorization: Annotated[str | None, Header()] = None,
    x_roundcraft_session_id: Annotated[str | None, Header()] = None,
    x_roundcraft_panelist_id: Annotated[str | None, Header()] = None,
) -> JSONResponse | StreamingResponse:
    """OpenAI-compatible boundary used by Agora for non-linear panel arbitration."""
    if not settings.agora_llm_bearer_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Custom LLM secret is not configured")
    if not hmac.compare_digest(
        _bearer_value(authorization), settings.agora_llm_bearer_secret
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid custom LLM credential")
    if not settings.llm_base_url or not settings.llm_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Upstream LLM is not configured")

    if not x_roundcraft_session_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "RoundCraft session id is required")
    try:
        session_id = UUID(x_roundcraft_session_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid RoundCraft session id") from exc
    session = await db.scalar(
        select(InterviewSession)
        .where(InterviewSession.id == session_id)
        .with_for_update()
    )
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "RoundCraft session not found")
    if session.status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, "RoundCraft session is not live")

    snapshot = session.config_snapshot
    state = PanelState.model_validate(session.memory_state)
    panel = [PanelistInput.model_validate(item) for item in snapshot["panel"]]
    candidate_text = _latest_user_text(payload)
    if x_roundcraft_panelist_id:
        selected = next(
            (item for item in panel if item.id == x_roundcraft_panelist_id),
            None,
        )
        participant = await db.scalar(
            select(PanelParticipant).where(
                PanelParticipant.session_id == session.id,
                PanelParticipant.panelist_id == x_roundcraft_panelist_id,
                PanelParticipant.status == "running",
            )
        )
        if selected is None or participant is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Bound panel agent is not running")
        if state.pending_panelist_id != selected.id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Panel agent does not hold the floor")
        decision = PanelDecision(
            next_speaker_id=selected.id,
            action="ask",
            rationale="The silent director dispatched this bound Agora panel agent.",
            suggested_question=state.last_question or "Ask an adaptive evidence-grounded follow-up.",
        )
        state.pending_panelist_id = None
    else:
        decision = PanelDirector.choose_next(panel, state, candidate_text)
        selected = next(item for item in panel if item.id == decision.next_speaker_id)
        state.panelist_question_counts[selected.id] = (
            state.panelist_question_counts.get(selected.id, 0) + 1
        )
    state.current_speaker_id = selected.id
    state.last_question = decision.suggested_question

    candidate_turn = await persist_candidate_turn(
        db,
        session,
        candidate_text,
        source="agora-custom-llm",
    )
    inferred_evidence = await persist_inferred_evidence(db, session, candidate_turn)
    if not inferred_evidence:
        inferred_evidence = list(
            (
                await db.execute(
                    select(EvidenceItem).where(
                        EvidenceItem.session_id == session.id,
                        EvidenceItem.transcript_turn_id == candidate_turn.id,
                    )
                )
            ).scalars()
        )
    role_tools = [
        tool
        for tool in snapshot["enabled_tools"]
        if tool in (selected.allowed_tools or [])
    ]
    tool_audits, tool_context = await _run_live_tools(
        db,
        settings,
        session,
        candidate_turn.id,
        selected.id,
        candidate_text,
        role_tools,
    )
    metadata = {
        "session_id": str(session.id),
        "selected_panelist": {
            "id": selected.id,
            "display_name": selected.display_name,
            "role": selected.role,
            "voice": selected.voice,
            "mood": selected.mood,
        },
        "director": decision.model_dump(),
        "enabled_tools": role_tools,
        "tool_audits": tool_audits,
        "evidence_bookmarks": [
            {
                "id": str(item.id),
                "transcript_turn_id": str(item.transcript_turn_id),
                "competency": item.competency,
            }
            for item in inferred_evidence
        ],
    }
    session.memory_state = state.model_dump()
    db.add(
        ToolRun(
            session_id=session.id,
            transcript_turn_id=candidate_turn.id,
            panelist_id=selected.id,
            tool_name="panel.bid",
            arguments={"candidate_turn": candidate_text[-4000:]},
            result=metadata,
            status="completed",
        )
    )
    # Release the session lock before waiting on the upstream model or streaming audio.
    await db.commit()

    selected_instruction = "\n".join(
        value
        for value in (
            compile_agent_prompt(snapshot),
            f"Speak now as {selected.display_name}, the {selected.role}.",
            f"Director action: {decision.action}. Objective: {decision.suggested_question}",
            (
                "<STUDENT_CUSTOMIZATION>\n"
                f"{selected.custom_prompt}\n"
                "</STUDENT_CUSTOMIZATION>"
                if selected.custom_prompt
                else None
            ),
            delimit_untrusted("panelist-knowledge", selected.knowledge_prompt)
            if selected.knowledge_prompt
            else None,
            *tool_context,
            PLATFORM_INVARIANTS,
        )
        if value
    )
    upstream_body = payload.model_dump(mode="json", exclude_none=True)
    upstream_body["model"] = settings.llm_model
    upstream_body["messages"] = [
        {"role": "system", "content": selected_instruction},
        *(message for message in upstream_body["messages"] if message["role"] != "system"),
    ]
    upstream_headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    upstream_url = _upstream_url(settings.llm_base_url)

    if not payload.stream:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await client.post(upstream_url, headers=upstream_headers, json=upstream_body)
        if response.status_code >= 400:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Upstream LLM request failed")
        body = response.json()
        body["roundcraft"] = metadata
        return JSONResponse(body)

    client = httpx.AsyncClient(timeout=45)
    request = client.build_request("POST", upstream_url, headers=upstream_headers, json=upstream_body)
    response = await client.send(request, stream=True)
    if response.status_code >= 400:
        await response.aclose()
        await client.aclose()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Upstream LLM stream failed")

    requested_voice = selected.voice.strip()
    voice_type = (
        requested_voice
        if requested_voice in _MINIMAX_VOICE_WHITELIST
        else _MINIMAX_VOICE_TYPES.get(requested_voice.lower(), "English_captivating_female1")
    )
    rate = 1.05 if selected.behavior in {"challenging", "tradeoff-seeking"} else 1.0
    first_chunk = {
        "id": f"roundcraft-{uuid4().hex}",
        "object": "chat.completion.custom_metadata",
        "choices": [],
        "metadata": {
            "interruptable": selected.interruption_style != "uninterruptible",
            "tts_params": {"params": {"voice_type": voice_type, "rate": rate}},
            "roundcraft": metadata,
        },
    }

    async def stream() -> Any:
        try:
            yield f"data: {json.dumps(first_chunk, separators=(',', ':'))}\n\n".encode()
            async for chunk in response.aiter_bytes():
                yield chunk
        finally:
            await response.aclose()
            await client.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream")
