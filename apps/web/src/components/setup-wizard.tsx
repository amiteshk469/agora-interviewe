"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BriefcaseBusiness,
  Check,
  Code2,
  Copy,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { PanelIdentity } from "@/components/panel-video";
import { Alert, Avatar, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, CheckRow, Field, Input, Select, Separator, Stepper, Textarea } from "@/components/ui";
import { defaultPanelists, type Panelist } from "@/data/demo";
import {
  createInterviewConfig,
  createInterviewSession,
  createPromptTemplate,
  demoModeEnabled,
  forkPromptTemplate,
  listPromptTemplates,
  listRolePacks,
  readLiveSession,
  saveLiveSession,
  startInterviewSession,
  uploadJobDescription,
  type JobDescriptionResponse,
  type PromptTemplateRecord,
  type RolePack,
} from "@/lib/api";
import { bestRolePackId, interruptionStyle, interviewerCallableTools, jdFocusForRolePack, promptMatchesRolePack, roleScopedTools, scoringFocusForRolePack, selectPanelPromptTemplate, serializeSetupPanelist, setupDefaultsFromMetadata, type SetupDifficulty, type TargetLevel } from "@/lib/setup-preferences";
import { languageLabel } from "@/lib/code-highlight";
import { cn } from "@/lib/utils";

const steps = ["Role", "Documents", "Panel", "Prompts", "Review"];
const interviewerToolOptions = [
  { id: "knowledge_search", label: "Knowledge search", detail: "JD and uploaded context", roles: "All panelists", safe: true },
  { id: "calculator", label: "Calculator", detail: "Allowlisted role calculations", roles: "Quantitative interviewers", safe: true },
  { id: "web_search", label: "Web search", detail: "Fresh public facts", roles: "Strategy, optional", safe: false },
];
const platformCapabilities = [
  { id: "evidence_bookmark", label: "Evidence linking", detail: "RoundCraft links final transcript turns to assessment claims." },
  { id: "replay", label: "Replay drills", detail: "RoundCraft creates focused practice from post-session evidence gaps." },
];
const availablePanelists: Panelist[] = [
  ...defaultPanelists,
  { id: "behavioral", name: "Noah Williams", role: "Behavioral", initials: "NW", avatarImage: "/avatars/marcus-chen.png", avatarId: "noah-williams", avatarVendor: "liveavatar", mood: "Warm", behavior: "Probes evidence", voice: "indian-advisor", prompt: "Test leadership, collaboration, influence, conflict, and reflective learning." },
  { id: "execution", name: "Sofia Patel", role: "Execution", initials: "SP", avatarImage: "/avatars/priya-nair.png", avatarId: "sofia-patel", avatarVendor: "liveavatar", mood: "Focused", behavior: "Tests decisions", voice: "indian-anchor", prompt: "Test delivery planning, risks, prioritization, cross-functional execution, and decision quality." },
];
const avatarOptions = defaultPanelists.map((person) => ({ id: person.avatarId, label: person.name, image: person.avatarImage }));
const panelBehaviorOptions = ["Probes assumptions", "Challenges metrics", "Finds contradictions", "Probes evidence", "Tests decisions"];

type DocumentState = "empty" | "processing" | "ready" | "error" | "skipped";
type MicrophoneStatus = "idle" | "testing" | "ready" | "error";
type PromptMode = "forked" | "custom";
type PreUploadSnapshot = {
  focus: string;
};

const TARGET_LEVELS: TargetLevel[] = ["associate", "pm", "senior", "lead"];

// Used until the role pack catalogue loads, and if it ever fails to.
const fallbackLevelLabels: Record<TargetLevel, string> = {
  associate: "Associate PM",
  pm: "Product Manager",
  senior: "Senior Product Manager",
  lead: "Lead or Group PM",
};

function promptSlug(name: string) {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "interviewer-prompt";
  return `${base}-${Date.now().toString(36)}`;
}

function promptTabId(panelistId: string, index: number) {
  return `prompt-tab-${index}-${panelistId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function assignBuiltInTemplates(people: Panelist[], templates: PromptTemplateRecord[], rolePackId: string, promptSlugs: Record<string, string> = {}) {
  const promptTemplateIds: Record<string, string> = {};
  const panel = people.map((person) => {
    const template = selectPanelPromptTemplate(templates, rolePackId, person.role, promptSlugs[person.id]);
    if (!template) return { ...person };
    promptTemplateIds[person.id] = template.id;
    return { ...person, role: template.role, prompt: template.prompt };
  });
  return { panel, promptTemplateIds };
}

function customPromptForRole(role: string, behavior: string, targetRole: string, expertise = "the role's core hiring signals") {
  return `You are the ${role} on a non-round-robin ${targetRole} interview panel. Test ${expertise}. ${behavior}. Ask one focused, adaptive question at a time, test claims with transcript evidence, and never request human review or escalation.`;
}

function scoringFocusForPrimaryFocus(focus: string) {
  if (focus === "Execution and delivery") return ["execution", "communication"];
  if (focus === "Behavioral leadership") return ["leadership", "communication"];
  if (focus === "Product strategy") return ["product_judgment", "execution", "communication"];
  if (focus === "Mixed product interview") return ["product_judgment", "execution", "analytics", "leadership", "communication"];
  return ["product_judgment", "analytics", "communication"];
}

type PanelRecommendation = {
  id?: string;
  display_name?: string;
  role?: string;
  expertise?: string[];
  voice?: string;
  mood?: string;
  behavior?: string;
  custom_prompt?: string;
  default_prompt?: string;
  prompt_slug?: string;
  allowed_tools?: string[];
};

function resolveRecommendedPanel(recommended: readonly PanelRecommendation[] | undefined, targetPack: RolePack | null, templates: PromptTemplateRecord[], rolePackId: string, usePackDefaults = false) {
  if (!recommended || recommended.length < 2 || recommended.length > 5) return null;
  const targetRole = targetPack?.label ?? "target role";
  const promptSlugs: Record<string, string> = {};
  const people = recommended.map((person, index) => {
    const fallback = availablePanelists[index % availablePanelists.length];
    const role = person.role || `${targetRole} Interviewer`;
    const name = person.display_name || `${role} specialist`;
    const id = person.id || `recommended-${index + 1}`;
    const expertise = person.expertise?.join(", ") || `${targetRole} hiring signals`;
    const defaultPrompt = usePackDefaults ? person.default_prompt?.trim() : undefined;
    const promptSlug = usePackDefaults ? person.prompt_slug?.trim() : undefined;
    const prompt = defaultPrompt || person.custom_prompt?.trim() || customPromptForRole(role, person.behavior || "Probe evidence", targetRole, expertise);
    if (promptSlug) promptSlugs[id] = promptSlug;
    return {
      id,
      name,
      role,
      initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
      avatarImage: fallback.avatarImage,
      avatarId: fallback.avatarId,
      avatarVendor: fallback.avatarVendor,
      mood: person.mood || "Focused",
      behavior: person.behavior || "Probes evidence",
      voice: person.voice || "indian-calm",
      prompt,
      defaultPrompt,
      promptSlug,
      allowedTools: person.allowed_tools ? [...person.allowed_tools] : undefined,
      expertise: person.expertise ? [...person.expertise] : undefined,
    } satisfies Panelist;
  });
  const assigned = assignBuiltInTemplates(people, templates, rolePackId, promptSlugs);
  return { ...assigned, promptSlugs };
}

export function SetupWizard() {
  const router = useRouter();
  const { user } = useAuth();
  const initialDefaults = setupDefaultsFromMetadata(user?.user_metadata);
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(initialDefaults.title);
  const [focus, setFocus] = useState("Product sense and analytics");
  const [duration, setDuration] = useState(initialDefaults.duration);
  const [difficulty, setDifficulty] = useState<SetupDifficulty>(initialDefaults.difficulty);
  const [targetLevel, setTargetLevel] = useState<TargetLevel>(initialDefaults.targetLevel);
  const [allowInterruption, setAllowInterruption] = useState(initialDefaults.allowInterruption);
  const [documentState, setDocumentState] = useState<DocumentState>("empty");
  const [fileName, setFileName] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [jdDisposition, setJdDisposition] = useState<"apply" | "edit" | "ignore">("apply");
  const [jdRecommendations, setJdRecommendations] = useState<JobDescriptionResponse["recommendations"]>(null);
  const [panel, setPanel] = useState<Panelist[]>(defaultPanelists.slice(0, initialDefaults.panelSize));
  const [activePrompt, setActivePrompt] = useState(defaultPanelists[0].id);
  const [panelDifficulty, setPanelDifficulty] = useState<Record<string, SetupDifficulty>>({});
  const [promptMode, setPromptMode] = useState<Record<string, PromptMode>>({});
  const [promptNames, setPromptNames] = useState<Record<string, string>>({});
  const [promptLibrary, setPromptLibrary] = useState<PromptTemplateRecord[]>([]);
  const [promptLibraryLoading, setPromptLibraryLoading] = useState(true);
  const [promptLibraryError, setPromptLibraryError] = useState("");
  const [promptTemplateIds, setPromptTemplateIds] = useState<Record<string, string>>({});
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaveError, setPromptSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [enabledTools, setEnabledTools] = useState(["knowledge_search", "calculator"]);
  const [rolePacks, setRolePacks] = useState<RolePack[]>([]);
  const [rolePacksLoading, setRolePacksLoading] = useState(true);
  const [rolePacksError, setRolePacksError] = useState("");
  const [rolePacksReload, setRolePacksReload] = useState(0);
  const [roleQuery, setRoleQuery] = useState("");
  const [rolePackId, setRolePackId] = useState("product_management");
  const [showAllPrompts, setShowAllPrompts] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileFeedbackRef = useRef<HTMLDivElement>(null);
  const preferencesAppliedFor = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const preUploadSnapshotRef = useRef<PreUploadSnapshot | null>(null);
  const autoAssignmentPanelRef = useRef(panel.map((person) => ({ ...person })));
  const rolePackIdRef = useRef(rolePackId);
  const promptLibraryRef = useRef(promptLibrary);
  const panelPromptSlugsRef = useRef<Record<string, string>>({});
  const initialTargetRoleRef = useRef(initialDefaults.targetRole);
  const canAdd = panel.length < 5;

  const selectedPerson = panel.find((person) => person.id === activePrompt) ?? panel[0];
  const selectedPromptIndex = Math.max(0, panel.findIndex((person) => person.id === selectedPerson.id));
  const assignedPromptTemplate = promptLibrary.find((template) => template.id === promptTemplateIds[selectedPerson.id]);
  const selectedPromptLabel = promptMode[selectedPerson.id] === "custom"
    ? "Custom draft"
    : promptMode[selectedPerson.id] === "forked"
      ? "Private draft"
      : assignedPromptTemplate?.is_builtin === false
        ? "Private"
        : assignedPromptTemplate
          ? "Built-in"
          : selectedPerson.defaultPrompt
            ? "Role default"
            : "Custom";
  const panelIds = useMemo(() => new Set(panel.map((person) => person.id)), [panel]);
  const selectedRolePack = useMemo(() => rolePacks.find((pack) => pack.id === rolePackId) ?? null, [rolePackId, rolePacks]);
  const rolePackGroups = useMemo(() => {
    const query = roleQuery.trim().toLowerCase();
    const visible = rolePacks.filter((pack) => !query || `${pack.label} ${pack.family} ${pack.summary}`.toLowerCase().includes(query));
    return [...new Set(visible.map((pack) => pack.family))].map((family) => ({ family, packs: visible.filter((pack) => pack.family === family) }));
  }, [rolePacks, roleQuery]);
  const panelRoleOptions = useMemo(() => Array.from(new Set([
    ...(selectedRolePack?.panel.map((person) => person.role) ?? []),
    "Hiring Manager",
    "Behavioral Interviewer",
    "Domain Specialist",
  ])), [selectedRolePack]);
  const targetLevelLabels = useMemo<Record<TargetLevel, string>>(() => {
    const levels = selectedRolePack?.levels;
    if (!levels || levels.length !== TARGET_LEVELS.length) return fallbackLevelLabels;
    return Object.fromEntries(TARGET_LEVELS.map((level, index) => [level, levels[index]])) as Record<TargetLevel, string>;
  }, [selectedRolePack]);
  // The rubric is what the panel actually scores, so it is the honest list of
  // things this interview can focus on.
  const focusOptions = useMemo(() => {
    if (!selectedRolePack) return ["Product sense and analytics", "Product strategy", "Execution and delivery", "Behavioral leadership", "Mixed product interview"];
    return [...selectedRolePack.rubric.map((item) => item.label), `Mixed ${selectedRolePack.label.toLowerCase()} interview`];
  }, [selectedRolePack]);
  const roleMatchedPrompts = useMemo(() => promptLibrary.filter((template) => promptMatchesRolePack(template, rolePackId, selectedPerson.role) && template.role.trim().toLowerCase() === selectedPerson.role.trim().toLowerCase()), [promptLibrary, rolePackId, selectedPerson.role]);
  const visiblePromptLibrary = showAllPrompts ? promptLibrary : roleMatchedPrompts;

  function markDirty() {
    dirtyRef.current = true;
    setDirty(true);
  }

  function clearDirty() {
    dirtyRef.current = false;
    setDirty(false);
  }

  useEffect(() => {
    if (user && !dirtyRef.current) initialTargetRoleRef.current = setupDefaultsFromMetadata(user.user_metadata).targetRole;
  }, [user]);

  useEffect(() => {
    if (!user || !rolePacks.length || preferencesAppliedFor.current === user.id) return;
    if (dirtyRef.current) {
      preferencesAppliedFor.current = user.id;
      return;
    }
    const defaults = setupDefaultsFromMetadata(user.user_metadata);
    const nextId = bestRolePackId(defaults.targetRole, rolePacks);
    const pack = rolePacks.find((item) => item.id === nextId) ?? rolePacks[0];
    const resolved = resolveRecommendedPanel(pack.panel, pack, promptLibraryRef.current, pack.id, true);
    const timer = window.setTimeout(() => {
      if (dirtyRef.current) {
        preferencesAppliedFor.current = user.id;
        return;
      }
      preferencesAppliedFor.current = user.id;
      rolePackIdRef.current = pack.id;
      setRolePackId(pack.id);
      setRoleQuery("");
      setTitle(defaults.title);
      setDuration(defaults.duration);
      setDifficulty(defaults.difficulty);
      setTargetLevel(defaults.targetLevel);
      setAllowInterruption(defaults.allowInterruption);
      setEnabledTools(pack.enabled_tools);
      setFocus(pack.rubric[0]?.label ?? `Mixed ${pack.label.toLowerCase()} interview`);
      if (resolved) {
        panelPromptSlugsRef.current = resolved.promptSlugs;
        autoAssignmentPanelRef.current = resolved.panel.map((person) => ({ ...person }));
        setPanel(resolved.panel);
        setPromptTemplateIds(resolved.promptTemplateIds);
        setActivePrompt(resolved.panel[0].id);
        setPanelDifficulty({});
        setPromptMode({});
        setPromptNames({});
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rolePacks, user]);

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (documentState !== "ready" && documentState !== "error") return;
    const frame = window.requestAnimationFrame(() => fileFeedbackRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [documentState]);

  useEffect(() => {
    let cancelled = false;
    void listPromptTemplates()
      .then((templates) => {
        if (cancelled) return;
        promptLibraryRef.current = templates;
        setPromptLibrary(templates);
        setPromptLibraryLoading(false);
        if (dirtyRef.current) return;
        const assigned = assignBuiltInTemplates(autoAssignmentPanelRef.current, templates, rolePackIdRef.current, panelPromptSlugsRef.current);
        autoAssignmentPanelRef.current = assigned.panel.map((person) => ({ ...person }));
        setPanel(assigned.panel);
        setPromptTemplateIds(assigned.promptTemplateIds);
      })
      .catch((cause) => {
        if (!cancelled) {
          setPromptLibraryError(cause instanceof Error ? cause.message : "Prompt templates could not be loaded.");
          setPromptLibraryLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  function capturePreUploadSnapshot() {
    if (preUploadSnapshotRef.current) return;
    preUploadSnapshotRef.current = {
      focus,
    };
  }

  function restorePreUploadSnapshot() {
    const snapshot = preUploadSnapshotRef.current;
    if (!snapshot) return;
    setFocus(snapshot.focus);
  }

  function ignoreJobDescription() {
    restorePreUploadSnapshot();
    setJdDisposition("ignore");
    setNotice("The focus from before the upload was restored. Your selected role and panel were never changed.");
    markDirty();
  }

  function continueWithDefaults() {
    restorePreUploadSnapshot();
    setDocumentState("skipped");
    setJdDisposition("ignore");
    markDirty();
  }

  function hydrateRolePackPanel(targetPack: RolePack) {
    const resolved = resolveRecommendedPanel(targetPack.panel, targetPack, promptLibraryRef.current, targetPack.id, true);
    if (!resolved) return;
    panelPromptSlugsRef.current = resolved.promptSlugs;
    autoAssignmentPanelRef.current = resolved.panel.map((person) => ({ ...person }));
    setPanel(resolved.panel);
    setActivePrompt(resolved.panel[0].id);
    setPanelDifficulty({});
    setPromptMode({});
    setPromptNames({});
    setPromptTemplateIds(resolved.promptTemplateIds);
  }

  async function handleFile(file?: File) {
    if (!file) return;
    capturePreUploadSnapshot();
    markDirty();
    setSaveError("");
    const valid = /\.(pdf|docx|txt|md)$/i.test(file.name) && file.size <= 10 * 1024 * 1024;
    setFileName(file.name);
    if (!valid) {
      setDocumentState("error");
      return;
    }
    setDocumentState("processing");
    setJdDisposition("apply");
    try {
      const uploaded = await uploadJobDescription(file);
      setDocumentId(uploaded.id);
      setJdRecommendations(uploaded.recommendations ?? null);
      if (uploaded.status === "failed") {
        setDocumentState("error");
      } else {
        setFocus(jdFocusForRolePack(uploaded.recommendations?.focus_areas, selectedRolePack?.rubric ?? [], focus));
        setDocumentState("ready");
      }
    } catch (cause) {
      if (demoModeEnabled) {
        window.setTimeout(() => { setDocumentId("demo-jd"); setDocumentState("ready"); }, 700);
      } else {
        setSaveError(cause instanceof Error ? cause.message : "Job description upload failed");
        setDocumentState("error");
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    void listRolePacks()
      .then((packs) => {
        if (cancelled) return;
        setRolePacks(packs);
        setRolePacksLoading(false);
        const nextId = dirtyRef.current && packs.some((pack) => pack.id === rolePackIdRef.current)
          ? rolePackIdRef.current
          : bestRolePackId(initialTargetRoleRef.current, packs);
        const pack = packs.find((item) => item.id === nextId) ?? packs[0];
        if (!pack) {
          setRolePacksError("No interview roles are available from the API.");
          return;
        }
        rolePackIdRef.current = pack.id;
        setRolePackId(pack.id);
        if (!dirtyRef.current) {
          const resolved = resolveRecommendedPanel(pack.panel, pack, promptLibraryRef.current, pack.id, true);
          if (resolved) {
            panelPromptSlugsRef.current = resolved.promptSlugs;
            autoAssignmentPanelRef.current = resolved.panel.map((person) => ({ ...person }));
            setPanel(resolved.panel);
            setActivePrompt(resolved.panel[0].id);
            setPanelDifficulty({});
            setPromptMode({});
            setPromptNames({});
            setPromptTemplateIds(resolved.promptTemplateIds);
          }
          setEnabledTools(pack.enabled_tools);
          setFocus(pack.rubric[0]?.label ?? `Mixed ${pack.label.toLowerCase()} interview`);
        }
      })
      .catch((cause) => {
        if (cancelled) return;
        setRolePacksError(cause instanceof Error ? cause.message : "Interview roles could not be loaded.");
        setRolePacksLoading(false);
      });
    return () => { cancelled = true; };
  }, [rolePacksReload]);

  function updatePanel(id: string, patch: Partial<Panelist>) {
    setPanel((current) => current.map((person) => person.id === id ? { ...person, ...patch } : person));
    setSaveError("");
    markDirty();
    if (documentState === "ready") setJdDisposition("edit");
  }

  function updateInterviewerDifficulty(id: string, value: SetupDifficulty) {
    setPanelDifficulty((current) => ({ ...current, [id]: value }));
    markDirty();
    if (documentState === "ready") setJdDisposition("edit");
  }

  function addPanelist() {
    const next = availablePanelists.find((person) => !panelIds.has(person.id));
    if (next && canAdd) {
      const role = panelRoleOptions[panel.length % panelRoleOptions.length] ?? "Domain Specialist";
      const roleAware = { ...next, role, prompt: customPromptForRole(role, next.behavior, selectedRolePack?.label ?? "target role", focus) };
      const template = selectPanelPromptTemplate(promptLibrary, rolePackId, roleAware.role);
      setPanel((current) => [...current, template ? { ...roleAware, role: template.role, prompt: template.prompt } : roleAware]);
      if (template) setPromptTemplateIds((current) => ({ ...current, [next.id]: template.id }));
      markDirty();
      if (documentState === "ready") setJdDisposition("edit");
    }
  }

  function removePanelist(id: string) {
    if (panel.length <= 2) return;
    setPanel((current) => current.filter((person) => person.id !== id));
    setPromptTemplateIds((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== id)));
    setPromptMode((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== id)));
    setPromptNames((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== id)));
    setPanelDifficulty((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== id)) as Record<string, SetupDifficulty>);
    if (activePrompt === id) setActivePrompt(panel.find((person) => person.id !== id)?.id ?? panel[0].id);
    markDirty();
    if (documentState === "ready") setJdDisposition("edit");
  }

  function toggleTool(id: string) {
    setEnabledTools((current) => current.includes(id) ? current.filter((tool) => tool !== id) : [...current, id]);
    markDirty();
  }

  function chooseRolePack(id: string) {
    const pack = rolePacks.find((item) => item.id === id);
    setRolePackId(id);
    rolePackIdRef.current = id;
    setShowAllPrompts(false);
    setSaveError("");
    markDirty();
    if (!pack) return;
    setTitle((current) => current === initialDefaults.title || rolePacks.some((item) => current === `${item.label} practice`) ? `${pack.label} practice` : current);
    // The pack is a starting point: it seats a panel and picks the tools that
    // track needs, and every one of those stays editable in the next steps.
    hydrateRolePackPanel(pack);
    setEnabledTools(pack.enabled_tools);
    // The previous track's focus is not on this one's menu, so re-anchor it.
    setFocus(pack.rubric[0]?.label ?? `Mixed ${pack.label.toLowerCase()} interview`);
    if (documentState === "ready") setJdDisposition("edit");
  }

  function applyJdRefinement() {
    setFocus(jdFocusForRolePack(jdRecommendations?.focus_areas, selectedRolePack?.rubric ?? [], focus));
    setJdDisposition("apply");
    markDirty();
  }

  function editJdRefinement() {
    setJdDisposition("edit");
    setStep(0);
    markDirty();
  }

  function forkPrompt() {
    setPromptMode((current) => ({ ...current, [selectedPerson.id]: "forked" }));
    setPromptNames((current) => ({
      ...current,
      [selectedPerson.id]: current[selectedPerson.id] || `${selectedPerson.role} interviewer copy`,
    }));
    setPromptSaveError("");
    setNotice(`${selectedPerson.name}'s assigned prompt was copied into an editable private draft.`);
    markDirty();
    if (documentState === "ready") setJdDisposition("edit");
  }

  function customPrompt() {
    setPromptMode((current) => ({ ...current, [selectedPerson.id]: "custom" }));
    setPromptNames((current) => ({ ...current, [selectedPerson.id]: `Custom ${selectedPerson.role} interviewer` }));
    setPromptTemplateIds((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== selectedPerson.id)));
    updatePanel(selectedPerson.id, { prompt: "", defaultPrompt: undefined, promptSlug: undefined, allowedTools: undefined });
    setPromptSaveError("");
    setNotice("Blank custom prompt created. Add the interviewer knowledge and behavior you want.");
    if (documentState === "ready") setJdDisposition("edit");
  }

  function changePanelRole(person: Panelist, role: string) {
    setPromptTemplateIds((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== person.id)));
    setPromptMode((current) => ({ ...current, [person.id]: "custom" }));
    setPromptNames((current) => ({ ...current, [person.id]: `Custom ${role} interviewer` }));
    setPromptSaveError("");
    setNotice(`${person.name}'s role changed. A role-matched custom prompt is ready to edit.`);
    updatePanel(person.id, { role, prompt: customPromptForRole(role, person.behavior, selectedRolePack?.label ?? "target role", focus), defaultPrompt: undefined, promptSlug: undefined, allowedTools: undefined });
  }

  function choosePromptTemplate(template: PromptTemplateRecord) {
    updatePanel(selectedPerson.id, { role: template.role, prompt: template.prompt, defaultPrompt: undefined, promptSlug: undefined, allowedTools: undefined });
    setPromptTemplateIds((current) => ({ ...current, [selectedPerson.id]: template.id }));
    setPromptMode((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== selectedPerson.id)));
    setPromptNames((current) => ({ ...current, [selectedPerson.id]: template.name }));
    setPromptSaveError("");
    setNotice(`${template.name} is now assigned to ${selectedPerson.name}, including its ${template.role} role.`);
  }

  function handlePromptTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const direction = event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? panel.length - 1
        : direction
          ? (index + direction + panel.length) % panel.length
          : index;
    if (!direction && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    setActivePrompt(panel[nextIndex].id);
    setPromptSaveError("");
    window.requestAnimationFrame(() => document.getElementById(promptTabId(panel[nextIndex].id, nextIndex))?.focus());
  }

  function guardPromptLibraryNavigation(event: ReactMouseEvent<HTMLAnchorElement>) {
    if (dirty && !window.confirm("Leave setup? Your unsaved interview configuration will be lost.")) event.preventDefault();
  }

  async function savePromptTemplate() {
    const mode = promptMode[selectedPerson.id];
    if (!mode) return;
    const name = (promptNames[selectedPerson.id] || `${selectedPerson.role} interviewer`).trim();
    const prompt = selectedPerson.prompt.trim();
    if (name.length < 2 || prompt.length < 40) {
      setPromptSaveError("Add a meaningful name and a system prompt of at least 40 characters.");
      return;
    }
    const allowedTools = roleScopedTools(enabledTools, selectedPerson.role, selectedPerson.behavior);
      const knowledge = {
      role_pack_id: rolePackId,
      domains: [focus, selectedPerson.role],
      scoring_focus: selectedRolePack ? scoringFocusForRolePack(focus, selectedRolePack.rubric) : scoringFocusForPrimaryFocus(focus),
    };
    const behavior = {
      mood: selectedPerson.mood,
      style: selectedPerson.behavior,
      allowed_tools: allowedTools,
      panel_selection: "non_round_robin",
      adaptive_probe: `Adapt each follow-up to the candidate's last complete answer. Match a ${panelDifficulty[selectedPerson.id] ?? difficulty} challenge level for ${targetLevelLabels[targetLevel]}. Probe unsupported claims and stop once the transcript contains enough specific evidence to assess the answer.`,
      interruption: interruptionStyle(allowInterruption),
      evidence_policy: "final_transcript_turn_ids_only",
    };
    setPromptSaving(true);
    setPromptSaveError("");
    try {
      const sourceId = promptTemplateIds[selectedPerson.id];
      const saved = mode === "forked" && sourceId
        ? await forkPromptTemplate(sourceId, {
            name,
            description: `Private ${selectedPerson.role} interviewer for ${focus.toLowerCase()}.`,
            prompt,
            knowledge,
            behavior,
          })
        : await createPromptTemplate({
            slug: promptSlug(name),
            name,
            role: selectedPerson.role,
            description: `Private ${selectedPerson.role} interviewer for ${focus.toLowerCase()}.`,
            prompt,
            knowledge,
            behavior,
          });
      setPromptLibrary((current) => [...current.filter((template) => template.id !== saved.id), saved]);
      setPromptTemplateIds((current) => ({ ...current, [selectedPerson.id]: saved.id }));
      setPromptMode((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== selectedPerson.id)));
      setPromptNames((current) => ({ ...current, [selectedPerson.id]: saved.name }));
      setNotice(`${saved.name} was saved to your private prompt library and assigned to ${selectedPerson.name}.`);
      if (documentState === "ready") setJdDisposition("edit");
    } catch (cause) {
      setPromptSaveError(cause instanceof Error ? cause.message : "The prompt could not be saved to your library.");
    } finally {
      setPromptSaving(false);
    }
  }

  async function finalizeConfiguration() {
    if (title.trim().length < 2) {
      setSaveError("Give this interview a clear name before entering the lobby.");
      setStep(0);
      return;
    }
    if (panel.some((person) => person.name.trim().length < 2)) {
      setSaveError("Every interviewer needs a meaningful name of at least two characters.");
      setStep(2);
      return;
    }
    const incompletePrompt = panel.find((person) => (!promptTemplateIds[person.id] || promptMode[person.id]) && person.prompt.trim().length < 40);
    if (incompletePrompt) {
      setSaveError(`${incompletePrompt.name}'s custom prompt needs at least 40 characters.`);
      setActivePrompt(incompletePrompt.id);
      setStep(3);
      return;
    }
    setSaving(true);
    setSaveError("");
    const mappedPanel = panel.map((person) => {
      const interviewerDifficulty = panelDifficulty[person.id] ?? difficulty;
      const roleDefault = person.defaultPrompt;
      const hasCustomOverride = Boolean(promptMode[person.id]) || (!promptTemplateIds[person.id] && (!roleDefault || roleDefault !== person.prompt));
      return serializeSetupPanelist(person, {
        focus,
        targetLevelLabel: targetLevelLabels[targetLevel],
        difficulty: interviewerDifficulty,
        rolePackLabel: selectedRolePack?.label ?? rolePackId,
        promptTemplateId: promptTemplateIds[person.id],
        hasCustomOverride,
        enabledTools,
        allowInterruption,
        useJobDescription: documentState === "ready" && jdDisposition !== "ignore",
      });
    });
    try {
      const config = await createInterviewConfig({
        title: title.trim(),
        profession: rolePackId,
        job_description_id: documentState === "ready" && jdDisposition !== "ignore" && documentId !== "demo-jd" ? documentId : undefined,
        difficulty,
        duration_minutes: Number(duration),
        panel: mappedPanel,
        enabled_tools: interviewerCallableTools(enabledTools),
      });
      const session = await createInterviewSession(config.id);
      saveLiveSession({ sessionId: session.id, agentId: "", configSnapshot: session.config_snapshot, demo: false });
      clearDirty();
      router.push("/interview/lobby");
    } catch (cause) {
      if (demoModeEnabled) {
        saveLiveSession({ sessionId: "demo-session", agentId: "", demo: true });
        clearDirty();
        router.push("/interview/lobby");
      } else {
        setSaveError(cause instanceof Error ? cause.message : "Interview configuration could not be saved");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell screen="setup" title="Create interview" description="Configure the role, optional context, panel behavior, and prompt knowledge before entering the lobby.">
      <div className="mb-8"><Stepper steps={steps} current={step} /></div>
      {notice ? <div className="mb-5"><Alert title="Setup updated" onDismiss={() => setNotice("")}>{notice}</Alert></div> : null}
      {saveError && step !== 4 ? <div className="mb-5"><Alert title="Configuration needs attention" variant="destructive"><span>{saveError}</span></Alert></div> : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <section className="min-w-0" aria-labelledby="wizard-step-title">
          {step === 0 ? (
            <Card className="enter">
              <CardHeader><CardTitle id="wizard-step-title" className="text-xl">Choose your target role</CardTitle><CardDescription>Your role sets the panel, rubric, tools, and coding workspace. You can edit the details after choosing.</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                {rolePacksLoading ? <div className="grid min-h-48 place-items-center rounded-lg border border-dashed bg-background" aria-busy="true"><div className="text-center"><LoaderCircle className="mx-auto size-5 animate-spin text-primary" aria-hidden="true" /><p className="mt-3 text-sm font-medium">Loading interview roles</p></div></div> : null}
                {rolePacksError ? <div className="space-y-3"><Alert title="Interview roles could not be loaded" variant="destructive"><span>{rolePacksError}</span></Alert><Button variant="secondary" onClick={() => { setRolePacksLoading(true); setRolePacksError(""); setRolePacksReload((value) => value + 1); }}>Try again</Button></div> : null}
                {!rolePacksLoading && !rolePacksError && rolePacks.length ? <>
                  <Field label="Find a target role" hint="Search or browse by job family. This remains editable until you enter the lobby.">
                    <Input name="role_search" value={roleQuery} onChange={(event) => setRoleQuery(event.target.value)} placeholder="Search software, data, product, cloud…" />
                  </Field>
                  <fieldset className="max-h-[34rem] space-y-5 overflow-y-auto overscroll-contain pe-1">
                    <legend className="sr-only">Choose target role</legend>
                    {rolePackGroups.map((group) => <section key={group.family} aria-labelledby={`role-family-${group.family.replace(/[^a-z0-9]+/gi, "-")}`}><h3 id={`role-family-${group.family.replace(/[^a-z0-9]+/gi, "-")}`} className="mb-2 text-xs font-medium text-muted-foreground">{group.family}</h3><div className="grid gap-2 md:grid-cols-2">{group.packs.map((pack) => { const selected = pack.id === rolePackId; return <label key={pack.id} className="cursor-pointer"><input type="radio" name="role_pack" value={pack.id} checked={selected} onChange={() => chooseRolePack(pack.id)} className="peer sr-only" /><span className={cn("group flex min-h-28 items-start gap-3 rounded-lg border bg-background p-4 text-start outline-none transition-colors hover:border-primary/50 peer-focus-visible:ring-2 peer-focus-visible:ring-ring motion-reduce:transition-none", selected && "border-primary bg-primary/5 ring-1 ring-primary/20")}><span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-md border bg-card text-muted-foreground", selected && "border-primary/30 text-primary")}>{selected ? <Check className="size-4" aria-hidden="true" /> : <BriefcaseBusiness className="size-4" aria-hidden="true" />}</span><span className="min-w-0"><span className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{pack.label}</span>{pack.supports_coding ? <Badge variant="outline"><Code2 className="size-3" aria-hidden="true" />Coding</Badge> : null}</span><span className="mt-1.5 block text-xs leading-5 text-muted-foreground">{pack.summary}</span></span></span></label>; })}</div></section>)}
                    {!rolePackGroups.length ? <div className="grid min-h-32 place-items-center rounded-lg border border-dashed px-4 text-center"><div><p className="text-sm font-medium">No roles match “{roleQuery}”</p><Button size="sm" variant="ghost" className="mt-2" onClick={() => setRoleQuery("")}>Clear search</Button></div></div> : null}
                  </fieldset>
                </> : null}
                {selectedRolePack ? (
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Interview design for {selectedRolePack.label}</p><Badge variant="default">Selected role</Badge></div>
                    <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2"><div><p className="font-medium text-foreground">Default panel</p><p className="mt-1 leading-5">{selectedRolePack.panel.map((person) => person.role).join(", ")}</p></div><div><p className="font-medium text-foreground">Assessment</p><p className="mt-1 leading-5">{selectedRolePack.rubric.map((item) => item.label).join(", ")}</p></div>{selectedRolePack.coding ? <div className="sm:col-span-2"><p className="font-medium text-foreground">Coding workspace</p><p className="mt-1 leading-5">Opens during relevant questions with {selectedRolePack.coding.languages.map((value) => languageLabel(value)).join(", ")}.</p></div> : null}</div>
                  </div>
                ) : null}
                <Separator />
                <Field label="Interview name" required><Input name="interview_name" value={title} onChange={(event) => { setTitle(event.target.value); setSaveError(""); markDirty(); }} placeholder="Name this interview…" /></Field>
                <div className="grid gap-5 sm:grid-cols-2"><Field label="Primary focus"><Select name="primary_focus" value={focus} onChange={(event) => { setFocus(event.target.value); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }}>{focusOptions.map((option) => <option key={option} value={option}>{option}</option>)}</Select></Field><Field label="Duration"><Select name="duration_minutes" value={duration} onChange={(event) => { setDuration(event.target.value as typeof duration); markDirty(); }}><option value="20">20 minutes</option><option value="35">35 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></Select></Field></div>
                <div className="grid gap-5 sm:grid-cols-2"><Field label="Difficulty"><Select name="difficulty" value={difficulty} onChange={(event) => { setDifficulty(event.target.value as SetupDifficulty); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }}><option value="supportive">Supportive</option><option value="balanced">Balanced</option><option value="challenging">Challenging</option><option value="executive">Executive</option></Select></Field><Field label="Target level"><Select name="target_level" value={targetLevel} onChange={(event) => { setTargetLevel(event.target.value as TargetLevel); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }}>{TARGET_LEVELS.map((level) => <option key={level} value={level}>{targetLevelLabels[level]}</option>)}</Select></Field></div>
                <label className="flex items-start gap-3 rounded-lg border bg-background p-4"><input name="allow_interruption" type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={allowInterruption} onChange={(event) => { setAllowInterruption(event.target.checked); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }} /><span><span className="block text-sm font-medium">Allow natural candidate interruption</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">The candidate can speak over a panelist, and the active interviewer will stop cleanly.</span></span></label>
              </CardContent>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card className="enter">
              <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle id="wizard-step-title" className="text-xl">Refine {selectedRolePack?.label ?? "your role"} with a JD</CardTitle><CardDescription className="mt-1">Optional. A job description adds company context and skill emphasis. It never replaces your selected target role.</CardDescription></div><Badge variant="outline">Optional</Badge></div></CardHeader>
              <CardContent className="space-y-5">
                <input ref={inputRef} id="jd-upload" name="job_description" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="peer sr-only" aria-describedby="jd-upload-help" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void handleFile(file); }} />
                <span id="jd-upload-help" className="sr-only">Accepts PDF, DOCX, TXT, or MD files up to 10 MB.</span>
                {documentState === "empty" || documentState === "skipped" ? (
                  <div className="rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                    <label htmlFor="jd-upload" className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed bg-background p-6 text-center">
                      <span className="grid size-11 place-items-center rounded-lg border bg-card"><UploadCloud className="size-5 text-primary" aria-hidden="true" /></span>
                      <span className="mt-4 text-sm font-medium">Upload a job description</span><span className="mt-1 text-xs text-muted-foreground">Refines {selectedRolePack?.label ?? "the selected role"}. PDF, DOCX, TXT, or MD up to 10 MB.</span>
                    </label>
                    <div className="mt-4 flex justify-center"><Button variant="ghost" onClick={continueWithDefaults}>Continue with defaults</Button></div>
                  </div>
                ) : null}
                {documentState === "processing" ? <div className="grid min-h-48 place-items-center rounded-lg border bg-background text-center" aria-live="polite"><div><LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-hidden="true" /><p className="mt-4 text-sm font-medium">Reading {fileName}</p><p className="mt-1 text-xs text-muted-foreground">Extracting company context and focus signals…</p></div></div> : null}
                {documentState === "error" ? <div ref={fileFeedbackRef} tabIndex={-1} className="space-y-4 outline-none"><Alert title="This file could not be used" variant="destructive">Choose a PDF, DOCX, TXT, or MD file smaller than 10 MB. The interview can still use defaults.</Alert><div className="flex gap-2"><Button variant="secondary" onClick={() => inputRef.current?.click()}>Choose another file</Button><Button variant="ghost" onClick={continueWithDefaults}>Use defaults</Button></div></div> : null}
                {documentState === "ready" ? (
                  <div ref={fileFeedbackRef} tabIndex={-1} className="space-y-5 outline-none">
                    <div className="flex items-center gap-3 rounded-lg border bg-background p-4"><FileText className="size-5 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fileName}</p><p className="text-xs text-muted-foreground">Refining {selectedRolePack?.label ?? "the selected role"}</p></div><Badge variant="default"><Check className="size-3" aria-hidden="true" />Processed</Badge></div>
                    <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">Recommended refinements</h3><p className="mt-1 text-xs text-muted-foreground">Your target remains {selectedRolePack?.label ?? "the selected role"}. The JD only refines context and focus.</p></div><WandSparkles className="size-5 text-primary" aria-hidden="true" /></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Selected panel stays</p><p className="mt-2 text-sm font-medium">{selectedRolePack?.panel.map((person) => person.role).join(", ") || "Role specialists"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{jdRecommendations?.role_title ? `The JD title is ${jdRecommendations.role_title}; it is context, not a new target role.` : "The JD adds company-specific skills and responsibilities."}</p></div><div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Suggested focus</p><p className="mt-2 text-sm font-medium">{jdRecommendations?.focus_areas?.map((area) => area.replaceAll("_", " ")).join(", ") || selectedRolePack?.rubric.slice(0, 2).map((item) => item.label).join(", ") || "Core role signals"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Your configured difficulty remains {difficulty}.</p></div></div></div>
                    <div className="flex flex-wrap gap-2"><Button size="sm" variant={jdDisposition === "apply" ? "default" : "secondary"} onClick={applyJdRefinement}><Sparkles aria-hidden="true" />Apply focus refinement</Button><Button size="sm" variant={jdDisposition === "edit" ? "default" : "secondary"} onClick={editJdRefinement}><SlidersHorizontal aria-hidden="true" />Edit role settings</Button><Button size="sm" variant="ghost" onClick={ignoreJobDescription}>Ignore for configuration</Button><Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>Replace file</Button></div>
                    {jdDisposition === "ignore" ? <Alert title="JD ignored"><span>Your prior focus was restored. The selected role, panel, prompts, and difficulty were never replaced.</span></Alert> : null}
                  </div>
                ) : null}
                {documentState === "skipped" ? <Alert title={`Using ${selectedRolePack?.label ?? "role"} defaults`}><span>No job description will be attached. The selected role pack continues to control the panel and rubric.</span></Alert> : null}
              </CardContent>
            </Card>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5 enter">
              <Alert title="The panel is non-linear"><span>After every candidate answer, a silent director selects the most useful next speaker. A panelist can return later, so the sequence may be 1, 3, 1, 2.</span></Alert>
              <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 id="wizard-step-title" className="text-xl font-semibold">Build your {selectedRolePack?.label ?? "interview"} panel</h2><p className="mt-1 text-sm text-muted-foreground">Choose 2 to 5 interviewers. Every role starts from the selected hiring track.</p></div><div className="flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setStep(0)}>Change target role</Button><Badge variant="outline">{panel.length} of 5</Badge></div></div>
              <div className="space-y-3">
                {panel.map((person, index) => (
                  <Card key={person.id}>
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3"><Avatar initials={person.initials} src={person.avatarImage} alt={`${person.name} avatar`} className="mt-1 size-11" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{person.name}</p>{index === 0 ? <Badge variant="default">Opens interview</Badge> : null}</div><p className="text-xs text-muted-foreground">{person.role}</p></div><Button size="icon" variant="ghost" disabled={panel.length <= 2} onClick={() => removePanelist(person.id)} aria-label={`Remove ${person.name}`}><Trash2 aria-hidden="true" /></Button></div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2"><Field label="Interviewer name" required><Input name={`panel_${person.id}_name`} value={person.name} onChange={(event) => { const name = event.target.value; const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(); updatePanel(person.id, { name, initials }); }} /></Field><Field label="Role"><Select name={`panel_${person.id}_role`} value={person.role} onChange={(event) => changePanelRole(person, event.target.value)}>{Array.from(new Set([person.role, ...panelRoleOptions])).map((role) => <option key={role}>{role}</option>)}</Select></Field></div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Mood"><Select name={`panel_${person.id}_mood`} value={person.mood} onChange={(event) => updatePanel(person.id, { mood: event.target.value })}><option>Calm</option><option>Direct</option><option>Demanding</option><option>Warm</option><option>Focused</option></Select></Field><Field label="Behavior"><Select name={`panel_${person.id}_behavior`} value={person.behavior} onChange={(event) => updatePanel(person.id, { behavior: event.target.value })}>{Array.from(new Set([person.behavior, ...panelBehaviorOptions])).map((behavior) => <option key={behavior}>{behavior}</option>)}</Select></Field></div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Avatar"><Select name={`panel_${person.id}_avatar`} value={person.avatarId} onChange={(event) => { const avatar = avatarOptions.find((option) => option.id === event.target.value); if (avatar) updatePanel(person.id, { avatarId: avatar.id, avatarImage: avatar.image }); }}>{avatarOptions.map((avatar) => <option key={avatar.id} value={avatar.id}>{avatar.label}</option>)}</Select></Field><Field label="Avatar provider"><Select name={`panel_${person.id}_avatar_provider`} value={person.avatarVendor} onChange={(event) => updatePanel(person.id, { avatarVendor: event.target.value as Panelist["avatarVendor"] })}><option value="liveavatar">LiveAvatar (recommended)</option><option value="akool">Akool</option><option value="anam">Anam</option><option value="generic">Generic adapter</option></Select></Field></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Button variant="secondary" onClick={addPanelist} disabled={!canAdd}><Plus aria-hidden="true" />Add interviewer</Button>
              <Card>
                <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="text-base">Session tool policy</CardTitle><CardDescription>Choose what interviewers may call. Evidence linking and replay remain protected RoundCraft workflow stages.</CardDescription></div><Badge variant="outline">{enabledTools.length} interviewer tools</Badge></div></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-2 sm:grid-cols-2">
                    {interviewerToolOptions.map((tool) => <label key={tool.id} className="flex items-start gap-3 rounded-lg border bg-background p-3"><input name={`tool_${tool.id}`} type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={enabledTools.includes(tool.id)} onChange={() => toggleTool(tool.id)} /><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium">{tool.label}{tool.safe ? null : <Badge variant="secondary">Optional</Badge>}</span><span className="mt-1 block text-xs text-muted-foreground">{tool.detail} · {tool.roles}</span></span></label>)}
                  </div>
                  <Separator />
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Always-on platform workflow</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {platformCapabilities.map((capability) => <div key={capability.id} className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3"><span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><Check className="size-3" aria-hidden="true" /></span><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium">{capability.label}<Badge variant="outline">Platform</Badge></span><span className="mt-1 block text-xs text-muted-foreground">{capability.detail}</span></span></div>)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5 enter">
              <div><h2 id="wizard-step-title" className="text-xl font-semibold">Shape {selectedRolePack?.label ?? "interviewer"} knowledge</h2><p className="mt-1 text-sm text-muted-foreground">Start with the role-pack default, choose a matching library prompt, edit a copy, or start blank.</p></div>
              <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
                <div className="space-y-1" role="tablist" aria-label="Panelist prompts" aria-orientation="vertical">{panel.map((person, index) => <button key={person.id} id={promptTabId(person.id, index)} type="button" role="tab" aria-controls="panelist-prompt-editor" aria-selected={activePrompt === person.id} tabIndex={activePrompt === person.id ? 0 : -1} onClick={() => { setActivePrompt(person.id); setPromptSaveError(""); }} onKeyDown={(event) => handlePromptTabKeyDown(event, index)} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${activePrompt === person.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"}`}><Avatar initials={person.initials} src={person.avatarImage} className="size-7" /><span className="truncate">{person.name}</span></button>)}</div>
                <Card id="panelist-prompt-editor" role="tabpanel" aria-labelledby={promptTabId(selectedPerson.id, selectedPromptIndex)} tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{selectedPerson.name}</CardTitle><CardDescription>{selectedPerson.role}</CardDescription></div><Badge variant={promptMode[selectedPerson.id] ? "default" : "secondary"}>{selectedPromptLabel}</Badge></div></CardHeader>
                  <CardContent className="space-y-5">
                    {!promptMode[selectedPerson.id] && assignedPromptTemplate?.is_builtin ? <Alert title="Built-in prompts are protected"><span>Use this role-matched default unchanged, or create an editable copy. The RoundCraft original remains available.</span></Alert> : null}
                    {!promptMode[selectedPerson.id] && !assignedPromptTemplate && selectedPerson.defaultPrompt ? <Alert title="Role-pack default"><span>This prompt was designed for {selectedRolePack?.label ?? "the selected role"}. Edit a copy to customize it without changing the default.</span></Alert> : null}
                    {promptMode[selectedPerson.id] ? <Field label="Prompt name" required><Input name={`prompt_${selectedPerson.id}_name`} value={promptNames[selectedPerson.id] || ""} onChange={(event) => { setPromptNames((current) => ({ ...current, [selectedPerson.id]: event.target.value })); setPromptSaveError(""); markDirty(); }} placeholder="Name this interviewer prompt…" /></Field> : null}
                    <Field label="System prompt" hint={`${selectedPerson.prompt.length} characters`}><Textarea name={`prompt_${selectedPerson.id}_system`} value={selectedPerson.prompt} readOnly={!promptMode[selectedPerson.id]} onChange={(event) => { updatePanel(selectedPerson.id, { prompt: event.target.value }); setPromptSaveError(""); }} className="min-h-44" placeholder="Describe expertise, behavior, interview knowledge, and boundaries…" /></Field>
                    <div className="grid gap-3 sm:grid-cols-2"><Field label="Voice"><Select name={`prompt_${selectedPerson.id}_voice`} value={selectedPerson.voice} onChange={(event) => updatePanel(selectedPerson.id, { voice: event.target.value })}><option value="indian-calm">Indian Calm, woman, composed</option><option value="indian-advisor">Indian Advisor, man, measured</option><option value="indian-anchor">Indian Anchor, woman, precise</option><option value="indian-deep">Indian Deep, man, low and deliberate</option><option value="indian-bright">Indian Bright, woman, energetic</option></Select></Field><Field label="Difficulty"><Select name={`prompt_${selectedPerson.id}_difficulty`} value={panelDifficulty[selectedPerson.id] ?? difficulty} onChange={(event) => updateInterviewerDifficulty(selectedPerson.id, event.target.value as SetupDifficulty)}><option value="supportive">Supportive</option><option value="balanced">Balanced</option><option value="challenging">Challenging</option><option value="executive">Executive</option></Select></Field></div>
                    {promptSaveError ? <Alert title="Prompt could not be saved" variant="destructive"><span>{promptSaveError}</span></Alert> : null}
                    <div className="flex flex-wrap gap-2">{!promptMode[selectedPerson.id] ? <Button size="sm" variant="secondary" onClick={forkPrompt}><Copy aria-hidden="true" />Edit a copy</Button> : null}<Button size="sm" variant="ghost" onClick={customPrompt}><Plus aria-hidden="true" />Write new prompt</Button>{promptMode[selectedPerson.id] ? <Button size="sm" loading={promptSaving} onClick={() => void savePromptTemplate()}><Check aria-hidden="true" />Save to library</Button> : null}</div>
                  </CardContent>
                </Card>
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Prompt library</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Showing prompts matched to {selectedPerson.role} and {selectedRolePack?.label ?? "the target role"}.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="ghost" onClick={() => setShowAllPrompts((value) => !value)}>{showAllPrompts ? "Show role matches" : "Show all prompts"}</Button><Button asChild size="sm" variant="ghost"><Link href="/prompts" onClick={guardPromptLibraryNavigation}>Open full library</Link></Button></div>
                </div>
                {promptLibraryError ? <Alert title="Prompt library unavailable" variant="destructive"><span>{promptLibraryError}</span></Alert> : null}
                {showAllPrompts ? <div className="mb-3"><Alert title="All prompts shown"><span>Prompts outside this role may need editing before they match the selected interview.</span></Alert></div> : null}
                <div className="grid max-h-[28rem] gap-3 overflow-y-auto overscroll-contain pe-1 sm:grid-cols-2">
                  {visiblePromptLibrary.map((template) => (
                    <button key={template.id} type="button" className={cn("rounded-lg border bg-card p-4 text-start outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring", promptTemplateIds[selectedPerson.id] === template.id && !promptMode[selectedPerson.id] && "border-primary/60 bg-primary/5")} onClick={() => choosePromptTemplate(template)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{template.name}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                          {template.is_builtin ? <LockKeyhole className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                          {template.is_builtin ? "RoundCraft" : "Private"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.description}</p>
                      <p className="mt-2 text-[11px] font-medium text-foreground">{template.role}</p>
                    </button>
                  ))}
                </div>
                {promptLibraryLoading ? <div className="grid min-h-28 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground" aria-busy="true">Loading prompt library…</div> : null}
                {!promptLibraryLoading && !visiblePromptLibrary.length && !promptLibraryError ? <div className="grid min-h-28 place-items-center rounded-lg border border-dashed px-4 text-center"><div><p className="text-sm font-medium">No matching library prompts yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The role-pack default above is ready to use. You can edit a copy, start blank, or browse every prompt.</p>{promptLibrary.length ? <Button size="sm" variant="ghost" className="mt-2" onClick={() => setShowAllPrompts(true)}>Show all prompts</Button> : null}</div></div> : null}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-5 enter">
              <Card>
                <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle id="wizard-step-title" className="text-xl">Ready for the lobby</CardTitle><CardDescription className="mt-1">Review the configuration snapshot that will stay attached to this interview.</CardDescription></div><Badge variant="default"><Check aria-hidden="true" />Ready</Badge></div></CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Target role</p><p className="mt-1 text-sm font-medium">{selectedRolePack?.label ?? rolePackId}</p></div><div><p className="text-xs text-muted-foreground">Interview</p><p className="mt-1 text-sm font-medium">{title}</p></div><div><p className="text-xs text-muted-foreground">Primary focus</p><p className="mt-1 text-sm font-medium">{focus}</p></div><div><p className="text-xs text-muted-foreground">Target level</p><p className="mt-1 text-sm font-medium">{targetLevelLabels[targetLevel]}</p></div><div><p className="text-xs text-muted-foreground">Duration</p><p className="mt-1 text-sm font-medium">{duration} minutes</p></div><div><p className="text-xs text-muted-foreground">Difficulty</p><p className="mt-1 capitalize text-sm font-medium">{difficulty}</p></div><div><p className="text-xs text-muted-foreground">Job description</p><p className="mt-1 truncate text-sm font-medium">{documentState === "ready" && jdDisposition !== "ignore" ? `${fileName} · refining role` : "Role defaults only"}</p></div></div>
                  <Separator />
                  <div><p className="mb-3 text-xs text-muted-foreground">Panel sequence is decided live</p><div className="flex flex-wrap gap-2">{panel.map((person) => <div key={person.id} className="flex items-center gap-2 rounded-md border bg-background p-2 pe-3"><Avatar initials={person.initials} src={person.avatarImage} className="size-7" /><span><span className="block text-xs font-medium">{person.name}</span><span className="block text-[10px] capitalize text-muted-foreground">{person.role} · {panelDifficulty[person.id] ?? difficulty}</span></span></div>)}</div></div>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2"><CheckRow>{allowInterruption ? "Candidate barge-in and interruption enabled" : "Panelists finish the current turn before the candidate responds"}</CheckRow><CheckRow>Shared context memory enabled</CheckRow><CheckRow>Transcript evidence required for scores</CheckRow><CheckRow>Tools logged in the session timeline</CheckRow></div>
                  <div><p className="mb-3 text-xs text-muted-foreground">Enabled interviewer tools</p><div className="flex flex-wrap gap-2">{interviewerToolOptions.filter((tool) => enabledTools.includes(tool.id)).map((tool) => <Badge key={tool.id} variant="secondary">{tool.label}</Badge>)}</div></div>
                  <div><p className="mb-3 text-xs text-muted-foreground">Protected platform workflow</p><div className="flex flex-wrap gap-2">{platformCapabilities.map((capability) => <Badge key={capability.id} variant="outline"><Check className="size-3" aria-hidden="true" />{capability.label}</Badge>)}</div></div>
                </CardContent>
              </Card>
              {saveError ? <Alert title="Configuration could not be saved" variant="destructive"><span>{saveError}</span></Alert> : null}
              <div className="flex justify-end"><Button size="lg" loading={saving} onClick={finalizeConfiguration}>Save and enter lobby<ArrowRight aria-hidden="true" /></Button></div>
            </div>
          ) : null}
        </section>

        <aside className="hidden xl:block">
          <Card className="sticky top-20">
            <CardHeader><CardTitle className="text-sm">Configuration snapshot</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm"><div><div className="flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Target role</p>{step === 0 ? null : <Button size="sm" variant="ghost" onClick={() => setStep(0)}>Change</Button>}</div><p className="mt-1 font-medium">{selectedRolePack?.label ?? "Select a role"}</p></div><div><p className="text-xs text-muted-foreground">Focus</p><p className="mt-1">{focus}</p></div><div><p className="text-xs text-muted-foreground">Target level</p><p className="mt-1">{targetLevelLabels[targetLevel]}</p></div><div><p className="text-xs text-muted-foreground">Panel</p><p className="mt-1">{panel.length} interviewers</p></div><div><p className="text-xs text-muted-foreground">JD refinement</p><p className="mt-1">{documentState === "ready" && jdDisposition !== "ignore" ? "Applied to selected role" : "Not applied"}</p></div><Separator /><div className="space-y-2"><CheckRow muted>One audible speaker</CheckRow><CheckRow muted>Adaptive follow-ups</CheckRow><CheckRow muted>Evidence-linked report</CheckRow></div></CardContent>
          </Card>
        </aside>
      </div>

      {step < 4 ? <div className="mt-8 flex items-center justify-between border-t pt-5"><Button variant="ghost" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft aria-hidden="true" />Back</Button><Button onClick={() => setStep((current) => Math.min(4, current + 1))} disabled={step === 0 && (!title.trim() || !selectedRolePack)}>Continue<ArrowRight aria-hidden="true" /></Button></div> : <div className="mt-8"><Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft aria-hidden="true" />Back to prompts</Button></div>}
    </AppShell>
  );
}

export function LobbyScreen() {
  const router = useRouter();
  const [microphoneStatus, setMicrophoneStatus] = useState<MicrophoneStatus>("idle");
  const [microphoneError, setMicrophoneError] = useState("");
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicrophone, setSelectedMicrophone] = useState("default");
  const [session, setSession] = useState<ReturnType<typeof readLiveSession>>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const lobbyPanel = useMemo(() => {
    const snapshot = session?.configSnapshot as { panel?: Array<{ id?: string; display_name?: string; role?: string }>; duration_minutes?: number; difficulty?: string } | undefined;
    return {
      people: snapshot?.panel?.map((person, index) => { const name = person.display_name || `Interviewer ${index + 1}`; return { id: person.id || String(index), name, role: person.role || defaultPanelists[index % defaultPanelists.length].role, initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() }; }) || defaultPanelists,
      duration: snapshot?.duration_minutes || 35,
      difficulty: snapshot?.difficulty || "challenging",
    };
  }, [session]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSession(readLiveSession()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let cancelled = false;
    const loadMicrophones = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) setMicrophones(devices.filter((device) => device.kind === "audioinput" && device.deviceId !== "default"));
      } catch {
        if (!cancelled) setMicrophones([]);
      }
    };
    void loadMicrophones();
    navigator.mediaDevices.addEventListener?.("devicechange", loadMicrophones);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", loadMicrophones);
    };
  }, []);

  async function testMicrophone() {
    setMicrophoneStatus("testing");
    setMicrophoneError("");
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone access requires HTTPS or localhost");
      stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMicrophone === "default" ? true : { deviceId: { exact: selectedMicrophone } },
        video: false,
      });
      if (!stream.getAudioTracks().length) throw new Error("No microphone audio track was available");
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === "audioinput" && device.deviceId !== "default"));
      setMicrophoneStatus("ready");
    } catch (cause) {
      const error = cause as DOMException;
      const message = error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow access in your browser settings and try again."
        : error.name === "NotFoundError"
          ? "No microphone was found. Connect one and try again."
          : error.name === "NotReadableError"
            ? "The microphone is busy in another app. Close that app and try again."
            : error.message || "The microphone test could not start.";
      setMicrophoneError(message);
      setMicrophoneStatus("error");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  async function startInterview() {
    setStarting(true);
    setStartError("");
    try {
      if (session && !session.demo) {
        const started = await startInterviewSession(session.sessionId);
        saveLiveSession(started);
      } else if (demoModeEnabled) {
        saveLiveSession({ sessionId: session?.sessionId ?? "demo-session", agentId: "", demo: true });
      } else {
        throw new Error("Create and save an interview configuration first");
      }
      router.push("/interview/live");
    } catch (cause) {
      if (demoModeEnabled) {
        saveLiveSession({ sessionId: "demo-session", agentId: "", demo: true });
        router.push("/interview/live");
      } else {
        setStartError(cause instanceof Error ? cause.message : "The live session could not start");
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <AppShell screen="setup" title="Interview lobby" description="Check the environment, review the panel, and enter when you are ready.">
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card className="min-h-[28rem] overflow-hidden">
          <div className="surface-grid relative grid min-h-[28rem] place-items-center p-6">
            <div className="relative w-full max-w-2xl text-center">
              <span className="mx-auto grid size-20 place-items-center rounded-xl border bg-card shadow-xl"><Bot className="size-8 text-primary" aria-hidden="true" /></span>
              <h2 className="mt-6 text-xl font-semibold">Your panel is ready</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">The silent director will select one interviewer after every answer. You can interrupt naturally at any time.</p>
              <div className="mx-auto mt-7 grid max-w-xl gap-2 sm:grid-cols-2" aria-label="Configured interview panel">
                {lobbyPanel.people.map((person, index) => (
                  <div key={person.id} className="flex items-center gap-3 rounded-lg border bg-card/88 p-3 text-start shadow-sm backdrop-blur">
                    <PanelIdentity initials={person.initials} seed={person.id || person.name} toneIndex={index} className="size-10 text-xs" />
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{person.role}</span></span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">Device check</CardTitle><Badge variant={session?.demo ? "secondary" : "default"}>{session?.demo ? "Demo" : "Configured"}</Badge></div></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Microphone">
                <Select value={selectedMicrophone} onChange={(event) => { setSelectedMicrophone(event.target.value); setMicrophoneStatus("idle"); setMicrophoneError(""); }}>
                  <option value="default">Default microphone</option>
                  {microphones.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>)}
                </Select>
              </Field>
              <Button variant={microphoneStatus === "ready" ? "secondary" : "default"} className="w-full" loading={microphoneStatus === "testing"} onClick={testMicrophone}>
                {microphoneStatus === "ready" ? <Check aria-hidden="true" /> : <SlidersHorizontal aria-hidden="true" />}
                {microphoneStatus === "ready" ? "Microphone ready" : "Test microphone"}
              </Button>
              {microphoneStatus === "ready" ? <Alert title="Microphone is ready"><span>Permission and audio input were verified. The test stream is now closed.</span></Alert> : null}
              {microphoneStatus === "error" ? <Alert title="Microphone test failed" variant="destructive"><span>{microphoneError}</span></Alert> : null}
            </CardContent>
          </Card>
          <Alert title="Private by default"><span>Recording is off. Live audio uses Agora RTC; final transcript turns and evidence are stored for your report.</span></Alert>
          {startError ? <Alert title="Session could not start" variant="destructive"><span>{startError}</span></Alert> : null}
          <Button size="lg" className="w-full" loading={starting} onClick={startInterview}><Sparkles aria-hidden="true" />Start interview</Button>
          <p className="text-center text-xs text-muted-foreground">{lobbyPanel.duration} minutes · {lobbyPanel.people.length} panelists · {lobbyPanel.difficulty}</p>
        </div>
      </div>
    </AppShell>
  );
}
