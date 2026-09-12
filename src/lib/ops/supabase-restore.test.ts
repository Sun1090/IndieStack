/**
 * Supabase 自动恢复兜底层单元测试
 * 覆盖：状态映射、ref 解析、cron 鉴权、Management API 调用与一轮检查的完整决策树
 */
import { describe, it, expect, vi } from "vitest";
import {
  classifyProjectStatus,
  isCronAuthorized,
  readProjectStatus,
  resolveProjectRef,
  restoreActionFor,
  runRestoreCycle,
  triggerProjectRestore,
  type RestoreCycleResult,
} from "./supabase-restore";

const API_BASE = "https://api.supabase.com/v1";
const REF = "ntqggnztzvoavjbiillb";
const TOKEN = "sbp_test_token";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function hooks() {
  return {
    onMetric: vi.fn(),
    onError: vi.fn(async () => {}),
    onInfo: vi.fn(),
    onWarn: vi.fn(),
  };
}

describe("classifyProjectStatus", () => {
  it("识别健康项目", () => {
    expect(classifyProjectStatus("ACTIVE_HEALTHY")).toBe("healthy");
  });

  it("忽略大小写与空白，识别被暂停项目", () => {
    expect(classifyProjectStatus(" inactive ")).toBe("paused");
  });

  it("把中间态归为 transient", () => {
    for (const status of ["RESTORING", "COMING_UP", "UPGRADING", "RESTARTING", "PAUSING", "GOING_DOWN", "ACTIVE_UNHEALTHY"]) {
      expect(classifyProjectStatus(status)).toBe("transient");
    }
  });

  it("把终态归为 unrecoverable", () => {
    for (const status of ["REMOVED", "INIT_FAILED", "RESTORE_FAILED"]) {
      expect(classifyProjectStatus(status)).toBe("unrecoverable");
    }
  });

  it("未知状态不被误判为可恢复", () => {
    expect(classifyProjectStatus("SOMETHING_NEW")).toBe("unknown");
  });
});

describe("restoreActionFor", () => {
  it("决策映射到动作", () => {
    expect(restoreActionFor("healthy")).toBe("noop");
    expect(restoreActionFor("paused")).toBe("restore");
    expect(restoreActionFor("transient")).toBe("wait");
    expect(restoreActionFor("unrecoverable")).toBe("escalate");
    expect(restoreActionFor("unknown")).toBe("escalate");
  });
});

describe("resolveProjectRef", () => {
  it("显式配置优先", () => {
    expect(resolveProjectRef(` ${REF} `, "https://other.supabase.co")).toBe(REF);
  });

  it("可从 Supabase URL 推断 ref", () => {
    expect(resolveProjectRef(undefined, `https://${REF}.supabase.co`)).toBe(REF);
    expect(resolveProjectRef(undefined, `https://${REF}.supabase.in`)).toBe(REF);
  });

  it("拒绝自建/非法地址", () => {
    expect(resolveProjectRef(undefined, "https://db.example.com")).toBeNull();
    expect(resolveProjectRef(undefined, "not a url")).toBeNull();
    expect(resolveProjectRef(undefined, undefined)).toBeNull();
  });
});

describe("isCronAuthorized", () => {
  const headers = (values: Record<string, string>) => ({
    get: (name: string) => values[name.toLowerCase()] ?? null,
  });

  it("未配置 secret 时一律拒绝", () => {
    expect(isCronAuthorized(headers({ authorization: "Bearer x" }), undefined)).toBe(false);
    expect(isCronAuthorized(headers({ "x-cron-secret": "x" }), "")).toBe(false);
  });

  it("接受 Bearer 与 x-cron-secret 两种形式", () => {
    expect(isCronAuthorized(headers({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true);
    expect(isCronAuthorized(headers({ "x-cron-secret": "s3cret" }), "s3cret")).toBe(true);
  });

  it("拒绝错误或残缺的凭证", () => {
    expect(isCronAuthorized(headers({ authorization: "Bearer wrong" }), "s3cret")).toBe(false);
    expect(isCronAuthorized(headers({ authorization: "s3cret" }), "s3cret")).toBe(false);
    expect(isCronAuthorized(headers({}), "s3cret")).toBe(false);
  });
});

describe("Management API 调用", () => {
  it("readProjectStatus 返回项目状态", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "ACTIVE_HEALTHY" })) as unknown as typeof fetch;
    await expect(readProjectStatus({ ref: REF, token: TOKEN, fetchImpl })).resolves.toBe("ACTIVE_HEALTHY");
    expect(fetchImpl).toHaveBeenCalledWith(`${API_BASE}/projects/${REF}`, expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("readProjectStatus 对缺失 status 返回 UNKNOWN", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, {})) as unknown as typeof fetch;
    await expect(readProjectStatus({ ref: REF, token: TOKEN, fetchImpl })).resolves.toBe("UNKNOWN");
  });

  it("readProjectStatus 在非 2xx 时抛出带状态码的错误", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
    await expect(readProjectStatus({ ref: REF, token: TOKEN, fetchImpl })).rejects.toThrow(/403/);
  });

  it("triggerProjectRestore 使用 POST 且非 2xx 抛错", async () => {
    const okFetch = vi.fn(async () => jsonResponse(201, {})) as unknown as typeof fetch;
    await expect(triggerProjectRestore({ ref: REF, token: TOKEN, fetchImpl: okFetch })).resolves.toBeUndefined();
    expect(okFetch).toHaveBeenCalledWith(
      `${API_BASE}/projects/${REF}/restore`,
      expect.objectContaining({ method: "POST" }),
    );

    const failFetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(triggerProjectRestore({ ref: REF, token: TOKEN, fetchImpl: failFetch })).rejects.toThrow(/restore 失败 500/);
  });

  it("支持自定义 apiBase（本地 mock 验证恢复链路）", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "INACTIVE" })) as unknown as typeof fetch;
    await readProjectStatus({ ref: REF, token: TOKEN, apiBase: "http://127.0.0.1:9999/v1", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:9999/v1/projects/" + REF, expect.any(Object));
  });
});

describe("runRestoreCycle", () => {
  const now = () => new Date("2026-09-12T05:30:00.000Z");

  function cycle(fetchImpl: typeof fetch, overrides: Partial<Parameters<typeof runRestoreCycle>[0]> = {}) {
    const h = hooks();
    const promise = runRestoreCycle(
      { ref: REF, token: TOKEN, fetchImpl, now, ...overrides },
      h,
    );
    return { h, promise };
  }

  async function expectResult(result: Promise<RestoreCycleResult>, httpStatus: number, action: string) {
    const value = await result;
    expect(value.httpStatus).toBe(httpStatus);
    expect(value.body.action).toBe(action);
    expect(value.body.checkedAt).toBe("2026-09-12T05:30:00.000Z");
    return value;
  }

  it("配置缺失时非生产跳过、生产显式失败", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const local = await expectResult(cycle(fetchImpl, { ref: null, token: undefined }).promise, 200, "skipped");
    expect(local.body.ok).toBe(true);
    expect(local.body.reason).toContain("SUPABASE_PROJECT_REF");

    const prod = await expectResult(cycle(fetchImpl, { token: undefined, isProduction: true }).promise, 503, "skipped");
    expect(prod.body.ok).toBe(false);
    expect(prod.body.reason).toContain("SUPABASE_ACCESS_TOKEN");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("项目健康时不触发恢复", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "ACTIVE_HEALTHY" })) as unknown as typeof fetch;
    const { h, promise } = cycle(fetchImpl);
    const result = await expectResult(promise, 200, "noop");
    expect(result.body.projectStatus).toBe("ACTIVE_HEALTHY");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(h.onMetric).toHaveBeenCalledWith("noop", "ACTIVE_HEALTHY");
    expect(h.onError).not.toHaveBeenCalled();
  });

  it("检测到 INACTIVE 时触发恢复", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse(200, {});
      if (String(input).endsWith("/restore")) return jsonResponse(200, {});
      return jsonResponse(200, { status: "INACTIVE" });
    }) as unknown as typeof fetch;
    const { h, promise } = cycle(fetchImpl);
    const result = await expectResult(promise, 200, "restore");
    expect(result.body.ok).toBe(true);
    expect(h.onInfo).toHaveBeenCalled();
    expect(h.onMetric).toHaveBeenCalledWith("restore", "INACTIVE");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("恢复调用失败时上报并返回可告警状态", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST" || String(input).endsWith("/restore")) {
        return new Response("boom", { status: 500 });
      }
      return jsonResponse(200, { status: "INACTIVE" });
    }) as unknown as typeof fetch;
    const { h, promise } = cycle(fetchImpl);
    const result = await expectResult(promise, 502, "escalate");
    expect(result.body.reason).toBe("restore-failed");
    expect(h.onError).toHaveBeenCalledTimes(1);
  });

  it("状态查询失败时返回 502 而不是误判为暂停", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const { h, promise } = cycle(fetchImpl);
    const result = await expectResult(promise, 502, "escalate");
    expect(result.body.reason).toBe("status-lookup-failed");
    expect(h.onMetric).not.toHaveBeenCalled();
  });

  it("中间态只等待，不写操作", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: "RESTORING" })) as unknown as typeof fetch;
    const { promise } = cycle(fetchImpl);
    await expectResult(promise, 200, "wait");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("不可恢复与未知状态需要人工介入", async () => {
    const removed = vi.fn(async () => jsonResponse(200, { status: "REMOVED" })) as unknown as typeof fetch;
    const removedCycle = cycle(removed);
    const removedResult = await expectResult(removedCycle.promise, 503, "escalate");
    expect(removedResult.body.reason).toBe("unexpected-status:REMOVED");
    expect(removedCycle.h.onError).toHaveBeenCalled();

    const odd = vi.fn(async () => jsonResponse(200, { status: "BRAND_NEW_STATE" })) as unknown as typeof fetch;
    await expectResult(cycle(odd).promise, 503, "escalate");
  });
});
