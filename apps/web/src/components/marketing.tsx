"use client";

import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleStop,
  FileText,
  Mic2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Brand } from "@/components/app-shell";
import { Avatar, Badge, Button, Card, CheckRow, Separator } from "@/components/ui";
import { defaultPanelists, featureSignals } from "@/data/demo";

export function PanelSequence() {
  return (
    <div className="relative mx-auto w-full max-w-xl overflow-hidden rounded-xl border bg-card shadow-2xl shadow-black/30">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2"><span className="size-2 rounded-full bg-primary" aria-hidden="true" /><span className="text-sm font-medium">Adaptive panel in session</span></div>
        <Badge variant="outline"><AudioLines className="size-3" aria-hidden="true" />Agora live</Badge>
      </div>
      <div className="grid min-h-[24rem] md:grid-cols-[9rem_1fr]">
        <div className="border-b p-3 md:border-b-0 md:border-e">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Panel</p>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
            {defaultPanelists.map((person, index) => <div key={person.id} className={`flex items-center gap-2 rounded-md p-2 ${index === 2 ? "bg-primary/10" : ""}`}><Avatar initials={person.initials} active={index === 2} className="size-8" /><span className="hidden min-w-0 md:block"><span className="block truncate text-xs font-medium">{person.name.split(" ")[0]}</span><span className="block truncate text-[10px] text-muted-foreground">{person.role}</span></span></div>)}
          </div>
        </div>
        <div className="flex flex-col justify-between p-5">
          <div>
            <div className="flex items-center justify-between gap-3"><Badge variant="default">Leah selected next</Badge><span className="font-mono text-[11px] text-muted-foreground">05:08</span></div>
            <p className="mt-5 text-lg font-medium leading-7">“You called pulse feedback a guardrail. Why is it not the outcome itself?”</p>
            <div className="mt-6 rounded-lg border bg-background p-3">
              <p className="text-xs font-medium text-muted-foreground">Director reasoning</p>
              <p className="mt-1 text-sm leading-6">The bar raiser detected a contradiction. The next speaker changed from Analytics to Bar Raiser, with Strategy still free to return later.</p>
            </div>
          </div>
          <div className="mt-7 flex items-center gap-3 border-t pt-4">
            <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-foreground" aria-hidden="true"><Mic2 className="size-4" /></span>
            <div className="flex h-8 flex-1 items-center justify-center gap-1" aria-hidden="true">
              {[12, 20, 8, 26, 16, 30, 10, 22, 14, 18].map((height, index) => <span key={`${height}-${index}`} className="w-0.5 rounded-full bg-primary" style={{ height }} />)}
            </div>
            <span className="grid size-10 place-items-center rounded-full border bg-secondary text-muted-foreground" aria-hidden="true"><CircleStop className="size-4" /></span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketingPage() {
  return (
    <div className="min-h-[100dvh] overflow-hidden bg-background">
      <a href="#marketing-main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4">Skip to content</a>
      <header className="fixed inset-x-0 top-0 z-40 border-b bg-background/82 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-7xl items-center gap-7 px-4 sm:px-6" aria-label="Main navigation">
          <Brand href="/" />
          <div className="hidden items-center gap-6 text-sm text-muted-foreground md:flex"><a href="#how-it-works" className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">How it works</a><a href="#assessment" className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Assessment</a><a href="#panel" className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Panel</a></div>
          <div className="ms-auto flex items-center gap-2"><Button variant="ghost" asChild className="hidden sm:inline-flex"><Link href="/auth/sign-in">Sign in</Link></Button><Button asChild><Link href="/auth/sign-up?next=%2Fsetup">Start practicing<ArrowRight aria-hidden="true" /></Link></Button></div>
        </nav>
      </header>

      <main id="marketing-main">
        <section className="relative min-h-[100dvh] pt-16">
          <div className="surface-grid pointer-events-none absolute inset-0 opacity-70" aria-hidden="true" />
          <div className="relative mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl items-center gap-14 px-4 py-16 sm:px-6 lg:grid-cols-[0.82fr_1.18fr] lg:py-20">
            <div className="max-w-xl enter">
              <Badge variant="outline"><Sparkles className="size-3" aria-hidden="true" />AI panel interviews, built for practice</Badge>
              <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-5xl lg:text-6xl">Practice the interview that will not follow a script.</h1>
              <p className="mt-5 max-w-lg text-pretty text-base leading-7 text-muted-foreground sm:text-lg">A configurable panel that interrupts, remembers, challenges, and shows the exact evidence behind every assessment.</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row"><Button size="lg" asChild><Link href="/auth/sign-up?next=%2Fsetup">Build your panel<ArrowRight aria-hidden="true" /></Link></Button><Button size="lg" variant="secondary" asChild><Link href="/reports/demo">View an evidence report</Link></Button></div>
            </div>
            <div className="enter [animation-delay:100ms]"><PanelSequence /></div>
          </div>
        </section>

        <section className="border-y bg-card/40" aria-label="Product capabilities">
          <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px px-4 py-5 text-center text-xs text-muted-foreground sm:grid-cols-4 sm:px-6">
            {[
              "2 to 5 configurable panelists",
              "Live interruption handling",
              "Transcript-linked evidence",
              "Fully autonomous practice",
            ].map((item) => <div key={item} className="flex items-center justify-center gap-2 px-3 py-2"><Check className="size-3.5 text-primary" aria-hidden="true" />{item}</div>)}
          </div>
        </section>

        <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
          <div className="max-w-2xl"><h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Prepared for your role. Responsive to your answer.</h2><p className="mt-4 text-base leading-7 text-muted-foreground">Start from proven defaults or configure every interviewer. The panel changes direction when your answer calls for it.</p></div>
          <div className="mt-14 grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="space-y-8">
              {featureSignals.map((feature, index) => { const Icon = feature.icon; return <div key={feature.title} className="grid grid-cols-[2.5rem_1fr] gap-4"><div className="grid size-10 place-items-center rounded-md border bg-card"><Icon className="size-4 text-primary" aria-hidden="true" /></div><div><div className="flex items-center gap-2"><span className="font-mono text-xs text-muted-foreground">0{index + 1}</span><h3 className="font-semibold">{feature.title}</h3></div><p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{feature.text}</p></div></div>; })}
            </div>
            <Card className="overflow-hidden">
              <div className="border-b p-5"><div className="flex items-center justify-between"><div><p className="font-medium">Configure from a job description</p><p className="mt-1 text-sm text-muted-foreground">Optional, editable, and private</p></div><FileText className="size-5 text-primary" aria-hidden="true" /></div></div>
              <div className="space-y-4 p-5">
                <div className="rounded-lg border border-dashed bg-background p-5 text-center"><FileText className="mx-auto size-6 text-muted-foreground" aria-hidden="true" /><p className="mt-3 text-sm font-medium">senior-pm-growth.pdf</p><p className="mt-1 text-xs text-muted-foreground">Role signals extracted</p></div>
                <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Recommended panel</p><p className="mt-1 text-sm font-medium">Growth, Analytics, Bar Raiser</p></div><div className="rounded-md bg-secondary p-3"><p className="text-xs text-muted-foreground">Rubric emphasis</p><p className="mt-1 text-sm font-medium">Experiment design, execution</p></div></div>
                <CheckRow muted>Accept, edit, or ignore every recommendation.</CheckRow>
              </div>
            </Card>
          </div>
        </section>

        <section id="panel" className="border-y bg-card/35">
          <div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
            <div className="grid gap-12 lg:grid-cols-[1fr_0.9fr] lg:items-center">
              <div className="relative min-h-[22rem] overflow-hidden rounded-xl border bg-background p-5">
                <div className="absolute inset-0 surface-grid opacity-40" aria-hidden="true" />
                <div className="relative space-y-4">
                  {[0, 2, 0, 1].map((personIndex, index) => { const person = defaultPanelists[personIndex]; return <div key={`${person.id}-${index}`} className={`flex items-center gap-3 rounded-lg border bg-card p-3 ${index === 2 ? "ms-10" : index === 3 ? "ms-20" : ""}`}><Avatar initials={person.initials} active={index === 2} /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{person.name}</p><p className="truncate text-xs text-muted-foreground">{index === 0 ? "opens product strategy" : index === 1 ? "tests the metric choice" : index === 2 ? "returns to challenge the new claim" : "follows the quantitative gap"}</p></div><ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" /></div>; })}
                </div>
              </div>
              <div><h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">A panel, not a queue.</h2><p className="mt-4 text-base leading-7 text-muted-foreground">There is no fixed handoff. A silent director considers context, coverage, contradictions, and urgency after every answer, then selects one speaker.</p><div className="mt-7 space-y-3"><CheckRow>Panelist 1 can return after panelist 3.</CheckRow><CheckRow>Only one interviewer speaks at a time.</CheckRow><CheckRow>Every panelist shares the same evidence memory.</CheckRow></div></div>
            </div>
          </div>
        </section>

        <section id="assessment" className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:py-32">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div><ShieldCheck className="size-7 text-primary" aria-hidden="true" /><h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">If the transcript does not prove it, the report does not score it.</h2><p className="mt-4 leading-7 text-muted-foreground">Every competency links to the candidate turns that support the assessment. Uncovered areas are marked insufficient evidence and become replay drills.</p><Button variant="secondary" asChild className="mt-7"><Link href="/reports/demo">Explore the report<ArrowRight aria-hidden="true" /></Link></Button></div>
            <Card className="p-5 sm:p-7">
              <div className="flex items-end justify-between"><div><p className="text-sm text-muted-foreground">Overall readiness</p><p className="mt-1 text-5xl font-semibold tracking-tight">81<span className="text-xl text-muted-foreground">/100</span></p></div><Badge variant="default">Strong signal</Badge></div>
              <Separator className="my-6" />
              <div className="space-y-5">{[["Product judgment",82,"turn-02, turn-08"],["Analytical thinking",74,"turn-04, turn-11"],["Execution",null,"insufficient evidence"]].map(([name, score, evidence]) => <div key={String(name)} className="grid grid-cols-[1fr_auto] gap-4"><div><p className="text-sm font-medium">{name}</p><p className="mt-1 font-mono text-[11px] text-muted-foreground">{evidence}</p></div><span className={`font-mono text-sm ${score === null ? "text-muted-foreground" : "text-foreground"}`}>{score === null ? "N/A" : score}</span></div>)}</div>
            </Card>
          </div>
        </section>

        <section className="px-4 pb-24 sm:px-6 lg:pb-32">
          <div className="mx-auto max-w-7xl rounded-xl border bg-card px-6 py-12 text-center sm:px-10 sm:py-16"><h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Make the real interview feel familiar.</h2><p className="mx-auto mt-3 max-w-xl text-muted-foreground">Build a panel in minutes, then practice until your evidence is sharper than the pressure.</p><Button size="lg" asChild className="mt-7"><Link href="/auth/sign-up?next=%2Fsetup">Start a mock interview<ArrowRight aria-hidden="true" /></Link></Button></div>
        </section>
      </main>

      <footer className="border-t"><div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-6"><Brand href="/" /><p>Adaptive mock interviews powered by Agora.</p><div className="sm:ms-auto flex gap-5"><a href="#how-it-works" className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Product</a><Link href="/auth/sign-up?next=%2Fsettings" className="rounded-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">Privacy</Link></div></div></footer>
    </div>
  );
}
