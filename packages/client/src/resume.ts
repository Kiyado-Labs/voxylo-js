export type ResumeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ResumeOption = false | { storage?: ResumeStorage } | undefined;

export interface ResumeStore {
  get(): string | null;
  set(token: string): void;
  clear(): void;
}

export function resumeKey(projectId: string | undefined, environment: string): string {
  return `voxylo:resume:${projectId ?? "custom"}:${environment}`;
}

function memoryStorage(): ResumeStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

function defaultStorage(): ResumeStorage {
  try {
    if (typeof globalThis.localStorage !== "undefined" && globalThis.localStorage !== null) {
      return globalThis.localStorage;
    }
  } catch {
    // Reading localStorage throws when site data is blocked
  }
  return memoryStorage();
}

export function createResumeStore(option: ResumeOption, key: string): ResumeStore {
  if (option === false) return { get: () => null, set: () => {}, clear: () => {} };
  const storage = option?.storage ?? defaultStorage();
  return {
    get() {
      try {
        return storage.getItem(key);
      } catch {
        return null;
      }
    },
    set(token) {
      try {
        storage.setItem(key, token);
      } catch {
        // Private mode or a full quota; resuming is a convenience
      }
    },
    clear() {
      try {
        storage.removeItem(key);
      } catch {
        // Same as set
      }
    },
  };
}
