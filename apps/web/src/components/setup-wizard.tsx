"use client";

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
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, Avatar, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, CheckRow, Field, Input, Select, Separator, Stepper, Textarea } from "@/components/ui";
import { defaultPanelists, type Panelist, promptTemplates } from "@/data/demo";
import {
  createInterviewConfig,
  createInterviewSession,
  demoModeEnabled,
  readLiveSession,
  saveLiveSession,
  startInterviewSession,
  uploadJobDescription,
  type JobDescriptionResponse,
} from "@/lib/api";

const steps = ["Role", "Documents", "Panel", "Prompts", "Review"];
const toolOptions = [
  { id: "knowledge_search", label: "Knowledge search", detail: "JD and uploaded context", roles: "All panelists", safe: true },
  { id: "calculator", label: "Calculator", detail: "Allowlisted product metrics", roles: "Analytics and strategy", safe: true },
  { id: "web_search", label: "Web search", detail: "Fresh public facts", roles: "Strategy, optional", safe: false },
  { id: "evidence_bookmark", label: "Evidence bookmark", detail: "Link transcript turns", roles: "All panelists", safe: true },
  { id: "replay", label: "Replay drill", detail: "Create focused practice", roles: "Director after session", safe: true },
];
const availablePanelists: Panelist[] = [
  ...defaultPanelists,
  { id: "behavioral", name: "Noah Williams", role: "Behavioral", initials: "NW", avatarImage: "/avatars/marcus-chen.png", avatarId: "noah-williams", avatarVendor: "liveavatar", mood: "Warm", behavior: "Probes evidence", voice: "Ember", prompt: "Test leadership, collaboration, influence, conflict, and reflective learning." },
  { id: "execution", name: "Sofia Patel", role: "Execution", initials: "SP", avatarImage: "/avatars/priya-nair.png", avatarId: "sofia-patel", avatarVendor: "liveavatar", mood: "Focused", behavior: "Tests decisions", voice: "Lumen", prompt: "Test delivery planning, risks, prioritization, cross-functional execution, and decision quality." },
];
const avatarOptions = defaultPanelists.map((person) => ({ id: person.avatarId, label: person.name, image: person.avatarImage }));

type DocumentState = "empty" | "processing" | "ready" | "error" | "skipped";

export function SetupWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("Senior Product Manager practice");
  const [focus, setFocus] = useState("Product sense and analytics");
  const [duration, setDuration] = useState("35");
  const [difficulty, setDifficulty] = useState<"supportive" | "balanced" | "challenging" | "executive">("challenging");
  const [documentState, setDocumentState] = useState<DocumentState>("empty");
  const [fileName, setFileName] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [jdDisposition, setJdDisposition] = useState<"apply" | "edit" | "ignore">("apply");
  const [jdRecommendations, setJdRecommendations] = useState<JobDescriptionResponse["recommendations"]>(null);
  const [panel, setPanel] = useState<Panelist[]>(defaultPanelists);
  const [activePrompt, setActivePrompt] = useState(defaultPanelists[0].id);
  const [promptMode, setPromptMode] = useState<Record<string, "built-in" | "forked" | "custom">>({});
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [enabledTools, setEnabledTools] = useState(["knowledge_search", "calculator", "evidence_bookmark", "replay"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const canAdd = panel.length < 5;

  const selectedPerson = panel.find((person) => person.id === activePrompt) ?? panel[0];
  const panelIds = useMemo(() => new Set(panel.map((person) => person.id)), [panel]);

  async function handleFile(file?: File) {
    if (!file) return;
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
      hydrateRecommendedPanel(uploaded.recommendations?.panel);
      if (["supportive", "balanced", "challenging", "executive"].includes(uploaded.recommendations?.difficulty ?? "")) setDifficulty(uploaded.recommendations?.difficulty as typeof difficulty);
      setDocumentState(uploaded.status === "failed" ? "error" : "ready");
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
    if (documentState === "ready") setJdDisposition("edit");
  }

  function addPanelist() {
    const next = availablePanelists.find((person) => !panelIds.has(person.id));
    if (next && canAdd) setPanel((current) => [...current, next]);
  }

  function removePanelist(id: string) {
    if (panel.length <= 2) return;
    setPanel((current) => current.filter((person) => person.id !== id));
    if (activePrompt === id) setActivePrompt(panel.find((person) => person.id !== id)?.id ?? panel[0].id);
  }

  function toggleTool(id: string) {
    setEnabledTools((current) => current.includes(id) ? current.filter((tool) => tool !== id) : [...current, id]);
  }

  function hydrateRecommendedPanel(recommended = jdRecommendations?.panel) {
    if (recommended && recommended.length >= 2 && recommended.length <= 5) {
      setPanel(recommended.map((person, index) => {
        const fallback = defaultPanelists[index % defaultPanelists.length];
        const name = person.display_name || `Interviewer ${index + 1}`;
        return {
          id: person.id || `recommended-${index + 1}`,
          name,
          role: person.role || "Product interviewer",
          initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
          avatarImage: fallback.avatarImage,
          avatarId: fallback.avatarId,
          avatarVendor: fallback.avatarVendor,
          mood: person.mood || "Focused",
          behavior: person.behavior || "Probes evidence",
          voice: person.voice || "Nova",
          prompt: `Test ${person.expertise?.join(", ") || "product judgment"}. Ask one focused, evidence-seeking follow-up at a time.`,
        };
      }));
    }
  }

  function applyRecommendedPanel() {
    hydrateRecommendedPanel();
    if (["supportive", "balanced", "challenging", "executive"].includes(jdRecommendations?.difficulty ?? "")) setDifficulty(jdRecommendations?.difficulty as typeof difficulty);
    setJdDisposition("apply");
  }

  function editRecommendedPanel() {
    hydrateRecommendedPanel();
    setJdDisposition("edit");
    setStep(2);
  }

  function forkPrompt() {
    setPromptMode((current) => ({ ...current, [selectedPerson.id]: "forked" }));
    setNotice(`${selectedPerson.name}'s built-in prompt was copied into an editable version.`);
    if (documentState === "ready") setJdDisposition("edit");
  }

  function customPrompt() {
    setPromptMode((current) => ({ ...current, [selectedPerson.id]: "custom" }));
    updatePanel(selectedPerson.id, { prompt: "" });
    setNotice("Blank custom prompt created. Add the interviewer knowledge and behavior you want.");
    if (documentState === "ready") setJdDisposition("edit");
  }

  async function finalizeConfiguration() {
    setSaving(true);
    setSaveError("");
    const mappedPanel = panel.map((person) => ({
      id: person.id,
      display_name: person.name,
      role: person.role,
      expertise: [person.role, person.behavior],
      custom_prompt: person.prompt,
      knowledge_prompt: documentState === "ready" && jdDisposition !== "ignore" ? "Use the attached job description as untrusted role context." : undefined,
      voice: person.voice,
      mood: person.mood,
      behavior: person.behavior,
      interruption_style: "candidate_barge_in",
      avatar_id: person.avatarId,
      avatar_vendor: person.avatarVendor,
      avatar_image: person.avatarImage,
    }));
    try {
      const config = await createInterviewConfig({
        title,
        profession: "product_management",
        job_description_id: documentState === "ready" && jdDisposition !== "ignore" && documentId !== "demo-jd" ? documentId : undefined,
        difficulty: jdDisposition === "apply" && documentId && documentId !== "demo-jd" ? undefined : difficulty,
        duration_minutes: Number(duration),
        panel: jdDisposition === "apply" && documentId && documentId !== "demo-jd" ? undefined : mappedPanel,
        enabled_tools: enabledTools,
      });
      const session = await createInterviewSession(config.id);
      saveLiveSession({ sessionId: session.id, agentId: "", configSnapshot: session.config_snapshot, demo: false });
      router.push("/interview/lobby");
    } catch (cause) {
      if (demoModeEnabled) {
        saveLiveSession({ sessionId: "demo-session", agentId: "", demo: true });
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
      {notice ? <div className="mb-5"><Alert title="Prompt copy created" onDismiss={() => setNotice("")}>{notice}</Alert></div> : null}
      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <section className="min-w-0" aria-labelledby="wizard-step-title">
          {step === 0 ? (
            <Card className="enter">
              <CardHeader><CardTitle id="wizard-step-title" className="text-xl">What are you preparing for?</CardTitle><CardDescription>These settings shape the starting difficulty and default rubric. You can still change every interviewer later.</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                <Field label="Interview name" required><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Example: Senior PM interview" /></Field>
                <div className="grid gap-5 sm:grid-cols-2"><Field label="Primary focus"><Select value={focus} onChange={(event) => setFocus(event.target.value)}><option>Product sense and analytics</option><option>Product strategy</option><option>Execution and delivery</option><option>Behavioral leadership</option><option>Mixed product interview</option></Select></Field><Field label="Duration"><Select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="20">20 minutes</option><option value="35">35 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></Select></Field></div>
                <Field label="Difficulty"><Select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="supportive">Supportive</option><option value="balanced">Balanced</option><option value="challenging">Challenging</option><option value="executive">Executive</option></Select></Field>
                <Field label="Target level"><Select defaultValue="senior"><option value="associate">Associate PM</option><option value="pm">Product Manager</option><option value="senior">Senior Product Manager</option><option value="lead">Lead or Group PM</option></Select></Field>
              </CardContent>
            </Card>
          ) : null}

          {step === 1 ? (
            <Card className="enter">
              <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle id="wizard-step-title" className="text-xl">Add role context</CardTitle><CardDescription className="mt-1">The job description is optional. Without it, RoundCraft uses proven product interview defaults.</CardDescription></div><Badge variant="outline">Optional</Badge></div></CardHeader>
              <CardContent className="space-y-5">
                {documentState === "empty" || documentState === "skipped" ? (
                  <div>
                    <input ref={inputRef} id="jd-upload" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" onChange={(event) => void handleFile(event.target.files?.[0])} />
                    <label htmlFor="jd-upload" className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed bg-background p-6 text-center outline-none focus-within:ring-2 focus-within:ring-ring">
                      <span className="grid size-11 place-items-center rounded-lg border bg-card"><UploadCloud className="size-5 text-primary" aria-hidden="true" /></span>
                      <span className="mt-4 text-sm font-medium">Upload a job description</span><span className="mt-1 text-xs text-muted-foreground">PDF, DOCX, TXT, or MD up to 10 MB</span>
                    </label>
                    <div className="mt-4 flex justify-center"><Button variant="ghost" onClick={() => setDocumentState("skipped")}>Continue with defaults</Button></div>
                  </div>
                ) : null}
                {documentState === "processing" ? <div className="grid min-h-48 place-items-center rounded-lg border bg-background text-center" aria-live="polite"><div><LoaderCircle className="mx-auto size-6 animate-spin text-primary" aria-hidden="true" /><p className="mt-4 text-sm font-medium">Reading {fileName}</p><p className="mt-1 text-xs text-muted-foreground">Extracting role signals and panel recommendations…</p></div></div> : null}
                {documentState === "error" ? <div className="space-y-4"><Alert title="This file could not be used" variant="destructive">Choose a PDF, DOCX, TXT, or MD file smaller than 10 MB. The interview can still use defaults.</Alert><div className="flex gap-2"><Button variant="secondary" onClick={() => inputRef.current?.click()}>Choose another file</Button><Button variant="ghost" onClick={() => setDocumentState("skipped")}>Use defaults</Button></div></div> : null}
                {documentState === "ready" ? (
                  <div className="space-y-5">
                    <div className="flex items-center gap-3 rounded-lg border bg-background p-4"><FileText className="size-5 text-primary" aria-hidden="true" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{fileName}</p><p className="text-xs text-muted-foreground">Role context ready</p></div><Badge variant="default"><Check className="size-3" aria-hidden="true" />Processed</Badge></div>
                    <div><div className="mb-3 flex items-center justify-between"><div><h3 className="font-medium">Recommended configuration</h3><p className="mt-1 text-xs text-muted-foreground">Review now. Everything remains editable.</p></div><WandSparkles className="size-5 text-primary" aria-hidden="true" /></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Panel roles</p><p className="mt-2 text-sm font-medium">{jdRecommendations?.panel?.map((person) => person.role || person.display_name).filter(Boolean).join(", ") || "Growth Strategy, Analytics, Bar Raiser"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{jdRecommendations?.role_title ? `Configured for ${jdRecommendations.role_title}.` : "Role stresses experiments, cross-functional execution, and growth loops."}</p></div><div className="rounded-lg border p-4"><p className="text-xs text-muted-foreground">Rubric focus</p><p className="mt-2 text-sm font-medium">{jdRecommendations?.focus_areas?.map((area) => area.replaceAll("_", " ")).join(", ") || "Analytics, execution"}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">Suggested difficulty: {jdRecommendations?.difficulty || "challenging"}.</p></div></div></div>
                    <div className="flex flex-wrap gap-2"><Button size="sm" variant={jdDisposition === "apply" ? "default" : "secondary"} onClick={applyRecommendedPanel}><Sparkles aria-hidden="true" />Apply recommendations</Button><Button size="sm" variant={jdDisposition === "edit" ? "default" : "secondary"} onClick={editRecommendedPanel}><SlidersHorizontal aria-hidden="true" />Edit recommendations</Button><Button size="sm" variant="ghost" onClick={() => setJdDisposition("ignore")}>Ignore for configuration</Button><Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>Replace file</Button></div>
                    {jdDisposition === "ignore" ? <Alert title="Recommendations ignored"><span>The uploaded file will not configure this interview. Your selected defaults and panel will be used.</span></Alert> : null}
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
                      <div className="mt-4 grid gap-3 sm:grid-cols-3"><Field label="Role"><Select value={person.role} onChange={(event) => updatePanel(person.id, { role: event.target.value })}><option>Product strategy</option><option>Product analytics</option><option>Bar raiser</option><option>Behavioral</option><option>Execution</option></Select></Field><Field label="Mood"><Select value={person.mood} onChange={(event) => updatePanel(person.id, { mood: event.target.value })}><option>Calm</option><option>Direct</option><option>Demanding</option><option>Warm</option><option>Focused</option></Select></Field><Field label="Behavior"><Select value={person.behavior} onChange={(event) => updatePanel(person.id, { behavior: event.target.value })}><option>Probes assumptions</option><option>Challenges metrics</option><option>Finds contradictions</option><option>Probes evidence</option><option>Tests decisions</option></Select></Field></div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Avatar"><Select value={person.avatarId} onChange={(event) => { const avatar = avatarOptions.find((option) => option.id === event.target.value); if (avatar) updatePanel(person.id, { avatarId: avatar.id, avatarImage: avatar.image }); }}>{avatarOptions.map((avatar) => <option key={avatar.id} value={avatar.id}>{avatar.label}</option>)}</Select></Field><Field label="Avatar provider"><Select value={person.avatarVendor} onChange={(event) => updatePanel(person.id, { avatarVendor: event.target.value as Panelist["avatarVendor"] })}><option value="liveavatar">LiveAvatar (recommended)</option><option value="akool">Akool</option><option value="anam">Anam</option><option value="generic">Generic adapter</option></Select></Field></div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Button variant="secondary" onClick={addPanelist} disabled={!canAdd}><Plus aria-hidden="true" />Add interviewer</Button>
              <Card>
                <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="text-base">Interviewer tool policy</CardTitle><CardDescription>Tools are role-scoped and logged. Web search is off by default.</CardDescription></div><Badge variant="outline">{enabledTools.length} enabled</Badge></div></CardHeader>
                <CardContent className="grid gap-2 sm:grid-cols-2">
                  {toolOptions.map((tool) => <label key={tool.id} className="flex items-start gap-3 rounded-lg border bg-background p-3"><input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" checked={enabledTools.includes(tool.id)} onChange={() => toggleTool(tool.id)} /><span className="min-w-0"><span className="flex items-center gap-2 text-sm font-medium">{tool.label}{tool.safe ? null : <Badge variant="secondary">Optional</Badge>}</span><span className="mt-1 block text-xs text-muted-foreground">{tool.detail} · {tool.roles}</span></span></label>)}
                </CardContent>
              </Card>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-5 enter">
              <div><h2 id="wizard-step-title" className="text-xl font-semibold">Shape interviewer knowledge</h2><p className="mt-1 text-sm text-muted-foreground">Use a built-in prompt unchanged, edit a private copy, or write a new one.</p></div>
              <div className="grid gap-5 lg:grid-cols-[13rem_1fr]">
                <div className="space-y-1" role="tablist" aria-label="Panelist prompts">{panel.map((person) => <button key={person.id} type="button" role="tab" aria-selected={activePrompt === person.id} onClick={() => setActivePrompt(person.id)} className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-start text-sm ${activePrompt === person.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"}`}><Avatar initials={person.initials} src={person.avatarImage} className="size-7" /><span className="truncate">{person.name}</span></button>)}</div>
                <Card role="tabpanel">
                  <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{selectedPerson.name}</CardTitle><CardDescription>{selectedPerson.role}</CardDescription></div><Badge variant={promptMode[selectedPerson.id] ? "default" : "secondary"}>{promptMode[selectedPerson.id] === "custom" ? "Custom" : promptMode[selectedPerson.id] === "forked" ? "Edited copy" : "Built-in"}</Badge></div></CardHeader>
                  <CardContent className="space-y-5">
                    {!promptMode[selectedPerson.id] ? <Alert title="Built-in prompts are protected"><span>Use this default unchanged, or create an editable copy. The RoundCraft original remains available.</span></Alert> : null}
                    <Field label="System prompt" hint={`${selectedPerson.prompt.length} characters`}><Textarea value={selectedPerson.prompt} readOnly={!promptMode[selectedPerson.id]} onChange={(event) => updatePanel(selectedPerson.id, { prompt: event.target.value })} className="min-h-44" placeholder="Describe expertise, behavior, interview knowledge, and boundaries." /></Field>
                    <div className="grid gap-3 sm:grid-cols-2"><Field label="Voice"><Select value={selectedPerson.voice} onChange={(event) => updatePanel(selectedPerson.id, { voice: event.target.value })}><option>Nova</option><option>Atlas</option><option>Sage</option><option>Ember</option><option>Lumen</option></Select></Field><Field label="Difficulty"><Select defaultValue="challenging"><option value="supportive">Supportive</option><option value="balanced">Balanced</option><option value="challenging">Challenging</option></Select></Field></div>
                    <div className="flex flex-wrap gap-2">{!promptMode[selectedPerson.id] ? <Button size="sm" variant="secondary" onClick={forkPrompt}><Copy aria-hidden="true" />Edit a copy</Button> : null}<Button size="sm" variant="ghost" onClick={customPrompt}><Plus aria-hidden="true" />Write new prompt</Button>{promptMode[selectedPerson.id] ? <Button size="sm" onClick={() => setNotice("Prompt changes saved for this interview configuration.")}><Check aria-hidden="true" />Save prompt</Button> : null}</div>
                  </CardContent>
                </Card>
              </div>
              <div><h3 className="mb-3 text-sm font-medium">Built-in prompt library</h3><div className="grid gap-3 sm:grid-cols-2">{promptTemplates.slice(0, 4).map((prompt) => <button key={prompt.id} type="button" className="rounded-lg border bg-card p-4 text-start hover:border-primary/40" onClick={() => { updatePanel(selectedPerson.id, { prompt: prompt.summary }); setPromptMode((current) => ({ ...current, [selectedPerson.id]: "forked" })); }}><div className="flex items-center justify-between"><span className="text-sm font-medium">{prompt.name}</span><LockKeyhole className="size-3.5 text-muted-foreground" aria-hidden="true" /></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{prompt.summary}</p></button>)}</div></div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-5 enter">
              <Card>
                <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle id="wizard-step-title" className="text-xl">Ready for the lobby</CardTitle><CardDescription className="mt-1">Review the configuration snapshot that will stay attached to this interview.</CardDescription></div><Badge variant="default"><Check aria-hidden="true" />Ready</Badge></div></CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Interview</p><p className="mt-1 text-sm font-medium">{title}</p></div><div><p className="text-xs text-muted-foreground">Duration</p><p className="mt-1 text-sm font-medium">{duration} minutes</p></div><div><p className="text-xs text-muted-foreground">Difficulty</p><p className="mt-1 capitalize text-sm font-medium">{difficulty}</p></div><div><p className="text-xs text-muted-foreground">Job description</p><p className="mt-1 truncate text-sm font-medium">{documentState === "ready" && jdDisposition !== "ignore" ? `${fileName} · ${jdDisposition}` : "Defaults only"}</p></div></div>
                  <Separator />
                  <div><p className="mb-3 text-xs text-muted-foreground">Panel sequence is decided live</p><div className="flex flex-wrap gap-2">{panel.map((person) => <div key={person.id} className="flex items-center gap-2 rounded-md border bg-background p-2 pe-3"><Avatar initials={person.initials} src={person.avatarImage} className="size-7" /><span><span className="block text-xs font-medium">{person.name}</span><span className="block text-[10px] text-muted-foreground">{person.role}</span></span></div>)}</div></div>
                  <Separator />
                  <div className="grid gap-3 sm:grid-cols-2"><CheckRow>Candidate barge-in and interruption enabled</CheckRow><CheckRow>Shared context memory enabled</CheckRow><CheckRow>Transcript evidence required for scores</CheckRow><CheckRow>Tools logged in the session timeline</CheckRow></div>
                  <div><p className="mb-3 text-xs text-muted-foreground">Enabled interviewer tools</p><div className="flex flex-wrap gap-2">{toolOptions.filter((tool) => enabledTools.includes(tool.id)).map((tool) => <Badge key={tool.id} variant="secondary">{tool.label}</Badge>)}</div></div>
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
            <CardContent className="space-y-4 text-sm"><div><p className="text-xs text-muted-foreground">Focus</p><p className="mt-1">{focus}</p></div><div><p className="text-xs text-muted-foreground">Panel</p><p className="mt-1">{panel.length} interviewers</p></div><div><p className="text-xs text-muted-foreground">Role context</p><p className="mt-1">{documentState === "ready" ? "JD configured" : "RoundCraft defaults"}</p></div><Separator /><div className="space-y-2"><CheckRow muted>One audible speaker</CheckRow><CheckRow muted>Adaptive follow-ups</CheckRow><CheckRow muted>Evidence-linked report</CheckRow></div></CardContent>
          </Card>
        </aside>
      </div>

      {step < 4 ? <div className="mt-8 flex items-center justify-between border-t pt-5"><Button variant="ghost" disabled={step === 0} onClick={() => setStep((current) => Math.max(0, current - 1))}><ArrowLeft aria-hidden="true" />Back</Button><Button onClick={() => setStep((current) => Math.min(4, current + 1))} disabled={step === 0 && !title.trim()}>Continue<ArrowRight aria-hidden="true" /></Button></div> : <div className="mt-8"><Button variant="ghost" onClick={() => setStep(3)}><ArrowLeft aria-hidden="true" />Back to prompts</Button></div>}
    </AppShell>
  );
}

export function LobbyScreen() {
  const router = useRouter();
  const [micReady, setMicReady] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof readLiveSession>>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const lobbyPanel = useMemo(() => {
    const snapshot = session?.configSnapshot as { panel?: Array<{ id?: string; display_name?: string; avatar_image?: string }>; duration_minutes?: number; difficulty?: string } | undefined;
    return {
      people: snapshot?.panel?.map((person, index) => { const name = person.display_name || `Interviewer ${index + 1}`; return { id: person.id || String(index), initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(), avatarImage: person.avatar_image || defaultPanelists[index % defaultPanelists.length].avatarImage }; }) || defaultPanelists,
      duration: snapshot?.duration_minutes || 35,
      difficulty: snapshot?.difficulty || "challenging",
    };
  }, [session]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSession(readLiveSession()), 0);
    return () => window.clearTimeout(timer);
  }, []);

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
        <Card className="min-h-[28rem] overflow-hidden"><div className="surface-grid relative grid min-h-[28rem] place-items-center p-6"><div className="relative text-center"><span className="mx-auto grid size-20 place-items-center rounded-xl border bg-card shadow-xl"><Bot className="size-8 text-primary" aria-hidden="true" /></span><h2 className="mt-6 text-xl font-semibold">Your panel is ready</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">The silent director will select one interviewer after every answer. You can interrupt naturally at any time.</p><div className="mt-7 flex justify-center -space-x-2">{lobbyPanel.people.map((person) => <Avatar key={person.id} initials={person.initials} src={person.avatarImage} className="size-10 rounded-full bg-card" />)}</div></div></div></Card>
        <div className="space-y-4"><Card><CardHeader><div className="flex items-center justify-between"><CardTitle className="text-base">Device check</CardTitle><Badge variant={session?.demo ? "secondary" : "default"}>{session?.demo ? "Demo" : "Configured"}</Badge></div></CardHeader><CardContent className="space-y-4"><Field label="Microphone"><Select defaultValue="default"><option value="default">Default microphone</option><option>MacBook microphone</option></Select></Field><Button variant={micReady ? "secondary" : "default"} className="w-full" onClick={() => setMicReady(true)}>{micReady ? <Check aria-hidden="true" /> : <SlidersHorizontal aria-hidden="true" />}{micReady ? "Microphone ready" : "Test microphone"}</Button></CardContent></Card><Alert title="Private by default"><span>Recording is off. Live audio uses Agora RTC; final transcript turns and evidence are stored for your report.</span></Alert>{startError ? <Alert title="Session could not start" variant="destructive"><span>{startError}</span></Alert> : null}<Button size="lg" className="w-full" loading={starting} onClick={startInterview}><Sparkles aria-hidden="true" />Start interview</Button><p className="text-center text-xs text-muted-foreground">{lobbyPanel.duration} minutes · {lobbyPanel.people.length} panelists · {lobbyPanel.difficulty}</p></div>
      </div>
    </AppShell>
  );
}
