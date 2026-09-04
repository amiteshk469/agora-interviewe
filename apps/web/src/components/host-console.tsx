"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Camera, CameraOff, Check, Code2, Copy, FileText, Headphones, Loader2, MessageSquareText, Mic, MicOff, PanelRightClose, PanelRightOpen, PhoneOff, Send, ShieldAlert, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import { Brand } from "@/components/app-shell";
import { CodeView } from "@/components/code-pane";
import { PanelIdentity, ParticipantTile, participantGridClass } from "@/components/panel-video";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import type { Panelist } from "@/data/demo";
import {
  joinSessionAsHost,
  heartbeatHostSession,
  endInterviewSession,
  generateSessionReport,
  leaveHostSession,
  readGuestView,
  renewHostSessionToken,
  sendHostCodingTask,
  sendHostMessage,
  type CandidatePresence,
  type CandidateResumeResponse,
  type CodeBuffer,
  type CodingTask,
  type GuestSession,
  type GuestView,
  type GuestInvitePreview,
  type FocusGuardSummary,
  type HostMessage,
  type SessionInvite,
} from "@/lib/api";
import { humanVideoTrack, mergeRecordsById, panelistIdForAgoraUid, presenceForPanelist } from "@/lib/live-panel";
import { joinHostRtcRoom, type HostRtcHandle, type HostRtcMediaState } from "@/lib/host-rtc";
import { cn } from "@/lib/utils";

// Fast enough that a co-host can follow the exchange, slow enough not to hammer
// an API that is already carrying a live interview.
const POLL_INTERVAL_MS = 2500;
const EMPTY_HOST_MEDIA: HostRtcMediaState = { cameraEnabled: false, localVideo: null, remoteVideos: [] };
const EMPTY_FOCUS_GUARD: FocusGuardSummary = { violation_count: 0, flagged: false, events: [] };

type Turn = GuestView["turns"][number];

function speakerLabel(turn: Turn, session: GuestSession | null) {
  if (turn.speaker_type === "candidate") return "Candidate";
  if (turn.speaker_type === "system") return "System";
  const direct = session?.panel.find((member) => member.id === turn.speaker_id);
  if (direct) return direct.display_name;
  const panelistId = panelistIdForAgoraUid(turn.speaker_id, session?.connection.panelists);
  const match = session?.panel.find((member) => member.id === panelistId);
  return match?.display_name ?? "Panel";
}

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
    voice: "",
    prompt: "",
  };
}

export function HostConsole({ token, preview, autoJoinName, ownerSessionId, candidateInvite }: { token: string; preview?: GuestInvitePreview; autoJoinName?: string; ownerSessionId?: string; candidateInvite?: SessionInvite }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [session, setSession] = useState<GuestSession | null>(null);
  const [joining, setJoining] = useState(false);
  const [prejoinMicrophoneReady, setPrejoinMicrophoneReady] = useState(false);
  const [testingPrejoinMicrophone, setTestingPrejoinMicrophone] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [code, setCode] = useState<CodeBuffer | null>(null);
  const [messages, setMessages] = useState<HostMessage[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [candidate, setCandidate] = useState<CandidatePresence | null>(null);
  const [candidateResume, setCandidateResume] = useState<CandidateResumeResponse | null>(preview?.candidate_resume ?? null);
  const [codingTask, setCodingTask] = useState<CodingTask | null>(null);
  const [codingQuestion, setCodingQuestion] = useState("");
  const [codingHints, setCodingHints] = useState("");
  const [codingLanguage, setCodingLanguage] = useState("python");
  const [sendingTask, setSendingTask] = useState(false);
  const [copiedInvite, setCopiedInvite] = useState(false);
  const [ending, setEnding] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [rtcReady, setRtcReady] = useState(false);
  const [microphoneEnabled, setMicrophoneEnabled] = useState(false);
  const [microphoneBusy, setMicrophoneBusy] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [media, setMedia] = useState<HostRtcMediaState>(EMPTY_HOST_MEDIA);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"lead" | "transcript" | "cv" | "code">("lead");
  const [focusGuard, setFocusGuard] = useState<FocusGuardSummary>(EMPTY_FOCUS_GUARD);
  const [updatesDelayed, setUpdatesDelayed] = useState(false);
  const [status, setStatus] = useState("");
  const rtc = useRef<HostRtcHandle | null>(null);
  const mounted = useRef(true);
  const statusRef = useRef("");
  const lastSequence = useRef(0);
  const transcriptEnd = useRef<HTMLLIElement>(null);
  const autoJoinStarted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const room = rtc.current;
      rtc.current = null;
      void room?.leave().catch(() => undefined);
    };
  }, []);

  const joinRoom = useCallback(async (displayName: string) => {
    setJoining(true);
    setRtcReady(false);
    setError("");
    try {
      const joined = await joinSessionAsHost(token, displayName.trim() || "Guest interviewer");
      if (!mounted.current) return;
      setSession(joined);
      setCandidateResume(joined.candidate_resume ?? null);
      setCodingLanguage(joined.coding?.default_language || "python");
      statusRef.current = joined.status;
      setStatus(joined.status);
      try {
        const room = await joinHostRtcRoom(joined, {
          renewConnection: () => renewHostSessionToken(token),
          onConnectionError: (renewalError) => {
            if (mounted.current) setError(`Live audio needs to reconnect: ${renewalError.message}`);
          },
          onMediaState: (nextMedia) => {
            if (mounted.current) setMedia(nextMedia);
          },
        });
        if (!mounted.current || statusRef.current !== "live") {
          await room.leave();
          return;
        }
        rtc.current = room;
        setRtcReady(true);
      } catch (audioError) {
        // Following by transcript is still a usable seat, so this is not fatal.
        console.warn("Audio could not be joined", audioError);
        setError("Joined, but audio could not connect. You can still read and lead from here.");
      }
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "This invite could not be opened.");
    } finally {
      setJoining(false);
    }
  }, [token]);

  const join = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    await joinRoom(name);
  }, [joinRoom, name]);

  const testPrejoinMicrophone = useCallback(async () => {
    setTestingPrejoinMicrophone(true);
    setError("");
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      if (!stream.getAudioTracks().length || !stream.getVideoTracks().length) {
        throw new Error("A camera and microphone are required for the live room");
      }
      setPrejoinMicrophoneReady(true);
    } catch (cause) {
      setPrejoinMicrophoneReady(false);
      setError(cause instanceof Error ? cause.message : "Camera and microphone permissions could not be verified.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setTestingPrejoinMicrophone(false);
    }
  }, []);

  useEffect(() => {
    if (!autoJoinName || autoJoinStarted.current) return;
    autoJoinStarted.current = true;
    setName(autoJoinName);
    void joinRoom(autoJoinName);
  }, [autoJoinName, joinRoom]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      let keepPolling = true;
      try {
        const view = await readGuestView(token, lastSequence.current);
        if (cancelled) return;
        setUpdatesDelayed(false);
        statusRef.current = view.status;
        if (view.status !== "live") {
          const room = rtc.current;
          rtc.current = null;
          setRtcReady(false);
          setMicrophoneEnabled(false);
          setMicrophoneBusy(false);
          setCameraEnabled(false);
          setCameraBusy(false);
          setMedia(EMPTY_HOST_MEDIA);
          void room?.leave().catch((leaveError) => console.warn("Host audio cleanup failed", leaveError));
        }
        setStatus(view.status);
        setCode(view.code);
        setCandidate(view.candidate ?? null);
        setCandidateResume(view.candidate_resume ?? null);
        setCodingTask(view.coding_task ?? null);
        setFocusGuard(view.focus_guard ?? EMPTY_FOCUS_GUARD);
        setMessages((current) => mergeRecordsById(current, view.messages));
        setPendingQuestion(view.pending_question);
        if (view.turns.length) {
          lastSequence.current = Math.max(lastSequence.current, ...view.turns.map((turn) => turn.sequence));
          setTurns((current) => mergeRecordsById(current, view.turns).sort((left, right) => left.sequence - right.sequence));
        }
        keepPolling = view.status === "live";
      } catch {
        if (!cancelled) setUpdatesDelayed(true);
      } finally {
        if (!cancelled && keepPolling) timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [session, token]);

  useEffect(() => {
    if (!session) return;
    const heartbeat = () => {
      if (statusRef.current !== "live") return;
      void heartbeatHostSession(token).catch(() => setUpdatesDelayed(true));
    };
    const timer = window.setInterval(
      heartbeat,
      Math.max(5, session.heartbeat_interval_seconds) * 1000,
    );
    const leave = () => { void leaveHostSession(token).catch(() => undefined); };
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [session, token]);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ block: "end" });
  }, [turns.length]);

  const send = useCallback(async (mode: "chat" | "ask") => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      const posted = await sendHostMessage(token, mode, text);
      setMessages((current) => mergeRecordsById(current, [posted]));
      if (mode === "ask") setPendingQuestion(text);
      setDraft("");
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "That message could not be sent.");
    } finally {
      setSending(false);
    }
  }, [draft, sending, token]);

  const openCodingTask = useCallback(async () => {
    const question = codingQuestion.trim();
    if (!question || sendingTask) return;
    setSendingTask(true);
    setError("");
    try {
      const task = await sendHostCodingTask(
        token,
        question,
        codingLanguage,
        codingHints.split("\n").map((hint) => hint.trim()).filter(Boolean),
      );
      setCodingTask(task);
      setCodingQuestion("");
      setCodingHints("");
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : "The coding task could not be opened.");
    } finally {
      setSendingTask(false);
    }
  }, [codingHints, codingLanguage, codingQuestion, sendingTask, token]);

  const copyCandidateInvite = useCallback(async () => {
    if (!candidateInvite) return;
    try {
      await navigator.clipboard.writeText(new URL(candidateInvite.join_path, window.location.origin).toString());
      setCopiedInvite(true);
      window.setTimeout(() => setCopiedInvite(false), 1600);
    } catch {
      setError("Copy was blocked. Return to the lobby to copy the candidate link manually.");
    }
  }, [candidateInvite]);

  const finishInterview = useCallback(async () => {
    if (!ownerSessionId || ending) return;
    if (!window.confirm("End this interview for everyone and create the assessment report?")) return;
    setEnding(true);
    setError("");
    try {
      await endInterviewSession(ownerSessionId);
      await generateSessionReport(ownerSessionId);
      router.push(`/reports/${ownerSessionId}`);
    } catch (endError) {
      setError(endError instanceof Error ? endError.message : "The interview could not be ended.");
      setEnding(false);
    }
  }, [ending, ownerSessionId, router]);

  const toggleAudio = useCallback(() => {
    setAudioMuted((muted) => {
      rtc.current?.setMuted(!muted);
      return !muted;
    });
  }, []);

  const toggleMicrophone = useCallback(async () => {
    const room = rtc.current;
    if (!room || microphoneBusy) return;
    const next = !microphoneEnabled;
    setMicrophoneBusy(true);
    setError("");
    try {
      await room.setMicrophoneEnabled(next);
      if (rtc.current === room) setMicrophoneEnabled(next);
    } catch (microphoneError) {
      setError(microphoneError instanceof Error
        ? `Your microphone could not join the room: ${microphoneError.message}`
        : "Your microphone could not join the room. Check browser permission and try again.");
    } finally {
      setMicrophoneBusy(false);
    }
  }, [microphoneBusy, microphoneEnabled]);

  const toggleCamera = useCallback(async () => {
    const room = rtc.current;
    if (!room || cameraBusy) return;
    const next = !cameraEnabled;
    setCameraBusy(true);
    setError("");
    try {
      await room.setCameraEnabled(next);
      if (rtc.current === room) setCameraEnabled(next);
    } catch (cameraError) {
      setError(cameraError instanceof Error
        ? `Your camera could not join the room: ${cameraError.message}`
        : "Your camera could not join the room. Check browser permission and try again.");
    } finally {
      setCameraBusy(false);
    }
  }, [cameraBusy, cameraEnabled]);

  if (!session) {
    if (autoJoinName) {
      return <main className="grid min-h-[100dvh] place-items-center bg-background p-6"><div className="text-center"><Loader2 className="mx-auto size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" /><h1 className="mt-4 text-lg font-semibold">Opening interviewer control room</h1><p className="mt-1 text-sm text-muted-foreground">Connecting your private seat to Agora.</p>{error ? <div className="mt-4 max-w-md"><Alert variant="destructive" title="Could not join">{error}</Alert><Button className="mt-3" onClick={() => { autoJoinStarted.current = false; void joinRoom(autoJoinName); }}>Try again</Button></div> : null}</div></main>;
    }
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-background p-5 sm:p-8">
        <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1fr_23rem]">
          <section className="surface-grid rounded-2xl border bg-card p-6 sm:p-9">
            <Badge variant="secondary">{preview?.role_pack || "Live interview"}</Badge>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight">{preview?.title || "Join as interviewer"}</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Hear the room, speak directly to the candidate, follow the evidence transcript, lead the AI panel, and open coding questions.</p>
            {preview?.panel?.length ? <div className="mt-7 grid gap-2 sm:grid-cols-2">{preview.panel.map((member, index) => <div key={member.id} className="flex min-w-0 items-center gap-3 rounded-xl border bg-card/90 p-3"><PanelIdentity seed={member.id} toneIndex={index} initials={member.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)} className="size-9 text-[10px]" /><span className="min-w-0"><span className="block truncate text-sm font-medium">{member.display_name}</span><span className="block truncate text-xs text-muted-foreground">{member.role}</span></span></div>)}</div> : null}
          </section>
          <Card>
            <CardHeader><CardTitle>Ready to join?</CardTitle><CardDescription>Your camera and microphone stay off until you explicitly enable them inside the room.</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={join} className="flex flex-col gap-3">
                <label className="text-sm font-medium" htmlFor="host-name">Your name</label>
                <input id="host-name" name="host_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Interviewer name…" autoComplete="name" className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <Button type="button" variant={prejoinMicrophoneReady ? "secondary" : "outline"} onClick={() => void testPrejoinMicrophone()} disabled={testingPrejoinMicrophone}>{testingPrejoinMicrophone ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : prejoinMicrophoneReady ? <Check className="size-4" aria-hidden="true" /> : <Camera className="size-4" aria-hidden="true" />}{testingPrejoinMicrophone ? "Testing devices" : prejoinMicrophoneReady ? "Camera and microphone ready" : "Test camera and microphone"}</Button>
                <Button type="submit" size="lg" disabled={joining}>{joining ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Headphones className="size-4" aria-hidden="true" />}{joining ? "Joining interview" : "Join interview"}</Button>
              </form>
              {error ? <div className="mt-4"><Alert variant="destructive" title="Could not join">{error}</Alert></div> : null}
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  const panelists = session.panel.map(asPanelist);
  const hostPerson: Panelist = {
    id: "human-host",
    name: session.display_name,
    role: "Human interviewer",
    initials: session.display_name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    avatarImage: "/avatars/candidate.png",
    avatarId: "human-host",
    avatarVendor: "generic",
    mood: "Focused",
    behavior: "Leading",
    voice: "",
    prompt: "",
  };
  const candidateRtcUid = candidate?.rtc_uid ?? session.candidate_rtc_uid;
  const candidateVideo = humanVideoTrack(media.remoteVideos, candidateRtcUid, session.connection.panelists);
  const candidateConnected = Boolean(candidate || candidateVideo);
  const candidatePerson: Panelist = {
    id: "candidate",
    name: candidate?.display_name || "Candidate",
    role: candidateConnected ? "Candidate" : "Candidate · Waiting to join",
    initials: (candidate?.display_name || "Candidate").split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase(),
    avatarImage: "/avatars/candidate.png",
    avatarId: "candidate",
    avatarVendor: "generic",
    mood: "Focused",
    behavior: "Answering",
    voice: "",
    prompt: "",
  };
  const currentQuestion = codingTask?.question
    || [...turns].reverse().find((turn) => turn.speaker_type === "interviewer")?.content;
  const latestFocusEvent = focusGuard.events.at(-1);
  const participantCount = panelists.length + 2;

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
        <Brand href="/" />
        <span className="hidden h-5 w-px bg-border sm:block" />
        <div className="min-w-0"><p className="truncate text-sm font-medium leading-5">{session.title}</p><p className="truncate text-[10px] text-muted-foreground">{session.role_pack}</p></div>
        <div className="ms-auto flex items-center gap-2">
          {updatesDelayed ? <Badge variant="destructive" role="status">Updates delayed</Badge> : null}
          {focusGuard.violation_count ? <Button size="sm" variant={focusGuard.flagged ? "destructive" : "outline"} onClick={() => { setDrawerTab("lead"); setDrawerOpen(true); }}><ShieldAlert aria-hidden="true" /><span className="hidden sm:inline">Focus</span> {focusGuard.violation_count}</Button> : <Badge variant="outline" className="hidden sm:inline-flex"><ShieldCheck className="size-3" aria-hidden="true" />Focus 0</Badge>}
          <Badge variant={status === "live" ? "outline" : "secondary"}>{status === "live" ? "Live" : status}</Badge>
          <Button variant={drawerOpen ? "secondary" : "outline"} size="icon" onClick={() => setDrawerOpen((open) => !open)} aria-expanded={drawerOpen} aria-controls="host-controls" aria-label={drawerOpen ? "Close interviewer controls" : "Open interviewer controls"}>{drawerOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}</Button>
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 bg-[var(--stage)] p-3 sm:p-4" aria-label="Live interview room">
          {error ? <Alert variant="destructive" title="Room needs attention">{error}</Alert> : null}
          <div className={cn("grid min-h-0 flex-1 auto-rows-fr gap-2", participantGridClass(participantCount))} aria-label="People in the interview">
            {panelists.map((person, index) => {
              const participant = session.connection.panelists?.find((item) => item.panelist_id === person.id);
              const videoUid = participant?.avatar_uid || participant?.agent_uid;
              const track = videoUid ? media.remoteVideos.find((video) => video.uid === String(videoUid))?.track : undefined;
              return <ParticipantTile key={person.id} person={person} state={presenceForPanelist(index, turns.length, false)} track={track} toneIndex={index} className="min-h-32" />;
            })}
            <ParticipantTile person={candidatePerson} state="listening" track={candidateVideo} toneIndex={panelists.length} className={cn("min-h-32", !candidateConnected && "opacity-65")} />
            <ParticipantTile person={hostPerson} state="listening" track={media.localVideo} toneIndex={panelists.length + 1} isSelf microphoneEnabled={microphoneEnabled} className="min-h-32" />
          </div>

          {currentQuestion ? <div className="shrink-0 rounded-xl border bg-card px-4 py-3"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Current question</p><p className="mt-1 line-clamp-2 text-sm leading-5">{currentQuestion}</p></div> : null}

          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 rounded-2xl border bg-card p-2 shadow-sm" role="group" aria-label="Interviewer room controls">
            <Button variant="outline" size="icon" onClick={toggleAudio} disabled={!rtcReady} aria-pressed={audioMuted} aria-label={audioMuted ? "Unmute the room" : "Mute the room"}>{audioMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}</Button>
            <Button variant={microphoneEnabled ? "secondary" : "outline"} size="icon" onClick={() => void toggleMicrophone()} disabled={!rtcReady || microphoneBusy || status !== "live"} aria-pressed={microphoneEnabled} aria-label={microphoneEnabled ? "Mute your microphone" : "Turn on your microphone"}>{microphoneBusy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : microphoneEnabled ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}</Button>
            <Button variant={cameraEnabled ? "secondary" : "outline"} size="icon" onClick={() => void toggleCamera()} disabled={!rtcReady || cameraBusy || status !== "live"} aria-pressed={cameraEnabled} aria-label={cameraEnabled ? "Turn off your camera" : "Turn on your camera"}>{cameraBusy ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : cameraEnabled ? <Camera aria-hidden="true" /> : <CameraOff aria-hidden="true" />}</Button>
            <Button variant={drawerOpen ? "secondary" : "outline"} onClick={() => setDrawerOpen((open) => !open)} aria-expanded={drawerOpen} aria-controls="host-controls"><PanelRightOpen aria-hidden="true" />Interviewer tools</Button>
            {candidateInvite ? <Button variant="outline" size="icon" onClick={() => void copyCandidateInvite()} aria-label="Copy candidate invitation" title="Copy candidate invitation">{copiedInvite ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button> : null}
            {ownerSessionId ? <Button variant="destructive" onClick={() => void finishInterview()} disabled={ending}>{ending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <PhoneOff aria-hidden="true" />}End</Button> : null}
          </div>
        </section>

        {drawerOpen ? <aside id="host-controls" className="fixed inset-y-0 end-0 z-40 flex w-full max-w-[26rem] flex-col overscroll-contain border-s bg-background shadow-2xl lg:static lg:z-auto lg:shadow-none" aria-label="Interviewer tools">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b px-3"><p className="text-sm font-semibold">Interviewer tools</p><Button className="ms-auto" variant="ghost" size="icon" onClick={() => setDrawerOpen(false)} aria-label="Close interviewer controls"><PanelRightClose aria-hidden="true" /></Button></div>
          <div className="grid shrink-0 grid-cols-4 gap-1 border-b p-2" role="tablist" aria-label="Interviewer tool sections">
            <button id="host-tab-lead" type="button" role="tab" aria-selected={drawerTab === "lead"} aria-controls="host-panel-lead" onClick={() => setDrawerTab("lead")} className={cn("flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", drawerTab === "lead" && "bg-secondary text-foreground")}><Send className="size-3.5" aria-hidden="true" />Lead</button>
            <button id="host-tab-transcript" type="button" role="tab" aria-selected={drawerTab === "transcript"} aria-controls="host-panel-transcript" onClick={() => setDrawerTab("transcript")} className={cn("flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", drawerTab === "transcript" && "bg-secondary text-foreground")}><FileText className="size-3.5" aria-hidden="true" />Transcript</button>
            <button id="host-tab-cv" type="button" role="tab" aria-selected={drawerTab === "cv"} aria-controls="host-panel-cv" onClick={() => setDrawerTab("cv")} className={cn("flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", drawerTab === "cv" && "bg-secondary text-foreground")}><FileText className="size-3.5" aria-hidden="true" />CV</button>
            <button id="host-tab-code" type="button" role="tab" aria-selected={drawerTab === "code"} aria-controls="host-panel-code" onClick={() => setDrawerTab("code")} disabled={!session.supports_coding} className={cn("flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40", drawerTab === "code" && "bg-secondary text-foreground")}><Code2 className="size-3.5" aria-hidden="true" />Code</button>
          </div>

          {drawerTab === "lead" ? <div id="host-panel-lead" role="tabpanel" aria-labelledby="host-tab-lead" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {focusGuard.violation_count ? <Alert variant={focusGuard.flagged ? "destructive" : "default"} title={focusGuard.flagged ? "Focus review recommended" : "Focus guard event"}><span>{focusGuard.violation_count} event{focusGuard.violation_count === 1 ? "" : "s"} recorded{latestFocusEvent ? ` · ${latestFocusEvent.event.replaceAll("_", " ")}` : ""}. This records browser focus signals only; it does not inspect other windows.</span></Alert> : <Alert title="No focus events recorded"><span>No tab, window-focus, fullscreen or camera changes have been recorded.</span></Alert>}
            {pendingQuestion ? <Alert title="Queued for the panel"><span>{pendingQuestion}</span></Alert> : null}
            <Card className="p-0"><h2 className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Your messages</h2><div className="max-h-52 overflow-y-auto p-3">{messages.length ? <ol className="space-y-2">{messages.map((message) => <li key={message.id} className="rounded-lg border p-3 text-sm"><Badge variant={message.mode === "ask" ? "default" : "secondary"}>{message.mode === "ask" ? "Asked the panel" : "Note"}</Badge><p className="mt-2 leading-5">{message.text}</p></li>)}</ol> : <p className="text-xs leading-5 text-muted-foreground">Send a private note to the candidate or queue the panel&apos;s next spoken question.</p>}</div></Card>
            <label className="sr-only" htmlFor="host-draft">Message or panel question</label><textarea id="host-draft" name="host_message" autoComplete="off" value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} placeholder="Ask the panel a follow-up, or send the candidate a note…" className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <div className="flex gap-2"><Button className="flex-1" onClick={() => void send("ask")} disabled={sending || !draft.trim()}><Send aria-hidden="true" />Ask the panel</Button><Button variant="outline" onClick={() => void send("chat")} disabled={sending || !draft.trim()}><MessageSquareText aria-hidden="true" />Note</Button></div>
            <p className="text-xs leading-5 text-muted-foreground">Your live microphone is heard immediately. Use Ask the panel when the question should enter the scored transcript.</p>
          </div> : null}

          {drawerTab === "transcript" ? <div id="host-panel-transcript" role="tabpanel" aria-labelledby="host-tab-transcript" className="min-h-0 flex-1 overflow-y-auto p-3">{turns.length ? <ol className="space-y-3">{turns.map((turn) => <li key={turn.id}><p className={cn("text-xs font-medium", turn.speaker_type === "candidate" ? "text-primary" : "text-muted-foreground")}>{speakerLabel(turn, session)}</p><p className="mt-0.5 text-sm leading-6">{turn.content}</p></li>)}<li ref={transcriptEnd} /></ol> : <div className="grid min-h-48 place-items-center text-center"><div><FileText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">Nothing has been said yet</p><p className="mt-1 text-xs text-muted-foreground">Final transcript turns will appear here.</p></div></div>}</div> : null}

          {drawerTab === "cv" ? <div id="host-panel-cv" role="tabpanel" aria-labelledby="host-tab-cv" className="min-h-0 flex-1 overflow-y-auto p-3">{candidateResume ? <div><div className="rounded-lg border bg-card p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{candidateResume.original_filename}</p><p className="mt-1 text-xs text-muted-foreground">{candidateResume.extracted.word_count ? `${candidateResume.extracted.word_count} words` : "Candidate document"}</p></div><Badge variant="outline">Private</Badge></div></div><div className="mt-3 whitespace-pre-wrap rounded-lg border bg-background p-4 text-xs leading-6 text-muted-foreground">{candidateResume.raw_text || "The CV is attached. Its extracted text will appear here when the room refreshes."}</div></div> : <div className="grid min-h-64 place-items-center rounded-lg border border-dashed p-5 text-center"><div><FileText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">No candidate CV yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">The candidate can attach one from the invitation lobby. This panel updates automatically.</p></div></div>}</div> : null}

          {drawerTab === "code" && session.supports_coding ? <div id="host-panel-code" role="tabpanel" aria-labelledby="host-tab-code" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {codingTask ? <div className="rounded-lg border bg-primary/5 p-3"><div className="flex items-center justify-between gap-2"><Badge variant="outline">Open · {codingTask.language}</Badge><span className="text-[10px] text-muted-foreground">Candidate sees this now</span></div><p className="mt-2 text-xs leading-5">{codingTask.question}</p></div> : null}
            <label className="sr-only" htmlFor="coding-question">Coding question</label><textarea id="coding-question" name="coding_question" autoComplete="off" value={codingQuestion} onChange={(event) => setCodingQuestion(event.target.value)} rows={4} placeholder="Write the coding problem the candidate should solve…" className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
            <div className="grid grid-cols-[8rem_1fr] gap-2"><label className="sr-only" htmlFor="coding-language">Language</label><select id="coding-language" name="coding_language" autoComplete="off" value={codingLanguage} onChange={(event) => setCodingLanguage(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">{(session.coding?.languages ?? ["python"]).map((language) => <option key={language} value={language}>{language}</option>)}</select><label className="sr-only" htmlFor="coding-hints">Optional hints</label><input id="coding-hints" name="coding_hints" autoComplete="off" value={codingHints} onChange={(event) => setCodingHints(event.target.value)} placeholder="Optional hint…" className="h-9 min-w-0 rounded-md border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
            <Button onClick={() => void openCodingTask()} disabled={!codingQuestion.trim() || sendingTask}>{sendingTask ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Code2 aria-hidden="true" />}Open candidate editor</Button>
            <CodeView source={code?.content ?? ""} language={code?.language || codingLanguage} className="min-h-64 flex-1" />
          </div> : null}
        </aside> : null}
      </div>
    </main>
  );
}
