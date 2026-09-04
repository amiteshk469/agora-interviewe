from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class PromptTemplate(TimestampMixin, Base):
    __tablename__ = "prompt_templates"
    __table_args__ = (
        CheckConstraint("version > 0", name="prompt_templates_version_positive"),
        Index(
            "prompt_templates_builtin_slug_version_key",
            "slug",
            "version",
            unique=True,
            postgresql_where=text("owner_id is null"),
            sqlite_where=text("owner_id is null"),
        ),
        Index(
            "prompt_templates_owner_slug_version_key",
            "owner_id",
            "slug",
            "version",
            unique=True,
            postgresql_where=text("owner_id is not null"),
            sqlite_where=text("owner_id is not null"),
        ),
        Index("prompt_templates_owner_role_idx", "owner_id", "role"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    parent_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("prompt_templates.id", ondelete="RESTRICT"), index=True
    )
    slug: Mapped[str] = mapped_column(String(100), index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    name: Mapped[str] = mapped_column(String(120))
    role: Mapped[str] = mapped_column(String(80), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    prompt: Mapped[str] = mapped_column(Text)
    knowledge: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    behavior: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class JobDescription(TimestampMixin, Base):
    __tablename__ = "job_descriptions"
    __table_args__ = (
        CheckConstraint("size_bytes >= 0", name="job_descriptions_size_nonnegative"),
        Index("job_descriptions_user_created_idx", "user_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(Text, unique=True)
    mime_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="ready", index=True)
    raw_text: Mapped[str] = mapped_column(Text, default="")
    extracted: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    recommendations: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)


class InterviewConfig(TimestampMixin, Base):
    __tablename__ = "interview_configs"
    __table_args__ = (
        CheckConstraint(
            "duration_minutes between 10 and 120",
            name="interview_configs_duration_range",
        ),
        Index("interview_configs_user_status_idx", "user_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    job_description_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("job_descriptions.id", ondelete="SET NULL"), index=True
    )
    title: Mapped[str] = mapped_column(String(160))
    profession: Mapped[str] = mapped_column(String(60), default="product_management")
    interview_mode: Mapped[str] = mapped_column(String(32), default="candidate_practice")
    difficulty: Mapped[str] = mapped_column(String(20), default="balanced")
    duration_minutes: Mapped[int] = mapped_column(Integer, default=45)
    panel: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    rubric: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    enabled_tools: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="ready", index=True)


class InterviewSession(TimestampMixin, Base):
    __tablename__ = "interview_sessions"
    __table_args__ = (
        Index("interview_sessions_user_status_idx", "user_id", "status"),
        Index(
            "interview_sessions_config_created_idx", "interview_config_id", "created_at"
        ),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    interview_config_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("interview_configs.id", ondelete="RESTRICT"), index=True
    )
    status: Mapped[str] = mapped_column(String(20), default="configured", index=True)
    config_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    memory_state: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    channel_name: Mapped[str | None] = mapped_column(String(128), unique=True)
    user_uid: Mapped[int | None] = mapped_column(Integer)
    agent_uid: Mapped[int | None] = mapped_column(Integer)
    agora_agent_id: Mapped[str | None] = mapped_column(String(128), index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PanelParticipant(Base):
    __tablename__ = "panel_participants"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "panelist_id", name="panel_participants_panelist_key"
        ),
        UniqueConstraint(
            "session_id", "agent_uid", name="panel_participants_agent_uid_key"
        ),
        UniqueConstraint(
            "session_id", "avatar_uid", name="panel_participants_avatar_uid_key"
        ),
        Index("panel_participants_session_status_idx", "session_id", "status"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    panelist_id: Mapped[str] = mapped_column(String(100))
    display_name: Mapped[str] = mapped_column(String(80))
    role: Mapped[str] = mapped_column(String(80))
    agent_uid: Mapped[int] = mapped_column(Integer)
    avatar_uid: Mapped[int] = mapped_column(Integer)
    agora_agent_id: Mapped[str | None] = mapped_column(
        String(128), unique=True, index=True
    )
    avatar_vendor: Mapped[str | None] = mapped_column(String(32))
    avatar_id: Mapped[str | None] = mapped_column(String(200))
    avatar_image: Mapped[str | None] = mapped_column(Text)
    video_mode: Mapped[str] = mapped_column(String(20), default="audio")
    status: Mapped[str] = mapped_column(String(20), default="allocated", index=True)
    last_event_type: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class TranscriptTurn(Base):
    __tablename__ = "transcript_turns"
    __table_args__ = (
        UniqueConstraint(
            "session_id", "sequence", name="transcript_turns_session_sequence_key"
        ),
        UniqueConstraint(
            "session_id",
            "agora_turn_id",
            name="transcript_turns_session_agora_turn_key",
        ),
        Index("transcript_turns_session_sequence_idx", "session_id", "sequence"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    agora_turn_id: Mapped[str | None] = mapped_column(String(128), index=True)
    speaker_type: Mapped[str] = mapped_column(String(20))
    speaker_id: Mapped[str | None] = mapped_column(String(100))
    content: Mapped[str] = mapped_column(Text)
    interrupted: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[float | None] = mapped_column(Float)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    turn_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSON, default=dict
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class EvidenceItem(Base):
    __tablename__ = "evidence_items"
    __table_args__ = (
        UniqueConstraint(
            "session_id",
            "transcript_turn_id",
            "competency",
            name="evidence_items_turn_competency_key",
        ),
        Index("evidence_items_session_competency_idx", "session_id", "competency"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    transcript_turn_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("transcript_turns.id", ondelete="CASCADE"), index=True
    )
    competency: Mapped[str] = mapped_column(String(80), index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    strength: Mapped[str] = mapped_column(String(20), default="supports")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ToolRun(Base):
    __tablename__ = "tool_runs"
    __table_args__ = (
        Index("tool_runs_session_created_idx", "session_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    transcript_turn_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("transcript_turns.id", ondelete="SET NULL"), index=True
    )
    panelist_id: Mapped[str | None] = mapped_column(String(100), index=True)
    tool_name: Mapped[str] = mapped_column(String(80), index=True)
    arguments: Mapped[dict[str, Any]] = mapped_column(JSON)
    result: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="completed", index=True)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AssessmentReport(Base):
    __tablename__ = "assessment_reports"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("interview_sessions.id", ondelete="CASCADE"),
        unique=True,
        index=True,
    )
    overall_score: Mapped[float | None] = mapped_column(Float)
    readiness: Mapped[str] = mapped_column(String(32), default="insufficient_evidence")
    summary: Mapped[str] = mapped_column(Text)
    competencies: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    interviewer_assessments: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    evidence_map: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class ReplayDrill(Base):
    __tablename__ = "replay_drills"
    __table_args__ = (
        Index("replay_drills_session_created_idx", "session_id", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="CASCADE"), index=True
    )
    competency: Mapped[str] = mapped_column(String(80))
    prompt: Mapped[str] = mapped_column(Text)
    source_turn_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="ready")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class AgoraWebhookEvent(Base):
    __tablename__ = "agora_webhook_events"

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    session_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("interview_sessions.id", ondelete="SET NULL"), index=True
    )
    panel_participant_id: Mapped[UUID | None] = mapped_column(
        Uuid, ForeignKey("panel_participants.id", ondelete="SET NULL"), index=True
    )
    event_key: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
