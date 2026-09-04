import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  AudioLines,
  Braces,
  Check,
  FileText,
  Radio,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  UsersRound,
  Video,
} from "lucide-react";
import { Brand } from "@/components/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Button } from "@/components/ui";

const candidateSignup = "/auth/sign-up?audience=candidate&next=%2Fcandidate";
const recruiterSignup = "/auth/sign-up?audience=recruiter&next=%2Frecruiter";

const candidateFlow = [
  ["Bring context", "Choose a target role, upload your CV, and optionally add the job description."],
  ["Build the panel", "Select 2 to 5 interviewers, start from proven prompts, then edit their expertise and behavior."],
  ["Practice live", "Speak, interrupt, code, and answer adaptive follow-ups in one Agora room."],
  ["Replay evidence", "See the transcript behind every score and practice only the signals you missed."],
] as const;

const recruiterFlow = [
  ["Define the role", "Add the position, job description, CV requirements, rubric, and interview plan."],
  ["Invite the candidate", "Send one protected link. The candidate can add a CV before entering the room."],
  ["Interview together", "Join beside the AI panel, speak on camera, ask through the panel, and open a shared coding task."],
  ["Review consistently", "Use the same transcript, tool trail, code, and linked evidence for the final assessment."],
] as const;

const liveCapabilities = [
  [AudioLines, "Natural voice conversation", "Agora carries low-latency audio while the panel listens and responds."],
  [Radio, "Real interruption handling", "A candidate can barge in, and any interviewer can return when context calls for it."],
  [UsersRound, "AI and humans together", "AI panelists and an invited human interviewer share the same interview state."],
  [Video, "Human video grid", "Candidate and human interviewer cameras appear in the room; AI panelists stay minimal and identifiable."],
  [Braces, "Synchronized coding", "An interviewer can open a task on the candidate’s screen and watch the same code update."],
  [ScanSearch, "Interview tools", "Panelists can search role context, calculate, bookmark evidence, and launch focused drills."],
] as const;

function SectionLabel({ children }: { children: string }) {
  return <p className="flex items-center gap-2 text-sm font-medium text-primary"><span className="size-1.5 rounded-full bg-current" />{children}</p>;
}

function FlowList({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <ol className="mt-10 border-t border-foreground/20">
      {items.map(([title, description]) => (
        <li key={title} className="grid gap-2 border-b border-foreground/15 py-5 sm:grid-cols-[9rem_1fr] sm:gap-6">
          <p className="font-medium">{title}</p>
          <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        </li>
      ))}
    </ol>
  );
}

function EvidenceChain() {
  return (
    <div className="landing-evidence-window border border-foreground/20 bg-card shadow-[0_28px_70px_rgb(0_0_0/0.12)]" aria-label="Illustration of a transcript-linked assessment">
      <div className="flex items-center justify-between border-b border-foreground/15 px-4 py-3 sm:px-5">
        <p className="text-sm font-medium">Evidence trail</p>
        <Badge variant="outline"><ShieldCheck className="size-3" aria-hidden="true" />Source linked</Badge>
      </div>
      <div className="grid sm:grid-cols-[1.1fr_0.9fr]">
        <div className="border-b border-foreground/15 p-5 sm:border-b-0 sm:border-e">
          <p className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground">CANDIDATE · TURN 08</p>
          <blockquote className="mt-5 text-xl font-medium leading-8 tracking-[-0.02em]">“I would test the smallest reversible launch, with activation as the lead signal and retention as the guardrail.”</blockquote>
          <div className="mt-7 flex flex-wrap gap-2"><Badge>Decision quality</Badge><Badge variant="outline">Analytical thinking</Badge></div>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-muted-foreground">Why it matters</p>
          <p className="mt-3 text-sm leading-6">The answer names a tradeoff, a reversible decision, and measurable signals. The assessment links back here instead of guessing from tone.</p>
          <div className="mt-8 border-t border-foreground/15 pt-4">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5 text-primary" aria-hidden="true" />Final transcript turn</p>
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5 text-primary" aria-hidden="true" />Competency and rationale attached</p>
            <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Check className="size-3.5 text-primary" aria-hidden="true" />Ready for replay or review</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MarketingPage() {
  return (
    <div className="landing-shell min-h-[100dvh] overflow-hidden bg-background">
      <a href="#marketing-main" className="sr-only z-50 bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4">Skip to content</a>
      <header className="fixed inset-x-0 top-0 z-40 border-b border-foreground/10 bg-background/90 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-[94rem] items-center gap-8 px-5 sm:px-8" aria-label="Main navigation">
          <Brand href="/" />
          <div className="hidden items-center gap-7 text-sm md:flex"><a href="#paths" className="landing-link">Use cases</a><a href="#live-engine" className="landing-link">Live engine</a><a href="#evidence" className="landing-link">Assessment</a></div>
          <div className="ms-auto flex min-w-0 items-center gap-1 sm:gap-2"><ThemeToggle /><Button variant="ghost" asChild className="hidden sm:inline-flex"><Link href="/auth/sign-in">Sign in</Link></Button><Button asChild><Link href="/auth/sign-up"><span className="sm:hidden">Start</span><span className="hidden sm:inline">Get started</span><ArrowRight aria-hidden="true" /></Link></Button></div>
        </nav>
      </header>

      <main id="marketing-main">
        <section className="landing-hero relative flex min-h-[min(61rem,100dvh)] items-center overflow-hidden border-b border-foreground/10 pt-16">
          <div className="mx-auto min-w-0 w-full max-w-[94rem] px-5 pb-10 pt-12 sm:px-8 lg:pb-16 lg:pt-20">
            <Badge variant="outline" className="enter rounded-none border-foreground/20 bg-background/80"><Sparkles className="size-3" aria-hidden="true" />Live AI panel interviews for practice and hiring</Badge>
            <div className="relative mt-7 min-h-[25rem] sm:min-h-[21rem] lg:min-h-[20rem]">
              <h1 className="landing-display relative z-10 max-w-full text-[clamp(3.1rem,13.5vw,4rem)] font-semibold leading-[0.82] tracking-[-0.075em] sm:max-w-[89rem] sm:text-[clamp(4rem,10.1vw,10.25rem)]">The next question<br /><span className="ms-[0.02em]">is never random.</span></h1>
              <div className="landing-signal pointer-events-none absolute inset-x-[-13rem] top-[7.2rem] z-20 sm:top-[6.9rem] lg:top-[10.4rem]" aria-hidden="true">
                <div className="relative mx-auto w-[58rem] max-w-none lg:w-full">
                  <Image src="/brand/landing-acoustic-path.png" alt="" width={1800} height={500} priority className="h-auto w-full" />
                  <span className="absolute left-[15%] top-[19%] font-mono text-[10px] text-primary sm:text-xs">Lead</span>
                  <span className="absolute left-[31%] top-[75%] font-mono text-[10px] text-primary sm:text-xs">Domain</span>
                  <span className="absolute left-[49%] top-[4%] font-mono text-[10px] text-primary sm:text-xs">Hiring</span>
                  <span className="absolute left-[67%] top-[76%] font-mono text-[10px] text-primary sm:text-xs">Bar raiser</span>
                  <span className="absolute left-[84%] top-[24%] font-mono text-[10px] text-primary sm:text-xs">Human</span>
                </div>
              </div>
              <div className="landing-transcript absolute left-[45%] top-[70%] z-30 hidden w-80 border border-white/15 bg-[#0b0d0d] px-5 py-4 font-mono text-[12px] leading-5 text-white shadow-2xl lg:block"><span className="text-[#ff7668]">Domain › </span>Your guardrail moved. What changed in your reasoning?<span className="ms-1 inline-block h-4 w-0.5 animate-pulse bg-[#f04432] align-middle" /></div>
            </div>
            <div className="relative z-30 mt-4 grid gap-7 border-t border-foreground/15 bg-background/90 pt-6 backdrop-blur-sm lg:grid-cols-[1.15fr_0.85fr] lg:items-end lg:border lg:border-foreground/15 lg:p-5 lg:shadow-[0_20px_55px_rgb(0_0_0/0.1)]">
              <div>
                <p className="max-w-3xl text-xl font-medium leading-8 tracking-[-0.015em] sm:text-2xl">RoundCraft is one live interview platform for candidates who practice and hiring teams who interview.</p>
                <p className="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">Configure an adaptive AI panel, add a CV and job description, invite a human interviewer, solve live coding tasks, and receive an assessment that cites the exact transcript evidence.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:justify-end"><Button size="lg" asChild><Link href={candidateSignup}>Start practicing<ArrowRight aria-hidden="true" /></Link></Button><Button size="lg" variant="secondary" asChild><Link href={recruiterSignup}>Create interview<ArrowRight aria-hidden="true" /></Link></Button></div>
            </div>
          </div>
        </section>

        <section id="paths" className="border-b border-foreground/10">
          <div className="mx-auto max-w-[94rem] px-5 py-24 sm:px-8 lg:py-32">
            <div className="grid gap-8 border-b border-foreground/20 pb-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
              <div><SectionLabel>Two entry points</SectionLabel><h2 className="mt-5 text-5xl font-semibold leading-[0.94] tracking-[-0.055em] sm:text-7xl">Choose your side<br />of the room.</h2></div>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground lg:justify-self-end">Candidates own a private practice workspace. Recruiters own a separate hiring workspace. They meet only when an interview invitation brings them into the same live room.</p>
            </div>
            <div className="grid lg:grid-cols-2">
              <article className="py-12 lg:pe-12">
                <div className="flex items-start justify-between gap-6"><div><p className="text-sm text-muted-foreground">For candidates and students</p><h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Practice for a real role.</h3></div><FileText className="size-7 shrink-0 text-primary" aria-hidden="true" /></div>
                <p className="mt-5 max-w-xl leading-7 text-muted-foreground">Run a private mock interview yourself, or join a hiring team’s interview from their invitation.</p>
                <FlowList items={candidateFlow} />
                <Button size="lg" asChild className="mt-8"><Link href={candidateSignup}>Start practicing<ArrowRight aria-hidden="true" /></Link></Button>
              </article>
              <article className="border-t border-foreground/20 py-12 lg:border-s lg:border-t-0 lg:ps-12">
                <div className="flex items-start justify-between gap-6"><div><p className="text-sm text-muted-foreground">For recruiters and interviewers</p><h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Run a structured interview.</h3></div><UsersRound className="size-7 shrink-0 text-primary" aria-hidden="true" /></div>
                <p className="mt-5 max-w-xl leading-7 text-muted-foreground">Build the process, invite a candidate, and interview with AI panelists beside you.</p>
                <FlowList items={recruiterFlow} />
                <Button size="lg" variant="secondary" asChild className="mt-8"><Link href={recruiterSignup}>Create interview<ArrowRight aria-hidden="true" /></Link></Button>
              </article>
            </div>
          </div>
        </section>

        <section id="live-engine" className="border-b border-foreground/10">
          <div className="mx-auto max-w-[94rem] px-5 py-24 sm:px-8 lg:py-32">
            <div className="grid gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-end">
              <div><SectionLabel>One shared intelligence</SectionLabel><h2 className="mt-5 text-5xl font-semibold leading-[0.94] tracking-[-0.055em] sm:text-7xl">Everyone hears.<br />The panel remembers.</h2></div>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground lg:justify-self-end">This is not a scripted queue of agents. A shared director reads the conversation, competency coverage, contradictions, human requests, code, and tool results before choosing who should speak next.</p>
            </div>

            <figure className="landing-system-art mt-14 overflow-hidden border border-foreground/20 bg-[#f1ede4] shadow-[0_30px_85px_rgb(0_0_0/0.11)]">
              <Image src="/brand/roundcraft-system-map.webp" alt="Abstract system map showing candidate context and recruiter context flowing into one live conversation, then into several evidence records" width={1672} height={941} sizes="(max-width: 1536px) 100vw, 1504px" className="h-auto w-full" />
              <figcaption className="grid gap-2 border-t border-black/15 bg-[#f1ede4] px-5 py-4 text-[#252728] sm:grid-cols-[auto_1fr] sm:gap-8"><span className="font-medium">One continuous context</span><span className="text-sm text-black/60">Role, CV, JD, live voice, human input, coding, tools, and final evidence stay connected.</span></figcaption>
            </figure>

            <div className="mt-14 grid border-t border-foreground/20 sm:grid-cols-2 lg:grid-cols-3">
              {liveCapabilities.map(([Icon, title, description]) => (
                <article key={title} className="border-b border-foreground/15 py-7 sm:min-h-48 sm:p-7 sm:odd:border-e lg:border-e lg:[&:nth-child(3n)]:border-e-0">
                  <Icon className="size-5 text-primary" aria-hidden="true" />
                  <h3 className="mt-8 text-lg font-semibold">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-foreground/10">
          <div className="mx-auto max-w-[94rem] px-5 py-24 sm:px-8 lg:py-32">
            <div className="grid gap-10 lg:grid-cols-[0.65fr_1.35fr]">
              <div><SectionLabel>Before, live, after</SectionLabel><h2 className="mt-5 text-4xl font-semibold leading-[0.96] tracking-[-0.05em] sm:text-6xl">A complete interview loop.</h2></div>
              <div className="border-t border-foreground/20">
                {[
                  ["Before", "Context becomes the interview", "Target role, CV, optional JD, rubric, panel prompts, personalities, tools, and candidate invitation."],
                  ["Live", "The room adapts in real time", "Agora voice and video, interruptions, shared panel memory, human participation, synchronized coding, and visible tool activity."],
                  ["After", "Claims become reviewable evidence", "Final transcript turns, cited competencies, panel agreement, coding output, tool trail, assessment, and focused replay drills."],
                ].map(([stage, title, description]) => (
                  <article key={stage} className="grid gap-3 border-b border-foreground/20 py-8 sm:grid-cols-[7rem_13rem_1fr] sm:gap-8">
                    <p className="font-mono text-xs text-primary">{stage}</p><h3 className="font-semibold">{title}</h3><p className="text-sm leading-6 text-muted-foreground">{description}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="evidence" className="mx-auto grid max-w-[94rem] gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[0.7fr_1.3fr] lg:items-center lg:py-32">
          <div><SectionLabel>Assessment you can inspect</SectionLabel><h2 className="mt-5 text-5xl font-semibold leading-[0.94] tracking-[-0.055em] sm:text-7xl">No evidence.<br />No score.</h2><p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">RoundCraft separates confidence from proof. Every score must point to a final candidate turn. When evidence is weak or missing, the product says so and creates a focused practice drill.</p><Button variant="secondary" size="lg" asChild className="mt-9"><Link href="/reports/demo">View sample assessment<ArrowRight aria-hidden="true" /></Link></Button></div>
          <EvidenceChain />
        </section>

        <section className="border-t border-foreground/10 px-5 py-20 sm:px-8 lg:py-28">
          <div className="mx-auto grid max-w-[94rem] gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
            <div><SectionLabel>Your next interview</SectionLabel><h2 className="mt-5 max-w-5xl text-5xl font-semibold leading-[0.94] tracking-[-0.055em] sm:text-7xl">Practice it, or run it.<br />The room is ready.</h2></div>
            <div className="flex flex-col gap-3 sm:flex-row"><Button size="lg" asChild><Link href={candidateSignup}>Start practicing<ArrowRight aria-hidden="true" /></Link></Button><Button size="lg" variant="secondary" asChild><Link href={recruiterSignup}>Create interview<ArrowDownRight aria-hidden="true" /></Link></Button></div>
          </div>
        </section>
      </main>

      <footer className="border-t border-foreground/10"><div className="mx-auto flex max-w-[94rem] flex-col gap-5 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-8"><Brand href="/" /><p>Adaptive panel interviews for practice and hiring, powered by Agora.</p><div className="flex gap-5 sm:ms-auto"><a href="#paths" className="landing-link">Use cases</a><a href="#live-engine" className="landing-link">Live engine</a><Link href="/auth/sign-in" className="landing-link">Sign in</Link></div></div></footer>
    </div>
  );
}
