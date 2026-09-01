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

/** Director bookkeeping is written to tool_runs on every turn; it is not an interviewer tool. */
export const DIRECTOR_BOOKKEEPING_TOOL = "panel.bid";

export type ToolActivityItem = {
  id: string;
  name: string;
  detail: string;
  highlight: string | null;
  status: string;
  time: string;
};

function text(value: unknown, limit = 160): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function percent(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : text(value, 24);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  // Deterministic arithmetic returns full decimal precision; one decimal reads aloud.
  return `${Math.round(parsed * 10) / 10}%`;
}

/**
 * Turn one audited tool run into something a viewer can read at a glance.
 * The calculator is the case that matters most: it exists to check a number the candidate
 * stated, so the claim and the computed value belong side by side rather than in raw JSON.
 */
export function describeToolRun(run: {
  tool_name: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
  error?: string | null;
}): { detail: string; highlight: string | null } {
  const { tool_name: name, arguments: args, result } = run;
  if (run.error) return { detail: run.error, highlight: null };

  if (name === "calculator") {
    const computed = percent(result.value);
    const claimed = percent(args.claimed_relative_change_percent);
    const expression = text(args.expression, 80);
    if (computed && claimed) {
      return {
        detail: `Candidate said ${claimed}. ${expression} = ${computed}.`,
        highlight: `Claimed ${claimed} · Actual ${computed}`,
      };
    }
    const value = computed ?? text(result.value, 40);
    return { detail: expression ? `${expression} = ${value}` : value, highlight: null };
  }

  if (name === "knowledge_search" || name === "web_search") {
    const rows = Array.isArray(result.matches)
      ? result.matches
      : Array.isArray(result.results)
        ? result.results
        : [];
    if (!rows.length) return { detail: "No grounded match was found.", highlight: null };
    const first = rows[0] as Record<string, unknown>;
    const label = text(first.source) || text(first.title) || "source";
    const suffix = rows.length > 1 ? ` +${rows.length - 1} more` : "";
    return { detail: `${rows.length} match${rows.length === 1 ? "" : "es"} · ${label}${suffix}`, highlight: null };
  }

  const fallback = text(JSON.stringify(result), 160);
  return { detail: fallback === "{}" ? "No result" : fallback, highlight: null };
}

/** Interviewer tool runs only, newest first, with director bookkeeping removed. */
export function interviewerToolRuns<T extends { tool_name: string }>(runs: T[]): T[] {
  return runs.filter((run) => run.tool_name !== DIRECTOR_BOOKKEEPING_TOOL);
}

export type SpeakerTurn = { panelistId: string; name: string };

/**
 * The order the director actually gave the floor, oldest first.
 * Consecutive repeats collapse so the trail shows handoffs rather than every turn, which is
 * what makes a non-linear sequence such as 1 -> 3 -> 1 visible at a glance.
 */
export function speakerSequence(
  bids: Array<{ tool_name: string; result: Record<string, unknown>; created_at: string }>,
): SpeakerTurn[] {
  const ordered = bids
    .filter((run) => run.tool_name === DIRECTOR_BOOKKEEPING_TOOL)
    .slice()
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
  const sequence: SpeakerTurn[] = [];
  for (const run of ordered) {
    const selected = run.result?.selected_panelist as { id?: string; display_name?: string } | undefined;
    const panelistId = text(selected?.id, 80);
    if (!panelistId) continue;
    if (sequence[sequence.length - 1]?.panelistId === panelistId) continue;
    sequence.push({ panelistId, name: text(selected?.display_name, 40) || panelistId });
  }
  return sequence;
}
