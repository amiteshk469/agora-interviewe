"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Headphones, Loader2, MessageSquareText, Mic, MicOff, Send, Volume2, VolumeX } from "lucide-react";
import { CodeView } from "@/components/code-pane";
import { Alert, Badge, Button, Card } from "@/components/ui";
import {
  joinSessionAsHost,
  heartbeatHostSession,
  leaveHostSession,
  readGuestView,
  renewHostSessionToken,
  sendHostMessage,
  type CodeBuffer,
  type GuestSession,
  type GuestView,
  type HostMessage,
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

export function HostConsole({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [session, setSession] = useState<GuestSession | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [code, setCode] = useState<CodeBuffer | null>(null);
  const [messages, setMessages] = useState<HostMessage[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
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

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const room = rtc.current;
      rtc.current = null;
      void room?.leave().catch(() => undefined);
    };
  }, []);

  const join = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setJoining(true);
    setRtcReady(false);
    setError("");
    try {
      const joined = await joinSessionAsHost(token, name.trim() || "Guest interviewer");
      if (!mounted.current) return;
      setSession(joined);
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
  }, [name, token]);

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
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Join as interviewer</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You can hear the room, speak directly to the candidate, follow the transcript, and hand
            the AI panel a question to ask next.
          </p>
        </div>
        <form onSubmit={join} className="flex flex-col gap-3">
          <label className="text-sm font-medium" htmlFor="host-name">
            Your name
          </label>
          <input
            id="host-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Amitesh"
            autoComplete="name"
            className="h-10 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" disabled={joining}>
            {joining ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Headphones className="size-4" aria-hidden />}
            {joining ? "Joining" : "Join the interview"}
          </Button>
        </form>
        {error ? <Alert variant="destructive" title="Could not join">{error}</Alert> : null}
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
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row lg:overflow-hidden lg:p-4">
        <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Interview transcript">
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
