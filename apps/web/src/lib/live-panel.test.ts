import { describe, expect, it } from "vitest";
import { defaultPanelists } from "../data/demo";
import { avatarUidForPanelist, demoSpeakerIndex, describeToolRun, interviewerToolRuns, presenceForPanelist, readLiveContradiction, speakerSequence } from "./live-panel";

describe("live panel presentation", () => {
  it("keeps the selected interviewer in the speaking state", () => {
    expect(presenceForPanelist(4, 99, true)).toBe("speaking");
  });

  it("gives inactive interviewers staggered, changing presence states", () => {
    const firstPhase = [0, 1, 2, 3].map((index) => presenceForPanelist(index, 0, false));
    const secondPhase = [0, 1, 2, 3].map((index) => presenceForPanelist(index, 1, false));

    expect(new Set(firstPhase).size).toBe(4);
    expect(secondPhase).not.toEqual(firstPhase);
    expect(firstPhase).toContain("floor-requested");
  });

  it("supports a non-linear demo sequence where an interviewer returns", () => {
    expect([0, 1, 2, 3, 4].map((step) => demoSpeakerIndex(step, 5))).toEqual([0, 2, 0, 4, 1]);
  });

  it("maps a configured panelist to a distinct Agora avatar uid", () => {
    expect(avatarUidForPanelist(defaultPanelists[1], [
      { panelist_id: defaultPanelists[0].id, agent_uid: "1001", avatar_uid: "2001", video_mode: "live" },
      { panelist_id: defaultPanelists[1].id, agent_uid: "1002", avatar_uid: "2002", video_mode: "live" },
    ])).toBe("2002");
  });

  it("gives the five default panelists distinct Indian English voices", () => {
    expect(new Set(defaultPanelists.map((panelist) => panelist.voice))).toEqual(new Set([
      "indian-calm",
      "indian-advisor",
      "indian-anchor",
      "indian-deep",
      "indian-bright",
    ]));
  });
});

describe("tool activity presentation", () => {
  it("shows the calculator as claimed versus computed instead of raw json", () => {
    expect(describeToolRun({
      tool_name: "calculator",
      arguments: { expression: "(4.5 - 4) / 4 * 100", claimed_relative_change_percent: "10" },
      result: { value: "12.5" },
    })).toEqual({
      detail: "Candidate said 10%. (4.5 - 4) / 4 * 100 = 12.5%.",
      highlight: "Claimed 10% · Actual 12.5%",
    });
  });

  it("rounds full decimal precision so the value can be read aloud", () => {
    expect(describeToolRun({
      tool_name: "calculator",
      arguments: { expression: "(27 - 22) / 22 * 100", claimed_relative_change_percent: "5" },
      result: { value: "22.72727272727272727272727273" },
    }).highlight).toBe("Claimed 5% · Actual 22.7%");
  });

  it("summarizes searches by match count and first source", () => {
    expect(describeToolRun({
      tool_name: "knowledge_search",
      arguments: { query: "pricing" },
      result: { matches: [{ source: "job-description:1", excerpt: "..." }, { source: "transcript:2", excerpt: "..." }] },
    }).detail).toBe("2 matches · job-description:1 +1 more");
  });

  it("reports a failed run without inventing a result", () => {
    expect(describeToolRun({
      tool_name: "calculator",
      arguments: {},
      result: {},
      error: "ValueError",
    })).toEqual({ detail: "ValueError", highlight: null });
  });

  it("keeps director bookkeeping out of the interviewer tool list", () => {
    expect(interviewerToolRuns([
      { tool_name: "panel.bid" },
      { tool_name: "calculator" },
      { tool_name: "panel.bid" },
      { tool_name: "knowledge_search" },
    ])).toEqual([{ tool_name: "calculator" }, { tool_name: "knowledge_search" }]);
  });
});

describe("speaker sequence", () => {
  const bid = (id: string, name: string, created_at: string) => ({
    tool_name: "panel.bid",
    result: { selected_panelist: { id, display_name: name } },
    created_at,
  });

  it("exposes a non-linear floor order where an interviewer returns", () => {
    expect(speakerSequence([
      bid("hiring-manager", "Maya Chen", "2026-09-01T10:00:00Z"),
      bid("analytics", "Priya Rao", "2026-09-01T10:01:00Z"),
      bid("hiring-manager", "Maya Chen", "2026-09-01T10:02:00Z"),
    ]).map((turn) => turn.name)).toEqual(["Maya Chen", "Priya Rao", "Maya Chen"]);
  });

  it("collapses consecutive turns by the same interviewer into one handoff", () => {
    expect(speakerSequence([
      bid("analytics", "Priya Rao", "2026-09-01T10:00:00Z"),
      bid("analytics", "Priya Rao", "2026-09-01T10:01:00Z"),
      bid("hiring-manager", "Maya Chen", "2026-09-01T10:02:00Z"),
    ])).toHaveLength(2);
  });

  it("orders by creation time and ignores anything that is not a director bid", () => {
    expect(speakerSequence([
      { tool_name: "calculator", result: {}, created_at: "2026-09-01T10:03:00Z" },
      bid("analytics", "Priya Rao", "2026-09-01T10:02:00Z"),
      bid("hiring-manager", "Maya Chen", "2026-09-01T10:01:00Z"),
    ]).map((turn) => turn.name)).toEqual(["Maya Chen", "Priya Rao"]);
  });
});

describe("live contradiction marker", () => {
  it("reads a complete contradiction the director recorded", () => {
    expect(readLiveContradiction({
      contradiction: {
        subject: "conversion",
        earlier_claim: "4 to 4.5",
        current_claim: "4 to 6",
        earlier_turn_id: "turn-1",
      },
    })).toEqual({
      subject: "conversion",
      earlierClaim: "4 to 4.5",
      currentClaim: "4 to 6",
      earlierTurnId: "turn-1",
    });
  });

  it("shows nothing when the director recorded no contradiction", () => {
    expect(readLiveContradiction({ contradiction: null })).toBeNull();
    expect(readLiveContradiction({})).toBeNull();
    expect(readLiveContradiction(undefined)).toBeNull();
  });

  it("refuses to assert a conflict it cannot quote in full", () => {
    // A partial record would let the room claim a contradiction without both sides.
    expect(readLiveContradiction({
      contradiction: { subject: "conversion", earlier_claim: "4 to 4.5" },
    })).toBeNull();
    expect(readLiveContradiction({
      contradiction: { subject: "", earlier_claim: "4 to 4.5", current_claim: "4 to 6" },
    })).toBeNull();
  });

  it("does not flag a restatement of the same numbers", () => {
    expect(readLiveContradiction({
      contradiction: { subject: "conversion", earlier_claim: "4 to 4.5", current_claim: "4 to 4.5" },
    })).toBeNull();
  });
});
