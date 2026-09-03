import re
from datetime import datetime
from enum import StrEnum
from typing import Any, Literal, Self
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

INTERVIEWER_TOOL_NAMES = frozenset({"knowledge_search", "calculator", "web_search"})


def _validate_interviewer_prompt(value: str | None) -> str | None:
    if value is None:
        return None
    lowered = value.lower()
    if any(term in lowered for term in ("request_human_review", "evidence_bookmark", "replay tool")):
        raise ValueError("interviewer prompts cannot claim internal or human-review tools")
    for match in re.finditer(
        r"\b(?:human reviewer|human review|human escalation|escalat(?:e|ion)(?: to)? (?:a )?human)\b",
        lowered,
    ):
        prefix = lowered[max(0, match.start() - 60) : match.start()]
        if not re.search(r"(?:never|do not|don't|must not|cannot)\b[^.!?]{0,55}$", prefix):
            raise ValueError("interviewer prompts cannot request human review or escalation")
    return value


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True, str_strip_whitespace=True)


class Difficulty(StrEnum):
    SUPPORTIVE = "supportive"
    BALANCED = "balanced"
    CHALLENGING = "challenging"
    EXECUTIVE = "executive"


class PromptRubricCriterion(ApiModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    key: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9_]+$")
    label: str = Field(min_length=2, max_length=100)
    evidence: str = Field(min_length=2, max_length=1000)
    anchors: dict[str, str] = Field(default_factory=dict, max_length=3)

    @field_validator("anchors")
    @classmethod
    def validate_anchors(cls, values: dict[str, str]) -> dict[str, str]:
        if values and set(values) != {"1", "3", "5"}:
            raise ValueError("rubric anchors must define levels 1, 3, and 5")
        if any(not 2 <= len(value.strip()) <= 1000 for value in values.values()):
            raise ValueError("rubric anchors must contain 2 to 1000 characters")
        return {key: value.strip() for key, value in values.items()}


class PromptTemplateKnowledge(ApiModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    case_type: str | None = Field(default=None, max_length=120)
    domains: list[str] = Field(default_factory=list, max_length=12)
    scenario_seeds: list[str] = Field(default_factory=list, max_length=8)
    scoring_focus: list[str] = Field(default_factory=list, max_length=8)
    rubric: list[PromptRubricCriterion] = Field(default_factory=list, max_length=8)

    @field_validator("domains", "scoring_focus")
    @classmethod
    def validate_terms(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            term = value.strip()
            if not 2 <= len(term) <= 100:
                raise ValueError("metadata terms must contain 2 to 100 characters")
            if term not in cleaned:
                cleaned.append(term)
        return cleaned

    @field_validator("scenario_seeds")
    @classmethod
    def validate_scenarios(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            scenario = value.strip()
            if not 10 <= len(scenario) <= 1000:
                raise ValueError("scenario seeds must contain 10 to 1000 characters")
            if scenario not in cleaned:
                cleaned.append(scenario)
        return cleaned


class PromptTemplateBehavior(ApiModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    mood: str | None = Field(default=None, max_length=40)
    style: str | None = Field(default=None, max_length=60)
    interruption: str | None = Field(default=None, max_length=60)
    adaptive_probe: str | None = Field(default=None, max_length=500)
    panel_selection: Literal["non_round_robin"] | None = None
    evidence_policy: Literal["final_transcript_turn_ids_only"] | None = None
    allowed_tools: list[str] = Field(default_factory=list, max_length=8)

    @field_validator("adaptive_probe")
    @classmethod
    def reject_forbidden_directives(cls, value: str | None) -> str | None:
        if value is None:
            return None
        lowered = value.lower()
        forbidden = (
            "human review",
            "human reviewer",
            "human escalation",
            "request_human_review",
            "evidence_bookmark",
            "replay tool",
        )
        if any(term in lowered for term in forbidden):
            raise ValueError("adaptive_probe cannot request human review or internal tools")
        return value

    @field_validator("allowed_tools")
    @classmethod
    def interviewer_tools_only(cls, values: list[str]) -> list[str]:
        return [value for value in dict.fromkeys(values) if value in INTERVIEWER_TOOL_NAMES]


class PromptTemplateCreate(ApiModel):
    slug: str = Field(min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    name: str = Field(min_length=2, max_length=120)
    role: str = Field(min_length=2, max_length=80)
    description: str = Field(default="", max_length=1000)
    prompt: str = Field(min_length=40, max_length=20_000)
    knowledge: PromptTemplateKnowledge = Field(default_factory=PromptTemplateKnowledge)
    behavior: PromptTemplateBehavior = Field(default_factory=PromptTemplateBehavior)

    @field_validator("prompt")
    @classmethod
    def validate_prompt_policy(cls, value: str) -> str:
        return _validate_interviewer_prompt(value) or value


class PromptTemplateFork(ApiModel):
    slug: str | None = Field(default=None, min_length=2, max_length=100, pattern=r"^[a-z0-9-]+$")
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    prompt: str | None = Field(default=None, min_length=40, max_length=20_000)
    knowledge: PromptTemplateKnowledge | None = None
    behavior: PromptTemplateBehavior | None = None

    @field_validator("prompt")
    @classmethod
    def validate_prompt_policy(cls, value: str | None) -> str | None:
        return _validate_interviewer_prompt(value)


class PromptTemplateOut(ApiModel):
    id: UUID
    owner_id: UUID | None
    parent_id: UUID | None
    slug: str
    version: int
    name: str
    role: str
    description: str
    prompt: str
    knowledge: PromptTemplateKnowledge
    behavior: PromptTemplateBehavior
    is_builtin: bool
    is_active: bool
    created_at: datetime


class JobDescriptionOut(ApiModel):
    id: UUID
    original_filename: str
    mime_type: str
    size_bytes: int
    status: str
    extracted: dict[str, Any]
    recommendations: dict[str, Any]
    error: str | None
    created_at: datetime


class RubricCriterion(ApiModel):
    key: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9_]+$")
    label: str = Field(min_length=2, max_length=100)
    weight: float = Field(gt=0, le=1)
    description: str = Field(default="", max_length=1000)


class PanelistInput(ApiModel):
    id: str = Field(default_factory=lambda: f"panelist-{uuid4().hex[:8]}", max_length=100)
    display_name: str = Field(min_length=2, max_length=80)
    role: str = Field(min_length=2, max_length=80)
    expertise: list[str] = Field(default_factory=list, max_length=12)
    prompt_template_id: UUID | None = None
    prompt_template_version: int | None = Field(default=None, ge=1)
    template_knowledge: PromptTemplateKnowledge = Field(default_factory=PromptTemplateKnowledge)
    template_behavior: PromptTemplateBehavior = Field(default_factory=PromptTemplateBehavior)
    role_rubric: list[PromptRubricCriterion] = Field(default_factory=list, max_length=8)
    custom_prompt: str | None = Field(default=None, max_length=20_000)
    knowledge_prompt: str | None = Field(default=None, max_length=10_000)
    voice: str = Field(default="indian-calm", max_length=80)
    mood: str = Field(default="professional", max_length=40)
    behavior: str = Field(default="evidence-seeking", max_length=60)
    interruption_style: str = Field(default="contextual", max_length=60)
    allowed_tools: list[str] | None = Field(default=None, max_length=8)
    avatar_id: str | None = Field(default=None, max_length=200)
    avatar_vendor: Literal["liveavatar", "generic", "akool", "anam"] | None = None
    avatar_image: str | None = Field(default=None, max_length=2000)

    @field_validator("custom_prompt")
    @classmethod
    def validate_custom_prompt_policy(cls, value: str | None) -> str | None:
        return _validate_interviewer_prompt(value)


class InterviewConfigCreate(ApiModel):
    title: str = Field(default="Product Management mock interview", min_length=2, max_length=160)
    profession: Literal["product_management"] = "product_management"
    job_description_id: UUID | None = None
    # None means "use the JD recommendation, or balanced when no JD was uploaded".
    difficulty: Difficulty | None = None
    duration_minutes: int = Field(default=45, ge=10, le=120)
    panel: list[PanelistInput] | None = None
    rubric: list[RubricCriterion] | None = None
    enabled_tools: list[str] = Field(default_factory=lambda: ["knowledge_search", "calculator"])

    @model_validator(mode="after")
    def validate_panel(self) -> Self:
        if self.panel is not None:
            if not 2 <= len(self.panel) <= 5:
                raise ValueError("Panel must contain between 2 and 5 interviewers")
            ids = [panelist.id for panelist in self.panel]
            if len(ids) != len(set(ids)):
                raise ValueError("Panelist ids must be unique")
        if self.rubric is not None:
            total = sum(item.weight for item in self.rubric)
            if not 0.99 <= total <= 1.01:
                raise ValueError("Rubric weights must total 1")
        return self


class InterviewConfigOut(ApiModel):
    id: UUID
    job_description_id: UUID | None
    title: str
    profession: str
    difficulty: str
    duration_minutes: int
    panel: list[PanelistInput]
    rubric: list[RubricCriterion]
    enabled_tools: list[str]
    status: str
    created_at: datetime


class SessionCreate(ApiModel):
    interview_config_id: UUID


class SessionOut(ApiModel):
    id: UUID
    interview_config_id: UUID
    status: str
    config_snapshot: dict[str, Any]
    memory_state: dict[str, Any]
    channel_name: str | None
    user_uid: int | None
    agent_uid: int | None
    agora_agent_id: str | None
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime


class ConnectionConfig(ApiModel):
    app_id: str
    token: str
    uid: str
    channel_name: str
    agent_uid: str
    panelists: list["PanelConnection"] = Field(default_factory=list)


class PanelConnection(ApiModel):
    panelist_id: str
    agent_uid: str
    avatar_uid: str
    video_mode: Literal["avatar", "static", "audio"]


class PanelParticipantOut(ApiModel):
    id: UUID
    session_id: UUID
    panelist_id: str
    display_name: str
    role: str
    agent_uid: int
    avatar_uid: int
    agora_agent_id: str | None
    avatar_vendor: str | None
    avatar_id: str | None
    avatar_image: str | None
    video_mode: str
    status: str
    last_event_type: str | None
    created_at: datetime


class PanelDispatchRequest(ApiModel):
    candidate_text: str = Field(min_length=1, max_length=40_000, pattern=r"\S")
    force_panelist_id: str | None = Field(default=None, max_length=100)


class ManualTurnControl(ApiModel):
    mode: Literal["manual_sos_eos"] = "manual_sos_eos"
    agent_user_id: str
    send_manual_sos: bool = True
    send_manual_eos: bool = True
    server_dispatch: Literal["think_injected", "client_manual_required"]


class PanelDispatchOut(ApiModel):
    decision: "PanelDecision"
    participant: PanelParticipantOut
    manual_turn: ManualTurnControl


class PanelInterruptRequest(ApiModel):
    panelist_id: str | None = Field(default=None, max_length=100)
    reason: str = Field(default="candidate_barge_in", max_length=200)


class PanelInterruptOut(ApiModel):
    interrupted_panelist_ids: list[str]


class SessionStartRequest(ApiModel):
    output_audio_codec: str | None = Field(default=None, max_length=30)


class SessionStartOut(ApiModel):
    session: SessionOut
    connection: ConnectionConfig


class TranscriptTurnCreate(ApiModel):
    sequence: int = Field(ge=1)
    agora_turn_id: str | None = Field(default=None, max_length=128)
    speaker_type: Literal["candidate", "interviewer", "system"]
    speaker_id: str | None = Field(default=None, max_length=100)
    content: str = Field(min_length=1, max_length=40_000)
    interrupted: bool = False
    confidence: float | None = Field(default=None, ge=0, le=1)
    started_at: datetime | None = None
    ended_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TranscriptTurnOut(ApiModel):
    id: UUID
    session_id: UUID
    sequence: int
    agora_turn_id: str | None
    speaker_type: str
    speaker_id: str | None
    content: str
    interrupted: bool
    confidence: float | None
    started_at: datetime | None
    ended_at: datetime | None
    metadata: dict[str, Any] = Field(validation_alias="turn_metadata")
    created_at: datetime


class EvidenceCreate(ApiModel):
    transcript_turn_id: UUID
    competency: str = Field(min_length=2, max_length=80)
    note: str = Field(default="", max_length=2000)
    strength: Literal["supports", "contradicts", "neutral"] = "supports"


class EvidenceOut(ApiModel):
    id: UUID
    session_id: UUID
    transcript_turn_id: UUID
    competency: str
    note: str
    strength: str
    created_at: datetime


class MetricClaimRecord(ApiModel):
    """One before/after metric the candidate stated, kept so a later restatement can be checked."""

    turn_id: str
    subject: str
    baseline: str
    final: str
    excerpt: str


class PanelState(ApiModel):
    current_speaker_id: str | None = None
    pending_panelist_id: str | None = None
    pending_candidate_turn_id: str | None = None
    candidate_claims: list[str] = Field(default_factory=list)
    open_threads: list[str] = Field(default_factory=list)
    competency_coverage: dict[str, int] = Field(default_factory=dict)
    panelist_question_counts: dict[str, int] = Field(default_factory=dict)
    metric_claims: list[MetricClaimRecord] = Field(default_factory=list)
    last_question: str | None = None


class PanelDecision(ApiModel):
    next_speaker_id: str
    action: Literal["ask", "probe", "challenge", "clarify", "synthesize", "end"]
    rationale: str
    suggested_question: str


class PanelDecisionRequest(ApiModel):
    last_candidate_turn: str = Field(min_length=1, max_length=40_000)


class ToolDefinition(ApiModel):
    name: str
    description: str
    requires_network: bool


class ToolRunRequest(ApiModel):
    arguments: dict[str, Any] = Field(default_factory=dict)
    transcript_turn_id: UUID | None = None
    panelist_id: str | None = Field(default=None, max_length=100)


class ToolRunOut(ApiModel):
    id: UUID
    session_id: UUID
    transcript_turn_id: UUID | None
    panelist_id: str | None
    tool_name: str
    arguments: dict[str, Any]
    result: dict[str, Any]
    status: str
    error: str | None
    created_at: datetime


class CompetencyAssessment(ApiModel):
    key: str
    label: str
    score: float | None
    confidence: float
    evidence_turn_ids: list[UUID]
    feedback: str


class AssessmentReportOut(ApiModel):
    id: UUID
    session_id: UUID
    overall_score: float | None
    readiness: str
    summary: str
    competencies: list[CompetencyAssessment]
    interviewer_assessments: list[dict[str, Any]]
    evidence_map: list[dict[str, Any]]
    generated_at: datetime


class ReplayDrillOut(ApiModel):
    id: UUID
    session_id: UUID
    competency: str
    prompt: str
    source_turn_ids: list[str]
    status: str
    created_at: datetime


class AgoraStartAgentRequest(ApiModel):
    channel_name: str = Field(alias="channelName", min_length=1, max_length=128)
    rtc_uid: int = Field(alias="rtcUid", gt=0)
    user_uid: int = Field(alias="userUid", gt=0)
    parameters: dict[str, Any] | None = None


class AgoraStopAgentRequest(ApiModel):
    agent_id: str = Field(alias="agentId", min_length=1, max_length=128)


class AgoraWebhookOut(ApiModel):
    accepted: bool
    duplicate: bool


class ChatMessage(ApiModel):
    model_config = ConfigDict(extra="allow", str_strip_whitespace=False)

    role: Literal["system", "user", "assistant", "tool"]
    content: str | list[dict[str, Any]] | None = None


class ChatCompletionRequest(ApiModel):
    model_config = ConfigDict(extra="allow")

    model: str = Field(min_length=1, max_length=200)
    messages: list[ChatMessage] = Field(min_length=1, max_length=200)
    stream: bool = False


ConnectionConfig.model_rebuild()
PanelDispatchOut.model_rebuild()
