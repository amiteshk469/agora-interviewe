"use client";

import type { ICameraVideoTrack, IRemoteVideoTrack } from "agora-rtc-react";
import { AvatarVideoDisplay, LocalVideoPreview } from "agora-agent-uikit";
import { AudioLines, Brain, Ear, Hand, MoveDown } from "lucide-react";
import Image from "next/image";
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
  selected,
}: {
  person: Panelist;
  state: PanelPresence;
  track?: IRemoteVideoTrack | null;
  className?: string;
  motionIndex?: number;
  selected?: boolean;
}) {
  const active = selected ?? state === "speaking";
  return (
    <article className={cn("panel-video-tile group relative min-h-0 overflow-hidden rounded-xl border bg-card", active ? "panel-video-active" : "panel-video-idle", className)} aria-label={`${person.name}, ${person.role}, ${stateCopy[state]}`}>
      <div className={cn("absolute inset-0 overflow-hidden", !track && `panel-idle-motion-${(motionIndex % 4) + 1}`, active && !track && "panel-speaking-motion")}>
        {track ? (
          <AvatarVideoDisplay videoTrack={track} state="connected" objectFit="cover" className="size-full" />
        ) : (
          <Image src={person.avatarImage} alt={`${person.name}, ${person.role}`} fill sizes="(max-width: 768px) 92vw, (max-width: 1280px) 45vw, 32vw" className="panel-portrait object-cover" priority={active} />
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
    <article className={cn("panel-video-tile relative min-h-0 overflow-hidden rounded-xl border bg-card", className)} aria-label="Candidate camera">
      <div className="absolute inset-0 overflow-hidden">
        {track && cameraEnabled ? (
          <LocalVideoPreview videoTrack={track} label="Candidate" isMirrored className="size-full" />
        ) : (
          <Image src="/avatars/candidate.png" alt="Candidate camera fallback" fill sizes="(max-width: 768px) 92vw, 55vw" className="panel-portrait panel-idle-motion-2 object-cover" priority />
        )}
      </div>
      <div className="absolute inset-x-0 bottom-0 flex min-h-10 items-center justify-between bg-[var(--video-overlay)] px-3 py-2 text-[var(--video-overlay-foreground)]">
        <span className="text-xs font-semibold sm:text-sm">You (Candidate)</span>
        <span className="flex items-center gap-1 text-[10px] text-white/78 sm:text-[11px]"><AudioLines className="size-3.5" aria-hidden="true" />{cameraEnabled ? "Camera live" : "Preview"}</span>
      </div>
    </article>
  );
}
