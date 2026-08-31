import { describe, expect, it } from "vitest";
import { interruptionStyle, roleScopedTools, selectBuiltInTemplate, setupDefaultsFromMetadata } from "./setup-preferences";

describe("setupDefaultsFromMetadata", () => {
  it("maps authenticated candidate preferences into supported wizard values", () => {
    expect(setupDefaultsFromMetadata({
      target_role: "Group Product Manager",
      roundcraft_preferences: {
        duration_minutes: 45,
        difficulty: "executive",
        panel_size: 4,
        allow_interruption: false,
      },
    })).toEqual({
      title: "Group Product Manager practice",
      duration: "45",
      difficulty: "executive",
      panelSize: 4,
      allowInterruption: false,
      targetLevel: "lead",
    });
  });

  it("normalizes unsupported and malformed metadata safely", () => {
    expect(setupDefaultsFromMetadata({
      target_role: "Associate Product Manager",
      roundcraft_preferences: {
        duration_minutes: 31,
        difficulty: "impossible",
        panel_size: 99,
      },
    })).toEqual({
      title: "Associate Product Manager practice",
      duration: "35",
      difficulty: "challenging",
      panelSize: 5,
      allowInterruption: true,
      targetLevel: "associate",
    });
  });
});

describe("setup prompt policy", () => {
  it("selects the latest built-in deterministically and never auto-assigns a private fork", () => {
    const templates = [
      { id: "private-v9", slug: "pm-metrics", version: 9, is_builtin: false },
      { id: "built-in-b", slug: "pm-metrics", version: 2, is_builtin: true },
      { id: "built-in-a", slug: "pm-metrics", version: 2, is_builtin: true },
      { id: "built-in-old", slug: "pm-metrics", version: 1, is_builtin: true },
    ];

    expect(selectBuiltInTemplate(templates, "pm-metrics")?.id).toBe("built-in-a");
  });

  it("keeps custom prompt tools role-scoped and bounded by the session policy", () => {
    const enabled = ["knowledge_search", "calculator", "web_search", "evidence_bookmark", "replay"];

    expect(roleScopedTools(enabled, "Behavioral Interviewer", "Probes evidence")).toEqual([
      "knowledge_search",
    ]);
    expect(roleScopedTools(enabled, "Product Strategy Interviewer", "Tests market assumptions")).toEqual([
      "knowledge_search",
      "calculator",
      "web_search",
    ]);
    expect(roleScopedTools(["knowledge_search", "evidence_bookmark"], "Analytics Interviewer")).toEqual([
      "knowledge_search",
    ]);
  });

  it("uses the runtime's literal uninterruptible value when barge-in is disabled", () => {
    expect(interruptionStyle(true)).toBe("candidate_barge_in");
    expect(interruptionStyle(false)).toBe("uninterruptible");
  });
});
