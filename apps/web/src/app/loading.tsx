export default function Loading() {
  return (
    <main className="grid min-h-[100dvh] place-items-center px-6" aria-busy="true" aria-label="Loading RoundCraft">
      <div className="w-full max-w-sm space-y-4">
        <div className="h-6 w-28 animate-pulse rounded-md bg-muted" />
        <div className="h-36 animate-pulse rounded-lg border bg-card" />
        <p className="text-center text-sm text-muted-foreground">Preparing your workspace…</p>
      </div>
    </main>
  );
}
