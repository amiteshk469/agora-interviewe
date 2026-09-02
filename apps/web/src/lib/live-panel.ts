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

const MEDIA_FAULTS: Array<{ match: RegExp; message: string }> = [
  { match: /permission_denied|notallowed/i, message: "Microphone access is blocked. Allow it in your browser's address bar, then rejoin from the lobby." },
  { match: /notfound|device_not_found/i, message: "No microphone was found. Connect one, then rejoin from the lobby." },
  { match: /notreadable|track_start_failed/i, message: "Another app is using your microphone. Close it, then rejoin from the lobby." },
  { match: /network|timeout|disconnect/i, message: "The connection to the interview room dropped. Check your network, then rejoin from the lobby." },
  { match: /token|expired|invalid_?vendor/i, message: "This session's access expired. Return to the lobby and start it again." },
];

/**
 * Turn a raw SDK fault into something the candidate can act on.
 * The room shows this mid-interview, so it says what to do rather than which error class threw.
 */
export function describeMediaFault(raw: unknown, fallback = "Live audio stopped working. Rejoin from the lobby to reconnect."): string {
  const parts: string[] = [];
  if (raw instanceof Error) parts.push(raw.name, raw.message);
  else if (typeof raw === "string") parts.push(raw);
  else if (raw && typeof raw === "object") {
    const detail = raw as Record<string, unknown>;
    for (const key of ["name", "code", "type", "message", "reason", "description"]) {
      if (typeof detail[key] === "string" || typeof detail[key] === "number") parts.push(String(detail[key]));
    }
  }
  const haystack = parts.join(" ");
  if (!haystack.trim()) return fallback;
  return MEDIA_FAULTS.find((fault) => fault.match.test(haystack))?.message ?? fallback;
}

export type RawLiveTurn = {
  id: string;
  uid: string;
  isLocal: boolean;
  text: string;
  final: boolean;
  interrupted: boolean;
};

export type MergedTurn = {
  id: string;
  uid: string;
  isLocal: boolean;
  text: string;
  final: boolean;
  interrupted: boolean;
  turnNumber: number;
};

/**
 * Collapse consecutive segments from the same speaker into one spoken turn.
 *
 * Agora emits a transcript item per utterance segment, so a single answer arrives as several
 * items. Rendering them one-to-one turned one sentence into five cards numbered by array index.
 * Merging by speaker gives the reader the turn they actually took, numbered by real turn order.
 */
export function mergeLiveTurns(turns: RawLiveTurn[]): MergedTurn[] {
  const merged: MergedTurn[] = [];
  for (const turn of turns) {
    const spoken = turn.text.trim();
    if (!spoken) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.isLocal === turn.isLocal && previous.uid === turn.uid) {
      // A segment that restates the running text is a refinement, not new speech.
      const joined = spoken.startsWith(previous.text) ? spoken : `${previous.text} ${spoken}`;
      previous.text = joined.replace(/\s+/g, " ").trim();
      previous.final = turn.final;
      previous.interrupted = previous.interrupted || turn.interrupted;
      continue;
    }
    merged.push({
      id: turn.id,
      uid: turn.uid,
      isLocal: turn.isLocal,
      text: spoken,
      final: turn.final,
      interrupted: turn.interrupted,
      turnNumber: merged.length + 1,
    });
  }
  return merged;
}
