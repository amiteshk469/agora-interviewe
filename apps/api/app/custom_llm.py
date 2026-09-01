import asyncio
import hmac
import json
import logging
import re
import time
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
from app.schemas import (
    INTERVIEWER_TOOL_NAMES,
    ChatCompletionRequest,
    PanelDecision,
    PanelistInput,
    PanelState,
)
from app.services.evidence import (
    normalize_transcript_content,
    persist_candidate_turn,
    persist_inferred_evidence,
)
from app.services.tools import execute_tool

router = APIRouter(tags=["Agora custom LLM"])
logger = logging.getLogger(__name__)

_MAX_UPSTREAM_ATTEMPTS = 2
_MAX_RETRY_AFTER_SECONDS = 1.0
_MAX_SPOKEN_MESSAGES = 8
_MAX_SPOKEN_MESSAGE_CHARS = 1_500
_MAX_PRECONTENT_STREAM_BYTES = 64 * 1024
_FIRST_CONTENT_TIMEOUT_SECONDS = 8.0
_EMPTY_INPUT_CONTINUATION = ""
_REQUEST_ID = re.compile(r"[^a-zA-Z0-9_.:-]+")


def _bearer_value(header: str | None) -> str:
    if not header or not header.lower().startswith("bearer "):
        return ""
    return header[7:].strip()


def _message_text(content: str | list[dict[str, Any]] | None) -> str:
    if isinstance(content, str):
        value = content
    elif isinstance(content, list):
        value = " ".join(
            text
            for item in content
            if item.get("type") == "text" and isinstance((text := item.get("text")), str) and text.strip()
        )
    else:
        value = ""
    return re.sub(r"\s+", " ", value).strip()


def _latest_user_text(payload: ChatCompletionRequest) -> str:
    for message in reversed(payload.messages):
        if message.role != "user":
            continue
        return _message_text(message.content)[:40_000]
    return ""


def _spoken_messages(payload: ChatCompletionRequest) -> list[dict[str, str]]:
    """Keep only the OpenAI fields Groq needs from Agora's extensible envelope."""
    messages: list[dict[str, str]] = []
    for message in payload.messages:
        if message.role not in {"user", "assistant"}:
            continue
        content = _message_text(message.content)
        if content:
            messages.append(
                {
                    "role": message.role,
                    "content": content[:_MAX_SPOKEN_MESSAGE_CHARS],
                }
            )
    return messages[-_MAX_SPOKEN_MESSAGES:]


def _upstream_url(base_url: str) -> str:
    clean = base_url.rstrip("/")
    return clean if clean.endswith("/chat/completions") else f"{clean}/chat/completions"


def _is_transient_upstream_status(status_code: int) -> bool:
    return status_code == 429 or 500 <= status_code < 600


def _safe_request_id(response: httpx.Response | None) -> str:
    if response is None:
        return "unavailable"
    value = response.headers.get("x-request-id") or response.headers.get("x-groq-request-id")
    return _REQUEST_ID.sub("", value)[:100] if value else "unavailable"


def _retry_delay(response: httpx.Response | None = None) -> float:
    value = response.headers.get("retry-after") if response is not None else None
    try:
        seconds = float(value) if value is not None else 0.15
    except ValueError:
        seconds = 0.15
    return max(0.0, min(seconds, _MAX_RETRY_AFTER_SECONDS))


def _log_upstream_failure(
    *,
    attempt: int,
    stream: bool,
    transient: bool,
    response: httpx.Response | None = None,
    error: Exception | None = None,
) -> None:
    event = {
        "event": "upstream_llm_failure",
        "attempt": attempt,
        "max_attempts": _MAX_UPSTREAM_ATTEMPTS,
        "stream": stream,
        "transient": transient,
        "status": response.status_code if response is not None else None,
        "request_id": _safe_request_id(response),
        "error_type": type(error).__name__ if error is not None else None,
    }
    logger.log(
        logging.WARNING if transient else logging.ERROR,
        json.dumps(event, separators=(",", ":")),
    )


async def _send_upstream_with_retry(
    client: httpx.AsyncClient,
    *,
    url: str,
    headers: dict[str, str],
    body: dict[str, Any],
    stream: bool,
) -> httpx.Response | None:
    for attempt in range(1, _MAX_UPSTREAM_ATTEMPTS + 1):
        request = client.build_request("POST", url, headers=headers, json=body)
        try:
            response = await client.send(request, stream=stream)
        except httpx.TransportError as exc:
            _log_upstream_failure(
                attempt=attempt,
                stream=stream,
                transient=True,
                error=exc,
            )
            if attempt < _MAX_UPSTREAM_ATTEMPTS:
                await asyncio.sleep(_retry_delay())
            continue
        if response.status_code < 400:
            return response
        await response.aread()
        transient = _is_transient_upstream_status(response.status_code)
        _log_upstream_failure(
            attempt=attempt,
            stream=stream,
            transient=transient,
            response=response,
        )
        delay = _retry_delay(response)
        await response.aclose()
        if not transient:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Upstream LLM request failed")
        if attempt < _MAX_UPSTREAM_ATTEMPTS:
            await asyncio.sleep(delay)
    return None


def _director_continuation(suggested_question: str) -> str:
    value = suggested_question.strip()
    if value.endswith("?"):
        return value
    return "Could you expand on that with a specific example, tradeoff, and measurable result?"


def _local_stream_events(content: str, model: str) -> tuple[bytes, bytes, bytes]:
    completion_id = f"roundcraft-{uuid4().hex}"
    created = int(time.time())
    chunk = {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": {"role": "assistant", "content": content},
                "finish_reason": None,
            }
        ],
    }
    finished = {
        **chunk,
        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
    }
    return (
        f"data: {json.dumps(chunk, separators=(',', ':'))}\n\n".encode(),
        f"data: {json.dumps(finished, separators=(',', ':'))}\n\n".encode(),
        b"data: [DONE]\n\n",
    )


def _inspect_upstream_stream(raw: bytes) -> tuple[bool, bool]:
    """Return whether an SSE stream contains spoken content and has terminated."""
    has_content = False
    has_done = False
    for line in raw.decode(errors="ignore").splitlines():
        line = line.strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            has_done = True
            continue
        try:
            event = json.loads(data)
        except (TypeError, ValueError):
            continue
        choices = event.get("choices") if isinstance(event, dict) else None
        if not isinstance(choices, list):
            continue
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            delta = choice.get("delta")
            if isinstance(delta, dict):
                content = delta.get("content")
                if isinstance(content, str) and content.strip():
                    has_content = True
    return has_content, has_done


def _local_completion_response(
    content: str,
    *,
    stream: bool,
    model: str,
    metadata: dict[str, Any] | None = None,
    first_chunk: dict[str, Any] | None = None,
) -> JSONResponse | StreamingResponse:
    completion_id = f"roundcraft-{uuid4().hex}"
    created = int(time.time())
    if not stream:
        body: dict[str, Any] = {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": content},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            },
        }
        if metadata is not None:
            body["roundcraft"] = metadata
        return JSONResponse(body)

    async def local_stream() -> Any:
        if first_chunk is not None:
            yield f"data: {json.dumps(first_chunk, separators=(',', ':'))}\n\n".encode()
        for event in _local_stream_events(content, model):
            yield event

    return StreamingResponse(local_stream(), media_type="text/event-stream")


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


async def _prepare_live_tool(
    db: Db,
    settings: Settings,
    session: InterviewSession,
    candidate_text: str,
    enabled_tools: list[str],
) -> tuple[str, dict[str, Any], list[dict[str, str]]] | None:
    corpus = [
        {"source": f"transcript:{turn.id}", "text": turn.content}
        for turn in (await db.execute(select(TranscriptTurn).where(TranscriptTurn.session_id == session.id))).scalars()
    ]
    config = await db.scalar(select(InterviewConfig).where(InterviewConfig.id == session.interview_config_id))
    has_jd = False
    if config and config.job_description_id:
        document = await db.scalar(select(JobDescription).where(JobDescription.id == config.job_description_id))
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

    if not plans:
        return None
    name, arguments = plans[0]
    return name, arguments, corpus


async def _execute_live_tool(
    db: Db,
    settings: Settings,
    session_id: UUID,
    transcript_turn_id: UUID,
    panelist_id: str,
    planned: tuple[str, dict[str, Any], list[dict[str, str]]],
) -> tuple[list[dict[str, Any]], list[str]]:
    name, arguments, corpus = planned
    run_id = uuid4()
    status_value = "completed"
    error: str | None = None
    prompt_context: list[str] = []
    try:
        result = await execute_tool(name, arguments, corpus, settings)
        prompt_context.append(delimit_untrusted(f"tool:{name}", json.dumps(result)))
    except Exception as exc:
        status_value = "failed"
        error = type(exc).__name__
        result = {"error": "Tool execution failed; do not infer a result."}
    db.add(
        ToolRun(
            id=run_id,
            session_id=session_id,
            transcript_turn_id=transcript_turn_id,
            panelist_id=panelist_id,
            tool_name=name,
            arguments=arguments,
            result=result,
            status=status_value,
            error=error,
        )
    )
    await db.flush()
    return [
        {
            "tool_run_id": str(run_id),
            "name": name,
            "status": status_value,
            "arguments": arguments,
            "result": result,
        }
    ], prompt_context


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
    if not hmac.compare_digest(_bearer_value(authorization), settings.agora_llm_bearer_secret):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid custom LLM credential")
    if not x_roundcraft_session_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "RoundCraft session id is required")
    try:
        session_id = UUID(x_roundcraft_session_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid RoundCraft session id") from exc
    session = await db.scalar(select(InterviewSession).where(InterviewSession.id == session_id).with_for_update())
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "RoundCraft session not found")
    if session.status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, "RoundCraft session is not live")

    candidate_text = _latest_user_text(payload)
    if not candidate_text:
        logger.info(
            json.dumps(
                {
                    "event": "empty_agora_user_content",
                    "session_id": str(session.id),
                    "stream": payload.stream,
                },
                separators=(",", ":"),
            )
        )
        # The session lookup uses FOR UPDATE; release that read lock before the
        # local SSE body is sent so repeated noise events cannot queue writers.
        await db.commit()
        return _local_completion_response(
            _EMPTY_INPUT_CONTINUATION,
            stream=payload.stream,
            model=payload.model,
        )
    if not settings.llm_base_url or not settings.llm_api_key:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Upstream LLM is not configured")

    snapshot = session.config_snapshot
    state = PanelState.model_validate(session.memory_state)
    panel = [PanelistInput.model_validate(item) for item in snapshot["panel"]]
    candidate_turn: TranscriptTurn | None = None
    if state.pending_candidate_turn_id:
        try:
            pending_candidate_turn_id = UUID(state.pending_candidate_turn_id)
        except ValueError:
            pending_candidate_turn_id = None
        if pending_candidate_turn_id is not None:
            candidate_turn = await db.scalar(
                select(TranscriptTurn).where(
                    TranscriptTurn.id == pending_candidate_turn_id,
                    TranscriptTurn.session_id == session.id,
                    TranscriptTurn.speaker_type == "candidate",
                )
            )
        state.pending_candidate_turn_id = None
        if candidate_turn is None or normalize_transcript_content(
            candidate_turn.content
        ) != normalize_transcript_content(candidate_text):
            # The pending turn and forced panelist are one correlation. If the
            # callback is stale or malformed, neither may leak into this answer.
            candidate_turn = None
            state.pending_panelist_id = None
    elif state.pending_panelist_id:
        state.pending_panelist_id = None
    if candidate_turn is None:
        candidate_turn = await persist_candidate_turn(
            db,
            session,
            normalize_transcript_content(candidate_text),
            source="agora-custom-llm",
        )

    forced_panelist_id = state.pending_panelist_id
    if x_roundcraft_panelist_id:
        if forced_panelist_id != x_roundcraft_panelist_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Panel agent does not hold the floor")
        forced_panelist_id = x_roundcraft_panelist_id

    replayed_bid: ToolRun | None = None
    if forced_panelist_id:
        selected = next(
            (item for item in panel if item.id == forced_panelist_id),
            None,
        )
        participant = await db.scalar(
            select(PanelParticipant).where(
                PanelParticipant.session_id == session.id,
                PanelParticipant.panelist_id == forced_panelist_id,
                PanelParticipant.status == "running",
            )
        )
        if selected is None or participant is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Selected logical panelist is not running")
        decision = PanelDecision(
            next_speaker_id=selected.id,
            action="ask",
            rationale="Explicit panel floor selection for the shared Agora session.",
            suggested_question=state.last_question or "Ask an adaptive evidence-grounded follow-up.",
        )
        state.pending_panelist_id = None
    else:
        replayed_bid = await db.scalar(
            select(ToolRun)
            .where(
                ToolRun.session_id == session.id,
                ToolRun.transcript_turn_id == candidate_turn.id,
                ToolRun.tool_name == "panel.bid",
                ToolRun.status == "completed",
            )
            .order_by(ToolRun.created_at.desc())
            .limit(1)
        )
        if replayed_bid is not None:
            try:
                decision = PanelDecision.model_validate(replayed_bid.result["director"])
                selected = next(item for item in panel if item.id == decision.next_speaker_id)
            except (KeyError, StopIteration, TypeError, ValueError):
                replayed_bid = None
        if replayed_bid is None:
            decision = PanelDirector.choose_next(panel, state, candidate_text)
            selected = next(item for item in panel if item.id == decision.next_speaker_id)
            state.panelist_question_counts[selected.id] = state.panelist_question_counts.get(selected.id, 0) + 1
    if selected is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Selected logical panelist is unavailable")
    state.current_speaker_id = selected.id
    state.last_question = decision.suggested_question

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
        if tool in (selected.allowed_tools or []) and tool in INTERVIEWER_TOOL_NAMES
    ]
    planned_tool: tuple[str, dict[str, Any], list[dict[str, str]]] | None = None
    if replayed_bid is None:
        planned_tool = await _prepare_live_tool(
            db,
            settings,
            session,
            candidate_text,
            role_tools,
        )
        tool_audits = []
        tool_context = []
    else:
        raw_audits = replayed_bid.result.get("tool_audits", [])
        tool_audits = [item for item in raw_audits if isinstance(item, dict)]
        tool_context = [
            delimit_untrusted(f"tool:{item['name']}", json.dumps(item["result"]))
            for item in tool_audits
            if item.get("status") == "completed" and "name" in item and "result" in item
        ]
    metadata = {
        "session_id": str(session.id),
        "selected_panelist": {
            "id": selected.id,
            "display_name": selected.display_name,
            "role": selected.role,
            "voice": selected.voice,
            "mood": selected.mood,
            "template_knowledge": selected.template_knowledge.model_dump(mode="json"),
            "template_behavior": selected.template_behavior.model_dump(mode="json", exclude_none=True),
            "role_rubric": [item.model_dump(mode="json") for item in selected.role_rubric],
        },
        "director": decision.model_dump(),
        "enabled_tools": role_tools,
        "tool_audits": tool_audits,
        "replayed_candidate_turn": replayed_bid is not None,
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
    panel_bid = replayed_bid
    if replayed_bid is None:
        panel_bid = ToolRun(
            session_id=session.id,
            transcript_turn_id=candidate_turn.id,
            panelist_id=selected.id,
            tool_name="panel.bid",
            arguments={"candidate_turn": candidate_text[-4000:]},
            result=metadata,
            status="completed",
        )
        db.add(panel_bid)
    # Persist the director decision and release the session lock before any
    # network tool, upstream model, or streaming audio wait.
    await db.commit()
    if replayed_bid is None and planned_tool is not None and panel_bid is not None:
        tool_audits, tool_context = await _execute_live_tool(
            db,
            settings,
            session.id,
            candidate_turn.id,
            selected.id,
            planned_tool,
        )
        metadata = {**metadata, "tool_audits": tool_audits}
        panel_bid.result = metadata
        await db.commit()

    template_behavior = selected.template_behavior
    scoring_focus = [criterion.label for criterion in selected.role_rubric]
    if not scoring_focus:
        scoring_focus = selected.template_knowledge.scoring_focus
    role_profile = "\n".join(
        (
            "Validated role profile (bounded by PLATFORM_INVARIANTS):",
            f"- Style: {template_behavior.style or selected.behavior}",
            f"- Interruption policy: {template_behavior.interruption or selected.interruption_style}",
            (
                f"- Adaptive probe: {template_behavior.adaptive_probe}"
                if template_behavior.adaptive_probe
                else "- Adaptive probe: follow the strongest unresolved evidence gap"
            ),
            f"- Scoring focus: {', '.join(scoring_focus) or 'session rubric coverage'}",
            f"- Live interviewer tools: {', '.join(role_tools) or 'none'}",
        )
    )
    selected_instruction = "\n".join(
        value
        for value in (
            compile_agent_prompt(snapshot),
            f"Speak now as {selected.display_name}, the {selected.role}.",
            (
                f"Director action: {decision.action}. Objective: {decision.suggested_question} "
                f"Apply this role's adaptive probe: "
                f"{template_behavior.adaptive_probe or 'follow the strongest unresolved evidence gap'}."
            ),
            role_profile,
            (
                f"<STUDENT_CUSTOMIZATION>\n{selected.custom_prompt}\n</STUDENT_CUSTOMIZATION>"
                if selected.custom_prompt
                else None
            ),
            delimit_untrusted("panelist-knowledge", selected.knowledge_prompt) if selected.knowledge_prompt else None,
            *tool_context,
            PLATFORM_INVARIANTS,
        )
        if value
    )
    # Agora's custom-LLM request allows extension fields. Forwarding that envelope
    # wholesale makes strict OpenAI-compatible providers reject otherwise valid
    # requests, so this boundary deliberately sends a small Groq-safe allowlist.
    upstream_body = {
        "model": settings.llm_model,
        "stream": payload.stream,
        "max_tokens": 384,
        "temperature": 0.7,
        "top_p": 0.95,
        "messages": [
            {"role": "system", "content": selected_instruction},
            *_spoken_messages(payload),
        ],
    }
    upstream_headers = {
        "Authorization": f"Bearer {settings.llm_api_key}",
        "Content-Type": "application/json",
    }
    upstream_url = _upstream_url(settings.llm_base_url)

    requested_voice = selected.voice.strip()
    voice_type = (
        requested_voice
        if requested_voice in _MINIMAX_VOICE_WHITELIST
        else _MINIMAX_VOICE_TYPES.get(requested_voice.lower(), "English_captivating_female1")
    )
    rate = 0.96
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

    if not payload.stream:
        async with httpx.AsyncClient(timeout=45) as client:
            response = await _send_upstream_with_retry(
                client,
                url=upstream_url,
                headers=upstream_headers,
                body=upstream_body,
                stream=False,
            )
        if response is None:
            return _local_completion_response(
                _director_continuation(decision.suggested_question),
                stream=False,
                model=payload.model,
                metadata=metadata,
            )
        try:
            body = response.json()
            if not isinstance(body, dict):
                raise TypeError("completion envelope must be an object")
            choices = body.get("choices")
            if not isinstance(choices, list) or not choices:
                raise TypeError("completion choices are missing")
            message = choices[0].get("message") if isinstance(choices[0], dict) else None
            if not isinstance(message, dict) or not isinstance(message.get("content"), str):
                raise TypeError("completion message content is missing")
        except (TypeError, ValueError) as exc:
            _log_upstream_failure(
                attempt=_MAX_UPSTREAM_ATTEMPTS,
                stream=False,
                transient=True,
                response=response,
                error=exc,
            )
            return _local_completion_response(
                _director_continuation(decision.suggested_question),
                stream=False,
                model=payload.model,
                metadata=metadata,
            )
        body["roundcraft"] = metadata
        return JSONResponse(body)

    client = httpx.AsyncClient(timeout=45)
    try:
        response = await _send_upstream_with_retry(
            client,
            url=upstream_url,
            headers=upstream_headers,
            body=upstream_body,
            stream=True,
        )
    except Exception:
        await client.aclose()
        raise
    if response is None:
        await client.aclose()
        return _local_completion_response(
            _director_continuation(decision.suggested_question),
            stream=True,
            model=payload.model,
            metadata=metadata,
            first_chunk=first_chunk,
        )

    async def stream() -> Any:
        upstream_bytes = bytearray()
        pending_bytes = bytearray()
        content_started = False
        try:
            yield f"data: {json.dumps(first_chunk, separators=(',', ':'))}\n\n".encode()
            try:
                iterator = response.aiter_bytes().__aiter__()
                first_content_deadline = asyncio.get_running_loop().time() + _FIRST_CONTENT_TIMEOUT_SECONDS
                while True:
                    try:
                        if content_started:
                            chunk = await anext(iterator)
                        else:
                            remaining = first_content_deadline - asyncio.get_running_loop().time()
                            if remaining <= 0:
                                raise TimeoutError
                            chunk = await asyncio.wait_for(anext(iterator), timeout=remaining)
                    except StopAsyncIteration:
                        break
                    if not chunk:
                        continue
                    upstream_bytes.extend(chunk)
                    has_content, has_done = _inspect_upstream_stream(bytes(upstream_bytes))
                    if content_started:
                        yield chunk
                        if has_done:
                            break
                        continue
                    pending_bytes.extend(chunk)
                    if has_content:
                        content_started = True
                        yield bytes(pending_bytes)
                        pending_bytes.clear()
                        if has_done:
                            break
                    elif has_done:
                        break
                    elif len(pending_bytes) > _MAX_PRECONTENT_STREAM_BYTES:
                        break
            except TimeoutError:
                logger.warning(
                    json.dumps(
                        {
                            "event": "upstream_llm_first_content_timeout",
                            "stream": True,
                            "timeout_seconds": _FIRST_CONTENT_TIMEOUT_SECONDS,
                            "request_id": _safe_request_id(response),
                        },
                        separators=(",", ":"),
                    )
                )
            except httpx.TransportError as exc:
                _log_upstream_failure(
                    attempt=_MAX_UPSTREAM_ATTEMPTS,
                    stream=True,
                    transient=True,
                    response=response,
                    error=exc,
                )
            has_content, has_done = _inspect_upstream_stream(bytes(upstream_bytes))
            if not has_content:
                for event in _local_stream_events(
                    _director_continuation(decision.suggested_question),
                    payload.model,
                ):
                    yield event
            elif not has_done:
                yield b"\ndata: [DONE]\n\n"
        finally:
            await response.aclose()
            await client.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream")
