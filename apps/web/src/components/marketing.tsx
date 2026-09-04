import Image from "next/image";
import Link from "next/link";
import {
  ArrowDownRight,
  ArrowRight,
  Check,
  FileCheck2,
  FileText,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { Brand } from "@/components/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Badge, Button } from "@/components/ui";

const candidateSignup = "/auth/sign-up?audience=candidate&next=%2Fcandidate";
const recruiterSignup = "/auth/sign-up?audience=recruiter&next=%2Frecruiter";

function EditorialIndex({ children }: { children: string }) {
  return <span className="font-mono text-xs tracking-[0.16em] text-muted-foreground">{children}</span>;
}

function CandidateDocument() {
  return (
    <div className="landing-document relative mx-auto aspect-[4/3] w-full max-w-xl" aria-hidden="true">
      <div className="absolute inset-x-[13%] inset-y-[7%] rotate-[-4deg] border border-foreground/18 bg-background" />
      <div className="absolute inset-x-[8%] inset-y-[4%] rotate-[2deg] border border-foreground/25 bg-card" />
      <div className="absolute inset-x-[18%] inset-y-0 border border-foreground/40 bg-background p-[8%] shadow-[0_28px_65px_rgb(0_0_0/0.12)]">
        <div className="flex items-center justify-between border-b border-foreground/20 pb-4"><span className="font-mono text-[10px] tracking-[0.14em]">CANDIDATE CONTEXT</span><FileCheck2 className="size-4 text-primary" /></div>
        <p className="mt-8 text-2xl font-semibold leading-tight sm:text-3xl">Bring the role.<br />Bring your CV.</p>
        <div className="mt-10 space-y-3"><span className="block h-px w-full bg-foreground/20" /><span className="block h-px w-[82%] bg-foreground/20" /><span className="block h-px w-[65%] bg-foreground/20" /></div>
        <div className="mt-9 flex gap-2"><span className="border border-primary/35 px-2 py-1 font-mono text-[9px] text-primary">ROLE MATCHED</span><span className="border border-foreground/20 px-2 py-1 font-mono text-[9px]">PRIVATE</span></div>
      </div>
    </div>
  );
}

function RecruiterRoom() {
  const seats = ["Hiring", "Domain", "Bar raiser", "Human"];
  return (
    <div className="mx-auto w-full max-w-xl border border-white/25 bg-[#111313] p-4 text-white shadow-[0_32px_75px_rgb(0_0_0/0.28)]" aria-hidden="true">
      <div className="flex items-center justify-between border-b border-white/15 pb-3"><span className="font-mono text-[10px] tracking-[0.14em] text-white/60">LIVE INTERVIEW ROOM</span><span className="flex items-center gap-2 text-[10px] text-white/60"><span className="size-1.5 rounded-full bg-[#f04432]" /> Agora live</span></div>
      <div className="grid grid-cols-2 gap-2 py-4">
        {seats.map((seat, index) => <div key={seat} className={`min-h-28 border p-3 ${index === 1 ? "border-[#f04432] bg-[#f04432]/10" : "border-white/15 bg-white/[0.035]"}`}><span className={`grid size-8 place-items-center rounded-full border font-mono text-[10px] ${index === 1 ? "border-[#f04432] text-[#ff7668]" : "border-white/20 text-white/65"}`}>{seat.slice(0, 2).toUpperCase()}</span><p className="mt-7 text-xs font-medium">{seat}</p><p className="mt-1 text-[10px] text-white/45">{index === 3 ? "You, in the room" : index === 1 ? "Speaking now" : "Following context"}</p></div>)}
      </div>
      <div className="flex items-center justify-between border-t border-white/15 pt-3"><span className="text-[11px] text-white/55">Candidate CV and live evidence open</span><span className="font-mono text-[10px] text-[#ff7668]">LIVE 18:42</span></div>
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
          <div className="hidden items-center gap-7 text-sm md:flex"><a href="#candidates" className="landing-link">Candidates</a><a href="#recruiters" className="landing-link">Recruiters</a><a href="#how-it-works" className="landing-link">How it works</a><a href="#evidence" className="landing-link">Evidence</a></div>
          <div className="ms-auto flex items-center gap-1 sm:gap-2"><ThemeToggle /><Button variant="ghost" asChild className="hidden sm:inline-flex"><Link href="/auth/sign-in">Sign in</Link></Button><Button asChild><Link href="/auth/sign-up">Get started<ArrowRight aria-hidden="true" /></Link></Button></div>
        </nav>
      </header>

      <main id="marketing-main">
        <section className="landing-hero relative flex min-h-[min(58rem,100dvh)] items-center border-b border-foreground/10 pt-16">
          <div className="mx-auto w-full max-w-[94rem] px-5 pb-8 pt-12 sm:px-8 lg:pb-20 lg:pt-20">
            <Badge variant="outline" className="enter rounded-none border-foreground/20 bg-background/75"><Sparkles className="size-3" aria-hidden="true" />One adaptive interview engine. Two serious workflows.</Badge>
            <div className="relative mt-7 min-h-[26rem] sm:min-h-[20rem] lg:min-h-[37rem]">
              <h1 className="landing-display relative z-10 max-w-[89rem] text-[clamp(4.2rem,10.2vw,10.5rem)] font-semibold leading-[0.82] tracking-[-0.075em]">The next question<br /><span className="ms-[0.02em]">is never random.</span></h1>
              <div className="landing-signal pointer-events-none absolute inset-x-[-13rem] top-[7.4rem] z-20 sm:top-[7rem] lg:top-[10.6rem]" aria-hidden="true">
                <div className="relative mx-auto w-[58rem] max-w-none lg:w-full">
                  <Image src="/brand/landing-acoustic-path.png" alt="" width={1800} height={500} priority className="h-auto w-full" />
                  <span className="absolute left-[15%] top-[19%] font-mono text-[10px] text-primary sm:text-xs">Leah</span>
                  <span className="absolute left-[31%] top-[75%] font-mono text-[10px] text-primary sm:text-xs">Marcus</span>
                  <span className="absolute left-[49%] top-[4%] font-mono text-[10px] text-primary sm:text-xs">Priya</span>
                  <span className="absolute left-[67%] top-[76%] font-mono text-[10px] text-primary sm:text-xs">Jordan</span>
                  <span className="absolute left-[84%] top-[24%] font-mono text-[10px] text-primary sm:text-xs">Ravi</span>
                </div>
              </div>
              <div className="landing-transcript absolute left-[43%] top-[48%] z-30 hidden w-80 border border-white/15 bg-[#0b0d0d] px-5 py-4 font-mono text-[12px] leading-5 text-white shadow-2xl lg:block"><span className="text-[#ff7668]">Priya › </span>You called pulse feedback a guardrail. Why is it not the outcome itself?<span className="ms-1 inline-block h-4 w-0.5 animate-pulse bg-[#f04432] align-middle" /></div>
            </div>
            <div className="relative z-30 mt-3 grid gap-7 border-t border-foreground/15 pt-6 lg:grid-cols-[1fr_auto] lg:items-end">
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">Practice with an adaptive AI panel, or run structured interviews with AI beside you. Both paths share context, react live, and turn the transcript into evidence.</p>
              <div className="flex flex-col gap-3 sm:flex-row"><Button size="lg" asChild><Link href={candidateSignup}>Practice an interview<ArrowRight aria-hidden="true" /></Link></Button><Button size="lg" variant="secondary" asChild><Link href={recruiterSignup}>Run an interview<ArrowRight aria-hidden="true" /></Link></Button></div>
            </div>
          </div>
        </section>

        <section id="candidates" className="border-b border-foreground/10">
          <div className="mx-auto grid max-w-[94rem] gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-32">
            <div className="max-w-xl"><EditorialIndex>01 / CANDIDATE PRACTICE</EditorialIndex><h2 className="mt-6 text-5xl font-semibold leading-[0.92] tracking-[-0.055em] sm:text-7xl">Prepare for<br />the role.</h2><p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">Add your CV and an optional job description. RoundCraft builds a role-matched panel, adapts every follow-up, opens a coding workspace when needed, and leaves you with evidence you can replay.</p><div className="mt-8 grid gap-3 text-sm sm:grid-cols-2"><p className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />Private CV and job context</p><p className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />2 to 5 configurable interviewers</p><p className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />Live interruption and shared memory</p><p className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-primary" />Transcript-linked assessment</p></div><Button asChild size="lg" className="mt-9"><Link href={candidateSignup}>Start practicing<ArrowRight aria-hidden="true" /></Link></Button></div>
            <CandidateDocument />
          </div>
        </section>

        <section id="recruiters" className="bg-[#0d0f0f] text-[#f5f5f1]">
          <div className="mx-auto grid max-w-[94rem] gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-32">
            <RecruiterRoom />
            <div className="max-w-xl lg:justify-self-end"><span className="font-mono text-xs tracking-[0.16em] text-white/45">02 / RECRUITER WORKSPACE</span><h2 className="mt-6 text-5xl font-semibold leading-[0.92] tracking-[-0.055em] sm:text-7xl">Build the<br />room.</h2><p className="mt-7 max-w-lg text-lg leading-8 text-white/58">Create the interview, configure the panel, and send one candidate link. Join the same video grid, see the candidate CV, open live coding tasks, ask through the panel, and finish with structured evidence.</p><div className="mt-9 flex flex-col gap-3 sm:flex-row"><Button size="lg" asChild><Link href={recruiterSignup}>Create recruiter workspace<ArrowRight aria-hidden="true" /></Link></Button><Button size="lg" variant="ghost" asChild className="text-white hover:bg-white/10 hover:text-white"><a href="#how-it-works">See the workflow<ArrowDownRight aria-hidden="true" /></a></Button></div></div>
          </div>
        </section>

        <section id="how-it-works" className="border-b border-foreground/10">
          <div className="mx-auto max-w-[94rem] px-5 py-24 sm:px-8 lg:py-32">
            <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]"><div><EditorialIndex>03 / ONE ENGINE</EditorialIndex><h2 className="mt-6 text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-6xl">Different owners.<br />The same live intelligence.</h2></div><div className="grid border-t border-foreground/20 sm:grid-cols-2">{[
              ["01", "Configure context", "Choose a role, attach the JD, add a CV, then tune the panel and its prompts."],
              ["02", "Enter one room", "AI interviewers, candidate, and an optional human interviewer meet in the same Agora channel."],
              ["03", "React, do not rotate", "A shared director chooses the strongest next question from the full conversation."],
              ["04", "Prove the result", "Every score cites final transcript turns. Missing signals become focused replay drills."],
            ].map(([index, title, text]) => <article key={index} className="border-b border-foreground/20 py-7 sm:min-h-52 sm:p-7 sm:odd:border-e"><span className="font-mono text-xs text-primary">{index}</span><h3 className="mt-8 text-xl font-semibold">{title}</h3><p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">{text}</p></article>)}</div></div>
          </div>
        </section>

        <section id="evidence" className="mx-auto grid max-w-[94rem] gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-center lg:py-32">
          <div><ShieldCheck className="size-7 text-primary" aria-hidden="true" /><h2 className="mt-7 text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-6xl">No evidence.<br />No score.</h2><p className="mt-6 max-w-lg text-lg leading-8 text-muted-foreground">RoundCraft does not turn confidence into a grade. Candidate claims, interviewer probes, coding work, and tool activity stay tied to the final transcript.</p><Button variant="secondary" size="lg" asChild className="mt-8"><Link href="/reports/demo">Open a sample assessment<ArrowRight aria-hidden="true" /></Link></Button></div>
          <div className="border-y border-foreground/25">{[
            ["Product judgment", "82", "turn 04, turn 11"],
            ["Analytical thinking", "74", "turn 07, tool 02"],
            ["Execution", "N/A", "insufficient evidence"],
          ].map(([label, score, source]) => <div key={label} className="grid grid-cols-[1fr_auto] items-center gap-6 border-b border-foreground/15 py-7 last:border-b-0"><div><p className="text-lg font-medium">{label}</p><p className="mt-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{source}</p></div><p className="text-5xl font-semibold tracking-[-0.05em]">{score}</p></div>)}</div>
        </section>

        <section className="border-t border-foreground/10 px-5 py-20 sm:px-8">
          <div className="mx-auto flex max-w-[94rem] flex-col gap-8 lg:flex-row lg:items-end lg:justify-between"><div><EditorialIndex>YOUR NEXT ROUND</EditorialIndex><h2 className="mt-5 max-w-4xl text-5xl font-semibold leading-[0.94] tracking-[-0.055em] sm:text-7xl">Choose which side<br />of the table you own.</h2></div><div className="flex flex-col gap-3 sm:flex-row"><Button size="lg" asChild><Link href={candidateSignup}><FileText aria-hidden="true" />Candidate practice</Link></Button><Button size="lg" variant="secondary" asChild><Link href={recruiterSignup}><UsersRound aria-hidden="true" />Recruiter workspace</Link></Button></div></div>
        </section>
      </main>

      <footer className="border-t border-foreground/10"><div className="mx-auto flex max-w-[94rem] flex-col gap-5 px-5 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:px-8"><Brand href="/" /><p>Adaptive interviews for practice and hiring, powered by Agora.</p><div className="flex gap-5 sm:ms-auto"><a href="#candidates" className="landing-link">Candidates</a><a href="#recruiters" className="landing-link">Recruiters</a><Link href="/auth/sign-in" className="landing-link">Sign in</Link></div></div></footer>
    </div>
  );
}
