/**
 * trace / api-response / csp 三件套单测（B09）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { headersMock } = vi.hoisted(() => ({ headersMock: vi.fn() }));
vi.mock("next/headers", () => ({ headers: headersMock }));

import { getTraceId } from "./trace";
import { jsonNoStore } from "./api-response";
import { NONCE_HEADER, generateNonce, buildCsp } from "./csp";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getTraceId()", () => {
  it("返回 x-request-id 头", async () => {
    headersMock.mockResolvedValue({ get: (k: string) => (k === "x-request-id" ? "tid-1" : null) });
    await expect(getTraceId()).resolves.toBe("tid-1");
  });

  it("无请求上下文返回 null", async () => {
    headersMock.mockRejectedValue(new Error("no context"));
    await expect(getTraceId()).resolves.toBeNull();
  });
});

describe("jsonNoStore()", () => {
  it("默认带 no-store 缓存头", async () => {
    const res = jsonNoStore({ ok: true });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it("保留调用方自定义状态码与额外头", async () => {
    const res = jsonNoStore({ e: 1 }, { status: 400, headers: { "x-t": "1" } });
    expect(res.status).toBe(400);
    expect(res.headers.get("x-t")).toBe("1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("csp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("NONCE_HEADER 为 x-nonce", () => {
    expect(NONCE_HEADER).toBe("x-nonce");
  });

  it("generateNonce 生成非空 base64", () => {
    const n = generateNonce();
    expect(n).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("生产 CSP 不含 unsafe-eval，含 nonce 与关键指令", () => {
    vi.stubEnv("NODE_ENV", "production");
    const csp = buildCsp("abc123");
    expect(csp).toContain("'nonce-abc123'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it("开发 CSP 含 unsafe-eval", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(buildCsp("x")).toContain("'unsafe-eval'");
  });
});
