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
function Avatar({ person, toneIndex, speaking }: { person: Panelist; toneIndex?: number; speaking: boolean }) {
  return (
    <span className={cn("relative grid size-12 place-items-center sm:size-16 lg:size-20", speaking && "speaking-halo")}>
      <span
        className={cn("grid size-full place-items-center rounded-full text-base font-semibold tracking-[-0.03em] sm:text-xl lg:text-2xl", identityTone(person.id || person.name, toneIndex))}
        aria-hidden="true"
      >
        {person.initials}
      </span>
    </span>
  );
}

export function ParticipantTile({
  person,
  state,
  track,
  toneIndex,
  isSelf,
  className,
}: {
  person: Panelist;
  state: PanelPresence;
  track?: IRemoteVideoTrack | null;
  toneIndex?: number;
  isSelf?: boolean;
  className?: string;
}) {
  const speaking = state === "speaking";
  return (
    <article
      className={cn(
        "relative isolate flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl bg-[var(--tile)] text-[var(--tile-foreground)] ring-1",
        speaking ? "ring-2 ring-primary/70" : "ring-black/5 dark:ring-white/8",
        className,
      )}
      aria-label={isSelf ? `You, ${speaking ? "speaking" : "listening"}` : `${person.name}, ${person.role}, ${stateCopy[state]}`}
    >
      {track ? (
        <AvatarVideoDisplay videoTrack={track} state="connected" objectFit="cover" className="absolute inset-0 size-full" />
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar person={person} toneIndex={toneIndex} speaking={speaking} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-[var(--tile)] via-[var(--tile)]/85 to-transparent p-2.5 pt-6 sm:p-3 sm:pt-8">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-5">{person.name}</p>
          <p className="truncate text-[11px] leading-4 text-[var(--tile-muted)]">{isSelf ? "Candidate" : person.role}</p>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1", speaking ? "text-primary" : "text-[var(--tile-muted)]")} title={isSelf ? (speaking ? "You are speaking" : "Your microphone is live") : stateCopy[state]}>
          {speaking ? <SpeakingBars /> : isSelf ? <Mic className="size-3.5" aria-hidden="true" /> : <PresenceIcon state={state} />}
        </span>
      </div>
    </article>
  );
}

/**
 * Column count by headcount, matching how a meeting client reflows: a short panel sits in
 * one row, four squares up, and five or six take three across. Tiles stay the same size as
 * each other at every count, so nobody is reduced to a thumbnail.
 */
export function participantGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-2 sm:grid-cols-3";
  if (count === 4) return "grid-cols-2";
  return "grid-cols-2 sm:grid-cols-3";
}
