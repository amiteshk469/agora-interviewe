"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Clock3, Code2, FileCheck2, FileUp, Loader2, Mic2, MonitorUp, ShieldAlert, ShieldCheck, UsersRound } from "lucide-react";
import { AgoraLivePanel, type LiveAgentState, type LiveMediaState, type LiveTranscriptTurn } from "@/components/agora-live";
import { Brand } from "@/components/app-shell";
import { CodePane } from "@/components/code-pane";
import { ParticipantTile, participantGridClass } from "@/components/panel-video";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import type { Panelist } from "@/data/demo";
import {
  heartbeatCandidateSession,
  requestGuestBackchannel,
  joinSessionAsCandidate,
  leaveCandidateSession,
  persistCandidateGuestTurn,
  previewSessionInvite,
  recordCandidateFocusEvent,
  readCandidateGuestCode,
  readCandidateGuestView,
  renewCandidateSessionToken,
  saveCandidateGuestCode,
  uploadCandidateInviteResume,
  type CodingTask,
  type GuestInvitePreview,
  type GuestSession,
  type GuestView,
  type FocusGuardSummary,
  type HostPresence,
  type StoredLiveSession,
} from "@/lib/api";
import type { BrowserFocusEvent } from "@/lib/focus-guard";
import { humanVideoTrack, mergeLiveTurns, mergeRecordsById, panelistIdForAgoraUid, presenceForPanelist, shouldAutoOpenCodingTask } from "@/lib/live-panel";
import { useCandidateFocusGuard } from "@/lib/use-candidate-focus-guard";
import { cn } from "@/lib/utils";
import { checkMicrophonePermission } from "@/lib/microphone-permission";

const POLL_INTERVAL_MS = 2500;

const EMPTY_MEDIA: LiveMediaState = {
  microphoneEnabled: true,
  cameraEnabled: true,
  candidateSpeaking: false,
  hostSpeaking: false,
  localVideo: null,
  remoteVideos: [],
  connectionState: "CONNECTING",
};

function asPanelist(member: GuestSession["panel"][number], index: number): Panelist {
  return {
    id: member.id,
    name: member.display_name,
    role: member.role,
    initials: member.display_name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    avatarImage: member.avatar_image || ["/avatars/leah-kim.png", "/avatars/marcus-chen.png", "/avatars/priya-nair.png"][index % 3],
    avatarId: member.id,
    avatarVendor: "generic",
    mood: "Focused",
    behavior: "Adaptive",
    voice: "indian-calm",
    prompt: `Interview the candidate from the ${member.role} perspective.`,
    ...(!member.id ? { id: `panel-${index}` } : {}),
  };
}

function speakerName(turn: GuestView["turns"][number], session: GuestSession) {
  if (turn.speaker_type === "candidate") return session.display_name;
  if (turn.speaker_type === "system") return "RoundCraft";
  if (turn.speaker_id?.startsWith("human:")) return "Human interviewer";
  return session.panel.find((member) => member.id === turn.speaker_id)?.display_name ?? "AI panel";
}

export function CandidateConsole({ token, initialPreview }: { token: string; initialPreview: GuestInvitePreview }) {
  const [preview, setPreview] = useState(initialPreview);
  const [name, setName] = useState("");
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [joining, setJoining] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const [session, setSession] = useState<GuestSession | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(initialPreview.status);
  const [liveTurns, setLiveTurns] = useState<LiveTranscriptTurn[]>([]);
  const [storedTurns, setStoredTurns] = useState<GuestView["turns"]>([]);
  const [messages, setMessages] = useState<GuestView["messages"]>([]);
  const [codingTask, setCodingTask] = useState<CodingTask | null>(null);
  const [host, setHost] = useState<HostPresence | null>(null);
  const [focusGuardSummary, setFocusGuardSummary] = useState<FocusGuardSummary>({ violation_count: 0, flagged: false, events: [] });
  const [codeOpen, setCodeOpen] = useState(false);
  const [agentState, setAgentState] = useState<LiveAgentState>(null);
  const [media, setMedia] = useState<LiveMediaState>(EMPTY_MEDIA);
  const [updatesDelayed, setUpdatesDelayed] = useState(false);
  const persistedTurns = useRef(new Set<string>());
  const pendingWrites = useRef(new Set<Promise<unknown>>());
  const lastSequence = useRef(0);
  const statusRef = useRef(initialPreview.status);
  const cameraWasEnabled = useRef(false);
  const dismissedCodingTaskId = useRef<string | null>(null);

  const sendFocusEvent = useCallback(async (event: BrowserFocusEvent, detail: string) => {
    try {
      const summary = await recordCandidateFocusEvent(token, event, detail);
      setFocusGuardSummary(summary);
    } catch {
      setUpdatesDelayed(true);
    }
  }, [token]);

  const {
    fullscreenActive,
    fullscreenSupported,
    attentionRequired,
    lastEventLabel,
    enterFocusMode,
    acknowledge: acknowledgeFocusGuard,
    report: reportFocusEvent,
  } = useCandidateFocusGuard({
    enabled: Boolean(session) && status === "live" && media.connectionState === "CONNECTED",
    onEvent: sendFocusEvent,
  });

  useEffect(() => {
    if (session || preview.status === "ended" || preview.status === "failed") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await previewSessionInvite(token);
        if (cancelled) return;
        setPreview(next);
        setStatus(next.status);
        statusRef.current = next.status;
      } catch {
        if (!cancelled) setUpdatesDelayed(true);
      }
    };
    const timer = window.setInterval(() => void poll(), 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [preview.status, session, token]);

  const testMicrophone = useCallback(async () => {
    setTestingMicrophone(true);
    setError("");
    try {
      await checkMicrophonePermission();
      setMicrophoneReady(true);
    } catch (cause) {
      setMicrophoneReady(false);
      setError(cause instanceof Error ? cause.message : "Microphone access failed. Allow microphone access in browser settings and try again.");
    } finally {
      setTestingMicrophone(false);
    }
  }, []);

  const join = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (statusRef.current !== "live") return;
    setJoining(true);
    setError("");
    try {
      await checkMicrophonePermission();
      setMicrophoneReady(true);
      const joined = await joinSessionAsCandidate(token, name.trim() || "Candidate");
      setSession(joined);
      setStatus(joined.status);
      statusRef.current = joined.status;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The candidate seat could not join.");
    } finally {
      setJoining(false);
    }
  }, [name, token]);

  const uploadResume = useCallback(async (file?: File) => {
    if (!file) return;
    setResumeError("");
    if (!/\.(pdf|docx|txt|md)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setResumeError("Choose a PDF, DOCX, TXT, or MD file smaller than 10 MB.");
      return;
    }
    setUploadingResume(true);
    try {
      const candidateResume = await uploadCandidateInviteResume(token, file);
      setPreview((current) => ({ ...current, candidate_resume: candidateResume }));
    } catch (cause) {
      setResumeError(cause instanceof Error ? cause.message : "Your CV could not be attached.");
    } finally {
      setUploadingResume(false);
    }
  }, [token]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      let keepPolling = true;
      try {
        const view = await readCandidateGuestView(token, lastSequence.current);
        if (cancelled) return;
        setUpdatesDelayed(false);
        setStatus(view.status);
        statusRef.current = view.status;
        setMessages((current) => mergeRecordsById(current, view.messages));
        setHost(view.host ?? null);
        if (view.focus_guard) setFocusGuardSummary(view.focus_guard);
        setCodingTask(view.coding_task ?? null);
        if (shouldAutoOpenCodingTask(view.coding_task, dismissedCodingTaskId.current)) setCodeOpen(true);
        if (view.turns.length) {
          lastSequence.current = Math.max(lastSequence.current, ...view.turns.map((turn) => turn.sequence));
          setStoredTurns((current) => mergeRecordsById(current, view.turns).sort((left, right) => left.sequence - right.sequence));
        }
        keepPolling = view.status === "live";
      } catch {
        if (!cancelled) setUpdatesDelayed(true);
      } finally {
        if (!cancelled && keepPolling) timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer); };
  }, [session, token]);

  useEffect(() => {
    if (!session || media.connectionState !== "CONNECTED") return;
    if (media.cameraEnabled) {
      cameraWasEnabled.current = true;
      return;
    }
    if (cameraWasEnabled.current) {
      cameraWasEnabled.current = false;
      reportFocusEvent("camera_disabled", "The candidate disabled their camera after joining the live room.");
      return;
    }
  }, [media.cameraEnabled, media.connectionState, reportFocusEvent, session]);

  useEffect(() => {
    if (!session) return;
    const heartbeat = () => {
      if (statusRef.current !== "live") return;
      void heartbeatCandidateSession(token).catch(() => setUpdatesDelayed(true));
    };
    const timer = window.setInterval(heartbeat, Math.max(5, session.heartbeat_interval_seconds) * 1000);
    const leave = () => { void leaveCandidateSession(token).catch(() => undefined); };
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [session, token]);

  const handleTranscript = useCallback((turns: LiveTranscriptTurn[]) => {
    setLiveTurns(turns);
    for (const turn of turns) {
      if (!turn.isLocal || !turn.final || !turn.text.trim() || persistedTurns.current.has(turn.id)) continue;
      persistedTurns.current.add(turn.id);
      const write = persistCandidateGuestTurn(token, {
        agora_turn_id: turn.id,
        content: turn.text,
        interrupted: turn.interrupted,
      });
      pendingWrites.current.add(write);
      void write.catch((cause) => {
        persistedTurns.current.delete(turn.id);
        console.warn("Candidate transcript persistence failed", cause);
      }).finally(() => pendingWrites.current.delete(write));
    }
  }, [token]);

  const renewConnection = useCallback(() => renewCandidateSessionToken(token), [token]);
  const acknowledge = useCallback(() => requestGuestBackchannel(token), [token]);
  const loadCode = useCallback(() => readCandidateGuestCode(token), [token]);
  const saveCode = useCallback((language: string, content: string) => saveCandidateGuestCode(token, language, content), [token]);
  const closeCode = useCallback(() => {
    dismissedCodingTaskId.current = codingTask?.id ?? null;
    setCodeOpen(false);
  }, [codingTask?.id]);
  const openCode = useCallback(() => {
    dismissedCodingTaskId.current = null;
    setCodeOpen(true);
  }, []);

  if (!session) {
    const waiting = preview.status === "configured" || preview.status === "starting";
    return (
      <main className="min-h-[100dvh] bg-background">
        <header className="flex h-14 items-center border-b px-4 sm:px-6"><Brand href="/" /><div className="ms-auto flex items-center gap-2"><Badge variant="outline">Candidate invite</Badge><ThemeToggle /></div></header>
        <div className="mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-5xl items-center gap-8 p-5 lg:grid-cols-[1fr_23rem] lg:p-8">
          <section className="surface-grid overflow-hidden rounded-2xl border bg-card p-6 sm:p-10">
            <Badge variant="secondary">{preview.role_pack}</Badge>
            <h1 className="mt-5 max-w-xl text-3xl font-semibold tracking-tight">{preview.title}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">You are invited to interview with a human host and {preview.panel.length} configurable AI panelists. Your host can ask questions directly and open a shared coding task.</p>
            <div className="mt-7 grid gap-2 sm:grid-cols-2">
              {preview.panel.map((member) => <div key={member.id} className="flex items-center gap-3 rounded-xl border bg-card/90 p-3"><span className="grid size-9 place-items-center rounded-full bg-secondary text-xs font-semibold">{member.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{member.display_name}</span><span className="block truncate text-xs text-muted-foreground">{member.role}</span></span></div>)}
            </div>
            {waiting ? <div className="mt-6"><Alert title="Waiting for the interviewer"><span className="flex items-center gap-2"><Clock3 className="size-4" aria-hidden="true" />Keep this page open. Join becomes available as soon as the host starts the room.</span></Alert></div> : null}
          </section>

          <Card>
            <CardHeader><CardTitle>Ready to join?</CardTitle><CardDescription>Choose the name the interviewer will see, allow your microphone, then join. You can enable your camera and focus mode in the room.</CardDescription></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={join}>
                <label className="block text-sm font-medium" htmlFor="candidate-name">Your name</label>
                <Input id="candidate-name" name="candidate_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Candidate name…" autoComplete="name" />
                <div className="rounded-lg border bg-background p-3"><div className="flex items-center gap-3">{preview.candidate_resume ? <FileCheck2 className="size-5 shrink-0 text-primary" aria-hidden="true" /> : <FileUp className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />}<div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{preview.candidate_resume?.original_filename || "Add your CV"}</p><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{preview.candidate_resume ? "Visible to this interview's human host and AI panel" : "Optional, private to this interview"}</p></div><label className="shrink-0"><input name="candidate_resume" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="sr-only" disabled={uploadingResume} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void uploadResume(file); }} /><span className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent">{uploadingResume ? "Reading…" : preview.candidate_resume ? "Replace" : "Upload"}</span></label></div>{resumeError ? <p className="mt-2 text-xs text-destructive" role="alert">{resumeError}</p> : null}</div>
                <Button type="button" className="w-full" variant={microphoneReady ? "secondary" : "outline"} onClick={() => void testMicrophone()} disabled={testingMicrophone}>{testingMicrophone ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : microphoneReady ? <Check aria-hidden="true" /> : <Mic2 aria-hidden="true" />}{testingMicrophone ? "Testing microphone" : microphoneReady ? "Microphone ready" : "Test microphone"}</Button>
                <Button type="submit" size="lg" className="w-full" disabled={preview.status !== "live" || joining} loading={joining}><UsersRound aria-hidden="true" />{waiting ? "Waiting for host" : joining ? "Joining interview" : "Join interview"}</Button>
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Focus guard records tab changes, window focus loss, fullscreen exits and camera shutdowns. It never reads other windows.</p>
              </form>
              {updatesDelayed ? <div className="mt-4"><Alert title="Checking room status"><span>The room update is delayed. RoundCraft will keep retrying.</span></Alert></div> : null}
              {error ? <div className="mt-4"><Alert variant="destructive" title="Could not continue">{error}</Alert></div> : null}
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const panelists = session.panel.map(asPanelist);
  const merged = mergeLiveTurns(liveTurns);
  const lastRemote = [...merged].reverse().find((turn) => !turn.isLocal);
  const activePanelistId = panelistIdForAgoraUid(lastRemote?.uid, session.connection.panelists) ?? panelists[0]?.id;
  const candidatePerson: Panelist = { id: "candidate", name: session.display_name, role: "Candidate", initials: session.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2), avatarImage: "/avatars/candidate.png", avatarId: "candidate", avatarVendor: "generic", mood: "Focused", behavior: "Answering", voice: "", prompt: "" };
  const hostName = host?.display_name || "Interviewer";
  const hostPerson: Panelist = { id: "human-host", name: hostName, role: host ? "Human interviewer" : "Human interviewer · Waiting to join", initials: hostName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2), avatarImage: "/avatars/candidate.png", avatarId: "human-host", avatarVendor: "generic", mood: "Focused", behavior: "Leading", voice: "", prompt: "" };
  const hostVideo = humanVideoTrack(media.remoteVideos, host?.rtc_uid, session.connection.panelists);
  const participantCount = panelists.length + 2;
  const prepared: StoredLiveSession = { sessionId: session.session_id, agentId: "", connection: session.connection, configSnapshot: { panel: session.panel, conversation_mode: session.conversation_mode }, demo: false };
  const currentQuestion = codingTask?.question || [...storedTurns].reverse().find((turn) => turn.speaker_type === "interviewer")?.content || lastRemote?.text;

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4"><Brand href="/" /><span className="hidden h-5 w-px bg-border sm:block" /><div className="min-w-0"><p className="truncate text-sm font-medium">{session.title}</p><p className="truncate text-[10px] text-muted-foreground">{session.role_pack}</p></div><div className="ms-auto flex items-center gap-2">{updatesDelayed ? <Badge variant="destructive">Updates delayed</Badge> : null}<Badge variant={focusGuardSummary.flagged ? "destructive" : "outline"}><ShieldCheck className="size-3" aria-hidden="true" />Focus {focusGuardSummary.violation_count}</Badge><Button size="sm" variant={fullscreenActive ? "secondary" : "outline"} onClick={() => void enterFocusMode()} aria-pressed={fullscreenActive}><MonitorUp aria-hidden="true" />{fullscreenActive ? "Focused" : "Focus mode"}</Button><Badge variant={status === "live" ? "outline" : "secondary"}>{status === "live" ? "Live" : status}</Badge><ThemeToggle /></div></header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden lg:p-4">
        <section className="flex min-h-0 flex-col gap-3">
          <div className={cn("grid min-h-0 auto-rows-fr gap-2", codeOpen ? "shrink-0" : "flex-1", participantGridClass(participantCount, codeOpen))}>
            {panelists.map((person, index) => {
              const participant = session.connection.panelists?.find((item) => item.panelist_id === person.id);
              const videoUid = participant?.avatar_uid || participant?.agent_uid;
              const track = videoUid ? media.remoteVideos.find((video) => video.uid === String(videoUid))?.track : undefined;
              return <ParticipantTile key={person.id} person={person} state={presenceForPanelist(index, storedTurns.length, agentState === "speaking" && person.id === activePanelistId)} track={track} toneIndex={index} compact={codeOpen} className={codeOpen ? "h-[6.5rem]" : "min-h-32"} />;
            })}
            <ParticipantTile person={hostPerson} state={media.hostSpeaking ? "speaking" : "listening"} track={hostVideo} toneIndex={panelists.length} compact={codeOpen} className={cn(codeOpen ? "h-[6.5rem]" : "min-h-32", !host && !hostVideo && "opacity-65")} />
            <ParticipantTile person={candidatePerson} state={media.candidateSpeaking ? "speaking" : "listening"} track={media.localVideo} isSelf microphoneEnabled={media.microphoneEnabled} compact={codeOpen} className={codeOpen ? "h-[6.5rem]" : "min-h-32"} />
          </div>

          {currentQuestion ? <div className="rounded-xl border bg-card px-4 py-3"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Current question</p><p className="mt-1 line-clamp-2 text-sm leading-6">{currentQuestion}</p></div> : null}

          {codeOpen && session.coding ? (
            <CodePane
              loadCode={loadCode}
              saveCode={saveCode}
              languages={session.coding.languages}
              defaultLanguage={codingTask?.language || session.coding.default_language}
              prompt={session.coding.prompt}
              question={codingTask?.question}
              hints={codingTask?.hints}
              onClose={closeCode}
              className="min-h-[24rem] flex-1"
            />
          ) : (
            <div className="flex shrink-0 items-center justify-center gap-3"><span className="text-xs text-muted-foreground">Your seat: Candidate</span>{session.supports_coding ? <Button size="sm" variant="secondary" onClick={openCode}><Code2 aria-hidden="true" />Open coding workspace</Button> : null}</div>
          )}

          <div className="shrink-0 rounded-xl border bg-card p-2"><AgoraLivePanel prepared={prepared} renewConnection={renewConnection} onLongAnswer={acknowledge} onTranscript={handleTranscript} onAgentState={setAgentState} onMediaState={setMedia} /></div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3">
          {messages.length ? <Alert title={`Note from ${messages.at(-1)?.author || "interviewer"}`}><span>{messages.at(-1)?.text}</span></Alert> : null}
          <Card className="flex min-h-[18rem] flex-1 flex-col overflow-hidden p-0"><div className="flex items-center justify-between border-b px-3 py-2"><h2 className="text-xs font-medium text-muted-foreground">Live transcript</h2><Badge variant="secondary">{storedTurns.length} turns</Badge></div><div className="min-h-0 flex-1 overflow-y-auto p-3">{storedTurns.length ? <ol className="space-y-3">{storedTurns.map((turn) => <li key={turn.id}><p className={cn("text-xs font-medium", turn.speaker_type === "candidate" ? "text-primary" : "text-muted-foreground")}>{speakerName(turn, session)}</p><p className="mt-0.5 text-sm leading-6">{turn.content}</p></li>)}</ol> : <p className="text-xs text-muted-foreground">The final transcript will appear as the conversation begins.</p>}</div></Card>
          {status !== "live" ? <Alert title="Interview ended"><span>The interviewer has closed this room. Your final answers are saved for the assessment.</span></Alert> : null}
        </aside>
      </div>

      {attentionRequired ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/85 p-5 backdrop-blur-sm" role="presentation">
          <Card className="w-full max-w-md" role="dialog" aria-modal="true" aria-labelledby="focus-guard-title">
            <CardHeader><span className="mb-2 grid size-10 place-items-center rounded-full bg-destructive/10 text-destructive"><ShieldAlert className="size-5" aria-hidden="true" /></span><CardTitle id="focus-guard-title">Return to the interview</CardTitle><CardDescription>{lastEventLabel || "The interview window lost focus"}. This event has been recorded for the interviewer.</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-2"><Button onClick={() => void enterFocusMode()} disabled={!fullscreenSupported}><MonitorUp aria-hidden="true" />{fullscreenSupported ? "Return to fullscreen" : "Fullscreen unavailable"}</Button><Button variant="secondary" onClick={acknowledgeFocusGuard}>Continue in this browser</Button></CardContent>
          </Card>
        </div>
      ) : null}
    </main>
  );
}
