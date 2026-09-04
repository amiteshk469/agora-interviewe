import { afterEach, describe, expect, it, vi } from "vitest";
import { createInterviewConfig, createInterviewSession, createPromptTemplate, forkPromptTemplate, generateSessionReport, heartbeatHostSession, leaveHostSession, listPromptTemplates, readSessionCode, renewHostSessionToken, renewInterviewSessionToken, saveSessionCode, startInterviewSession, stopAgoraAgent } from "./api";

const storage = new Map<string, string>([["roundcraft.supabase_access_token", "test-jwt"]]);
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
};
const productBase = `${process.env.NEXT_PUBLIC_API_BASE_URL ?? ""}/v1`;

afterEach(() => vi.unstubAllGlobals());

describe("configured interview flow", () => {
  it("creates config, creates session, then starts it with bearer auth", async () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "config-1", status: "ready" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "session-1", interview_config_id: "config-1", status: "ready" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        session: { id: "session-1", interview_config_id: "config-1", status: "live", agora_agent_id: "agent-1" },
        connection: { app_id: "app", token: "token", uid: "1001", channel_name: "roundcraft", agent_uid: "10000001" },
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const config = await createInterviewConfig({
      title: "PM practice",
      profession: "product_management",
      difficulty: "challenging",
      duration_minutes: 35,
      enabled_tools: ["knowledge_search", "calculator", "web_search"],
    });
    const session = await createInterviewSession(config.id);
    const live = await startInterviewSession(session.id);

    expect(live).toMatchObject({ sessionId: "session-1", agentId: "agent-1", demo: false });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${productBase}/interview-configs`,
      `${productBase}/sessions`,
      `${productBase}/sessions/session-1/start`,
    ]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-jwt");
  });

  it("accepts the official no-data stop envelope", async () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 0, msg: "stopped" }), { status: 200 })));
    await expect(stopAgoraAgent("agent-1")).resolves.toBeUndefined();
  });

  it("renews a live configured session with the owner-bound endpoint", async () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ app_id: "app", token: "fresh", uid: "1001", channel_name: "roundcraft", agent_uid: "10000001" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(renewInterviewSessionToken("session-1")).resolves.toMatchObject({ token: "fresh" });
    expect(fetchMock.mock.calls[0][0]).toBe(`${productBase}/sessions/session-1/token`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("keeps an invited human interviewer connected through guest-scoped endpoints", async () => {
    const connection = { app_id: "app", token: "fresh", uid: "7001", channel_name: "roundcraft", agent_uid: "10000001" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(connection), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ connected: true, last_seen_at: "2026-09-04T00:00:00Z" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(renewHostSessionToken("invite.token")).resolves.toMatchObject({ uid: "7001" });
    await expect(heartbeatHostSession("invite.token")).resolves.toMatchObject({ connected: true });
    await expect(leaveHostSession("invite.token")).resolves.toBeNull();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${productBase}/guest/sessions/invite.token/token`,
      `${productBase}/guest/sessions/invite.token/heartbeat`,
      `${productBase}/guest/sessions/invite.token/leave`,
    ]);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: "POST", keepalive: true });
  });

  it("regenerates a cached assessment only when explicitly requested", async () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "report-1",
      session_id: "session-1",
      overall_score: 78,
      readiness: "interview_ready",
      summary: "Evidence-backed report",
      competencies: [],
      interviewer_assessments: [],
      evidence_map: [],
      generated_at: "2026-09-01T00:00:00Z",
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await generateSessionReport("session-1", { regenerate: true });

    expect(fetchMock.mock.calls[0][0]).toBe(`${productBase}/sessions/session-1/report?regenerate=true`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
  });

  it("restores and persists an intentionally empty code buffer", async () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    const emptyBuffer = { language: "python", content: "", line_count: 1, updated_at: "2026-09-04T00:00:00Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyBuffer), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(emptyBuffer), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(readSessionCode("session-1")).resolves.toMatchObject({ content: "" });
    await expect(saveSessionCode("session-1", "python", "")).resolves.toMatchObject({ content: "" });

    expect(fetchMock.mock.calls[1][0]).toBe(`${productBase}/sessions/session-1/code`);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ language: "python", content: "" });
  });

  it("lists, creates, and forks immutable prompt templates", async () => {
    vi.stubGlobal("window", { localStorage: localStorageMock });
    const source = {
      id: "prompt-built-in",
      owner_id: null,
      parent_id: null,
      slug: "pm-product-sense",
      version: 2,
      name: "Product Sense",
      role: "Product Sense Interviewer",
      description: "Product judgment",
      prompt: "Ask adaptive product questions and require linked final transcript evidence for each assessment claim.",
      knowledge: { domains: ["product judgment"] },
      behavior: { allowed_tools: ["knowledge_search"] },
      is_builtin: true,
      is_active: true,
      created_at: "2026-09-01T00:00:00Z",
    };
    const created = { ...source, id: "prompt-private", owner_id: "user-1", slug: "my-product-sense-a1b2c3d4", version: 1, is_builtin: false };
    const forked = { ...created, id: "prompt-fork", parent_id: source.id, slug: source.slug };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([source]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(forked), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listPromptTemplates()).resolves.toHaveLength(1);
    await expect(createPromptTemplate({
      slug: created.slug,
      name: created.name,
      role: created.role,
      prompt: created.prompt,
      behavior: created.behavior,
    })).resolves.toMatchObject({ id: "prompt-private" });
    await expect(forkPromptTemplate(source.id, { name: "My Product Sense" })).resolves.toMatchObject({ parent_id: source.id });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${productBase}/prompt-templates`,
      `${productBase}/prompt-templates`,
      `${productBase}/prompt-templates/${source.id}/fork`,
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ name: "My Product Sense" });
  });
});
