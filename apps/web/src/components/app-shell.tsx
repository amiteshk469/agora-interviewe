"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BookOpenText,
  ChevronDown,
  Clock3,
  Command,
  FileClock,
  LayoutDashboard,
  Menu,
  Plus,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button, Input, Separator } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { demoModeEnabled } from "@/lib/api";

const nav = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/history", label: "History", icon: FileClock },
  { href: "/replay", label: "Replay drills", icon: Clock3 },
  { href: "/prompts", label: "Prompt library", icon: BookOpenText },
];

function NavLinks({ screen, onNavigate }: { screen: string; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1" aria-label="Workspace">
      {nav.map((item) => {
        const active = screen === item.href.slice(1) || screen.startsWith(`${item.href.slice(1)}/`);
        const Icon = item.icon;
        return (
          <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", active && "bg-accent text-foreground")}>
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Brand({ compact = false, stacked = false }: { compact?: boolean; stacked?: boolean }) {
  return (
    <Link href="/dashboard" className={cn("inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring", stacked && "flex-col gap-1.5 text-center")} aria-label="RoundCraft dashboard">
      <span className={cn("relative size-8 shrink-0", stacked && "size-16")} aria-hidden="true">
        <Image src="/brand/roundcraft-mark-light.png" alt="" fill sizes={stacked ? "64px" : "32px"} className="object-contain theme-light-only" priority />
        <Image src="/brand/roundcraft-mark-dark.png" alt="" fill sizes={stacked ? "64px" : "32px"} className="object-contain theme-dark-only" priority />
      </span>
      {compact ? null : <span className={cn("font-semibold tracking-tight", stacked && "text-base")}>RoundCraft</span>}
    </Link>
  );
}

export function AppShell({ screen, title, description, actions, children }: { screen: string; title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div className="min-h-[100dvh] bg-background">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4">Skip to content</a>
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 border-e bg-card/60 p-3 backdrop-blur md:flex md:flex-col">
        <div className="px-2 py-2"><Brand /></div>
        <Button asChild className="mt-4 w-full"><Link href="/setup"><Plus aria-hidden="true" />New interview</Link></Button>
        <div className="mt-6 flex-1"><NavLinks screen={screen} /></div>
        <div className="space-y-1">
          <Link href="/settings" className={cn("flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground", screen === "settings" && "bg-accent text-foreground")}><Settings className="size-4" aria-hidden="true" />Settings</Link>
          <Separator className="my-3" />
          <button className="flex w-full items-center gap-3 rounded-md p-2 text-start hover:bg-accent" type="button" aria-label="Open account menu">
            <Avatar initials="AK" />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">Amitesh Kumar</span><span className="block truncate text-xs text-muted-foreground">RoundCraft learner</span></span>
            <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
          </button>
        </div>
      </aside>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div className="h-full w-[min(19rem,86vw)] border-e bg-card p-4 shadow-2xl">
            <div className="flex items-center justify-between"><Brand /><Button variant="ghost" size="icon" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X aria-hidden="true" /></Button></div>
            <Button asChild className="mt-6 w-full"><Link href="/setup" onClick={() => setMenuOpen(false)}><Plus aria-hidden="true" />New interview</Link></Button>
            <div className="mt-6"><NavLinks screen={screen} onNavigate={() => setMenuOpen(false)} /></div>
          </div>
        </div>
      ) : null}

      <div className="md:ps-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/88 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu aria-hidden="true" /></Button>
          <div className="relative hidden max-w-sm flex-1 sm:block">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input className="h-9 ps-9 pe-16" placeholder="Search interviews…" aria-label="Search interviews" />
            <span className="pointer-events-none absolute end-2 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"><Command className="size-3" />K</span>
          </div>
          <div className="ms-auto flex items-center gap-2"><Badge variant="outline"><Sparkles className="size-3" aria-hidden="true" />{demoModeEnabled ? "Demo workspace" : "Live workspace"}</Badge><ThemeToggle /><Avatar initials="AK" className="size-8 md:hidden" /></div>
        </header>
        <main id="main-content" className="px-4 py-6 pb-24 sm:px-6 lg:px-8 md:pb-10">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>{description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}</div>
              {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            </div>
            {children}
          </div>
        </main>
      </div>

      <nav className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 rounded-xl border bg-card/95 p-1 shadow-xl backdrop-blur md:hidden" aria-label="Mobile workspace">
        {nav.slice(0, 4).map((item) => { const Icon = item.icon; const active = screen === item.href.slice(1); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] text-muted-foreground", active && "bg-accent text-foreground")}><Icon className="size-4" aria-hidden="true" />{item.label.replace("Prompt library", "Prompts").replace("Replay drills", "Replay")}</Link>; })}
        <Link href="/setup" className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg bg-primary text-[10px] font-medium text-primary-foreground"><Plus className="size-4" aria-hidden="true" />New</Link>
      </nav>
    </div>
  );
}
