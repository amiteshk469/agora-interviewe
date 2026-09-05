"use client";

import type { PlayableVideoTrack } from "agora-agent-uikit";
import { LocalVideoTrack, RemoteVideoTrack, type ILocalVideoTrack, type IRemoteVideoTrack } from "agora-rtc-react";
import { Brain, Ear, Hand, Mic, MicOff, MoveDown } from "lucide-react";
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

// Agora's React player hook uses this object as an effect dependency. Keeping
// these references stable prevents an ordinary parent rerender from calling
// track.stop() followed by track.play(), which presents as camera flicker.
const LOCAL_VIDEO_PLAYER_CONFIG = { fit: "cover", mirror: true } as const;
const REMOTE_VIDEO_PLAYER_CONFIG = { fit: "cover", mirror: false } as const;

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
function Avatar({ person, toneIndex, speaking, compact }: { person: Panelist; toneIndex?: number; speaking: boolean; compact?: boolean }) {
  return (
    <span className={cn("relative grid place-items-center", compact ? "size-9" : "size-12 sm:size-16 lg:size-20", speaking && "speaking-halo")}>
      <span
        className={cn("grid size-full place-items-center rounded-full font-semibold tracking-[-0.03em]", compact ? "text-xs" : "text-base sm:text-xl lg:text-2xl", identityTone(person.id || person.name, toneIndex))}
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
  microphoneEnabled,
  compact,
  className,
}: {
  person: Panelist;
  state: PanelPresence;
  track?: PlayableVideoTrack | null;
  toneIndex?: number;
  isSelf?: boolean;
  microphoneEnabled?: boolean;
  compact?: boolean;
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
      aria-label={isSelf
        ? `You, ${speaking ? "speaking" : microphoneEnabled ? "listening, microphone on" : "listening, microphone muted"}`
        : `${person.name}, ${person.role}, ${stateCopy[state]}`}
    >
      {track ? (
        <div className="absolute inset-0 size-full bg-black">
          {isSelf ? (
            <LocalVideoTrack
              track={track as unknown as ILocalVideoTrack}
              play
              videoPlayerConfig={LOCAL_VIDEO_PLAYER_CONFIG}
              className="size-full"
              aria-label="Your live camera preview"
            />
          ) : (
            <RemoteVideoTrack
              track={track as unknown as IRemoteVideoTrack}
              play
              videoPlayerConfig={REMOTE_VIDEO_PLAYER_CONFIG}
              className="size-full"
              aria-label={`${person.name}'s live video`}
            />
          )}
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center">
          <Avatar person={person} toneIndex={toneIndex} speaking={speaking} compact={compact} />
        </div>
      )}

      <div className={cn("absolute inset-x-0 bottom-0 flex items-end justify-between gap-2", compact ? "p-2" : "p-2.5 sm:p-3")}>
        <div className={cn("min-w-0", track && "rounded-lg bg-black/55 px-2 py-1 text-white")}>
          <p className={cn("truncate font-semibold", compact ? "text-[11px] leading-4" : "text-[13px] leading-5")}>{person.name}</p>
          {compact ? null : <p className="truncate text-[11px] leading-4 text-[var(--tile-muted)]">{person.role}</p>}
        </div>
        <span className={cn("flex shrink-0 items-center gap-1", speaking ? "text-primary" : "text-[var(--tile-muted)]")} title={isSelf ? (speaking ? "You are speaking" : microphoneEnabled ? "Your microphone is on" : "Your microphone is muted") : stateCopy[state]}>
          {speaking
            ? <SpeakingBars />
            : isSelf
              ? microphoneEnabled
                ? <Mic className="size-3.5" aria-hidden="true" />
                : <MicOff className="size-3.5" aria-hidden="true" />
              : <PresenceIcon state={state} />}
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
export function participantGridClass(count: number, compact = false): string {
  // With the editor open everyone shares a single row, the way a coding-interview
  // client keeps faces present without taking the screen from the code.
  if (compact) {
    if (count > 6) return "grid-cols-4 sm:grid-cols-7";
    const columns = ["grid-cols-1", "grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4", "grid-cols-5", "grid-cols-6"];
    return columns[Math.min(Math.max(count, 1), 6)];
  }
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count === 3) return "grid-cols-2 sm:grid-cols-3";
  if (count === 4) return "grid-cols-2";
  return "grid-cols-2 sm:grid-cols-3";
}

/**
 * Cap the grid so rows can never total more than the stage.
 *
 * Sizing tiles by aspect ratio lets two rows compute taller than the space available, which
 * pushes the grid under the footer. Bounding the grid by row count instead means rows always
 * share what is actually there, and tiles stay landscape without overflowing.
 */
export function participantGridHeightClass(count: number, compact = false): string {
  const rows = count <= 3 ? 1 : count === 4 ? 2 : 2;
  // A fixed height, not a cap: the strip no longer flexes, so auto-rows-fr has
  // nothing to divide unless the row track is given a size of its own.
  if (compact) return count > 6 ? "h-[10rem] sm:h-[6.5rem]" : "h-[6.5rem]";
  return rows === 1 ? "max-h-[19rem]" : "max-h-[38rem]";
}
