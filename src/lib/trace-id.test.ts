/**
 * 请求 trace-id 纯契约单测（E02）
 * 覆盖：header 名单一事实源、上游 ID 归一化边界、生成兜底分支、resolve 优先级。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  MAX_TRACE_ID_LENGTH,
  TRACE_HEADER,
  createTraceId,
  normalizeTraceId,
  resolveTraceId,
} from "./trace-id";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TRACE_HEADER", () => {
  it("固定为标准的 x-request-id", () => {
    expect(TRACE_HEADER).toBe("x-request-id");
  });
});

describe("normalizeTraceId()", () => {
  it("接受 UUID / ULID / OpenTelemetry 风格 ID", () => {
    for (const value of [
      "4f3a2b1c-9d8e-4a7b-8c6d-5e4f3a2b1c0d",
      "01HZY6Q4X8Z9J2K3M4N5P6Q7R8",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "trace_1:span-2",
    ]) {
      expect(normalizeTraceId(value)).toBe(value);
    }
  });

  it("去除首尾空白", () => {
    expect(normalizeTraceId("  abc-123  ")).toBe("abc-123");
  });

  it("拒绝空值、纯空白与非字符串", () => {
    expect(normalizeTraceId(undefined)).toBeNull();
    expect(normalizeTraceId(null)).toBeNull();
    expect(normalizeTraceId("")).toBeNull();
    expect(normalizeTraceId("   ")).toBeNull();
    expect(normalizeTraceId(42 as unknown as string)).toBeNull();
  });

  it("拒绝换行/制表符等日志注入字符", () => {
    expect(normalizeTraceId("abc\ndef")).toBeNull();
    expect(normalizeTraceId("abc\tdef")).toBeNull();
    expect(normalizeTraceId("abc def")).toBeNull();
    expect(normalizeTraceId("abc);rm -rf /")).toBeNull();
  });

  it("拒绝超过长度上限的 ID", () => {
    expect(normalizeTraceId("a".repeat(MAX_TRACE_ID_LENGTH))).toBe("a".repeat(MAX_TRACE_ID_LENGTH));
    expect(normalizeTraceId("a".repeat(MAX_TRACE_ID_LENGTH + 1))).toBeNull();
  });
});

describe("createTraceId()", () => {
  it("优先使用 WebCrypto 的 randomUUID", () => {
    const randomUUID = vi.fn(() => "generated-id");
    vi.stubGlobal("crypto", { randomUUID });
    expect(createTraceId()).toBe("generated-id");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("WebCrypto 缺失时退化为 UUID 形状的随机串", () => {
    vi.stubGlobal("crypto", undefined);
    const id = createTraceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(normalizeTraceId(id)).toBe(id);
  });

  it("randomUUID 不是函数时同样走兜底分支", () => {
    vi.stubGlobal("crypto", { randomUUID: "not-a-function" });
    expect(normalizeTraceId(createTraceId())).not.toBeNull();
  });
});

describe("resolveTraceId()", () => {
  it("优先透传合法上游 ID", () => {
    const generate = vi.fn(() => "generated");
    expect(resolveTraceId("upstream-1", generate)).toBe("upstream-1");
    expect(generate).not.toHaveBeenCalled();
  });

  it("非法或缺失时生成新 ID", () => {
    const generate = vi.fn(() => "generated");
    expect(resolveTraceId(null, generate)).toBe("generated");
    expect(resolveTraceId("bad id", generate)).toBe("generated");
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
