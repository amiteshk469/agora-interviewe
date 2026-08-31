import { describe, expect, it } from "vitest";
import { formatDuration, routeKey } from "./utils";

describe("navigation helpers", () => {
  it("maps the optional catch-all root and nested routes", () => {
    expect(routeKey()).toBe("home");
    expect(routeKey(["reports", "demo"])).toBe("reports/demo");
  });

  it("formats interview time without locale drift", () => {
    expect(formatDuration(65)).toBe("01:05");
  });
});
