import { afterEach, describe, expect, it, vi } from "vitest";
import { checkMicrophonePermission } from "./microphone-permission";

afterEach(() => vi.unstubAllGlobals());

describe("microphone permission", () => {
  it("requests audio independently of camera permission and releases the test stream", async () => {
    const stop = vi.fn();
    const getUserMedia = vi.fn().mockResolvedValue({ getAudioTracks: () => [{}], getTracks: () => [{ stop }] });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    await checkMicrophonePermission();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("propagates permission denial so joining can be retried", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(new Error("Permission denied"));
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    await expect(checkMicrophonePermission()).rejects.toThrow("Permission denied");
    getUserMedia.mockResolvedValue({ getAudioTracks: () => [{}], getTracks: () => [] });
    await expect(checkMicrophonePermission()).resolves.toBeUndefined();
  });
});
