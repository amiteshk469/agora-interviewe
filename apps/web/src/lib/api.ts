export type AgoraConfig = {
  app_id: string;
  token: string;
  uid: string;
  channel_name: string;
  agent_uid: string;
  panelists?: AgoraPanelParticipant[];
};

export type AgoraPanelParticipant = {
  panelist_id: string;
  agent_uid: string;
  avatar_uid?: string | null;
  video_mode: "live" | "portrait" | "audio";
};

export const demoModeEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
const demoUserId = process.env.NEXT_PUBLIC_DEV_AUTH_USER_ID ?? "00000000-0000-4000-8000-000000000001";

type Envelope<T> = { code: number; msg?: string; data?: T };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithAuth(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await response.json().catch(() => null)) as Envelope<T> | { detail?: string } | null;
  if (!response.ok) {
    throw new Error(body && "detail" in body && body.detail ? body.detail : `Request failed with ${response.status}`);
  }
  if (body && "code" in body) {
    if (body.code !== 0) throw new Error(body.msg || "Agora request failed");
    return body.data as T;
  }
  return body as T;
}

export function getAgoraConfig(options?: { channel?: string; uid?: string | number }) {
  const search = new URLSearchParams();
  if (options?.channel) search.set("channel", options.channel);
  if (options?.uid !== undefined) search.set("uid", String(options.uid));
  return request<AgoraConfig>(`/api/get_config${search.size ? `?${search}` : ""}`);
}

export async function startAgoraAgent(config: AgoraConfig) {
  const result = await request<{ agent_id: string }>("/api/startAgent", {
    method: "POST",
    body: JSON.stringify({
      channelName: config.channel_name,
      rtcUid: Number(config.agent_uid),
      userUid: Number(config.uid),
    }),
  });
  return result.agent_id;
}

export async function stopAgoraAgent(agentId: string) {
  if (!agentId) return;
  await request<unknown>("/api/stopAgent", { method: "POST", body: JSON.stringify({ agentId }) });
}

const productBase = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/v1`;

function productToken() {
  const stored = typeof window === "undefined" ? null : window.localStorage.getItem("roundcraft.supabase_access_token");
  if (stored) return stored;
  if (demoModeEnabled) return `dev:${demoUserId}`;
  throw new Error("Sign in is required before saving this interview");
}

async function refreshProductToken() {
  const refreshToken = typeof window === "undefined" ? null : window.localStorage.getItem("roundcraft.supabase_refresh_token");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!refreshToken || !supabaseUrl || !anonKey || demoModeEnabled) return null;
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const body = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string } | null;
  if (!response.ok || !body?.access_token) return null;
  window.localStorage.setItem("roundcraft.supabase_access_token", body.access_token);
  if (body.refresh_token) window.localStorage.setItem("roundcraft.supabase_refresh_token", body.refresh_token);
  return body.access_token;
}

async function fetchWithAuth(url: string, init?: RequestInit) {
  const run = (token: string) => fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  const response = await run(productToken());
  if (response.status !== 401) return response;
  const refreshed = await refreshProductToken();
  return refreshed ? run(refreshed) : response;
}

async function productRequest<T>(path: string, init?: RequestInit) {
  const response = await fetchWithAuth(`${productBase}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as T | { detail?: string } | null;
  const detail = body && typeof body === "object" && "detail" in body ? body.detail : undefined;
  if (!response.ok) throw new Error(detail ? String(detail) : `Request failed with ${response.status}`);
  return body as T;
}

export type JobDescriptionResponse = {
  id: string;
  original_filename: string;
  status: "uploaded" | "processing" | "ready" | "failed";
  extracted?: string;
  recommendations?: {
    generated_by?: string;
    role_title?: string;
    focus_areas?: string[];
    difficulty?: string;
    panel?: Array<{ id?: string; display_name?: string; role?: string; expertise?: string[]; voice?: string; mood?: string; behavior?: string; interruption_style?: string }>;
    rubric?: Array<{ key: string; label: string; weight: number; description?: string }>;
  } | null;
  error?: string | null;
};

export type ProductPanelist = {
  id?: string;
  display_name: string;
  role: string;
  expertise: string[];
  custom_prompt?: string;
  knowledge_prompt?: string;
  voice: string;
  mood: string;
  behavior: string;
  interruption_style: string;
  avatar_id?: string;
  avatar_vendor?: "liveavatar" | "akool" | "anam" | "generic";
  avatar_image?: string;
};

export type InterviewConfigPayload = {
  title: string;
  profession: "product_management";
  job_description_id?: string;
  difficulty?: "supportive" | "balanced" | "challenging" | "executive";
  duration_minutes: number;
  panel?: ProductPanelist[];
  enabled_tools: string[];
};

export type ProductSession = {
  id: string;
  interview_config_id: string;
  status: string;
  agora_agent_id?: string | null;
  config_snapshot?: Record<string, unknown>;
};

export type StoredLiveSession = {
  sessionId: string;
  agentId: string;
  connection?: AgoraConfig;
  configSnapshot?: Record<string, unknown>;
  demo: boolean;
};

export async function createInterviewConfig(payload: InterviewConfigPayload) {
  return productRequest<{ id: string; status: string }>("/interview-configs", { method: "POST", body: JSON.stringify(payload) });
}

export async function createInterviewSession(interviewConfigId: string) {
  return productRequest<ProductSession>("/sessions", {
    method: "POST",
    body: JSON.stringify({ interview_config_id: interviewConfigId }),
  });
}

export async function startInterviewSession(sessionId: string) {
  const result = await productRequest<{ session: ProductSession; connection: AgoraConfig }>(`/sessions/${sessionId}/start`, {
    method: "POST",
    body: JSON.stringify({ output_audio_codec: "opus" }),
  });
  return { sessionId: result.session.id, agentId: result.session.agora_agent_id ?? "", connection: result.connection, configSnapshot: result.session.config_snapshot, demo: false } satisfies StoredLiveSession;
}

export async function endInterviewSession(sessionId: string) {
  return productRequest<ProductSession>(`/sessions/${sessionId}/end`, { method: "POST" });
}

export function renewInterviewSessionToken(sessionId: string) {
  return productRequest<AgoraConfig>(`/sessions/${sessionId}/token`, { method: "POST" });
}

export async function persistSessionTurn(sessionId: string, turn: {
  sequence: number;
  agora_turn_id?: string;
  speaker_type: "candidate" | "interviewer" | "system";
  speaker_id?: string;
  content: string;
  interrupted?: boolean;
  metadata?: Record<string, unknown>;
}) {
  return productRequest<unknown>(`/sessions/${sessionId}/turns`, { method: "POST", body: JSON.stringify(turn) });
}

export type SessionReport = {
  id: string;
  session_id: string;
  overall_score: number | null;
  readiness: string;
  summary: string;
  competencies: Array<{ key: string; label: string; score: number | null; confidence: number; evidence_turn_ids: string[]; feedback: string }>;
  interviewer_assessments: Array<Record<string, unknown>>;
  evidence_map: Array<Record<string, unknown>>;
  generated_at: string;
};

export type SessionTurn = {
  id: string;
  sequence: number;
  agora_turn_id?: string | null;
  speaker_type: "candidate" | "interviewer" | "system";
  speaker_id?: string | null;
  content: string;
  interrupted: boolean;
  started_at?: string | null;
};

export type SessionToolRun = {
  id: string;
  session_id: string;
  transcript_turn_id?: string | null;
  panelist_id?: string | null;
  tool_name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  status: string;
  error?: string | null;
  created_at: string;
};

export type SessionReplayDrill = {
  id: string;
  session_id: string;
  competency: string;
  prompt: string;
  source_turn_ids: string[];
  status: string;
  created_at: string;
};

export function generateSessionReport(sessionId: string) {
  return productRequest<SessionReport>(`/sessions/${sessionId}/report`, { method: "POST" });
}

export function getSessionReport(sessionId: string) {
  return productRequest<SessionReport>(`/sessions/${sessionId}/report`);
}

export function listSessionTurns(sessionId: string) {
  return productRequest<SessionTurn[]>(`/sessions/${sessionId}/turns`);
}

export function listSessionToolRuns(sessionId: string) {
  return productRequest<SessionToolRun[]>(`/sessions/${sessionId}/tool-runs`);
}

export function listSessionReplayDrills(sessionId: string) {
  return productRequest<SessionReplayDrill[]>(`/sessions/${sessionId}/replay-drills`);
}

export function generateSessionReplayDrills(sessionId: string) {
  return productRequest<SessionReplayDrill[]>(`/sessions/${sessionId}/replay-drills`, { method: "POST" });
}

export async function uploadJobDescription(file: File) {
  const form = new FormData();
  form.set("file", file);
  return productRequest<JobDescriptionResponse>("/job-descriptions", { method: "POST", body: form });
}

export async function refreshJobRecommendations(id: string) {
  return productRequest<JobDescriptionResponse>(`/job-descriptions/${id}/recommendations`, { method: "POST" });
}

export function saveLiveSession(session: StoredLiveSession) {
  window.sessionStorage.setItem("roundcraft.live_session", JSON.stringify(session));
}

export function readLiveSession(): StoredLiveSession | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem("roundcraft.live_session");
  if (!value) return null;
  try { return JSON.parse(value) as StoredLiveSession; } catch { return null; }
}

export async function authenticateUser(mode: "sign-in" | "sign-up", email: string, password: string) {
  if (demoModeEnabled) {
    const token = `dev:${demoUserId}`;
    window.localStorage.setItem("roundcraft.supabase_access_token", token);
    return { accessToken: token, confirmationRequired: false, demo: true };
  }
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase authentication is not configured");
  const path = mode === "sign-up" ? "/auth/v1/signup" : "/auth/v1/token?grant_type=password";
  const response = await fetch(`${supabaseUrl}${path}`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => null) as { access_token?: string; refresh_token?: string; session?: { access_token?: string; refresh_token?: string }; msg?: string; error_description?: string } | null;
  if (!response.ok) throw new Error(body?.msg || body?.error_description || "Authentication failed");
  const accessToken = body?.access_token || body?.session?.access_token;
  if (accessToken) window.localStorage.setItem("roundcraft.supabase_access_token", accessToken);
  const refreshToken = body?.refresh_token || body?.session?.refresh_token;
  if (refreshToken) window.localStorage.setItem("roundcraft.supabase_refresh_token", refreshToken);
  return { accessToken: accessToken ?? null, confirmationRequired: !accessToken && mode === "sign-up", demo: false };
}
