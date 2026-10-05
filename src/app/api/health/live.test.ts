/**
 * `/api/health`（readiness）与 `/api/health/live`（liveness）的分工测试。
 *
 * **为什么需要两个端点**：`/api/health` 会打一次 Supabase（`limit(1)`），
 * 并在返回体里报告 Supabase / Sentry / Stripe 的**配置与可达性**。
 * 这对「发布后确认生产状态」是对的，对「每 30 秒探一次容器还活着」是浪费：
 * Docker HEALTHCHECK 与负载均衡器要的只是**进程还在**，不需要知道依赖状态。
 *
 * **放大面在哪**：探针是唯一会被高频、高并发调用的公开端点。让它每次都出站打数据库，
 * 就等于给匿名调用者一个「用别人的流量打数据库」的杠杆；
 * 而把配置状态放进公开返回体，又正好与 `route-auth` 台账里
 * 「存活探针，不含任何用户数据或内部拓扑」的判断相矛盾——它**确实**含内部拓扑。
 *
 * 所以这里把两件事钉住：
 *  1. liveness 端点**真的不碰 Supabase**（结构性断言：模块里不许 import 客户端）；
 *  2. liveness 的返回体**真的不含**依赖配置与部署身份字段。
 * 第 1 条用读源码做，是因为「它没调用」这件事 mock 起来比断言函数更可靠：
 * mock 掉 createClient 再断言「没被调用」是可行的，但读 import 更直接地说明「为什么」。
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = process.cwd();
const LIVE_ROUTE = path.join("src", "app", "api", "health", "live", "route.ts");

const mockCreateClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({
  createClient: mockCreateClient,
}));

async function live(): Promise<Response> {
  vi.resetModules();
  return (await import("./live/route")).GET();
}

afterEach(() => {
  vi.unstubAllEnvs();
  mockCreateClient.mockReset();
});

describe("GET /api/health/live", () => {
  it("返回 200 与 ok，不带任何依赖状态", async () => {
    const res = await live();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
  });

  it("不返回依赖配置、部署身份或运行时长（探针要的是「活着」，不是「体检报告」）", async () => {
    const body = await (await live()).json();
    for (const key of [
      "checks",
      "allConfigured",
      "ready",
      "degraded",
      "commit",
      "version",
      "uptime",
      "uptimeFormatted",
      "environment",
      "mockMode",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it("no-store：探针的答案必须每次都是现算的，不能被缓存", async () => {
    const res = await live();
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("结构性保证：这条路由的模块图里没有 Supabase 客户端（mock 断言会漏掉间接引用）", () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, LIVE_ROUTE), "utf8");
    expect(source).not.toMatch(/supabase/);
    expect(source).not.toMatch(/createClient/);
  });

  it("即使三个 Supabase 凭据齐全，liveness 也不去打数据库", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    await live();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe("Docker HEALTHCHECK 指向 liveness 而不是 readiness", () => {
  it("HEALTHCHECK 打的是 /api/health/live（每 30 秒一次，不该每次出站打数据库）", () => {
    const dockerfile = fs.readFileSync(path.join(REPO_ROOT, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("/api/health/live");
    // readiness 路径若还留在 HEALTHCHECK 里，这条会红：高频探针又回到打数据库。
    const healthcheck = dockerfile.slice(dockerfile.indexOf("HEALTHCHECK"));
    expect(healthcheck).not.toMatch(/api\/health(?!\/live)/);
  });
});