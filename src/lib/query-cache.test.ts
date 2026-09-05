/**
 * query-cache 单测（v0.5.0 E02）
 * 覆盖：key 工厂形状、档位常量、dashboardQueryOptions 统一默认值与覆盖项
 */
import { describe, it, expect } from "vitest";
import { dashboardQueryOptions, CACHE_STALE, QUERY_KEYS } from "./query-cache";

describe("QUERY_KEYS", () => {
  it("含全部业务域且无魔法字符串漂移", () => {
    expect(QUERY_KEYS.unreadCount).toEqual(["unread-count"]);
    expect(QUERY_KEYS.apiKeys).toEqual(["api-keys"]);
    expect(QUERY_KEYS.analytics("7d")).toEqual(["analytics", "7d"]);
    expect(QUERY_KEYS.mfaFactors).toEqual(["mfa-factors"]);
    expect(QUERY_KEYS.recoveryStatus).toEqual(["recovery-status"]);
    expect(QUERY_KEYS.adminUsers).toEqual(["admin-users"]);
    expect(QUERY_KEYS.adminAuditLogs).toEqual(["audit-logs"]);
    expect(QUERY_KEYS.adminWebhookEvents).toEqual(["webhook-events"]);
    expect(QUERY_KEYS.contactMessages({ search: "a", status: "new", page: 2 })).toEqual([
      "contact-messages",
      { search: "a", status: "new", page: 2 },
    ]);
  });
});

describe("CACHE_STALE", () => {
  it("档位：live < admin < standard", () => {
    expect(CACHE_STALE.live).toBeLessThan(CACHE_STALE.admin);
    expect(CACHE_STALE.admin).toBeLessThan(CACHE_STALE.standard);
  });
});

describe("dashboardQueryOptions()", () => {
  it("统一默认值：standard 档 / gcTime 5min / retry 1 / 窗口聚焦不刷新", () => {
    const options = dashboardQueryOptions({
      queryKey: QUERY_KEYS.apiKeys,
      queryFn: async () => 1,
    });
    expect(options.staleTime).toBe(CACHE_STALE.standard);
    expect(options.gcTime).toBe(5 * 60_000);
    expect(options.retry).toBe(1);
    expect(options.refetchOnWindowFocus).toBe(false);
  });

  it("覆盖项生效：档位/轮询/enabled", () => {
    const options = dashboardQueryOptions({
      queryKey: QUERY_KEYS.unreadCount,
      queryFn: async () => 1,
      staleTime: CACHE_STALE.live,
      refetchInterval: 60_000,
      enabled: false,
    });
    expect(options.staleTime).toBe(CACHE_STALE.live);
    expect(options.refetchInterval).toBe(60_000);
    expect(options.enabled).toBe(false);
  });
});
