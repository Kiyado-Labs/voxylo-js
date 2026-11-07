import { describe, expect, it } from "vitest";

describe("@voxylo/client entry", () => {
  it("exposes the SDK version", async () => {
    const mod = await import("./index");
    expect(mod.SDK_VERSION).toBe("0.0.0");
  });

  it("server entry loads without a DOM", async () => {
    const mod = await import("./server");
    expect(typeof mod).toBe("object");
  });
});
