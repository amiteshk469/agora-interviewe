"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, Code2, Copy, Headphones, Loader2, MessageSquareText, Mic, MicOff, PhoneOff, Send, UserRound, Volume2, VolumeX } from "lucide-react";
import { CodeView } from "@/components/code-pane";
import { PanelIdentity } from "@/components/panel-video";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
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
  type CodeBuffer,
  type CodingTask,
  type GuestSession,
  type GuestView,
  type GuestInvitePreview,
  type HostMessage,
  type SessionInvite,
} from "@/lib/api";
import { mergeRecordsById, panelistIdForAgoraUid } from "@/lib/live-panel";
import { joinHostRtcRoom, type HostRtcHandle } from "@/lib/host-rtc";
import { cn } from "@/lib/utils";

// Fast enough that a co-host can follow the exchange, slow enough not to hammer
// an API that is already carrying a live interview.
const POLL_INTERVAL_MS = 2500;

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
  const [updatesDelayed, setUpdatesDelayed] = useState(false);
  const [status, setStatus] = useState("");
  const rtc = useRef<HostRtcHandle | null>(null);
  const mounted = useRef(true);
  const statusRef = useRef("");
  const lastSequence = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);
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
      setCodingLanguage(joined.coding?.default_language || "python");
      statusRef.current = joined.status;
      setStatus(joined.status);
      try {
        const room = await joinHostRtcRoom(joined, {
          renewConnection: () => renewHostSessionToken(token),
          onConnectionError: (renewalError) => {
            if (mounted.current) setError(`Live audio needs to reconnect: ${renewalError.message}`);
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
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!stream.getAudioTracks().length) throw new Error("No microphone was found");
      setPrejoinMicrophoneReady(true);
    } catch (cause) {
      setPrejoinMicrophoneReady(false);
      setError(cause instanceof Error ? cause.message : "Microphone permission could not be verified.");
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
          void room?.leave().catch((leaveError) => console.warn("Host audio cleanup failed", leaveError));
        }
        setStatus(view.status);
        setCode(view.code);
        setCandidate(view.candidate ?? null);
        setCodingTask(view.coding_task ?? null);
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
            <CardHeader><CardTitle>Ready to join?</CardTitle><CardDescription>Your microphone stays off until you explicitly enable it inside the room.</CardDescription></CardHeader>
            <CardContent>
              <form onSubmit={join} className="flex flex-col gap-3">
                <label className="text-sm font-medium" htmlFor="host-name">Your name</label>
                <input id="host-name" name="host_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Interviewer name…" autoComplete="name" className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <Button type="button" variant={prejoinMicrophoneReady ? "secondary" : "outline"} onClick={() => void testPrejoinMicrophone()} disabled={testingPrejoinMicrophone}>{testingPrejoinMicrophone ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : prejoinMicrophoneReady ? <Check className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}{testingPrejoinMicrophone ? "Testing microphone" : prejoinMicrophoneReady ? "Microphone ready" : "Test microphone"}</Button>
                <Button type="submit" size="lg" disabled={joining}>{joining ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Headphones className="size-4" aria-hidden="true" />}{joining ? "Joining interview" : "Join interview"}</Button>
              </form>
              {error ? <div className="mt-4"><Alert variant="destructive" title="Could not join">{error}</Alert></div> : null}
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-5">{session.title}</p>
          <p className="text-xs text-muted-foreground">{session.role_pack}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          {candidate ? <Badge variant="outline"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden="true" />{candidate.display_name} joined</Badge> : ownerSessionId ? <Badge variant="secondary">Waiting for candidate</Badge> : null}
          <Badge variant={status === "live" ? "outline" : "secondary"}>{status === "live" ? "Live" : status}</Badge>
          {updatesDelayed ? <Badge variant="destructive" role="status">Updates delayed</Badge> : null}
          <Button variant="ghost" size="icon" onClick={toggleAudio} disabled={!rtcReady} aria-pressed={audioMuted} aria-label={audioMuted ? "Unmute the room" : "Mute the room"}>
            {audioMuted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
          </Button>
          <Button
            variant={microphoneEnabled ? "default" : "outline"}
            size="icon"
            onClick={() => void toggleMicrophone()}
            disabled={!rtcReady || microphoneBusy || status !== "live"}
            aria-pressed={microphoneEnabled}
            aria-label={microphoneEnabled ? "Mute your microphone" : "Speak in the interview"}
            title={microphoneEnabled ? "Mute your microphone" : "Speak directly (not added to the scored transcript)"}
          >
            {microphoneBusy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> : microphoneEnabled ? <Mic className="size-4" aria-hidden /> : <MicOff className="size-4" aria-hidden />}
          </Button>
          {candidateInvite ? <Button variant="ghost" size="icon" onClick={() => void copyCandidateInvite()} aria-label="Copy candidate invitation" title="Copy candidate invitation">{copiedInvite ? <Check className="size-4" aria-hidden="true" /> : <Copy className="size-4" aria-hidden="true" />}</Button> : null}
          {ownerSessionId ? <Button variant="destructive" size="sm" onClick={() => void finishInterview()} disabled={ending}>{ending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <PhoneOff className="size-4" aria-hidden="true" />}End</Button> : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row lg:overflow-hidden lg:p-4">
        <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Interview transcript">
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4" aria-label="People in the interview">
            {session.panel.map((member, index) => <div key={member.id} className="flex min-w-0 items-center gap-2 rounded-xl border bg-card p-3"><PanelIdentity seed={member.id} toneIndex={index} initials={member.display_name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)} className="size-9 text-[10px]" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{member.display_name}</span><span className="block truncate text-[10px] text-muted-foreground">AI · {member.role}</span></span></div>)}
            <div className={cn("flex min-w-0 items-center gap-2 rounded-xl border p-3", candidate ? "border-primary/40 bg-primary/5" : "border-dashed bg-card")}><span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary"><UserRound className="size-4" aria-hidden="true" /></span><span className="min-w-0"><span className="block truncate text-xs font-medium">{candidate?.display_name || "Candidate"}</span><span className="block truncate text-[10px] text-muted-foreground">{candidate ? "In the room" : "Waiting to join"}</span></span></div>
          </div>
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            <h2 className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Transcript</h2>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {turns.length ? (
                <ol className="flex flex-col gap-3">
                  {turns.map((turn) => (
                    <li key={turn.id} className="text-sm">
                      <p className={cn("text-xs font-medium", turn.speaker_type === "candidate" ? "text-primary" : "text-muted-foreground")}>
                        {speakerLabel(turn, session)}
                      </p>
                      <p className="mt-0.5 leading-6 text-pretty">{turn.content}</p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">Nothing has been said yet.</p>
              )}
              <div ref={transcriptEnd} />
            </div>
          </Card>

          {session.supports_coding ? (
            <CodeView
              source={code?.content ?? ""}
              language={code?.language || "python"}
              // The transcript is the thread to follow; the editor is reference.
              className="h-[40%] min-h-[10rem] shrink-0"
            />
          ) : null}
        </section>

        <aside className="flex min-h-0 w-full shrink-0 flex-col gap-3 lg:w-[24rem]" aria-label="Your notes and questions">
          {pendingQuestion ? (
            <Alert title="Queued for the panel">
              <span className="text-xs">{pendingQuestion}</span>
            </Alert>
          ) : null}

          {session.supports_coding ? (
            <Card className="shrink-0 p-0">
              <div className="border-b px-3 py-2"><h2 className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><Code2 className="size-3.5" aria-hidden="true" />Coding task</h2></div>
              <div className="space-y-2 p-3">
                {codingTask ? <div className="rounded-lg border bg-primary/5 p-3"><div className="flex items-center justify-between gap-2"><Badge variant="outline">Open · {codingTask.language}</Badge><span className="text-[10px] text-muted-foreground">Candidate sees this now</span></div><p className="mt-2 text-xs leading-5">{codingTask.question}</p></div> : null}
                <label className="sr-only" htmlFor="coding-question">Coding question</label>
                <textarea id="coding-question" name="coding_question" autoComplete="off" value={codingQuestion} onChange={(event) => setCodingQuestion(event.target.value)} rows={3} placeholder="Write the coding problem the candidate should solve…" className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                <div className="grid grid-cols-[8rem_1fr] gap-2">
                  <label className="sr-only" htmlFor="coding-language">Language</label>
                  <select id="coding-language" name="coding_language" autoComplete="off" value={codingLanguage} onChange={(event) => setCodingLanguage(event.target.value)} className="h-9 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">{(session.coding?.languages ?? ["python"]).map((language) => <option key={language} value={language}>{language}</option>)}</select>
                  <label className="sr-only" htmlFor="coding-hints">Optional hints</label>
                  <input id="coding-hints" name="coding_hints" autoComplete="off" value={codingHints} onChange={(event) => setCodingHints(event.target.value)} placeholder="Optional hint…" className="h-9 min-w-0 rounded-md border bg-background px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <Button className="w-full" size="sm" onClick={() => void openCodingTask()} disabled={!codingQuestion.trim() || sendingTask}>{sendingTask ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Code2 aria-hidden="true" />}Open candidate editor</Button>
              </div>
            </Card>
          ) : null}

          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
            <h2 className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">Your messages</h2>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {messages.length ? (
                <ol className="flex flex-col gap-2">
                  {messages.map((message) => (
                    <li key={message.id} className="rounded-lg border px-3 py-2 text-sm">
                      <span className="me-2 align-middle">
                        <Badge variant={message.mode === "ask" ? "default" : "secondary"}>
                          {message.mode === "ask" ? "Asked the panel" : "Note"}
                        </Badge>
                      </span>
                      <span className="leading-6">{message.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Send a note the candidate can read, or hand the panel a question to ask next.
                </p>
              )}
            </div>
          </Card>

          <div className="flex flex-col gap-2">
            <label className="sr-only" htmlFor="host-draft">
              Message
            </label>
            <textarea
              id="host-draft"
              name="host_message"
              autoComplete="off"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={3}
              placeholder="Why did you pick a hash map over a tree here?"
              className="resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => void send("ask")} disabled={sending || !draft.trim()}>
                <Send className="size-4" aria-hidden /> Ask the panel
              </Button>
              <Button variant="outline" onClick={() => void send("chat")} disabled={sending || !draft.trim()}>
                <MessageSquareText className="size-4" aria-hidden /> Note
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Ask the panel puts your question next in the interviewer&apos;s mouth. A note only appears
              in the candidate&apos;s room. Direct microphone audio is live but is not added to the scored
              transcript, so use Ask the panel for an assessed question.
            </p>
          </div>

          {error ? (
            <Alert variant="destructive" title="Something went wrong">
              {error}
            </Alert>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
