/**
 * /api/ops/supabase-restore 路由测试
 * 覆盖：cron 鉴权、配置缺失（生产/非生产）、健康 noop、暂停恢复与未预期状态
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const { recordMetricMock, logApiErrorMock } = vi.hoisted(() => ({
  recordMetricMock: vi.fn(() => true),
  logApiErrorMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/metrics", () => ({ recordMetric: recordMetricMock }));
vi.mock("@/lib/api-log", () => ({ logApiError: logApiErrorMock }));
vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const REF = "ntqggnztzvoavjbiillb";

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/ops/supabase-restore", { headers });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.VERCEL_ENV;
  process.env.CRON_SECRET = "cron-secret";
  process.env.SUPABASE_PROJECT_REF = REF;
  process.env.SUPABASE_ACCESS_TOKEN = "sbp_test";
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${REF}.supabase.co`;
  fetchMock = vi.fn(async () => jsonResponse(200, { status: "ACTIVE_HEALTHY" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.CRON_SECRET;
  delete process.env.SUPABASE_PROJECT_REF;
  delete process.env.SUPABASE_ACCESS_TOKEN;
  delete process.env.VERCEL_ENV;
});

describe("GET /api/ops/supabase-restore", () => {
  it("缺少或错误凭证返回 401", async () => {
    const unauthorized: Record<string, string>[] = [
      {},
      { "x-cron-secret": "wrong" },
      { authorization: "Bearer wrong" },
    ];
    for (const headers of unauthorized) {
      const response = await GET(request(headers));
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "Unauthorized" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("未配置 CRON_SECRET 时拒绝调用", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(request({ "x-cron-secret": "cron-secret" }));
    expect(response.status).toBe(401);
  });

  it("Vercel Cron 的 Bearer 头可通过鉴权且响应 no-store", async () => {
    const response = await GET(request({ authorization: "Bearer cron-secret" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({ ok: true, action: "noop", projectStatus: "ACTIVE_HEALTHY" });
    expect(recordMetricMock).toHaveBeenCalledWith("ops.supabase.restore", 0, expect.any(Object));
  });

  it("生产环境缺少 Management 配置时返回 503", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.SUPABASE_ACCESS_TOKEN;
    delete process.env.SUPABASE_PROJECT_REF;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;

    const response = await GET(request({ "x-cron-secret": "cron-secret" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, action: "skipped" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("非生产环境缺少配置时安全跳过", async () => {
    delete process.env.SUPABASE_ACCESS_TOKEN;
    const response = await GET(request({ "x-cron-secret": "cron-secret" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, action: "skipped" });
  });

  it("项目暂停时调用 Management API 恢复", async () => {
    fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" || String(input).endsWith("/restore")) return jsonResponse(200, {});
      return jsonResponse(200, { status: "INACTIVE" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request({ "x-cron-secret": "cron-secret" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, action: "restore", projectStatus: "INACTIVE" });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.supabase.com/v1/projects/${REF}/restore`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(recordMetricMock).toHaveBeenCalledWith("ops.supabase.restore", 1, expect.any(Object));
  });

  it("Management API 异常时返回 502 并上报", async () => {
    fetchMock = vi.fn(async () => new Response("nope", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request({ "x-cron-secret": "cron-secret" }));
    expect(response.status).toBe(502);
    expect(logApiErrorMock).toHaveBeenCalled();
  });

  it("不可恢复状态返回 503 等待人工介入", async () => {
    fetchMock = vi.fn(async () => jsonResponse(200, { status: "REMOVED" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request({ "x-cron-secret": "cron-secret" }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ action: "escalate", projectStatus: "REMOVED" });
  });
});
