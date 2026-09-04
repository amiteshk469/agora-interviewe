"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BriefcaseBusiness, CheckCircle2, GraduationCap, KeyRound, LoaderCircle, MailCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth, type AccountType } from "@/components/auth-provider";
import { Brand } from "@/components/app-shell";
import { PanelSequence } from "@/components/panel-sequence";
import { Alert, Button, Field, Input } from "@/components/ui";
import { safeReturnPath } from "@/lib/supabase";

function AuthShell({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-[100dvh] bg-background lg:grid-cols-[0.92fr_1.08fr]">
      <section className="flex min-w-0 flex-col px-5 py-6 sm:px-9 sm:py-8 lg:px-12">
        <Brand href="/" />
        <div className="mx-auto flex w-full max-w-[25rem] flex-1 flex-col justify-center py-12">
          <h1 className="text-balance text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>
          {children}
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Your credentials are handled by Supabase Auth. RoundCraft never stores your password.</p>
      </section>
      <section className="relative hidden overflow-hidden border-s bg-card lg:grid lg:place-items-center" aria-label="RoundCraft product preview">
        <div className="surface-grid absolute inset-0 opacity-65" aria-hidden="true" />
        <div className="relative w-full max-w-2xl p-10 xl:p-16">
          <PanelSequence />
          <div className="mx-auto mt-7 flex max-w-lg items-center justify-center gap-5 text-xs text-muted-foreground">
            <span>Adaptive panel</span><span aria-hidden="true">/</span><span>Evidence-linked report</span><span aria-hidden="true">/</span><span>Private workspace</span>
          </div>
        </div>
      </section>
    </main>
  );
}

export function AuthScreen({ mode, nextPath, initialAudience = "candidate" }: { mode: "sign-in" | "sign-up"; nextPath?: string; initialAudience?: AccountType }) {
  const router = useRouter();
  const { status, signIn, signUp } = useAuth();
  const signup = mode === "sign-up";
  const [audience, setAudience] = useState<AccountType>(initialAudience);
  const destination = nextPath
    ? safeReturnPath(nextPath)
    : signup
      ? audience === "recruiter" ? "/recruiter" : "/candidate"
      : "/dashboard";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (status === "authenticated") router.replace(destination);
  }, [destination, router, status]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    try {
      if (signup) {
        const result = await signUp(String(form.get("name") || "").trim(), email, password, audience, destination);
        if (result.confirmationRequired) {
          setMessage("Check your inbox to confirm your email. This page can stay open while you finish.");
        } else {
          router.replace(destination);
        }
      } else {
        await signIn(email, password);
        router.replace(destination);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title={signup ? audience === "recruiter" ? "Create your recruiter workspace" : "Create your candidate workspace" : "Welcome back"}
      description={signup ? audience === "recruiter" ? "Build interview rooms, invite candidates, and work beside an adaptive AI panel." : "Practice against role-matched panels and turn every transcript into focused evidence." : "Open the workspace where you prepare, interview, and review evidence."}
    >
      {status === "authenticated" ? <div className="mt-8 flex items-center gap-3 rounded-lg border bg-secondary p-4 text-sm" role="status" aria-live="polite" aria-busy="true"><LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />Opening your workspace…</div> : (
        <form className="mt-8 space-y-4" onSubmit={submit}>
          {signup ? <fieldset><legend className="text-sm font-medium">How will you use RoundCraft?</legend><div className="mt-2 grid grid-cols-2 gap-2"><label><input type="radio" name="audience" value="candidate" checked={audience === "candidate"} onChange={() => setAudience("candidate")} className="peer sr-only" /><span className="flex min-h-24 flex-col rounded-lg border bg-background p-3 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"><GraduationCap className="size-4 text-primary" aria-hidden="true" /><span className="mt-3 font-medium">Candidate</span><span className="mt-1 text-xs text-muted-foreground">Practice and improve</span></span></label><label><input type="radio" name="audience" value="recruiter" checked={audience === "recruiter"} onChange={() => setAudience("recruiter")} className="peer sr-only" /><span className="flex min-h-24 flex-col rounded-lg border bg-background p-3 text-sm transition-colors peer-checked:border-primary peer-checked:bg-primary/5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring"><BriefcaseBusiness className="size-4 text-primary" aria-hidden="true" /><span className="mt-3 font-medium">Recruiter</span><span className="mt-1 text-xs text-muted-foreground">Create and run interviews</span></span></label></div></fieldset> : null}
          {signup ? <Field label="Full name" required><Input name="name" autoComplete="name" required placeholder="e.g. Priya Sharma…" /></Field> : null}
          <Field label="Email" required><Input name="email" type="email" autoComplete="email" inputMode="email" spellCheck={false} required placeholder="e.g. you@example.com…" /></Field>
          <Field label="Password" hint={signup ? "8 characters minimum" : undefined} required>
            <Input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} required minLength={8} placeholder={signup ? "Create a secure password…" : "Enter your password…"} />
          </Field>
          {!signup ? <div className="flex justify-end"><Link href="/auth/forgot-password" className="text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">Forgot password?</Link></div> : null}
          {error ? <Alert title="Could not continue" variant="destructive"><span>{error}</span></Alert> : null}
          {message ? <Alert title="Confirm your email"><span>{message}</span></Alert> : null}
          <Button type="submit" size="lg" loading={loading} className="mt-2 w-full">{signup ? "Create workspace" : "Sign in"}<ArrowRight aria-hidden="true" /></Button>
        </form>
      )}
      <p className="mt-7 text-center text-sm text-muted-foreground">{signup ? "Already have an account?" : "New to RoundCraft?"} <Link className="font-medium text-foreground hover:underline" href={signup ? `/auth/sign-in?next=${encodeURIComponent(destination)}` : "/auth/sign-up"}>{signup ? "Sign in" : "Create an account"}</Link></p>
    </AuthShell>
  );
}

export function ForgotPasswordScreen() {
  const { sendPasswordReset } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      await sendPasswordReset(String(form.get("email") || "").trim());
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The reset email could not be sent.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Reset your password" description="We will send a secure recovery link to your RoundCraft account email.">
      {sent ? <div className="mt-8 rounded-xl border bg-card p-5" role="status" aria-live="polite"><MailCheck className="size-6 text-primary" aria-hidden="true" /><h2 className="mt-4 font-semibold">Check your inbox</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">If an account exists for that email, a password reset link is on its way.</p><Button asChild variant="secondary" className="mt-5"><Link href="/auth/sign-in">Back to sign in</Link></Button></div> : <form className="mt-8 space-y-4" onSubmit={submit}><Field label="Email" required><Input name="email" type="email" autoComplete="email" inputMode="email" spellCheck={false} required placeholder="e.g. you@example.com…" /></Field>{error ? <Alert title="Could not send reset link" variant="destructive"><span>{error}</span></Alert> : null}<Button type="submit" size="lg" loading={loading} className="w-full">Send reset link</Button></form>}
    </AuthShell>
  );
}

export function UpdatePasswordScreen() {
  const router = useRouter();
  const { status, updatePassword } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmationError, setConfirmationError] = useState("");
  const [complete, setComplete] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setConfirmationError("");
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") || "");
    const confirmation = String(form.get("confirmation") || "");
    if (password !== confirmation) {
      setConfirmationError("The passwords do not match.");
      setLoading(false);
      const confirmationInput = event.currentTarget.elements.namedItem("confirmation");
      if (confirmationInput instanceof HTMLInputElement) confirmationInput.focus();
      return;
    }
    try {
      await updatePassword(password);
      setComplete(true);
      window.setTimeout(() => router.replace("/dashboard"), 900);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The password could not be updated.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Choose a new password" description="Use at least eight characters and keep it unique to this account.">
      {status === "loading" ? <div className="mt-8 flex items-center gap-3 text-sm text-muted-foreground" role="status" aria-live="polite" aria-busy="true"><LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />Validating your recovery link…</div> : null}
      {status === "anonymous" || status === "error" ? <Alert title="Recovery link unavailable" variant="destructive"><span>Open the latest link from your password reset email, or request a new one.</span></Alert> : null}
      {status === "authenticated" && !complete ? <form className="mt-8 space-y-4" onSubmit={submit}><Field label="New password" required><Input name="password" type="password" autoComplete="new-password" minLength={8} required /></Field><Field label="Confirm password" required error={confirmationError}><Input name="confirmation" type="password" autoComplete="new-password" minLength={8} required /></Field>{error ? <Alert title="Could not update password" variant="destructive"><span>{error}</span></Alert> : null}<Button type="submit" size="lg" loading={loading} className="w-full"><KeyRound aria-hidden="true" />Update password</Button></form> : null}
      {complete ? <div className="mt-8 rounded-xl border bg-secondary p-5 text-center" role="status" aria-live="polite"><CheckCircle2 className="mx-auto size-7 text-primary" aria-hidden="true" /><p className="mt-3 font-medium">Password updated</p><p className="mt-1 text-sm text-muted-foreground">Opening your workspace now.</p></div> : null}
    </AuthShell>
  );
}

export function AuthCallbackScreen({ nextPath }: { nextPath?: string }) {
  const router = useRouter();
  const { status, error, refresh } = useAuth();
  const destination = safeReturnPath(nextPath);

  useEffect(() => {
    if (status === "authenticated") router.replace(destination);
  }, [destination, router, status]);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5">
      <section className="w-full max-w-md rounded-xl border bg-card p-8 text-center">
        <Brand href="/" stacked />
        {status === "error" ? <div role="alert" aria-live="assertive"><h1 className="mt-7 text-xl font-semibold">Email confirmation failed</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">{error}</p><Button className="mt-6" onClick={() => void refresh()}>Try again</Button></div> : null}
        {status === "anonymous" ? <div role="status" aria-live="polite"><h1 className="mt-7 text-xl font-semibold">Confirmation link unavailable</h1><p className="mt-2 text-sm leading-6 text-muted-foreground">This link may have expired or already been used. Sign in if your account is confirmed, or create it again to receive a fresh link.</p><div className="mt-6 flex justify-center gap-2"><Button asChild><Link href={`/auth/sign-in?next=${encodeURIComponent(destination)}`}>Sign in</Link></Button><Button asChild variant="secondary"><Link href={`/auth/sign-up?next=${encodeURIComponent(destination)}`}>Create account</Link></Button></div></div> : null}
        {status === "loading" || status === "authenticated" ? <div role="status" aria-live="polite" aria-busy="true"><LoaderCircle className="mx-auto mt-8 size-6 animate-spin text-primary" aria-hidden="true" /><h1 className="mt-4 text-xl font-semibold">Confirming your account</h1><p className="mt-2 text-sm text-muted-foreground">Your secure workspace will open automatically…</p></div> : null}
      </section>
    </main>
  );
}
