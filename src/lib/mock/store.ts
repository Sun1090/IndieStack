/**
 * Request-scoped mock state primitive.
 *
 * The existing mock client keeps a globalThis-backed store for Next.js dev
 * chunk compatibility. New request handlers can use this primitive to avoid
 * sharing mutable fixture state between concurrent requests, then pass the
 * store through their own adapter until the client migration is complete.
 */
export type MockRequestStore = {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): T;
  getOrCreate<T>(key: string, factory: () => T): T;
  clear(): void;
};

export function createMockRequestStore(
  initialValues: Record<string, unknown> = {},
): MockRequestStore {
  const values = new Map(Object.entries(initialValues));

  return {
    get<T>(key: string): T | undefined {
      return values.get(key) as T | undefined;
    },

    set<T>(key: string, value: T): T {
      values.set(key, value);
      return value;
    },

    getOrCreate<T>(key: string, factory: () => T): T {
      const existing = values.get(key) as T | undefined;
      if (existing !== undefined) return existing;
      const created = factory();
      values.set(key, created);
      return created;
    },

    clear(): void {
      values.clear();
    },
  };
}
