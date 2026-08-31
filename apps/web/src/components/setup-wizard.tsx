"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
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
  readLiveSession,
  saveLiveSession,
  startInterviewSession,
  uploadJobDescription,
  type JobDescriptionResponse,
  type PromptTemplateRecord,
} from "@/lib/api";
import { interruptionStyle, roleScopedTools, selectBuiltInTemplate, setupDefaultsFromMetadata, type SetupDifficulty, type TargetLevel } from "@/lib/setup-preferences";
import { cn } from "@/lib/utils";

const steps = ["Role", "Documents", "Panel", "Prompts", "Review"];
const toolOptions = [
  { id: "knowledge_search", label: "Knowledge search", detail: "JD and uploaded context", roles: "All panelists", safe: true },
  { id: "calculator", label: "Calculator", detail: "Allowlisted product metrics", roles: "Analytics and strategy", safe: true },
  { id: "web_search", label: "Web search", detail: "Fresh public facts", roles: "Strategy, optional", safe: false },
  { id: "evidence_bookmark", label: "Evidence bookmark", detail: "Link transcript turns", roles: "Evidence pipeline", safe: true },
  { id: "replay", label: "Replay drill", detail: "Create focused practice", roles: "Post-session coach", safe: true },
];
const availablePanelists: Panelist[] = [
  ...defaultPanelists,
  { id: "behavioral", name: "Noah Williams", role: "Behavioral", initials: "NW", avatarImage: "/avatars/marcus-chen.png", avatarId: "noah-williams", avatarVendor: "liveavatar", mood: "Warm", behavior: "Probes evidence", voice: "Ember", prompt: "Test leadership, collaboration, influence, conflict, and reflective learning." },
  { id: "execution", name: "Sofia Patel", role: "Execution", initials: "SP", avatarImage: "/avatars/priya-nair.png", avatarId: "sofia-patel", avatarVendor: "liveavatar", mood: "Focused", behavior: "Tests decisions", voice: "Lumen", prompt: "Test delivery planning, risks, prioritization, cross-functional execution, and decision quality." },
];
const avatarOptions = defaultPanelists.map((person) => ({ id: person.avatarId, label: person.name, image: person.avatarImage }));
const panelRoleOptions = ["Product strategy", "Product analytics", "Bar raiser", "Behavioral", "Execution"];
const panelBehaviorOptions = ["Probes assumptions", "Challenges metrics", "Finds contradictions", "Probes evidence", "Tests decisions"];

type DocumentState = "empty" | "processing" | "ready" | "error" | "skipped";
type MicrophoneStatus = "idle" | "testing" | "ready" | "error";
type PromptMode = "forked" | "custom";
type PreUploadSnapshot = {
  panel: Panelist[];
  difficulty: SetupDifficulty;
  panelDifficulty: Record<string, SetupDifficulty>;
  promptMode: Record<string, PromptMode>;
  promptNames: Record<string, string>;
  promptTemplateIds: Record<string, string>;
  activePrompt: string;
};

const targetLevelLabels: Record<TargetLevel, string> = {
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

function templateForPanelist(person: Pick<Panelist, "id" | "role" | "behavior">, templates: PromptTemplateRecord[]) {
  const descriptor = `${person.id} ${person.role} ${person.behavior}`.toLowerCase();
  const slug = descriptor.includes("growth")
    ? "pm-growth-monetization"
    : descriptor.includes("metric") || descriptor.includes("analytic") || descriptor.includes("data")
      ? "pm-metrics"
      : descriptor.includes("platform") || descriptor.includes("api") || descriptor.includes("engineering")
        ? "pm-platform-api"
        : descriptor.includes("behavior") || descriptor.includes("leadership")
          ? "pm-leadership"
          : descriptor.includes("execution") || descriptor.includes("launch")
            ? "pm-launch-incident"
            : descriptor.includes("strategy") || descriptor.includes("market")
              ? "pm-product-strategy"
              : "pm-product-sense";
  return selectBuiltInTemplate(templates, slug) ?? selectBuiltInTemplate(templates, "pm-product-sense");
}

function assignBuiltInTemplates(people: Panelist[], templates: PromptTemplateRecord[]) {
  const promptTemplateIds: Record<string, string> = {};
  const panel = people.map((person) => {
    const template = templateForPanelist(person, templates);
    if (!template) return { ...person };
    promptTemplateIds[person.id] = template.id;
    return { ...person, role: template.role, prompt: template.prompt };
  });
  return { panel, promptTemplateIds };
}

function customPromptForRole(role: string, behavior: string) {
  return `You are the ${role} in a non-round-robin Product Management interview panel. ${behavior}. Ask one focused, adaptive question at a time, test claims with transcript evidence, and never request human review or escalation.`;
}

function scoringFocusForPrimaryFocus(focus: string) {
  if (focus === "Execution and delivery") return ["execution", "communication"];
  if (focus === "Behavioral leadership") return ["leadership", "communication"];
  if (focus === "Product strategy") return ["product_judgment", "execution", "communication"];
  if (focus === "Mixed product interview") return ["product_judgment", "execution", "analytics", "leadership", "communication"];
  return ["product_judgment", "analytics", "communication"];
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
  const [enabledTools, setEnabledTools] = useState(["knowledge_search", "calculator", "evidence_bookmark", "replay"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileFeedbackRef = useRef<HTMLDivElement>(null);
  const preferencesAppliedFor = useRef<string | null>(user?.id ?? null);
  const dirtyRef = useRef(false);
  const preUploadSnapshotRef = useRef<PreUploadSnapshot | null>(null);
  const autoAssignmentPanelRef = useRef(panel.map((person) => ({ ...person })));
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
        : "Built-in";
  const panelIds = useMemo(() => new Set(panel.map((person) => person.id)), [panel]);

  function markDirty() {
    dirtyRef.current = true;
    setDirty(true);
  }

  function clearDirty() {
    dirtyRef.current = false;
    setDirty(false);
  }

  useEffect(() => {
    if (!user || preferencesAppliedFor.current === user.id) return;
    if (dirty) {
      preferencesAppliedFor.current = user.id;
      return;
    }
    const defaults = setupDefaultsFromMetadata(user.user_metadata);
    const assigned = assignBuiltInTemplates(defaultPanelists.slice(0, defaults.panelSize), promptLibrary);
    const timer = window.setTimeout(() => {
      preferencesAppliedFor.current = user.id;
      setTitle(defaults.title);
      setDuration(defaults.duration);
      setDifficulty(defaults.difficulty);
      setTargetLevel(defaults.targetLevel);
      setAllowInterruption(defaults.allowInterruption);
      autoAssignmentPanelRef.current = assigned.panel.map((person) => ({ ...person }));
      setPanel(assigned.panel);
      setPromptTemplateIds(assigned.promptTemplateIds);
      setActivePrompt(assigned.panel[0].id);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dirty, promptLibrary, user]);

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
        setPromptLibrary(templates);
        setPromptLibraryLoading(false);
        if (dirtyRef.current) return;
        const assigned = assignBuiltInTemplates(autoAssignmentPanelRef.current, templates);
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
      panel: panel.map((person) => ({ ...person })),
      difficulty,
      panelDifficulty: { ...panelDifficulty },
      promptMode: { ...promptMode },
      promptNames: { ...promptNames },
      promptTemplateIds: { ...promptTemplateIds },
      activePrompt,
    };
  }

  function restorePreUploadSnapshot() {
    const snapshot = preUploadSnapshotRef.current;
    if (!snapshot) return;
    const restoredPanel = snapshot.panel.map((person) => ({ ...person }));
    autoAssignmentPanelRef.current = restoredPanel.map((person) => ({ ...person }));
    setPanel(restoredPanel);
    setDifficulty(snapshot.difficulty);
    setPanelDifficulty({ ...snapshot.panelDifficulty });
    setPromptMode({ ...snapshot.promptMode });
    setPromptNames({ ...snapshot.promptNames });
    setPromptTemplateIds({ ...snapshot.promptTemplateIds });
    setActivePrompt(snapshot.activePrompt);
  }

  function ignoreJobDescription() {
    restorePreUploadSnapshot();
    setJdDisposition("ignore");
    setNotice("The panel and difficulty from before the upload were restored. The job description will not configure this interview.");
    markDirty();
  }

  function continueWithDefaults() {
    restorePreUploadSnapshot();
    setDocumentState("skipped");
    setJdDisposition("ignore");
    markDirty();
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
        hydrateRecommendedPanel(uploaded.recommendations?.panel);
        if (["supportive", "balanced", "challenging", "executive"].includes(uploaded.recommendations?.difficulty ?? "")) setDifficulty(uploaded.recommendations?.difficulty as typeof difficulty);
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
      const template = templateForPanelist(next, promptLibrary);
      setPanel((current) => [...current, template ? { ...next, role: template.role, prompt: template.prompt } : next]);
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

  function hydrateRecommendedPanel(recommended = jdRecommendations?.panel) {
    if (recommended && recommended.length >= 2 && recommended.length <= 5) {
      const recommendedPanel = recommended.map((person, index) => {
        const fallback = defaultPanelists[index % defaultPanelists.length];
        const role = person.role || "Product interviewer";
        const name = person.display_name || `${role} specialist`;
        return {
          id: person.id || `recommended-${index + 1}`,
          name,
          role,
          initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
          avatarImage: fallback.avatarImage,
          avatarId: fallback.avatarId,
          avatarVendor: fallback.avatarVendor,
          mood: person.mood || "Focused",
          behavior: person.behavior || "Probes evidence",
          voice: person.voice || "Nova",
          prompt: `Test ${person.expertise?.join(", ") || "product judgment"}. Ask one focused, evidence-seeking follow-up at a time.`,
        } satisfies Panelist;
      });
      const assigned = assignBuiltInTemplates(recommendedPanel, promptLibrary);
      setPanel(assigned.panel);
      setActivePrompt(assigned.panel[0].id);
      setPanelDifficulty({});
      setPromptMode({});
      setPromptNames({});
      setPromptTemplateIds(assigned.promptTemplateIds);
    }
  }

  function applyRecommendedPanel() {
    hydrateRecommendedPanel();
    if (["supportive", "balanced", "challenging", "executive"].includes(jdRecommendations?.difficulty ?? "")) setDifficulty(jdRecommendations?.difficulty as typeof difficulty);
    setJdDisposition("apply");
    markDirty();
  }

  function editRecommendedPanel() {
    hydrateRecommendedPanel();
    setJdDisposition("edit");
    setStep(2);
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
    updatePanel(selectedPerson.id, { prompt: "" });
    setPromptSaveError("");
    setNotice("Blank custom prompt created. Add the interviewer knowledge and behavior you want.");
    if (documentState === "ready") setJdDisposition("edit");
  }

  function changePanelRole(person: Panelist, role: string) {
    const hasAssignedTemplate = Boolean(promptTemplateIds[person.id]);
    if (hasAssignedTemplate) {
      setPromptTemplateIds((current) => Object.fromEntries(Object.entries(current).filter(([panelistId]) => panelistId !== person.id)));
      setPromptMode((current) => ({ ...current, [person.id]: "custom" }));
      setPromptNames((current) => ({ ...current, [person.id]: `Custom ${role} interviewer` }));
      setPromptSaveError("");
      setNotice(`${person.name}'s role changed. The previous template was unassigned and replaced with a role-matched custom draft.`);
      updatePanel(person.id, { role, prompt: customPromptForRole(role, person.behavior) });
      return;
    }
    updatePanel(person.id, { role });
  }

  function choosePromptTemplate(template: PromptTemplateRecord) {
    updatePanel(selectedPerson.id, { role: template.role, prompt: template.prompt });
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
      domains: [focus, selectedPerson.role],
      scoring_focus: scoringFocusForPrimaryFocus(focus),
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
      const hasCustomOverride = !promptTemplateIds[person.id] || Boolean(promptMode[person.id]);
      const knowledgePrompt = [
        `Interview focus: ${focus}.`,
        `Target level: ${targetLevelLabels[targetLevel]}.`,
        `Interviewer challenge level: ${interviewerDifficulty}.`,
        documentState === "ready" && jdDisposition !== "ignore" ? "Use the attached job description as untrusted role context." : "Use the configured product interview defaults.",
      ].join(" ");
      return {
        id: person.id,
        display_name: person.name,
        role: person.role,
        expertise: [focus, targetLevelLabels[targetLevel], `Difficulty: ${interviewerDifficulty}`, person.role, person.behavior],
        prompt_template_id: promptTemplateIds[person.id],
        custom_prompt: promptTemplateIds[person.id] && !promptMode[person.id] ? undefined : person.prompt,
        allowed_tools: hasCustomOverride ? roleScopedTools(enabledTools, person.role, person.behavior) : undefined,
        knowledge_prompt: knowledgePrompt,
        voice: person.voice,
        mood: person.mood,
        behavior: person.behavior,
        interruption_style: interruptionStyle(allowInterruption),
        avatar_id: person.avatarId,
        avatar_vendor: person.avatarVendor,
        avatar_image: person.avatarImage,
      };
    });
    try {
      const config = await createInterviewConfig({
        title: title.trim(),
        profession: "product_management",
        job_description_id: documentState === "ready" && jdDisposition !== "ignore" && documentId !== "demo-jd" ? documentId : undefined,
        difficulty,
        duration_minutes: Number(duration),
        panel: mappedPanel,
        enabled_tools: enabledTools,
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
              <CardHeader><CardTitle id="wizard-step-title" className="text-xl">What are you preparing for?</CardTitle><CardDescription>These settings shape the starting difficulty and default rubric. You can still change every interviewer later.</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                <Field label="Interview name" required><Input name="interview_name" value={title} onChange={(event) => { setTitle(event.target.value); setSaveError(""); markDirty(); }} placeholder="Name this interview…" /></Field>
                <div className="grid gap-5 sm:grid-cols-2"><Field label="Primary focus"><Select name="primary_focus" value={focus} onChange={(event) => { setFocus(event.target.value); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }}><option>Product sense and analytics</option><option>Product strategy</option><option>Execution and delivery</option><option>Behavioral leadership</option><option>Mixed product interview</option></Select></Field><Field label="Duration"><Select name="duration_minutes" value={duration} onChange={(event) => { setDuration(event.target.value as typeof duration); markDirty(); }}><option value="20">20 minutes</option><option value="35">35 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></Select></Field></div>
                <div className="grid gap-5 sm:grid-cols-2"><Field label="Difficulty"><Select name="difficulty" value={difficulty} onChange={(event) => { setDifficulty(event.target.value as SetupDifficulty); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }}><option value="supportive">Supportive</option><option value="balanced">Balanced</option><option value="challenging">Challenging</option><option value="executive">Executive</option></Select></Field><Field label="Target level"><Select name="target_level" value={targetLevel} onChange={(event) => { setTargetLevel(event.target.value as TargetLevel); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }}><option value="associate">Associate PM</option><option value="pm">Product Manager</option><option value="senior">Senior Product Manager</option><option value="lead">Lead or Group PM</option></Select></Field></div>
                <label className="flex items-start gap-3 rounded-lg border bg-background p-4"><input name="allow_interruption" type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={allowInterruption} onChange={(event) => { setAllowInterruption(event.target.checked); markDirty(); if (documentState === "ready") setJdDisposition("edit"); }} /><span><span className="block text-sm font-medium">Allow natural candidate interruption</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">The candidate can speak over a panelist, and the active interviewer will stop cleanly.</span></span></label>
              </CardContent>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card className="enter">
              <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle id="wizard-step-title" className="text-xl">Add role context</CardTitle><CardDescription className="mt-1">The job description is optional. Without it, RoundCraft uses proven product interview defaults.</CardDescription></div><Badge variant="outline">Optional</Badge></div></CardHeader>
              <CardContent className="space-y-5">
                <input ref={inputRef} id="jd-upload" name="job_description" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="peer sr-only" aria-describedby="jd-upload-help" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void handleFile(file); }} />
                <span id="jd-upload-help" className="sr-only">Accepts PDF, DOCX, TXT, or MD files up to 10 MB.</span>
                {documentState === "empty" || documentState === "skipped" ? (
                  <div className="rounded-lg peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                    <label htmlFor="jd-upload" className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed bg-background p-6 text-center">
                      <span className="grid size-11 place-items-center rounded-lg border bg-card"><UploadCloud className="size-5 text-primary" aria-hidden="true" /></span>
                      <span className="mt-4 text-sm font-medium">Upload a job description</span><span className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT, or MD up to 10 MB</span>
                    </label>
                    <div className="mt-4 flex justify-center"><Button variant="ghost" onClick={continueWithDefaults}>Continue with defaults</Button></div>
                  </div>
                ) : null}
                {documentState === "processing" ? <div className="grid min-h-48 place-items-center rounded-lg border bg-background text-center" aria-live="polite"><div><LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-hidden="true" /><p className="mt-4 text-sm font-medium">Reading {fileName}</p><p className="mt-1 text-xs text-muted-foreground">Extracting role signals and panel recommendations…</p></div></div> : null}
                {documentState === "error" ? <div ref={fileFeedbackRef} tabIndex={-1} className="space-y-4 outline-none"><Alert title="This file could not be used" variant="destructive">Choose a PDF, DOCX, TXT, or MD file smaller than 10 MB. The interview can still use defaults.</Alert><div className="flex gap-2"><Button variant="secondary" onClick={() => inputRef.current?.click()}>Choose another file</Button><Button variant="ghost" onClick={continueWithDefaults}>Use defaults</Button></div></div> : null}
                {documentState === "ready" ? (
                  <div ref={fileFeedbackRef} tabIndex={-1} className="space-y-5 outline-none">
                    <div className="flex items-center gap-3 rounded-lg border bg-background p-4"><FileText className="size-5 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fileName}</p><p className="text-xs text-muted-foreground">Role context ready</p></div><Badge variant="default"><Check className="size-3" aria-hidden="true" />Processed</Badge></div>
                    <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">Recommended configuration</h3><p className="mt-1 text-xs text-muted-foreground">Review now. Everything remains editable.</p></div><WandSparkles className="size-5 text-primary" aria-hidden="true" /></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Panel roles</p><p className="mt-2 text-sm font-medium">{jdRecommendations?.panel?.map((person) => person.role || person.display_name).filter(Boolean).join(", ") || "Growth Strategy, Analytics, Bar Raiser"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{jdRecommendations?.role_title ? `Configured for ${jdRecommendations.role_title}.` : "Role stresses experiments, cross-functional execution, and growth loops."}</p></div><div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Rubric focus</p><p className="mt-2 text-sm font-medium">{jdRecommendations?.focus_areas?.map((area) => area.replaceAll("_", " ")).join(", ") || "Analytics, execution"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Suggested difficulty: {jdRecommendations?.difficulty || "challenging"}.</p></div></div></div>
                    <div className="flex flex-wrap gap-2"><Button size="sm" variant={jdDisposition === "apply" ? "default" : "secondary"} onClick={applyRecommendedPanel}><Sparkles aria-hidden="true" />Apply recommendations</Button><Button size="sm" variant={jdDisposition === "edit" ? "default" : "secondary"} onClick={editRecommendedPanel}><SlidersHorizontal aria-hidden="true" />Edit recommendations</Button><Button size="sm" variant="ghost" onClick={ignoreJobDescription}>Ignore for configuration</Button><Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>Replace file</Button></div>
                    {jdDisposition === "ignore" ? <Alert title="Recommendations ignored"><span>The panel, prompts, and difficulty from before this upload were restored. This job description will not be attached.</span></Alert> : null}
                  </div>
                ) : null}
                {documentState === "skipped" ? <Alert title="Using RoundCraft defaults"><span>No job description will be attached. The standard {focus.toLowerCase()} panel and rubric will be used.</span></Alert> : null}
              </CardContent>
            </Card>
          ) : null}

          {step === 2 ? (
            <div className="space-y-5 enter">
              <Alert title="The panel is non-linear"><span>After every candidate answer, a silent director selects the most useful next speaker. A panelist can return later, so the sequence may be 1, 3, 1, 2.</span></Alert>
              <div className="flex items-center justify-between"><div><h2 id="wizard-step-title" className="text-xl font-semibold">Build your panel</h2><p className="mt-1 text-sm text-muted-foreground">Choose 2 to 5 interviewers.</p></div><Badge variant="outline">{panel.length} of 5</Badge></div>
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
                <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="text-base">Session tool policy</CardTitle><CardDescription>Interviewer-callable tools are role-scoped. Evidence and replay actions run in their labeled session stages. Every use is logged.</CardDescription></div><Badge variant="outline">{enabledTools.length} enabled</Badge></div></CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  {toolOptions.map((tool) => <label key={tool.id} className="flex items-start gap-3 rounded-lg border bg-background p-3"><input name={`tool_${tool.id}`} type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={enabledTools.includes(tool.id)} onChange={() => toggleTool(tool.id)} /><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium">{tool.label}{tool.safe ? null : <Badge variant="secondary">Optional</Badge>}</span><span className="mt-1 block text-xs text-muted-foreground">{tool.detail} · {tool.roles}</span></span></label>)}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5 enter">
              <div><h2 id="wizard-step-title" className="text-xl font-semibold">Shape interviewer knowledge</h2><p className="mt-1 text-sm text-muted-foreground">Use a built-in prompt unchanged, edit a private copy, or write a new one.</p></div>
              <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
                <div className="space-y-1" role="tablist" aria-label="Panelist prompts" aria-orientation="vertical">{panel.map((person, index) => <button key={person.id} id={promptTabId(person.id, index)} type="button" role="tab" aria-controls="panelist-prompt-editor" aria-selected={activePrompt === person.id} tabIndex={activePrompt === person.id ? 0 : -1} onClick={() => { setActivePrompt(person.id); setPromptSaveError(""); }} onKeyDown={(event) => handlePromptTabKeyDown(event, index)} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${activePrompt === person.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"}`}><Avatar initials={person.initials} src={person.avatarImage} className="size-7" /><span className="truncate">{person.name}</span></button>)}</div>
                <Card id="panelist-prompt-editor" role="tabpanel" aria-labelledby={promptTabId(selectedPerson.id, selectedPromptIndex)} tabIndex={0} className="outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{selectedPerson.name}</CardTitle><CardDescription>{selectedPerson.role}</CardDescription></div><Badge variant={promptMode[selectedPerson.id] ? "default" : "secondary"}>{selectedPromptLabel}</Badge></div></CardHeader>
                  <CardContent className="space-y-5">
                    {!promptMode[selectedPerson.id] && assignedPromptTemplate?.is_builtin !== false ? <Alert title="Built-in prompts are protected"><span>Use this default unchanged, or create an editable copy. The RoundCraft original remains available.</span></Alert> : null}
                    {promptMode[selectedPerson.id] ? <Field label="Prompt name" required><Input name={`prompt_${selectedPerson.id}_name`} value={promptNames[selectedPerson.id] || ""} onChange={(event) => { setPromptNames((current) => ({ ...current, [selectedPerson.id]: event.target.value })); setPromptSaveError(""); markDirty(); }} placeholder="Name this interviewer prompt…" /></Field> : null}
                    <Field label="System prompt" hint={`${selectedPerson.prompt.length} characters`}><Textarea name={`prompt_${selectedPerson.id}_system`} value={selectedPerson.prompt} readOnly={!promptMode[selectedPerson.id]} onChange={(event) => { updatePanel(selectedPerson.id, { prompt: event.target.value }); setPromptSaveError(""); }} className="min-h-44" placeholder="Describe expertise, behavior, interview knowledge, and boundaries…" /></Field>
                    <div className="grid gap-3 sm:grid-cols-2"><Field label="Voice"><Select name={`prompt_${selectedPerson.id}_voice`} value={selectedPerson.voice} onChange={(event) => updatePanel(selectedPerson.id, { voice: event.target.value })}><option>Nova</option><option>Atlas</option><option>Sage</option><option>Ember</option><option>Lumen</option></Select></Field><Field label="Difficulty"><Select name={`prompt_${selectedPerson.id}_difficulty`} value={panelDifficulty[selectedPerson.id] ?? difficulty} onChange={(event) => updateInterviewerDifficulty(selectedPerson.id, event.target.value as SetupDifficulty)}><option value="supportive">Supportive</option><option value="balanced">Balanced</option><option value="challenging">Challenging</option><option value="executive">Executive</option></Select></Field></div>
                    {promptSaveError ? <Alert title="Prompt could not be saved" variant="destructive"><span>{promptSaveError}</span></Alert> : null}
                    <div className="flex flex-wrap gap-2">{!promptMode[selectedPerson.id] ? <Button size="sm" variant="secondary" onClick={forkPrompt}><Copy aria-hidden="true" />Edit a copy</Button> : null}<Button size="sm" variant="ghost" onClick={customPrompt}><Plus aria-hidden="true" />Write new prompt</Button>{promptMode[selectedPerson.id] ? <Button size="sm" loading={promptSaving} onClick={() => void savePromptTemplate()}><Check aria-hidden="true" />Save to library</Button> : null}</div>
                  </CardContent>
                </Card>
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">Prompt library</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Choose any active RoundCraft or private prompt.</p>
                  </div>
                  <Button asChild size="sm" variant="ghost"><Link href="/prompts" onClick={guardPromptLibraryNavigation}>Open full library</Link></Button>
                </div>
                {promptLibraryError ? <Alert title="Prompt library unavailable" variant="destructive"><span>{promptLibraryError}</span></Alert> : null}
                <div className="grid max-h-[28rem] gap-3 overflow-y-auto overscroll-contain pe-1 sm:grid-cols-2">
                  {promptLibrary.map((template) => (
                    <button key={template.id} type="button" className={cn("rounded-lg border bg-card p-4 text-start outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring", promptTemplateIds[selectedPerson.id] === template.id && !promptMode[selectedPerson.id] && "border-primary/60 bg-primary/5")} onClick={() => choosePromptTemplate(template)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{template.name}</span>
                        <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                          {template.is_builtin ? <LockKeyhole className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                          {template.is_builtin ? "RoundCraft" : "Private"}
                        </span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{template.description}</p>
                    </button>
                  ))}
                </div>
                {promptLibraryLoading ? <div className="grid min-h-28 place-items-center rounded-lg border border-dashed text-xs text-muted-foreground" aria-busy="true">Loading prompt library…</div> : null}
                {!promptLibraryLoading && !promptLibrary.length && !promptLibraryError ? <div className="grid min-h-28 place-items-center rounded-lg border border-dashed px-4 text-center text-xs text-muted-foreground">No active prompts are available yet. Write a custom prompt above and save it to your library.</div> : null}
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-5 enter">
              <Card>
                <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle id="wizard-step-title" className="text-xl">Ready for the lobby</CardTitle><CardDescription className="mt-1">Review the configuration snapshot that will stay attached to this interview.</CardDescription></div><Badge variant="default"><Check aria-hidden="true" />Ready</Badge></div></CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Interview</p><p className="mt-1 text-sm font-medium">{title}</p></div><div><p className="text-xs text-muted-foreground">Primary focus</p><p className="mt-1 text-sm font-medium">{focus}</p></div><div><p className="text-xs text-muted-foreground">Target level</p><p className="mt-1 text-sm font-medium">{targetLevelLabels[targetLevel]}</p></div><div><p className="text-xs text-muted-foreground">Duration</p><p className="mt-1 text-sm font-medium">{duration} minutes</p></div><div><p className="text-xs text-muted-foreground">Difficulty</p><p className="mt-1 capitalize text-sm font-medium">{difficulty}</p></div><div><p className="text-xs text-muted-foreground">Job description</p><p className="mt-1 truncate text-sm font-medium">{documentState === "ready" && jdDisposition !== "ignore" ? `${fileName} · ${jdDisposition}` : "Defaults only"}</p></div></div>
                  <Separator />
                  <div><p className="mb-3 text-xs text-muted-foreground">Panel sequence is decided live</p><div className="flex flex-wrap gap-2">{panel.map((person) => <div key={person.id} className="flex items-center gap-2 rounded-md border bg-background p-2 pe-3"><Avatar initials={person.initials} src={person.avatarImage} className="size-7" /><span><span className="block text-xs font-medium">{person.name}</span><span className="block text-[10px] capitalize text-muted-foreground">{person.role} · {panelDifficulty[person.id] ?? difficulty}</span></span></div>)}</div></div>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2"><CheckRow>{allowInterruption ? "Candidate barge-in and interruption enabled" : "Panelists finish the current turn before the candidate responds"}</CheckRow><CheckRow>Shared context memory enabled</CheckRow><CheckRow>Transcript evidence required for scores</CheckRow><CheckRow>Tools logged in the session timeline</CheckRow></div>
                  <div><p className="mb-3 text-xs text-muted-foreground">Enabled session tools</p><div className="flex flex-wrap gap-2">{toolOptions.filter((tool) => enabledTools.includes(tool.id)).map((tool) => <Badge key={tool.id} variant="secondary">{tool.label}</Badge>)}</div></div>
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
            <CardContent className="space-y-4 text-sm"><div><p className="text-xs text-muted-foreground">Focus</p><p className="mt-1">{focus}</p></div><div><p className="text-xs text-muted-foreground">Target level</p><p className="mt-1">{targetLevelLabels[targetLevel]}</p></div><div><p className="text-xs text-muted-foreground">Panel</p><p className="mt-1">{panel.length} interviewers</p></div><div><p className="text-xs text-muted-foreground">Role context</p><p className="mt-1">{documentState === "ready" && jdDisposition !== "ignore" ? "JD configured" : "RoundCraft defaults"}</p></div><Separator /><div className="space-y-2"><CheckRow muted>One audible speaker</CheckRow><CheckRow muted>Adaptive follow-ups</CheckRow><CheckRow muted>Evidence-linked report</CheckRow></div></CardContent>
          </Card>
        </aside>
      </div>

      {step < 4 ? <div className="mt-8 flex items-center justify-between border-t pt-5"><Button variant="ghost" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft aria-hidden="true" />Back</Button><Button onClick={() => setStep((current) => Math.min(4, current + 1))} disabled={step === 0 && !title.trim()}>Continue<ArrowRight aria-hidden="true" /></Button></div> : <div className="mt-8"><Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft aria-hidden="true" />Back to prompts</Button></div>}
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
