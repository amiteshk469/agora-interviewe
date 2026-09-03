import hmac
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, cast
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, File, Header, HTTPException, Request, Response, UploadFile, status
from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from app.core.config import SettingsDep
from app.core.database import Db
from app.core.security import CurrentUser
from app.domain import (
    DEFAULT_PANEL,
    DEFAULT_RUBRIC,
    PanelDirector,
    compile_agent_prompt,
    jd_recommendations,
)
from app.models import (
    AgoraWebhookEvent,
    AssessmentReport,
    EvidenceItem,
    InterviewConfig,
    InterviewSession,
    JobDescription,
    PanelParticipant,
    PromptTemplate,
    ReplayDrill,
    ToolRun,
    TranscriptTurn,
)
from app.role_packs import catalog as role_pack_catalog
from app.role_packs import get_role_pack
from app.schemas import (
    INTERVIEWER_TOOL_NAMES,
    AgoraWebhookOut,
    AssessmentReportOut,
    CodeBufferOut,
    CodeBufferState,
    CodeBufferUpdate,
    ConnectionConfig,
    EvidenceCreate,
    EvidenceOut,
    GuestPanelist,
    GuestSessionOut,
    HostMessageCreate,
    HostMessageOut,
    HostPresenceOut,
    HostState,
    HostTurnRecord,
    InterviewConfigCreate,
    InterviewConfigOut,
    JobDescriptionOut,
    PanelDecision,
    PanelDecisionRequest,
    PanelDispatchOut,
    PanelDispatchRequest,
    PanelInterruptOut,
    PanelInterruptRequest,
    PanelistInput,
    PanelParticipantOut,
    PanelState,
    PromptRubricCriterion,
    PromptTemplateBehavior,
    PromptTemplateCreate,
    PromptTemplateFork,
    PromptTemplateKnowledge,
    PromptTemplateOut,
    ReplayDrillOut,
    RolePackOut,
    RubricCriterion,
    SessionCreate,
    SessionInviteOut,
    SessionOut,
    SessionStartOut,
    SessionStartRequest,
    ToolDefinition,
    ToolRunOut,
    ToolRunRequest,
    TranscriptTurnCreate,
    TranscriptTurnOut,
)
from app.services.agora import AgoraDep
from app.services.agora_events import map_agora_event, reconcile_agora_history
from app.services.assessment import (
    AssessmentServiceUnavailable,
    build_assessment,
    build_replay_drills,
)
from app.services.documents import (
    SUPPORTED_DOCUMENT_TYPES,
    StorageDep,
    extract_document,
)
from app.services.evidence import (
    lock_transcript_session,
    normalize_transcript_content,
    persist_candidate_turn,
    persist_inferred_evidence,
)
from app.services.host_invite import (
    DEFAULT_INVITE_TTL_SECONDS,
    InviteError,
    invite_secret,
    mint_invite,
    read_invite,
)
from app.services.tools import DEFINITIONS, execute_tool

router = APIRouter(prefix="/v1")


async def _owned(db: Db, model: Any, object_id: UUID, user_id: UUID) -> Any:
    result = await db.execute(select(model).where(model.id == object_id, model.user_id == user_id))
    value = result.scalar_one_or_none()
    if value is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return value


def _default_role_tools(member: PanelistInput) -> list[str]:
    descriptor = " ".join((member.role, *member.expertise)).lower()
    tools = ["knowledge_search"]
    if any(cue in descriptor for cue in ("analytic", "metric", "growth", "technical", "estimat")):
        tools.append("calculator")
    if any(cue in descriptor for cue in ("product", "market", "growth", "technical", "strategy")):
        tools.append("web_search")
    return tools


def _focus_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


@router.get("/prompt-templates", response_model=list[PromptTemplateOut], tags=["Prompts"])
async def list_prompt_templates(db: Db, user: CurrentUser) -> list[PromptTemplate]:
    result = await db.execute(
        select(PromptTemplate)
        .where(
            PromptTemplate.is_active.is_(True),
            or_(PromptTemplate.is_builtin.is_(True), PromptTemplate.owner_id == user.id),
        )
        .order_by(PromptTemplate.role, PromptTemplate.name, PromptTemplate.version.desc())
    )
    return list(result.scalars())


@router.post(
    "/prompt-templates",
    response_model=PromptTemplateOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Prompts"],
)
async def create_prompt_template(payload: PromptTemplateCreate, db: Db, user: CurrentUser) -> PromptTemplate:
    template = PromptTemplate(
        owner_id=user.id,
        version=1,
        is_builtin=False,
        **payload.model_dump(mode="json", exclude_none=True),
    )
    db.add(template)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A prompt with this slug already exists. Create a revision from the existing prompt instead.",
        ) from exc
    return template


@router.post(
    "/prompt-templates/{template_id}/fork",
    response_model=PromptTemplateOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Prompts"],
)
async def fork_prompt_template(
    template_id: UUID,
    payload: PromptTemplateFork,
    db: Db,
    user: CurrentUser,
) -> PromptTemplate:
    result = await db.execute(
        select(PromptTemplate).where(
            PromptTemplate.id == template_id,
            PromptTemplate.is_active.is_(True),
            or_(PromptTemplate.is_builtin.is_(True), PromptTemplate.owner_id == user.id),
        )
    )
    source = result.scalar_one_or_none()
    if source is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prompt template not found")
    try:
        source_knowledge = PromptTemplateKnowledge.model_validate(source.knowledge)
        source_behavior = PromptTemplateBehavior.model_validate(source.behavior)
    except ValidationError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Source prompt template metadata is invalid",
        ) from exc
    values = {
        "slug": payload.slug or source.slug,
        "name": payload.name or source.name,
        "role": source.role,
        "description": payload.description if payload.description is not None else source.description,
        "prompt": payload.prompt or source.prompt,
        "knowledge": (payload.knowledge if payload.knowledge is not None else source_knowledge).model_dump(
            mode="json", exclude_none=True
        ),
        "behavior": (payload.behavior if payload.behavior is not None else source_behavior).model_dump(
            mode="json", exclude_none=True
        ),
    }
    max_version = await db.scalar(
        select(func.max(PromptTemplate.version)).where(
            PromptTemplate.owner_id == user.id, PromptTemplate.slug == values["slug"]
        )
    )
    template = PromptTemplate(
        owner_id=user.id,
        parent_id=source.id,
        version=(max_version or 0) + 1,
        is_builtin=False,
        **values,
    )
    db.add(template)
    try:
        await db.flush()
    except IntegrityError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This prompt changed while the revision was being created. Reload and try again.",
        ) from exc
    return template


@router.post(
    "/job-descriptions",
    response_model=JobDescriptionOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Job descriptions"],
)
async def upload_job_description(
    db: Db,
    user: CurrentUser,
    storage: StorageDep,
    settings: SettingsDep,
    file: Annotated[UploadFile, File()],
) -> JobDescription:
    filename = Path(file.filename or "job-description.txt").name
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in SUPPORTED_DOCUMENT_TYPES and Path(filename).suffix.lower() not in {
        ".pdf",
        ".docx",
        ".txt",
        ".md",
    }:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Use PDF, DOCX, TXT, or Markdown")
    data = await file.read(settings.jd_max_upload_bytes + 1)
    if len(data) > settings.jd_max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Job description is too large")
    text = await extract_document(data, mime_type, filename)
    document_id = uuid4()
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "-", filename)[:160]
    storage_path = f"{user.id}/job-descriptions/{document_id}/{safe_name}"
    await storage.upload(settings.supabase_documents_bucket, storage_path, data, mime_type)
    recommendations = jd_recommendations(text)
    document = JobDescription(
        id=document_id,
        user_id=user.id,
        original_filename=filename,
        storage_path=storage_path,
        mime_type=mime_type,
        size_bytes=len(data),
        status="ready",
        raw_text=text,
        extracted={
            "character_count": len(text),
            "word_count": len(text.split()),
            "role_title": recommendations["role_title"],
        },
        recommendations=recommendations,
    )
    db.add(document)
    await db.flush()
    return document


@router.get(
    "/job-descriptions",
    response_model=list[JobDescriptionOut],
    tags=["Job descriptions"],
)
async def list_job_descriptions(db: Db, user: CurrentUser) -> list[JobDescription]:
    result = await db.execute(
        select(JobDescription).where(JobDescription.user_id == user.id).order_by(JobDescription.created_at.desc())
    )
    return list(result.scalars())


@router.get(
    "/job-descriptions/{document_id}",
    response_model=JobDescriptionOut,
    tags=["Job descriptions"],
)
async def get_job_description(document_id: UUID, db: Db, user: CurrentUser) -> JobDescription:
    return cast(JobDescription, await _owned(db, JobDescription, document_id, user.id))


@router.post(
    "/job-descriptions/{document_id}/recommendations",
    response_model=JobDescriptionOut,
    tags=["Job descriptions"],
)
async def refresh_job_recommendations(document_id: UUID, db: Db, user: CurrentUser) -> JobDescription:
    document = cast(JobDescription, await _owned(db, JobDescription, document_id, user.id))
    document.recommendations = jd_recommendations(document.raw_text)
    document.extracted = {
        **document.extracted,
        "role_title": document.recommendations["role_title"],
    }
    await db.flush()
    return document


async def _resolve_panel(
    db: Db,
    user_id: UUID,
    panel: list[PanelistInput],
    enabled_tools: list[str],
    rubric: list[RubricCriterion],
) -> list[dict[str, Any]]:
    resolved: list[dict[str, Any]] = []
    for member in panel:
        values = member.model_dump(mode="json")
        template_knowledge = PromptTemplateKnowledge()
        template_behavior = PromptTemplateBehavior()
        values["prompt_template_version"] = None
        values["template_knowledge"] = template_knowledge.model_dump(mode="json")
        values["template_behavior"] = template_behavior.model_dump(mode="json", exclude_none=True)
        values["role_rubric"] = []
        if member.prompt_template_id is not None:
            result = await db.execute(
                select(PromptTemplate).where(
                    PromptTemplate.id == member.prompt_template_id,
                    PromptTemplate.is_active.is_(True),
                    or_(
                        PromptTemplate.is_builtin.is_(True),
                        PromptTemplate.owner_id == user_id,
                    ),
                )
            )
            template = result.scalar_one_or_none()
            if template is None:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Prompt template not found")
            try:
                template_knowledge = PromptTemplateKnowledge.model_validate(template.knowledge)
                template_behavior = PromptTemplateBehavior.model_validate(template.behavior)
            except ValidationError as exc:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    "Prompt template metadata is invalid",
                ) from exc
            values["custom_prompt"] = member.custom_prompt or template.prompt
            values["prompt_template_version"] = template.version
            values["template_knowledge"] = template_knowledge.model_dump(mode="json")
            values["template_behavior"] = template_behavior.model_dump(mode="json", exclude_none=True)
            values["expertise"] = list(dict.fromkeys([*member.expertise, *template_knowledge.domains]))[:12]
            values["mood"] = template_behavior.mood or member.mood
            values["behavior"] = template_behavior.style or member.behavior
            values["interruption_style"] = template_behavior.interruption or member.interruption_style
            if template_knowledge.rubric:
                values["role_rubric"] = [criterion.model_dump(mode="json") for criterion in template_knowledge.rubric]
            else:
                focus_keys = {_focus_key(item) for item in template_knowledge.scoring_focus}
                values["role_rubric"] = [
                    PromptRubricCriterion(
                        key=criterion.key,
                        label=criterion.label,
                        evidence=criterion.description or f"Evidence for {criterion.label}",
                    ).model_dump(mode="json")
                    for criterion in rubric
                    if criterion.key in focus_keys or _focus_key(criterion.label) in focus_keys
                ]
        requested_tools = (
            member.allowed_tools
            if member.allowed_tools is not None
            else template_behavior.allowed_tools or _default_role_tools(member)
        )
        unknown_tools = sorted(set(requested_tools) - INTERVIEWER_TOOL_NAMES)
        if unknown_tools:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"Unsupported panelist tools: {', '.join(unknown_tools)}",
            )
        values["allowed_tools"] = [
            tool for tool in enabled_tools if tool in requested_tools and tool in INTERVIEWER_TOOL_NAMES
        ]
        try:
            resolved.append(PanelistInput.model_validate(values).model_dump(mode="json"))
        except ValidationError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Resolved prompt template configuration is invalid",
            ) from exc
    return resolved


@router.post(
    "/interview-configs",
    response_model=InterviewConfigOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Interview setup"],
)
async def create_interview_config(payload: InterviewConfigCreate, db: Db, user: CurrentUser) -> InterviewConfig:
    recommendations: dict[str, Any] = {}
    if payload.job_description_id is not None:
        document = await _owned(db, JobDescription, payload.job_description_id, user.id)
        recommendations = document.recommendations
    # The role pack supplies the interview's shape. A JD recommendation still
    # wins over it, and anything the candidate edited wins over both.
    pack = get_role_pack(payload.profession)
    panel_models = payload.panel or [
        PanelistInput.model_validate(item)
        for item in recommendations.get("panel", pack.panel or DEFAULT_PANEL)
    ]
    if not 2 <= len(panel_models) <= 5:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "Panel must contain 2 to 5 interviewers",
        )
    rubric_models = payload.rubric or [
        RubricCriterion.model_validate(item)
        for item in recommendations.get("rubric", pack.rubric or DEFAULT_RUBRIC)
    ]
    enabled_tools = payload.enabled_tools if payload.enabled_tools is not None else list(pack.enabled_tools)
    unknown_tools = sorted(set(enabled_tools) - INTERVIEWER_TOOL_NAMES)
    if unknown_tools:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Unsupported tools: {', '.join(unknown_tools)}",
        )
    config = InterviewConfig(
        user_id=user.id,
        job_description_id=payload.job_description_id,
        title=payload.title,
        profession=payload.profession,
        difficulty=(
            payload.difficulty.value
            if payload.difficulty is not None
            else str(recommendations.get("difficulty", "balanced"))
        ),
        duration_minutes=payload.duration_minutes,
        panel=await _resolve_panel(
            db,
            user.id,
            panel_models,
            enabled_tools,
            rubric_models,
        ),
        rubric=[item.model_dump() for item in rubric_models],
        enabled_tools=enabled_tools,
        status="ready",
    )
    db.add(config)
    await db.flush()
    return config


@router.get(
    "/interview-configs",
    response_model=list[InterviewConfigOut],
    tags=["Interview setup"],
)
async def list_interview_configs(db: Db, user: CurrentUser) -> list[InterviewConfig]:
    result = await db.execute(
        select(InterviewConfig).where(InterviewConfig.user_id == user.id).order_by(InterviewConfig.created_at.desc())
    )
    return list(result.scalars())


@router.get(
    "/interview-configs/{config_id}",
    response_model=InterviewConfigOut,
    tags=["Interview setup"],
)
async def get_interview_config(config_id: UUID, db: Db, user: CurrentUser) -> InterviewConfig:
    return cast(InterviewConfig, await _owned(db, InterviewConfig, config_id, user.id))


@router.post(
    "/sessions",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Interview sessions"],
)
async def create_session(payload: SessionCreate, db: Db, user: CurrentUser) -> InterviewSession:
    config = await _owned(db, InterviewConfig, payload.interview_config_id, user.id)
    job_context: dict[str, Any] | None = None
    if config.job_description_id is not None:
        document = await _owned(db, JobDescription, config.job_description_id, user.id)
        job_context = {
            "id": str(document.id),
            "extracted": document.extracted,
            "recommendations": document.recommendations,
        }
    snapshot = {
        "config_id": str(config.id),
        "title": config.title,
        "profession": config.profession,
        "difficulty": config.difficulty,
        "duration_minutes": config.duration_minutes,
        "panel": config.panel,
        "rubric": config.rubric,
        "enabled_tools": config.enabled_tools,
        "job_description": job_context,
    }
    session = InterviewSession(
        user_id=user.id,
        interview_config_id=config.id,
        status="configured",
        config_snapshot=snapshot,
        memory_state=PanelState().model_dump(),
    )
    db.add(session)
    await db.flush()
    return session


@router.get(
    "/sessions",
    response_model=list[SessionOut],
    tags=["Interview sessions"],
)
async def list_sessions(db: Db, user: CurrentUser) -> list[InterviewSession]:
    result = await db.execute(
        select(InterviewSession).where(InterviewSession.user_id == user.id).order_by(InterviewSession.created_at.desc())
    )
    return list(result.scalars())


@router.post(
    "/sessions/{session_id}/start",
    response_model=SessionStartOut,
    tags=["Interview sessions"],
)
async def start_session(
    session_id: UUID,
    payload: SessionStartRequest,
    db: Db,
    user: CurrentUser,
    agora: AgoraDep,
) -> SessionStartOut:
    claimed = await db.scalar(
        update(InterviewSession)
        .where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == user.id,
            InterviewSession.status == "configured",
        )
        .values(status="starting")
        .returning(InterviewSession.id)
    )
    if claimed is None:
        existing = await db.scalar(
            select(InterviewSession.id).where(
                InterviewSession.id == session_id,
                InterviewSession.user_id == user.id,
            )
        )
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a configured session can start")
    await db.commit()
    session = await db.get(InterviewSession, claimed)
    if session is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Session claim was lost")
    started_results: list[dict[str, Any]] = []
    try:
        plan = agora.generate_panel_connection(session.config_snapshot["panel"])
        connection = plan["connection"]
        participants = [
            PanelParticipant(
                session_id=session.id,
                status="starting",
                **item,
            )
            for item in plan["participants"]
        ]
        db.add_all(participants)
        session.channel_name = connection["channel_name"]
        session.user_uid = int(connection["uid"])
        session.agent_uid = int(connection["agent_uid"])
        await db.commit()
        started_results = await agora.start_panel(
            channel_name=connection["channel_name"],
            user_uid=int(connection["uid"]),
            participants=plan["participants"],
            panel=session.config_snapshot["panel"],
            output_audio_codec=payload.output_audio_codec,
            instructions=compile_agent_prompt(session.config_snapshot),
            roundcraft_session_id=str(session.id),
        )
        if not started_results:
            raise RuntimeError("Agora did not return the shared panel agent")
        shared_agent_id = str(started_results[0]["agent_id"])
        for index, participant in enumerate(participants):
            # The database keeps one canonical physical-agent mapping while every row
            # remains a selectable logical interviewer in the shared panel session.
            participant.agora_agent_id = shared_agent_id if index == 0 else None
            participant.status = "running"
        session.status = "live"
        session.agora_agent_id = shared_agent_id
        session.started_at = datetime.now(UTC)
        await db.commit()
    except Exception:
        await db.rollback()
        if started_results:
            try:
                await agora.stop_panel(list(dict.fromkeys(str(item["agent_id"]) for item in started_results)))
            except Exception:
                pass
        failed = await db.get(InterviewSession, session_id)
        if failed is not None:
            failed.status = "failed"
            failed_participants = list(
                (await db.execute(select(PanelParticipant).where(PanelParticipant.session_id == session_id))).scalars()
            )
            for participant in failed_participants:
                participant.status = "failed"
            await db.commit()
        raise
    return SessionStartOut(
        session=SessionOut.model_validate(session),
        connection=ConnectionConfig.model_validate(connection),
    )


@router.get("/sessions/{session_id}", response_model=SessionOut, tags=["Interview sessions"])
async def get_session(session_id: UUID, db: Db, user: CurrentUser) -> InterviewSession:
    return cast(InterviewSession, await _owned(db, InterviewSession, session_id, user.id))


@router.post(
    "/sessions/{session_id}/token",
    response_model=ConnectionConfig,
    tags=["Interview sessions"],
)
async def renew_session_token(
    session_id: UUID,
    db: Db,
    user: CurrentUser,
    agora: AgoraDep,
) -> ConnectionConfig:
    session = await _owned(db, InterviewSession, session_id, user.id)
    if session.status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a live session can renew its token")
    if session.channel_name is None or session.user_uid is None or session.agent_uid is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Live session connection is incomplete")
    connection = agora.generate_connection(
        channel=session.channel_name,
        uid=session.user_uid,
        agent_uid=session.agent_uid,
    )
    participants = list(
        (
            await db.execute(
                select(PanelParticipant)
                .where(PanelParticipant.session_id == session_id)
                .order_by(PanelParticipant.created_at)
            )
        ).scalars()
    )
    connection["panelists"] = [
        {
            "panelist_id": item.panelist_id,
            "agent_uid": str(item.agent_uid),
            "avatar_uid": str(item.avatar_uid),
            "video_mode": item.video_mode,
        }
        for item in participants
    ]
    return ConnectionConfig.model_validate(connection)


@router.get(
    "/sessions/{session_id}/participants",
    response_model=list[PanelParticipantOut],
    tags=["Interview sessions"],
)
async def list_panel_participants(session_id: UUID, db: Db, user: CurrentUser) -> list[PanelParticipant]:
    await _owned(db, InterviewSession, session_id, user.id)
    result = await db.execute(
        select(PanelParticipant).where(PanelParticipant.session_id == session_id).order_by(PanelParticipant.created_at)
    )
    return list(result.scalars())


@router.post(
    "/sessions/{session_id}/panel/dispatch",
    response_model=PanelDispatchOut,
    tags=["Panel director"],
)
async def dispatch_panel_turn(
    session_id: UUID,
    payload: PanelDispatchRequest,
    db: Db,
    user: CurrentUser,
    agora: AgoraDep,
) -> PanelDispatchOut:
    session = await _owned(db, InterviewSession, session_id, user.id)
    if session.status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a live panel can dispatch a turn")
    panel = [PanelistInput.model_validate(item) for item in session.config_snapshot["panel"]]
    state = PanelState.model_validate(session.memory_state)
    if payload.force_panelist_id:
        selected = next(
            (item for item in panel if item.id == payload.force_panelist_id),
            None,
        )
        if selected is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Panelist not found")
        decision = PanelDecision(
            next_speaker_id=selected.id,
            action="ask",
            rationale="Explicit panel floor selection for this turn.",
            suggested_question="Continue with an adaptive follow-up grounded in the candidate response.",
        )
    else:
        decision = PanelDirector.choose_next(panel, state, payload.candidate_text)
    participant = await db.scalar(
        select(PanelParticipant).where(
            PanelParticipant.session_id == session_id,
            PanelParticipant.panelist_id == decision.next_speaker_id,
            PanelParticipant.status == "running",
        )
    )
    if participant is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Selected logical panelist is not running")
    shared_agent_id = session.agora_agent_id or participant.agora_agent_id
    if shared_agent_id is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Shared Agora panel agent is not running")
    candidate_turn = await persist_candidate_turn(
        db,
        session,
        payload.candidate_text,
        source="panel-dispatch",
    )
    await persist_inferred_evidence(db, session, candidate_turn)
    state.current_speaker_id = decision.next_speaker_id
    state.pending_panelist_id = decision.next_speaker_id
    state.pending_candidate_turn_id = str(candidate_turn.id)
    state.panelist_question_counts[decision.next_speaker_id] = (
        state.panelist_question_counts.get(decision.next_speaker_id, 0) + 1
    )
    state.last_question = decision.suggested_question
    session.memory_state = state.model_dump()
    other_agent_ids = list(
        dict.fromkeys(
            str(agent_id)
            for agent_id in (
                await db.execute(
                    select(PanelParticipant.agora_agent_id).where(
                        PanelParticipant.session_id == session_id,
                        PanelParticipant.status == "running",
                        PanelParticipant.panelist_id != decision.next_speaker_id,
                        PanelParticipant.agora_agent_id.is_not(None),
                    )
                )
            ).scalars()
            if agent_id and str(agent_id) != shared_agent_id
        )
    )
    db.add(
        ToolRun(
            session_id=session_id,
            transcript_turn_id=candidate_turn.id,
            panelist_id=participant.panelist_id,
            tool_name="panel.dispatch",
            arguments={"candidate_turn": payload.candidate_text[-4000:]},
            result={"decision": decision.model_dump(), "agent_id": shared_agent_id},
            status="completed",
        )
    )
    await db.commit()
    if other_agent_ids:
        await agora.interrupt_panel(other_agent_ids)
    dispatch_mode = await agora.dispatch_turn(
        shared_agent_id,
        payload.candidate_text,
        participant.panelist_id,
        channel_name=session.channel_name,
        agent_uid=session.agent_uid or participant.agent_uid,
    )
    return PanelDispatchOut.model_validate(
        {
            "decision": decision,
            "participant": participant,
            "manual_turn": {
                "agent_user_id": str(session.agent_uid or participant.agent_uid),
                "server_dispatch": dispatch_mode,
            },
        }
    )


@router.post(
    "/sessions/{session_id}/interrupt",
    response_model=PanelInterruptOut,
    tags=["Panel director"],
)
async def interrupt_panel(
    session_id: UUID,
    payload: PanelInterruptRequest,
    db: Db,
    user: CurrentUser,
    agora: AgoraDep,
) -> PanelInterruptOut:
    session = await _owned(db, InterviewSession, session_id, user.id)
    if session.status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a live panel can be interrupted")
    current = PanelState.model_validate(session.memory_state).current_speaker_id
    target_panelist = payload.panelist_id or current
    query = select(PanelParticipant).where(
        PanelParticipant.session_id == session_id,
        PanelParticipant.status == "running",
    )
    if target_panelist:
        query = query.where(PanelParticipant.panelist_id == target_panelist)
    participants = list((await db.execute(query)).scalars())
    if not participants:
        raise HTTPException(status.HTTP_409_CONFLICT, "No running logical panelist to interrupt")
    agent_ids = list(
        dict.fromkeys(
            str(agent_id)
            for agent_id in (
                session.agora_agent_id,
                *(item.agora_agent_id for item in participants),
            )
            if agent_id
        )
    )
    if not agent_ids:
        raise HTTPException(status.HTTP_409_CONFLICT, "Shared Agora panel agent is not running")
    await agora.interrupt_panel(agent_ids)
    db.add(
        ToolRun(
            session_id=session_id,
            panelist_id=target_panelist,
            tool_name="panel.interrupt",
            arguments={"reason": payload.reason},
            result={"panelist_ids": [item.panelist_id for item in participants]},
            status="completed",
        )
    )
    await db.flush()
    return PanelInterruptOut(interrupted_panelist_ids=[item.panelist_id for item in participants])


@router.post("/sessions/{session_id}/end", response_model=SessionOut, tags=["Interview sessions"])
async def end_session(session_id: UUID, db: Db, user: CurrentUser, agora: AgoraDep) -> InterviewSession:
    claimed = await db.scalar(
        update(InterviewSession)
        .where(
            InterviewSession.id == session_id,
            InterviewSession.user_id == user.id,
            InterviewSession.status == "live",
        )
        .values(status="ending")
        .returning(InterviewSession.id)
    )
    if claimed is None:
        existing = await db.scalar(
            select(InterviewSession).where(
                InterviewSession.id == session_id,
                InterviewSession.user_id == user.id,
            )
        )
        if existing is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
        if existing.status == "ended":
            return existing
        raise HTTPException(status.HTTP_409_CONFLICT, "Only a live session can end")
    await db.commit()
    session = await db.get(InterviewSession, claimed)
    if session is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Session end claim was lost")
    agent_stopped = False
    try:
        participants = list(
            (await db.execute(select(PanelParticipant).where(PanelParticipant.session_id == session_id))).scalars()
        )
        agent_ids = list(
            dict.fromkeys(
                str(agent_id)
                for agent_id in (
                    session.agora_agent_id,
                    *(participant.agora_agent_id for participant in participants),
                )
                if agent_id
            )
        )
        for participant in participants:
            participant.status = "stopping"
        await db.commit()
        if agent_ids:
            await agora.stop_panel(agent_ids)
        elif session.agora_agent_id:
            await agora.stop(session.agora_agent_id)
        agent_stopped = True
        for participant in participants:
            participant.status = "stopped"
        session.status = "ended"
        session.ended_at = datetime.now(UTC)
        await db.commit()
    except Exception:
        await db.rollback()
        failed_end = await db.get(InterviewSession, session_id)
        if failed_end is not None and failed_end.status == "ending":
            failed_end.status = "failed" if agent_stopped else "live"
            if agent_stopped:
                failed_end.ended_at = datetime.now(UTC)
            failed_participants = list(
                (await db.execute(select(PanelParticipant).where(PanelParticipant.session_id == session_id))).scalars()
            )
            for participant in failed_participants:
                participant.status = "failed" if agent_stopped else "running"
            await db.commit()
        raise
    return session


@router.post(
    "/sessions/{session_id}/turns",
    response_model=TranscriptTurnOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Transcript and evidence"],
)
async def append_transcript_turn(
    session_id: UUID,
    payload: TranscriptTurnCreate,
    db: Db,
    user: CurrentUser,
) -> TranscriptTurn:
    session = await _owned(db, InterviewSession, session_id, user.id)
    # All transcript sources lock the parent first. This keeps the FK and sequence
    # lock order consistent with the custom LLM and Agora webhook writers.
    await lock_transcript_session(db, session_id)
    if payload.agora_turn_id:
        prior = await db.scalar(
            select(TranscriptTurn).where(
                TranscriptTurn.session_id == session_id,
                TranscriptTurn.agora_turn_id == payload.agora_turn_id,
            )
        )
        if prior is not None:
            if prior.speaker_type == "candidate" and payload.speaker_type == "candidate":
                normalized_content = normalize_transcript_content(payload.content)
                if len(normalized_content) > len(normalize_transcript_content(prior.content)):
                    prior.content = normalized_content
                prior.interrupted = payload.interrupted
                prior.confidence = payload.confidence
                prior.started_at = payload.started_at
                prior.ended_at = payload.ended_at
                prior.turn_metadata = {
                    **prior.turn_metadata,
                    **payload.metadata,
                    "stable_turn_updated": True,
                }
                await persist_inferred_evidence(db, session, prior)
            return prior
        if payload.speaker_type == "candidate":
            synthetic = await db.scalar(
                select(TranscriptTurn)
                .where(
                    TranscriptTurn.session_id == session_id,
                )
                .order_by(TranscriptTurn.sequence.desc())
                .limit(1)
            )
            if (
                synthetic is not None
                and synthetic.speaker_type == "candidate"
                and synthetic.agora_turn_id is None
                and normalize_transcript_content(synthetic.content) == normalize_transcript_content(payload.content)
            ):
                synthetic.agora_turn_id = payload.agora_turn_id
                synthetic.interrupted = payload.interrupted
                synthetic.confidence = payload.confidence
                synthetic.started_at = payload.started_at
                synthetic.ended_at = payload.ended_at
                synthetic.turn_metadata = {
                    **synthetic.turn_metadata,
                    **payload.metadata,
                    "reconciled_source": "agora-rtm",
                }
                await persist_inferred_evidence(db, session, synthetic)
                await db.flush()
                return synthetic
    exists = await db.scalar(
        select(TranscriptTurn.id).where(
            TranscriptTurn.session_id == session_id,
            TranscriptTurn.sequence == payload.sequence,
        )
    )
    if exists:
        if not payload.agora_turn_id:
            raise HTTPException(status.HTTP_409_CONFLICT, "Transcript sequence already exists")
        max_sequence = await db.scalar(
            select(func.max(TranscriptTurn.sequence)).where(TranscriptTurn.session_id == session_id)
        )
        sequence = (max_sequence or 0) + 1
    else:
        sequence = payload.sequence
    values = payload.model_dump(exclude={"metadata"})
    values["sequence"] = sequence
    turn = TranscriptTurn(
        session_id=session_id,
        turn_metadata=payload.metadata,
        **values,
    )
    db.add(turn)
    await db.flush()
    if turn.speaker_type == "candidate":
        await persist_inferred_evidence(db, session, turn)
    return turn


@router.get(
    "/sessions/{session_id}/turns",
    response_model=list[TranscriptTurnOut],
    tags=["Transcript and evidence"],
)
async def list_transcript_turns(session_id: UUID, db: Db, user: CurrentUser) -> list[TranscriptTurn]:
    await _owned(db, InterviewSession, session_id, user.id)
    result = await db.execute(
        select(TranscriptTurn).where(TranscriptTurn.session_id == session_id).order_by(TranscriptTurn.sequence)
    )
    return list(result.scalars())


@router.post(
    "/sessions/{session_id}/evidence",
    response_model=EvidenceOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Transcript and evidence"],
)
async def bookmark_evidence(session_id: UUID, payload: EvidenceCreate, db: Db, user: CurrentUser) -> EvidenceItem:
    session = await _owned(db, InterviewSession, session_id, user.id)
    turn = await db.scalar(
        select(TranscriptTurn).where(
            TranscriptTurn.id == payload.transcript_turn_id,
            TranscriptTurn.session_id == session_id,
        )
    )
    if turn is None or turn.speaker_type != "candidate":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Transcript turn not found")
    rubric_keys = {str(item["key"]) for item in session.config_snapshot["rubric"]}
    if payload.competency not in rubric_keys:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown rubric competency")
    existing = await db.scalar(
        select(EvidenceItem).where(
            EvidenceItem.session_id == session_id,
            EvidenceItem.transcript_turn_id == payload.transcript_turn_id,
            EvidenceItem.competency == payload.competency,
        )
    )
    if existing is not None:
        return existing
    item = EvidenceItem(session_id=session_id, **payload.model_dump())
    db.add(item)
    await db.flush()
    return item


@router.get(
    "/sessions/{session_id}/evidence",
    response_model=list[EvidenceOut],
    tags=["Transcript and evidence"],
)
async def list_evidence(session_id: UUID, db: Db, user: CurrentUser) -> list[EvidenceItem]:
    await _owned(db, InterviewSession, session_id, user.id)
    result = await db.execute(
        select(EvidenceItem).where(EvidenceItem.session_id == session_id).order_by(EvidenceItem.created_at)
    )
    return list(result.scalars())


@router.post(
    "/sessions/{session_id}/panel/next",
    response_model=PanelDecision,
    tags=["Panel director"],
)
async def choose_next_panelist(
    session_id: UUID,
    payload: PanelDecisionRequest,
    db: Db,
    user: CurrentUser,
) -> PanelDecision:
    session = await _owned(db, InterviewSession, session_id, user.id)
    state = PanelState.model_validate(session.memory_state)
    panel = [PanelistInput.model_validate(member) for member in session.config_snapshot["panel"]]
    decision = PanelDirector.choose_next(panel, state, payload.last_candidate_turn)
    state.current_speaker_id = decision.next_speaker_id
    state.panelist_question_counts[decision.next_speaker_id] = (
        state.panelist_question_counts.get(decision.next_speaker_id, 0) + 1
    )
    state.last_question = decision.suggested_question
    session.memory_state = state.model_dump()
    await db.flush()
    return decision


@router.get("/tools", response_model=list[ToolDefinition], tags=["Tools"])
async def list_tools(user: CurrentUser) -> list[ToolDefinition]:
    del user
    return [item for item in DEFINITIONS if item.name in INTERVIEWER_TOOL_NAMES]


@router.post(
    "/sessions/{session_id}/tools/{tool_name}",
    response_model=ToolRunOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Tools"],
)
async def run_tool(
    session_id: UUID,
    tool_name: str,
    payload: ToolRunRequest,
    db: Db,
    user: CurrentUser,
    settings: SettingsDep,
) -> ToolRun:
    session = await _owned(db, InterviewSession, session_id, user.id)
    if tool_name not in session.config_snapshot["enabled_tools"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tool is not enabled for this interview")
    panelist_id = payload.panelist_id or PanelState.model_validate(session.memory_state).current_speaker_id
    panelist = next(
        (member for member in session.config_snapshot["panel"] if member["id"] == panelist_id),
        None,
    )
    if panelist is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "A valid panelist_id or active panel speaker is required",
        )
    if tool_name not in panelist.get("allowed_tools", []):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tool is not enabled for this panelist")

    linked_turn: TranscriptTurn | None = None
    if payload.transcript_turn_id is not None:
        linked_turn = await db.scalar(
            select(TranscriptTurn).where(
                TranscriptTurn.id == payload.transcript_turn_id,
                TranscriptTurn.session_id == session_id,
            )
        )
        if linked_turn is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Transcript turn not found")
    turns_result = await db.execute(select(TranscriptTurn).where(TranscriptTurn.session_id == session_id))
    turns = list(turns_result.scalars())
    corpus = [{"source": f"transcript:{turn.id}", "text": turn.content} for turn in turns]
    config = await _owned(db, InterviewConfig, session.interview_config_id, user.id)
    if config.job_description_id:
        document = await _owned(db, JobDescription, config.job_description_id, user.id)
        corpus.append({"source": f"job-description:{document.id}", "text": document.raw_text})
    result: dict[str, Any]
    try:
        if tool_name == "evidence_bookmark":
            if linked_turn is None or linked_turn.speaker_type != "candidate":
                raise ValueError("evidence_bookmark requires a candidate transcript turn")
            competency = str(payload.arguments.get("competency", ""))
            rubric_keys = {str(item["key"]) for item in session.config_snapshot["rubric"]}
            if competency not in rubric_keys:
                raise ValueError("competency must match this interview's rubric")
            evidence = await db.scalar(
                select(EvidenceItem).where(
                    EvidenceItem.session_id == session_id,
                    EvidenceItem.transcript_turn_id == linked_turn.id,
                    EvidenceItem.competency == competency,
                )
            )
            if evidence is None:
                strength = str(payload.arguments.get("strength", "supports"))
                if strength not in {"supports", "contradicts", "neutral"}:
                    raise ValueError("strength must be supports, contradicts, or neutral")
                evidence = EvidenceItem(
                    session_id=session_id,
                    transcript_turn_id=linked_turn.id,
                    competency=competency,
                    note=str(payload.arguments.get("note", ""))[:2000],
                    strength=strength,
                )
                db.add(evidence)
                await db.flush()
            result = {
                "evidence_id": str(evidence.id),
                "transcript_turn_id": str(linked_turn.id),
            }
        elif tool_name == "replay":
            competency = str(payload.arguments.get("competency", ""))
            rubric = {str(item["key"]): str(item["label"]) for item in session.config_snapshot["rubric"]}
            if competency not in rubric:
                raise ValueError("competency must match this interview's rubric")
            source_turn_ids = payload.arguments.get("source_turn_ids") or (
                [str(linked_turn.id)] if linked_turn is not None else []
            )
            if not isinstance(source_turn_ids, list):
                raise ValueError("source_turn_ids must be a list")
            source_ids = [UUID(str(value)) for value in source_turn_ids[:10]]
            if source_ids:
                valid_sources = set(
                    (
                        await db.execute(
                            select(TranscriptTurn.id).where(
                                TranscriptTurn.session_id == session_id,
                                TranscriptTurn.id.in_(source_ids),
                                TranscriptTurn.speaker_type == "candidate",
                            )
                        )
                    ).scalars()
                )
                if valid_sources != set(source_ids):
                    raise ValueError("replay sources must be candidate turns in this session")
            drill = ReplayDrill(
                session_id=session_id,
                competency=competency,
                prompt=str(
                    payload.arguments.get("prompt")
                    or (f"Replay {rubric[competency]} with a specific example, tradeoff, and measurable outcome.")
                )[:20_000],
                source_turn_ids=[str(value) for value in source_ids],
            )
            db.add(drill)
            await db.flush()
            result = {
                "replay_drill_id": str(drill.id),
                "source_turn_ids": drill.source_turn_ids,
            }
        else:
            result = await execute_tool(tool_name, payload.arguments, corpus, settings)
    except HTTPException:
        raise
    except (ValueError, TypeError, httpx.HTTPError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    run = ToolRun(
        session_id=session_id,
        transcript_turn_id=payload.transcript_turn_id,
        panelist_id=panelist_id,
        tool_name=tool_name,
        arguments=payload.arguments,
        result=result,
        status="completed",
    )
    db.add(run)
    await db.flush()
    return run


@router.get(
    "/sessions/{session_id}/tool-runs",
    response_model=list[ToolRunOut],
    tags=["Tools"],
)
async def list_tool_runs(session_id: UUID, db: Db, user: CurrentUser) -> list[ToolRun]:
    await _owned(db, InterviewSession, session_id, user.id)
    result = await db.execute(select(ToolRun).where(ToolRun.session_id == session_id).order_by(ToolRun.created_at))
    return list(result.scalars())


@router.post(
    "/sessions/{session_id}/report",
    response_model=AssessmentReportOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Assessment"],
)
async def generate_report(
    session_id: UUID,
    db: Db,
    user: CurrentUser,
    settings: SettingsDep,
    response: Response,
    regenerate: bool = False,
) -> AssessmentReport:
    session = await _owned(db, InterviewSession, session_id, user.id)
    if session.status != "ended":
        raise HTTPException(status.HTTP_409_CONFLICT, "End the interview before generating a report")
    existing = cast(
        AssessmentReport | None,
        await db.scalar(select(AssessmentReport).where(AssessmentReport.session_id == session_id)),
    )
    if existing is not None and not regenerate:
        response.status_code = status.HTTP_200_OK
        return existing
    turns = list(
        (
            await db.execute(
                select(TranscriptTurn)
                .where(
                    TranscriptTurn.session_id == session_id,
                    TranscriptTurn.speaker_type == "candidate",
                    TranscriptTurn.interrupted.is_(False),
                )
                .order_by(TranscriptTurn.sequence)
            )
        ).scalars()
    )
    evidence = [
        {
            "competency": item.competency,
            "strength": item.strength,
            "transcript_turn_id": str(item.transcript_turn_id),
        }
        for item in (
            await db.execute(select(EvidenceItem).where(EvidenceItem.session_id == session_id))
        ).scalars()
    ]
    snapshot = session.config_snapshot
    # Do not hold a database transaction or connection while awaiting the model.
    await db.commit()
    try:
        result = await build_assessment(snapshot, turns, settings, evidence)
    except AssessmentServiceUnavailable as exc:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Interview assessment is temporarily unavailable. Retry report generation.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    existing = cast(
        AssessmentReport | None,
        await db.scalar(select(AssessmentReport).where(AssessmentReport.session_id == session_id).with_for_update()),
    )
    if existing is not None and not regenerate:
        response.status_code = status.HTTP_200_OK
        return existing
    if existing is not None:
        for key, value in result.items():
            setattr(existing, key, value)
        existing.generated_at = datetime.now(UTC)
        await db.execute(delete(ReplayDrill).where(ReplayDrill.session_id == session_id))
        await db.flush()
        response.status_code = status.HTTP_200_OK
        return existing
    report = AssessmentReport(session_id=session_id, **result)
    db.add(report)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        existing = cast(
            AssessmentReport | None,
            await db.scalar(select(AssessmentReport).where(AssessmentReport.session_id == session_id)),
        )
        if existing is not None:
            return existing
        raise
    return report


@router.get(
    "/sessions/{session_id}/report",
    response_model=AssessmentReportOut,
    tags=["Assessment"],
)
async def get_report(session_id: UUID, db: Db, user: CurrentUser) -> AssessmentReport:
    await _owned(db, InterviewSession, session_id, user.id)
    report = await db.scalar(select(AssessmentReport).where(AssessmentReport.session_id == session_id))
    if report is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Report has not been generated")
    return report


@router.post(
    "/sessions/{session_id}/replay-drills",
    response_model=list[ReplayDrillOut],
    status_code=status.HTTP_201_CREATED,
    tags=["Assessment"],
)
async def generate_replay_drills(session_id: UUID, db: Db, user: CurrentUser, response: Response) -> list[ReplayDrill]:
    await _owned(db, InterviewSession, session_id, user.id)
    report = await db.scalar(
        select(AssessmentReport).where(AssessmentReport.session_id == session_id).with_for_update()
    )
    if report is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Generate the report first")
    existing = list((await db.execute(select(ReplayDrill).where(ReplayDrill.session_id == session_id))).scalars())
    if existing:
        response.status_code = status.HTTP_200_OK
        return existing
    report_data = {
        "competencies": report.competencies,
    }
    drills = [ReplayDrill(session_id=session_id, **item) for item in build_replay_drills(report_data)]
    db.add_all(drills)
    await db.flush()
    return drills


@router.get(
    "/sessions/{session_id}/replay-drills",
    response_model=list[ReplayDrillOut],
    tags=["Assessment"],
)
async def list_replay_drills(session_id: UUID, db: Db, user: CurrentUser) -> list[ReplayDrill]:
    await _owned(db, InterviewSession, session_id, user.id)
    result = await db.execute(
        select(ReplayDrill).where(ReplayDrill.session_id == session_id).order_by(ReplayDrill.created_at)
    )
    return list(result.scalars())


# --- Role packs -------------------------------------------------------------


@router.get("/role-packs", response_model=list[RolePackOut], tags=["Interview setup"])
async def list_role_packs(user: CurrentUser) -> list[dict[str, Any]]:
    del user
    return role_pack_catalog()


# --- Live coding pane -------------------------------------------------------


def _read_panel_state(session: InterviewSession) -> PanelState:
    try:
        return PanelState.model_validate(session.memory_state or {})
    except ValidationError:
        # A malformed state blob must not strand a live room.
        return PanelState()


def _code_buffer_out(state: PanelState) -> CodeBufferOut:
    buffer = state.code_buffer or CodeBufferState()
    return CodeBufferOut(
        language=buffer.language,
        content=buffer.content,
        line_count=len(buffer.content.splitlines()) if buffer.content else 0,
        updated_at=buffer.updated_at,
    )


def _session_role_pack(session: InterviewSession) -> str:
    snapshot = session.config_snapshot or {}
    return str(snapshot.get("profession") or "")


@router.get(
    "/sessions/{session_id}/code",
    response_model=CodeBufferOut,
    tags=["Interview sessions"],
)
async def read_code_buffer(session_id: UUID, db: Db, user: CurrentUser) -> CodeBufferOut:
    session = cast(InterviewSession, await _owned(db, InterviewSession, session_id, user.id))
    return _code_buffer_out(_read_panel_state(session))


# POST rather than PUT: the deployment's CORS policy admits GET and POST only,
# and every other mutating route in this API is a POST.
@router.post(
    "/sessions/{session_id}/code",
    response_model=CodeBufferOut,
    tags=["Interview sessions"],
)
async def write_code_buffer(
    session_id: UUID,
    payload: CodeBufferUpdate,
    db: Db,
    user: CurrentUser,
) -> CodeBufferOut:
    """Push the editor contents so the panel can read them mid-answer."""
    session = cast(InterviewSession, await _owned(db, InterviewSession, session_id, user.id))
    if session.status not in {"configured", "starting", "live"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "Session is no longer accepting code")
    pack = get_role_pack(_session_role_pack(session))
    if not pack.supports_coding:
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview track has no coding round")
    if pack.coding is not None and payload.language not in pack.coding.languages:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"{pack.label} interviews do not use {payload.language}",
        )
    await lock_transcript_session(db, session_id)
    state = _read_panel_state(session)
    state.code_buffer = CodeBufferState(
        language=payload.language,
        content=payload.content,
        updated_at=datetime.now(UTC),
    )
    session.memory_state = state.model_dump(mode="json")
    await db.commit()
    return _code_buffer_out(state)


# --- Human interviewer ------------------------------------------------------


def _resolved_invite_secret(settings: SettingsDep) -> str:
    return invite_secret(settings.session_invite_secret, settings.agora_llm_bearer_secret)


async def _session_for_invite(db: Db, token: str, settings: SettingsDep) -> InterviewSession:
    try:
        claims = read_invite(token, _resolved_invite_secret(settings))
    except InviteError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, str(exc)) from exc
    session = await db.get(InterviewSession, claims.session_id)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resource not found")
    return session


def _host_messages_out(state: PanelState) -> list[HostMessageOut]:
    host = state.host
    if host is None:
        return []
    return [
        HostMessageOut(
            id=item.id,
            mode=item.mode,
            text=item.text,
            author=item.author,
            created_at=item.created_at,
        )
        for item in host.messages
    ]


@router.post(
    "/sessions/{session_id}/invite",
    response_model=SessionInviteOut,
    tags=["Interview sessions"],
)
async def create_session_invite(
    session_id: UUID,
    db: Db,
    user: CurrentUser,
    settings: SettingsDep,
) -> SessionInviteOut:
    """Mint a link that lets one human interviewer sit in on this session."""
    session = cast(InterviewSession, await _owned(db, InterviewSession, session_id, user.id))
    if session.status in {"completed", "failed"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "This session has already finished")
    token, expires_at = mint_invite(
        session.id,
        _resolved_invite_secret(settings),
        ttl_seconds=DEFAULT_INVITE_TTL_SECONDS,
    )
    return SessionInviteOut(
        token=token,
        join_path=f"/join/{token}",
        expires_at=datetime.fromtimestamp(expires_at, tz=UTC),
    )


@router.get(
    "/sessions/{session_id}/host",
    response_model=HostPresenceOut | None,
    tags=["Interview sessions"],
)
async def read_host_presence(session_id: UUID, db: Db, user: CurrentUser) -> HostPresenceOut | None:
    """What the candidate sees of the human interviewer, if one joined."""
    session = cast(InterviewSession, await _owned(db, InterviewSession, session_id, user.id))
    state = _read_panel_state(session)
    if state.host is None or state.host.joined_at is None:
        return None
    return HostPresenceOut(
        display_name=state.host.display_name,
        joined_at=state.host.joined_at,
        messages=_host_messages_out(state),
    )


@router.get(
    "/guest/sessions/{token}",
    response_model=GuestSessionOut,
    tags=["Human interviewer"],
)
async def join_session_as_host(
    token: str,
    db: Db,
    settings: SettingsDep,
    agora: AgoraDep,
    display_name: str = "Guest interviewer",
) -> GuestSessionOut:
    """Exchange an invite for a seat in the room.

    The guest joins the same Agora channel on a fresh uid, so they hear the panel
    and the candidate live without displacing either.
    """
    session = await _session_for_invite(db, token, settings)
    if session.status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview is not live right now")
    if session.channel_name is None or session.agent_uid is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Live session connection is incomplete")
    name = (display_name or "Guest interviewer").strip()[:60] or "Guest interviewer"
    await lock_transcript_session(db, session.id)
    state = _read_panel_state(session)
    if state.host is None or state.host.joined_at is None:
        state.host = HostState(display_name=name, joined_at=datetime.now(UTC), messages=[])
    else:
        state.host.display_name = name
    session.memory_state = state.model_dump(mode="json")
    await db.commit()
    connection = agora.generate_connection(
        channel=session.channel_name,
        uid=None,
        agent_uid=session.agent_uid,
    )
    snapshot = session.config_snapshot or {}
    pack = get_role_pack(_session_role_pack(session))
    return GuestSessionOut(
        session_id=session.id,
        title=str(snapshot.get("title") or "RoundCraft interview"),
        role_pack=pack.label,
        status=session.status,
        display_name=name,
        connection=ConnectionConfig.model_validate(connection),
        panel=[
            GuestPanelist(
                id=str(item.get("id", "")),
                display_name=str(item.get("display_name", "")),
                role=str(item.get("role", "")),
            )
            for item in snapshot.get("panel", [])
        ],
        supports_coding=pack.supports_coding,
    )


@router.post(
    "/guest/sessions/{token}/messages",
    response_model=HostMessageOut,
    status_code=status.HTTP_201_CREATED,
    tags=["Human interviewer"],
)
async def post_host_message(
    token: str,
    payload: HostMessageCreate,
    db: Db,
    settings: SettingsDep,
) -> HostMessageOut:
    """Send a note to the candidate, or hand the panel a question to ask next."""
    session = await _session_for_invite(db, token, settings)
    if session.status != "live":
        raise HTTPException(status.HTTP_409_CONFLICT, "This interview is not live right now")
    await lock_transcript_session(db, session.id)
    state = _read_panel_state(session)
    host = state.host or HostState(display_name="Guest interviewer", joined_at=datetime.now(UTC))
    record = HostTurnRecord(
        id=f"host-{uuid4().hex[:10]}",
        mode=payload.mode,
        text=payload.text,
        author=host.display_name or "Guest interviewer",
        created_at=datetime.now(UTC),
    )
    # Keep the tail only; this rides inside the session live-state blob.
    host.messages = [*host.messages, record][-50:]
    if payload.mode == "ask":
        host.pending_question = payload.text
    state.host = host
    session.memory_state = state.model_dump(mode="json")
    await db.commit()
    return HostMessageOut(
        id=record.id,
        mode=record.mode,
        text=record.text,
        author=record.author,
        created_at=record.created_at,
    )


@router.get(
    "/guest/sessions/{token}/state",
    response_model=dict[str, Any],
    tags=["Human interviewer"],
)
async def read_host_view(
    token: str,
    db: Db,
    settings: SettingsDep,
    after_sequence: int = 0,
) -> dict[str, Any]:
    """The guest read-only window: transcript tail, editor, and their own notes."""
    session = await _session_for_invite(db, token, settings)
    state = _read_panel_state(session)
    turns = list(
        (
            await db.execute(
                select(TranscriptTurn)
                .where(
                    TranscriptTurn.session_id == session.id,
                    TranscriptTurn.sequence > after_sequence,
                )
                .order_by(TranscriptTurn.sequence)
                .limit(200)
            )
        ).scalars()
    )
    return {
        "status": session.status,
        "turns": [
            {
                "id": str(turn.id),
                "sequence": turn.sequence,
                "speaker_type": turn.speaker_type,
                "speaker_id": turn.speaker_id,
                "content": turn.content,
                "created_at": turn.created_at.isoformat(),
            }
            for turn in turns
        ],
        "code": _code_buffer_out(state).model_dump(mode="json"),
        "messages": [item.model_dump(mode="json") for item in _host_messages_out(state)],
        "pending_question": state.host.pending_question if state.host else None,
    }


@router.post("/webhooks/agora", response_model=AgoraWebhookOut, tags=["Webhooks"])
async def receive_agora_webhook(
    request: Request,
    db: Db,
    settings: SettingsDep,
    agora_signature_v2: Annotated[str | None, Header(alias="Agora-Signature-V2")] = None,
) -> AgoraWebhookOut:
    if not settings.agora_webhook_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Webhook secret is not configured")
    raw = await request.body()
    expected_signature = hmac.new(settings.agora_webhook_secret.encode(), raw, digestmod="sha256").hexdigest()
    if not agora_signature_v2 or not hmac.compare_digest(agora_signature_v2.lower(), expected_signature):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid Agora webhook signature")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid JSON payload") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Webhook payload must be an object")
    event_key = str(
        payload.get("noticeId")
        or payload.get("notice_id")
        or payload.get("id")
        or payload.get("eventId")
        or expected_signature
    )
    existing = await db.scalar(select(AgoraWebhookEvent.id).where(AgoraWebhookEvent.event_key == event_key))
    if existing:
        return AgoraWebhookOut(accepted=True, duplicate=True)
    event_type = str(payload.get("eventType") or payload.get("event_type") or payload.get("type") or "unknown")
    mapped_session, mapped_participant = await map_agora_event(db, payload, event_type)
    event = AgoraWebhookEvent(
        session_id=mapped_session.id if mapped_session else None,
        panel_participant_id=mapped_participant.id if mapped_participant else None,
        event_key=event_key,
        event_type=event_type,
        payload=payload,
    )
    db.add(event)
    try:
        await reconcile_agora_history(db, payload, event_type)
        await db.flush()
    except IntegrityError:
        await db.rollback()
        return AgoraWebhookOut(accepted=True, duplicate=True)
    return AgoraWebhookOut(accepted=True, duplicate=False)
