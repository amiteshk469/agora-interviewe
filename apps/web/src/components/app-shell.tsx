"use client";

import Image from "next/image";
import Link from "next/link";
import {
  BookOpenText,
  Clock3,
  FileClock,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { Avatar, Badge, Button, Separator } from "@/components/ui";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const candidateNav = [
  { href: "/candidate", label: "Overview", icon: LayoutDashboard },
  { href: "/history", label: "History", icon: FileClock },
  { href: "/replay", label: "Replay drills", icon: Clock3 },
  { href: "/prompts", label: "Prompt library", icon: BookOpenText },
];

const recruiterNav = [
  { href: "/recruiter", label: "Overview", icon: LayoutDashboard },
  { href: "/history", label: "Interviews", icon: FileClock },
  { href: "/prompts", label: "Prompt library", icon: BookOpenText },
];

function NavLinks({ screen, items, onNavigate }: { screen: string; items: typeof candidateNav; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1" aria-label="Workspace">
      {items.map((item) => {
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

export function Brand({ compact = false, stacked = false, href = "/dashboard" }: { compact?: boolean; stacked?: boolean; href?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring", stacked && "flex-col gap-1.5 text-center")} aria-label={href === "/" ? "RoundCraft home" : "RoundCraft dashboard"}>
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
  const [signingOut, setSigningOut] = useState(false);
  const menuDialogRef = useRef<HTMLDialogElement>(null);
  const closeMenuRef = useRef<HTMLButtonElement>(null);
  const openMenuRef = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const { accountType, displayName, initials, user, workspaceHome, signOut } = useAuth();
  const navigation = accountType === "recruiter" ? recruiterNav : candidateNav;
  const createPath = accountType === "recruiter" ? "/recruiter/interviews/new" : "/candidate/interviews/new";
  const newInterviewHref = user ? createPath : `/auth/sign-up?audience=${accountType}&next=${encodeURIComponent(createPath)}`;
  const settingsHref = user ? "/settings" : "/auth/sign-in?next=%2Fsettings";

  useEffect(() => {
    if (!menuOpen) return;
    const dialog = menuDialogRef.current;
    const openButton = openMenuRef.current;
    const desktop = window.matchMedia("(min-width: 768px)");
    const closeAtDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    if (dialog && !dialog.open) dialog.showModal();
    const focusTimer = window.setTimeout(() => closeMenuRef.current?.focus(), 0);
    desktop.addEventListener("change", closeAtDesktop);
    return () => {
      window.clearTimeout(focusTimer);
      desktop.removeEventListener("change", closeAtDesktop);
      if (dialog?.open) dialog.close();
      if (openButton?.isConnected) openButton.focus();
    };
  }, [menuOpen]);

  async function leaveWorkspace() {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/auth/sign-in");
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      <a href="#main-content" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:start-4 focus:top-4">Skip to content</a>
      <aside className="fixed inset-y-0 start-0 z-30 hidden w-60 border-e bg-card/60 p-3 backdrop-blur md:flex md:flex-col">
        <div className="px-2 py-2"><Brand href={user ? workspaceHome : "/"} /></div>
        <Button asChild className="mt-4 w-full"><Link href={newInterviewHref}><Plus aria-hidden="true" />{accountType === "recruiter" ? "Create interview" : "New practice"}</Link></Button>
        <div className="mt-6 flex-1"><NavLinks screen={screen} items={navigation} /></div>
        <div className="space-y-1">
          <Link href={settingsHref} className={cn("flex h-9 items-center gap-3 rounded-md px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground", screen === "settings" && "bg-accent text-foreground")}><Settings className="size-4" aria-hidden="true" />Settings</Link>
          <Separator className="my-3" />
          {user ? <div className="flex items-center gap-2 rounded-md p-2">
            <Avatar initials={initials} />
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{displayName}</span><span className="block truncate text-xs text-muted-foreground">{user?.email || `${accountType === "recruiter" ? "Recruiter" : "Candidate"} workspace`}</span></span>
            <Button variant="ghost" size="icon" onClick={leaveWorkspace} loading={signingOut} aria-label="Sign out"><LogOut aria-hidden="true" /></Button>
          </div> : <div className="grid grid-cols-2 gap-2"><Button variant="secondary" size="sm" asChild><Link href="/auth/sign-in">Sign in</Link></Button><Button size="sm" asChild><Link href="/auth/sign-up">Create account</Link></Button></div>}
        </div>
      </aside>

      {menuOpen ? (
        <dialog ref={menuDialogRef} className="fixed inset-0 m-0 h-full max-h-none w-full max-w-none overscroll-contain border-0 bg-background/80 p-0 backdrop-blur-sm backdrop:bg-transparent md:hidden" aria-label="Navigation menu" onCancel={(event) => { event.preventDefault(); setMenuOpen(false); }}>
          <div className="h-full w-[min(19rem,86vw)] border-e bg-card p-4 pb-[max(1rem,env(safe-area-inset-bottom))] ps-[max(1rem,env(safe-area-inset-left))] pt-[max(1rem,env(safe-area-inset-top))] shadow-2xl">
            <div className="flex items-center justify-between"><Brand href={user ? workspaceHome : "/"} /><Button ref={closeMenuRef} variant="ghost" size="icon" onClick={() => setMenuOpen(false)} aria-label="Close navigation"><X aria-hidden="true" /></Button></div>
            <Button asChild className="mt-6 w-full"><Link href={newInterviewHref} onClick={() => setMenuOpen(false)}><Plus aria-hidden="true" />{accountType === "recruiter" ? "Create interview" : "New practice"}</Link></Button>
            <div className="mt-6"><NavLinks screen={screen} items={navigation} onNavigate={() => setMenuOpen(false)} /></div>
          </div>
        </dialog>
      ) : null}

      <div className="md:ps-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/88 px-4 backdrop-blur md:px-6">
          <Button ref={openMenuRef} variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(true)} aria-label="Open navigation"><Menu aria-hidden="true" /></Button>
          <div className="ms-auto flex items-center gap-2"><Badge variant="outline"><Sparkles className="size-3" aria-hidden="true" />{user ? "Private workspace" : "Sample report"}</Badge><ThemeToggle />{user ? <Avatar initials={initials} className="size-8 md:hidden" /> : null}</div>
        </header>
        <main id="main-content" className="px-4 py-6 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 md:pb-10">
          <div className="mx-auto max-w-6xl">
            <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>{description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p> : null}</div>
              {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
            </div>
            {children}
          </div>
        </main>
      </div>

      <nav className="fixed z-30 grid rounded-xl border bg-card/95 p-1 shadow-xl backdrop-blur md:hidden" style={{ gridTemplateColumns: `repeat(${Math.min(5, navigation.length + 1)}, minmax(0, 1fr))`, insetInlineStart: "max(0.75rem, env(safe-area-inset-left))", insetInlineEnd: "max(0.75rem, env(safe-area-inset-right))", bottom: "max(0.75rem, env(safe-area-inset-bottom))" }} aria-label="Mobile workspace">
        {navigation.slice(0, 4).map((item) => { const Icon = item.icon; const active = screen === item.href.slice(1); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", active && "bg-accent text-foreground")}><Icon className="size-4" aria-hidden="true" />{item.label.replace("Prompt library", "Prompts").replace("Replay drills", "Replay")}</Link>; })}
        <Link href={newInterviewHref} className="flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg bg-primary text-[10px] font-medium text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"><Plus className="size-4" aria-hidden="true" />New</Link>
      </nav>
    </div>
  );
}
