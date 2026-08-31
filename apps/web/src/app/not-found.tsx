import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-6 text-center">
      <section>
        <p className="font-mono text-sm text-primary">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">That room does not exist</h1>
        <p className="mt-2 text-muted-foreground">Return to your interview workspace.</p>
        <Button asChild className="mt-6"><Link href="/dashboard"><ArrowLeft aria-hidden="true" />Back to dashboard</Link></Button>
      </section>
    </main>
  );
}
