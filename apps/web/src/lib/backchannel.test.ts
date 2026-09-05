import { describe, expect, it } from "vitest";
import { BackchannelGate } from "./backchannel";

describe("conversational acknowledgments", () => {
  it("waits for a long answer and enforces a minute cooldown", () => {
    const gate = new BackchannelGate();
    expect(gate.sample(0, true, false)).toBe(false);
    expect(gate.sample(17000, true, false)).toBe(false);
    expect(gate.sample(18000, true, false)).toBe(true);
    expect(gate.sample(50000, true, false)).toBe(false);
    expect(gate.sample(78000, true, false)).toBe(true);
  });
  it("does not speak over a host, a busy AI, or in Let me finish", () => {
    const gate = new BackchannelGate();
    gate.sample(0, true, false);
    expect(gate.sample(20000, true, true)).toBe(false);
    expect(gate.sample(21000, true, false)).toBe(false);
  });
  it("resets after silence and never acknowledges an idle microphone", () => {
    const gate = new BackchannelGate();
    gate.sample(0, true, false);
    expect(gate.sample(3000, false, false)).toBe(false);
    expect(gate.sample(20000, true, false)).toBe(false);
    expect(gate.sample(99999, false, false)).toBe(false);
  });
});
