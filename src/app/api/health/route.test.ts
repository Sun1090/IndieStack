/**
 * /api/health 路由测试（C01）
 * 覆盖：状态结构、版本单一来源（package.json）、no-store 缓存头、依赖分级与 HTTP 状态
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { version as pkgVersion } from "../../../../package.json";
import { GET } from "./route";

const mockCreateAdminClient = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  mockCreateAdminClient.mockReset();
});

describe("GET /api/health", () => {
  it("在本地 mock 模式返回健康状态并标记 Supabase 为跳过", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.version).toBe(pkgVersion);
    expect(typeof body.uptime).toBe("number");
    expect(typeof body.uptimeFormatted).toBe("string");
    expect(typeof body.timestamp).toBe("string");
    expect(body.mockMode).toBe(true);
    expect(body.ready).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.checks.supabase).toMatchObject({
      required: false,
      configured: false,
      reachable: null,
      status: "skipped",
    });
  });

  it("禁用缓存并保留 allConfigured 兼容字段", async () => {
    const res = await GET();
    expect(res.headers.get("Cache-Control")).toBe("no-store, must-revalidate");
    const body = await res.json();
    expect(body.checks.sentry).toMatchObject({
      required: false,
      configured: false,
      status: "missing",
    });
    expect(body.checks.stripe).toMatchObject({
      required: false,
      configured: false,
      status: "missing",
    });
    expect(body.allConfigured).toBe(false);
  });

  it("生产环境缺少 required Supabase 配置时返回 503，而不是伪装为 ok", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.ready).toBe(false);
    expect(body.degraded).toBe(false);
    expect(body.checks.supabase).toMatchObject({
      required: true,
      configured: false,
      reachable: false,
      status: "missing",
    });
  });

  it("required Supabase 已配置但不可达时返回 degraded/503", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    mockCreateAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          limit: () => ({
            maybeSingle: () => Promise.reject(new Error("unreachable")),
          }),
        }),
      }),
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.status).toBe("degraded");
    expect(body.ready).toBe(false);
    expect(body.degraded).toBe(true);
    expect(body.checks.supabase).toMatchObject({
      required: true,
      configured: true,
      reachable: false,
      status: "unreachable",
    });
  });

  it("required Supabase 已配置且可达时返回 ok/200", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    mockCreateAdminClient.mockReturnValue({
      from: () => ({
        select: () => ({
          limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.ready).toBe(true);
    expect(body.degraded).toBe(false);
    expect(body.checks.supabase).toMatchObject({
      required: true,
      configured: true,
      reachable: true,
      status: "ok",
    });
  });
});
