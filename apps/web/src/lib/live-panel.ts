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

export type LiveContradiction = {
  subject: string;
  earlierClaim: string;
  currentClaim: string;
  earlierTurnId: string | null;
};

/**
 * Read the contradiction the director recorded for the current turn, if any.
 * Every field must be present before anything is shown: a partial record would let the room
 * assert a conflict it cannot actually quote, which is the one thing evidence-first forbids.
 */
export function readLiveContradiction(metadata: unknown): LiveContradiction | null {
  const found = (metadata as { contradiction?: unknown } | undefined)?.contradiction;
  if (!found || typeof found !== "object") return null;
  const record = found as Record<string, unknown>;
  const subject = text(record.subject, 60);
  const earlierClaim = text(record.earlier_claim, 60);
  const currentClaim = text(record.current_claim, 60);
  if (!subject || !earlierClaim || !currentClaim) return null;
  if (earlierClaim === currentClaim) return null;
  return {
    subject,
    earlierClaim,
    currentClaim,
    earlierTurnId: text(record.earlier_turn_id, 80) || null,
  };
}

export type RawLiveTurn = {
  id: string;
  uid: string;
  isLocal: boolean;
  text: string;
  final: boolean;
  interrupted: boolean;
};

export type MergedTurn = RawLiveTurn & { turnNumber: number };

const MIN_SEAM_OVERLAP = 6;

/**
 * Length of the longest suffix of `previous` that also opens `next`.
 * Agora re-sends the tail of a run when it reopens a turn, so joining blind duplicates
 * words at the seam. Only word-aligned overlaps count, so "the" never welds onto "there".
 */
function seamOverlap(previous: string, next: string): number {
  const left = previous.toLowerCase();
  const right = next.toLowerCase();
  const limit = Math.min(left.length, right.length);
  for (let size = limit; size >= MIN_SEAM_OVERLAP; size -= 1) {
    if (!left.endsWith(right.slice(0, size))) continue;
    const boundary = left.length - size;
    if (boundary === 0 || /\s/.test(left[boundary - 1])) return size;
  }
  return 0;
}

/** Join one spoken segment onto the run it continues, without repeating the seam. */
export function joinSegments(previous: string, next: string): string {
  if (!previous) return next;
  if (!next) return previous;
  const left = previous.toLowerCase();
  const right = next.toLowerCase();
  // A segment that restates or contains the run is a correction, not new speech.
  if (right.startsWith(left)) return next;
  if (left.includes(right)) return previous;
  const overlap = seamOverlap(previous, next);
  const tail = overlap > 0 ? next.slice(overlap).trimStart() : next;
  if (!tail) return previous;
  return `${previous}${/^[,.!?;:]/.test(tail) ? "" : " "}${tail}`.replace(/\s+/g, " ").trim();
}

/**
 * Collapse a speaker's consecutive segments into the turn they actually took.
 *
 * Agora closes a turn whenever end-of-speech fires, so pausing mid-answer to think
 * splits one answer across several turn ids. Merging by speaker restores the answer;
 * a turn from someone else still breaks the run, because that is a real handover.
 * This is presentation only: persistence stays keyed by Agora's own turn id.
 */
export function mergeLiveTurns(turns: RawLiveTurn[]): MergedTurn[] {
  const merged: MergedTurn[] = [];
  for (const turn of turns) {
    const spoken = turn.text.trim();
    if (!spoken) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.isLocal === turn.isLocal && previous.uid === turn.uid) {
      previous.text = joinSegments(previous.text, spoken);
      previous.final = turn.final;
      previous.interrupted = previous.interrupted || turn.interrupted;
      continue;
    }
    merged.push({ ...turn, text: spoken, turnNumber: merged.length + 1 });
  }
  return merged;
}
