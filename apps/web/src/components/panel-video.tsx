"use client";

import type { IRemoteVideoTrack } from "agora-rtc-react";
import { AvatarVideoDisplay } from "agora-agent-uikit";
import { AudioLines, Brain, Ear, Hand, MoveDown } from "lucide-react";
import type { Panelist } from "@/data/demo";
import { cn } from "@/lib/utils";

export type PanelPresence = "speaking" | "listening" | "thinking" | "nodded" | "floor-requested";

const stateCopy: Record<PanelPresence, string> = {
  speaking: "Speaking",
  listening: "Listening",
  thinking: "Thinking",
  nodded: "Nodded",
  "floor-requested": "Floor requested",
};

const identityTones = [
  "bg-[#dfe9e2] text-[#263a2d] dark:bg-[#263a31] dark:text-[#dfe9e2]",
  "bg-[#e8e2d8] text-[#463729] dark:bg-[#45382c] dark:text-[#eee6da]",
  "bg-[#dce7ed] text-[#243b48] dark:bg-[#263d49] dark:text-[#dce7ed]",
  "bg-[#e8dfe5] text-[#493343] dark:bg-[#463441] dark:text-[#ebdfe7]",
  "bg-[#e7e5d9] text-[#3e3b29] dark:bg-[#3d3a2b] dark:text-[#ece9d9]",
] as const;

function identityTone(seed: string, toneIndex?: number) {
  const value = toneIndex ?? [...seed].reduce((total, character) => total + character.charCodeAt(0), 0);
  const index = ((value % identityTones.length) + identityTones.length) % identityTones.length;
  return identityTones[index];
}

export function PanelIdentity({ initials, seed, toneIndex, className }: { initials: string; seed: string; toneIndex?: number; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full font-semibold ring-1 ring-black/10 dark:ring-white/10", identityTone(seed, toneIndex), className)} aria-hidden="true">
      {initials}
    </span>
  );
}

function PresenceIcon({ state }: { state: PanelPresence }) {
  const className = "size-3.5";
  if (state === "speaking") return <AudioLines className={className} aria-hidden="true" />;
  if (state === "thinking") return <Brain className={className} aria-hidden="true" />;
  if (state === "floor-requested") return <Hand className={className} aria-hidden="true" />;
  if (state === "nodded") return <MoveDown className={className} aria-hidden="true" />;
  return <Ear className={className} aria-hidden="true" />;
}

export function SpotlightSpeaker({
  person,
  state,
  track,
  className,
}: {
  person: Panelist;
  state: PanelPresence;
  track?: IRemoteVideoTrack | null;
  className?: string;
}) {
  const speaking = state === "speaking";
  return (
    <article
      className={cn("relative isolate min-h-0 overflow-hidden rounded-2xl border bg-card", className)}
      aria-label={`${person.name}, ${person.role}, ${stateCopy[state]}`}
    >
      <div className={cn("absolute inset-0", identityTone(person.id || person.name, undefined))}>
        {track ? (
          <AvatarVideoDisplay videoTrack={track} state="connected" objectFit="cover" className="size-full" />
        ) : (
          <div className="grid size-full place-items-center">
            {speaking ? <span className="absolute size-44 rounded-full border border-current/12 sm:size-56" aria-hidden="true" /> : null}
            <span className="grid size-24 place-items-center rounded-full bg-white/60 text-3xl font-semibold tracking-[-0.04em] ring-1 ring-black/5 dark:bg-black/20 dark:ring-white/10 sm:size-32 sm:text-4xl" aria-hidden="true">
              {person.initials}
            </span>
          </div>
        )}
      </div>
      {/* A gradient scrim carries the label instead of a solid caption bar. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/62 via-black/28 to-transparent px-4 pb-3 pt-10">
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white sm:text-base">{person.name}</p>
            <p className="truncate text-xs text-white/70">{person.role}</p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-white/85">
            {speaking ? <SpeakingBars /> : <PresenceIcon state={state} />}
            <span className="hidden sm:inline">{stateCopy[state]}</span>
          </span>
        </div>
      </div>
    </article>
  );
}

function SpeakingBars() {
  return (
    <span className="flex items-end gap-[2px]" aria-hidden="true">
      {[0, 1, 2].map((bar) => (
        <span key={bar} className={cn("w-[3px] rounded-full bg-current", `speaking-bar-${bar + 1}`)} />
      ))}
    </span>
  );
}

export function PanelChip({
  person,
  state,
  toneIndex,
  onSelect,
}: {
  person: Panelist;
  state: PanelPresence;
  toneIndex?: number;
  onSelect?: () => void;
}) {
  const Wrapper = onSelect ? "button" : "div";
  return (
    <Wrapper
      {...(onSelect ? { type: "button" as const, onClick: onSelect } : {})}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border bg-card/80 py-1 ps-1 pe-3 text-start backdrop-blur transition-colors",
        onSelect && "hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      title={`${person.name} · ${person.role} · ${stateCopy[state]}`}
    >
      <PanelIdentity initials={person.initials} seed={person.id || person.name} toneIndex={toneIndex} className="size-7 text-[10px]" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium leading-4">{person.name}</span>
        <span className="block truncate text-[10px] leading-4 text-muted-foreground">{stateCopy[state]}</span>
      </span>
    </Wrapper>
  );
}
