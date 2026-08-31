"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

type Theme = "light" | "dark";

const storageKey = "roundcraft.theme";
const themeEvent = "roundcraft-theme-change";

function syncThemeColor() {
  const color = getComputedStyle(document.documentElement).getPropertyValue("--background").trim();
  if (!color) return;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", color));
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  syncThemeColor();
  try { window.localStorage.setItem(storageKey, theme); } catch {}
  window.dispatchEvent(new Event(themeEvent));
}

function subscribeTheme(onStoreChange: () => void) {
  window.addEventListener(themeEvent, onStoreChange);
  return () => window.removeEventListener(themeEvent, onStoreChange);
}

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function serverTheme(): Theme {
  return "light";
}

export function ThemeToggle({ segmented = false, className }: { segmented?: boolean; className?: string }) {
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);

  useEffect(() => syncThemeColor(), [theme]);

  function choose(next: Theme) {
    applyTheme(next);
  }

  if (segmented) {
    return (
      <div className={cn("grid grid-cols-2 rounded-lg border bg-secondary/70 p-1", className)} role="group" aria-label="Color theme">
        <button type="button" onClick={() => choose("light")} aria-pressed={theme === "light"} className={cn("flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", theme === "light" && "bg-card text-foreground shadow-sm")}>
          <Sun className="size-3.5" aria-hidden="true" />Light
        </button>
        <button type="button" onClick={() => choose("dark")} aria-pressed={theme === "dark"} className={cn("flex min-h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", theme === "dark" && "bg-card text-foreground shadow-sm")}>
          <Moon className="size-3.5" aria-hidden="true" />Dark
        </button>
      </div>
    );
  }

  const next = theme === "light" ? "dark" : "light";
  return (
    <button type="button" onClick={() => choose(next)} className={cn("grid size-9 shrink-0 place-items-center rounded-full border bg-card text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring", className)} aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}>
      {theme === "light" ? <Moon className="size-4" aria-hidden="true" /> : <Sun className="size-4" aria-hidden="true" />}
    </button>
  );
}
