"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-6">
      <section className="max-w-md text-center">
        <AlertTriangle className="mx-auto mb-5 size-8 text-destructive" aria-hidden="true" />
        <h1 className="text-2xl font-semibold tracking-tight">This page could not load</h1>
        <p className="mt-2 text-sm text-muted-foreground">Your work is safe. Try loading this screen again.</p>
        <Button className="mt-6" onClick={reset}><RefreshCw aria-hidden="true" />Try again</Button>
      </section>
    </main>
  );
}
