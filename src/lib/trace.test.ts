/**
 * getTraceId() 单测（E02）
 * 覆盖：读取 middleware 注入的 header、返回 null 的兜底分支。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }));
vi.mock("next/headers", () => ({ headers: headersMock }));

import { getTraceId } from "./trace";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTraceId()", () => {
  it("读取 x-request-id", async () => {
    headersMock.mockResolvedValue(new Headers({ "x-request-id": "req-42" }));
    await expect(getTraceId()).resolves.toBe("req-42");
  });

  it("缺失 header 时返回 null", async () => {
    headersMock.mockResolvedValue(new Headers());
    await expect(getTraceId()).resolves.toBeNull();
  });

  it("非请求上下文（headers() 抛错）时返回 null 而不是抛出", async () => {
    headersMock.mockRejectedValue(new Error("outside request scope"));
    await expect(getTraceId()).resolves.toBeNull();
  });
});
