"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Headphones, Loader2, MessageSquareText, Send, Volume2, VolumeX } from "lucide-react";
import { CodeView } from "@/components/code-pane";
import { Alert, Badge, Button, Card } from "@/components/ui";
import {
  joinSessionAsHost,
  readGuestView,
  sendHostMessage,
  type CodeBuffer,
  type GuestSession,
  type GuestView,
  type HostMessage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

// Fast enough that a co-host can follow the exchange, slow enough not to hammer
// an API that is already carrying a live interview.
const POLL_INTERVAL_MS = 2500;

type Turn = GuestView["turns"][number];

type RtcHandle = {
  leave: () => Promise<void>;
  setMuted: (muted: boolean) => void;
};

/** Listen-only: the guest hears the room but never publishes, so no mic is requested. */
async function listenToRoom(session: GuestSession): Promise<RtcHandle> {
  const AgoraRTC = (await import("agora-rtc-sdk-ng")).default;
  const client = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
  let muted = false;
  client.on("user-published", (user, mediaType) => {
    if (mediaType !== "audio") return;
    void client.subscribe(user, "audio").then(() => {
      if (!muted) user.audioTrack?.play();
    });
  });
  await client.join(
    session.connection.app_id,
    session.connection.channel_name,
    session.connection.token,
    Number(session.connection.uid),
  );
  return {
    leave: () => client.leave(),
    setMuted: (next: boolean) => {
      muted = next;
      for (const user of client.remoteUsers) {
        if (next) user.audioTrack?.stop();
        else user.audioTrack?.play();
      }
    },
  };
}

function speakerLabel(turn: Turn, session: GuestSession | null) {
  if (turn.speaker_type === "candidate") return "Candidate";
  const match = session?.panel.find((member) => member.id === turn.speaker_id);
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
  const [status, setStatus] = useState("");
  const rtc = useRef<RtcHandle | null>(null);
  const lastSequence = useRef(0);
  const transcriptEnd = useRef<HTMLDivElement>(null);

  useEffect(() => () => void rtc.current?.leave().catch(() => undefined), []);

  const join = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setJoining(true);
    setError("");
    try {
      const joined = await joinSessionAsHost(token, name.trim() || "Guest interviewer");
      setSession(joined);
      setStatus(joined.status);
      try {
        rtc.current = await listenToRoom(joined);
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
    const poll = () => void readGuestView(token, lastSequence.current)
      .then((view) => {
        if (cancelled) return;
        setStatus(view.status);
        setCode(view.code);
        setMessages(view.messages);
        setPendingQuestion(view.pending_question);
        if (view.turns.length) {
          lastSequence.current = view.turns[view.turns.length - 1].sequence;
          setTurns((current) => [...current, ...view.turns]);
        }
      })
      .catch(() => undefined);
    poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
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
      setMessages((current) => [...current, posted]);
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

  if (!session) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center gap-6 p-6">
        <div>
          <h1 className="text-xl font-semibold">Join as interviewer</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            You will hear the panel and the candidate, read the transcript, and can hand the panel a
            question to ask next.
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
    <main className="flex min-h-[100dvh] flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium leading-5">{session.title}</p>
          <p className="text-xs text-muted-foreground">{session.role_pack}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Badge variant={status === "live" ? "outline" : "secondary"}>{status === "live" ? "Live" : status}</Badge>
          <Button variant="ghost" size="icon" onClick={toggleAudio} aria-pressed={audioMuted} aria-label={audioMuted ? "Unmute the room" : "Mute the room"}>
            {audioMuted ? <VolumeX className="size-4" aria-hidden /> : <Volume2 className="size-4" aria-hidden />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row lg:p-4">
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
              className="max-h-[18rem] shrink-0"
            />
          ) : null}
        </section>

        <aside className="flex min-h-0 w-full flex-col gap-3 lg:w-[24rem] lg:shrink-0" aria-label="Your notes and questions">
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
              in the candidate&apos;s room.
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
