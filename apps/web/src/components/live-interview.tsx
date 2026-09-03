"use client";

import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  CircleStop,
  FileSearch,
  Gauge,
  MessageSquareText,
  PanelRightClose,
  TimerReset,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { AgoraLivePanel, type LiveAgentState, type LiveMediaState, type LiveTranscriptTurn } from "@/components/agora-live";
import { Brand } from "@/components/app-shell";
import { PanelTile, SpotlightSpeaker, type PanelPresence } from "@/components/panel-video";
import { Alert, Badge, Button, Card } from "@/components/ui";
import { defaultPanelists, toolActivity, transcript, type Panelist } from "@/data/demo";
import { avatarUidForPanelist, demoSpeakerIndex, describeToolRun, interviewerToolRuns, mergeLiveTurns, presenceForPanelist, readLiveContradiction, speakerSequence } from "@/lib/live-panel";
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

type EvidenceTab = "transcript" | "tools" | "director";
const EVIDENCE_TABS: EvidenceTab[] = ["transcript", "tools", "director"];

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function trapFocus(event: ReactKeyboardEvent, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>(focusableSelector)]
    .filter((element) => element.tabIndex >= 0 && !element.hidden && element.getAttribute("aria-hidden") !== "true");
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

const initialMedia: LiveMediaState = {
  microphoneEnabled: false,
  candidateSpeaking: false,
  remoteVideos: [],
  connectionState: "DISCONNECTED",
};

function selectedPresence(agentState: LiveAgentState, demo: boolean): PanelPresence {
  if (demo) return "speaking";
  if (agentState === "thinking") return "thinking";
  if (agentState === "speaking") return "speaking";
  return "listening";
}

export function LiveInterviewScreen() {
  const router = useRouter();
  const [elapsed, setElapsed] = useState(0);
  const [activeTab, setActiveTab] = useState<EvidenceTab>("transcript");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [agentState, setAgentState] = useState<LiveAgentState>(null);
  const [mediaState, setMediaState] = useState<LiveMediaState>(initialMedia);
  const [idlePhase, setIdlePhase] = useState(0);
  const [demoStep, setDemoStep] = useState(0);
  const [liveTurns, setLiveTurns] = useState<LiveTranscriptTurn[]>([]);
  const [endOpen, setEndOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState("");
  const [storedSession, setStoredSession] = useState<StoredLiveSession | null>(null);
  const [persistedTools, setPersistedTools] = useState<SessionToolRun[]>([]);
  const persistedTurns = useRef(new Set<string>());
  const pendingTurnWrites = useRef(new Set<Promise<unknown>>());
  const stoppedSessionId = useRef("");
  const evidenceDrawerRef = useRef<HTMLElement>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement>(null);
  const evidenceCloseRef = useRef<HTMLButtonElement>(null);
  const transcriptTabRef = useRef<HTMLButtonElement>(null);
  const toolsTabRef = useRef<HTMLButtonElement>(null);
  const directorTabRef = useRef<HTMLButtonElement>(null);
  const endDialogRef = useRef<HTMLDivElement>(null);
  const keepPracticingRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!endOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => keepPracticingRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [endOpen]);

  useEffect(() => {
    if (!detailsOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => evidenceCloseRef.current?.focus({ preventScroll: true }), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus({ preventScroll: true });
    };
  }, [detailsOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeDrawerAtDesktop = () => {
      if (desktop.matches) setDetailsOpen(false);
    };
    desktop.addEventListener("change", closeDrawerAtDesktop);
    closeDrawerAtDesktop();
    return () => desktop.removeEventListener("change", closeDrawerAtDesktop);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!demoModeEnabled && !storedSession?.demo) return;
    const timer = window.setInterval(() => setIdlePhase((current) => current + 1), 5600);
    return () => window.clearInterval(timer);
  }, [storedSession]);

  useEffect(() => {
    if (!demoModeEnabled || (storedSession && !storedSession.demo)) return;
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
  const sessionIsDemo = Boolean(storedSession?.demo || (!storedSession && demoModeEnabled));
  const candidateTile = useMemo(
    () => ({ ...defaultPanelists[0], id: "candidate", name: "You", role: "Candidate", initials: "YOU" }),
    [],
  );

  const latestDirectorBid = useMemo(
    () => [...persistedTools].reverse().find((run) => run.tool_name === "panel.bid"),
    [persistedTools],
  );
  const directorMetadata = latestDirectorBid?.result as {
    selected_panelist?: { id?: string; display_name?: string; role?: string };
    director?: { action?: string; rationale?: string; suggested_question?: string };
    contradiction?: { subject?: string; earlier_claim?: string; current_claim?: string; earlier_turn_id?: string } | null;
  } | undefined;
  // The director records a contradiction on the turn that made it. Surfacing it is what
  // makes the catch visible while it is happening rather than only in the final report.
  const liveContradiction = readLiveContradiction(directorMetadata);
  const selectedPanelistId = directorMetadata?.selected_panelist?.id;
  const activeIndex = selectedPanelistId
    ? Math.max(0, configuredPanel.findIndex((person) => person.id === selectedPanelistId))
    : sessionIsDemo ? demoSpeakerIndex(demoStep, configuredPanel.length) : 0;
  const activePanelist = configuredPanel[activeIndex] || configuredPanel[0] || defaultPanelists[0];

  const handleLiveTranscript = useCallback((turns: LiveTranscriptTurn[]) => {
    setLiveTurns(turns);
    if (!storedSession || storedSession.demo) return;
    turns.forEach((turn, index) => {
      // Candidate text is already committed at the custom-LLM boundary before a
      // response is generated. RTM remains authoritative for interviewer output;
      // reposting the local side creates duplicate sequence writers under load.
      if (turn.isLocal || !turn.final || !turn.text || persistedTurns.current.has(turn.id)) return;
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

  function selectEvidenceTab(tab: EvidenceTab) {
    setActiveTab(tab);
    ({ transcript: transcriptTabRef, tools: toolsTabRef, director: directorTabRef })[tab].current?.focus();
  }

  function handleEvidenceTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = EVIDENCE_TABS.indexOf(activeTab);
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      selectEvidenceTab(EVIDENCE_TABS[(index + step + EVIDENCE_TABS.length) % EVIDENCE_TABS.length]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      selectEvidenceTab(event.key === "Home" ? EVIDENCE_TABS[0] : EVIDENCE_TABS[EVIDENCE_TABS.length - 1]);
    }
  }

  function openEndDialog() {
    setEndError("");
    setEndOpen(true);
  }

  async function finishInterview() {
    setEnding(true);
    setEndError("");
    try {
      if (storedSession && !storedSession.demo) {
        await Promise.allSettled([...pendingTurnWrites.current]);
        if (stoppedSessionId.current !== storedSession.sessionId) {
          await endInterviewSession(storedSession.sessionId);
          stoppedSessionId.current = storedSession.sessionId;
        }
        await generateSessionReport(storedSession.sessionId);
      }
      router.push(storedSession && !storedSession.demo ? `/reports/${storedSession.sessionId}` : "/reports/demo");
    } catch (error) {
      console.error("Session end failed", error);
      const message = error instanceof Error ? error.message : "The request failed";
      const panelStopped = Boolean(storedSession && stoppedSessionId.current === storedSession.sessionId);
      setEndError(panelStopped
        ? `The panel stopped, but the report could not be created: ${message}. Retry to create it.`
        : `The interview could not end: ${message}. Check the connection, then retry. The panel remains active.`);
    } finally {
      setEnding(false);
    }
  }

  const displayedTranscript = useMemo(() => {
    if (!liveTurns.length) return sessionIsDemo ? transcript : [];
    return mergeLiveTurns(liveTurns).map((turn, index) => {
      const participant = storedSession?.connection?.panelists?.find((item) => String(item.agent_uid) === String(turn.uid));
      const panelist = configuredPanel.find((person) => person.id === participant?.panelist_id);
      return {
        id: turn.id || `live-${index}`,
        speaker: turn.isLocal ? "You" : panelist?.name || "Live panel",
        kind: turn.isLocal ? "candidate" as const : "panel" as const,
        time: `Turn ${turn.turnNumber}`,
        text: turn.text,
        interrupted: turn.interrupted,
      };
    });
  }, [configuredPanel, liveTurns, sessionIsDemo, storedSession]);

  const latestInterviewerTurn = [...liveTurns].reverse().find((turn) => !turn.isLocal && turn.text);
  const latestFinalQuestion = [...liveTurns].reverse().find((turn) => !turn.isLocal && turn.final && turn.text)?.text;
  const activeQuestion = latestInterviewerTurn?.text
    || directorMetadata?.director?.suggested_question
    || (sessionIsDemo
      ? "You called pulse feedback a guardrail. Why is it not the outcome itself, and what decision would a decline trigger?"
      : "The panel will begin when Agora audio connects.");
  const directorSummary = directorMetadata?.director
    ? directorMetadata.director.rationale || "The director selected the strongest next perspective."
    : sessionIsDemo
      ? `${activePanelist.name} owns this turn. Any interviewer can return when the evidence calls for it.`
      : "The director will choose the next interviewer from the shared session context.";
  const snapshotTitle = (storedSession?.configSnapshot as { title?: string } | undefined)?.title || "Senior Product Manager practice";
  const displayedTools = sessionIsDemo
    ? toolActivity.map((activity) => ({ ...activity, highlight: null as string | null }))
    : interviewerToolRuns(persistedTools).map((run) => ({
        id: run.id,
        name: run.tool_name.replaceAll("_", " "),
        ...describeToolRun(run),
        status: run.status,
        time: new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(new Date(run.created_at)),
      }));
  const speakerTrail = useMemo(() => speakerSequence(persistedTools).slice(-6), [persistedTools]);
  const panelTurnCount = liveTurns.filter((turn) => !turn.isLocal && turn.final && turn.text).length
    || (sessionIsDemo ? displayedTranscript.filter((turn) => turn.kind === "panel").length : 0);
  const interruptionCount = displayedTranscript.filter((turn) => "interrupted" in turn && turn.interrupted).length;
  const rtcConnected = mediaState.connectionState === "CONNECTED";
  const roomStatus = sessionIsDemo ? "Guided demo" : rtcConnected ? "Agora connected" : "Audio not joined";
  const announcedQuestion = latestFinalQuestion
    || directorMetadata?.director?.suggested_question
    || (sessionIsDemo ? activeQuestion : "Waiting for the interviewer’s complete question.");
  const interviewerStatus = sessionIsDemo
    ? `${activePanelist.name} is speaking`
    : `${activePanelist.name} is ${agentState || (rtcConnected ? "listening" : "waiting for audio")}`;
  const backgroundInert = detailsOpen || endOpen;

  return (
    <div className="flex min-h-[100dvh] flex-col overflow-x-hidden bg-background pb-[env(safe-area-inset-bottom)] ps-[env(safe-area-inset-left)] pe-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] xl:h-[100dvh] xl:overflow-hidden">
      <a href="#live-stage" inert={backgroundInert ? true : undefined} aria-hidden={backgroundInert ? true : undefined} className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4">Skip to interview</a>

      <header inert={backgroundInert ? true : undefined} aria-hidden={backgroundInert ? true : undefined} className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-3 sm:px-4">
        <Brand />
        <span className="hidden min-w-0 border-s ps-3 sm:block">
          <span className="block truncate text-sm font-medium leading-5">{snapshotTitle}</span>
        </span>
        <div className="ms-auto flex items-center gap-2">
          {liveContradiction ? (
            <Badge variant="destructive" role="status" aria-live="polite">
              <TriangleAlert className="size-3" aria-hidden="true" />
              <span className="hidden sm:inline">Contradiction: </span>{liveContradiction.subject}
            </Badge>
          ) : null}
          <span className="font-mono text-sm tabular-nums text-muted-foreground">{formatDuration(elapsed)}</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col xl:flex-row xl:overflow-hidden">
        <main id="live-stage" inert={backgroundInert ? true : undefined} aria-hidden={backgroundInert ? true : undefined} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--stage)]">
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
            <SpotlightSpeaker
              person={activePanelist}
              state={selectedPresence(agentState, sessionIsDemo)}
              toneIndex={configuredPanel.findIndex((item) => item.id === activePanelist.id)}
              track={mediaState.remoteVideos.find((video) => video.uid === String(avatarUidForPanelist(activePanelist, storedSession?.connection?.panelists)))?.track}
              className="min-h-[15rem] flex-1"
            />

            <div className="flex shrink-0 items-center gap-2 overflow-x-auto pb-1" aria-label="Interview participants">
              <PanelTile person={candidateTile} state={mediaState.candidateSpeaking ? "speaking" : "listening"} toneIndex={configuredPanel.length} isSelf />
              {configuredPanel
                .filter((person) => person.id !== activePanelist.id)
                .map((person) => (
                  <PanelTile
                    key={person.id}
                    person={person}
                    state={sessionIsDemo ? presenceForPanelist(Math.max(0, configuredPanel.findIndex((item) => item.id === person.id)), idlePhase, false) : "listening"}
                    toneIndex={configuredPanel.findIndex((item) => item.id === person.id)}
                  />
                ))}
            </div>
          </div>

          <footer className="shrink-0 border-t bg-background px-3 py-3 sm:px-4" aria-labelledby="current-question-title">
            <div className="mx-auto flex max-w-[64rem] flex-col gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{activePanelist.name}</span> · {activePanelist.role}
                </p>
                <h2 id="current-question-title" className="mt-1 break-words text-sm leading-6 text-pretty sm:text-base">{activeQuestion}</h2>
                <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Current interviewer: {interviewerStatus}.</p>
                <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Question from {activePanelist.name}: {announcedQuestion}</p>
              </div>
              <div className="flex min-w-0 flex-wrap items-center justify-center gap-2">
                <div className="min-w-0"><AgoraLivePanel prepared={storedSession} onTranscript={handleLiveTranscript} onAgentState={setAgentState} onMediaState={setMediaState} /></div>
                <Button ref={evidenceTriggerRef} variant="outline" size="icon" className="size-11 shrink-0 rounded-full xl:hidden" onClick={() => setDetailsOpen(true)} aria-haspopup="dialog" aria-label="Open transcript">
                  <MessageSquareText aria-hidden="true" />
                </Button>
                <Button variant="destructive" size="icon" className="size-11 shrink-0 rounded-full" onClick={openEndDialog} aria-label="End interview">
                  <CircleStop aria-hidden="true" />
                </Button>
              </div>
            </div>
          </footer>
        </main>

      <aside
        ref={evidenceDrawerRef}
        className={cn("fixed inset-y-0 end-0 z-30 flex min-h-0 w-[min(22rem,94vw)] flex-col overscroll-contain border-s bg-background pb-[env(safe-area-inset-bottom)] pe-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] shadow-2xl xl:static xl:z-auto xl:m-1 xl:ms-0 xl:flex xl:w-[21rem] xl:shrink-0 xl:rounded-xl xl:border xl:p-0 xl:shadow-[var(--panel-shadow)]", detailsOpen ? "flex" : "hidden xl:flex")}
        aria-label="Session evidence"
        aria-labelledby={detailsOpen ? "evidence-title" : undefined}
        aria-modal={detailsOpen ? true : undefined}
        aria-hidden={endOpen ? true : undefined}
        inert={endOpen ? true : undefined}
        role={detailsOpen ? "dialog" : undefined}
        tabIndex={detailsOpen ? -1 : undefined}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDetailsOpen(false);
            return;
          }
          trapFocus(event, evidenceDrawerRef.current);
        }}
      >
        <h2 id="evidence-title" className="sr-only">Session Evidence</h2>
        <div className="flex min-h-16 items-center border-b px-3">
          <div className="grid flex-1 grid-cols-3 rounded-lg bg-secondary p-1" role="tablist" aria-label="Evidence views">
            <button ref={transcriptTabRef} id="evidence-tab-transcript" type="button" role="tab" aria-controls="evidence-panel-transcript" aria-selected={activeTab === "transcript"} tabIndex={activeTab === "transcript" ? 0 : -1} onClick={() => setActiveTab("transcript")} onKeyDown={handleEvidenceTabKeyDown} className={cn("min-h-9 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", activeTab === "transcript" && "bg-card text-foreground shadow-sm")}>Transcript</button>
            <button ref={toolsTabRef} id="evidence-tab-tools" type="button" role="tab" aria-controls="evidence-panel-tools" aria-selected={activeTab === "tools"} tabIndex={activeTab === "tools" ? 0 : -1} onClick={() => setActiveTab("tools")} onKeyDown={handleEvidenceTabKeyDown} className={cn("min-h-9 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", activeTab === "tools" && "bg-card text-foreground shadow-sm")}>Tool activity</button>
            <button ref={directorTabRef} id="evidence-tab-director" type="button" role="tab" aria-controls="evidence-panel-director" aria-selected={activeTab === "director"} tabIndex={activeTab === "director" ? 0 : -1} onClick={() => setActiveTab("director")} onKeyDown={handleEvidenceTabKeyDown} className={cn("min-h-9 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", activeTab === "director" && "bg-card text-foreground shadow-sm")}>Director</button>
          </div>
          <Button ref={evidenceCloseRef} variant="ghost" size="icon" className="ms-2 xl:hidden" onClick={() => setDetailsOpen(false)} aria-label="Close session evidence"><PanelRightClose aria-hidden="true" /></Button>
        </div>

        {activeTab === "director" ? (
          <div id="evidence-panel-director" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" role="tabpanel" aria-labelledby="evidence-tab-director" tabIndex={0}>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Why this interviewer</p>
            <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{directorSummary}</p>

            {liveContradiction ? (
              <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/8 p-3" role="status" aria-live="polite">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive"><TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />Contradiction caught</p>
                <p className="mt-1.5 break-words text-xs leading-5 text-muted-foreground">
                  <span className="font-medium capitalize text-foreground">{liveContradiction.subject}</span>{" "}
                  was <span className="font-mono">{liveContradiction.earlierClaim}</span>, now{" "}
                  <span className="font-mono">{liveContradiction.currentClaim}</span>.
                </p>
              </div>
            ) : null}

            {speakerTrail.length > 1 ? (
              <div className="mt-5 border-t pt-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Floor order</p>
                <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-5">
                  {speakerTrail.map((turn, index) => (
                    <li key={`${turn.panelistId}-${index}`} className="flex items-center gap-1.5">
                      {index > 0 ? <span aria-hidden="true" className="text-muted-foreground/50">&rarr;</span> : null}
                      <span className={cn("truncate", index === speakerTrail.length - 1 ? "font-medium text-foreground" : "text-muted-foreground")}>{turn.name.split(" ")[0]}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            <dl className="mt-5 space-y-2 border-t pt-4 text-xs">
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Panel turns</dt><dd className="font-medium tabular-nums">{panelTurnCount}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Interruptions</dt><dd className="font-medium tabular-nums">{interruptionCount}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Connection</dt><dd className="font-medium">{roomStatus}</dd></div>
            </dl>
          </div>
        ) : null}

        {activeTab === "transcript" ? (
          <div id="evidence-panel-transcript" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" role="tabpanel" aria-labelledby="evidence-tab-transcript" tabIndex={0}>
            <div className="space-y-5">
              {displayedTranscript.map((turn) => (
                <article key={turn.id} className={cn("break-words text-sm [contain-intrinsic-size:auto_7rem] [content-visibility:auto]", turn.kind === "candidate" && "ps-5")}>
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn("text-xs font-semibold", turn.kind === "candidate" ? "text-foreground" : "text-primary")}>{turn.speaker}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{turn.time}</span>
                  </div>
                  <p className="mt-1.5 break-words leading-6 text-muted-foreground">{turn.text}</p>
                  <span className="mt-1.5 block break-all font-mono text-[9px] text-muted-foreground/60">{turn.id}</span>
                </article>
              ))}
            </div>
            <div className="mt-6 flex items-center gap-2 rounded-lg border bg-card p-3 text-xs text-muted-foreground" role="status" aria-live="polite"><span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" aria-hidden="true" />{displayedTranscript.length ? "Listening for your answer" : "Waiting for the first transcript turn"}</div>
          </div>
        ) : null}

        {activeTab === "tools" ? (
          <div id="evidence-panel-tools" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4" role="tabpanel" aria-labelledby="evidence-tab-tools" tabIndex={0}>
            <Alert title="Tools run only when useful"><span>Search, calculation, and evidence actions are role-scoped and stored in the audit trail.</span></Alert>
            <div className="mt-4 space-y-3">
              {displayedTools.map((activity, index) => (
                <div key={activity.id} className="rounded-xl border bg-card p-3 [contain-intrinsic-size:auto_6rem] [content-visibility:auto]">
                  <div className="flex items-start gap-3">
                    <span className="grid size-8 place-items-center rounded-md bg-secondary">{index === 0 ? <FileSearch className="size-4 text-muted-foreground" aria-hidden="true" /> : index === 1 ? <Gauge className="size-4 text-muted-foreground" aria-hidden="true" /> : <BookOpen className="size-4 text-muted-foreground" aria-hidden="true" />}</span>
                    <div className="min-w-0 flex-1"><p className="capitalize text-xs font-semibold">{activity.name}</p>{activity.highlight ? <p className="mt-1 break-words text-[11px] font-semibold leading-5 text-primary">{activity.highlight}</p> : null}<p className="mt-1 line-clamp-3 break-words text-[11px] leading-5 text-muted-foreground">{activity.detail}</p></div>
                    <Check className="size-3.5 text-primary" aria-hidden="true" />
                  </div>
                  <div className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground"><span>{activity.status}</span><span>{activity.time}</span></div>
                </div>
              ))}
            </div>
            {!displayedTools.length ? <div className="py-12 text-center"><Gauge className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No tool activity yet</p><p className="mt-1 text-xs text-muted-foreground">Useful calls appear here as the panel works.</p></div> : null}
          </div>
        ) : null}
      </aside>
      </div>

      {endOpen ? (
        <div
          ref={endDialogRef}
          className="fixed inset-0 z-50 grid place-items-center overflow-y-auto overscroll-contain bg-black/70 pb-[max(1rem,env(safe-area-inset-bottom))] pe-[max(1rem,env(safe-area-inset-right))] ps-[max(1rem,env(safe-area-inset-left))] pt-[max(1rem,env(safe-area-inset-top))]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-title"
          aria-describedby="end-description"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape" && !ending) {
              event.preventDefault();
              setEndOpen(false);
              return;
            }
            trapFocus(event, endDialogRef.current);
          }}
        >
          <Card className="w-full max-w-md p-5">
            <div className="flex items-start gap-3">
              <span className="grid size-10 place-items-center rounded-md bg-secondary"><TimerReset className="size-5 text-muted-foreground" aria-hidden="true" /></span>
              <div className="min-w-0"><h2 id="end-title" className="font-semibold text-balance">End This Interview?</h2><p id="end-description" className="mt-2 break-words text-sm leading-6 text-muted-foreground">RoundCraft will stop the Agora panel, reconcile the transcript, and create the evidence-linked assessment.</p></div>
            </div>
            {endError ? <div className="mt-4"><Alert title="Interview Not Ended" variant="destructive"><span>{endError}</span></Alert></div> : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2"><Button ref={keepPracticingRef} variant="ghost" onClick={() => setEndOpen(false)} disabled={ending}>Keep Practicing</Button><Button loading={ending} onClick={finishInterview}>{endError ? "Retry End & Report" : "End & Create Report"}</Button></div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
