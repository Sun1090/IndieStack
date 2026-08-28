/**
 * Webhook 事件查询服务端操作单元测试
 * mock guards 的 safelyRequireRole 与 webhook-events 仓库，验证 RBAC 守卫与数据映射
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { safelyRequireRoleMock, listRecentWebhookEventsMock } = vi.hoisted(() => ({
  safelyRequireRoleMock: vi.fn(),
  listRecentWebhookEventsMock: vi.fn(),
}));

vi.mock("@/lib/auth/guards", () => ({ safelyRequireRole: safelyRequireRoleMock }));
vi.mock("@/lib/repositories/webhook-events", () => ({
  listRecentWebhookEvents: listRecentWebhookEventsMock,
}));

import { listWebhookEvents } from "./webhooks";

function unauthorized() {
  return { success: false, error: { code: "UNAUTHORIZED" } };
}
function forbidden() {
  return { success: false, error: { code: "FORBIDDEN" } };
}
function authed() {
  return { success: true, data: { id: "u1", email: "a@b.com", role: "admin" } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listWebhookEvents()", () => {
  it("未登录返回 notAuthenticated", async () => {
    safelyRequireRoleMock.mockResolvedValue(unauthorized());
    await expect(listWebhookEvents()).resolves.toEqual({ ok: false, error: "notAuthenticated" });
  });

  it("非 admin 返回 forbidden", async () => {
    safelyRequireRoleMock.mockResolvedValue(forbidden());
    await expect(listWebhookEvents()).resolves.toEqual({ ok: false, error: "forbidden" });
  });

  it("仓库异常返回 databaseError", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    listRecentWebhookEventsMock.mockRejectedValue(new Error("boom"));
    await expect(listWebhookEvents()).resolves.toEqual({ ok: false, error: "databaseError" });
  });

  it("成功返回事件列表并透传 limit", async () => {
    safelyRequireRoleMock.mockResolvedValue(authed());
    const rows = [
      {
        id: "1",
        provider: "stripe",
        event_id: "evt_1",
        event_type: "checkout.session.completed",
        status: "delivered",
        error_message: null,
        payload: { foo: "bar" },
        created_at: "2026-01-01",
      },
    ];
    listRecentWebhookEventsMock.mockResolvedValue(rows);
    await expect(listWebhookEvents(10)).resolves.toEqual({ ok: true, data: rows });
    expect(listRecentWebhookEventsMock).toHaveBeenCalledWith(10);
  });
});