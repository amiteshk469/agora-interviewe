"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-[100dvh] place-items-center bg-[#f5f6f7] px-6 text-[#252728]">
          <section className="max-w-md rounded-xl border border-[#d7dadd] bg-[#fbfbfa] p-8 text-center">
            <AlertTriangle className="mx-auto size-7 text-[#b42318]" aria-hidden="true" />
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">RoundCraft could not start</h1>
            <p className="mt-2 text-sm leading-6 text-[#62676b]">Your account and interview data are safe. Reload the application to try again.</p>
            <Button className="mt-6" onClick={reset}><RefreshCw aria-hidden="true" />Reload application</Button>
          </section>
        </main>
      </body>
    </html>
  );
}
