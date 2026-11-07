import { describe, expect, it } from "vitest";

import { createResumeStore, resumeKey } from "./resume";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

describe("resume storage", () => {
  it("builds keys per project or custom session source and environment", () => {
    expect(resumeKey("proj_1", "main")).toBe("voxylo:resume:proj_1:main");
    expect(resumeKey(undefined, "main")).toBe("voxylo:resume:custom:main");
  });

  it("stores, reads and clears a token", () => {
    const storage = memoryStorage();
    const store = createResumeStore({ storage }, "voxylo:resume:p:main");
    expect(store.get()).toBeNull();
    store.set("tok");
    expect(storage.map.get("voxylo:resume:p:main")).toBe("tok");
    expect(store.get()).toBe("tok");
    store.clear();
    expect(store.get()).toBeNull();
  });

  it("never throws when storage throws", () => {
    const boom = () => {
      throw new Error("SecurityError");
    };
    const store = createResumeStore({ storage: { getItem: boom, setItem: boom, removeItem: boom } }, "k");
    expect(() => store.set("tok")).not.toThrow();
    expect(store.get()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it("stores nothing when resume is false", () => {
    const store = createResumeStore(false, "k");
    store.set("tok");
    expect(store.get()).toBeNull();
  });

  it("falls back to memory when there is no localStorage", () => {
    const store = createResumeStore(undefined, "k");
    store.set("tok");
    expect(store.get()).toBe("tok");
  });
});
