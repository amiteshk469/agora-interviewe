import { describe, expect, it } from "vitest";
import { VoiceActivityDetector } from "./voice-activity";

function feed(detector: VoiceActivityDetector, levels: number[], startAt = 0) {
  return levels.map((level, index) => detector.sample(level, startAt + index * 120));
}

describe("VoiceActivityDetector", () => {
  it("calibrates to steady microphone noise without showing speech", () => {
    const detector = new VoiceActivityDetector();
    const samples = feed(detector, Array.from({ length: 20 }, () => 0.12));

    expect(samples.every((sample) => !sample.speaking)).toBe(true);
    expect(samples.at(-1)).toMatchObject({ noiseFloor: 0.12, visualLevel: 0 });
  });

  it("does not react to one click but starts after sustained speech", () => {
    const detector = new VoiceActivityDetector();
    feed(detector, [0.02, 0.03, 0.02, 0.03, 0.02, 0.03]);

    const click = detector.sample(0.9, 720);
    const quietAgain = detector.sample(0.03, 840);
    expect(click.speaking).toBe(false);
    expect(quietAgain.speaking).toBe(false);

    const speech = feed(detector, [0.72, 0.72, 0.68], 960);
    expect(speech[0]?.speaking).toBe(false);
    expect(speech[1]?.speaking).toBe(true);
    expect(speech[1]?.visualLevel).toBeGreaterThan(0);
  });

  it("holds through a short word gap and then releases", () => {
    const detector = new VoiceActivityDetector();
    feed(detector, [0.02, 0.03, 0.02, 0.03, 0.02, 0.03]);
    feed(detector, [0.7, 0.7, 0.7], 720);

    const silence = feed(detector, [0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01], 1_080);
    expect(silence[0]?.speaking).toBe(true);
    expect(silence[2]?.speaking).toBe(true);
    expect(silence.at(-1)?.speaking).toBe(false);
  });

  it("raises its threshold in a louder room", () => {
    const quietRoom = new VoiceActivityDetector();
    const loudRoom = new VoiceActivityDetector();
    const quiet = feed(quietRoom, Array.from({ length: 8 }, () => 0.02)).at(-1);
    const loud = feed(loudRoom, Array.from({ length: 8 }, () => 0.22)).at(-1);

    expect(loud?.speaking).toBe(false);
    expect(loud?.startThreshold ?? 0).toBeGreaterThan(quiet?.startThreshold ?? 1);
  });
});
