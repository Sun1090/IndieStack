/**
 * /api/health 路由测试（C01）
 * 覆盖：状态结构、版本单一来源（package.json）、no-store 缓存头、依赖分级与 HTTP 状态
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { version as pkgVersion } from "../../../../package.json";
import { GET } from "./route";

const mockCreateClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

afterEach(() => {
  vi.unstubAllEnvs();
  mockCreateClient.mockReset();
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

  it("构建身份来自构建时内联的 commit，未知时为 null 而不是编造值", async () => {
    const unset = await (await GET()).json();
    expect(unset.commit).toBeNull();

    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");
    const inlined = await (await GET()).json();
    expect(inlined.commit).toBe("a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");

    // 只有运行时变量（非 Vercel 的自建部署）也要能报出来；两者都在时以构建内联为准。
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "23a2677fc7b4737a66ab61b8c4e5dc32af0701ca");
    const runtimeOnly = await (await GET()).json();
    expect(runtimeOnly.commit).toBe("23a2677fc7b4737a66ab61b8c4e5dc32af0701ca");

    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");
    const both = await (await GET()).json();
    expect(both.commit).toBe("a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");

    // 空串是「没有」，不是「值为空」——否则发布记录会抄到一个假 SHA。
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "   ");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const blank = await (await GET()).json();
    expect(blank.commit).toBeNull();
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

  it("缺少 service_role 时 readiness 失败且不发起 anon 探测", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");

    const res = await GET();
    const body = await res.json();
    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
    expect(body.status).toBe("error");
    expect(body.ready).toBe(false);
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
    mockCreateClient.mockReturnValue({
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
    mockCreateClient.mockReturnValue({
      from: () => ({
        select: () => ({
          limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
        }),
      }),
    });

    const res = await GET();
    const body = await res.json();
    expect(mockCreateClient).toHaveBeenCalledWith("https://db.example.test", "anon", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
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
