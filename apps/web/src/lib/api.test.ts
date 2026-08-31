import { afterEach, describe, expect, it, vi } from "vitest";
import { createInterviewConfig, createInterviewSession, renewInterviewSessionToken, startInterviewSession, stopAgoraAgent } from "./api";

const storage = new Map<string, string>([["roundcraft.supabase_access_token", "test-jwt"]]);
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
};

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
      enabled_tools: ["knowledge_search", "calculator", "evidence_bookmark", "replay"],
    });
    const session = await createInterviewSession(config.id);
    const live = await startInterviewSession(session.id);

    expect(live).toMatchObject({ sessionId: "session-1", agentId: "agent-1", demo: false });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/interview-configs",
      "/v1/sessions",
      "/v1/sessions/session-1/start",
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
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/sessions/session-1/token");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST" });
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });
});
