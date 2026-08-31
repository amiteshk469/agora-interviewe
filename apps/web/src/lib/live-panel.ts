import type { Panelist } from "@/data/demo";
import type { AgoraPanelParticipant } from "@/lib/api";
import type { PanelPresence } from "@/components/panel-video";

const idleCycle: PanelPresence[] = ["listening", "thinking", "nodded", "floor-requested"];

export function presenceForPanelist(panelistIndex: number, phase: number, active: boolean): PanelPresence {
  if (active) return "speaking";
  return idleCycle[(panelistIndex + phase) % idleCycle.length];
}

export function avatarUidForPanelist(panelist: Panelist, participants: AgoraPanelParticipant[] = []) {
  return participants.find((participant) => participant.panelist_id === panelist.id)?.avatar_uid;
}

export function demoSpeakerIndex(step: number, panelSize: number) {
  if (panelSize <= 1) return 0;
  const sequence = [0, Math.min(2, panelSize - 1), 0, panelSize - 1, Math.min(1, panelSize - 1)];
  return sequence[step % sequence.length];
}
