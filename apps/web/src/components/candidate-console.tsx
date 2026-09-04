"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Clock3, Code2, Loader2, Mic2, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { AgoraLivePanel, type LiveAgentState, type LiveMediaState, type LiveTranscriptTurn } from "@/components/agora-live";
import { Brand } from "@/components/app-shell";
import { CodePane } from "@/components/code-pane";
import { ParticipantTile, participantGridClass } from "@/components/panel-video";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import type { Panelist } from "@/data/demo";
import {
  heartbeatCandidateSession,
  joinSessionAsCandidate,
  leaveCandidateSession,
  persistCandidateGuestTurn,
  previewSessionInvite,
  readCandidateGuestCode,
  readCandidateGuestView,
  renewCandidateSessionToken,
  saveCandidateGuestCode,
  type CodingTask,
  type GuestInvitePreview,
  type GuestSession,
  type GuestView,
  type StoredLiveSession,
} from "@/lib/api";
import { mergeLiveTurns, mergeRecordsById, panelistIdForAgoraUid, presenceForPanelist } from "@/lib/live-panel";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 2500;

const EMPTY_MEDIA: LiveMediaState = {
  microphoneEnabled: true,
  candidateSpeaking: false,
  hostSpeaking: false,
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
  return session.panel.find((member) => member.id === turn.speaker_id)?.display_name ?? "AI panel";
}

export function CandidateConsole({ token, initialPreview }: { token: string; initialPreview: GuestInvitePreview }) {
  const [preview, setPreview] = useState(initialPreview);
  const [name, setName] = useState("");
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [joining, setJoining] = useState(false);
  const [session, setSession] = useState<GuestSession | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(initialPreview.status);
  const [liveTurns, setLiveTurns] = useState<LiveTranscriptTurn[]>([]);
  const [storedTurns, setStoredTurns] = useState<GuestView["turns"]>([]);
  const [messages, setMessages] = useState<GuestView["messages"]>([]);
  const [codingTask, setCodingTask] = useState<CodingTask | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [agentState, setAgentState] = useState<LiveAgentState>(null);
  const [media, setMedia] = useState<LiveMediaState>(EMPTY_MEDIA);
  const [updatesDelayed, setUpdatesDelayed] = useState(false);
  const persistedTurns = useRef(new Set<string>());
  const pendingWrites = useRef(new Set<Promise<unknown>>());
  const lastSequence = useRef(0);
  const statusRef = useRef(initialPreview.status);

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
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      if (!stream.getAudioTracks().length) throw new Error("No microphone was found");
      setMicrophoneReady(true);
    } catch (cause) {
      setMicrophoneReady(false);
      setError(cause instanceof Error ? cause.message : "Microphone permission could not be verified.");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      setTestingMicrophone(false);
    }
  }, []);

  const join = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (statusRef.current !== "live") return;
    setJoining(true);
    setError("");
    try {
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
        setCodingTask(view.coding_task ?? null);
        if (view.coding_task?.active) setCodeOpen(true);
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
  const loadCode = useCallback(() => readCandidateGuestCode(token), [token]);
  const saveCode = useCallback((language: string, content: string) => saveCandidateGuestCode(token, language, content), [token]);

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
            <CardHeader><CardTitle>Ready to join?</CardTitle><CardDescription>Choose the name the interviewer will see and check your microphone.</CardDescription></CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={join}>
                <label className="block text-sm font-medium" htmlFor="candidate-name">Your name</label>
                <Input id="candidate-name" name="candidate_name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Candidate name…" autoComplete="name" />
                <Button type="button" className="w-full" variant={microphoneReady ? "secondary" : "outline"} onClick={() => void testMicrophone()} disabled={testingMicrophone}>{testingMicrophone ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : microphoneReady ? <Check aria-hidden="true" /> : <Mic2 aria-hidden="true" />}{testingMicrophone ? "Testing microphone" : microphoneReady ? "Microphone ready" : "Test microphone"}</Button>
                <Button type="submit" size="lg" className="w-full" disabled={preview.status !== "live" || joining} loading={joining}><UsersRound aria-hidden="true" />{waiting ? "Waiting for host" : joining ? "Joining interview" : "Join interview"}</Button>
                <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />This link grants only the candidate seat. It cannot access interviewer controls.</p>
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
  const prepared: StoredLiveSession = { sessionId: session.session_id, agentId: "", connection: session.connection, configSnapshot: { panel: session.panel }, demo: false };
  const currentQuestion = codingTask?.question || [...storedTurns].reverse().find((turn) => turn.speaker_type === "interviewer")?.content || lastRemote?.text;

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4"><Brand href="/" /><span className="hidden h-5 w-px bg-border sm:block" /><div className="min-w-0"><p className="truncate text-sm font-medium">{session.title}</p><p className="truncate text-[10px] text-muted-foreground">{session.role_pack}</p></div><div className="ms-auto flex items-center gap-2">{updatesDelayed ? <Badge variant="destructive">Updates delayed</Badge> : null}<Badge variant={status === "live" ? "outline" : "secondary"}>{status === "live" ? "Live" : status}</Badge><ThemeToggle /></div></header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-hidden lg:p-4">
        <section className="flex min-h-0 flex-col gap-3">
          <div className={cn("grid shrink-0 gap-2", participantGridClass(panelists.length + 1, codeOpen))}>
            {panelists.map((person, index) => <ParticipantTile key={person.id} person={person} state={presenceForPanelist(index, storedTurns.length, agentState === "speaking" && person.id === activePanelistId)} toneIndex={index} compact={codeOpen} className={codeOpen ? "h-[6.5rem]" : "h-40 sm:h-48"} />)}
            <ParticipantTile person={candidatePerson} state={media.candidateSpeaking ? "speaking" : "listening"} isSelf microphoneEnabled={media.microphoneEnabled} compact={codeOpen} className={codeOpen ? "h-[6.5rem]" : "h-40 sm:h-48"} />
          </div>

          {currentQuestion ? <div className="rounded-xl border bg-card px-4 py-3"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">Current question</p><p className="mt-1 text-sm leading-6">{currentQuestion}</p></div> : null}

          {codeOpen && session.coding ? (
            <CodePane
              loadCode={loadCode}
              saveCode={saveCode}
              languages={session.coding.languages}
              defaultLanguage={codingTask?.language || session.coding.default_language}
              prompt={session.coding.prompt}
              question={codingTask?.question}
              hints={codingTask?.hints}
              className="min-h-[24rem] flex-1"
            />
          ) : (
            <Card className="grid min-h-48 flex-1 place-items-center p-6 text-center"><div><UserRound className="mx-auto size-7 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">Answer naturally</p><p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">The panel shares context and may return to an earlier topic. You can interrupt the active speaker when needed.</p>{session.supports_coding ? <Button className="mt-4" size="sm" variant="secondary" onClick={() => setCodeOpen(true)}><Code2 aria-hidden="true" />Open coding workspace</Button> : null}</div></Card>
          )}

          <div className="shrink-0 rounded-xl border bg-card p-2"><AgoraLivePanel prepared={prepared} renewConnection={renewConnection} onTranscript={handleTranscript} onAgentState={setAgentState} onMediaState={setMedia} /></div>
        </section>

        <aside className="flex min-h-0 flex-col gap-3">
          {messages.length ? <Alert title={`Note from ${messages.at(-1)?.author || "interviewer"}`}><span>{messages.at(-1)?.text}</span></Alert> : null}
          <Card className="flex min-h-[18rem] flex-1 flex-col overflow-hidden p-0"><div className="flex items-center justify-between border-b px-3 py-2"><h2 className="text-xs font-medium text-muted-foreground">Live transcript</h2><Badge variant="secondary">{storedTurns.length} turns</Badge></div><div className="min-h-0 flex-1 overflow-y-auto p-3">{storedTurns.length ? <ol className="space-y-3">{storedTurns.map((turn) => <li key={turn.id}><p className={cn("text-xs font-medium", turn.speaker_type === "candidate" ? "text-primary" : "text-muted-foreground")}>{speakerName(turn, session)}</p><p className="mt-0.5 text-sm leading-6">{turn.content}</p></li>)}</ol> : <p className="text-xs text-muted-foreground">The final transcript will appear as the conversation begins.</p>}</div></Card>
          {status !== "live" ? <Alert title="Interview ended"><span>The interviewer has closed this room. Your final answers are saved for the assessment.</span></Alert> : null}
        </aside>
      </div>
    </main>
  );
}
