"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Brand } from "@/components/app-shell";
import { Button } from "@/components/ui";
import { useAuth } from "@/components/auth-provider";

function AuthState({ kind, message, onRetry }: { kind: "loading" | "redirecting" | "error"; message: string; onRetry?: () => void }) {
  const Icon = kind === "error" ? AlertTriangle : LoaderCircle;
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-background px-5">
      <section className="w-full max-w-md rounded-xl border bg-card p-7 text-center shadow-[0_18px_60px_rgb(41_46_48/0.10)] sm:p-9">
        <Brand href="/" stacked />
        <div role={kind === "error" ? "alert" : "status"} aria-live={kind === "error" ? "assertive" : "polite"} aria-atomic="true" aria-busy={kind !== "error"}>
          <Icon className={`mx-auto mt-8 size-6 ${kind === "error" ? "text-destructive" : "animate-spin text-primary"}`} aria-hidden="true" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">{kind === "error" ? "Workspace unavailable" : "Preparing your workspace"}</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{message}</p>
        </div>
        {kind === "error" ? <div className="mt-6 flex justify-center gap-2"><Button onClick={onRetry}><RotateCcw aria-hidden="true" />Try again</Button><Button variant="secondary" asChild><Link href="/auth/sign-in">Sign in</Link></Button></div> : null}
      </section>
    </main>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { status, error, refresh } = useAuth();

  useEffect(() => {
    if (status !== "anonymous") return;
    const target = pathname && pathname !== "/dashboard" ? `?next=${encodeURIComponent(pathname)}` : "";
    router.replace(`/auth/sign-in${target}`);
  }, [pathname, router, status]);

  if (status === "loading") return <AuthState kind="loading" message="Validating your secure session and loading candidate data…" />;
  if (status === "anonymous") return <AuthState kind="redirecting" message="Taking you to sign in…" />;
  if (status === "error") return <AuthState kind="error" message={error || "Authentication could not be verified."} onRetry={() => void refresh()} />;
  return children;
}
