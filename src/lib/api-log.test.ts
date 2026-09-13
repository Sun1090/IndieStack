/**
 * 服务端错误日志边界单测（E02）
 * 覆盖：路由与 action 两个入口都附带 traceId、无 trace 上下文时省略该字段、非 Error 归一化。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getTraceIdMock, loggerErrorMock } = vi.hoisted(() => ({
  getTraceIdMock: vi.fn<() => Promise<string | null>>(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("@/lib/trace", () => ({ getTraceId: getTraceIdMock }));
vi.mock("@/lib/logger", () => ({ logger: { error: loggerErrorMock } }));

import { logActionError, logApiError } from "./api-log";

beforeEach(() => {
  vi.clearAllMocks();
  getTraceIdMock.mockResolvedValue(null);
});

describe("logApiError()", () => {
  it("有请求上下文时把 traceId 作为结构化字段上报", async () => {
    getTraceIdMock.mockResolvedValue("req-1");
    const error = new Error("boom");
    await logApiError("[scope] 失败", error);
    expect(loggerErrorMock).toHaveBeenCalledWith("[scope] 失败", { traceId: "req-1" }, error);
  });

  it("无请求上下文时省略 traceId 字段", async () => {
    const error = new Error("boom");
    await logApiError("[scope] 失败", error);
    expect(loggerErrorMock).toHaveBeenCalledWith("[scope] 失败", undefined, error);
  });

  it("非 Error 异常会归一化为 Error，保留原文", async () => {
    await logApiError("[scope] 失败", "plain failure");
    const [, context, error] = loggerErrorMock.mock.calls[0];
    expect(context).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("plain failure");
  });
});

describe("logActionError()", () => {
  it("与 logApiError 共用实现并附带 traceId", async () => {
    getTraceIdMock.mockResolvedValue("req-2");
    const error = new Error("action boom");
    await logActionError("[action] 失败", error);
    expect(loggerErrorMock).toHaveBeenCalledWith("[action] 失败", { traceId: "req-2" }, error);
  });

  it("吞吐 null 异常时不抛出", async () => {
    await expect(logActionError("[action] 失败", null)).resolves.toBeUndefined();
    const error = loggerErrorMock.mock.calls[0][2];
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("null");
  });
});
