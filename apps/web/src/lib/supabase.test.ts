import { describe, expect, it } from "vitest";

import { confirmationRedirect, safeReturnPath } from "./supabase";

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

describe("confirmationRedirect", () => {
  it.each([
    ["candidate", "/candidate"],
    ["organizer", "/recruiter"],
  ])("returns %s accounts to the correct workspace", (_accountType, destination) => {
    expect(confirmationRedirect("https://roundcraft.example/", destination))
      .toBe(`https://roundcraft.example/auth/callback?next=${encodeURIComponent(destination)}`);
  });

  it("does not put an external destination in a confirmation email", () => {
    expect(confirmationRedirect("https://roundcraft.example", "https://attacker.example"))
      .toBe("https://roundcraft.example/auth/callback?next=%2Fdashboard");
  });
});
