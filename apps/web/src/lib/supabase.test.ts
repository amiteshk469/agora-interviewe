import { describe, expect, it } from "vitest";

import { safeReturnPath } from "./supabase";

describe("safeReturnPath", () => {
  it("keeps local workspace destinations", () => {
    expect(safeReturnPath("/setup")).toBe("/setup");
    expect(safeReturnPath("/reports/session-1?tab=tools")).toBe("/reports/session-1?tab=tools");
  });

  it("rejects external, protocol-relative, and auth-loop destinations", () => {
    expect(safeReturnPath("https://attacker.example")).toBe("/dashboard");
    expect(safeReturnPath("//attacker.example/path")).toBe("/dashboard");
    expect(safeReturnPath("/auth/sign-in")).toBe("/dashboard");
  });
});
