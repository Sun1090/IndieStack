import { describe, expect, it, vi } from "vitest";

const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

import { registerPushSubscription, revokePushSubscription } from "./push-subscriptions";

function client(error: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const eq2 = vi.fn().mockResolvedValue({ error });
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const del = vi.fn(() => ({ eq: eq1 }));
  return { from: vi.fn(() => ({ upsert, delete: del })), upsert, del, eq1, eq2 };
}

describe("push subscriptions repository", () => {
  it("registers idempotently by user and endpoint", async () => {
    const c = client(); createClientMock.mockResolvedValue(c);
    await registerPushSubscription("u1", { endpoint: "https://push", p256dh: "p", auth: "a", userAgent: "ua" });
    expect(c.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "u1", endpoint: "https://push", p256dh: "p", auth: "a", user_agent: "ua" }), { onConflict: "user_id,endpoint" });
  });

  it("rethrows registration errors with operation context", async () => {
    createClientMock.mockResolvedValue(client({ message: "db down" }));
    await expect(registerPushSubscription("u1", { endpoint: "e", p256dh: "p", auth: "a" })).rejects.toThrow("push subscription register: db down");
  });

  it("revokes only the current user's endpoint", async () => {
    const c = client(); createClientMock.mockResolvedValue(c);
    await revokePushSubscription("u1", "https://push");
    expect(c.del).toHaveBeenCalled(); expect(c.eq1).toHaveBeenCalledWith("user_id", "u1"); expect(c.eq2).toHaveBeenCalledWith("endpoint", "https://push");
  });

  it("rethrows revoke errors with operation context", async () => {
    createClientMock.mockResolvedValue(client({ message: "db down" }));
    await expect(revokePushSubscription("u1", "e")).rejects.toThrow("push subscription revoke: db down");
  });
});
