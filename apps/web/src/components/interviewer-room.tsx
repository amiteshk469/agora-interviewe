"use client";

import { useRouter } from "next/navigation";
import { Check, Clipboard, Copy, Loader2, Mic2, Play, ShieldCheck, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { HostConsole } from "@/components/host-console";
import { PanelIdentity } from "@/components/panel-video";
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import {
  createScopedSessionInvite,
  readInterviewerRoom,
  readLiveSession,
  saveInterviewerRoom,
  saveLiveSession,
  startInterviewSession,
  type SessionInvite,
  type StoredLiveSession,
} from "@/lib/api";

type SnapshotPanelist = { id?: string; display_name?: string; role?: string };

function shareUrl(invite: SessionInvite | null) {
  if (!invite || typeof window === "undefined") return "";
  return new URL(invite.join_path, window.location.origin).toString();
}

export function InterviewerLobbyScreen() {
  const router = useRouter();
  const [session, setSession] = useState<StoredLiveSession | null>(null);
  const [invite, setInvite] = useState<SessionInvite | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [copied, setCopied] = useState(false);
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [testingMicrophone, setTestingMicrophone] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  const panel = useMemo(() => {
    const people = (session?.configSnapshot?.panel as SnapshotPanelist[] | undefined) ?? [];
    return people.map((person, index) => ({
      id: person.id || `panel-${index}`,
      name: person.display_name || `Interviewer ${index + 1}`,
      role: person.role || "Interviewer",
    }));
  }, [session]);

  useEffect(() => {
    const stored = readLiveSession();
    const timer = window.setTimeout(() => {
      setSession(stored);
      if (!stored || stored.demo) {
        setLoadingInvite(false);
        setError("Create an interviewer-led configuration before opening this lobby.");
        return;
      }
      void createScopedSessionInvite(stored.sessionId, "candidate")
        .then(setInvite)
        .catch((cause) => setError(cause instanceof Error ? cause.message : "The candidate link could not be created."))
        .finally(() => setLoadingInvite(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const copyInvite = useCallback(async () => {
    const url = shareUrl(invite);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Copy was blocked. Select the link and copy it manually.");
    }
  }, [invite]);

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

  const startRoom = useCallback(async () => {
    if (!session || !invite || starting) return;
    setStarting(true);
    setError("");
    try {
      const started = await startInterviewSession(session.sessionId);
      const hostInvite = await createScopedSessionInvite(session.sessionId, "interviewer");
      saveLiveSession(started);
      saveInterviewerRoom({
        sessionId: session.sessionId,
        hostToken: hostInvite.token,
        candidateInvite: invite,
      });
      router.push("/interview/host");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The interview room could not start.");
    } finally {
      setStarting(false);
    }
  }, [invite, router, session, starting]);

  return (
    <AppShell screen="setup" title="Interviewer lobby" description="Invite the candidate, check your microphone, then start the AI-assisted room.">
      <div className="grid gap-6 lg:grid-cols-[1fr_23rem]">
        <Card className="overflow-hidden p-0">
          <div className="surface-grid min-h-[30rem] p-6 sm:p-8">
            <div className="mx-auto max-w-3xl">
              <div className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-xl border bg-card shadow-sm"><UsersRound className="size-5 text-primary" aria-hidden="true" /></span>
                <div><Badge variant="outline">Interviewer workspace</Badge><h2 className="mt-1 text-xl font-semibold">Your panel is ready to co-interview</h2></div>
              </div>
              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {panel.map((person, index) => (
                  <div key={person.id} className="flex items-center gap-3 rounded-xl border bg-card/90 p-4 shadow-sm backdrop-blur">
                    <PanelIdentity initials={person.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)} seed={person.id} toneIndex={index} className="size-11 text-xs" />
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{person.name}</span><span className="block truncate text-xs text-muted-foreground">{person.role}</span></span>
                  </div>
                ))}
              </div>
              <div className="mt-7 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-card/80 p-4"><p className="text-xs font-medium">Lead naturally</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Speak directly or queue the AI panel&apos;s next question.</p></div>
                <div className="rounded-lg border bg-card/80 p-4"><p className="text-xs font-medium">Open coding tasks</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Send a problem and watch the candidate&apos;s editor update.</p></div>
                <div className="rounded-lg border bg-card/80 p-4"><p className="text-xs font-medium">Keep evidence</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Final turns remain linked to the structured assessment.</p></div>
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Candidate invitation</CardTitle><CardDescription>The link opens a prejoin lobby and stays on “waiting” until you start.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {loadingInvite ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Creating secure link</div> : null}
              {invite ? <><label className="sr-only" htmlFor="candidate-invite">Candidate invite link</label><div className="flex gap-2"><input id="candidate-invite" name="candidate_invite" autoComplete="off" spellCheck={false} readOnly value={shareUrl(invite)} onFocus={(event) => event.currentTarget.select()} className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" /><Button size="icon" variant="secondary" onClick={() => void copyInvite()} aria-label="Copy candidate invitation">{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}</Button></div><p className="text-xs text-muted-foreground">Expires in 6 hours. It grants only the candidate seat.</p></> : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Device check</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full" variant={microphoneReady ? "secondary" : "outline"} onClick={() => void testMicrophone()} disabled={testingMicrophone}>{testingMicrophone ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : microphoneReady ? <Check aria-hidden="true" /> : <Mic2 aria-hidden="true" />}{testingMicrophone ? "Testing microphone" : microphoneReady ? "Microphone ready" : "Test microphone"}</Button>
              <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />Audio travels through Agora. The interview record stores final transcript turns, not a raw recording.</div>
            </CardContent>
          </Card>

          {error ? <Alert variant="destructive" title="Lobby needs attention">{error}</Alert> : null}
          <Button size="lg" className="w-full" onClick={() => void startRoom()} disabled={!session || !invite || starting} loading={starting}><Play aria-hidden="true" />Start interview room</Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><Clipboard className="size-3.5" aria-hidden="true" />The candidate can keep the invite page open while waiting.</p>
        </div>
      </div>
    </AppShell>
  );
}

export function InterviewerRoomScreen() {
  const router = useRouter();
  const { displayName } = useAuth();
  const [room, setRoom] = useState<ReturnType<typeof readInterviewerRoom>>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setRoom(readInterviewerRoom()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!room) {
    return <main className="grid min-h-[100dvh] place-items-center bg-background p-6"><Card className="max-w-md"><CardHeader><CardTitle>Interviewer room not found</CardTitle><CardDescription>Return to setup and start an interviewer-led session from its lobby.</CardDescription></CardHeader><CardContent><Button onClick={() => router.push("/setup?mode=interviewer_led")}>Build an interview</Button></CardContent></Card></main>;
  }

  return <HostConsole token={room.hostToken} autoJoinName={displayName || "Interviewer"} ownerSessionId={room.sessionId} candidateInvite={room.candidateInvite} />;
}
