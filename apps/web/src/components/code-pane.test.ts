import { beforeEach, describe, expect, it, vi } from "vitest";
import { restoreSessionCodeForEditor } from "./code-pane";

const api = vi.hoisted(() => ({
  readSessionCode: vi.fn(),
  saveSessionCode: vi.fn(),
}));

vi.mock("@/lib/api", () => api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("shared editor restore gate", () => {
  it("stays closed after a failed restore and can safely retry an empty saved buffer", async () => {
    api.readSessionCode
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ language: "python", content: "", updated_at: "2026-09-05T00:00:00Z" });

    await expect(restoreSessionCodeForEditor("session-1", ["python"], "python"))
      .resolves.toEqual({ status: "failed" });
    await expect(restoreSessionCodeForEditor("session-1", ["python"], "python"))
      .resolves.toEqual({
        status: "ready",
        snapshot: { language: "python", content: "" },
        hasSavedVersion: true,
      });

    expect(api.readSessionCode).toHaveBeenCalledTimes(2);
  });
});
