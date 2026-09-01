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
  Gauge,
  Headphones,
  LockKeyhole,
  MessageSquareText,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  UserRound,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { Alert, Avatar, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input, Select, Separator, Textarea } from "@/components/ui";
import { competencies, transcript } from "@/data/demo";
import { cn } from "@/lib/utils";
import { createPromptTemplate, forkPromptTemplate, generateSessionReplayDrills, generateSessionReport, getSessionReport, listInterviewSessions, listPromptTemplates, listSessionReplayDrills, listSessionToolRuns, listSessionTurns, type ProductSession, type PromptTemplateRecord, type SessionReplayDrill, type SessionReport, type SessionToolRun, type SessionTurn } from "@/lib/api";

export function DashboardScreen() {
  const { displayName } = useAuth();
  const [sessions, setSessions] = useState<ProductSession[]>([]);
  const [reports, setReports] = useState<Record<string, SessionReport>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailableReports, setUnavailableReports] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void listInterviewSessions()
      .then(async (items) => {
        const completed = items.filter((item) => item.status === "ended");
        const results = await Promise.allSettled(
          completed.map(async (item) => ({ sessionId: item.id, report: await getSessionReport(item.id) })),
        );
        if (cancelled) return;
        const nextReports: Record<string, SessionReport> = {};
        let failed = 0;
        for (const result of results) {
          if (result.status === "fulfilled") nextReports[result.value.sessionId] = result.value.report;
          else failed += 1;
        }
        setSessions(items);
        setReports(nextReports);
        setUnavailableReports(failed);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Your interview workspace could not be loaded.");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [reload]);

  function titleFor(session: ProductSession) {
    const title = session.config_snapshot?.title;
    return typeof title === "string" && title.trim() ? title : "Product interview";
  }

  function dateFor(session: ProductSession) {
    const value = session.started_at ?? session.created_at;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  }

  function durationFor(session: ProductSession) {
    if (!session.started_at || !session.ended_at) return null;
    const minutes = Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60_000);
    return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
  }

  function statusFor(status: string) {
    return status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  const latestWithReport = sessions.find((session) => reports[session.id]);
  const latestReport = latestWithReport ? reports[latestWithReport.id] : undefined;
  const scoredCompetencies = latestReport?.competencies.filter((item) => item.score !== null) ?? [];
  const recommended = scoredCompetencies.reduce<(typeof scoredCompetencies)[number] | undefined>(
    (lowest, item) => !lowest || (item.score ?? 0) < (lowest.score ?? 0) ? item : lowest,
    undefined,
  );
  const monthMinutes = sessions.reduce((total, session) => {
    if (!session.started_at) return total;
    const started = new Date(session.started_at);
    const now = new Date();
    if (started.getFullYear() !== now.getFullYear() || started.getMonth() !== now.getMonth()) return total;
    return total + (durationFor(session) ?? 0);
  }, 0);
  const practiceTime = monthMinutes >= 60 ? `${(monthMinutes / 60).toFixed(monthMinutes % 60 ? 1 : 0)}h` : `${monthMinutes}m`;
  const completedCount = sessions.filter((session) => session.status === "ended").length;

  if (loading) {
    return (
      <AppShell screen="dashboard" title={`Welcome back, ${displayName}`} description="Loading your practice workspace…" actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
        <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label="Loading interview workspace">
          {[0, 1, 2].map((item) => <Card key={item} className="h-36 animate-pulse bg-muted/50" />)}
        </div>
        <Card className="mt-6 h-72 animate-pulse bg-muted/50" />
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell screen="dashboard" title={`Welcome back, ${displayName}`} description="Your practice workspace is temporarily unavailable." actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
        <Alert title="Could not load your interviews" variant="destructive"><span>{error}</span></Alert>
        <Button className="mt-4" variant="secondary" onClick={() => { setLoading(true); setError(""); setUnavailableReports(0); setReload((value) => value + 1); }}>Try again</Button>
      </AppShell>
    );
  }

  return (
    <AppShell screen="dashboard" title={`Welcome back, ${displayName}`} description="Practice with purpose, then use the evidence to improve." actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
      {unavailableReports ? <div className="mb-5"><Alert title="Some assessments are still unavailable"><span>{unavailableReports} completed {unavailableReports === 1 ? "session has" : "sessions have"} no readable report yet. Session history is still shown below.</span></Alert></div> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card><CardContent className="p-5"><span className="grid size-9 place-items-center rounded-md bg-primary/10 text-primary"><Gauge className="size-4" aria-hidden="true" /></span><p className="mt-5 text-3xl font-semibold tracking-tight">{latestReport?.overall_score == null ? "N/A" : Math.round(latestReport.overall_score)}</p><p className="mt-1 text-xs text-muted-foreground">Latest readiness score</p></CardContent></Card>
        <Card><CardContent className="p-5"><span className="grid size-9 place-items-center rounded-md bg-secondary text-muted-foreground"><Clock3 className="size-4" aria-hidden="true" /></span><p className="mt-5 text-3xl font-semibold tracking-tight">{practiceTime}</p><p className="mt-1 text-xs text-muted-foreground">Completed practice this month</p></CardContent></Card>
        <Card><CardContent className="p-5"><span className="grid size-9 place-items-center rounded-md bg-secondary text-muted-foreground"><Target className="size-4" aria-hidden="true" /></span><p className="mt-5 text-3xl font-semibold tracking-tight">{completedCount}</p><p className="mt-1 text-xs text-muted-foreground">Completed {completedCount === 1 ? "interview" : "interviews"}</p></CardContent></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader><CardTitle>{latestReport ? "Latest assessment" : "Build your readiness baseline"}</CardTitle><CardDescription>{latestWithReport ? `${titleFor(latestWithReport)} · ${dateFor(latestWithReport)}` : "Your first completed interview will create an evidence-linked assessment."}</CardDescription></CardHeader>
          {latestReport && latestWithReport ? <CardContent>
            <div className="flex flex-col gap-5 rounded-lg border bg-background p-4 sm:flex-row sm:items-center"><div className="grid size-16 shrink-0 place-items-center rounded-lg bg-primary/10 text-2xl font-semibold text-primary">{latestReport.overall_score == null ? "N/A" : Math.round(latestReport.overall_score)}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium capitalize">{latestReport.readiness.replaceAll("_", " ")}</p><Badge variant="secondary">{dateFor(latestWithReport)}</Badge></div>{latestReport.summary ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{latestReport.summary}</p> : null}</div><Button asChild variant="secondary"><Link href={`/reports/${latestWithReport.id}`}>Open report<ArrowRight aria-hidden="true" /></Link></Button></div>
            {scoredCompetencies.length ? <div className="mt-5 grid gap-3 sm:grid-cols-3">{scoredCompetencies.slice(0, 3).map((item) => <div key={item.key} className="rounded-md bg-secondary p-3"><div className="flex items-center justify-between gap-2"><span className="truncate text-xs text-muted-foreground">{item.label}</span><span className="font-mono text-xs">{Math.round(item.score ?? 0)}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-background"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, item.score ?? 0))}%` }} /></div></div>)}</div> : null}
          </CardContent> : <CardContent><div className="grid min-h-40 place-items-center rounded-lg border border-dashed p-6 text-center"><div><MessageSquareText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No completed assessment yet</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">Run a panel interview to collect transcript-linked evidence, scoring, and focused follow-up practice.</p><Button asChild className="mt-4"><Link href="/setup">Create your first interview<ArrowRight aria-hidden="true" /></Link></Button></div></div></CardContent>}
        </Card>
        <Card><CardHeader><CardTitle>Recommended next</CardTitle><CardDescription>{recommended ? "Based on your lowest scored competency" : "Start with one realistic panel session"}</CardDescription></CardHeader><CardContent><span className="grid size-10 place-items-center rounded-md bg-primary/10 text-primary"><BarChart3 className="size-5" aria-hidden="true" /></span><h3 className="mt-5 font-medium">{recommended?.label ?? "Create a tailored interview"}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{recommended?.feedback || "Add an optional job description, choose your interviewers, and set the difficulty for your target role."}</p><Button asChild className="mt-5 w-full"><Link href={latestWithReport ? `/replay/${latestWithReport.id}` : "/setup"}>{latestWithReport ? <Play aria-hidden="true" /> : <Plus aria-hidden="true" />}{latestWithReport ? "Practice this gap" : "Build interview"}</Link></Button></CardContent></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><div className="flex items-center justify-between gap-4"><div><CardTitle>Recent interviews</CardTitle><CardDescription>Your newest configured and completed sessions</CardDescription></div>{sessions.length > 4 ? <Button variant="ghost" asChild><Link href="/history">View all</Link></Button> : null}</div></CardHeader><CardContent className="space-y-1">{sessions.slice(0, 4).map((session) => {
          const report = reports[session.id];
          const content = <><span className="grid size-9 place-items-center rounded-md border bg-background"><MessageSquareText className="size-4 text-muted-foreground" aria-hidden="true" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{titleFor(session)}</span><span className="block text-xs text-muted-foreground">{dateFor(session)} · {statusFor(session.status)}</span></span><span className="font-mono text-sm">{report?.overall_score == null ? "N/A" : Math.round(report.overall_score)}</span>{report ? <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /> : null}</>;
          return report ? <Link key={session.id} href={`/reports/${session.id}`} className="flex items-center gap-3 rounded-md px-2 py-3 hover:bg-accent">{content}</Link> : <div key={session.id} className="flex items-center gap-3 rounded-md px-2 py-3">{content}</div>;
        })}{!sessions.length ? <div className="py-8 text-center"><p className="text-sm font-medium">Your interview history starts here</p><p className="mt-1 text-xs text-muted-foreground">Create a session and it will appear in this workspace.</p></div> : null}</CardContent></Card>
        <Card><CardHeader><CardTitle>Shape your panel</CardTitle><CardDescription>Reusable expertise, behavior, and challenge level</CardDescription></CardHeader><CardContent><span className="grid size-10 place-items-center rounded-md bg-secondary text-muted-foreground"><BookOpenText className="size-5" aria-hidden="true" /></span><p className="mt-5 text-sm leading-6 text-muted-foreground">Start with a built-in interviewer prompt, edit a private copy, or write your own. Every interview can include two to five specialist panelists.</p><Button variant="secondary" asChild className="mt-5"><Link href="/prompts">Browse interviewer prompts<ArrowRight aria-hidden="true" /></Link></Button></CardContent></Card>
      </div>
    </AppShell>
  );
}

export function HistoryScreen() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sessions, setSessions] = useState<ProductSession[]>([]);
  const [reports, setReports] = useState<Record<string, SessionReport>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unavailableReports, setUnavailableReports] = useState(0);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void listInterviewSessions()
      .then(async (items) => {
        const completed = items.filter((item) => item.status === "ended");
        const results = await Promise.allSettled(
          completed.map(async (item) => ({ sessionId: item.id, report: await getSessionReport(item.id) })),
        );
        if (cancelled) return;
        const nextReports: Record<string, SessionReport> = {};
        let failed = 0;
        for (const result of results) {
          if (result.status === "fulfilled") nextReports[result.value.sessionId] = result.value.report;
          else failed += 1;
        }
        setSessions(items);
        setReports(nextReports);
        setUnavailableReports(failed);
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Interview history could not be loaded.");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [reload]);

  function titleFor(session: ProductSession) {
    const title = session.config_snapshot?.title;
    return typeof title === "string" && title.trim() ? title : "Product interview";
  }

  function dateFor(session: ProductSession) {
    const value = session.started_at ?? session.created_at;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
  }

  function durationFor(session: ProductSession) {
    if (!session.started_at || !session.ended_at) return "N/A";
    const minutes = Math.round((new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60_000);
    return Number.isFinite(minutes) && minutes >= 0 ? `${minutes} min` : "N/A";
  }

  function statusFor(value: string) {
    return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = sessions.filter((session) => {
    const matchesStatus = status === "all" || session.status === status;
    const matchesQuery = !normalizedQuery || `${titleFor(session)} ${session.status} ${session.id}`.toLowerCase().includes(normalizedQuery);
    return matchesStatus && matchesQuery;
  });

  if (loading) {
    return (
      <AppShell screen="history" title="Interview history" description="Loading your sessions and assessments…" actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
        <Card aria-busy="true" aria-label="Loading interview history"><div className="h-16 animate-pulse border-b bg-muted/50" /><div className="space-y-px">{[0, 1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse border-b bg-muted/30 last:border-0" />)}</div></Card>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell screen="history" title="Interview history" description="Your saved sessions are temporarily unavailable." actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
        <Alert title="Could not load interview history" variant="destructive"><span>{error}</span></Alert>
        <Button className="mt-4" variant="secondary" onClick={() => { setLoading(true); setError(""); setUnavailableReports(0); setReload((value) => value + 1); }}>Try again</Button>
      </AppShell>
    );
  }

  return (
    <AppShell screen="history" title="Interview history" description="Review every session, report, and evidence trail." actions={<Button asChild><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>}>
      {unavailableReports ? <div className="mb-5"><Alert title="Some reports could not be loaded"><span>Session details remain available. Scores are shown only where an assessment was returned.</span></Alert></div> : null}
      <Card>
        {sessions.length ? <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center"><div className="relative flex-1"><Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input name="history_search" value={query} onChange={(event) => setQuery(event.target.value)} className="ps-9" placeholder="Search title, status, or session ID…" aria-label="Search interview history" /></div><div className="w-full sm:w-44"><Select name="history_status" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter interview status"><option value="all">All statuses</option><option value="configured">Configured</option><option value="live">Live</option><option value="ending">Ending</option><option value="ended">Completed</option><option value="failed">Failed</option></Select></div></div> : null}
        {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[44rem] text-sm"><caption className="sr-only">Interview sessions and assessment availability</caption><thead><tr className="border-b text-start text-xs text-muted-foreground"><th className="px-5 py-3 text-start font-medium">Interview</th><th className="px-5 py-3 text-start font-medium">Date</th><th className="px-5 py-3 text-start font-medium">Duration</th><th className="px-5 py-3 text-start font-medium">Score</th><th className="px-5 py-3 text-start font-medium">Status</th><th className="w-28"><span className="sr-only">Report</span></th></tr></thead><tbody>{filtered.map((session) => {
          const report = reports[session.id];
          const title = titleFor(session);
          return <tr key={session.id} className="border-b last:border-0 hover:bg-accent/40"><td className="px-5 py-4"><p className="font-medium">{title}</p><p className="mt-0.5 max-w-64 truncate font-mono text-[10px] text-muted-foreground">{session.id}</p></td><td className="px-5 py-4 text-muted-foreground">{dateFor(session)}</td><td className="px-5 py-4 text-muted-foreground">{durationFor(session)}</td><td className="px-5 py-4 font-mono">{report?.overall_score == null ? "N/A" : Math.round(report.overall_score)}</td><td className="px-5 py-4"><Badge variant={session.status === "live" ? "default" : "secondary"}>{statusFor(session.status)}</Badge></td><td className="pe-3 text-end">{report ? <Button asChild variant="ghost" size="sm"><Link href={`/reports/${session.id}`}>Report<ArrowRight aria-hidden="true" /></Link></Button> : <span className="text-xs text-muted-foreground">Not ready</span>}</td></tr>;
        })}</tbody></table></div> : sessions.length ? <div className="grid min-h-64 place-items-center p-6 text-center"><div><Search className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><h2 className="mt-4 font-medium">No matching interviews</h2><p className="mt-1 text-sm text-muted-foreground">Try a different search or status.</p><Button variant="ghost" className="mt-3" onClick={() => { setQuery(""); setStatus("all"); }}>Clear filters</Button></div></div> : <div className="grid min-h-72 place-items-center p-6 text-center"><div><MessageSquareText className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><h2 className="mt-4 font-medium">No interviews yet</h2><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Create a panel interview and this page will keep its status, timing, score, and evidence-linked report.</p><Button asChild className="mt-4"><Link href="/setup"><Plus aria-hidden="true" />Create your first interview</Link></Button></div></div>}
      </Card>
    </AppShell>
  );
}

const PROMPT_TOOL_OPTIONS = [
  { id: "knowledge_search", label: "Knowledge search", detail: "Uploaded JD and role context" },
  { id: "calculator", label: "Calculator", detail: "Deterministic metric arithmetic" },
  { id: "web_search", label: "Web search", detail: "Current public facts when necessary" },
] as const;

type PromptEditorMode = "view" | "fork" | "create";
type PromptDraft = {
  name: string;
  role: string;
  description: string;
  prompt: string;
  mood: string;
  tools: string[];
  knowledge: Record<string, unknown>;
  behavior: Record<string, unknown>;
};

const EMPTY_PROMPT_DRAFT: PromptDraft = {
  name: "",
  role: "Product Interviewer",
  description: "",
  prompt: "",
  mood: "professional",
  tools: ["knowledge_search"],
  knowledge: { domains: [], scoring_focus: [], scenario_seeds: [], rubric: [] },
  behavior: { adaptive_probe: "" },
};

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

type PromptRubricDetail = {
  key: string;
  label: string;
  evidence: string;
  anchors: Array<{ score: string; description: string }>;
};

function promptRubric(value: unknown): PromptRubricDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const criterion = objectValue(item);
    if (!criterion) return [];
    const anchors = objectValue(criterion.anchors);
    const label = stringValue(criterion.label);
    if (!label) return [];
    return [{
      key: stringValue(criterion.key) || `${label}-${index}`,
      label,
      evidence: stringValue(criterion.evidence),
      anchors: ["1", "3", "5"].flatMap((score) => {
        const description = stringValue(anchors?.[score]);
        return description ? [{ score, description }] : [];
      }),
    }];
  });
}

function promptSearchText(template: PromptTemplateRecord) {
  const rubric = promptRubric(template.knowledge.rubric);
  return [
    template.name,
    template.role,
    template.description,
    stringValue(template.knowledge.case_type),
    ...stringArray(template.knowledge.domains),
    ...stringArray(template.knowledge.scoring_focus),
    ...stringArray(template.knowledge.scenario_seeds),
    stringValue(template.behavior.adaptive_probe),
    ...rubric.flatMap((criterion) => [
      criterion.label,
      criterion.evidence,
      ...criterion.anchors.map((anchor) => anchor.description),
    ]),
  ].join(" ").toLowerCase();
}

function promptDraftFrom(template: PromptTemplateRecord): PromptDraft {
  return {
    name: template.name,
    role: template.role,
    description: template.description,
    prompt: template.prompt,
    mood: typeof template.behavior.mood === "string" ? template.behavior.mood : "professional",
    tools: stringArray(template.behavior.allowed_tools).filter((tool) => PROMPT_TOOL_OPTIONS.some((option) => option.id === tool)),
    knowledge: template.knowledge,
    behavior: template.behavior,
  };
}

function promptSlug(name: string) {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "custom-interviewer";
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

export function PromptLibraryScreen() {
  const [templates, setTemplates] = useState<PromptTemplateRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<PromptEditorMode>("view");
  const [draft, setDraft] = useState<PromptDraft>(EMPTY_PROMPT_DRAFT);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (mode === "view") return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    void listPromptTemplates()
      .then((items) => {
        if (cancelled) return;
        setTemplates(items);
        setSelectedId((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
        setLoading(false);
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "The prompt library could not be loaded.");
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reload]);

  const selected = templates.find((item) => item.id === selectedId) ?? null;
  const shownDraft = mode === "view" && selected ? promptDraftFrom(selected) : draft;
  const normalizedQuery = query.trim().toLowerCase();
  const filteredTemplates = templates.filter((item) => !normalizedQuery || promptSearchText(item).includes(normalizedQuery));
  const domains = stringArray(shownDraft.knowledge.domains);
  const scoringFocus = stringArray(shownDraft.knowledge.scoring_focus);
  const scenarioSeeds = stringArray(shownDraft.knowledge.scenario_seeds);
  const caseType = stringValue(shownDraft.knowledge.case_type);
  const adaptiveProbe = stringValue(shownDraft.behavior.adaptive_probe);
  const rubric = promptRubric(shownDraft.knowledge.rubric);

  function chooseTemplate(template: PromptTemplateRecord) {
    if (mode !== "view" && !window.confirm("Discard this unsaved prompt draft?")) return;
    setSelectedId(template.id);
    setMode("view");
    setSaveError("");
    setNotice("");
  }

  function startFork() {
    if (!selected) return;
    setDraft({ ...promptDraftFrom(selected), name: selected.is_builtin ? `${selected.name} copy` : selected.name });
    setMode("fork");
    setSaveError("");
  }

  function startCreate() {
    if (mode !== "view" && !window.confirm("Discard this unsaved prompt draft and start again?")) return;
    setDraft({
      ...EMPTY_PROMPT_DRAFT,
      tools: [...EMPTY_PROMPT_DRAFT.tools],
      knowledge: { domains: [], scoring_focus: [], scenario_seeds: [], rubric: [] },
      behavior: { adaptive_probe: "" },
    });
    setMode("create");
    setSaveError("");
    setNotice("");
  }

  function updateDraft(patch: Partial<PromptDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function togglePromptTool(tool: string) {
    setDraft((current) => ({
      ...current,
      tools: current.tools.includes(tool) ? current.tools.filter((item) => item !== tool) : [...current.tools, tool],
    }));
  }

  async function savePrompt() {
    if (mode === "view") return;
    if (!draft.name.trim() || !draft.role.trim() || draft.prompt.trim().length < 40) {
      setSaveError("Add a name, role, and interviewer prompt of at least 40 characters.");
      window.requestAnimationFrame(() => {
        const target = !draft.name.trim() ? "prompt_name" : !draft.role.trim() ? "prompt_role" : "prompt_body";
        document.querySelector<HTMLElement>(`[name="${target}"]`)?.focus();
      });
      return;
    }
    setSaving(true);
    setSaveError("");
    const behavior = {
      ...draft.behavior,
      mood: draft.mood,
      allowed_tools: draft.tools,
      panel_selection: "non_round_robin",
      evidence_policy: "final_transcript_turn_ids_only",
    };
    const knowledge = stringArray(draft.knowledge.domains).length ? draft.knowledge : { ...draft.knowledge, domains: [draft.role] };
    try {
      const saved = mode === "fork" && selected
        ? await forkPromptTemplate(selected.id, {
            name: draft.name.trim(),
            description: draft.description.trim(),
            prompt: draft.prompt.trim(),
            knowledge,
            behavior,
          })
        : await createPromptTemplate({
            slug: promptSlug(draft.name),
            name: draft.name.trim(),
            role: draft.role.trim(),
            description: draft.description.trim(),
            prompt: draft.prompt.trim(),
            knowledge,
            behavior,
          });
      const items = await listPromptTemplates();
      setTemplates(items);
      setSelectedId(saved.id);
      setMode("view");
      setNotice(mode === "fork" ? `Revision ${saved.version} was created without changing the source prompt.` : "Your private interviewer prompt is ready for future panels.");
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "The prompt could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell screen="prompts" title="Prompt library" description="Loading built-in and private interviewer prompts…" actions={<Button disabled><Plus aria-hidden="true" />New prompt</Button>}>
        <div className="grid gap-5 lg:grid-cols-[20rem_1fr]" aria-busy="true" aria-label="Loading prompt library"><Card className="h-96 animate-pulse bg-muted/40" /><Card className="h-[34rem] animate-pulse bg-muted/30" /></div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell screen="prompts" title="Prompt library" description="Built-in and private prompts are temporarily unavailable.">
        <Alert title="Could not load prompt library" variant="destructive"><span>{error}</span></Alert>
        <Button className="mt-4" variant="secondary" onClick={() => { setLoading(true); setError(""); setReload((value) => value + 1); }}>Try again</Button>
      </AppShell>
    );
  }

  return (
    <AppShell screen="prompts" title="Prompt library" description="Use a protected PM specialist, create an immutable private prompt, or fork a new revision." actions={<Button onClick={startCreate}><Plus aria-hidden="true" />New prompt</Button>}>
      {notice ? <div className="mb-5"><Alert title="Prompt saved" onDismiss={() => setNotice("")}>{notice}</Alert></div> : null}
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit overflow-hidden">
          <div className="border-b p-3">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input name="prompt_search" value={query} onChange={(event) => setQuery(event.target.value)} className="ps-9" placeholder="Search cases, skills, or probes…" aria-label="Search prompt library" />
            </div>
          </div>
          {templates.length ? (
            <div className="max-h-[42rem] overflow-y-auto overscroll-contain p-2" role="group" aria-label="Prompt templates">
              {filteredTemplates.map((item) => {
                const itemFocus = stringArray(item.knowledge.scoring_focus).slice(0, 2);
                const itemCaseType = stringValue(item.knowledge.case_type);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={selectedId === item.id && mode !== "create"}
                    onClick={() => chooseTemplate(item)}
                    className={cn("w-full rounded-md p-3 text-start hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", selectedId === item.id && mode !== "create" && "bg-accent")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.name}</span>
                      {item.is_builtin ? <LockKeyhole className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : <Copy className="size-3.5 shrink-0 text-primary" aria-hidden="true" />}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{itemCaseType || item.role}</p>
                    {itemFocus.length ? <div className="mt-2 flex flex-wrap gap-1">{itemFocus.map((focus) => <span key={focus} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{focus}</span>)}</div> : null}
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant={item.is_builtin ? "secondary" : "default"}>{item.is_builtin ? "Built-in" : "Private"}</Badge>
                      <span className="font-mono text-[10px] text-muted-foreground">v{item.version}</span>
                    </div>
                  </button>
                );
              })}
              {!filteredTemplates.length ? <div className="p-8 text-center"><Search className="mx-auto size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No matching prompts</p><Button variant="ghost" size="sm" className="mt-2" onClick={() => setQuery("")}>Clear search</Button></div> : null}
            </div>
          ) : <div className="grid min-h-72 place-items-center p-6 text-center"><div><BookOpenText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No prompts available</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Create a private specialist while the built-in catalog is being configured.</p><Button className="mt-4" onClick={startCreate}><Plus aria-hidden="true" />Create prompt</Button></div></div>}
        </Card>

        <Card>
          {selected || mode === "create" ? <>
            <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>{mode === "create" ? "New private interviewer" : mode === "fork" ? `New revision of ${selected?.name}` : selected?.name}</CardTitle><CardDescription>{mode === "view" ? `${selected?.is_builtin ? "RoundCraft built-in" : "Private immutable prompt"} · version ${selected?.version}` : mode === "fork" ? "The source stays unchanged. This saves a new private version." : "Define a reusable specialist for future panels."}</CardDescription></div><Badge variant={mode === "view" ? "secondary" : "default"}>{mode === "view" ? "Read only" : "Editing"}</Badge></div></CardHeader>
            <CardContent className="space-y-5">
              {mode === "view" ? <Alert title="Immutable prompt"><span>Prompt versions are never edited in place. Create a revision to preserve the exact configuration used by past interviews.</span></Alert> : null}
              {saveError ? <Alert title="Prompt could not be saved" variant="destructive"><span>{saveError}</span></Alert> : null}
              <div className="grid gap-4 sm:grid-cols-2"><Field label="Prompt name" required={mode !== "view"}><Input name="prompt_name" value={shownDraft.name} readOnly={mode === "view"} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="Name this interviewer prompt" /></Field><Field label="Role" required={mode !== "view"} hint={mode === "fork" ? "Inherited by revision" : undefined}><Input name="prompt_role" value={shownDraft.role} readOnly={mode !== "create"} onChange={(event) => updateDraft({ role: event.target.value })} placeholder="Example: Product Strategy Interviewer" /></Field></div>
              <Field label="Description"><Input name="prompt_description" value={shownDraft.description} readOnly={mode === "view"} onChange={(event) => updateDraft({ description: event.target.value })} placeholder="Summarize the interview focus" /></Field>
              {mode === "view" ? (
                <section className="rounded-lg border bg-muted/20 p-4" aria-labelledby="prompt-practice-design">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 id="prompt-practice-design" className="text-sm font-medium">Practice design</h3>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">The case, evidence targets, and follow-up behavior this specialist brings to a panel.</p>
                    </div>
                    {caseType ? <Badge variant="outline">{caseType}</Badge> : null}
                  </div>
                  {scoringFocus.length ? <div className="mt-4 flex flex-wrap gap-2" aria-label="Scoring focus">{scoringFocus.map((focus) => <Badge key={focus} variant="secondary">{focus}</Badge>)}</div> : null}
                  {adaptiveProbe ? <div className="mt-4 border-s-2 border-primary/40 ps-3"><p className="text-xs font-medium">Adaptive probe</p><p className="mt-1 text-sm leading-6 text-muted-foreground">{adaptiveProbe}</p></div> : null}
                  {scenarioSeeds.length ? <div className="mt-4"><p className="text-xs font-medium">Scenario seeds</p><ul className="mt-2 grid gap-2 sm:grid-cols-3">{scenarioSeeds.map((scenario) => <li key={scenario} className="rounded-md bg-background p-3 text-xs leading-5 text-muted-foreground ring-1 ring-border">{scenario}</li>)}</ul></div> : null}
                </section>
              ) : (
                <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Case type"><Input name="prompt_case_type" value={caseType} onChange={(event) => updateDraft({ knowledge: { ...shownDraft.knowledge, case_type: event.target.value } })} placeholder="Example: Strategy choice case" /></Field>
                    <Field label="Scoring focus" hint="Comma separated"><Input name="prompt_scoring_focus" value={scoringFocus.join(", ")} onChange={(event) => updateDraft({ knowledge: { ...shownDraft.knowledge, scoring_focus: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })} placeholder="market diagnosis, strategic choice" /></Field>
                  </div>
                  <Field label="Adaptive probe"><Input name="prompt_adaptive_probe" value={adaptiveProbe} onChange={(event) => updateDraft({ behavior: { ...shownDraft.behavior, adaptive_probe: event.target.value } })} placeholder="Challenge the weakest assumption in the latest answer" /></Field>
                  <Field label="Scenario seeds" hint="One scenario per line"><Textarea name="prompt_scenario_seeds" value={scenarioSeeds.join("\n")} onChange={(event) => updateDraft({ knowledge: { ...shownDraft.knowledge, scenario_seeds: event.target.value.split("\n").map((value) => value.trim()).filter(Boolean) } })} className="min-h-28" placeholder="Add realistic interview scenarios…" /></Field>
                </div>
              )}
              <Field label="Interviewer system prompt" hint={`${shownDraft.prompt.length} characters`} required={mode !== "view"}><Textarea name="prompt_body" value={shownDraft.prompt} readOnly={mode === "view"} onChange={(event) => updateDraft({ prompt: event.target.value })} className="min-h-72 break-words" placeholder="Define expertise, adaptive probes, interruption behavior, evidence rules, and boundaries." /></Field>
              <div className="grid gap-4 sm:grid-cols-2"><Field label="Default mood"><Select name="prompt_mood" value={shownDraft.mood} disabled={mode === "view"} onChange={(event) => updateDraft({ mood: event.target.value })}><option value="professional">Professional</option><option value="curious">Curious</option><option value="direct">Direct</option><option value="focused">Focused</option><option value="warm-direct">Warm and direct</option><option value="challenging">Challenging</option></Select></Field>{mode === "view" ? <div><p className="text-sm font-medium">Knowledge domains</p><div className="mt-2 flex min-h-10 flex-wrap items-center gap-2 overflow-hidden rounded-md border bg-background px-3 py-2">{domains.length ? domains.map((domain) => <Badge key={domain} variant="outline" className="max-w-full break-all">{domain}</Badge>) : <span className="text-xs text-muted-foreground">Derived from the interviewer role</span>}</div></div> : <Field label="Knowledge domains" hint="Comma separated"><Input name="knowledge_domains" value={domains.join(", ")} onChange={(event) => updateDraft({ knowledge: { ...shownDraft.knowledge, domains: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) } })} placeholder="pricing, growth loops, retention" /></Field>}</div>
              <div><div className="mb-2 flex items-center justify-between gap-3"><p className="text-sm font-medium">Live interviewer tools</p><span className="text-xs text-muted-foreground">No human review</span></div><div className="grid gap-2 sm:grid-cols-3">{PROMPT_TOOL_OPTIONS.map((tool) => <label key={tool.id} className={cn("flex items-start gap-3 rounded-md border bg-background p-3", mode === "view" && "text-muted-foreground")}><input name="prompt_tools" value={tool.id} type="checkbox" checked={shownDraft.tools.includes(tool.id)} disabled={mode === "view"} onChange={() => togglePromptTool(tool.id)} className="mt-0.5 size-4 accent-[var(--primary)]" /><span><span className="block text-xs font-medium text-foreground">{tool.label}</span><span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{tool.detail}</span></span></label>)}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Evidence linking and replay drills are managed by the platform, not called by an interviewer.</p></div>
              {rubric.length ? (
                <section aria-labelledby="prompt-observable-rubric">
                  <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                    <div><h3 id="prompt-observable-rubric" className="text-sm font-medium">Observable rubric</h3><p className="mt-1 text-xs text-muted-foreground">Anchors describe what transcript evidence at each level should contain.</p></div>
                    <span className="text-xs text-muted-foreground">{rubric.length} criteria</span>
                  </div>
                  <div className="overflow-hidden rounded-md border bg-background">
                    {rubric.map((criterion) => (
                      <details key={criterion.key} className="group border-b last:border-b-0">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                          <span><span className="block text-sm font-medium">{criterion.label}</span>{criterion.evidence ? <span className="mt-1 block text-xs leading-5 text-muted-foreground">{criterion.evidence}</span> : null}</span>
                          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                        </summary>
                        <div className="grid gap-px border-t bg-border sm:grid-cols-3">
                          {criterion.anchors.map((anchor) => <div key={anchor.score} className="bg-muted/20 p-3"><Badge variant="outline">Level {anchor.score}</Badge><p className="mt-2 text-xs leading-5 text-muted-foreground">{anchor.description}</p></div>)}
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              ) : null}
              <Alert title="Panel behavior"><span>This prompt participates in live, non-round-robin selection. It receives shared context, adapts probes to the latest answer, and must link scoring claims to final transcript evidence.</span></Alert>
              <div className="flex flex-wrap gap-2">{mode === "view" ? <><Button asChild><Link href="/setup"><Play aria-hidden="true" />Use in setup</Link></Button><Button variant="secondary" onClick={startFork}><Copy aria-hidden="true" />{selected?.is_builtin ? "Edit a private copy" : "Create revision"}</Button></> : <Button loading={saving} onClick={savePrompt}><Check aria-hidden="true" />{mode === "fork" ? "Save revision" : "Create prompt"}</Button>}<Button variant="ghost" onClick={startCreate}><Plus aria-hidden="true" />Start blank</Button>{mode !== "view" ? <Button variant="ghost" onClick={() => { if (!window.confirm("Discard this unsaved prompt draft?")) return; setMode("view"); setSaveError(""); }}><Trash2 aria-hidden="true" />Discard draft</Button> : null}</div>
            </CardContent>
          </> : <CardContent className="grid min-h-[34rem] place-items-center p-6 text-center"><div><BookOpenText className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><p className="mt-4 font-medium">Select or create a prompt</p><p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">Built-ins are protected. Every edit creates a traceable private revision.</p><Button className="mt-4" onClick={startCreate}><Plus aria-hidden="true" />New prompt</Button></div></CardContent>}
        </Card>
      </div>
    </AppShell>
  );
}

export function ReplayScreen({ sessionId }: { sessionId?: string }) {
  const [active, setActive] = useState(0);
  const [remoteDrills, setRemoteDrills] = useState<SessionReplayDrill[]>([]);
  const [sessions, setSessions] = useState<ProductSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const request = sessionId
      ? listSessionReplayDrills(sessionId).then((items) => items.length ? items : generateSessionReplayDrills(sessionId))
      : listInterviewSessions();
    void request
      .then((items) => {
        if (cancelled) return;
        if (sessionId) setRemoteDrills(items as SessionReplayDrill[]);
        else setSessions((items as ProductSession[]).filter((session) => session.status === "ended"));
        setLoading(false);
      })
      .catch((cause) => { if (!cancelled) { setLoadError(cause instanceof Error ? cause.message : "Replay drills could not load"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [sessionId]);
  const drills = remoteDrills.map((item) => ({ title: item.competency.replaceAll("_", " "), focus: item.competency.replaceAll("_", " "), length: "Focused drill", source: item.source_turn_ids.join(", ") || "report gap", prompt: item.prompt }));
  const drill = drills[active];
  if (loading) return <AppShell screen="replay" title="Preparing replay drills" description="Turning evidence gaps into focused practice."><Card className="p-6" aria-busy="true"><div className="h-7 w-48 animate-pulse rounded-md bg-muted" /><div className="mt-4 h-40 animate-pulse rounded-lg bg-muted" /></Card></AppShell>;
  if (loadError) return <AppShell screen="replay" title="Replay drills unavailable" description="The report remains available."><Alert title="Could not load replay drills" variant="destructive"><span>{loadError}</span></Alert><Button asChild className="mt-4"><Link href={sessionId ? `/reports/${sessionId}` : "/history"}>{sessionId ? "Back to report" : "Open interview history"}</Link></Button></AppShell>;
  if (!sessionId) return <AppShell screen="replay" title="Replay drills" description="Choose a completed interview to generate or continue evidence-specific practice."><div className="grid gap-4 sm:grid-cols-2">{sessions.map((session) => { const title = typeof session.config_snapshot?.title === "string" ? session.config_snapshot.title : "Product interview"; return <Card key={session.id}><CardContent className="p-5"><Badge variant="secondary">Completed</Badge><h2 className="mt-4 font-medium">{title}</h2><p className="mt-1 font-mono text-[10px] text-muted-foreground">{session.id}</p><Button asChild className="mt-5"><Link href={`/replay/${session.id}`}><Sparkles aria-hidden="true" />Open replay drills</Link></Button></CardContent></Card>; })}</div>{!sessions.length ? <Card className="grid min-h-64 place-items-center p-6 text-center"><div><Sparkles className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No completed interview yet</p><p className="mt-1 text-xs text-muted-foreground">Replay drills are generated from real transcript evidence after a session ends.</p><Button asChild className="mt-4"><Link href="/setup">Create an interview</Link></Button></div></Card> : null}</AppShell>;
  if (!drill) return <AppShell screen="replay" title="No replay drills yet" description="This session did not produce an evidence gap that needs a targeted drill."><Card className="grid min-h-64 place-items-center p-6 text-center"><div><Sparkles className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">Nothing to replay</p><p className="mt-1 text-xs text-muted-foreground">Complete another interview to collect more assessment evidence.</p><Button asChild className="mt-4"><Link href="/setup">Start an interview</Link></Button></div></Card></AppShell>;
  return (
    <AppShell screen="replay" title="Replay drills" description="Short, evidence-specific practice generated from your actual interview gaps.">
      <div className="grid gap-5 lg:grid-cols-[20rem_1fr]">
        <Card className="h-fit"><CardHeader><CardTitle className="text-sm">Your queue</CardTitle><CardDescription>{drills.length} recommended {drills.length === 1 ? "drill" : "drills"}</CardDescription></CardHeader><CardContent className="space-y-1">{drills.map((item, index) => <button key={item.title} type="button" onClick={() => setActive(index)} className={cn("w-full rounded-md p-3 text-start hover:bg-accent", active === index && "bg-accent")}><div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{item.title}</span><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></div><p className="mt-1 text-xs text-muted-foreground">{item.focus} · {item.length}</p></button>)}</CardContent></Card>
        <Card><CardHeader><div className="flex items-start justify-between gap-4"><div><Badge variant="default">{drill.focus}</Badge><CardTitle className="mt-4 text-xl">{drill.title}</CardTitle><CardDescription className="mt-1">Linked to {drill.source}</CardDescription></div><Headphones className="size-6 text-primary" aria-hidden="true" /></div></CardHeader><CardContent><div className="rounded-lg border bg-background p-5"><p className="text-xs text-muted-foreground">Challenge</p><p className="mt-3 text-lg leading-7">{drill.prompt}</p></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Timebox</p><p className="mt-1 text-sm font-medium">{drill.length}</p></div><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Format</p><p className="mt-1 text-sm font-medium">Panel practice</p></div><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Interviewer</p><p className="mt-1 text-sm font-medium">Selected live</p></div></div><div className="mt-6 flex flex-wrap gap-2"><Button asChild><Link href="/setup"><Play aria-hidden="true" />Practice with a panel</Link></Button><Button asChild variant="secondary"><Link href={`/reports/${sessionId}`}><MessageSquareText aria-hidden="true" />Review evidence</Link></Button></div></CardContent></Card>
      </div>
    </AppShell>
  );
}

export function SettingsScreen() {
  const { user, displayName, initials, updateProfile } = useAuth();
  const metadata = user?.user_metadata ?? {};
  const stored = metadata.roundcraft_preferences && typeof metadata.roundcraft_preferences === "object"
    ? metadata.roundcraft_preferences as Record<string, unknown>
    : {};
  const [tab, setTab] = useState("profile");
  const [name, setName] = useState(displayName);
  const [targetRole, setTargetRole] = useState(String(metadata.target_role || "Product Manager"));
  const [durationMinutes, setDurationMinutes] = useState(Number(stored.duration_minutes) || 35);
  const [difficulty, setDifficulty] = useState<"supportive" | "balanced" | "challenging" | "executive">(
    ["supportive", "balanced", "challenging", "executive"].includes(String(stored.difficulty))
      ? String(stored.difficulty) as "supportive" | "balanced" | "challenging" | "executive"
      : "challenging",
  );
  const [panelSize, setPanelSize] = useState(Math.min(5, Math.max(2, Number(stored.panel_size) || 3)));
  const [allowInterruption, setAllowInterruption] = useState(stored.allow_interruption !== false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function saveSettings() {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      await updateProfile({
        displayName: name,
        preferences: { targetRole, durationMinutes, difficulty, panelSize, allowInterruption },
      });
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell screen="settings" title="Settings" description="Manage your profile, interview defaults, data, and live-audio preferences.">
      {saved ? <div className="mb-5"><Alert title="Settings saved" onDismiss={() => setSaved(false)}>Your workspace preferences are up to date.</Alert></div> : null}
      {error ? <div className="mb-5"><Alert title="Settings could not be saved" variant="destructive"><span>{error}</span></Alert></div> : null}
      <div className="grid gap-6 md:grid-cols-[13rem_1fr]">
        <nav className="space-y-1" aria-label="Settings sections" role="tablist" aria-orientation="vertical">{[["profile",UserRound,"Profile"],["interview",Settings2,"Interview defaults"],["audio",Headphones,"Audio and Agora"],["privacy",ShieldCheck,"Privacy and data"]].map(([id, Icon, label]) => { const C = Icon as typeof UserRound; return <button key={String(id)} id={`settings-tab-${String(id)}`} type="button" role="tab" aria-selected={tab === id} aria-controls={`settings-panel-${String(id)}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(String(id))} className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent", tab === id && "bg-accent text-foreground")}><C className="size-4" aria-hidden="true" />{String(label)}</button>; })}</nav>
        <Card>
          {tab === "profile" ? <section id="settings-panel-profile" role="tabpanel" aria-labelledby="settings-tab-profile"><CardHeader><CardTitle>Profile</CardTitle><CardDescription>Used to personalize your practice workspace.</CardDescription></CardHeader><CardContent className="space-y-5"><Avatar initials={initials} className="size-14 text-base" /><div className="grid gap-4 sm:grid-cols-2"><Field label="Full name"><Input name="display_name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></Field><Field label="Email" hint="Managed by Supabase Auth"><Input name="email" type="email" value={user?.email ?? ""} readOnly autoComplete="email" spellCheck={false} /></Field></div><Field label="Target role"><Input name="target_role" value={targetRole} onChange={(event) => setTargetRole(event.target.value)} placeholder="Senior Product Manager" /></Field><Button loading={saving} onClick={() => void saveSettings()}>Save profile</Button></CardContent></section> : null}
          {tab === "interview" ? <section id="settings-panel-interview" role="tabpanel" aria-labelledby="settings-tab-interview"><CardHeader><CardTitle>Interview defaults</CardTitle><CardDescription>Applied when no job description overrides them.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="grid gap-4 sm:grid-cols-2"><Field label="Default duration"><Select name="default_duration" value={String(durationMinutes)} onChange={(event) => setDurationMinutes(Number(event.target.value))}><option value="20">20 minutes</option><option value="35">35 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option></Select></Field><Field label="Default difficulty"><Select name="default_difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="supportive">Supportive</option><option value="balanced">Balanced</option><option value="challenging">Challenging</option><option value="executive">Executive</option></Select></Field></div><Field label="Default panel size"><Select name="default_panel_size" value={String(panelSize)} onChange={(event) => setPanelSize(Number(event.target.value))}><option value="2">2 interviewers</option><option value="3">3 interviewers</option><option value="4">4 interviewers</option><option value="5">5 interviewers</option></Select></Field><Button loading={saving} onClick={() => void saveSettings()}>Save defaults</Button></CardContent></section> : null}
          {tab === "audio" ? <section id="settings-panel-audio" role="tabpanel" aria-labelledby="settings-tab-audio"><CardHeader><CardTitle>Audio and Agora</CardTitle><CardDescription>Live audio connects through short-lived Agora RTC and RTM tokens.</CardDescription></CardHeader><CardContent className="space-y-5"><Alert title="Credential boundary"><span>Your browser receives channel tokens only. The Agora App Certificate stays on the server.</span></Alert><label className="flex items-start justify-between gap-4 rounded-lg border p-4"><span><span className="block text-sm font-medium">Candidate interruption</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">Let your voice interrupt the active interviewer naturally.</span></span><input name="allow_interruption" type="checkbox" checked={allowInterruption} onChange={(event) => setAllowInterruption(event.target.checked)} className="mt-1 size-4 accent-[var(--primary)]" /></label><Button loading={saving} onClick={() => void saveSettings()}>Save audio settings</Button></CardContent></section> : null}
          {tab === "privacy" ? <section id="settings-panel-privacy" role="tabpanel" aria-labelledby="settings-tab-privacy"><CardHeader><CardTitle>Privacy and data</CardTitle><CardDescription>Understand what RoundCraft retains for your private practice workspace.</CardDescription></CardHeader><CardContent className="space-y-5"><Alert title="Raw audio is not retained"><span>RoundCraft keeps final transcript turns and linked evidence for reports. Production audio recording remains disabled.</span></Alert><div className="rounded-lg border p-4"><p className="text-sm font-medium">Candidate documents</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Job descriptions are stored in your private Supabase workspace and only attached to interviews you create.</p><Button asChild variant="secondary" size="sm" className="mt-3"><Link href="/setup">Add a job description</Link></Button></div></CardContent></section> : null}
        </Card>
      </div>
    </AppShell>
  );
}

export type ReportEvidenceLink = {
  turnId: string;
  competencyKey: string | null;
  reason: string;
};

export function getReportEvidenceLinks(report: Pick<SessionReport, "competencies" | "evidence_map"> | null): ReportEvidenceLink[] {
  if (!report) return [];
  const links = new Map<string, ReportEvidenceLink>();
  const competenciesByKey = new Map(report.competencies.map((item) => [item.key, item]));
  const add = (turnId: string, competencyKey: string | null, reason: string) => {
    const id = turnId.trim();
    if (!id) return;
    links.set(`${id}\u0000${competencyKey ?? ""}`, { turnId: id, competencyKey, reason });
  };

  for (const competency of report.competencies) {
    const reason = competency.feedback.trim() || `The assessment cites this turn for ${competency.label}.`;
    for (const turnId of competency.evidence_turn_ids) add(turnId, competency.key, reason);
  }
  for (const item of report.evidence_map) {
    const turnId = typeof item.transcript_turn_id === "string" ? item.transcript_turn_id : "";
    const competencyKey = typeof item.competency === "string" && item.competency.trim() ? item.competency : null;
    const competency = competencyKey ? competenciesByKey.get(competencyKey) : undefined;
    const reason = competency?.feedback.trim()
      || (competency ? `The assessment cites this turn for ${competency.label}.` : competencyKey ? `Cited in the report evidence map for ${competencyKey.replaceAll("_", " ")}.` : "Cited in the report evidence map.");
    add(turnId, competencyKey, reason);
  }
  return [...links.values()];
}

export function filterAvailableEvidenceLinks(links: ReportEvidenceLink[], availableTurnIds: string[]): ReportEvidenceLink[] {
  const available = new Set(availableTurnIds);
  return links.filter((item) => available.has(item.turnId));
}

export function ReportScreen({ sessionId = "demo" }: { sessionId?: string }) {
  const { initials } = useAuth();
  const realSession = sessionId !== "demo";
  const [selectedTurn, setSelectedTurn] = useState(realSession ? "" : "turn-04");
  const [selectedCompetencyKey, setSelectedCompetencyKey] = useState<string | null>(null);
  const [tab, setTab] = useState<"assessment" | "transcript" | "tools">("assessment");
  const [report, setReport] = useState<SessionReport | null>(null);
  const [realTurns, setRealTurns] = useState<SessionTurn[]>([]);
  const [realTools, setRealTools] = useState<SessionToolRun[]>([]);
  const [loading, setLoading] = useState(realSession);
  const [loadError, setLoadError] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState("");
  const [regeneratedAt, setRegeneratedAt] = useState("");
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

  const reportTurns = useMemo(() => realSession ? realTurns.map((turn) => ({
    id: turn.id,
    speaker: turn.speaker_type === "candidate" ? "You" : turn.speaker_id || "Interviewer",
    kind: turn.speaker_type === "candidate" ? "candidate" as const : "panel" as const,
    time: turn.started_at ? new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(turn.started_at)) : `#${turn.sequence}`,
    text: turn.content,
  })) : transcript, [realSession, realTurns]);
  const availableTurnIds = useMemo(() => new Set(reportTurns.map((turn) => turn.id)), [reportTurns]);
  const reportCompetencies = report ? report.competencies.map((item) => ({
    key: item.key,
    name: item.label,
    score: item.score,
    level: item.score === null ? "Insufficient evidence" : item.score >= 80 ? "Strong" : "Developing",
    evidence: item.evidence_turn_ids.filter((turnId) => availableTurnIds.has(turnId)),
    note: item.feedback,
  })) : competencies.map((item, index) => ({
    ...item,
    key: `demo-${index}`,
    evidence: item.evidence.filter((turnId) => availableTurnIds.has(turnId)),
  }));
  const evidenceLinks = useMemo(() => {
    const links = realSession
      ? getReportEvidenceLinks(report)
      : competencies.flatMap((item, index) => item.evidence.map((turnId) => ({ turnId, competencyKey: `demo-${index}`, reason: item.note })));
    return filterAvailableEvidenceLinks(links, reportTurns.map((turn) => turn.id));
  }, [realSession, report, reportTurns]);
  const selectedEvidence = evidenceLinks.find((item) => item.turnId === selectedTurn && (!selectedCompetencyKey || item.competencyKey === selectedCompetencyKey)) ?? evidenceLinks[0];
  const sidebarTurn = tab === "assessment"
    ? reportTurns.find((turn) => turn.id === selectedEvidence?.turnId)
    : tab === "transcript" ? reportTurns.find((turn) => turn.id === selectedTurn) ?? reportTurns[0] : undefined;
  const evidenceReason = tab === "assessment" ? selectedEvidence?.reason : undefined;
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

  async function regenerateAssessment() {
    if (!realSession) return;
    setRegenerating(true);
    setRegenerateError("");
    setRegeneratedAt("");
    try {
      const nextReport = await generateSessionReport(sessionId, { regenerate: true });
      setReport(nextReport);
      setSelectedTurn("");
      setSelectedCompetencyKey(null);
      setRegeneratedAt(nextReport.generated_at);
    } catch (cause) {
      setRegenerateError(cause instanceof Error ? cause.message : "Assessment could not be regenerated");
    } finally {
      setRegenerating(false);
    }
  }

  function exportReport() {
    const contents = JSON.stringify({
      session_id: sessionId,
      overall_score: overallScore,
      readiness,
      summary,
      competencies: reportCompetencies,
      transcript: reportTurns,
      tools: reportToolRows,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `roundcraft-${sessionId}-report.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <AppShell screen="history" title="Generating your report" description="RoundCraft is reconciling final Agora turns and linked evidence."><Card className="p-6" aria-busy="true"><div className="h-8 w-44 animate-pulse rounded-md bg-muted" /><div className="mt-5 h-48 animate-pulse rounded-lg bg-muted" /></Card></AppShell>;
  if (loadError) return <AppShell screen="history" title="Report unavailable" description="The session is safe, but its report could not be loaded."><Alert title="Could not load report" variant="destructive"><span>{loadError}</span></Alert><Button className="mt-4" onClick={() => { setLoading(true); setLoadError(""); setReload((value) => value + 1); }}>Try again</Button></AppShell>;
  return (
    <AppShell screen="history" title={realSession ? "Interview assessment" : "Senior PM, Growth"} description={realSession ? `Completed session ${sessionId}` : "Demo report · Completed Aug 30 · 34 minutes · 3 panelists"} actions={<>{realSession && report?.readiness === "insufficient_evidence" ? <Button variant="secondary" loading={regenerating} onClick={() => void regenerateAssessment()}><Sparkles aria-hidden="true" />Re-run assessment</Button> : null}<Button variant="secondary" onClick={exportReport}><Download aria-hidden="true" />Export report</Button><Button asChild><Link href={realSession ? `/replay/${sessionId}` : "/auth/sign-up?next=%2Freplay"}><Play aria-hidden="true" />Practice gaps</Link></Button></>}>
      {regenerateError ? <div className="mb-5"><Alert title="Assessment could not be regenerated" variant="destructive"><span>{regenerateError}. Your existing report is unchanged; retry when the assessment service is available.</span></Alert></div> : null}
      {regeneratedAt ? <div className="mb-5"><Alert title="Assessment regenerated"><span>The latest assessment was generated <time dateTime={regeneratedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(regeneratedAt))}</time>. Its current evidence status is shown below.</span></Alert></div> : null}
      <div className="grid gap-5 sm:grid-cols-[11rem_1fr] lg:grid-cols-[14rem_1fr_19rem]">
        <Card className="h-fit"><CardContent className="p-3"><nav className="space-y-1" aria-label="Report sections">{[["assessment",Gauge,"Assessment"],["transcript",MessageSquareText,"Transcript"],["tools",Wrench,"Tool activity"]].map(([id, Icon, label]) => { const C = Icon as typeof Gauge; return <button key={String(id)} type="button" aria-pressed={tab === id} onClick={() => setTab(id as typeof tab)} className={cn("flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent", tab === id && "bg-accent text-foreground")}><C className="size-4" aria-hidden="true" />{String(label)}</button>; })}</nav></CardContent></Card>

        <div className="min-w-0 space-y-5">
          {tab === "assessment" ? <>
            <Card><CardContent className="p-5"><div className="flex flex-col gap-5 sm:flex-row sm:items-end"><div><p className="text-sm text-muted-foreground">Overall readiness</p><p className="mt-1 text-6xl font-semibold tracking-[-0.05em]">{overallScore}<span className="text-xl text-muted-foreground">{overallScore === "N/A" ? "" : "/100"}</span></p></div><div className="sm:ms-auto sm:max-w-sm"><Badge variant="default">{readiness}</Badge><p className="mt-2 text-sm leading-6 text-muted-foreground">{summary}</p></div></div></CardContent></Card>
            <Card><CardHeader><CardTitle>Structured assessment</CardTitle><CardDescription>Each score requires linked transcript evidence.</CardDescription></CardHeader><CardContent className="space-y-3">{reportCompetencies.map((item) => <div key={item.key} className="rounded-lg border bg-background p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h3 className="text-sm font-medium">{item.name}</h3>{item.score === null ? <Badge variant="outline"><CircleAlert className="size-3" aria-hidden="true" />Insufficient evidence</Badge> : <Badge variant="secondary">{item.level}</Badge>}</div><p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{item.note}</p></div><span className={cn("font-mono text-xl font-medium", item.score === null && "text-muted-foreground")}>{item.score ?? "N/A"}</span></div>{item.evidence.length ? <div className="mt-4 flex flex-wrap gap-2">{item.evidence.map((id) => <button key={id} type="button" aria-pressed={selectedEvidence?.turnId === id && selectedEvidence.competencyKey === item.key} onClick={() => { setSelectedTurn(id); setSelectedCompetencyKey(item.key); }} className={cn("max-w-full truncate rounded-md border px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary/50 hover:text-foreground", selectedEvidence?.turnId === id && selectedEvidence.competencyKey === item.key && "border-primary/60 bg-primary/10 text-primary")}>{id}</button>)}</div> : <div className="mt-4"><Button size="sm" variant="secondary" asChild><Link href={realSession ? `/replay/${sessionId}` : "/replay"}><Sparkles aria-hidden="true" />Create evidence drill</Link></Button></div>}</div>)}</CardContent></Card>
          </> : null}
          {tab === "transcript" ? <Card><CardHeader><CardTitle>Session transcript</CardTitle><CardDescription>Final and interrupted turns from the Agora live session.</CardDescription></CardHeader><CardContent className="space-y-2">{reportTurns.map((turn) => <button key={turn.id} type="button" aria-pressed={sidebarTurn?.id === turn.id} onClick={() => { setSelectedTurn(turn.id); setSelectedCompetencyKey(null); }} className={cn("w-full rounded-lg border p-4 text-start", sidebarTurn?.id === turn.id ? "border-primary/50 bg-primary/5" : "bg-background hover:bg-accent/40")}><div className="flex items-center justify-between"><span className="text-xs font-medium">{turn.speaker}</span><span className="max-w-[60%] truncate font-mono text-[10px] text-muted-foreground">{turn.time} · {turn.id}</span></div><p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{turn.text}</p></button>)}{!reportTurns.length ? <div className="py-12 text-center"><MessageSquareText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No final transcript turns</p><p className="mt-1 text-xs text-muted-foreground">The report correctly records that no usable transcript evidence was captured.</p></div> : null}</CardContent></Card> : null}
          {tab === "tools" ? <Card><CardHeader><CardTitle>Tool audit</CardTitle><CardDescription>Every interviewer tool run, its purpose, and linked evidence.</CardDescription></CardHeader><CardContent className="space-y-3">{reportToolRows.length ? reportToolRows.map((run) => <div key={run.id} className="flex items-start gap-3 rounded-lg border bg-background p-4"><span className="grid size-9 place-items-center rounded-md bg-secondary"><Wrench className="size-4 text-muted-foreground" aria-hidden="true" /></span><div className="min-w-0 flex-1"><p className="capitalize text-sm font-medium">{run.tool}</p><p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">{run.result}</p><div className="mt-2 flex gap-2"><Badge variant="secondary">{run.status}</Badge><Badge variant="outline" className="max-w-36 truncate">{run.turn}</Badge></div></div><span className="font-mono text-[10px] text-muted-foreground">{run.time}</span></div>) : <div className="py-12 text-center"><Wrench className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No tools were needed</p><p className="mt-1 text-xs text-muted-foreground">This session completed without an interviewer tool call.</p></div>}</CardContent></Card> : null}
        </div>

        <aside className="sm:col-span-2 lg:col-span-1">{sidebarTurn ? <Card className="sticky top-20"><CardHeader><div className="flex items-center justify-between"><CardTitle className="text-sm">{tab === "assessment" ? "Linked evidence" : "Transcript turn"}</CardTitle><Badge variant="outline">{sidebarTurn.id}</Badge></div></CardHeader><CardContent><div className="flex items-center gap-2"><Avatar initials={sidebarTurn.kind === "candidate" ? (realSession ? initials : "YO") : sidebarTurn.speaker.slice(0, 2).toUpperCase()} className="size-8" /><div><p className="text-xs font-medium">{sidebarTurn.speaker}</p><p className="font-mono text-[10px] text-muted-foreground">{sidebarTurn.time}</p></div></div><p className="mt-4 text-sm leading-6 text-muted-foreground">{sidebarTurn.text}</p>{evidenceReason ? <><Separator className="my-4" /><p className="text-xs font-medium">Why it matters</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{evidenceReason}</p></> : null}{tab === "assessment" ? <Button variant="ghost" size="sm" className="mt-3 px-0" onClick={() => { setSelectedTurn(sidebarTurn.id); setTab("transcript"); }}>Open in transcript<ExternalLink aria-hidden="true" /></Button> : null}</CardContent></Card> : tab === "assessment" ? <Card className="sticky top-20 p-5 text-center"><CircleAlert className="mx-auto size-5 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No linked evidence</p><p className="mt-1 text-xs leading-5 text-muted-foreground">This assessment does not cite a transcript turn.</p></Card> : null}</aside>
      </div>
    </AppShell>
  );
}
