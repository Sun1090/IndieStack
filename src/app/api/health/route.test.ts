/**
 * /api/health 路由测试（C01）
 * 覆盖：状态结构、版本单一来源（package.json）、no-store 缓存头、依赖自检字段
 */
import { describe, it, expect } from "vitest";
import { version as pkgVersion } from "../../../../package.json";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("返回 ok 状态与版本（单一来源 package.json）", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(pkgVersion);
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.uptimeFormatted).toBe("string");
    expect(typeof body.timestamp).toBe("string");
  });

  it("禁用缓存并输出依赖自检", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store, must-revalidate");
    const body = await res.json();
    expect(body.checks.supabase.configured).toBe(false);
    expect(body.checks.sentry.configured).toBe(false);
    expect(body.checks.stripe.configured).toBe(false);
    expect(body.allConfigured).toBe(false);
  });
});
