import { describe, expect, it } from "vitest";

describe("@voxylo/react entry", () => {
  it("loads under jsdom", async () => {
    const mod = await import("./index");
    expect(typeof mod).toBe("object");
  });
});
