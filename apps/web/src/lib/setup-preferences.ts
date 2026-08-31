export type SetupDifficulty = "supportive" | "balanced" | "challenging" | "executive";
export type TargetLevel = "associate" | "pm" | "senior" | "lead";

export type SetupDefaults = {
  title: string;
  duration: "20" | "35" | "45" | "60";
  difficulty: SetupDifficulty;
  panelSize: number;
  allowInterruption: boolean;
  targetLevel: TargetLevel;
};

export type PromptTemplateIdentity = {
  id: string;
  slug: string;
  version: number;
  is_builtin: boolean;
};

const DURATIONS = [20, 35, 45, 60] as const;
const DIFFICULTIES: SetupDifficulty[] = ["supportive", "balanced", "challenging", "executive"];
const INTERVIEWER_CALLABLE_TOOLS = new Set<string>(["knowledge_search", "calculator", "web_search"]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nearestDuration(value: unknown): SetupDefaults["duration"] {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return "35";
  return String(DURATIONS.reduce((nearest, candidate) => (
    Math.abs(candidate - duration) < Math.abs(nearest - duration) ? candidate : nearest
  ))) as SetupDefaults["duration"];
}

function targetLevelFromRole(targetRole: string): TargetLevel {
  const normalized = targetRole.toLowerCase();
  if (/\b(group|lead|director|head|vp|chief)\b/.test(normalized)) return "lead";
  if (/\b(senior|sr\.?|principal)\b/.test(normalized)) return "senior";
  if (/\b(associate|apm|junior)\b/.test(normalized)) return "associate";
  return "pm";
}

export function setupDefaultsFromMetadata(metadata: unknown): SetupDefaults {
  const userMetadata = record(metadata);
  const preferences = record(userMetadata.roundcraft_preferences);
  const targetRole = String(userMetadata.target_role || "Senior Product Manager").trim() || "Senior Product Manager";
  const storedDifficulty = String(preferences.difficulty || "challenging") as SetupDifficulty;
  const rawPanelSize = Number(preferences.panel_size);
  const panelSize = Number.isFinite(rawPanelSize) ? Math.min(5, Math.max(2, Math.round(rawPanelSize))) : 3;

  return {
    title: `${targetRole} practice`,
    duration: nearestDuration(preferences.duration_minutes),
    difficulty: DIFFICULTIES.includes(storedDifficulty) ? storedDifficulty : "challenging",
    panelSize,
    allowInterruption: preferences.allow_interruption !== false,
    targetLevel: targetLevelFromRole(targetRole),
  };
}

export function selectBuiltInTemplate<T extends PromptTemplateIdentity>(templates: readonly T[], slug: string): T | undefined {
  return templates.reduce<T | undefined>((selected, template) => {
    if (!template.is_builtin || template.slug !== slug) return selected;
    if (!selected || template.version > selected.version) return template;
    if (template.version === selected.version && template.id.localeCompare(selected.id) < 0) return template;
    return selected;
  }, undefined);
}

export function interviewerCallableTools(enabledTools: readonly string[]): string[] {
  return [...new Set(enabledTools.filter((tool) => INTERVIEWER_CALLABLE_TOOLS.has(tool)))];
}

export function roleScopedTools(enabledTools: readonly string[], role: string, behavior = ""): string[] {
  const descriptor = `${role} ${behavior}`.toLowerCase();
  const canCalculate = /(analytic|metric|data|growth|strategy|technical|engineering|estimat)/.test(descriptor);
  const canSearchWeb = /(strategy|market|growth|business|platform|api|technical|engineering)/.test(descriptor);
  return interviewerCallableTools(enabledTools).filter((tool) => (
    tool === "knowledge_search"
    || (tool === "calculator" && canCalculate)
    || (tool === "web_search" && canSearchWeb)
  ));
}

export function interruptionStyle(allowInterruption: boolean): "candidate_barge_in" | "uninterruptible" {
  return allowInterruption ? "candidate_barge_in" : "uninterruptible";
}
