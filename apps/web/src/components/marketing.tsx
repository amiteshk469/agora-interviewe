import Image from "next/image";
import Link from "next/link";
import { ArrowRight, AudioLines, Braces, FileText, UsersRound } from "lucide-react";
import { Brand } from "@/components/app-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui";

const candidateSignup = "/auth/sign-up?audience=candidate&next=%2Fcandidate";
const recruiterSignup = "/auth/sign-up?audience=recruiter&next=%2Frecruiter";

const paths = [
  {
    label: "For candidates", title: "Walk in a little more ready.",
    description: "Practice for the role you actually want. An AI panel asks questions, follows your reasoning, and helps you find what to work on next.",
    steps: ["Choose your role and add your CV or job description.", "Shape your panel with editable prompts and personalities.", "Practice out loud, solve coding tasks, and review your evidence."],
    action: "Start practicing", href: candidateSignup,
  },
  {
    label: "For recruiters", title: "Be in the conversation.",
    description: "Create a role-specific interview, invite a candidate, and join the AI panel yourself. Your own hiring workspace, with the room to run it your way.",
    steps: ["Set the role, interview prompts, and assessment criteria.", "Send an invitation and review the candidate’s CV.", "Join on voice or video, ask questions, and share coding tasks."],
    action: "Create an interview", href: recruiterSignup,
  },
] as const;

const capabilities = [
  { icon: AudioLines, title: "A conversation, not a questionnaire.", text: "Speak naturally and ask for clarification. The panel shares context and chooses the next interviewer based on your answer, not a fixed order." },
  { icon: UsersRound, title: "Your panel. Your point of view.", text: "Give each AI interviewer a different specialty and prompt. Invite a human interviewer to take part in the same voice and video room." },
  { icon: Braces, title: "Show the work as you do it.", text: "AI or human interviewers can open a coding task, share a written question, and offer hints. The code stays synchronized across the room." },
  { icon: FileText, title: "Keep the context in the room.", text: "Bring a CV and an optional job description. Interviewers can consult that context and use tools to look up information or check a calculation." },
] as const;

function Eyebrow({ children }: { children: string }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{children}</p>;
}

export function MarketingPage() {
  return (
    <div className="landing-shell min-h-dvh bg-background text-foreground">
      <a href="#marketing-main" className="sr-only z-50 bg-primary px-4 py-3 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4">Skip to content</a>
      <header className="landing-header-skin border-b border-foreground/10">
        <nav className="mx-auto flex h-20 max-w-7xl items-center gap-10 px-5 sm:px-8" aria-label="Main navigation">
          <Brand href="/" />
          <div className="hidden gap-7 text-sm text-muted-foreground lg:flex">
            <a href="#paths" className="landing-link">Who it’s for</a>
            <a href="#live-engine" className="landing-link">The interview</a>
            <a href="#evidence" className="landing-link">The feedback</a>
          </div>
          <div className="ms-auto flex items-center gap-2"><ThemeToggle /><Button variant="ghost" asChild className="px-3"><Link href="/auth/sign-in">Sign in<ArrowRight aria-hidden="true" /></Link></Button></div>
        </nav>
      </header>

      <main id="marketing-main">
        <section className="landing-hero-skin mx-auto grid max-w-7xl items-center gap-4 px-5 pb-12 pt-16 sm:px-8 sm:pt-20 lg:min-h-[43rem] lg:grid-cols-[1.12fr_1fr] lg:gap-3 lg:py-16">
          <div className="relative z-10">
            <Eyebrow>AI panel interviews. Human perspective.</Eyebrow>
            <h1 className="mt-7 max-w-2xl text-[clamp(3.3rem,6.3vw,5.7rem)] font-semibold leading-[0.99] tracking-[-0.065em]">Better interviews.<br /><span className="text-muted-foreground">On both sides.</span></h1>
            <p className="mt-7 max-w-lg text-lg leading-8 text-muted-foreground">Practice your next interview, or run one with your hiring team. RoundCraft brings a role-specific AI panel, human interviewers, and live coding into one room.</p>
            <div className="mt-9 flex flex-col gap-3 min-[420px]:flex-row"><Button size="lg" asChild className="landing-primary-cta"><Link href={candidateSignup}>I want to practice<ArrowRight aria-hidden="true" /></Link></Button><Button size="lg" variant="outline" asChild><Link href={recruiterSignup}>I’m interviewing<ArrowRight aria-hidden="true" /></Link></Button></div>
            <p className="mt-5 text-xs leading-5 text-muted-foreground">Separate workspaces for candidates and recruiters. One shared conversation.</p>
          </div>
          <figure className="landing-sculpture relative mx-auto w-full max-w-[36rem] lg:-me-3">
            <Image src="/brand/conversation-sculpture-cutout.png" alt="Five abstract acoustic forms connected around an open coral conversation ring" width={1254} height={1254} sizes="(max-width: 1023px) 90vw, 550px" priority className="h-auto w-full" />
            <figcaption className="absolute inset-x-0 bottom-7 text-center font-mono text-[10px] tracking-[0.12em] text-[#525655]">DIFFERENT PERSPECTIVES. SHARED CONTEXT.</figcaption>
          </figure>
        </section>

        <div className="landing-capability-strip border-y border-foreground/10">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-6 text-xs text-muted-foreground sm:px-8 sm:text-sm">
            <p className="flex items-center gap-2 font-medium text-foreground"><AudioLines className="size-4 text-primary" aria-hidden="true" />Live voice & video powered by Agora</p>
            <p>CV & job context</p><p>Shared coding workspace</p><p>Transcript-linked assessment</p>
          </div>
        </div>

        <section id="paths" className="landing-paths-skin mx-auto max-w-7xl scroll-mt-8 px-5 py-20 sm:px-8 lg:py-28">
          <div className="mb-12 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><Eyebrow>Choose your side of the table</Eyebrow><h2 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-5xl">One room. Two ways in.</h2></div><p className="max-w-xs text-sm leading-6 text-muted-foreground">Prepare on your own, or bring people together for a real interview.</p></div>
          <div className="grid gap-10 border-t border-foreground/15 lg:grid-cols-2 lg:gap-0">
            {paths.map((path, index) => (
              <article key={path.label} className={`landing-audience ${index === 0 ? "pt-9 lg:pe-14" : "border-t border-foreground/15 pt-9 lg:border-s lg:border-t-0 lg:ps-14"}`}>
                <div className="landing-audience-art" aria-hidden="true"><span>{index === 0 ? "Practice." : "Interview."}</span><span className="landing-seat-ring" /></div><p className="text-sm font-medium text-primary">{path.label}</p>
                <h3 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">{path.title}</h3>
                <p className="mt-4 max-w-lg leading-7 text-muted-foreground">{path.description}</p>
                <ol className="mt-7 space-y-4">{path.steps.map((step, i) => <li key={step} className="flex gap-4 text-sm leading-6"><span className="font-mono text-xs leading-6 text-primary">0{i + 1}</span><span>{step}</span></li>)}</ol>
                <Link href={path.href} className="landing-link mt-8 inline-flex min-h-11 items-center gap-3 border-b border-foreground/35 font-medium">{path.action}<ArrowRight className="size-4" aria-hidden="true" /></Link>
              </article>
            ))}
          </div>
        </section>

        <section id="live-engine" className="landing-inset-surface scroll-mt-8 border-y border-foreground/10 bg-card/60">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-24 lg:py-28">
            <div><Eyebrow>Inside the interview</Eyebrow><h2 className="mt-5 max-w-sm text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl">Room to think.<br />Room to go deeper.</h2><p className="mt-6 max-w-sm leading-7 text-muted-foreground">A useful follow-up starts with listening. Your panel has distinct specialties, shared memory, and tools to explore the answer with you.</p><p className="mt-8 max-w-sm border-s-2 border-primary ps-4 text-sm leading-6 text-muted-foreground">Choose Balanced for a conversational pace, or Let me finish for more time to form your answer.</p><figure className="landing-listening-art" aria-label="Listening, context, and follow-up form one continuous conversation"><span className="landing-listening-ring" aria-hidden="true" /><span className="landing-listening-ring" aria-hidden="true" /><span className="landing-listening-ring" aria-hidden="true" /><figcaption><span>Listen.</span><span>Understand.</span><span>Ask again.</span></figcaption></figure></div>
            <div className="divide-y divide-foreground/10">{capabilities.map(({ icon: Icon, title, text }) => <article key={title} className="flex gap-5 py-7 first:pt-0 last:pb-0"><Icon className="mt-1 size-5 shrink-0 text-primary" aria-hidden="true" /><div><h3 className="text-lg font-semibold tracking-tight">{title}</h3><p className="mt-3 max-w-xl text-sm leading-7 text-muted-foreground">{text}</p></div></article>)}</div>
          </div>
        </section>

        <section id="evidence" className="landing-evidence-skin mx-auto grid max-w-7xl scroll-mt-8 gap-12 px-5 py-20 sm:px-8 lg:grid-cols-2 lg:items-center lg:gap-24 lg:py-28">
          <div><Eyebrow>After the conversation</Eyebrow><h2 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-[-0.045em] sm:text-5xl">Feedback you can<br />trace to an answer.</h2><p className="mt-6 max-w-lg leading-7 text-muted-foreground">See the transcript behind the assessment, the tools used, and the code you wrote. When there isn’t enough evidence to assess a skill, the report says so.</p><Link href="/reports/demo" className="landing-link mt-7 inline-flex min-h-11 items-center gap-3 border-b border-foreground/35 font-medium">Explore a sample report<ArrowRight className="size-4" aria-hidden="true" /></Link></div>
          <div className="landing-evidence-trail"><figure className="landing-answer-example"><figcaption>Illustrative interview answer</figcaption><blockquote>“I’d measure retention, <mark>then check whether the change holds across different user groups.</mark>”</blockquote><p>A metric. A hypothesis. A reason to follow up.</p></figure>
            {[
              ["The answer", "Revisit the candidate’s own words in the final transcript."],
              ["The reasoning", "Understand which competency the evidence supports and why."],
              ["The next step", "Turn gaps into focused practice instead of guessing what to improve."],
            ].map(([title, text], i) => <div key={title} className="grid grid-cols-[2rem_1fr] gap-4 border-b border-foreground/10 py-7 last:border-b-0"><span className="font-mono text-xs leading-7 text-primary">0{i + 1}</span><div><h3 className="text-lg font-medium">{title}</h3><p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p></div></div>)}
          </div>
        </section>

        <section className="landing-closing-skin landing-closing-statement border-t border-foreground/10 bg-card/60 px-5 py-16 sm:px-8 lg:py-20"><div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 lg:flex-row lg:items-center"><div><p className="text-sm text-muted-foreground">Your next conversation starts here.</p><h2 className="mt-3 text-[clamp(3.5rem,8vw,7.5rem)] font-semibold leading-none tracking-[-0.065em]">Take your seat.</h2></div><div className="flex flex-col gap-3 sm:flex-row"><Button size="lg" asChild className="landing-primary-cta"><Link href={candidateSignup}>Start practicing<ArrowRight aria-hidden="true" /></Link></Button><Button size="lg" variant="outline" asChild><Link href={recruiterSignup}>Create an interview<ArrowRight aria-hidden="true" /></Link></Button></div></div></section>
      </main>
      <footer className="border-t border-foreground/10"><div className="mx-auto flex max-w-7xl flex-col gap-5 px-5 py-8 sm:flex-row sm:items-center sm:px-8"><Brand href="/" /><p className="text-xs text-muted-foreground sm:ms-auto">AI-assisted interviews for practice and hiring.</p><Link href="/auth/sign-in" className="landing-link min-h-11 content-center text-sm">Sign in</Link></div></footer>
    </div>
  );
}
