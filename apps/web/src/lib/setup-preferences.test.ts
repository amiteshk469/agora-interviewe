import { describe, expect, it } from "vitest";
import { bestRolePackId, interruptionStyle, interviewerCallableTools, jdFocusForRolePack, promptMatchesRolePack, roleScopedTools, scoringFocusForRolePack, selectBuiltInTemplate, selectPanelPromptTemplate, serializeSetupPanelist, setupDefaultsFromMetadata } from "./setup-preferences";

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
      targetRole: "Group Product Manager",
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
      targetRole: "Associate Product Manager",
      duration: "35",
      difficulty: "challenging",
      panelSize: 5,
      allowInterruption: true,
      targetLevel: "associate",
    });
  });
});

describe("role-first setup", () => {
  const packs = [
    { id: "product_management", label: "Product Management", family: "Product & Strategy", summary: "Product judgment and prioritization." },
    { id: "software_engineering", label: "Software Engineering", family: "Engineering", summary: "Software, systems, and coding interviews." },
    { id: "machine_learning", label: "Machine Learning & AI", family: "Data & AI", summary: "ML modelling and production interviews." },
  ];

  it("maps a saved target role to catalogue metadata instead of a hardcoded profession map", () => {
    expect(bestRolePackId("Senior Software Engineer", packs)).toBe("software_engineering");
    expect(bestRolePackId("Back-end Developer", packs)).toBe("software_engineering");
    expect(bestRolePackId("Front End Developer", packs)).toBe("software_engineering");
    expect(bestRolePackId("ML Engineer", packs)).toBe("machine_learning");
    expect(bestRolePackId("Unlisted role", packs)).toBe("product_management");
  });

  it("keeps legacy PM prompts out of non-PM role defaults", () => {
    const legacyPm = { slug: "pm-product-sense", role: "Product Sense Interviewer", knowledge: {} };
    const taggedEngineering = { slug: "systems-design", role: "Systems Architect", knowledge: { role_pack_id: "software_engineering" } };

    expect(promptMatchesRolePack(legacyPm, "product_management", "Product Sense Interviewer")).toBe(true);
    expect(promptMatchesRolePack(legacyPm, "software_engineering", "Staff Engineer")).toBe(false);
    expect(promptMatchesRolePack(taggedEngineering, "software_engineering", "Staff Engineer")).toBe(true);
  });

  it("derives scoring keys from the selected role pack rubric", () => {
    const rubric = [
      { key: "code_quality", label: "Code quality" },
      { key: "system_design", label: "System design" },
      { key: "communication", label: "Communication" },
    ];
    expect(scoringFocusForRolePack("System design", rubric)).toEqual(["system_design", "communication"]);
    expect(scoringFocusForRolePack("Mixed software engineering interview", rubric)).toEqual(["code_quality", "system_design", "communication"]);
  });

  it("uses a JD only to refine focus within the selected role pack", () => {
    const rubric = [
      { key: "code_quality", label: "Code quality" },
      { key: "system_design", label: "System design" },
    ];
    const selectedPanel = ["Coding Interviewer", "Systems Design Interviewer"];

    expect(jdFocusForRolePack(["system_design"], rubric, "Code quality")).toBe("System design");
    expect(jdFocusForRolePack(["product_judgment"], rubric, "Code quality")).toBe("Code quality");
    expect(selectedPanel).toEqual(["Coding Interviewer", "Systems Design Interviewer"]);
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

  it("preserves a pack default when its required slug or interviewer role does not match exactly", () => {
    const templates = [
      { id: "product-sense", slug: "pm-product-sense", version: 2, is_builtin: true, role: "Product Sense Interviewer", knowledge: {} },
      { id: "hiring-manager", slug: "pm-hiring-manager", version: 1, is_builtin: true, role: "Hiring Manager", knowledge: {} },
    ];

    expect(selectPanelPromptTemplate(templates, "product_management", "Hiring Manager", "pm-product-sense")).toBeUndefined();
    expect(selectPanelPromptTemplate(templates, "product_management", "Hiring Manager", "missing-slug")).toBeUndefined();
    expect(selectPanelPromptTemplate(templates, "product_management", "Hiring Manager")?.id).toBe("hiring-manager");
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

  it("never serializes platform workflow actions as interviewer-callable tools", () => {
    expect(interviewerCallableTools([
      "knowledge_search",
      "evidence_bookmark",
      "calculator",
      "replay",
      "web_search",
      "knowledge_search",
    ])).toEqual(["knowledge_search", "calculator", "web_search"]);
  });

  it("uses the runtime's literal uninterruptible value when barge-in is disabled", () => {
    expect(interruptionStyle(true)).toBe("candidate_barge_in");
    expect(interruptionStyle(false)).toBe("uninterruptible");
  });

  it("serializes role-pack prompt metadata and panel tool policy without inventing a custom prompt", () => {
    const serialized = serializeSetupPanelist({
      id: "systems",
      name: "Maya Rao",
      role: "Systems Design Interviewer",
      prompt: "Use the stable role-pack prompt for a systems design interview.",
      defaultPrompt: "Use the stable role-pack prompt for a systems design interview.",
      promptSlug: "software-systems-design",
      allowedTools: ["knowledge_search", "web_search", "replay"],
      expertise: ["distributed systems", "scalability", "storage"],
      voice: "indian-calm",
      mood: "Focused",
      behavior: "Challenges tradeoffs",
    }, {
      focus: "System design",
      targetLevelLabel: "Senior Software Engineer",
      difficulty: "challenging",
      rolePackLabel: "Software Engineering",
      hasCustomOverride: false,
      enabledTools: ["knowledge_search", "calculator", "web_search"],
      allowInterruption: true,
      useJobDescription: true,
    });
    const requestPanel = JSON.parse(JSON.stringify([serialized]));

    expect(requestPanel[0]).toMatchObject({
      default_prompt: "Use the stable role-pack prompt for a systems design interview.",
      prompt_slug: "software-systems-design",
      allowed_tools: ["knowledge_search", "web_search"],
      expertise: [
        "distributed systems",
        "scalability",
        "storage",
        "System design",
        "Senior Software Engineer",
        "Difficulty: challenging",
        "Systems Design Interviewer",
        "Challenges tradeoffs",
      ],
      interruption_style: "candidate_barge_in",
    });
    expect(requestPanel[0]).not.toHaveProperty("custom_prompt");
    expect(requestPanel[0].knowledge_prompt).toContain("It refines, but does not replace, the target profession.");
  });
});
