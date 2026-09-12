import { describe, expect, it, vi } from "vitest";

const { createClientMock, createAdminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  createAdminClientMock: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import {
  listPushSubscriptions,
  registerPushSubscription,
  removePushSubscription,
  revokePushSubscription,
} from "./push-subscriptions";

function client(error: { message: string } | null = null) {
  const upsert = vi.fn().mockResolvedValue({ error });
  const eq2 = vi.fn().mockResolvedValue({ error });
  const eq1 = vi.fn(() => ({ eq: eq2 }));
  const del = vi.fn(() => ({ eq: eq1 }));
  return { from: vi.fn(() => ({ upsert, delete: del })), upsert, del, eq1, eq2 };
}

function admin(data: unknown[] | null = [], error: { message: string } | null = null) {
  const order = vi.fn().mockResolvedValue({ data, error });
  const eq = vi.fn(() => ({ order, eq: vi.fn().mockResolvedValue({ error }) }));
  const delEq2 = vi.fn().mockResolvedValue({ error });
  const delEq1 = vi.fn(() => ({ eq: delEq2 }));
  const del = vi.fn(() => ({ eq: delEq1 }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select, delete: del }));
  return { from, select, eq, order, del, delEq1, delEq2 };
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

  it("lists subscriptions through the service-role client", async () => {
    const a = admin([{ id: "s1", user_id: "u1", endpoint: "e", p256dh: "p", auth: "a", user_agent: null }]);
    createAdminClientMock.mockReturnValue(a);
    await expect(listPushSubscriptions("u1")).resolves.toHaveLength(1);
    expect(a.select).toHaveBeenCalledWith("id,user_id,endpoint,p256dh,auth,user_agent");
    expect(a.eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("returns an empty list when data is null and rethrows list errors", async () => {
    createAdminClientMock.mockReturnValueOnce(admin(null));
    await expect(listPushSubscriptions("u1")).resolves.toEqual([]);
    createAdminClientMock.mockReturnValueOnce(admin([], { message: "db down" }));
    await expect(listPushSubscriptions("u1")).rejects.toThrow("push subscriptions list: db down");
  });

  it("removes only the selected user endpoint", async () => {
    const a = admin();
    createAdminClientMock.mockReturnValue(a);
    await removePushSubscription("u1", "e");
    expect(a.delEq1).toHaveBeenCalledWith("user_id", "u1");
    expect(a.delEq2).toHaveBeenCalledWith("endpoint", "e");
  });

  it("rethrows remove errors with operation context", async () => {
    createAdminClientMock.mockReturnValue(admin([], { message: "db down" }));
    await expect(removePushSubscription("u1", "e")).rejects.toThrow("push subscription remove: db down");
  });
});
