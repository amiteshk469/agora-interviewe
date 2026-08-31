"use client";

import Link from "next/link";
import {
  ArrowRight,
  BarChart3,
  BookOpenText,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Gauge,
  Headphones,
  LockKeyhole,
  MessageSquareText,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Upload,
  UserRound,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Alert, Avatar, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Separator, Textarea } from "@/components/ui";
import { competencies, defaultPanelists, interviewHistory, promptTemplates, transcript } from "@/data/demo";
import { cn } from "@/lib/utils";
import { generateSessionReplayDrills, getSessionReport, listSessionReplayDrills, listSessionToolRuns, listSessionTurns, type SessionReplayDrill, type SessionReport, type SessionToolRun, type SessionTurn } from "@/lib/api";

export function DashboardScreen() {
  return (
    <AppShell screen="dashboard" title="Good evening, Amitesh" description="Your next meaningful practice is one focused session away." actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5"><div className="flex items-center justify-between"><span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary"><Gauge className="size-4" aria-hidden="true" /></span><Badge variant="default">+7 this week</Badge></div><p className="mt-5 text-3xl font-semibold tracking-tight">81</p><p className="mt-1 text-xs text-muted-foreground">Latest readiness score</p></CardContent></Card>
        <Card><CardContent className="p-5"><span className="grid size-9 place-items-center rounded-md bg-secondary text-muted-foreground"><Clock3 className="size-4" aria-hidden="true" /></span><p className="mt-5 text-3xl font-semibold tracking-tight">3.8h</p><p className="mt-1 text-xs text-muted-foreground">Focused practice this month</p></CardContent></Card>
        <Card><CardContent className="p-5"><span className="grid size-9 place-items-center rounded-md bg-secondary text-muted-foreground"><Target className="size-4" aria-hidden="true" /></span><p className="mt-5 text-3xl font-semibold tracking-tight">6</p><p className="mt-1 text-xs text-muted-foreground">Evidence-backed strengths</p></CardContent></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader><div className="flex items-center justify-between"><div><CardTitle>Continue where it matters</CardTitle><CardDescription>Latest assessment from Senior PM, Growth</CardDescription></div><Button variant="ghost" size="icon" aria-label="More report actions"><MoreHorizontal aria-hidden="true" /></Button></div></CardHeader>
          <CardContent>
            <div className="flex flex-col gap-5 rounded-lg border bg-background p-4 sm:flex-row sm:items-center"><div className="grid size-16 shrink-0 place-items-center rounded-lg bg-primary/10 text-2xl font-semibold text-primary">81</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">Strong product judgment, softer metric thresholds</p><Badge variant="secondary">Aug 30</Badge></div><p className="mt-1 text-sm leading-6 text-muted-foreground">Your segmentation held up. The panel found one repeatable gap in turning metrics into explicit decisions.</p></div><Button asChild variant="secondary"><Link href="/reports/demo">Open report<ArrowRight aria-hidden="true" /></Link></Button></div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">{competencies.slice(0, 3).map((item) => <div key={item.name} className="rounded-md bg-secondary p-3"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{item.name}</span><span className="font-mono text-xs">{item.score}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-primary" style={{ width: `${item.score}%` }} /></div></div>)}</div>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle>Recommended next</CardTitle><CardDescription>Generated from linked evidence</CardDescription></CardHeader><CardContent><span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary"><BarChart3 className="size-5" aria-hidden="true" /></span><h3 className="mt-5 font-medium">Metric decision drill</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">Defend one north star, one guardrail, and the action behind each threshold.</p><div className="mt-5 flex items-center justify-between text-xs text-muted-foreground"><span>8 minutes</span><span>Based on turn-04</span></div><Button asChild className="mt-4 w-full"><Link href="/replay"><Play aria-hidden="true" />Start drill</Link></Button></CardContent></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card><CardHeader><div className="flex items-center justify-between"><div><CardTitle>Recent interviews</CardTitle><CardDescription>Your last completed sessions</CardDescription></div><Button variant="ghost" asChild><Link href="/history">View all</Link></Button></div></CardHeader><CardContent className="space-y-1">{interviewHistory.map((item) => <Link key={item.id} href="/reports/demo" className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-accent"><span className="grid size-9 place-items-center rounded-md border bg-background"><MessageSquareText className="size-4 text-muted-foreground" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.title}</span><span className="block text-xs text-muted-foreground">{item.company} · {item.date}</span></span><span className="font-mono text-sm">{item.score}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></Link>)}</CardContent></Card>
        <Card><CardHeader><CardTitle>Panel library</CardTitle><CardDescription>Ready-to-use interviewer expertise</CardDescription></CardHeader><CardContent><div className="flex -space-x-2">{defaultPanelists.map((person) => <Avatar key={person.id} initials={person.initials} className="size-11 bg-card" />)}<span className="grid size-11 place-items-center rounded-md border bg-background text-xs text-muted-foreground">+5</span></div><p className="mt-5 text-sm leading-6 text-muted-foreground">Strategy, analytics, execution, behavioral, and high-bar interviewer defaults. Each can be copied, edited, or replaced.</p><Button variant="secondary" asChild className="mt-5"><Link href="/prompts"><BookOpenText aria-hidden="true" />Browse prompts</Link></Button></CardContent></Card>
      </div>
    </AppShell>
  );
}

export function HistoryScreen() {
  const [query, setQuery] = useState("");
  const filtered = interviewHistory.filter((item) => `${item.title} ${item.company}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <AppShell screen="history" title="Interview history" description="Review every session, report, and evidence trail." actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
      <Card>
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="ps-9" placeholder="Search title or company…" aria-label="Search interview history" /></div><Button variant="secondary"><Filter aria-hidden="true" />Filter</Button><Button variant="secondary"><Download aria-hidden="true" />Export</Button></div>
        {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[44rem] text-sm"><thead><tr className="border-b text-start text-xs text-muted-foreground"><th className="px-5 py-3 text-start font-medium">Interview</th><th className="px-5 py-3 text-start font-medium">Date</th><th className="px-5 py-3 text-start font-medium">Duration</th><th className="px-5 py-3 text-start font-medium">Score</th><th className="px-5 py-3 text-start font-medium">Status</th><th className="w-12"><span className="sr-only">Actions</span></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id} className="border-b last:border-0 hover:bg-accent/40"><td className="px-5 py-4"><Link href="/reports/demo" className="font-medium hover:underline">{item.title}</Link><p className="mt-0.5 text-xs text-muted-foreground">{item.company} · {item.id}</p></td><td className="px-5 py-4 text-muted-foreground">{item.date}</td><td className="px-5 py-4 text-muted-foreground">{item.duration}</td><td className="px-5 py-4 font-mono">{item.score}</td><td className="px-5 py-4"><Badge variant="secondary">{item.status}</Badge></td><td className="pe-3"><Button variant="ghost" size="icon" aria-label={`Actions for ${item.title}`}><MoreHorizontal aria-hidden="true" /></Button></td></tr>)}</tbody></table></div> : <div className="grid min-h-64 place-items-center p-6 text-center"><div><Search className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><h2 className="mt-4 font-medium">No interviews found</h2><p className="mt-1 text-sm text-muted-foreground">Try a different title or company.</p><Button variant="ghost" className="mt-3" onClick={() => setQuery("")}>Clear search</Button></div></div>}
      </Card>
    </AppShell>
  );
}

export function PromptLibraryScreen() {
  const [selected, setSelected] = useState(promptTemplates[0]);
  const [mode, setMode] = useState<"built-in" | "copy" | "custom">("built-in");
  const [prompt, setPrompt] = useState(selected.summary);
  const [saved, setSaved] = useState(false);
  function choose(item: typeof promptTemplates[number]) { setSelected(item); setPrompt(item.summary); setMode("built-in"); setSaved(false); }
  return (
    <AppShell screen="prompts" title="Prompt library" description="Start with protected defaults, edit a private copy, or create a new interviewer." actions={<Button onClick={() => { setMode("custom"); setPrompt(""); }}><Plus aria-hidden="true" />New prompt</Button>}>
      {saved ? <div className="mb-5"><Alert title="Prompt saved" onDismiss={() => setSaved(false)}>Your private prompt copy is ready for future panels.</Alert></div> : null}
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit"><div className="border-b p-3"><div className="relative"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input className="ps-9" placeholder="Search prompts…" aria-label="Search prompt library" /></div></div><div className="p-2" role="listbox" aria-label="Prompt templates">{promptTemplates.map((item) => <button key={item.id} type="button" role="option" aria-selected={selected.id === item.id && mode !== "custom"} onClick={() => choose(item)} className={cn("w-full rounded-md p-3 text-start hover:bg-accent", selected.id === item.id && mode !== "custom" && "bg-accent")}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{item.name}</span><LockKeyhole className="size-3.5 text-muted-foreground" aria-hidden="true" /></div><p className="mt-1 text-xs text-muted-foreground">{item.role} · {item.updated}</p></button>)}</div></Card>
        <Card>
          <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{mode === "custom" ? "Untitled custom interviewer" : selected.name}</CardTitle><CardDescription>{mode === "built-in" ? "RoundCraft built-in" : mode === "copy" ? `Private copy of ${selected.name}` : "Private custom prompt"}</CardDescription></div><Badge variant={mode === "built-in" ? "secondary" : "default"}>{mode === "built-in" ? "Protected" : "Editable"}</Badge></div></CardHeader>
          <CardContent className="space-y-5">
            {mode === "built-in" ? <Alert title="Built-in prompt"><span>Protected defaults cannot be changed in place. Edit a copy to preserve reliable starting prompts.</span></Alert> : null}
            {mode !== "built-in" ? <Field label="Prompt name"><Input defaultValue={mode === "copy" ? `${selected.name} copy` : ""} placeholder="Name this interviewer prompt" /></Field> : null}
            <div className="grid gap-4 sm:grid-cols-2"><Field label="Role"><Select defaultValue={selected.role}><option>Strategy</option><option>Analytics</option><option>Behavioral</option><option>Bar raiser</option><option>Execution</option></Select></Field><Field label="Default mood"><Select defaultValue="Direct"><option>Calm</option><option>Direct</option><option>Demanding</option><option>Warm</option></Select></Field></div>
            <Field label="Interviewer prompt" hint={`${prompt.length} characters`}><Textarea value={prompt} readOnly={mode === "built-in"} onChange={(event) => setPrompt(event.target.value)} className="min-h-64" placeholder="Describe expertise, behavior, knowledge, tools, and boundaries." /></Field>
            <div><p className="mb-2 text-sm font-medium">Allowed tools</p><div className="flex flex-wrap gap-2">{["Knowledge search", "Metric calculator", "Evidence bookmark"].map((tool) => <label key={tool} className="flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-xs"><input type="checkbox" defaultChecked className="accent-[var(--primary)]" />{tool}</label>)}</div></div>
            <div className="flex flex-wrap gap-2">{mode === "built-in" ? <Button variant="secondary" onClick={() => setMode("copy")}><Copy aria-hidden="true" />Edit a copy</Button> : <Button onClick={() => setSaved(true)}><Check aria-hidden="true" />Save prompt</Button>}<Button variant="ghost" onClick={() => { setMode("custom"); setPrompt(""); }}><Plus aria-hidden="true" />Start blank</Button>{mode !== "built-in" ? <Button variant="ghost"><Trash2 aria-hidden="true" />Discard</Button> : null}</div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

export function ReplayScreen({ sessionId }: { sessionId?: string }) {
  const [active, setActive] = useState(0);
  const [remoteDrills, setRemoteDrills] = useState<SessionReplayDrill[]>([]);
  const [loading, setLoading] = useState(Boolean(sessionId));
  const [loadError, setLoadError] = useState("");
  const demoDrills = [
    { title: "Metric decision rule", focus: "Analytical thinking", length: "8 min", source: "turn-04", prompt: "Your activation rate improved while seven-day retention declined. Define the threshold that changes your launch decision and defend it." },
    { title: "Unmet need evidence", focus: "Product judgment", length: "6 min", source: "turn-02", prompt: "Show why first-time managers are both urgent and underserved without relying on broad market claims." },
    { title: "Execution proof", focus: "Insufficient evidence", length: "10 min", source: "report gap", prompt: "Describe a difficult delivery tradeoff, the risks you surfaced, and the evidence behind the decision." },
  ];
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void listSessionReplayDrills(sessionId)
      .then((items) => items.length ? items : generateSessionReplayDrills(sessionId))
      .then((items) => { if (!cancelled) { setRemoteDrills(items); setLoading(false); } })
      .catch((cause) => { if (!cancelled) { setLoadError(cause instanceof Error ? cause.message : "Replay drills could not load"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [sessionId]);
  const drills = sessionId ? remoteDrills.map((item) => ({ title: item.competency.replaceAll("_", " "), focus: item.competency.replaceAll("_", " "), length: "Focused drill", source: item.source_turn_ids.join(", ") || "report gap", prompt: item.prompt })) : demoDrills;
  const drill = drills[active];
  if (loading) return <AppShell screen="replay" title="Preparing replay drills" description="Turning evidence gaps into focused practice."><Card className="p-6" aria-busy="true"><div className="h-7 w-48 animate-pulse rounded-md bg-muted" /><div className="mt-4 h-40 animate-pulse rounded-lg bg-muted" /></Card></AppShell>;
  if (loadError) return <AppShell screen="replay" title="Replay drills unavailable" description="The report remains available."><Alert title="Could not load replay drills" variant="destructive"><span>{loadError}</span></Alert><Button asChild className="mt-4"><Link href={sessionId ? `/reports/${sessionId}` : "/reports/demo"}>Back to report</Link></Button></AppShell>;
  if (!drill) return <AppShell screen="replay" title="No replay drills yet" description="This session did not produce an evidence gap that needs a targeted drill."><Card className="grid min-h-64 place-items-center p-6 text-center"><div><Sparkles className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">Nothing to replay</p><p className="mt-1 text-xs text-muted-foreground">Complete another interview to collect more assessment evidence.</p><Button asChild className="mt-4"><Link href="/setup">Start an interview</Link></Button></div></Card></AppShell>;
  return (
    <AppShell screen="replay" title="Replay drills" description="Short, evidence-specific practice generated from your actual interview gaps.">
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit"><CardHeader><CardTitle className="text-sm">Your queue</CardTitle><CardDescription>{drills.length} recommended {drills.length === 1 ? "drill" : "drills"}</CardDescription></CardHeader><CardContent className="space-y-1">{drills.map((item, index) => <button key={item.title} type="button" onClick={() => setActive(index)} className={cn("w-full rounded-md p-3 text-start hover:bg-accent", active === index && "bg-accent")}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{item.title}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></div><p className="mt-1 text-xs text-muted-foreground">{item.focus} · {item.length}</p></button>)}</CardContent></Card>
        <Card><CardHeader><div className="flex items-start justify-between gap-4"><div><Badge variant="default">{drill.focus}</Badge><CardTitle className="mt-4 text-xl">{drill.title}</CardTitle><CardDescription className="mt-1">Linked to {drill.source}</CardDescription></div><Headphones className="size-6 text-primary" aria-hidden="true" /></div></CardHeader><CardContent><div className="rounded-lg border bg-background p-5"><p className="text-xs text-muted-foreground">Challenge</p><p className="mt-3 text-lg leading-7">{drill.prompt}</p></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Timebox</p><p className="mt-1 text-sm font-medium">{drill.length}</p></div><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Format</p><p className="mt-1 text-sm font-medium">Voice follow-up</p></div><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Panelist</p><p className="mt-1 text-sm font-medium">Arjun, Analytics</p></div></div><div className="mt-6 flex flex-wrap gap-2"><Button><Play aria-hidden="true" />Start voice drill</Button><Button variant="secondary"><MessageSquareText aria-hidden="true" />Practice in text</Button></div></CardContent></Card>
      </div>
    </AppShell>
  );
}

export function SettingsScreen() {
  const [tab, setTab] = useState("profile");
  const [saved, setSaved] = useState(false);
  return (
    <AppShell screen="settings" title="Settings" description="Manage your profile, interview defaults, data, and live-audio preferences.">
      {saved ? <div className="mb-5"><Alert title="Settings saved" onDismiss={() => setSaved(false)}>Your workspace preferences are up to date.</Alert></div> : null}
      <div className="grid gap-6 md:grid-cols-[13rem_1fr]">
        <nav className="space-y-1" aria-label="Settings sections">{[["profile",UserRound,"Profile"],["interview",Settings2,"Interview defaults"],["audio",Headphones,"Audio and Agora"],["privacy",ShieldCheck,"Privacy and data"]].map(([id, Icon, label]) => { const C = Icon as typeof UserRound; return <button key={String(id)} type="button" onClick={() => setTab(String(id))} className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent", tab === id && "bg-accent text-foreground")}><C className="size-4" aria-hidden="true" />{String(label)}</button>; })}</nav>
        <Card>
          {tab === "profile" ? <><CardHeader><CardTitle>Profile</CardTitle><CardDescription>Used to personalize your practice workspace.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="flex items-center gap-4"><Avatar initials="AK" className="size-14 text-base" /><Button variant="secondary"><Upload aria-hidden="true" />Change photo</Button></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Full name"><Input defaultValue="Amitesh Kumar" /></Field><Field label="Email"><Input type="email" defaultValue="amitesh@example.com" /></Field></div><Field label="Target role"><Input defaultValue="Senior Product Manager" /></Field><Button onClick={() => setSaved(true)}>Save profile</Button></CardContent></> : null}
          {tab === "interview" ? <><CardHeader><CardTitle>Interview defaults</CardTitle><CardDescription>Applied when no job description overrides them.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Default duration"><Select defaultValue="35"><option value="20">20 minutes</option><option value="35">35 minutes</option><option value="45">45 minutes</option></Select></Field><Field label="Default difficulty"><Select defaultValue="challenging"><option>Supportive</option><option>Balanced</option><option value="challenging">Challenging</option></Select></Field></div><Field label="Default panel size"><Select defaultValue="3"><option value="2">2 interviewers</option><option value="3">3 interviewers</option><option value="4">4 interviewers</option><option value="5">5 interviewers</option></Select></Field><Button onClick={() => setSaved(true)}>Save defaults</Button></CardContent></> : null}
          {tab === "audio" ? <><CardHeader><CardTitle>Audio and Agora</CardTitle><CardDescription>Live audio connects through short-lived Agora RTC and RTM tokens.</CardDescription></CardHeader><CardContent className="space-y-5"><Alert title="Credential boundary"><span>Your browser receives channel tokens only. The Agora App Certificate stays on the server.</span></Alert><Field label="Preferred microphone"><Select defaultValue="system"><option value="system">System default</option><option>MacBook microphone</option></Select></Field><label className="flex items-start justify-between gap-4 rounded-lg border p-4"><span><span className="block text-sm font-medium">Candidate interruption</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Let your voice interrupt the active interviewer naturally.</span></span><input type="checkbox" defaultChecked className="mt-1 size-4 accent-[var(--primary)]" /></label><Button onClick={() => setSaved(true)}>Save audio settings</Button></CardContent></> : null}
          {tab === "privacy" ? <><CardHeader><CardTitle>Privacy and data</CardTitle><CardDescription>Control retention for documents, transcripts, and recordings.</CardDescription></CardHeader><CardContent className="space-y-5"><label className="flex items-start justify-between gap-4 rounded-lg border p-4"><span><span className="block text-sm font-medium">Audio recording</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Off by default. Transcript evidence remains available.</span></span><input type="checkbox" className="mt-1 size-4 accent-[var(--primary)]" /></label><div className="rounded-lg border p-4"><p className="text-sm font-medium">Candidate documents</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Job descriptions and resumes are stored privately and can be deleted.</p><Button variant="secondary" size="sm" className="mt-3">Manage documents</Button></div><Button variant="destructive"><Trash2 aria-hidden="true" />Delete workspace data</Button></CardContent></> : null}
        </Card>
      </div>
    </AppShell>
  );
}

export function ReportScreen({ sessionId = "demo" }: { sessionId?: string }) {
  const realSession = sessionId !== "demo";
  const [selectedTurn, setSelectedTurn] = useState("turn-04");
  const [tab, setTab] = useState<"assessment" | "transcript" | "tools">("assessment");
  const [report, setReport] = useState<SessionReport | null>(null);
  const [realTurns, setRealTurns] = useState<SessionTurn[]>([]);
  const [realTools, setRealTools] = useState<SessionToolRun[]>([]);
  const [loading, setLoading] = useState(realSession);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!realSession) return;
    let cancelled = false;
    void Promise.all([getSessionReport(sessionId), listSessionTurns(sessionId), listSessionToolRuns(sessionId)])
      .then(([nextReport, nextTurns, nextTools]) => {
        if (cancelled) return;
        setReport(nextReport);
        setRealTurns(nextTurns);
        setRealTools(nextTools);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setLoadError(cause instanceof Error ? cause.message : "Report could not load");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [realSession, reload, sessionId]);

  const reportCompetencies = report?.competencies.map((item) => ({
    name: item.label,
    score: item.score,
    level: item.score === null ? "Insufficient evidence" : item.score >= 80 ? "Strong" : "Developing",
    evidence: item.evidence_turn_ids,
    note: item.feedback,
  })) ?? competencies;
  const reportTurns = useMemo(() => realSession ? realTurns.map((turn) => ({
    id: turn.id,
    speaker: turn.speaker_type === "candidate" ? "You" : turn.speaker_id || "Interviewer",
    kind: turn.speaker_type === "candidate" ? "candidate" as const : "panel" as const,
    time: turn.started_at ? new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(turn.started_at)) : `#${turn.sequence}`,
    text: turn.content,
  })) : transcript, [realSession, realTurns]);
  const evidenceTurn = reportTurns.find((turn) => turn.id === selectedTurn) ?? reportTurns[0];
  const overallScore = report?.overall_score === null ? "N/A" : Math.round(report?.overall_score ?? 81);
  const readiness = report?.readiness || "Strong signal";
  const summary = report?.summary || "You showed clear product judgment and concise communication. Sharpen metric thresholds and collect more execution evidence.";
  const reportToolRows = realSession ? realTools.map((run) => ({
    id: run.id,
    tool: run.tool_name.replaceAll("_", " "),
    result: Object.keys(run.result).length ? JSON.stringify(run.result) : run.error || "No result returned",
    turn: run.transcript_turn_id || "session",
    time: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(run.created_at)),
    status: run.status,
  })) : [
    { id: "demo-tool-1", tool: "JD knowledge search", result: "4 passages returned", turn: "turn-03", time: "04:02", status: "completed" },
    { id: "demo-tool-2", tool: "Metric calculator", result: "Retention sensitivity model", turn: "turn-04", time: "07:18", status: "completed" },
    { id: "demo-tool-3", tool: "Evidence bookmark", result: "Analytical thinking", turn: "turn-04", time: "07:33", status: "completed" },
  ];

  if (loading) return <AppShell screen="history" title="Generating your report" description="RoundCraft is reconciling final Agora turns and linked evidence."><Card className="p-6" aria-busy="true"><div className="h-8 w-44 animate-pulse rounded-md bg-muted" /><div className="mt-5 h-48 animate-pulse rounded-lg bg-muted" /></Card></AppShell>;
  if (loadError) return <AppShell screen="history" title="Report unavailable" description="The session is safe, but its report could not be loaded."><Alert title="Could not load report" variant="destructive"><span>{loadError}</span></Alert><Button className="mt-4" onClick={() => { setLoading(true); setLoadError(""); setReload((value) => value + 1); }}>Try again</Button></AppShell>;
  return (
    <AppShell screen="history" title={realSession ? "Interview assessment" : "Senior PM, Growth"} description={realSession ? `Completed session ${sessionId}` : "Demo report · Completed Aug 30 · 34 minutes · 3 panelists"} actions={<><Button variant="secondary"><Download aria-hidden="true" />Export report</Button><Button asChild><Link href={realSession ? `/replay/${sessionId}` : "/replay"}><Play aria-hidden="true" />Practice gaps</Link></Button></>}>
      <div className="grid gap-5 sm:grid-cols-[11rem_1fr] lg:grid-cols-[14rem_1fr_19rem]">
        <Card className="h-fit"><CardContent className="p-3"><nav className="space-y-1" aria-label="Report sections">{[["assessment",Gauge,"Assessment"],["transcript",MessageSquareText,"Transcript"],["tools",Wrench,"Tool activity"]].map(([id, Icon, label]) => { const C = Icon as typeof Gauge; return <button key={String(id)} type="button" onClick={() => setTab(id as typeof tab)} className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent", tab === id && "bg-accent text-foreground")}><C className="size-4" aria-hidden="true" />{String(label)}</button>; })}</nav></CardContent></Card>

        <div className="min-w-0 space-y-5">
          {tab === "assessment" ? <>
            <Card><CardContent className="p-5"><div className="flex flex-col gap-5 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">Overall readiness</p><p className="mt-1 text-6xl font-semibold tracking-[-0.05em]">{overallScore}<span className="text-xl text-muted-foreground">{overallScore === "N/A" ? "" : "/100"}</span></p></div><div className="sm:ms-auto sm:max-w-sm"><Badge variant="default">{readiness}</Badge><p className="mt-2 text-sm leading-6 text-muted-foreground">{summary}</p></div></div></CardContent></Card>
            <Card><CardHeader><CardTitle>Structured assessment</CardTitle><CardDescription>Each score requires linked transcript evidence.</CardDescription></CardHeader><CardContent className="space-y-3">{reportCompetencies.map((item) => <div key={item.name} className="rounded-lg border bg-background p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-medium">{item.name}</h3>{item.score === null ? <Badge variant="outline"><CircleAlert className="size-3" aria-hidden="true" />Insufficient evidence</Badge> : <Badge variant="secondary">{item.level}</Badge>}</div><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{item.note}</p></div><span className={cn("font-mono text-xl font-medium", item.score === null && "text-muted-foreground")}>{item.score ?? "N/A"}</span></div>{item.evidence.length ? <div className="mt-4 flex flex-wrap gap-2">{item.evidence.map((id) => <button key={id} type="button" onClick={() => setSelectedTurn(id)} className={cn("max-w-full truncate rounded-md border px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground", selectedTurn === id && "border-primary/60 bg-primary/10 text-primary")}>{id}</button>)}</div> : <div className="mt-4"><Button size="sm" variant="secondary" asChild><Link href={realSession ? `/replay/${sessionId}` : "/replay"}><Sparkles aria-hidden="true" />Create evidence drill</Link></Button></div>}</div>)}</CardContent></Card>
          </> : null}
          {tab === "transcript" ? <Card><CardHeader><CardTitle>Session transcript</CardTitle><CardDescription>Final and interrupted turns from the Agora live session.</CardDescription></CardHeader><CardContent className="space-y-2">{reportTurns.map((turn) => <button key={turn.id} type="button" onClick={() => setSelectedTurn(turn.id)} className={cn("w-full rounded-lg border p-4 text-start", selectedTurn === turn.id ? "border-primary/50 bg-primary/5" : "bg-background hover:bg-accent/40")}><div className="flex items-center justify-between"><span className="text-xs font-medium">{turn.speaker}</span><span className="max-w-[60%] truncate font-mono text-[10px] text-muted-foreground">{turn.time} · {turn.id}</span></div><p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{turn.text}</p></button>)}{!reportTurns.length ? <div className="py-12 text-center"><MessageSquareText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No final transcript turns</p><p className="mt-1 text-xs text-muted-foreground">The report correctly records that no usable transcript evidence was captured.</p></div> : null}</CardContent></Card> : null}
          {tab === "tools" ? <Card><CardHeader><CardTitle>Tool audit</CardTitle><CardDescription>Every interviewer tool run, its purpose, and linked evidence.</CardDescription></CardHeader><CardContent className="space-y-3">{reportToolRows.length ? reportToolRows.map((run) => <div key={run.id} className="flex items-start gap-3 rounded-lg border bg-background p-4"><span className="grid size-9 place-items-center rounded-md bg-secondary"><Wrench className="size-4 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="capitalize text-sm font-medium">{run.tool}</p><p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{run.result}</p><div className="mt-2 flex gap-2"><Badge variant="secondary">{run.status}</Badge><Badge variant="outline" className="max-w-36 truncate">{run.turn}</Badge></div></div><span className="font-mono text-[10px] text-muted-foreground">{run.time}</span></div>) : <div className="py-12 text-center"><Wrench className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No tools were needed</p><p className="mt-1 text-xs text-muted-foreground">This session completed without an interviewer tool call.</p></div>}</CardContent></Card> : null}
        </div>

        <aside className="hidden lg:block">{evidenceTurn ? <Card className="sticky top-20"><CardHeader><div className="flex items-center justify-between"><CardTitle className="text-sm">Linked evidence</CardTitle><Badge variant="outline">{evidenceTurn.id}</Badge></div></CardHeader><CardContent><div className="flex items-center gap-2"><Avatar initials={evidenceTurn.kind === "candidate" ? "AK" : evidenceTurn.speaker.slice(0, 2).toUpperCase()} className="size-8" /><div><p className="text-xs font-medium">{evidenceTurn.speaker}</p><p className="font-mono text-[10px] text-muted-foreground">{evidenceTurn.time}</p></div></div><p className="mt-4 text-sm leading-6 text-muted-foreground">{evidenceTurn.text}</p><Separator className="my-4" /><p className="text-xs font-medium">Why it matters</p><p className="mt-2 text-xs leading-5 text-muted-foreground">This turn supports the selected competency because it contains a concrete decision and an explicit signal.</p><Button variant="ghost" size="sm" className="mt-3 px-0" onClick={() => setTab("transcript")}>Open in transcript<ExternalLink aria-hidden="true" /></Button></CardContent></Card> : <Card className="sticky top-20 p-5 text-center"><CircleAlert className="mx-auto size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No linked evidence</p><p className="mt-1 text-xs leading-5 text-muted-foreground">No final turn is available for this assessment.</p></Card>}</aside>
      </div>
    </AppShell>
  );
}
