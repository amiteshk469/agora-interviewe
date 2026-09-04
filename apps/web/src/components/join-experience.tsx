"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { CandidateConsole } from "@/components/candidate-console";
import { HostConsole } from "@/components/host-console";
import { Alert, Button } from "@/components/ui";
import { previewSessionInvite, type GuestInvitePreview } from "@/lib/api";

export function JoinExperience({ token }: { token: string }) {
  const [preview, setPreview] = useState<GuestInvitePreview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void previewSessionInvite(token)
      .then((value) => { if (!cancelled) setPreview(value); })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "This invitation could not be opened."); });
    return () => { cancelled = true; };
  }, [attempt, token]);

  if (preview?.seat === "candidate") return <CandidateConsole token={token} initialPreview={preview} />;
  if (preview?.seat === "interviewer") return <HostConsole token={token} preview={preview} />;
  return <main className="grid min-h-[100dvh] place-items-center bg-background p-6"><div className="w-full max-w-md text-center">{error ? <><Alert variant="destructive" title="Invitation unavailable">{error}</Alert><Button className="mt-4" onClick={() => { setError(""); setAttempt((value) => value + 1); }}>Try again</Button></> : <><Loader2 className="mx-auto size-6 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" /><h1 className="mt-4 text-lg font-semibold">Opening secure interview lobby</h1><p className="mt-1 text-sm text-muted-foreground">Checking which seat this link grants.</p></>}</div></main>;
}
