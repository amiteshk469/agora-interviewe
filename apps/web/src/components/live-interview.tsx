"use client";

import { useRouter } from "next/navigation";
import {
  AudioLines,
  BookOpen,
  Check,
  CircleStop,
  FileSearch,
  Gauge,
  Info,
  MessageSquareText,
  PanelRightClose,
  Pause,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  TimerReset,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgoraLivePanel, type LiveAgentState, type LiveMediaState, type LiveTranscriptTurn } from "@/components/agora-live";
import { Brand } from "@/components/app-shell";
import { CandidateVideoTile, PanelVideoTile, type PanelPresence } from "@/components/panel-video";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, Avatar, Badge, Button, Card } from "@/components/ui";
import { defaultPanelists, toolActivity, transcript, type Panelist } from "@/data/demo";
import { avatarUidForPanelist, demoSpeakerIndex, presenceForPanelist } from "@/lib/live-panel";
import { cn, formatDuration } from "@/lib/utils";
import {
  demoModeEnabled,
  endInterviewSession,
  generateSessionReport,
  listSessionToolRuns,
  persistSessionTurn,
  readLiveSession,
  type SessionToolRun,
  type StoredLiveSession,
} from "@/lib/api";

type PanelSnapshot = {
  id?: string;
  display_name?: string;
  role?: string;
  mood?: string;
  behavior?: string;
  voice?: string;
  custom_prompt?: string;
  knowledge_prompt?: string;
  avatar_id?: string;
  avatar_vendor?: Panelist["avatarVendor"];
  avatar_image?: string;
};

const initialMedia: LiveMediaState = {
  localCameraTrack: null,
  cameraEnabled: false,
  microphoneEnabled: false,
  remoteVideos: [],
  connectionState: "DISCONNECTED",
};

function selectedPresence(agentState: LiveAgentState, demo: boolean): PanelPresence {
  if (demo) return "speaking";
  if (agentState === "thinking") return "thinking";
  if (agentState === "listening" || agentState === "silent") return "listening";
  return "speaking";
}

export function LiveInterviewScreen() {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(328);
  const [activeTab, setActiveTab] = useState<"transcript" | "tools">("transcript");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [agentState, setAgentState] = useState<LiveAgentState>("speaking");
  const [mediaState, setMediaState] = useState<LiveMediaState>(initialMedia);
  const [idlePhase, setIdlePhase] = useState(0);
  const [demoStep, setDemoStep] = useState(0);
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [liveTurns, setLiveTurns] = useState<LiveTranscriptTurn[]>([]);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [storedSession, setStoredSession] = useState<StoredLiveSession | null>(null);
  const [persistedTools, setPersistedTools] = useState<SessionToolRun[]>([]);
  const persistedTurns = useRef(new Set<string>());
  const pendingTurnWrites = useRef(new Set<Promise<unknown>>());

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!motionEnabled) return;
    const timer = window.setInterval(() => setIdlePhase((current) => current + 1), 5600);
    return () => window.clearInterval(timer);
  }, [motionEnabled]);

  useEffect(() => {
    if (storedSession && !storedSession.demo) return;
    const timer = window.setInterval(() => setDemoStep((current) => current + 1), 11800);
    return () => window.clearInterval(timer);
  }, [storedSession]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const session = readLiveSession();
      if (!session && !demoModeEnabled) {
        router.replace("/setup");
        return;
      }
      setStoredSession(session);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    if (!storedSession || storedSession.demo) return;
    let cancelled = false;
    const loadTools = () => void listSessionToolRuns(storedSession.sessionId)
      .then((items) => { if (!cancelled) setPersistedTools(items); })
      .catch((error) => console.warn("Tool activity refresh failed", error));
    loadTools();
    const timer = window.setInterval(loadTools, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [storedSession]);

  const configuredPanel = useMemo<Panelist[]>(() => {
    const snapshot = storedSession?.configSnapshot as { panel?: PanelSnapshot[] } | undefined;
    if (!snapshot?.panel?.length) return defaultPanelists;
    return snapshot.panel.slice(0, 5).map((person, index) => {
      const fallback = defaultPanelists[index % defaultPanelists.length];
      const name = person.display_name || fallback.name;
      return {
        ...fallback,
        id: person.id || fallback.id,
        name,
        role: person.role || fallback.role,
        initials: name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
        avatarImage: person.avatar_image || fallback.avatarImage,
        avatarId: person.avatar_id || fallback.avatarId,
        avatarVendor: person.avatar_vendor || fallback.avatarVendor,
        mood: person.mood || fallback.mood,
        behavior: person.behavior || fallback.behavior,
        voice: person.voice || fallback.voice,
        prompt: person.custom_prompt || person.knowledge_prompt || fallback.prompt,
      };
    });
  }, [storedSession]);

  const latestDirectorBid = useMemo(
    () => [...persistedTools].reverse().find((run) => run.tool_name === "panel.bid"),
    [persistedTools],
  );
  const directorMetadata = latestDirectorBid?.result as {
    selected_panelist?: { id?: string; display_name?: string; role?: string };
    director?: { action?: string; rationale?: string; suggested_question?: string };
  } | undefined;
  const selectedPanelistId = directorMetadata?.selected_panelist?.id;
  const activeIndex = selectedPanelistId
    ? Math.max(0, configuredPanel.findIndex((person) => person.id === selectedPanelistId))
    : demoSpeakerIndex(demoStep, configuredPanel.length);
  const activePanelist = configuredPanel[activeIndex] || configuredPanel[0] || defaultPanelists[0];
  const visualPanel = useMemo(
    () => [activePanelist, ...configuredPanel.filter((person) => person.id !== activePanelist.id)],
    [activePanelist, configuredPanel],
  );

  const handleLiveTranscript = useCallback((turns: LiveTranscriptTurn[]) => {
    setLiveTurns(turns);
    if (!storedSession || storedSession.demo) return;
    turns.forEach((turn, index) => {
      if (!turn.final || !turn.text || persistedTurns.current.has(turn.id)) return;
      persistedTurns.current.add(turn.id);
      const write = persistSessionTurn(storedSession.sessionId, {
        sequence: index + 1,
        agora_turn_id: turn.id,
        speaker_type: turn.isLocal ? "candidate" : "interviewer",
        speaker_id: turn.isLocal ? undefined : turn.uid,
        content: turn.text,
        interrupted: turn.interrupted,
        metadata: { source: "agora_rtm" },
      }).catch((error) => {
        persistedTurns.current.delete(turn.id);
        console.warn("Transcript turn persistence failed", error);
      });
      pendingTurnWrites.current.add(write);
      void write.finally(() => pendingTurnWrites.current.delete(write));
    });
  }, [storedSession]);

  async function finishInterview() {
    setEnding(true);
    try {
      if (storedSession && !storedSession.demo) {
        await Promise.allSettled([...pendingTurnWrites.current]);
        await endInterviewSession(storedSession.sessionId);
        await generateSessionReport(storedSession.sessionId);
      }
    } catch (error) {
      if (!demoModeEnabled) console.error("Session end failed", error);
    } finally {
      router.push(storedSession && !storedSession.demo ? `/reports/${storedSession.sessionId}` : "/reports/demo");
      setEnding(false);
    }
  }

  const displayedTranscript = useMemo(() => {
    if (!liveTurns.length) return storedSession && !storedSession.demo ? [] : transcript;
    return liveTurns.map((turn, index) => {
      const participant = storedSession?.connection?.panelists?.find((item) => String(item.agent_uid) === String(turn.uid));
      const panelist = configuredPanel.find((person) => person.id === participant?.panelist_id);
      return {
        id: turn.id || `live-${index}`,
        speaker: turn.isLocal ? "You" : panelist?.name || "Live panel",
        kind: turn.isLocal ? "candidate" as const : "panel" as const,
        time: formatDuration(elapsed),
        text: turn.text,
        interrupted: turn.interrupted,
      };
    });
  }, [configuredPanel, elapsed, liveTurns, storedSession]);

  const activeQuestion = [...liveTurns].reverse().find((turn) => !turn.isLocal && turn.text)?.text
    || directorMetadata?.director?.suggested_question
    || (storedSession && !storedSession.demo
      ? "The panel will begin when Agora audio connects."
      : "You called pulse feedback a guardrail. Why is it not the outcome itself, and what decision would a decline trigger?");
  const directorSummary = directorMetadata?.director
    ? directorMetadata.director.rationale || "The director selected the strongest next perspective."
    : `${activePanelist.name} owns this turn. Any interviewer can return when the evidence calls for it.`;
  const snapshotTitle = (storedSession?.configSnapshot as { title?: string } | undefined)?.title || "Senior Product Manager practice";
  const displayedTools = storedSession && !storedSession.demo
    ? persistedTools.map((run) => ({
        id: run.id,
        name: run.tool_name.replaceAll("_", " "),
        detail: Object.keys(run.result).length ? JSON.stringify(run.result) : run.error || "No result",
        status: run.status,
        time: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(run.created_at)),
      }))
    : toolActivity;
  const interruptionCount = displayedTranscript.filter((turn) => "interrupted" in turn && turn.interrupted).length || 2;
  const sessionIsDemo = !storedSession || storedSession.demo;

  return (
    <div className={cn("grid min-h-[100dvh] bg-background lg:grid-cols-[10.5rem_minmax(0,1fr)] xl:h-[100dvh] xl:grid-cols-[10.5rem_minmax(0,1fr)_16.75rem] xl:overflow-hidden", !motionEnabled && "motion-paused")}>
      <a href="#live-stage" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4">Skip to interview</a>

      <aside className="m-1 me-0 hidden min-h-0 flex-col rounded-xl border bg-card/72 px-3 py-5 shadow-[var(--panel-shadow)] backdrop-blur lg:flex" aria-label="Interview overview">
        <div className="flex justify-center"><Brand stacked /></div>
        <ThemeToggle segmented className="mt-6" />
        <Button variant="ghost" size="sm" className="mt-1 w-full" onClick={() => setMotionEnabled((current) => !current)}>{motionEnabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}{motionEnabled ? "Pause motion" : "Resume motion"}</Button>

        <div className="mt-8">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Live panel</p>
            <span className="size-2 animate-pulse rounded-full bg-primary" aria-hidden="true" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="flex -space-x-2">
              {configuredPanel.map((person) => <Avatar key={person.id} initials={person.initials} src={person.avatarImage} className="size-7 rounded-full border-2 border-card" />)}
            </div>
            <span className="text-xs text-muted-foreground">{configuredPanel.length} interviewers</span>
          </div>
        </div>

        <div className="mt-7 border-t pt-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Interview</p>
          <h1 className="mt-2 text-sm font-semibold leading-5">{snapshotTitle}</h1>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Elapsed</dt><dd className="font-mono font-medium">{formatDuration(elapsed)}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Question</dt><dd className="font-medium">4 of 8</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Interruptions</dt><dd className="font-medium">{interruptionCount}</dd></div>
          </dl>
        </div>

        <div className="mt-6 rounded-xl border bg-background/78 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold"><Sparkles className="size-3.5 text-primary" aria-hidden="true" />Panel Director</div>
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{directorSummary}</p>
        </div>

        <div className="mt-auto border-t pt-4 text-[11px] leading-5 text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground"><ShieldCheck className="size-3.5 text-primary" aria-hidden="true" />Data protected</p>
          <p className="mt-1">One panelist is audible at a time. Transcript evidence stays attached to this session.</p>
        </div>
      </aside>

      <main id="live-stage" className="relative flex min-w-0 flex-col overflow-hidden">
        <div className="pointer-events-none absolute inset-0 surface-grid opacity-[0.035]" aria-hidden="true" />
        <header className="relative flex h-14 shrink-0 items-center gap-3 border-b bg-background/86 px-4 backdrop-blur lg:hidden">
          <Brand />
          <div className="ms-auto flex items-center gap-2">
            <Badge variant="default"><Radio className="size-3" aria-hidden="true" />Live</Badge>
            <span className="rounded-md border bg-card px-2 py-1 font-mono text-xs">{formatDuration(elapsed)}</span>
            <ThemeToggle />
            <Button variant="ghost" size="icon" onClick={() => setMotionEnabled((current) => !current)} aria-label={motionEnabled ? "Pause panel motion" : "Resume panel motion"}>{motionEnabled ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}</Button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 lg:px-5 xl:px-6">
          <div className="mx-auto flex min-h-full max-w-[77rem] flex-col gap-3">
            <div className="flex items-center justify-between gap-4 px-0.5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Interview room</p>
                <p className="mt-0.5 text-sm font-medium">All panelists are present and following context</p>
              </div>
              <Badge variant={sessionIsDemo ? "secondary" : "default"}><UsersRound className="size-3" aria-hidden="true" />{sessionIsDemo ? "Guided demo" : "Agora connected"}</Badge>
            </div>

            <section className="grid grid-cols-2 auto-rows-[clamp(8.5rem,20vh,12.5rem)] gap-2.5 lg:h-[clamp(26rem,56vh,40rem)] lg:grid-cols-3 lg:grid-rows-[1.25fr_1fr] lg:gap-3" aria-label="Live interview video wall">
              {visualPanel.map((person, visualIndex) => {
                const configuredIndex = configuredPanel.findIndex((item) => item.id === person.id);
                const selected = person.id === activePanelist.id;
                const state = selected
                  ? selectedPresence(agentState, sessionIsDemo)
                  : presenceForPanelist(Math.max(0, configuredIndex), idlePhase, false);
                const avatarUid = avatarUidForPanelist(person, storedSession?.connection?.panelists);
                const track = mediaState.remoteVideos.find((video) => video.uid === String(avatarUid))?.track;
                return (
                  <PanelVideoTile
                    key={person.id}
                    person={person}
                    state={state}
                    selected={selected}
                    track={track}
                    motionIndex={configuredIndex + idlePhase}
                    className={cn("h-full", visualIndex === 0 && "col-span-2")}
                  />
                );
              })}
            </section>

            <CandidateVideoTile
              track={mediaState.localCameraTrack}
              cameraEnabled={mediaState.cameraEnabled}
              className="h-[clamp(10rem,23vh,15.25rem)]"
            />

            <section className="grid gap-3 rounded-xl border bg-card/92 p-3 shadow-[var(--panel-shadow)] backdrop-blur sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-4" aria-labelledby="current-question-title">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default"><AudioLines className="size-3" aria-hidden="true" />{activePanelist.name}</Badge>
                  <span className="text-[11px] text-muted-foreground">{activePanelist.role}</span>
                </div>
                <h2 id="current-question-title" className="mt-2 text-sm font-semibold leading-6 sm:text-base">{activeQuestion}</h2>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Info className="size-3" aria-hidden="true" />Speak naturally to interrupt. The whole panel keeps the same context.</p>
              </div>
              <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
                <AgoraLivePanel prepared={storedSession} onTranscript={handleLiveTranscript} onAgentState={setAgentState} onMediaState={setMediaState} />
                <Button variant="secondary" onClick={() => setEndOpen(true)}><CircleStop aria-hidden="true" />End</Button>
              </div>
            </section>
          </div>
        </div>
      </main>

      <aside className={cn("fixed inset-y-0 end-0 z-30 flex w-[min(22rem,94vw)] min-h-0 flex-col border-s bg-background shadow-2xl xl:static xl:z-auto xl:m-1 xl:ms-0 xl:flex xl:w-auto xl:rounded-xl xl:border xl:shadow-[var(--panel-shadow)]", detailsOpen ? "flex" : "hidden xl:flex")} aria-label="Session evidence">
        <div className="flex min-h-16 items-center border-b px-3">
          <div className="grid flex-1 grid-cols-2 rounded-lg bg-secondary p-1" role="tablist">
            <button type="button" role="tab" aria-selected={activeTab === "transcript"} onClick={() => setActiveTab("transcript")} className={cn("min-h-9 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", activeTab === "transcript" && "bg-card text-foreground shadow-sm")}>Transcript</button>
            <button type="button" role="tab" aria-selected={activeTab === "tools"} onClick={() => setActiveTab("tools")} className={cn("min-h-9 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", activeTab === "tools" && "bg-card text-foreground shadow-sm")}>Tool activity</button>
          </div>
          <Button variant="ghost" size="icon" className="ms-2 xl:hidden" onClick={() => setDetailsOpen(false)} aria-label="Close details"><PanelRightClose aria-hidden="true" /></Button>
        </div>

        {activeTab === "transcript" ? (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" role="tabpanel">
            <div className="space-y-5">
              {displayedTranscript.map((turn) => (
                <article key={turn.id} className={cn("text-sm", turn.kind === "candidate" && "ps-5")}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn("text-xs font-semibold", turn.kind === "candidate" ? "text-foreground" : "text-primary")}>{turn.speaker}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{turn.time}</span>
                  </div>
                  <p className="mt-1.5 leading-6 text-muted-foreground">{turn.text}</p>
                  <span className="mt-1.5 block font-mono text-[9px] text-muted-foreground/60">{turn.id}</span>
                </article>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />{displayedTranscript.length ? "Listening for your answer" : "Waiting for the first transcript turn"}</div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" role="tabpanel">
            <Alert title="Tools run only when useful"><span>Search, calculation, and evidence actions are role-scoped and stored in the audit trail.</span></Alert>
            <div className="mt-4 space-y-3">
              {displayedTools.map((activity, index) => (
                <div key={activity.id} className="rounded-xl border bg-card p-3">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 place-items-center rounded-md bg-secondary">{index === 0 ? <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" /> : index === 1 ? <Gauge className="size-4 text-muted-foreground" aria-hidden="true" /> : <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />}</span>
                    <div className="min-w-0 flex-1"><p className="capitalize text-xs font-semibold">{activity.name}</p><p className="mt-1 line-clamp-3 break-words text-[11px] leading-5 text-muted-foreground">{activity.detail}</p></div>
                    <Check className="size-3.5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground"><span>{activity.status}</span><span>{activity.time}</span></div>
                </div>
              ))}
            </div>
            {!displayedTools.length ? <div className="py-12 text-center"><Gauge className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No tool activity yet</p><p className="mt-1 text-xs text-muted-foreground">Useful calls appear here as the panel works.</p></div> : null}
          </div>
        )}
      </aside>

      <Button variant="secondary" size="icon" className="fixed bottom-4 end-4 z-20 shadow-xl xl:hidden" onClick={() => setDetailsOpen(true)} aria-label="Open transcript and tools"><MessageSquareText aria-hidden="true" /></Button>

      {endOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="end-title">
          <Card className="w-full max-w-md p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-md bg-secondary"><TimerReset className="size-5 text-muted-foreground" aria-hidden="true" /></span>
              <div><h2 id="end-title" className="font-semibold">End this interview?</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">RoundCraft will stop the Agora panel, reconcile the transcript, and create the evidence-linked assessment.</p></div>
            </div>
            <div className="mt-6 flex justify-end gap-2"><Button variant="ghost" onClick={() => setEndOpen(false)}>Keep practicing</Button><Button loading={ending} onClick={finishInterview}>End and create report</Button></div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
