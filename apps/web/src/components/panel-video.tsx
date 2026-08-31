"use client";

import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-react";
import { AvatarVideoDisplay, LocalVideoPreview } from "agora-agent-uikit";
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

export function PanelVideoTile({
  person,
  state,
  track,
  className,
  motionIndex = 0,
  identityIndex,
  selected,
}: {
  person: Panelist;
  state: PanelPresence;
  track?: IRemoteVideoTrack | null;
  className?: string;
  motionIndex?: number;
  identityIndex?: number;
  selected?: boolean;
}) {
  const active = selected ?? state === "speaking";
  return (
    <article className={cn("panel-video-tile group relative min-h-0 overflow-hidden rounded-xl border bg-card", active ? "panel-video-active" : "panel-video-idle", className)} aria-label={`${person.name}, ${person.role}, ${stateCopy[state]}`}>
      <div className={cn("absolute inset-0 overflow-hidden", !track && `panel-idle-motion-${(motionIndex % 4) + 1}`, active && !track && "panel-speaking-motion")}>
        {track ? (
          <AvatarVideoDisplay videoTrack={track} state="connected" objectFit="cover" className="size-full" />
        ) : (
          <div className={cn("relative grid size-full place-items-center", identityTone(person.id || person.name, identityIndex))}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgb(255_255_255_/_0.38),transparent_42%)] dark:bg-[radial-gradient(circle_at_50%_36%,rgb(255_255_255_/_0.09),transparent_42%)]" aria-hidden="true" />
            <div className="relative grid place-items-center">
              {active ? <span className="absolute size-28 rounded-full border border-current/15 sm:size-36" aria-hidden="true" /> : null}
              <span className="grid size-20 place-items-center rounded-full bg-white/55 text-2xl font-semibold tracking-[-0.04em] shadow-sm ring-1 ring-black/10 backdrop-blur-sm dark:bg-black/16 dark:ring-white/10 sm:size-24 sm:text-3xl" aria-hidden="true">{person.initials}</span>
            </div>
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex min-h-10 items-center gap-2 bg-[var(--video-overlay)] px-3 py-2 text-[var(--video-overlay-foreground)]">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold sm:text-sm">{person.name}</p>
          <p className="truncate text-[10px] text-white/72 sm:text-[11px]">{person.role}</p>
        </div>
        <span className={cn("flex shrink-0 items-center gap-1 text-[10px] font-medium sm:text-[11px]", active ? "text-[#ff8b7d]" : state === "floor-requested" ? "text-[#ffd0c9]" : "text-white/78")}>
          <PresenceIcon state={state} />
          <span className="hidden min-[520px]:inline">{stateCopy[state]}</span>
        </span>
      </div>
      {state === "speaking" ? <div className="absolute start-3 top-3 flex items-center gap-1.5 rounded-md bg-[var(--video-overlay)] px-2 py-1 text-[11px] font-medium text-[#ff8b7d]"><AudioLines className="size-3.5" aria-hidden="true" />{person.name} is speaking</div> : null}
    </article>
  );
}

export function CandidateVideoTile({ track, cameraEnabled, className }: { track?: ICameraVideoTrack | null; cameraEnabled: boolean; className?: string }) {
  return (
    <article className={cn("panel-video-tile relative min-h-0 overflow-hidden rounded-xl border bg-card", className)} aria-label={`Candidate camera, ${track && cameraEnabled ? "camera live" : "camera off"}`}>
      <div className="absolute inset-0 overflow-hidden">
        {track && cameraEnabled ? (
          <LocalVideoPreview videoTrack={track} label="Candidate" isMirrored className="size-full" />
        ) : (
          <div className="grid size-full place-items-center bg-[#e5e8e5] text-[#303733] dark:bg-[#29302c] dark:text-[#e6ebe8]">
            <span className="grid size-20 place-items-center rounded-full bg-white/55 text-xl font-semibold tracking-[-0.04em] shadow-sm ring-1 ring-black/10 dark:bg-black/16 dark:ring-white/10 sm:size-24 sm:text-2xl" aria-hidden="true">YOU</span>
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex min-h-10 items-center justify-between bg-[var(--video-overlay)] px-3 py-2 text-[var(--video-overlay-foreground)]">
        <span className="text-xs font-semibold sm:text-sm">You (Candidate)</span>
        <span className="flex items-center gap-1 text-[10px] text-white/78 sm:text-[11px]"><AudioLines className="size-3.5" aria-hidden="true" />{track && cameraEnabled ? "Camera live" : "Camera off"}</span>
      </div>
    </article>
  );
}
