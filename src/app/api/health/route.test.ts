/**
 * /api/health 路由测试（C01）
 * 覆盖：状态结构、版本单一来源（package.json）、no-store 缓存头、依赖分级与 HTTP 状态
 *
 * **为什么用 `getRoute()` 而不是静态 import**：路由里有一个**进程级**的探测缓存
 * （`createProbeCache`，TTL 5s + single-flight）。静态 import 意味着 8 条用例共用同一个
 * 模块实例，于是「先让探测失败、再让它成功」的两条用例会读到上一条缓存下来的失败——
 * 那不是用例写错了，是模块有了状态而测试假设它没有。
 * 每条用例重新 import 一次，模块状态就干净了；**不给生产代码加「供测试清缓存」的导出**，
 * 那是另一种谎：告诉读代码的人这个缓存可以随便清，实际不行。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { version as pkgVersion } from "../../../../package.json";

const mockCreateClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

/** 跑一次 GET：每次都带一份全新的模块实例（因此带一份全新的空缓存）。 */
async function health(): Promise<Response> {
  vi.resetModules();
  return (await import("./route")).GET();
}

afterEach(() => {
  vi.unstubAllEnvs();
  mockCreateClient.mockReset();
});

describe("GET /api/health", () => {
  it("在本地 mock 模式返回健康状态并标记 Supabase 为跳过", async () => {
    const res = await health();
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
    const res = await health();
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
    const unset = await (await health()).json();
    expect(unset.commit).toBeNull();

    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");
    const inlined = await (await health()).json();
    expect(inlined.commit).toBe("a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");

    // 只有运行时变量（非 Vercel 的自建部署）也要能报出来；两者都在时以构建内联为准。
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "23a2677fc7b4737a66ab61b8c4e5dc32af0701ca");
    const runtimeOnly = await (await health()).json();
    expect(runtimeOnly.commit).toBe("23a2677fc7b4737a66ab61b8c4e5dc32af0701ca");

    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");
    const both = await (await health()).json();
    expect(both.commit).toBe("a322a4ed6a86a254b2cc8be98fe3c6a97d1d118d");

    // 空串是「没有」，不是「值为空」——否则发布记录会抄到一个假 SHA。
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA", "   ");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const blank = await (await health()).json();
    expect(blank.commit).toBeNull();
  });

  it("生产构型里显式开 mock 也不能把健康检查变成「一切正常」（C13）", async () => {
    // 修之前这一格是：mockMode=true ⇒ Supabase 探测被跳成 "skipped" ⇒ 200/ok，
    // 而实际产物在用假用户——readiness 因此对一次认证绕过点头。现在生产里两条来源都被闸住，
    // 缺凭据就照实 503。
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_MOCK_ENABLED", "true");
    const res = await health();
    const body = await res.json();
    expect(body.mockMode).toBe(false);
    expect(res.status).toBe(503);
    expect(body.checks.supabase.status).toBe("missing");
  });

  it("生产环境缺少 required Supabase 配置时返回 503，而不是伪装为 ok", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await health();
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

    const res = await health();
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

    const res = await health();
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

    const res = await health();
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

  /**
   * 缺口条目的关法之一：「把 DB 探测结果按秒缓存」。
   *
   * 这一条钉的是**放大面本身**，不是某个状态码：并发的 20 次无凭据调用以前是 20 次
   * Supabase 往返，现在应当只打一次。反向证据是下一次「可达」的用例——它必须仍然是
   * 真的探测过一次，所以上面那几条可达/不可达的用例在每个用例里各自重置模块正是为了它。
   */
  it("一簇并发的无凭据调用只打一次 Supabase（放大面被缓存收掉）", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service");
    mockCreateClient.mockReturnValue({
      from: () => ({
        select: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
      }),
    });

    vi.resetModules();
    const { GET } = await import("./route");
    const responses = await Promise.all(Array.from({ length: 20 }, () => GET()));

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    for (const res of responses) {
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ checks: { supabase: { reachable: true } } });
    }
  });

  it("未配置凭据时根本不发起探测（与缓存无关的那一格）", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://db.example.test");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    // 缺 service_role ⇒ configured=false ⇒ readiness 失败，且一次网络都不该有
    mockCreateClient.mockReturnValue({
      from: () => ({ select: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({}) }) }) }),
    });

    const res = await health();
    expect(res.status).toBe(503);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});
