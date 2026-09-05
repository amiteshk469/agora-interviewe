import { describe, expect, it, vi } from "vitest";
import { panelRtmEngine } from "./panel-rtm";

describe("role-separated Agora transcript feed", () => {
  it("only passes the candidate agent's messages and cleans up the wrapped handler", () => {
    const engine = { publish: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    const filtered = panelRtmEngine(engine, "111");
    const listener = vi.fn();
    filtered.addEventListener("message", listener);
    const callback = engine.addEventListener.mock.calls[0][1];
    callback({ publisher: "1000000001", message: "human interviewer ASR" });
    callback({ publisher: "111", message: "candidate ASR" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ publisher: "111", message: "candidate ASR" });
    filtered.removeEventListener("message", listener);
    expect(engine.removeEventListener).toHaveBeenCalledWith("message", callback);
  });
});
