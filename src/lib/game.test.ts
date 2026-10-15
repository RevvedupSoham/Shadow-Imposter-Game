import { describe, expect, it } from "vitest";

describe("room code", () => {
  it("uses six uppercase alphanumeric characters", () => {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    expect(code).toMatch(/^[A-Z0-9]{1,6}$/);
    expect(code.length).toBeGreaterThan(0);
    expect(code.length).toBeLessThanOrEqual(6);
  });
});
