import { describe, expect, it } from "vitest";
import { FocusGuardEventGate, focusGuardEventLabel } from "./focus-guard";

describe("candidate focus guard", () => {
  it("deduplicates event bursts but accepts a later violation", () => {
    const gate = new FocusGuardEventGate();
    expect(gate.accept("tab_hidden", 1_000)).toBe(true);
    expect(gate.accept("tab_hidden", 1_300)).toBe(false);
    expect(gate.accept("tab_hidden", 2_501)).toBe(true);
  });

  it("treats correlated browser signals as one focus-loss episode", () => {
    const gate = new FocusGuardEventGate();
    expect(gate.accept("window_blur", 1_000)).toBe(true);
    expect(gate.accept("fullscreen_exit", 1_010)).toBe(false);
    expect(gate.accept("camera_disabled", 1_010)).toBe(true);
  });

  it("uses clear labels suitable for the interviewer audit", () => {
    expect(focusGuardEventLabel("camera_disabled")).toBe("Candidate camera was turned off");
  });
});
