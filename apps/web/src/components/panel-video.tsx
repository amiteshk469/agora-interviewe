"use client";

import type { IRemoteVideoTrack } from "agora-rtc-react";
import { AvatarVideoDisplay } from "agora-agent-uikit";
import { Brain, Ear, Hand, Mic, MoveDown } from "lucide-react";
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

/**
 * Avatar tints only. Tiles themselves stay one neutral surface for everyone, the way a
 * meeting client does it, so five people never turn the room into five colour fields.
 */
const identityTones = [
  "bg-[#d9e3dd] text-[#26382f] dark:bg-[#22322b] dark:text-[#cfded6]",
  "bg-[#e3ddd3] text-[#3f342a] dark:bg-[#332c24] dark:text-[#e0d6c9]",
  "bg-[#d8e1e8] text-[#22333d] dark:bg-[#20303a] dark:text-[#d0dee6]",
  "bg-[#e2d9de] text-[#3b2f36] dark:bg-[#332a30] dark:text-[#ded1d8]",
  "bg-[#e0e1d6] text-[#37382c] dark:bg-[#2e3026] dark:text-[#dcded0]",
] as const;

function identityTone(seed: string, toneIndex?: number) {
  const value = toneIndex ?? [...seed].reduce((total, character) => total + character.charCodeAt(0), 0);
  const index = ((value % identityTones.length) + identityTones.length) % identityTones.length;
  return identityTones[index];
}

export function PanelIdentity({ initials, seed, toneIndex, className }: { initials: string; seed: string; toneIndex?: number; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-full font-semibold", identityTone(seed, toneIndex), className)} aria-hidden="true">
      {initials}
    </span>
  );
}

function PresenceIcon({ state, className }: { state: PanelPresence; className?: string }) {
  const shared = cn("size-3.5", className);
  if (state === "thinking") return <Brain className={shared} aria-hidden="true" />;
  if (state === "floor-requested") return <Hand className={shared} aria-hidden="true" />;
  if (state === "nodded") return <MoveDown className={shared} aria-hidden="true" />;
  return <Ear className={shared} aria-hidden="true" />;
}

function SpeakingBars({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-end gap-[2px]", className)} aria-hidden="true">
      {[1, 2, 3].map((bar) => (
        <span key={bar} className={cn("w-[3px] rounded-full bg-current", `speaking-bar-${bar}`)} />
      ))}
    </span>
  );
}

/** The avatar, with the halo rings that mark whoever currently holds the floor. */
function Avatar({ person, toneIndex, speaking, size }: { person: Panelist; toneIndex?: number; speaking: boolean; size: "lg" | "sm" }) {
  return (
    <span className={cn("relative grid place-items-center", speaking && "speaking-halo", size === "lg" ? "size-24 sm:size-28" : "size-11")}>
      <span
        className={cn(
          "grid size-full place-items-center rounded-full font-semibold tracking-[-0.03em]",
          identityTone(person.id || person.name, toneIndex),
          size === "lg" ? "text-3xl sm:text-4xl" : "text-sm",
        )}
        aria-hidden="true"
      >
        {person.initials}
      </span>
    </span>
  );
}

export function SpotlightSpeaker({
  person,
  state,
  track,
  toneIndex,
  className,
}: {
  person: Panelist;
  state: PanelPresence;
  track?: IRemoteVideoTrack | null;
  toneIndex?: number;
  className?: string;
}) {
  const speaking = state === "speaking";
  return (
    <article
      className={cn(
        // The spotlight is by definition the speaker, so the halo and meter carry that
        // state; a heavy accent border on a tile this large only shouts.
        "relative isolate min-h-0 overflow-hidden rounded-2xl bg-[var(--tile)] text-[var(--tile-foreground)] ring-1 ring-black/5 dark:ring-white/8",
        className,
      )}
      aria-label={`${person.name}, ${person.role}, ${stateCopy[state]}`}
    >
      {track ? (
        <AvatarVideoDisplay videoTrack={track} state="connected" objectFit="cover" className="absolute inset-0 size-full" />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar person={person} toneIndex={toneIndex} speaking={speaking} size="lg" />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold sm:text-base">{person.name}</p>
          <p className="truncate text-xs text-[var(--tile-muted)]">{person.role}</p>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1.5 text-xs font-medium", speaking ? "text-primary" : "text-[var(--tile-muted)]")}>
          {speaking ? <SpeakingBars /> : <PresenceIcon state={state} />}
          <span className="hidden sm:inline">{stateCopy[state]}</span>
        </span>
      </div>
    </article>
  );
}

/** A filmstrip participant: a real tile, not a name chip. */
export function PanelTile({ person, state, toneIndex, isSelf }: { person: Panelist; state: PanelPresence; toneIndex?: number; isSelf?: boolean }) {
  const speaking = state === "speaking";
  return (
    <article
      className={cn(
        "relative flex h-[5.75rem] w-[8.5rem] shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl bg-[var(--tile)] text-[var(--tile-foreground)] ring-1 sm:w-[9.5rem]",
        speaking ? "ring-2 ring-primary/60" : "ring-black/5 dark:ring-white/8",
      )}
      aria-label={isSelf ? `You, ${speaking ? "speaking" : "listening"}` : `${person.name}, ${person.role}, ${stateCopy[state]}`}
    >
      <Avatar person={person} toneIndex={toneIndex} speaking={speaking} size="sm" />
      <p className="max-w-full truncate px-2 text-[11px] font-medium leading-4">{person.name}</p>
      <span className={cn("absolute end-1.5 top-1.5", speaking ? "text-primary" : "text-[var(--tile-muted)]")} title={isSelf ? (speaking ? "You are speaking" : "Your microphone is live") : stateCopy[state]}>
        {speaking ? <SpeakingBars /> : isSelf ? <Mic className="size-3" aria-hidden="true" /> : <PresenceIcon state={state} className="size-3" />}
      </span>
    </article>
  );
}
