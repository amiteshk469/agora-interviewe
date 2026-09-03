export type UUID = string;
export type ISODateTime = string;
export type JsonObject = Record<string, unknown>;

export const interviewerTools = [
  "knowledge_search",
  "calculator",
  "web_search",
] as const;

export type InterviewerTool = (typeof interviewerTools)[number];
export const platformWorkflowCapabilities = ["evidence_bookmark", "replay"] as const;
export type PlatformWorkflowCapability = (typeof platformWorkflowCapabilities)[number];
export type Difficulty = "supportive" | "balanced" | "challenging" | "executive";
export type TranscriptTurnStatus = "in_progress" | "completed" | "interrupted";
export type DocumentStatus = "uploaded" | "processing" | "ready" | "failed";

export interface PromptTemplateOut {
  id: UUID;
  owner_id: UUID | null;
  parent_id: UUID | null;
  slug: string;
  version: number;
  name: string;
  role: string;
  description: string;
  prompt: string;
  knowledge: JsonObject;
  behavior: JsonObject;
  is_builtin: boolean;
  is_active: boolean;
  created_at: ISODateTime;
}

export interface JobDescriptionOut {
  id: UUID;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: DocumentStatus | string;
  extracted: JsonObject;
  recommendations: JsonObject;
  error: string | null;
  created_at: ISODateTime;
}

export interface PanelRecommendation {
  generated_by: string;
  role_title: string;
  focus_areas: string[];
  difficulty: Difficulty;
  panel: PanelistInput[];
  rubric: RubricCriterion[];
}

export interface PanelistInput {
  id: string;
  display_name: string;
  role: string;
  expertise?: string[];
  prompt_template_id?: UUID | null;
  custom_prompt?: string | null;
  knowledge_prompt?: string | null;
  voice?: string;
  mood?: string;
  behavior?: string;
  interruption_style?: string;
}

/** The hiring tracks the panel can interview for. */
export type RolePackId =
  | "product_management"
  | "software_engineering"
  | "data_science"
  | "machine_learning"
  | "quantitative_finance"
  | "consulting"
  | "hardware_vlsi"
  | "embedded_systems"
  | "cloud_devops"
  | "core_engineering";

export interface RolePackCoding {
  languages: string[];
  default_language: string;
  prompt: string;
}

export interface RolePack {
  id: RolePackId;
  label: string;
  family: string;
  summary: string;
  panel: PanelistInput[];
  rubric: RubricCriterion[];
  enabled_tools: string[];
  supports_coding: boolean;
  coding: RolePackCoding | null;
}

export interface RubricCriterion {
  key: string;
  label: string;
  weight: number;
  description?: string;
}

export interface InterviewConfigCreate {
  title?: string;
  profession?: RolePackId | string;
  job_description_id?: UUID | null;
  difficulty?: Difficulty;
  duration_minutes?: number;
  panel?: PanelistInput[] | null;
  rubric?: RubricCriterion[] | null;
  enabled_tools?: InterviewerTool[];
}

export interface InterviewConfigOut {
  id: UUID;
  job_description_id: UUID | null;
  title: string;
  profession: RolePackId | string;
  difficulty: Difficulty | string;
  duration_minutes: number;
  panel: PanelistInput[];
  rubric: RubricCriterion[];
  enabled_tools: InterviewerTool[] | string[];
  status: string;
  created_at: ISODateTime;
}

export interface SessionOut {
  id: UUID;
  interview_config_id: UUID;
  status: string;
  config_snapshot: JsonObject;
  memory_state: JsonObject;
  channel_name: string | null;
  user_uid: number | null;
  agent_uid: number | null;
  agora_agent_id: string | null;
  started_at: ISODateTime | null;
  ended_at: ISODateTime | null;
  created_at: ISODateTime;
}

export interface ConnectionConfig {
  app_id: string;
  token: string;
  uid: string;
  channel_name: string;
  agent_uid: string;
}

export interface SessionStartOut {
  session: SessionOut;
  connection: ConnectionConfig;
}

export interface TranscriptTurn {
  id: UUID;
  session_id: UUID;
  sequence: number;
  agora_turn_id: string | null;
  speaker_type: "candidate" | "interviewer" | "system" | string;
  speaker_id: string | null;
  content: string;
  interrupted: boolean;
  confidence: number | null;
  started_at: ISODateTime | null;
  ended_at: ISODateTime | null;
  metadata: JsonObject;
  created_at: ISODateTime;
}

export interface EvidenceLink {
  id: UUID;
  rubricItemId: string;
  turnId: UUID;
  toolRunId?: UUID;
  polarity: "strength" | "gap" | "neutral";
  note: string;
}

export interface AssessmentItem {
  id: string;
  label: string;
  score: number | null;
  maxScore: number;
  confidence: number;
  insufficientEvidence: boolean;
  evidence: EvidenceLink[];
  feedback: string;
}

export interface InterviewReport {
  interviewId: UUID;
  totalScore: number | null;
  maxScore: number;
  items: AssessmentItem[];
  summary: string;
  replayDrillIds: UUID[];
}

export type CreateInterviewRequest = InterviewConfigCreate;
export type Interview = InterviewConfigOut;
export type InterviewerProfile = PanelistInput;
export type StartInterviewResponse = SessionStartOut;
export type JobDescription = JobDescriptionOut;

export type LiveInterviewEvent =
  | {
      type: "speaker_selected";
      sessionId: UUID;
      panelistId: string;
      reason: string;
      at: ISODateTime;
    }
  | {
      type: "transcript_turn";
      sessionId: UUID;
      turn: TranscriptTurn;
      at: ISODateTime;
    }
  | {
      type: "agent_state";
      sessionId: UUID;
      state: "listening" | "thinking" | "speaking" | "idle";
      at: ISODateTime;
    }
  | {
      type: "tool_status";
      sessionId: UUID;
      toolRunId: UUID;
      tool: InterviewerTool;
      status: "started" | "completed" | "failed";
      at: ISODateTime;
    };
