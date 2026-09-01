import { describe, expect, it } from "vitest";
import { defaultPanelists } from "../data/demo";
import { avatarUidForPanelist, demoSpeakerIndex, presenceForPanelist } from "./live-panel";

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
