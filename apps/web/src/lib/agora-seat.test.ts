import { describe, expect, it, vi } from "vitest";
import { renewAgoraSeatTokens } from "./agora-seat";

describe("Agora guest seat renewal", () => {
  it("renews RTC and RTM with the same candidate-scoped token", async () => {
    const connection = {
      app_id: "app",
      token: "fresh-candidate-token",
      uid: "222",
      channel_name: "roundcraft-room",
      agent_uid: "111",
    };
    const renewConnection = vi.fn().mockResolvedValue(connection);
    const rtc = { renewToken: vi.fn().mockResolvedValue(undefined) };
    const rtm = { renewToken: vi.fn().mockResolvedValue(undefined) };

    await expect(renewAgoraSeatTokens(renewConnection, rtc, rtm)).resolves.toBe(connection);

    expect(renewConnection).toHaveBeenCalledOnce();
    expect(rtc.renewToken).toHaveBeenCalledWith("fresh-candidate-token");
    expect(rtm.renewToken).toHaveBeenCalledWith("fresh-candidate-token");
    expect(rtc.renewToken.mock.invocationCallOrder[0]).toBeLessThan(rtm.renewToken.mock.invocationCallOrder[0]);
  });

  it("does not touch RTM when RTC rejects the renewed token", async () => {
    const renewConnection = vi.fn().mockResolvedValue({
      app_id: "app",
      token: "rejected-token",
      uid: "222",
      channel_name: "roundcraft-room",
      agent_uid: "111",
    });
    const rtc = { renewToken: vi.fn().mockRejectedValue(new Error("expired")) };
    const rtm = { renewToken: vi.fn().mockResolvedValue(undefined) };

    await expect(renewAgoraSeatTokens(renewConnection, rtc, rtm)).rejects.toThrow("expired");
    expect(rtm.renewToken).not.toHaveBeenCalled();
  });
});
